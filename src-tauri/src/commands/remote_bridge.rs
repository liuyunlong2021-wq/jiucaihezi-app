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
const CHUNK_BYTES: usize = 60 * 1024;
// ponytail: bounded reassembly; paginate old history if a snapshot ever exceeds 8 MiB.
const MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
const CHUNK_HEADER: &[u8; 4] = b"JCL1";
const PAIRING_TTL_MS: u64 = 5 * 60 * 1000;
pub(crate) const NOISE_PATTERN: &str = "Noise_XX_25519_ChaChaPoly_BLAKE2s";
const MESSAGE_TYPES: &[&str] = &[
    "gateway.health",
    "context.get",
    "session.read",
    "session.attach",
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
    // 这个字符串会原样进一次性 offer，手机端拿它直接 TcpStream::connect，
    // 所以必须是裸 host:port：带任何 scheme 都会让 getaddrinfo 报
    // "nodename nor servname provided"。
    let address = format!("{}:{port}", local_ip()?);
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
    let offer = core.create_offer(Uuid::new_v4().to_string(), now_ms());
    bridge_log(&format!("pairing offer created {}", offer.offer_id));
    Ok(offer)
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
    bridge_log(&format!("pairing approved {offer_id}"));
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
    let clients = state.clients.lock().map_err(lock_error)?;
    send_remote_event_to_all(
        clients
            .values()
            .filter(|client| {
                session_id.is_empty() || client.session_id.as_deref() == Some(session_id.as_str())
            })
            .map(|client| &client.sender),
        &event,
    )
}

fn send_remote_event(
    sender: &mpsc::Sender<serde_json::Value>,
    event: &serde_json::Value,
) -> Result<(), String> {
    sender
        .send(event.clone())
        .map_err(|_| "REMOTE_PUBLISH_FAILED".to_string())
}

