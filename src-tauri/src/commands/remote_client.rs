//! 手机控制器侧：连接 Desktop 的局域网 Bridge。
//!
//! 与 `remote_bridge` 共用同一套线协议（Noise XX + 长度前缀帧 + 加密 JSON），但这里
//! 只做发起方：不监听端口、不生成 Desktop 身份、不持有 Desktop 私钥（合同 §3.2、§4）。
//!
//! 信任锚是二维码里带的 Desktop 静态公钥：握手中拿到不一致的静态公钥直接失败，之后
//! 每次重连都用配对时存下的那把公钥做校验。

use base64::{Engine as _, engine::general_purpose::STANDARD_NO_PAD};
use serde::{Deserialize, Serialize};
use snow::{Builder as NoiseBuilder, Keypair, TransportState, params::NoiseParams};
use std::collections::HashMap;
use std::net::{Shutdown, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use super::remote_relay::{self, RELAY_CANDIDATE, RelayTicket};
use super::remote_bridge::{
    MAX_FRAME_BYTES, NOISE_PATTERN, lock_error, noise_keypair, now_ms, read_encrypted,
    read_encrypted_json, read_frame, write_encrypted_json, write_frame,
};

const TRANSPORT_TIMEOUT: Duration = Duration::from_secs(30);
/// 单个候选地址的 TCP 建连上限。系统默认要等一分多钟，旧 IP 失效时会把后面的候选全拖死。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);
/// Desktop 上的配对要等本机用户点「允许」，服务端给了 300 秒，这里留一点余量。
const PAIRING_APPROVAL_TIMEOUT: Duration = Duration::from_secs(330);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// 手机只会发出的请求类型。Desktop 侧的白名单是同一份清单，两边都拦一次。
const MOBILE_REQUEST_TYPES: &[&str] = &[
    "gateway.health",
    "context.get",
    "session.read",
    "session.attach",
    "session.subscribe",
    "project.list",
    "session.list",
    "session.create",
    "session.mode.set",
    "file.list",
    "file.read",
    "message.send",
    "run.stop",
    "approval.respond",
    "ping",
];

pub const MOBILE_EVENT_NAME: &str = "mobile-remote:event";
pub const MOBILE_CLOSED_EVENT_NAME: &str = "mobile-remote:closed";

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MobileRemoteStatus {
    paired: bool,
    connected: bool,
    device_id: Option<String>,
    address: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDeviceIdentity {
    device_id: String,
    private_key: String,
    public_key: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCredential {
    device_id: String,
    token: String,
    desktop_public_key: String,
    /// 上次连上的地址，重连时最先尝试。
    address: String,
    /// Desktop 认证时报上的全部地址（IP + Bonjour 名）。信任只认公钥，地址只是去哪找它。
    #[serde(default)]
    addresses: Vec<String>,
    /// 电脑的中继房间（M3b）：局域网地址都不通时经它连回去。
    #[serde(default)]
    relay: Option<RelayTicket>,
}

type EventCallback = Arc<dyn Fn(serde_json::Value) + Send + Sync>;
type ClosedCallback = Arc<dyn Fn() + Send + Sync>;

/// 一个已认证的 Desktop 连接。读由独立线程负责，写必须经 `stream` 锁，
/// 否则两个并发请求的帧会互相插进对方里面。
struct DesktopSession {
    address: String,
    /// 本次认证时 Desktop 报上的地址清单，连上后写回凭证。
    advertised: Vec<String>,
    /// 本次认证时 Desktop 报上的中继房间，连上后写回凭证。
    relay: Option<RelayTicket>,
    device_id: String,
    stream: Mutex<TcpStream>,
    transport: Arc<Mutex<TransportState>>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<Result<serde_json::Value, String>>>>>,
    /// 读线程退出（手机切后台、电脑关了、网断了）时置位。
    /// 状态必须立刻反映它，否则界面会一直说「已连接」，用户连重连按钮都看不到。
    closed: Arc<AtomicBool>,
}

impl DesktopSession {
    fn is_live(&self) -> bool {
        !self.closed.load(Ordering::Acquire)
    }

    fn send(&self, value: &serde_json::Value) -> Result<(), String> {
        let mut stream = self.stream.lock().map_err(lock_error)?;
        write_encrypted_json(&mut stream, &self.transport, value)
    }

    fn request(
        &self,
        request_id: &str,
        message_type: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        if !MOBILE_REQUEST_TYPES.contains(&message_type) {
            return Err("UNSUPPORTED_MESSAGE".to_string());
        }
        if request_id.is_empty()
            || request_id.len() > 128
            || !request_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err("INVALID_REQUEST_ID".to_string());
        }
        let envelope = serde_json::json!({
            "version": 1,
            "requestId": request_id,
            "type": message_type,
            "sentAt": now_ms(),
            "payload": payload,
        });
        let (sender, receiver) = mpsc::channel();
        self.pending
            .lock()
            .map_err(lock_error)?
            .insert(request_id.to_string(), sender);
        if let Err(error) = self.send(&envelope) {
            self.pending.lock().map_err(lock_error)?.remove(request_id);
            return Err(error);
        }
        let outcome = receiver
            .recv_timeout(REQUEST_TIMEOUT)
            .unwrap_or_else(|_| Err("REMOTE_HOST_TIMEOUT".to_string()));
        if outcome.is_err() {
            self.pending.lock().map_err(lock_error)?.remove(request_id);
        }
        outcome
    }

    fn close(&self) {
        if let Ok(stream) = self.stream.lock() {
            let _ = stream.shutdown(Shutdown::Both);
        }
    }
}

#[derive(Default)]
pub struct MobileRemoteState {
    session: Mutex<Option<Arc<DesktopSession>>>,
}

fn decode_key(value: &str) -> Option<Vec<u8>> {
    let bytes = STANDARD_NO_PAD.decode(value.trim()).ok()?;
    (bytes.len() == 32).then_some(bytes)
}

/// 设备身份在第一次需要时创建并立刻入钥匙串：即使配对被拒也不能换一把钥茶，
/// 否则 Desktop 已记录的公钥会和手机后面拿出的公钥对不上。
fn load_or_create_identity() -> Result<(StoredDeviceIdentity, Keypair), String> {
    if let Some(value) = crate::secure_store::get_mobile_remote_identity()?
        && let Ok(stored) = serde_json::from_str::<StoredDeviceIdentity>(&value)
        && let (Some(private), Some(public)) = (
            decode_key(&stored.private_key),
            decode_key(&stored.public_key),
        )
    {
        return Ok((stored, Keypair { private, public }));
    }
    let keypair = noise_keypair();
    let stored = StoredDeviceIdentity {
        device_id: Uuid::new_v4().to_string(),
        private_key: STANDARD_NO_PAD.encode(&keypair.private),
        public_key: STANDARD_NO_PAD.encode(&keypair.public),
    };
    let serialized = serde_json::to_string(&stored).map_err(|error| error.to_string())?;
    crate::secure_store::set_mobile_remote_identity(&serialized)?;
    Ok((stored, keypair))
}

fn read_credential() -> Result<Option<StoredCredential>, String> {
    match crate::secure_store::get_mobile_remote_credential()? {
        Some(value) => Ok(serde_json::from_str(&value).ok()),
        None => Ok(None),
    }
}

/// 手机端只接受裸 host:port；地址来自电脑发来的一次性 offer（不可信输入），
/// 带 scheme 或其他写法都当成非法，避免直接丢给 getaddrinfo 变成看不懂的系统错误。
fn socket_address(raw: &str) -> &str {
    raw.trim().strip_prefix("tcp://").unwrap_or(raw.trim())
}

/// 完成 Noise XX 发起方握手，并校验对端就是二维码里那把静态公钥。
fn open_encrypted(
    address: &str,
    relay: Option<&RelayTicket>,
    identity: &Keypair,
    desktop_public_key: &[u8],
) -> Result<(TcpStream, TransportState), String> {
    let params = NOISE_PATTERN
        .parse::<NoiseParams>()
        .map_err(|error| error.to_string())?;
    let mut handshake = NoiseBuilder::new(params)
        .local_private_key(&identity.private)
        .map_err(|error| error.to_string())?
        .build_initiator()
        .map_err(|error| error.to_string())?;
    // 中继只换传输：下面的 Noise 握手与公钥校验照旧，中继看不到明文。
    let mut stream = if address == RELAY_CANDIDATE {
        remote_relay::connect_mobile(relay.ok_or_else(|| "RELAY_TICKET_MISSING".to_string())?)?
    } else {
        connect_tcp(socket_address(address))?
    };
    stream
        .set_read_timeout(Some(TRANSPORT_TIMEOUT))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(TRANSPORT_TIMEOUT))
        .map_err(|error| error.to_string())?;

    let mut buffer = vec![0; 1024];
    let size = handshake
        .write_message(&[], &mut buffer)
        .map_err(|error| error.to_string())?;
    write_frame(&mut stream, &buffer[..size])?;
    let second = read_frame(&mut stream, 1024)?;
    handshake
        .read_message(&second, &mut buffer)
        .map_err(|error| error.to_string())?;
    match handshake.get_remote_static() {
        Some(key) if key == desktop_public_key => {}
        _ => return Err("DESKTOP_KEY_MISMATCH".to_string()),
    }
    let size = handshake
        .write_message(&[], &mut buffer)
        .map_err(|error| error.to_string())?;
    write_frame(&mut stream, &buffer[..size])?;
    let transport = handshake
        .into_transport_mode()
        .map_err(|error| error.to_string())?;
    Ok((stream, transport))
}

fn connect_tcp(address: &str) -> Result<TcpStream, String> {
    use std::net::ToSocketAddrs;
    let mut last_error = "PAIRING_ADDRESS_INVALID".to_string();
    for target in address
        .to_socket_addrs()
        .map_err(|error| error.to_string())?
    {
        match TcpStream::connect_timeout(&target, CONNECT_TIMEOUT) {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(last_error)
}

/// 重连先试上次成功的地址，再试 Desktop 报过的其余地址；用户手填的地址只试那一个。
fn candidate_addresses(credential: &StoredCredential, explicit: Option<&str>) -> Vec<String> {
    if let Some(address) = explicit.map(str::trim).filter(|value| !value.is_empty()) {
        // 手填的 Tailscale 地址或主机名常不写端口：沿用配对时电脑的端口。
        if address.contains(':') {
            return vec![address.to_string()];
        }
        let port = credential
            .address
            .rsplit_once(':')
            .map(|(_, port)| port)
            .unwrap_or_default();
        return vec![if port.is_empty() {
            address.to_string()
        } else {
            format!("{address}:{port}")
        }];
    }
    let mut candidates: Vec<String> = Vec::new();
    let relay = credential.relay.as_ref().map(|_| RELAY_CANDIDATE.to_string());
    for address in std::iter::once(&credential.address)
        .chain(&credential.addresses)
        .chain(&relay)
    {
        let address = address.trim();
        if !address.is_empty() && !candidates.iter().any(|known| known == address) {
            candidates.push(address.to_string());
        }
    }
    // 没有中继票据时不能把上次成功的「relay」当地址去连。
    if credential.relay.is_none() {
        candidates.retain(|address| address != RELAY_CANDIDATE);
    }
    candidates
}

/// 逐个候选地址连接，任何一个都必须通过配对时那把 Desktop 公钥的校验。
/// 公钥不符的错误优先上报：它说明找到的是另一台电脑，而不是网络不通。
fn connect_first(
    candidates: &[String],
    credential: &StoredCredential,
    keypair: &Keypair,
    on_event: EventCallback,
    on_closed: ClosedCallback,
) -> Result<Arc<DesktopSession>, String> {
    let mut failure: Option<String> = None;
    for address in candidates {
        let event = Arc::clone(&on_event);
        let closed = Arc::clone(&on_closed);
        match connect_session(
            address,
            credential,
            keypair,
            Box::new(move |value| event(value)),
            Box::new(move || closed()),
        ) {
            Ok(session) => return Ok(session),
            Err(error) => {
                if failure.as_deref() != Some("DESKTOP_KEY_MISMATCH") {
                    failure = Some(error);
                }
            }
        }
    }
    Err(failure.unwrap_or_else(|| "PAIRING_ADDRESS_INVALID".to_string()))
}

#[cfg(test)]
fn pair_with_desktop(
    address: &str,
    offer_id: &str,
    desktop_public_key: &[u8],
    device_name: &str,
    identity: &StoredDeviceIdentity,
    keypair: &Keypair,
) -> Result<StoredCredential, String> {
    pair_first(
        &[address.to_string()],
        None,
        offer_id,
        desktop_public_key,
        device_name,
        identity,
        keypair,
    )
}

/// 依次尝试候选地址，用**第一个完成 Noise 握手**的那条去配对。握手之后不再换地址：
/// 电脑那边已经在等用户点允许，再从另一条路发一次会变成第二个配对请求。
fn pair_first(
    candidates: &[String],
    relay: Option<&RelayTicket>,
    offer_id: &str,
    desktop_public_key: &[u8],
    device_name: &str,
    identity: &StoredDeviceIdentity,
    keypair: &Keypair,
) -> Result<StoredCredential, String> {
    let mut failure = "PAIRING_ADDRESS_INVALID".to_string();
    for address in candidates {
        match open_encrypted(address, relay, keypair, desktop_public_key) {
            Ok((stream, transport)) => {
                return pair_over(
                    stream,
                    transport,
                    address,
                    relay,
                    offer_id,
                    desktop_public_key,
                    device_name,
                    identity,
                );
            }
            Err(error) if error == "DESKTOP_KEY_MISMATCH" => return Err(error),
            Err(error) => failure = error,
        }
    }
    Err(failure)
}

#[allow(clippy::too_many_arguments)]
fn pair_over(
    mut stream: TcpStream,
    transport: TransportState,
    address: &str,
    relay: Option<&RelayTicket>,
    offer_id: &str,
    desktop_public_key: &[u8],
    device_name: &str,
    identity: &StoredDeviceIdentity,
) -> Result<StoredCredential, String> {
    let transport = Arc::new(Mutex::new(transport));
    write_encrypted_json(
        &mut stream,
        &transport,
        &serde_json::json!({
            "type": "pair.request",
            "offerId": offer_id,
            "deviceId": identity.device_id,
            "name": device_name,
        }),
    )?;
    stream
        .set_read_timeout(Some(PAIRING_APPROVAL_TIMEOUT))
        .map_err(|error| error.to_string())?;
    let response: serde_json::Value = read_encrypted_json(&mut stream, &transport)?;
    let _ = stream.shutdown(Shutdown::Both);

    if response.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return Err(response
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("PAIRING_REJECTED")
            .to_string());
    }
    let token = response
        .get("token")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "PAIRING_TOKEN_MISSING".to_string())?;
    Ok(StoredCredential {
        device_id: identity.device_id.clone(),
        token: token.to_string(),
        desktop_public_key: STANDARD_NO_PAD.encode(desktop_public_key),
        address: address.to_string(),
        addresses: Vec::new(),
        relay: relay.cloned(),
    })
}

fn connect_session(
    address: &str,
    credential: &StoredCredential,
    keypair: &Keypair,
    on_event: Box<dyn Fn(serde_json::Value) + Send>,
    on_closed: Box<dyn Fn() + Send>,
) -> Result<Arc<DesktopSession>, String> {
    let desktop_public_key = decode_key(&credential.desktop_public_key)
        .ok_or_else(|| "DESKTOP_KEY_INVALID".to_string())?;
    let (mut stream, transport) = open_encrypted(
        address,
        credential.relay.as_ref(),
        keypair,
        &desktop_public_key,
    )?;
    let transport = Arc::new(Mutex::new(transport));
    write_encrypted_json(
        &mut stream,
        &transport,
        &serde_json::json!({
            "type": "auth",
            "deviceId": credential.device_id,
            "token": credential.token,
        }),
    )?;
    let response: serde_json::Value = read_encrypted_json(&mut stream, &transport)?;
    if response.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return Err("AUTH_INVALID".to_string());
    }
    let advertised = response
        .get("addresses")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .filter(|item| !item.is_empty() && item.len() <= 256)
                .take(8)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let relay = response
        .get("relay")
        .and_then(|value| serde_json::from_value::<RelayTicket>(value.clone()).ok())
        .filter(RelayTicket::is_valid);
    // 认证之后这是一条长期连接：留着读超时会把空闲连接读死。
    stream
        .set_read_timeout(None)
        .map_err(|error| error.to_string())?;
    let reader_stream = stream.try_clone().map_err(|error| error.to_string())?;
    let pending = Arc::new(Mutex::new(HashMap::new()));
    let closed = Arc::new(AtomicBool::new(false));
    spawn_reader(
        reader_stream,
        Arc::clone(&transport),
        Arc::clone(&pending),
        Arc::clone(&closed),
        on_event,
        on_closed,
    );
    Ok(Arc::new(DesktopSession {
        address: address.to_string(),
        advertised,
        relay,
        device_id: credential.device_id.clone(),
        stream: Mutex::new(stream),
        transport,
        pending,
        closed,
    }))
}

