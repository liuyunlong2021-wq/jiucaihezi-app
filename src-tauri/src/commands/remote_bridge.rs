use base64::{Engine as _, engine::general_purpose::STANDARD_NO_PAD};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use snow::{Builder as NoiseBuilder, Keypair, TransportState, params::NoiseParams};
use std::collections::{HashMap, HashSet};
use std::io::{ErrorKind, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream, UdpSocket};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc,
};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub const MAX_FRAME_BYTES: usize = 64 * 1024;
const PAIRING_TTL_MS: u64 = 5 * 60 * 1000;
pub(crate) const NOISE_PATTERN: &str = "Noise_XX_25519_ChaChaPoly_BLAKE2s";
const MESSAGE_TYPES: &[&str] = &[
    "context.get",
    "session.read",
    "session.subscribe",
    "message.send",
    "run.stop",
    "approval.respond",
    "ping",
];

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBridgeStatus {
    pub listening: bool,
    pub address: Option<String>,
    pub public_key: String,
    pub devices: Vec<RemoteDeviceSummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemotePairingOffer {
    pub version: u8,
    pub address: String,
    pub desktop_public_key: String,
    pub offer_id: String,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDeviceSummary {
    pub device_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDevice {
    pub device_id: String,
    pub name: String,
    pub token_hash: String,
    pub public_key: String,
}

pub struct RemoteBridgeCore {
    private_key: Vec<u8>,
    public_key: Vec<u8>,
    now: u64,
    address: Option<String>,
    offer: Option<(RemotePairingOffer, bool)>,
    devices: HashMap<String, RemoteDevice>,
}

impl RemoteBridgeCore {
    pub fn new(keypair: Keypair, now: u64) -> Self {
        Self {
            private_key: keypair.private,
            public_key: keypair.public,
            now,
            address: None,
            offer: None,
            devices: HashMap::new(),
        }
    }

    pub fn status(&self) -> RemoteBridgeStatus {
        RemoteBridgeStatus {
            listening: self.address.is_some(),
            address: self.address.clone(),
            public_key: STANDARD_NO_PAD.encode(&self.public_key),
            devices: self
                .devices
                .values()
                .map(|device| RemoteDeviceSummary {
                    device_id: device.device_id.clone(),
                    name: device.name.clone(),
                })
                .collect(),
        }
    }

    pub fn set_listener(&mut self, address: String) {
        self.address = Some(address);
    }

    pub fn clear_listener(&mut self) {
        self.address = None;
        self.offer = None;
    }

    pub fn create_offer(&mut self, offer_id: String, now: u64) -> RemotePairingOffer {
        self.now = now;
        let offer = RemotePairingOffer {
            version: 1,
            address: self.address.clone().unwrap_or_default(),
            desktop_public_key: STANDARD_NO_PAD.encode(&self.public_key),
            offer_id,
            expires_at: self.now + PAIRING_TTL_MS,
        };
        self.offer = Some((offer.clone(), false));
        offer
    }

    pub fn claim_offer(&mut self, offer_id: &str, now: u64) -> Result<(), &'static str> {
        let Some((offer, used)) = self.offer.as_mut() else {
            return Err("PAIRING_OFFER_INVALID");
        };
        if offer.offer_id != offer_id {
            return Err("PAIRING_OFFER_INVALID");
        }
        if now > offer.expires_at {
            return Err("PAIRING_OFFER_EXPIRED");
        }
        if *used {
            return Err("PAIRING_OFFER_USED");
        }
        *used = true;
        Ok(())
    }

    pub fn authorize_device(
        &mut self,
        device_id: &str,
        name: &str,
        token: &str,
        public_key: &[u8],
    ) {
        self.devices.insert(
            device_id.to_string(),
            RemoteDevice {
                device_id: device_id.to_string(),
                name: name.to_string(),
                token_hash: token_hash(token),
                public_key: STANDARD_NO_PAD.encode(public_key),
            },
        );
    }

    pub fn authenticate(&self, device_id: &str, token: &str, public_key: &[u8]) -> bool {
        self.devices.get(device_id).is_some_and(|device| {
            device.token_hash == token_hash(token)
                && device.public_key == STANDARD_NO_PAD.encode(public_key)
        })
    }

    pub fn revoke_device(&mut self, device_id: &str) {
        self.devices.remove(device_id);
    }

    pub fn serialized_devices(&self) -> String {
        serde_json::to_string(&self.devices.values().collect::<Vec<_>>()).unwrap_or_default()
    }

    fn load_devices(&mut self, value: &str) -> Result<(), String> {
        let devices: Vec<RemoteDevice> =
            serde_json::from_str(value).map_err(|error| error.to_string())?;
        self.devices = devices
            .into_iter()
            .map(|device| (device.device_id.clone(), device))
            .collect();
        Ok(())
    }

    fn private_key(&self) -> Vec<u8> {
        self.private_key.clone()
    }
}

fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GuardedEnvelope {
    version: u8,
    request_id: String,
    #[serde(rename = "type")]
    message_type: String,
    sent_at: u64,
}

pub struct RemoteRequestGuard {
    seen: HashSet<String>,
    count: usize,
    limit: usize,
    window_started_at: u64,
}

impl RemoteRequestGuard {
    pub fn new(limit: usize, now: u64) -> Self {
        Self {
            seen: HashSet::new(),
            count: 0,
            limit,
            window_started_at: now,
        }
    }

    pub fn accept<'a>(&mut self, frame: &'a [u8], now: u64) -> Result<&'a [u8], &'static str> {
        if frame.len() > MAX_FRAME_BYTES {
            return Err("FRAME_TOO_LARGE");
        }
        if now.saturating_sub(self.window_started_at) >= 1_000 {
            self.window_started_at = now;
            self.count = 0;
        }
        if self.count >= self.limit {
            return Err("RATE_LIMITED");
        }
        self.count += 1;
        let envelope: GuardedEnvelope =
            serde_json::from_slice(frame).map_err(|_| "INVALID_MESSAGE")?;
        if envelope.version != 1 {
            return Err("UNSUPPORTED_VERSION");
        }
        if envelope.request_id.is_empty()
            || envelope.request_id.len() > 128
            || !envelope
                .request_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err("INVALID_REQUEST_ID");
        }
        if !MESSAGE_TYPES.contains(&envelope.message_type.as_str()) {
            return Err("UNSUPPORTED_MESSAGE");
        }
        if now.abs_diff(envelope.sent_at) > PAIRING_TTL_MS {
            return Err("STALE_MESSAGE");
        }
        if !self.seen.insert(envelope.request_id) {
            return Err("REPLAYED_REQUEST");
        }
        Ok(frame)
    }
}