fn send_remote_event_to_all<'a>(
    senders: impl IntoIterator<Item = &'a mpsc::Sender<serde_json::Value>>,
    event: &serde_json::Value,
) -> Result<(), String> {
    let mut failed = false;
    for sender in senders {
        failed |= send_remote_event(sender, event).is_err();
    }
    if failed {
        Err("REMOTE_PUBLISH_FAILED".to_string())
    } else {
        Ok(())
    }
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
                let active = state.active_connections.fetch_add(1, Ordering::AcqRel);
                if active >= 4 {
                    state.active_connections.fetch_sub(1, Ordering::AcqRel);
                    bridge_log(&format!("reject: too many connections active={active}"));
                    continue;
                }
                bridge_log(&format!("accept active={active}"));
                let app = app.clone();
                let state = state.clone();
                thread::spawn(move || {
                    let result = handle_connection(stream, &app, &state, generation);
                    bridge_log(&format!("close: {result:?}"));
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

/// 接客套接字必须恢复成阻塞模式再设超时。
///
/// 监听 socket 为了轮询 accept 设了 `set_nonblocking(true)`，而 macOS/BSD 下
/// `accept()` 出来的连接**会继承**这个标志（Linux 不会）。不还原的话第一次读
/// 立刻返回 EAGAIN（os error 35），连接在手握前就被丢掉，手机端只看到一句
/// 「连接被断开」——2026-09-27 真机联调就是这么卡住的。
fn prepare_connection(stream: &TcpStream) -> Result<(), String> {
    stream
        .set_nonblocking(false)
        .map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|error| error.to_string())
}

/// 会话连接不能带读超时：手机可能几分钟不发一句话，
/// 留着 30 秒超时会被当成断线把连接关掉（2026-09-27 真机：手机连上 30 多秒后电脑就断开了）。
fn enter_session_mode(stream: &TcpStream) -> Result<(), String> {
    stream
        .set_read_timeout(None)
        .map_err(|error| error.to_string())
}

fn handle_connection(
    stream: TcpStream,
    app: &AppHandle,
    state: &RemoteBridgeState,
    generation: usize,
) -> Result<(), String> {
    handle_connection_with_dispatch(
        stream,
        Some(app),
        state,
        generation,
        |request, device_id| {
            let (sender, receiver) = mpsc::channel();
            state
                .pending_requests
                .lock()
                .map_err(lock_error)?
                .insert(request.request_id.clone(), sender);
            let response = (|| {
                app.emit(
                    "desktop-remote:request",
                    RemoteBridgeRequestEvent {
                        request_id: request.request_id.clone(),
                        message_type: request.message_type.clone(),
                        payload: request.payload.clone(),
                        device_id: device_id.to_string(),
                    },
                )
                .map_err(|error| error.to_string())?;
                receiver
                    .recv_timeout(Duration::from_secs(30))
                    .map_err(|_| "REMOTE_HOST_TIMEOUT".to_string())?
            })();
            state
                .pending_requests
                .lock()
                .map_err(lock_error)?
                .remove(&request.request_id);
            response
        },
    )
}

fn handle_connection_with_dispatch(
    mut stream: TcpStream,
    app: Option<&AppHandle>,
    state: &RemoteBridgeState,
    generation: usize,
    dispatch: impl Fn(&RemoteRequestFrame, &str) -> Result<serde_json::Value, String>,
) -> Result<(), String> {
    prepare_connection(&stream)?;
    let private_key = state.core.lock().map_err(lock_error)?.private_key();
    let (transport, client_public_key) = server_noise_handshake(&mut stream, &private_key)?;
    bridge_log("handshake ok");
    let transport = Arc::new(Mutex::new(transport));
    let auth = read_encrypted_json::<RemoteAuthFrame>(&mut stream, &transport)?;
    bridge_log(&format!(
        "auth kind={} device={}",
        auth.kind, auth.device_id
    ));
    let device_id = if auth.kind == "pair.request" {
        handle_pairing(
            &mut stream,
            &transport,
            app.ok_or_else(|| "PAIRING_UNAVAILABLE".to_string())?,
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

    // 认证之后才算会话：从这一刻起不能再有读超时。
    enter_session_mode(&stream)?;

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
            if let Err(error) = write_encrypted_json(&mut writer, &writer_transport, &value) {
                bridge_log(&format!("encrypted write failed: {error}"));
                let _ = writer.shutdown(Shutdown::Both);
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
        // attach 必须先登记订阅，再让 WebView 异步读取 Session；否则 read → subscribe 会丢事件。
        let previous_subscription = if request.message_type == "session.attach" {
            request
                .payload
                .get("sessionId")
                .and_then(|value| value.as_str())
                .filter(|id| !id.is_empty() && id.len() <= 200)
                .and_then(|session_id| {
                    state
                        .clients
                        .lock()
                        .ok()?
                        .get_mut(&connection_id)
                        .map(|client| {
                            std::mem::replace(&mut client.session_id, Some(session_id.to_string()))
                        })
                })
        } else {
            None
        };
        let response = dispatch(&request, &device_id);
        if request.message_type == "session.attach" && response.is_err() {
            if let Some(previous) = previous_subscription {
                if let Some(client) = state
                    .clients
                    .lock()
                    .map_err(lock_error)?
                    .get_mut(&connection_id)
                {
                    client.session_id = previous;
                }
            }
        }
        let response = match response {
            Ok(result) => {
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
            Err(error) => {
                serde_json::json!({ "version": 1, "requestId": request.request_id, "type": "response", "sentAt": now_ms(), "payload": { "error": error } })
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
    bridge_log(&format!("pairing offer claimed {offer_id}"));
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
    bridge_log("pairing decision received");
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
    let first = read_encrypted_frame(stream, transport)?;
    if first.len() != 8 || &first[..4] != CHUNK_HEADER {
        return Ok(first);
    }
    let total = u32::from_be_bytes(first[4..8].try_into().unwrap()) as usize;
    if !(CHUNK_BYTES + 1..=MAX_MESSAGE_BYTES).contains(&total) {
        return Err("INVALID_CHUNKED_MESSAGE".to_string());
    }
    // Idle sessions have no read timeout; one authenticated peer must not hold a slot forever mid-message.
    let previous_timeout = stream.read_timeout().map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|error| error.to_string())?;
    let result = (|| {
        let mut plain = Vec::with_capacity(total);
        while plain.len() < total {
            let chunk = read_encrypted_frame(stream, transport)?;
            if chunk.is_empty() || chunk.len() > CHUNK_BYTES || chunk.len() > total - plain.len() {
                return Err("INVALID_CHUNKED_MESSAGE".to_string());
            }
            plain.extend_from_slice(&chunk);
        }
        Ok(plain)
    })();
    stream
        .set_read_timeout(previous_timeout)
        .map_err(|error| error.to_string())?;
    result
}

fn read_encrypted_frame(
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
    if plain.len() > MAX_MESSAGE_BYTES {
        return Err("MESSAGE_TOO_LARGE".to_string());
    }
    if plain.len() > CHUNK_BYTES {
        let mut header = [0u8; 8];
        header[..4].copy_from_slice(CHUNK_HEADER);
        header[4..].copy_from_slice(&(plain.len() as u32).to_be_bytes());
        write_encrypted_frame(stream, transport, &header)?;
        for chunk in plain.chunks(CHUNK_BYTES) {
            write_encrypted_frame(stream, transport, chunk)?;
        }
        return Ok(());
    }
    write_encrypted_frame(stream, transport, &plain)
}

fn write_encrypted_frame(
    stream: &mut TcpStream,
    transport: &Arc<Mutex<TransportState>>,
    plain: &[u8],
) -> Result<(), String> {
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

#[cfg(debug_assertions)]
fn bridge_log(message: &str) {
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/jc-bridge.log")
    {
        let _ = writeln!(file, "{} {message}", now_ms());
    }
}

#[cfg(not(debug_assertions))]
fn bridge_log(_message: &str) {}

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
    fn publishing_to_a_closed_mobile_connection_is_an_error() {
        let (sender, receiver) = mpsc::channel();
        drop(receiver);
        assert_eq!(
            send_remote_event(&sender, &serde_json::json!({ "type": "session.event" }))
                .unwrap_err(),
            "REMOTE_PUBLISH_FAILED"
        );
    }

    #[test]
    fn a_closed_mobile_connection_does_not_block_other_subscribers() {
        let (closed_sender, closed_receiver) = mpsc::channel();
        drop(closed_receiver);
        let (healthy_sender, healthy_receiver) = mpsc::channel();
        let event = serde_json::json!({ "type": "session.event" });
        assert_eq!(
            send_remote_event_to_all([&closed_sender, &healthy_sender], &event).unwrap_err(),
            "REMOTE_PUBLISH_FAILED"
        );
        assert_eq!(healthy_receiver.try_recv().unwrap(), event);
    }

    #[test]
    fn session_mode_clears_the_read_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let client = thread::spawn(move || {
            let _stream = TcpStream::connect(address).unwrap();
            thread::sleep(Duration::from_millis(300));
        });
        let (stream, _) = listener.accept().unwrap();

        prepare_connection(&stream).unwrap();
        assert!(stream.read_timeout().unwrap().is_some());

        enter_session_mode(&stream).unwrap();
        assert_eq!(stream.read_timeout().unwrap(), None);
        let _ = client.join();
    }

    #[test]
    fn accepted_connections_are_blocking_again() {
        // macOS/BSD 的 accept() 会继承监听 socket 的非阻塞标志（Linux 不会）：
        // 不还原的话第一次读立刻 EAGAIN，连接在手握前就被丢掉（2026-09-27 真机问题）。
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let client = thread::spawn(move || {
            let _stream = TcpStream::connect(address).unwrap();
            thread::sleep(Duration::from_millis(500));
        });

        let (mut stream, _) = loop {
            match listener.accept() {
                Ok(pair) => break pair,
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(10))
                }
                Err(error) => panic!("accept failed: {error}"),
            }
        };
        prepare_connection(&stream).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_millis(300)))
            .unwrap();

        let started = std::time::Instant::now();
        let mut byte = [0_u8; 1];
        assert!(stream.read(&mut byte).is_err());
        let waited = started.elapsed();
        assert!(
            waited >= Duration::from_millis(200),
            "读只等了 {waited:?}，说明接客连接还是非阻塞的"
        );
        let _ = client.join();
    }

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
        // offer 里的地址会原样交给手机端 TcpStream::connect，必须保持裸 host:port。
        assert_eq!(offer.address, "192.168.1.2:9527");
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
            let large_request: serde_json::Value =
                read_encrypted_json(&mut stream, &transport).unwrap();
            assert_eq!(large_request["message"].as_str().unwrap().len(), 180_000);
            write_encrypted_json(
                &mut stream,
                &transport,
                &serde_json::json!({
                    "snapshot": "x".repeat(180_000)
                }),
            )
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
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
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
        write_encrypted_json(
            &mut stream,
            &transport,
            &serde_json::json!({
                "message": "y".repeat(180_000)
            }),
        )
        .unwrap();
        let large: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
        assert_eq!(large["snapshot"].as_str().unwrap().len(), 180_000);
        server_thread.join().unwrap();
    }

    #[test]
    fn fake_mobile_recovers_a_completed_run_over_the_authenticated_noise_gateway() {
        let state = RemoteBridgeState::default();
        state.generation.store(1, Ordering::Release);
        let mobile = noise_keypair();
        let desktop_public = {
            let mut core = state.core.lock().unwrap();
            core.authorize_device("iphone-1", "iPhone", "test-token", &mobile.public);
            core.public_key.clone()
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server_state = state.clone();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let publish_state = server_state.clone();
            handle_connection_with_dispatch(stream, None, &server_state, 1, move |request, device_id| {
                assert_eq!(device_id, "iphone-1");
                match request.message_type.as_str() {
                    "session.attach" if request.payload["sessionId"] != "jc-v1-a" => {
                        Err("SESSION_NOT_CURRENT".to_string())
                    }
                    "session.attach" => Ok(serde_json::json!({
                        "sessionId": "jc-v1-a", "gatewayEpoch": "test", "seq": 0,
                        "snapshot": { "sessionId": "jc-v1-a", "gatewayEpoch": "test", "seq": 0,
                            "turns": [{ "id": "old-1", "role": "assistant", "content": "x".repeat(180_000) }],
                            "run": { "state": "idle", "steps": [], "approval": null } }
                    })),
                    "message.send" => {
                        let sender = publish_state.clients.lock().unwrap().values().next().unwrap().sender.clone();
                        for (seq, phase) in [(1, "running"), (2, "done")] {
                            sender.send(serde_json::json!({
                                "version": 1, "requestId": format!("event-{seq}"), "type": "session.event",
                                "sentAt": now_ms(), "payload": { "sessionId": "jc-v1-a", "gatewayEpoch": "test",
                                    "seq": seq, "turns": [], "run": { "runId": "run-1", "state": phase,
                                        "steps": [{ "id": "tool-1", "label": "读取文件", "state": phase }], "approval": null } }
                            })).unwrap();
                        }
                        Ok(serde_json::json!({ "accepted": true, "runId": "run-1" }))
                    }
                    "session.read" => Ok(serde_json::json!({
                        "sessionId": "jc-v1-a", "gatewayEpoch": "test", "seq": 2,
                        "turns": [{ "id": "user-1", "role": "user", "content": "整理项目" }],
                        "run": { "runId": "run-1", "state": "done",
                            "steps": [{ "id": "tool-1", "label": "读取文件", "state": "done" }], "approval": null }
                    })),
                    _ => Err("UNSUPPORTED_MESSAGE".to_string()),
                }
            }).unwrap();
        });

        let params = NOISE_PATTERN.parse::<NoiseParams>().unwrap();
        let mut handshake = NoiseBuilder::new(params)
            .local_private_key(&mobile.private)
            .unwrap()
            .build_initiator()
            .unwrap();
        let mut stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut buffer = vec![0; 1024];
        let size = handshake.write_message(&[], &mut buffer).unwrap();
        write_frame(&mut stream, &buffer[..size]).unwrap();
        let second = read_frame(&mut stream, 1024).unwrap();
        handshake.read_message(&second, &mut buffer).unwrap();
        assert_eq!(
            handshake.get_remote_static(),
            Some(desktop_public.as_slice())
        );
        let size = handshake.write_message(&[], &mut buffer).unwrap();
        write_frame(&mut stream, &buffer[..size]).unwrap();
        let transport = Arc::new(Mutex::new(handshake.into_transport_mode().unwrap()));
        write_encrypted_json(
            &mut stream,
            &transport,
            &serde_json::json!({
                "type": "auth", "deviceId": "iphone-1", "token": "test-token"
            }),
        )
        .unwrap();
        let auth: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
        assert_eq!(auth["ok"], true);

        let request = |id: &str, kind: &str, payload: serde_json::Value| {
            serde_json::json!({
                "version": 1, "requestId": id, "type": kind, "sentAt": now_ms(), "payload": payload
            })
        };
        write_encrypted_json(
            &mut stream,
            &transport,
            &request(
                "bad-attach",
                "session.attach",
                serde_json::json!({ "sessionId": "jc-v1-other" }),
            ),
        )
        .unwrap();
        let rejected: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
        assert_eq!(rejected["payload"]["error"], "SESSION_NOT_CURRENT");
        assert_eq!(
            state
                .clients
                .lock()
                .unwrap()
                .values()
                .next()
                .unwrap()
                .session_id,
            None,
            "首次 attach 失败不能留下越权订阅",
        );
        write_encrypted_json(
            &mut stream,
            &transport,
            &request(
                "attach-1",
                "session.attach",
                serde_json::json!({ "sessionId": "jc-v1-a" }),
            ),
        )
        .unwrap();
        let attach: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
        assert_eq!(
            attach["payload"]["result"]["snapshot"]["run"]["state"],
            "idle"
        );
        assert_eq!(
            attach["payload"]["result"]["snapshot"]["turns"][0]["content"]
                .as_str()
                .unwrap()
                .len(),
            180_000
        );
        assert_eq!(
            state
                .clients
                .lock()
                .unwrap()
                .values()
                .next()
                .unwrap()
                .session_id
                .as_deref(),
            Some("jc-v1-a")
        );

        write_encrypted_json(&mut stream, &transport, &request("send-1", "message.send",
            serde_json::json!({ "sessionId": "jc-v1-a", "text": "整理项目", "commandId": "cmd-1" }))).unwrap();
        let frames: Vec<serde_json::Value> = (0..3)
            .map(|_| read_encrypted_json(&mut stream, &transport).unwrap())
            .collect();
        assert!(
            frames.iter().any(|frame| frame["type"] == "response"
                && frame["payload"]["result"]["runId"] == "run-1")
        );
        assert!(frames.iter().any(|frame| frame["type"] == "session.event"
            && frame["payload"]["run"]["state"] == "running"));
        assert!(
            frames.iter().any(|frame| frame["type"] == "session.event"
                && frame["payload"]["run"]["state"] == "done")
        );

        // 模拟手机丢掉过程事件后用权威快照恢复；纯工具轮没有 assistant 正文。
        write_encrypted_json(
            &mut stream,
            &transport,
            &request(
                "read-1",
                "session.read",
                serde_json::json!({ "sessionId": "jc-v1-a" }),
            ),
        )
        .unwrap();
        let recovered: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
        assert_eq!(recovered["payload"]["result"]["run"]["state"], "done");
        assert_eq!(
            recovered["payload"]["result"]["run"]["steps"][0]["label"],
            "读取文件"
        );
        stream.shutdown(Shutdown::Both).unwrap();
        server.join().unwrap();
    }
}