fn spawn_reader(
    mut stream: TcpStream,
    transport: Arc<Mutex<TransportState>>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<Result<serde_json::Value, String>>>>>,
    closed: Arc<AtomicBool>,
    on_event: Box<dyn Fn(serde_json::Value) + Send>,
    on_closed: Box<dyn Fn() + Send>,
) {
    thread::spawn(move || {
        while let Ok(frame) = read_encrypted(&mut stream, &transport) {
            let Ok(value) = serde_json::from_slice::<serde_json::Value>(&frame) else {
                continue;
            };
            match value
                .get("type")
                .and_then(|kind| kind.as_str())
                .unwrap_or_default()
            {
                "response" => {
                    let request_id = value
                        .get("requestId")
                        .and_then(|id| id.as_str())
                        .unwrap_or_default();
                    let payload = value
                        .get("payload")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);
                    let outcome = match payload.get("error").and_then(|error| error.as_str()) {
                        Some(error) => Err(error.to_string()),
                        None => Ok(payload
                            .get("result")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null)),
                    };
                    if let Ok(mut map) = pending.lock()
                        && let Some(sender) = map.remove(request_id)
                    {
                        let _ = sender.send(outcome);
                    }
                }
                // 保活回应没有业务含义，不交给界面。
                "pong" => {}
                _ => on_event(value),
            }
        }
        // 连接结束：唤醒所有等待者，先标死再通知界面（合同 §10.7）。
        closed.store(true, Ordering::Release);
        if let Ok(mut map) = pending.lock() {
            for (_, sender) in map.drain() {
                let _ = sender.send(Err("REMOTE_CONNECTION_CLOSED".to_string()));
            }
        }
        on_closed();
    });
}