pub fn noise_keypair() -> Keypair {
    NoiseBuilder::new(
        NOISE_PATTERN
            .parse::<NoiseParams>()
            .expect("valid Noise pattern"),
    )
    .generate_keypair()
    .expect("Noise key generation")
}

fn noise_handshake(
    server: &Keypair,
    client: &Keypair,
) -> Result<(TransportState, TransportState), String> {
    let params = NOISE_PATTERN
        .parse::<NoiseParams>()
        .map_err(|error| error.to_string())?;
    let mut initiator = NoiseBuilder::new(params.clone())
        .local_private_key(&client.private)
        .map_err(|error| error.to_string())?
        .build_initiator()
        .map_err(|error| error.to_string())?;
    let mut responder = NoiseBuilder::new(params)
        .local_private_key(&server.private)
        .map_err(|error| error.to_string())?
        .build_responder()
        .map_err(|error| error.to_string())?;
    let mut first = vec![0; 256];
    let first_len = initiator
        .write_message(&[], &mut first)
        .map_err(|error| error.to_string())?;
    let mut scratch = vec![0; 256];
    responder
        .read_message(&first[..first_len], &mut scratch)
        .map_err(|error| error.to_string())?;
    let mut second = vec![0; 256];
    let second_len = responder
        .write_message(&[], &mut second)
        .map_err(|error| error.to_string())?;
    initiator
        .read_message(&second[..second_len], &mut scratch)
        .map_err(|error| error.to_string())?;
    if initiator.get_remote_static() != Some(server.public.as_slice()) {
        return Err("DESKTOP_KEY_MISMATCH".to_string());
    }
    let mut third = vec![0; 256];
    let third_len = initiator
        .write_message(&[], &mut third)
        .map_err(|error| error.to_string())?;
    responder
        .read_message(&third[..third_len], &mut scratch)
        .map_err(|error| error.to_string())?;
    Ok((
        initiator
            .into_transport_mode()
            .map_err(|error| error.to_string())?,
        responder
            .into_transport_mode()
            .map_err(|error| error.to_string())?,
    ))
}

