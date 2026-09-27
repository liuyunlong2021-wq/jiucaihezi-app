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
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use super::remote_bridge::{
    MAX_FRAME_BYTES, NOISE_PATTERN, lock_error, noise_keypair, now_ms, read_encrypted,
    read_encrypted_json, read_frame, write_encrypted_json, write_frame,
};

const TRANSPORT_TIMEOUT: Duration = Duration::from_secs(30);
/// Desktop 上的配对要等本机用户点「允许」，服务端给了 300 秒，这里留一点余量。
const PAIRING_APPROVAL_TIMEOUT: Duration = Duration::from_secs(330);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// 手机只会发出的请求类型。Desktop 侧的白名单是同一份清单，两边都拦一次。
const MOBILE_REQUEST_TYPES: &[&str] = &[
    "context.get",
    "session.read",
    "session.subscribe",
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
    address: String,
}

/// 一个已认证的 Desktop 连接。读由独立线程负责，写必须经 `stream` 锁，
/// 否则两个并发请求的帧会互相插进对方里面。
struct DesktopSession {
    address: String,
    device_id: String,
    stream: Mutex<TcpStream>,
    transport: Arc<Mutex<TransportState>>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<Result<serde_json::Value, String>>>>>,
}

impl DesktopSession {
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

/// 完成 Noise XX 发起方握手，并校验对端就是二维码里那把静态公钥。
fn open_encrypted(
    address: &str,
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
    let mut stream = TcpStream::connect(address).map_err(|error| error.to_string())?;
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

fn pair_with_desktop(
    address: &str,
    offer_id: &str,
    desktop_public_key: &[u8],
    device_name: &str,
    identity: &StoredDeviceIdentity,
    keypair: &Keypair,
) -> Result<StoredCredential, String> {
    let (mut stream, transport) = open_encrypted(address, keypair, desktop_public_key)?;
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
    let (mut stream, transport) = open_encrypted(address, keypair, &desktop_public_key)?;
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
    // 认证之后这是一条长期连接：留着读超时会把空闲连接读死。
    stream
        .set_read_timeout(None)
        .map_err(|error| error.to_string())?;
    let reader_stream = stream.try_clone().map_err(|error| error.to_string())?;
    let pending = Arc::new(Mutex::new(HashMap::new()));
    spawn_reader(
        reader_stream,
        Arc::clone(&transport),
        Arc::clone(&pending),
        on_event,
        on_closed,
    );
    Ok(Arc::new(DesktopSession {
        address: address.to_string(),
        device_id: credential.device_id.clone(),
        stream: Mutex::new(stream),
        transport,
        pending,
    }))
}

fn spawn_reader(
    mut stream: TcpStream,
    transport: Arc<Mutex<TransportState>>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<Result<serde_json::Value, String>>>>>,
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
        // 连接结束：唤醒所有等待者，并让界面知道现在是离线（合同 §10.7）。
        if let Ok(mut map) = pending.lock() {
            for (_, sender) in map.drain() {
                let _ = sender.send(Err("REMOTE_CONNECTION_CLOSED".to_string()));
            }
        }
        on_closed();
    });
}

fn status_of(
    state: &MobileRemoteState,
    credential: Option<&StoredCredential>,
) -> MobileRemoteStatus {
    let session = state
        .session
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(Arc::clone));
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
) -> Result<MobileRemoteStatus, String> {
    let target = address.trim().to_string();
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
        pair_with_desktop(&target, &offer, &public_key, &name, &identity, &keypair)
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
    let target = address
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| credential.address.clone());
    if target.is_empty() {
        return Err("PAIRING_ADDRESS_INVALID".to_string());
    }
    let (_, keypair) = load_or_create_identity()?;
    let connecting_address = target.clone();
    let connecting: StoredCredential = credential.clone();

    let session = tokio::task::spawn_blocking(move || {
        let event_app = app.clone();
        let closed_app = app.clone();
        connect_session(
            &connecting_address,
            &connecting,
            &keypair,
            Box::new(move |value| {
                let _ = event_app.emit(MOBILE_EVENT_NAME, value);
            }),
            Box::new(move || {
                let _ = closed_app.emit(MOBILE_CLOSED_EVENT_NAME, ());
            }),
        )
    })
    .await
    .map_err(|error| error.to_string())??;

    let mut guard = state.session.lock().map_err(lock_error)?;
    if let Some(previous) = guard.take() {
        previous.close();
    }
    *guard = Some(session);
    drop(guard);

    if credential.address != target {
        let updated = StoredCredential {
            address: target.clone(),
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
    let session = state
        .session
        .lock()
        .map_err(lock_error)?
        .as_ref()
        .map(Arc::clone)
        .ok_or_else(|| "REMOTE_NOT_CONNECTED".to_string())?;
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
}