/// 只认还活着的连接：断掉的会话必须立刻从状态里消失，否则界面一直说「已连接」，
/// 用户既看不到真相也找不到重连入口。
fn live_session(state: &MobileRemoteState) -> Option<Arc<DesktopSession>> {
    state
        .session
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(Arc::clone))
        .filter(|session| session.is_live())
}

fn status_of(
    state: &MobileRemoteState,
    credential: Option<&StoredCredential>,
) -> MobileRemoteStatus {
    let session = live_session(state);
    MobileRemoteStatus {
        paired: credential.is_some(),
        connected: session.is_some(),
        device_id: credential.map(|item| item.device_id.clone()),
        address: session
            .map(|item| item.address.clone())
            .or_else(|| credential.map(|item| item.address.clone())),
    }
}

#[tauri::command]
pub fn mobile_remote_status(
    state: State<'_, MobileRemoteState>,
) -> Result<MobileRemoteStatus, String> {
    Ok(status_of(&state, read_credential()?.as_ref()))
}

#[tauri::command]
pub async fn mobile_remote_pair(
    state: State<'_, MobileRemoteState>,
    address: String,
    offer_id: String,
    desktop_public_key: String,
    device_name: String,
    relay: Option<RelayTicket>,
) -> Result<MobileRemoteStatus, String> {
    let target = address.trim().to_string();
    let relay = relay.filter(RelayTicket::is_valid);
    if target.is_empty() || target.len() > 256 {
        return Err("PAIRING_ADDRESS_INVALID".to_string());
    }
    let name = device_name.trim().to_string();
    if name.is_empty() || name.len() > 128 {
        return Err("PAIRING_DEVICE_INVALID".to_string());
    }
    let public_key =
        decode_key(&desktop_public_key).ok_or_else(|| "DESKTOP_KEY_INVALID".to_string())?;
    let offer = offer_id.trim().to_string();
    if offer.is_empty() {
        return Err("PAIRING_OFFER_INVALID".to_string());
    }

    // 这一等可能要接近 5 分钟（用户要在 Desktop 上点允许），不能占着 IPC 线程。
    let credential = tokio::task::spawn_blocking(move || {
        let (identity, keypair) = load_or_create_identity()?;
        // 先走二维码里的局域网地址，不通再经中继（手机与电脑不在同一网络时）。
        let mut candidates = vec![target];
        if relay.is_some() {
            candidates.push(RELAY_CANDIDATE.to_string());
        }
        pair_first(
            &candidates,
            relay.as_ref(),
            &offer,
            &public_key,
            &name,
            &identity,
            &keypair,
        )
    })
    .await
    .map_err(|error| error.to_string())??;

    let serialized = serde_json::to_string(&credential).map_err(|error| error.to_string())?;
    crate::secure_store::set_mobile_remote_credential(&serialized)?;
    // 重新配对意味着旧连接作废。
    if let Some(session) = state.session.lock().map_err(lock_error)?.take() {
        session.close();
    }
    Ok(status_of(&state, Some(&credential)))
}