#[derive(Clone)]
pub struct RemoteBridgeState {
    core: Arc<Mutex<RemoteBridgeCore>>,
    initialized: Arc<AtomicBool>,
    generation: Arc<AtomicUsize>,
    active_connections: Arc<AtomicUsize>,
    pending_pairings: Arc<Mutex<HashMap<String, PendingPairing>>>,
    pending_requests: Arc<Mutex<HashMap<String, mpsc::Sender<Result<serde_json::Value, String>>>>>,
    clients: Arc<Mutex<HashMap<String, RemoteClient>>>,
}

impl Default for RemoteBridgeState {
    fn default() -> Self {
        Self {
            core: Arc::new(Mutex::new(RemoteBridgeCore::new(noise_keypair(), now_ms()))),
            initialized: Arc::new(AtomicBool::new(false)),
            generation: Arc::new(AtomicUsize::new(0)),
            active_connections: Arc::new(AtomicUsize::new(0)),
            pending_pairings: Arc::new(Mutex::new(HashMap::new())),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            clients: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

struct PendingPairing {
    device_id: String,
    name: String,
    public_key: Vec<u8>,
    sender: mpsc::Sender<PairingDecision>,
}

enum PairingDecision {
    Approved(String),
    Rejected,
}

struct RemoteClient {
    device_id: String,
    session_id: Option<String>,
    sender: mpsc::Sender<serde_json::Value>,
    stream: TcpStream,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemotePairingRequestEvent {
    offer_id: String,
    device_id: String,
    name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteBridgeRequestEvent {
    request_id: String,
    #[serde(rename = "type")]
    message_type: String,
    payload: serde_json::Value,
    device_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteAuthFrame {
    #[serde(rename = "type")]
    kind: String,
    offer_id: Option<String>,
    device_id: String,
    name: Option<String>,
    token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteRequestFrame {
    request_id: String,
    #[serde(rename = "type")]
    message_type: String,
    #[serde(default)]
    payload: serde_json::Value,
}

#[tauri::command]
pub fn remote_bridge_status(
    state: State<'_, RemoteBridgeState>,
) -> Result<RemoteBridgeStatus, String> {
    state
        .core
        .lock()
        .map_err(lock_error)
        .map(|core| core.status())
}

#[tauri::command]
pub fn remote_bridge_start(
    app: AppHandle,
    state: State<'_, RemoteBridgeState>,
) -> Result<RemoteBridgeStatus, String> {
    if !state.initialized.load(Ordering::Acquire) {
        let mut core = RemoteBridgeCore::new(load_or_create_keypair()?, now_ms());
        if let Ok(Some(devices)) = crate::secure_store::get_remote_bridge_devices() {
            let _ = core.load_devices(&devices);
        }
        *state.core.lock().map_err(lock_error)? = core;
        state.initialized.store(true, Ordering::Release);
    }
    if state.core.lock().map_err(lock_error)?.status().listening {
        return remote_bridge_status(state);
    }
    let listener = TcpListener::bind("0.0.0.0:0").map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let address = format!("tcp://{}:{port}", local_ip()?);
    let generation = state.generation.fetch_add(1, Ordering::AcqRel) + 1;
    state.core.lock().map_err(lock_error)?.set_listener(address);
    let server_state = state.inner().clone();
    thread::spawn(move || accept_loop(listener, app, server_state, generation));
    remote_bridge_status(state)
}

#[tauri::command]
pub fn remote_bridge_stop(
    state: State<'_, RemoteBridgeState>,
) -> Result<RemoteBridgeStatus, String> {
    state.generation.fetch_add(1, Ordering::AcqRel);
    state.core.lock().map_err(lock_error)?.clear_listener();
    state.pending_pairings.lock().map_err(lock_error)?.clear();
    let mut clients = state.clients.lock().map_err(lock_error)?;
    for client in clients.values() {
        let _ = client.stream.shutdown(Shutdown::Both);
    }
    clients.clear();
    drop(clients);
    remote_bridge_status(state)
}

#[tauri::command]
pub fn remote_pairing_offer(
    state: State<'_, RemoteBridgeState>,
) -> Result<RemotePairingOffer, String> {
    let mut core = state.core.lock().map_err(lock_error)?;
    if !core.status().listening {
        return Err("REMOTE_BRIDGE_DISABLED".to_string());
    }
    Ok(core.create_offer(Uuid::new_v4().to_string(), now_ms()))
}

#[tauri::command]
pub fn remote_pairing_approve(
    offer_id: String,
    state: State<'_, RemoteBridgeState>,
) -> Result<(), String> {
    let pending = state
        .pending_pairings
        .lock()
        .map_err(lock_error)?
        .remove(&offer_id)
        .ok_or_else(|| "PAIRING_REQUEST_NOT_FOUND".to_string())?;
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let mut core = state.core.lock().map_err(lock_error)?;
    core.authorize_device(
        &pending.device_id,
        &pending.name,
        &token,
        &pending.public_key,
    );
    if let Err(error) = persist_devices(&core) {
        core.revoke_device(&pending.device_id);
        return Err(error);
    }
    drop(core);
    pending
        .sender
        .send(PairingDecision::Approved(token))
        .map_err(|_| "PAIRING_CONNECTION_CLOSED".to_string())
}

#[tauri::command]
pub fn remote_pairing_reject(
    offer_id: String,
    state: State<'_, RemoteBridgeState>,
) -> Result<(), String> {
    let pending = state
        .pending_pairings
        .lock()
        .map_err(lock_error)?
        .remove(&offer_id)
        .ok_or_else(|| "PAIRING_REQUEST_NOT_FOUND".to_string())?;
    pending
        .sender
        .send(PairingDecision::Rejected)
        .map_err(|_| "PAIRING_CONNECTION_CLOSED".to_string())
}

#[tauri::command]
pub fn remote_device_revoke(
    device_id: String,
    state: State<'_, RemoteBridgeState>,
) -> Result<(), String> {
    let mut core = state.core.lock().map_err(lock_error)?;
    core.revoke_device(&device_id);
    persist_devices(&core)?;
    drop(core);
    state
        .clients
        .lock()
        .map_err(lock_error)?
        .retain(|_, client| {
            if client.device_id == device_id {
                let _ = client.stream.shutdown(Shutdown::Both);
                false
            } else {
                true
            }
        });
    Ok(())
}

#[tauri::command]
pub fn remote_bridge_complete(
    request_id: String,
    result: Option<serde_json::Value>,
    error: Option<String>,
    state: State<'_, RemoteBridgeState>,
) -> Result<(), String> {
    let sender = state
        .pending_requests
        .lock()
        .map_err(lock_error)?
        .remove(&request_id)
        .ok_or_else(|| "REMOTE_REQUEST_EXPIRED".to_string())?;
    sender
        .send(error.map_or_else(|| Ok(result.unwrap_or(serde_json::Value::Null)), Err))
        .map_err(|_| "REMOTE_CONNECTION_CLOSED".to_string())
}

#[tauri::command]
pub fn remote_bridge_publish(
    session_id: String,
    event: serde_json::Value,
    state: State<'_, RemoteBridgeState>,
) -> Result<(), String> {
    for client in state.clients.lock().map_err(lock_error)?.values() {
        if session_id.is_empty() || client.session_id.as_deref() == Some(session_id.as_str()) {
            let _ = client.sender.send(event.clone());
        }
    }
    Ok(())
}

impl RemoteBridgeState {
    fn inner(&self) -> &Self {
        self
    }
}

fn accept_loop(listener: TcpListener, app: AppHandle, state: RemoteBridgeState, generation: usize) {
    while generation_is_current(&state, generation) {
        match listener.accept() {
            Ok((stream, _)) => {
                if state.active_connections.fetch_add(1, Ordering::AcqRel) >= 4 {
                    state.active_connections.fetch_sub(1, Ordering::AcqRel);
                    continue;
                }
                let app = app.clone();
                let state = state.clone();
                thread::spawn(move || {
                    let _ = handle_connection(stream, &app, &state, generation);
                    state.active_connections.fetch_sub(1, Ordering::AcqRel);
                });
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(50))
            }
            Err(_) => break,
        }
    }
}

fn handle_connection(
    mut stream: TcpStream,
    app: &AppHandle,
    state: &RemoteBridgeState,
    generation: usize,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|error| error.to_string())?;
    let private_key = state.core.lock().map_err(lock_error)?.private_key();
    let (transport, client_public_key) = server_noise_handshake(&mut stream, &private_key)?;
    let transport = Arc::new(Mutex::new(transport));
    let auth = read_encrypted_json::<RemoteAuthFrame>(&mut stream, &transport)?;
    let device_id = if auth.kind == "pair.request" {
        handle_pairing(
            &mut stream,
            &transport,
            app,
            state,
            auth,
            client_public_key.clone(),
        )?
    } else if auth.kind == "auth" {
        let token = auth
            .token
            .as_deref()
            .ok_or_else(|| "AUTH_INVALID".to_string())?;
        if !state.core.lock().map_err(lock_error)?.authenticate(
            &auth.device_id,
            token,
            &client_public_key,
        ) {
            return Err("AUTH_INVALID".to_string());
        }
        write_encrypted_json(&mut stream, &transport, &serde_json::json!({ "ok": true }))?;
        auth.device_id
    } else {
        return Err("AUTH_INVALID".to_string());
    };

    let connection_id = Uuid::new_v4().to_string();
    let (outbound, outgoing) = mpsc::channel::<serde_json::Value>();
    state.clients.lock().map_err(lock_error)?.insert(
        connection_id.clone(),
        RemoteClient {
            device_id: device_id.clone(),
            session_id: None,
            sender: outbound.clone(),
            stream: stream.try_clone().map_err(|error| error.to_string())?,
        },
    );
    let mut writer = stream.try_clone().map_err(|error| error.to_string())?;
    let writer_transport = transport.clone();
    let writer_thread = thread::spawn(move || {
        while let Ok(value) = outgoing.recv() {
            if write_encrypted_json(&mut writer, &writer_transport, &value).is_err() {
                break;
            }
        }
    });

    let mut guard = RemoteRequestGuard::new(30, now_ms());
    while generation_is_current(state, generation) {
        let frame = match read_encrypted(&mut stream, &transport) {
            Ok(frame) => frame,
            Err(_) => break,
        };
        if !generation_is_current(state, generation) {
            break;
        }
        let accepted = match guard.accept(&frame, now_ms()) {
            Ok(value) => value,
            Err(code) => {
                let _ = outbound.send(serde_json::json!({ "error": code }));
                continue;
            }
        };
        let request: RemoteRequestFrame =
            serde_json::from_slice(accepted).map_err(|error| error.to_string())?;
        if request.message_type == "ping" {
            let _ = outbound.send(serde_json::json!({ "version": 1, "requestId": request.request_id, "type": "pong", "sentAt": now_ms(), "payload": {} }));
            continue;
        }
        let (sender, receiver) = mpsc::channel();
        state
            .pending_requests
            .lock()
            .map_err(lock_error)?
            .insert(request.request_id.clone(), sender);
        app.emit(
            "desktop-remote:request",
            RemoteBridgeRequestEvent {
                request_id: request.request_id.clone(),
                message_type: request.message_type.clone(),
                payload: request.payload.clone(),
                device_id: device_id.clone(),
            },
        )
        .map_err(|error| error.to_string())?;
        let response = receiver.recv_timeout(Duration::from_secs(30));
        state
            .pending_requests
            .lock()
            .map_err(lock_error)?
            .remove(&request.request_id);
        let response = match response {
            Ok(Ok(result)) => {
                if request.message_type == "session.subscribe" {
                    if let Some(session_id) = request
                        .payload
                        .get("sessionId")
                        .and_then(|value| value.as_str())
                    {
                        if let Some(client) = state
                            .clients
                            .lock()
                            .map_err(lock_error)?
                            .get_mut(&connection_id)
                        {
                            client.session_id = Some(session_id.to_string());
                        }
                    }
                }
                serde_json::json!({ "version": 1, "requestId": request.request_id, "type": "response", "sentAt": now_ms(), "payload": { "result": result } })
            }
            Ok(Err(error)) => {
                serde_json::json!({ "version": 1, "requestId": request.request_id, "type": "response", "sentAt": now_ms(), "payload": { "error": error } })
            }
            Err(_) => {
                serde_json::json!({ "version": 1, "requestId": request.request_id, "type": "response", "sentAt": now_ms(), "payload": { "error": "REMOTE_HOST_TIMEOUT" } })
            }
        };
        let _ = outbound.send(response);
    }
    state
        .clients
        .lock()
        .map_err(lock_error)?
        .remove(&connection_id);
    drop(outbound);
    let _ = writer_thread.join();
    Ok(())
}

fn handle_pairing(
    stream: &mut TcpStream,
    transport: &Arc<Mutex<TransportState>>,
    app: &AppHandle,
    state: &RemoteBridgeState,
    auth: RemoteAuthFrame,
    public_key: Vec<u8>,
) -> Result<String, String> {
    validate_id(&auth.device_id)?;
    let name = auth.name.unwrap_or_default();
    if name.trim().is_empty() || name.len() > 128 {
        return Err("PAIRING_DEVICE_INVALID".to_string());
    }
    let offer_id = auth
        .offer_id
        .ok_or_else(|| "PAIRING_OFFER_INVALID".to_string())?;
    state
        .core
        .lock()
        .map_err(lock_error)?
        .claim_offer(&offer_id, now_ms())
        .map_err(str::to_string)?;
    let (sender, receiver) = mpsc::channel();
    state.pending_pairings.lock().map_err(lock_error)?.insert(
        offer_id.clone(),
        PendingPairing {
            device_id: auth.device_id.clone(),
            name: name.clone(),
            public_key,
            sender,
        },
    );
    app.emit(
        "desktop-remote:pairing-request",
        RemotePairingRequestEvent {
            offer_id: offer_id.clone(),
            device_id: auth.device_id.clone(),
            name,
        },
    )
    .map_err(|error| error.to_string())?;
    let decision = receiver
        .recv_timeout(Duration::from_secs(300))
        .map_err(|_| "PAIRING_APPROVAL_TIMEOUT".to_string())?;
    state
        .pending_pairings
        .lock()
        .map_err(lock_error)?
        .remove(&offer_id);
    match decision {
        PairingDecision::Approved(token) => {
            write_encrypted_json(
                stream,
                transport,
                &serde_json::json!({ "ok": true, "deviceId": auth.device_id, "token": token }),
            )?;
            Ok(auth.device_id)
        }
        PairingDecision::Rejected => {
            let _ = write_encrypted_json(
                stream,
                transport,
                &serde_json::json!({ "ok": false, "error": "PAIRING_REJECTED" }),
            );
            Err("PAIRING_REJECTED".to_string())
        }
    }
}

pub(crate) fn server_noise_handshake(
    stream: &mut TcpStream,
    private_key: &[u8],
) -> Result<(TransportState, Vec<u8>), String> {
    let params = NOISE_PATTERN
        .parse::<NoiseParams>()
        .map_err(|error| error.to_string())?;
    let mut responder = NoiseBuilder::new(params)
        .local_private_key(private_key)
        .map_err(|error| error.to_string())?
        .build_responder()
        .map_err(|error| error.to_string())?;
    let first = read_frame(stream, 1024)?;
    let mut scratch = vec![0; 1024];
    responder
        .read_message(&first, &mut scratch)
        .map_err(|error| error.to_string())?;
    let mut second = vec![0; 1024];
    let size = responder
        .write_message(&[], &mut second)
        .map_err(|error| error.to_string())?;
    write_frame(stream, &second[..size])?;
    let third = read_frame(stream, 1024)?;
    responder
        .read_message(&third, &mut scratch)
        .map_err(|error| error.to_string())?;
    let remote_static = responder
        .get_remote_static()
        .ok_or_else(|| "MOBILE_KEY_MISSING".to_string())?
        .to_vec();
    Ok((
        responder
            .into_transport_mode()
            .map_err(|error| error.to_string())?,
        remote_static,
    ))
}

pub(crate) fn read_encrypted_json<T: for<'de> Deserialize<'de>>(
    stream: &mut TcpStream,
    transport: &Arc<Mutex<TransportState>>,
) -> Result<T, String> {
    serde_json::from_slice(&read_encrypted(stream, transport)?).map_err(|error| error.to_string())
}

pub(crate) fn read_encrypted(
    stream: &mut TcpStream,
    transport: &Arc<Mutex<TransportState>>,
) -> Result<Vec<u8>, String> {
    let encrypted = read_frame(stream, MAX_FRAME_BYTES + 16)?;
    let mut plain = vec![0; encrypted.len()];
    let size = transport
        .lock()
        .map_err(lock_error)?
        .read_message(&encrypted, &mut plain)
        .map_err(|error| error.to_string())?;
    plain.truncate(size);
    Ok(plain)
}

pub(crate) fn write_encrypted_json(
    stream: &mut TcpStream,
    transport: &Arc<Mutex<TransportState>>,
    value: &serde_json::Value,
) -> Result<(), String> {
    let plain = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    if plain.len() > MAX_FRAME_BYTES {
        return Err("FRAME_TOO_LARGE".to_string());
    }
    let mut encrypted = vec![0; plain.len() + 16];
    let size = transport
        .lock()
        .map_err(lock_error)?
        .write_message(&plain, &mut encrypted)
        .map_err(|error| error.to_string())?;
    write_frame(stream, &encrypted[..size])
}

pub(crate) fn read_frame(stream: &mut TcpStream, max: usize) -> Result<Vec<u8>, String> {
    let mut length = [0u8; 4];
    stream
        .read_exact(&mut length)
        .map_err(|error| error.to_string())?;
    let length = u32::from_be_bytes(length) as usize;
    if length == 0 || length > max {
        return Err("FRAME_TOO_LARGE".to_string());
    }
    let mut bytes = vec![0; length];
    stream
        .read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

pub(crate) fn write_frame(stream: &mut TcpStream, bytes: &[u8]) -> Result<(), String> {
    stream
        .write_all(&(bytes.len() as u32).to_be_bytes())
        .map_err(|error| error.to_string())?;
    stream.write_all(bytes).map_err(|error| error.to_string())
}

fn local_ip() -> Result<String, String> {
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|error| error.to_string())?;
    socket
        .connect("1.1.1.1:80")
        .map_err(|error| error.to_string())?;
    Ok(socket
        .local_addr()
        .map_err(|error| error.to_string())?
        .ip()
        .to_string())
}

fn validate_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("INVALID_ID".to_string());
    }
    Ok(())
}

pub(crate) fn lock_error<T>(_: std::sync::PoisonError<T>) -> String {
    "REMOTE_BRIDGE_STATE_UNAVAILABLE".to_string()
}

fn generation_is_current(state: &RemoteBridgeState, generation: usize) -> bool {
    state.generation.load(Ordering::Acquire) == generation
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredNoiseIdentity {
    private_key: String,
    public_key: String,
}

fn load_or_create_keypair() -> Result<Keypair, String> {
    if let Some(value) = crate::secure_store::get_remote_bridge_identity()?
        && let Ok(identity) = serde_json::from_str::<StoredNoiseIdentity>(&value)
        && let (Ok(private), Ok(public)) = (
            STANDARD_NO_PAD.decode(identity.private_key),
            STANDARD_NO_PAD.decode(identity.public_key),
        )
        && private.len() == 32
        && public.len() == 32
    {
        return Ok(Keypair { private, public });
    }
    let keypair = noise_keypair();
    let value = serde_json::to_string(&StoredNoiseIdentity {
        private_key: STANDARD_NO_PAD.encode(&keypair.private),
        public_key: STANDARD_NO_PAD.encode(&keypair.public),
    })
    .map_err(|error| error.to_string())?;
    crate::secure_store::set_remote_bridge_identity(&value)?;
    Ok(keypair)
}

fn persist_devices(core: &RemoteBridgeCore) -> Result<(), String> {
    crate::secure_store::set_remote_bridge_devices(&core.serialized_devices())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_is_disabled_until_the_user_starts_it() {
        let core = RemoteBridgeCore::new(noise_keypair(), 1_000);
        assert!(!core.status().listening);
        assert!(core.status().address.is_none());
    }

    #[test]
    fn restarting_the_bridge_permanently_invalidates_the_old_listener_generation() {
        let state = RemoteBridgeState::default();
        let first = state.generation.fetch_add(1, Ordering::AcqRel) + 1;
        assert!(generation_is_current(&state, first));
        state.generation.fetch_add(1, Ordering::AcqRel);
        let second = state.generation.fetch_add(1, Ordering::AcqRel) + 1;
        assert!(!generation_is_current(&state, first));
        assert!(generation_is_current(&state, second));
    }

    #[test]
    fn pairing_offer_is_one_time_and_expires_after_five_minutes() {
        let mut core = RemoteBridgeCore::new(noise_keypair(), 1_000);
        core.set_listener("192.168.1.2:9527".into());
        let offer = core.create_offer("offer-1".into(), 1_000);
        assert_eq!(offer.expires_at, 301_000);
        core.claim_offer(&offer.offer_id, 2_000).unwrap();
        assert_eq!(
            core.claim_offer(&offer.offer_id, 2_001),
            Err("PAIRING_OFFER_USED")
        );

        let expired = core.create_offer("offer-2".into(), 1_000);
        assert_eq!(
            core.claim_offer(&expired.offer_id, expired.expires_at + 1),
            Err("PAIRING_OFFER_EXPIRED")
        );
    }

    #[test]
    fn authorized_devices_are_stored_as_token_hashes_and_can_be_revoked() {
        let mut core = RemoteBridgeCore::new(noise_keypair(), 1_000);
        core.authorize_device("iphone-1", "iPhone", "secret-token", b"mobile-key");
        assert!(core.authenticate("iphone-1", "secret-token", b"mobile-key"));
        assert!(!core.authenticate(
            "iphone-1",
            "secret-token",
            b"copied-token-on-another-device"
        ));
        assert!(!core.serialized_devices().contains("secret-token"));
        core.revoke_device("iphone-1");
        assert!(!core.authenticate("iphone-1", "secret-token", b"mobile-key"));
    }

    #[test]
    fn request_guard_rejects_replay_unknown_types_and_oversized_frames() {
        let mut guard = RemoteRequestGuard::new(10, 1_000);
        let request = br#"{"version":1,"requestId":"request-1","type":"context.get","sentAt":1000,"payload":{}}"#;
        assert!(guard.accept(request, 1_000).is_ok());
        assert_eq!(guard.accept(request, 1_001), Err("REPLAYED_REQUEST"));
        assert_eq!(guard.accept(br#"{"version":1,"requestId":"request-2","type":"unknown","sentAt":1000,"payload":{}}"#, 1_000), Err("UNSUPPORTED_MESSAGE"));
        assert_eq!(
            guard.accept(&vec![b'x'; MAX_FRAME_BYTES + 1], 1_000),
            Err("FRAME_TOO_LARGE")
        );
    }

    #[test]
    fn request_guard_rate_limits_each_connection() {
        let mut guard = RemoteRequestGuard::new(1, 1_000);
        let request = br#"{"version":1,"requestId":"request-1","type":"context.get","sentAt":1000,"payload":{}}"#;
        assert!(guard.accept(request, 1_000).is_ok());
        assert_eq!(guard.accept(request, 1_001), Err("RATE_LIMITED"));
        let next = br#"{"version":1,"requestId":"request-2","type":"context.get","sentAt":2001,"payload":{}}"#;
        assert!(guard.accept(next, 2_001).is_ok());
    }

    #[test]
    fn noise_transport_encrypts_and_pins_the_desktop_static_key() {
        let server = noise_keypair();
        let client = noise_keypair();
        let (mut initiator, mut responder) = noise_handshake(&server, &client).unwrap();
        let mut encrypted = vec![0; 128];
        let size = initiator
            .write_message(b"private prompt", &mut encrypted)
            .unwrap();
        assert!(
            !encrypted[..size]
                .windows(b"private prompt".len())
                .any(|part| part == b"private prompt")
        );
        let mut plain = vec![0; 128];
        let read = responder
            .read_message(&encrypted[..size], &mut plain)
            .unwrap();
        assert_eq!(&plain[..read], b"private prompt");
    }

    #[test]
    fn fake_mobile_crosses_a_real_tcp_socket_with_noise_encryption() {
        let server = noise_keypair();
        let server_private = server.private.clone();
        let server_public = server.public.clone();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server_thread = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let (transport, _) = server_noise_handshake(&mut stream, &server_private).unwrap();
            let transport = Arc::new(Mutex::new(transport));
            let request = read_encrypted(&mut stream, &transport).unwrap();
            assert_eq!(request, b"current-session-only");
            write_encrypted_json(&mut stream, &transport, &serde_json::json!({ "ok": true }))
                .unwrap();
        });

        let client = noise_keypair();
        let params = NOISE_PATTERN.parse::<NoiseParams>().unwrap();
        let mut handshake = NoiseBuilder::new(params)
            .local_private_key(&client.private)
            .unwrap()
            .build_initiator()
            .unwrap();
        let mut stream = TcpStream::connect(address).unwrap();
        let mut buffer = vec![0; 1024];
        let size = handshake.write_message(&[], &mut buffer).unwrap();
        write_frame(&mut stream, &buffer[..size]).unwrap();
        let second = read_frame(&mut stream, 1024).unwrap();
        handshake.read_message(&second, &mut buffer).unwrap();
        assert_eq!(
            handshake.get_remote_static(),
            Some(server_public.as_slice())
        );
        let size = handshake.write_message(&[], &mut buffer).unwrap();
        write_frame(&mut stream, &buffer[..size]).unwrap();
        let transport = Arc::new(Mutex::new(handshake.into_transport_mode().unwrap()));
        let mut encrypted = vec![0; 128];
        let size = transport
            .lock()
            .unwrap()
            .write_message(b"current-session-only", &mut encrypted)
            .unwrap();
        write_frame(&mut stream, &encrypted[..size]).unwrap();
        let response: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
        assert_eq!(response, serde_json::json!({ "ok": true }));
        server_thread.join().unwrap();
    }
}