#[tauri::command]
pub async fn mobile_remote_connect(
    app: AppHandle,
    state: State<'_, MobileRemoteState>,
    address: Option<String>,
) -> Result<MobileRemoteStatus, String> {
    let credential = read_credential()?.ok_or_else(|| "PAIRING_REQUIRED".to_string())?;
    let candidates = candidate_addresses(&credential, address.as_deref());
    if candidates.is_empty() {
        return Err("PAIRING_ADDRESS_INVALID".to_string());
    }
    let (_, keypair) = load_or_create_identity()?;
    let connecting: StoredCredential = credential.clone();

    let session = tokio::task::spawn_blocking(move || {
        let event_app = app.clone();
        let closed_app = app.clone();
        connect_first(
            &candidates,
            &connecting,
            &keypair,
            Arc::new(move |value| {
                let _ = event_app.emit(MOBILE_EVENT_NAME, value);
            }),
            Arc::new(move || {
                let _ = closed_app.emit(MOBILE_CLOSED_EVENT_NAME, ());
            }),
        )
    })
    .await
    .map_err(|error| error.to_string())??;
    let target = session.address.clone();
    let advertised = session.advertised.clone();
    let relay = session.relay.clone().or_else(|| credential.relay.clone());

    let mut guard = state.session.lock().map_err(lock_error)?;
    if let Some(previous) = guard.take() {
        previous.close();
    }
    *guard = Some(session);
    drop(guard);

    let addresses = if advertised.is_empty() {
        credential.addresses.clone()
    } else {
        advertised
    };
    if credential.address != target || credential.addresses != addresses || credential.relay != relay {
        let updated = StoredCredential {
            address: target.clone(),
            addresses,
            relay,
            ..credential.clone()
        };
        let serialized = serde_json::to_string(&updated).map_err(|error| error.to_string())?;
        crate::secure_store::set_mobile_remote_credential(&serialized)?;
    }
    Ok(status_of(&state, Some(&credential)))
}

#[tauri::command]
pub async fn mobile_remote_request(
    state: State<'_, MobileRemoteState>,
    request_id: String,
    message_type: String,
    payload: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let session = live_session(&state).ok_or_else(|| "REMOTE_NOT_CONNECTED".to_string())?;
    let body = payload.unwrap_or_else(|| serde_json::json!({}));
    tokio::task::spawn_blocking(move || session.request(&request_id, &message_type, body))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn mobile_remote_disconnect(
    state: State<'_, MobileRemoteState>,
) -> Result<MobileRemoteStatus, String> {
    if let Some(session) = state.session.lock().map_err(lock_error)?.take() {
        session.close();
    }
    Ok(status_of(&state, read_credential()?.as_ref()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::remote_bridge::server_noise_handshake;
    use std::net::TcpListener;

    const TOKEN: &str = "device-token-1";

    #[test]
    fn socket_address_normalizes_whatever_the_desktop_puts_in_the_offer() {
        assert_eq!(socket_address("192.168.1.16:61997"), "192.168.1.16:61997");
        assert_eq!(socket_address(" 192.168.1.16:61997 "), "192.168.1.16:61997");
        // 电脑端曾把展示用的 tcp:// 前缀写进 offer，手机端直接 connect 会报
        // getaddrinfo "nodename nor servname provided"。
        assert_eq!(
            socket_address("tcp://192.168.1.16:61997"),
            "192.168.1.16:61997"
        );
    }

    /// 测试全程不碰系统钥匙串：设备身份与凭证都由调用方注入。
    fn device_identity() -> (StoredDeviceIdentity, Keypair) {
        let keypair = noise_keypair();
        let identity = StoredDeviceIdentity {
            device_id: "iphone-1".to_string(),
            private_key: STANDARD_NO_PAD.encode(&keypair.private),
            public_key: STANDARD_NO_PAD.encode(&keypair.public),
        };
        (identity, keypair)
    }

    fn desktop_listener() -> (TcpListener, String, Keypair) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap().to_string();
        (listener, address, noise_keypair())
    }

    /// 假 Desktop 的入口：真实 TCP + 真实 Noise 握手，只用服务端那半边代码。
    fn accept_encrypted(
        listener: &TcpListener,
        private_key: &[u8],
    ) -> (TcpStream, Arc<Mutex<TransportState>>) {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let (transport, mobile_public_key) =
            server_noise_handshake(&mut stream, private_key).unwrap();
        assert_eq!(mobile_public_key.len(), 32);
        (stream, Arc::new(Mutex::new(transport)))
    }

    fn credential(address: &str, desktop_public_key: &[u8]) -> StoredCredential {
        StoredCredential {
            device_id: "iphone-1".to_string(),
            token: TOKEN.to_string(),
            desktop_public_key: STANDARD_NO_PAD.encode(desktop_public_key),
            address: address.to_string(),
            addresses: Vec::new(),
            relay: None,
        }
    }

    fn connect(
        address: &str,
        credential: &StoredCredential,
        keypair: &Keypair,
        events: mpsc::Sender<serde_json::Value>,
        closed: mpsc::Sender<()>,
    ) -> Result<Arc<DesktopSession>, String> {
        connect_session(
            address,
            credential,
            keypair,
            Box::new(move |value| {
                let _ = events.send(value);
            }),
            Box::new(move || {
                let _ = closed.send(());
            }),
        )
    }

    #[test]
    fn a_dropped_connection_stops_reporting_connected() {
        let (listener, address, server) = desktop_listener();
        let private = server.private.clone();
        let (release, release_rx) = mpsc::channel::<()>();
        let desktop = thread::spawn(move || {
            let (mut stream, transport) = accept_encrypted(&listener, &private);
            let _auth: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
            write_encrypted_json(&mut stream, &transport, &serde_json::json!({ "ok": true }))
                .unwrap();
            let _ = release_rx.recv_timeout(Duration::from_secs(5));
            // 手机切到别的 App / 电脑关了：连接就这么没了。
            drop(stream);
        });

        let (_, keypair) = device_identity();
        let cred = credential(&address, &server.public);
        let (events, _inbox) = mpsc::channel();
        let (closed, closed_rx) = mpsc::channel();
        let session = connect(&address, &cred, &keypair, events, closed).unwrap();

        let state = MobileRemoteState::default();
        *state.session.lock().unwrap() = Some(session);
        assert!(status_of(&state, Some(&cred)).connected);

        release.send(()).unwrap();
        closed_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("读线程应当发现连接断开");
        assert!(
            !status_of(&state, Some(&cred)).connected,
            "连接已经断了，状态不能继续说已连接"
        );
        desktop.join().unwrap();
    }

    #[test]
    fn pairing_claims_the_offer_and_returns_the_desktop_credential() {
        let (listener, address, server) = desktop_listener();
        let private = server.private.clone();
        let desktop = thread::spawn(move || {
            let (mut stream, transport) = accept_encrypted(&listener, &private);
            let request: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
            assert_eq!(request["type"], "pair.request");
            assert_eq!(request["offerId"], "offer-1");
            assert_eq!(request["deviceId"], "iphone-1");
            assert_eq!(request["name"], "iPhone");
            write_encrypted_json(
                &mut stream,
                &transport,
                &serde_json::json!({ "ok": true, "deviceId": "iphone-1", "token": TOKEN }),
            )
            .unwrap();
        });

        let (identity, keypair) = device_identity();
        let paired = pair_with_desktop(
            &address,
            "offer-1",
            &server.public,
            "iPhone",
            &identity,
            &keypair,
        )
        .unwrap();

        assert_eq!(paired.device_id, "iphone-1");
        assert_eq!(paired.token, TOKEN);
        assert_eq!(paired.address, address);
        assert_eq!(
            paired.desktop_public_key,
            STANDARD_NO_PAD.encode(&server.public)
        );
        desktop.join().unwrap();
    }

    #[test]
    fn pairing_rejection_surfaces_the_desktop_error_code() {
        let (listener, address, server) = desktop_listener();
        let private = server.private.clone();
        let desktop = thread::spawn(move || {
            let (mut stream, transport) = accept_encrypted(&listener, &private);
            let _: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
            write_encrypted_json(
                &mut stream,
                &transport,
                &serde_json::json!({ "ok": false, "error": "PAIRING_REJECTED" }),
            )
            .unwrap();
        });

        let (identity, keypair) = device_identity();
        let Err(error) = pair_with_desktop(
            &address,
            "offer-1",
            &server.public,
            "iPhone",
            &identity,
            &keypair,
        ) else {
            panic!("Desktop 拒绝时不能拿到凭证");
        };

        assert_eq!(error, "PAIRING_REJECTED");
        desktop.join().unwrap();
    }

    #[test]
    fn connect_refuses_a_desktop_that_cannot_prove_the_scanned_static_key() {
        let (listener, address, server) = desktop_listener();
        let private = server.private.clone();
        let desktop = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            // 客户端在第三条握手消息前就会中止，这里允许失败。
            let _ = server_noise_handshake(&mut stream, &private);
        });

        let (_, keypair) = device_identity();
        let other_desktop = noise_keypair();
        let (events, _event_rx) = mpsc::channel();
        let (closed, _closed_rx) = mpsc::channel();
        let Err(error) = connect(
            &address,
            &credential(&address, &other_desktop.public),
            &keypair,
            events,
            closed,
        ) else {
            panic!("对端拿不出二维码里那把公钥时必须失败");
        };

        assert_eq!(error, "DESKTOP_KEY_MISMATCH");
        desktop.join().unwrap();
    }

    #[test]
    fn authenticated_session_carries_requests_events_and_desktop_errors() {
        let (listener, address, server) = desktop_listener();
        let private = server.private.clone();
        let desktop = thread::spawn(move || {
            let (mut stream, transport) = accept_encrypted(&listener, &private);
            let auth: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
            assert_eq!(auth["type"], "auth");
            assert_eq!(auth["deviceId"], "iphone-1");
            assert_eq!(auth["token"], TOKEN);
            write_encrypted_json(&mut stream, &transport, &serde_json::json!({ "ok": true }))
                .unwrap();

            let request: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
            assert_eq!(request["version"], 1);
            assert_eq!(request["type"], "session.read");
            assert_eq!(request["payload"]["sessionId"], "jc-v1-a");
            write_encrypted_json(
                &mut stream,
                &transport,
                &serde_json::json!({
                    "version": 1, "requestId": request["requestId"], "type": "response", "sentAt": 0,
                    "payload": { "result": { "turns": [{ "id": "t1" }] } },
                }),
            )
            .unwrap();

            let failing: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
            write_encrypted_json(
                &mut stream,
                &transport,
                &serde_json::json!({
                    "version": 1, "requestId": failing["requestId"], "type": "response", "sentAt": 0,
                    "payload": { "error": "SESSION_NOT_CURRENT" },
                }),
            )
            .unwrap();

            write_encrypted_json(
                &mut stream,
                &transport,
                &serde_json::json!({
                    "version": 1, "requestId": "event-1", "type": "session.event", "sentAt": 0,
                    "payload": { "sessionId": "jc-v1-a", "seq": 1, "turns": [] },
                }),
            )
            .unwrap();
            let _ = stream.shutdown(Shutdown::Both);
        });

        let (_, keypair) = device_identity();
        let (events, event_rx) = mpsc::channel();
        let (closed, closed_rx) = mpsc::channel();
        let session = connect(
            &address,
            &credential(&address, &server.public),
            &keypair,
            events,
            closed,
        )
        .unwrap();

        assert_eq!(
            session
                .request(
                    "req-1",
                    "session.read",
                    serde_json::json!({ "sessionId": "jc-v1-a" })
                )
                .unwrap(),
            serde_json::json!({ "turns": [{ "id": "t1" }] })
        );
        assert_eq!(
            session
                .request("req-2", "context.get", serde_json::json!({}))
                .unwrap_err(),
            "SESSION_NOT_CURRENT"
        );
        assert_eq!(
            event_rx.recv_timeout(Duration::from_secs(5)).unwrap()["type"],
            "session.event"
        );
        closed_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        desktop.join().unwrap();
    }

    #[test]
    fn requests_the_mobile_never_sends_are_rejected_before_hitting_the_socket() {
        let (listener, address, server) = desktop_listener();
        let private = server.private.clone();
        let desktop = thread::spawn(move || {
            let (mut stream, transport) = accept_encrypted(&listener, &private);
            let _: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
            write_encrypted_json(&mut stream, &transport, &serde_json::json!({ "ok": true }))
                .unwrap();
            // 客户端不应该再发任何业务帧：一直读到连接关闭。
            while read_encrypted(&mut stream, &transport).is_ok() {}
        });

        let (_, keypair) = device_identity();
        let (events, _event_rx) = mpsc::channel();
        let (closed, _closed_rx) = mpsc::channel();
        let session = connect(
            &address,
            &credential(&address, &server.public),
            &keypair,
            events,
            closed,
        )
        .unwrap();

        assert_eq!(
            session
                .request("req-1", "remote_bridge_start", serde_json::json!({}))
                .unwrap_err(),
            "UNSUPPORTED_MESSAGE"
        );
        assert_eq!(
            session
                .request("../secret", "context.get", serde_json::json!({}))
                .unwrap_err(),
            "INVALID_REQUEST_ID"
        );
        session.close();
        desktop.join().unwrap();
    }

    #[test]
    fn a_dropped_connection_wakes_pending_requests_instead_of_hanging() {
        let (listener, address, server) = desktop_listener();
        let private = server.private.clone();
        let desktop = thread::spawn(move || {
            let (mut stream, transport) = accept_encrypted(&listener, &private);
            let _: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
            write_encrypted_json(&mut stream, &transport, &serde_json::json!({ "ok": true }))
                .unwrap();
            // 收到请求后不回答案，直接断开。
            let _: serde_json::Value = read_encrypted_json(&mut stream, &transport).unwrap();
        });

        let (_, keypair) = device_identity();
        let (events, _event_rx) = mpsc::channel();
        let (closed, _closed_rx) = mpsc::channel();
        let session = connect(
            &address,
            &credential(&address, &server.public),
            &keypair,
            events,
            closed,
        )
        .unwrap();

        assert_eq!(
            session
                .request("req-1", "context.get", serde_json::json!({}))
                .unwrap_err(),
            "REMOTE_CONNECTION_CLOSED"
        );
        desktop.join().unwrap();
    }

    /// 两边的白名单是同一份清单，改一边忘另一边会在这里断。
    #[test]
    fn mobile_request_types_stay_inside_the_desktop_whitelist() {
        let bridge = std::fs::read_to_string("src/commands/remote_bridge.rs").unwrap();

        for message_type in MOBILE_REQUEST_TYPES {
            assert!(
                bridge.contains(&format!("\"{message_type}\"")),
                "{message_type} 不在 Desktop 白名单里"
            );
        }
    }

    /// M2 任选对话：列项目、列对话、新建对话三种请求手机能发出。
    #[test]
    fn mobile_can_browse_and_create_conversations() {
        for message_type in ["project.list", "session.list", "session.create", "session.mode.set", "file.list", "file.read"] {
            assert!(
                MOBILE_REQUEST_TYPES.contains(&message_type),
                "{message_type} 不在手机白名单里"
            );
        }
    }

    /// 端口已经关掉的地址：模拟电脑换了 IP 后，手机手里那个旧地址。
    fn dead_address() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.local_addr().unwrap().to_string()
    }

    /// 假 Desktop：握手、认证成功，并像真 Desktop 一样报上自己当前的地址清单。
    fn spawn_authenticating_desktop(
        listener: TcpListener,
        private: Vec<u8>,
        advertised: serde_json::Value,
    ) -> thread::JoinHandle<()> {
        spawn_desktop_replying(
            listener,
            private,
            serde_json::json!({ "ok": true, "addresses": advertised }),
        )
    }

    fn spawn_desktop_replying(
        listener: TcpListener,
        private: Vec<u8>,
        reply: serde_json::Value,
    ) -> thread::JoinHandle<()> {
        thread::spawn(move || {
            let (mut stream, transport) = accept_encrypted(&listener, &private);
            let _request: serde_json::Value =
                read_encrypted_json(&mut stream, &transport).unwrap();
            write_encrypted_json(&mut stream, &transport, &reply).unwrap();
        })
    }

    const RELAY_SECRET: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

    fn relay_ticket(url: &str) -> RelayTicket {
        RelayTicket {
            url: url.to_string(),
            room_id: "c".repeat(32),
            secret: RELAY_SECRET.to_string(),
        }
    }

    /// 电脑端的中继代理：把中继来的连接接到假电脑的监听端口。
    fn relay_desktop(ticket: RelayTicket, port: u16) -> Arc<AtomicBool> {
        let alive = Arc::new(AtomicBool::new(true));
        let running = Arc::clone(&alive);
        thread::spawn(move || {
            remote_relay::run_desktop(ticket, port, move || running.load(Ordering::Acquire))
        });
        alive
    }

    /// 电脑的中继控制连接上线前，手机会先得到 RELAY_DESKTOP_OFFLINE。
    fn until_relay_online<T>(mut attempt: impl FnMut() -> Result<T, String>) -> T {
        for _ in 0..80 {
            match attempt() {
                Ok(value) => return value,
                Err(error) if error == "RELAY_DESKTOP_OFFLINE" => {
                    thread::sleep(Duration::from_millis(50))
                }
                Err(error) => panic!("unexpected error: {error}"),
            }
        }
        panic!("relay never came online");
    }

    #[test]
    fn candidates_end_with_the_relay_when_the_desktop_gave_one() {
        let mut cred = credential("192.168.1.2:9527", &[0; 32]);
        cred.relay = Some(relay_ticket("wss://relay.example/relay/v1"));
        assert_eq!(
            candidate_addresses(&cred, None),
            vec!["192.168.1.2:9527".to_string(), RELAY_CANDIDATE.to_string()]
        );
        // 手填地址仍只试那一个。
        assert_eq!(
            candidate_addresses(&cred, Some("10.0.0.8:9527")),
            vec!["10.0.0.8:9527".to_string()]
        );
    }

    #[test]
    fn a_phone_outside_reaches_the_paired_desktop_through_the_relay() {
        let url = remote_relay::fake::spawn(RELAY_SECRET);
        let (listener, live, server) = desktop_listener();
        let port = listener.local_addr().unwrap().port();
        let ticket = relay_ticket(&url);
        let desktop = spawn_desktop_replying(
            listener,
            server.private.clone(),
            serde_json::json!({ "ok": true, "addresses": [live], "relay": ticket }),
        );
        let stop = relay_desktop(ticket.clone(), port);
        let (_, keypair) = device_identity();
        let mut cred = credential(&dead_address(), &server.public);
        cred.relay = Some(ticket.clone());

        let session = until_relay_online(|| {
            connect_first(
                &candidate_addresses(&cred, None),
                &cred,
                &keypair,
                Arc::new(|_| {}),
                Arc::new(|| {}),
            )
        });

        assert_eq!(session.address, RELAY_CANDIDATE, "局域网地址不通时经中继连上");
        assert_eq!(session.relay, Some(ticket), "认证回包里的中继票据要交给凭证");
        desktop.join().unwrap();
        stop.store(false, Ordering::Release);
    }

    #[test]
    fn pairing_goes_through_the_relay_when_the_lan_address_is_unreachable() {
        let url = remote_relay::fake::spawn(RELAY_SECRET);
        let (listener, _, server) = desktop_listener();
        let port = listener.local_addr().unwrap().port();
        let ticket = relay_ticket(&url);
        let desktop = spawn_desktop_replying(
            listener,
            server.private.clone(),
            serde_json::json!({ "ok": true, "deviceId": "iphone-1", "token": TOKEN }),
        );
        let stop = relay_desktop(ticket.clone(), port);
        let (identity, keypair) = device_identity();
        let dead = dead_address();

        let paired = until_relay_online(|| {
            pair_first(
                &[dead.clone(), RELAY_CANDIDATE.to_string()],
                Some(&ticket),
                "offer-1",
                &server.public,
                "iPhone",
                &identity,
                &keypair,
            )
        });

        assert_eq!(paired.address, RELAY_CANDIDATE);
        assert_eq!(paired.relay, Some(ticket));
        assert_eq!(paired.token, TOKEN);
        desktop.join().unwrap();
        stop.store(false, Ordering::Release);
    }

    #[test]
    fn candidates_try_the_last_good_address_first_without_duplicates() {
        let mut cred = credential("192.168.1.2:9527", &[0; 32]);
        cred.addresses = vec![
            "192.168.1.2:9527".into(),
            "Mac.local:9527".into(),
            " ".into(),
        ];
        assert_eq!(
            candidate_addresses(&cred, None),
            vec!["192.168.1.2:9527".to_string(), "Mac.local:9527".to_string()]
        );
        // 用户手动填的地址只试这一个，不悄悄换去别处。
        assert_eq!(
            candidate_addresses(&cred, Some(" 10.0.0.8:9527 ")),
            vec!["10.0.0.8:9527".to_string()]
        );
    }

    /// M3a：用户手填 Tailscale 地址或主机名时通常不写端口，沿用配对时电脑的端口。
    #[test]
    fn a_typed_address_without_port_uses_the_paired_port() {
        let cred = credential("192.168.0.26:56537", &[0; 32]);
        assert_eq!(
            candidate_addresses(&cred, Some("100.101.1.2")),
            vec!["100.101.1.2:56537".to_string()]
        );
        assert_eq!(
            candidate_addresses(&cred, Some(" my-mac.tail1234.ts.net ")),
            vec!["my-mac.tail1234.ts.net:56537".to_string()]
        );
        assert_eq!(
            candidate_addresses(&cred, Some("100.101.1.2:6000")),
            vec!["100.101.1.2:6000".to_string()]
        );
    }

    #[test]
    fn reconnect_finds_the_same_desktop_at_another_address_by_its_key() {
        let (listener, live, server) = desktop_listener();
        let desktop = spawn_authenticating_desktop(
            listener,
            server.private.clone(),
            serde_json::json!([live.clone(), "Mac.local:9527"]),
        );
        let (_, keypair) = device_identity();
        let mut cred = credential(&dead_address(), &server.public);
        cred.addresses = vec![live.clone()];

        let session = connect_first(
            &candidate_addresses(&cred, None),
            &cred,
            &keypair,
            Arc::new(|_| {}),
            Arc::new(|| {}),
        )
        .expect("旧地址失效后应当用同一把公钥在新地址连上");

        assert_eq!(session.address, live);
        assert_eq!(
            session.advertised,
            vec![live.clone(), "Mac.local:9527".to_string()]
        );
        desktop.join().unwrap();
    }

    #[test]
    fn reconnect_refuses_an_address_answered_by_another_desktop() {
        let (listener, address, impostor) = desktop_listener();
        let private = impostor.private.clone();
        let desktop = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            // 握手会在手机核对公钥时中断，这里不关心结果。
            let _ = server_noise_handshake(&mut stream, &private);
        });
        let paired_desktop = noise_keypair();
        let (_, keypair) = device_identity();
        let cred = credential(&address, &paired_desktop.public);

        let error = connect_first(
            &candidate_addresses(&cred, None),
            &cred,
            &keypair,
            Arc::new(|_| {}),
            Arc::new(|| {}),
        )
        .err()
        .expect("公钥不符必须拒绝");

        assert_eq!(error, "DESKTOP_KEY_MISMATCH");
        desktop.join().unwrap();
    }
}
