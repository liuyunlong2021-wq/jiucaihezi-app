//! 手机控制器中继（Mobile 控制器完善计划 M3b）。
//!
//! 电脑和手机都只做出站 WebSocket，连到 `gateway/src/relay-room.js` 的同一个房间。
//! 两端各接一条本地隧道：电脑把每条中继数据连接接到本机桥端口，手机在本机开临时
//! 端口接到中继——Noise 握手、配对、认证与全部业务协议一行不改，中继只见密文。

use std::io::{ErrorKind, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream, ToSocketAddrs};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tungstenite::client::IntoClientRequest;
use tungstenite::handshake::HandshakeError;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

/// 线上中继。开发时可用 `JIUCAIHEZI_RELAY_URL` 指到 `wrangler dev`。
pub const DEFAULT_RELAY_URL: &str = "wss://api.jiucaihezi.studio/relay/v1";
/// 候选地址里代表「走中继」的那一项；它不是网络地址，也会显示在手机状态里。
pub const RELAY_CANDIDATE: &str = "relay";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(6);
/// 隧道两头轮询的间隔：同步 WebSocket 不能一边阻塞读一边写，只能轮流短读。
const POLL: Duration = Duration::from_millis(15);
/// 控制连接心跳。中继侧由 Cloudflare 自动回 pong，不唤醒房间。
const PING_EVERY: Duration = Duration::from_secs(25);

type Socket = WebSocket<MaybeTlsStream<TcpStream>>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayTicket {
    pub url: String,
    pub room_id: String,
    pub secret: String,
}

impl RelayTicket {
    pub fn generate(url: &str) -> Self {
        let random = || uuid::Uuid::new_v4().simple().to_string();
        Self {
            url: url.to_string(),
            room_id: random(),
            secret: format!("{}{}", random(), random()),
        }
    }

    /// 房间号进 URL 路径，必须是中继接受的 32 位 hex；密钥至少 32 字符。
    pub fn is_valid(&self) -> bool {
        (self.url.starts_with("wss://") || self.url.starts_with("ws://"))
            && self.room_id.len() == 32
            && self.room_id.chars().all(|c| c.is_ascii_hexdigit())
            && self.secret.len() >= 32
    }

    fn endpoint(&self, path: &str) -> String {
        format!(
            "{}/rooms/{}/{path}",
            self.url.trim_end_matches('/'),
            self.room_id
        )
    }
}

/// 手机：经中继连到电脑，返回一条接在中继上的本地 TCP 连接。
pub fn connect_mobile(ticket: &RelayTicket) -> Result<TcpStream, String> {
    let socket = open(ticket, "mobile")?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let local = listener.local_addr().map_err(|error| error.to_string())?;
    thread::spawn(move || {
        if let Ok((stream, _)) = listener.accept() {
            pump(socket, stream);
        }
    });
    TcpStream::connect(local).map_err(|error| error.to_string())
}

/// 电脑：常驻中继控制连接，把每台手机的数据连接接到本机桥端口；`alive` 为假时退出。
pub fn run_desktop(
    ticket: RelayTicket,
    local_port: u16,
    alive: impl Fn() -> bool + Send + Sync + 'static,
) {
    let mut backoff = Duration::from_secs(1);
    while alive() {
        match open(&ticket, "desktop") {
            Ok(mut control) => {
                backoff = Duration::from_secs(1);
                serve_control(&mut control, &ticket, local_port, &alive);
            }
            Err(error) => eprintln!("[remote-relay] desktop connect failed: {error}"),
        }
        let until = Instant::now() + backoff;
        while alive() && Instant::now() < until {
            thread::sleep(Duration::from_millis(100));
        }
        backoff = (backoff * 2).min(Duration::from_secs(60));
    }
}

fn serve_control(
    control: &mut Socket,
    ticket: &RelayTicket,
    local_port: u16,
    alive: &dyn Fn() -> bool,
) {
    if set_read_timeout(control, Duration::from_millis(200)).is_err() {
        return;
    }
    let mut last_ping = Instant::now();
    while alive() {
        match control.read() {
            Ok(Message::Text(text)) => {
                if let Some(id) = open_request(text.as_str()) {
                    let ticket = ticket.clone();
                    thread::spawn(move || {
                        let data = open(&ticket, &format!("data/{id}"));
                        let local = TcpStream::connect(("127.0.0.1", local_port));
                        if let (Ok(data), Ok(local)) = (data, local) {
                            pump(data, local);
                        }
                    });
                }
            }
            Ok(Message::Close(_)) => return,
            Ok(_) => {}
            Err(tungstenite::Error::Io(error)) if idle(&error) => {}
            Err(_) => return,
        }
        if last_ping.elapsed() >= PING_EVERY {
            if control.send(Message::Text("ping".into())).is_err() {
                return;
            }
            last_ping = Instant::now();
        }
    }
    let _ = control.close(None);
}

/// 中继发来的「有手机进房」。id 会拼进 URL，只接受 32 位 hex。
fn open_request(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let id = value.get("id")?.as_str()?;
    (value.get("type")?.as_str()? == "open"
        && id.len() == 32
        && id.chars().all(|c| c.is_ascii_hexdigit()))
    .then(|| id.to_string())
}

fn open(ticket: &RelayTicket, path: &str) -> Result<Socket, String> {
    if !ticket.is_valid() {
        return Err("RELAY_TICKET_INVALID".to_string());
    }
    let mut request = ticket
        .endpoint(path)
        .into_client_request()
        .map_err(|error| format!("RELAY_TICKET_INVALID: {error}"))?;
    let authorization = format!("Bearer {}", ticket.secret)
        .parse()
        .map_err(|_| "RELAY_TICKET_INVALID".to_string())?;
    request.headers_mut().insert("Authorization", authorization);
    let uri = request.uri();
    let host = uri.host().unwrap_or_default().to_string();
    let port = uri
        .port_u16()
        .unwrap_or(if uri.scheme_str() == Some("wss") { 443 } else { 80 });
    let stream = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|error| format!("RELAY_UNREACHABLE: {error}"))?
        .find_map(|address| TcpStream::connect_timeout(&address, CONNECT_TIMEOUT).ok())
        .ok_or_else(|| "RELAY_UNREACHABLE".to_string())?;
    stream
        .set_read_timeout(Some(CONNECT_TIMEOUT))
        .map_err(|error| error.to_string())?;
    match tungstenite::client_tls_with_config(request, stream, None, None) {
        Ok((socket, _)) => Ok(socket),
        Err(HandshakeError::Failure(tungstenite::Error::Http(response))) => {
            Err(match response.status().as_u16() {
                503 => "RELAY_DESKTOP_OFFLINE".to_string(),
                401 | 403 => "RELAY_UNAUTHORIZED".to_string(),
                429 => "RELAY_ROOM_FULL".to_string(),
                status => format!("RELAY_HTTP_{status}"),
            })
        }
        Err(error) => Err(format!("RELAY_UNREACHABLE: {error}")),
    }
}

fn set_read_timeout(socket: &Socket, timeout: Duration) -> std::io::Result<()> {
    match socket.get_ref() {
        MaybeTlsStream::Plain(stream) => stream.set_read_timeout(Some(timeout)),
        MaybeTlsStream::Rustls(stream) => stream.get_ref().set_read_timeout(Some(timeout)),
        _ => Ok(()),
    }
}

fn idle(error: &std::io::Error) -> bool {
    matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut)
}

/// 中继 WebSocket 与本地 TCP 之间原样搬字节，直到任一端关闭。
fn pump(mut socket: Socket, mut stream: TcpStream) {
    if set_read_timeout(&socket, POLL).is_err() || stream.set_read_timeout(Some(POLL)).is_err() {
        return;
    }
    let mut buffer = vec![0; 64 * 1024];
    loop {
        match socket.read() {
            Ok(Message::Binary(frame)) => {
                if stream.write_all(&frame).is_err() {
                    break;
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(error)) if idle(&error) => {}
            Err(_) => break,
        }
        match stream.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                if socket.send(Message::Binary(buffer[..n].to_vec().into())).is_err() {
                    break;
                }
            }
            Err(error) if idle(&error) => {}
            Err(_) => break,
        }
    }
    let _ = socket.close(None);
    let _ = socket.flush();
    let _ = stream.shutdown(Shutdown::Both);
}

#[cfg(test)]
pub(crate) mod fake {
    //! 测试用中继：与 `relay-room.js` 同样的路由、鉴权与转发规则，跑在本机 ws:// 上。
    use std::collections::HashMap;
    use std::net::{TcpListener, TcpStream};
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread;
    use std::time::Duration;

    use tungstenite::handshake::server::{ErrorResponse, Request, Response};
    use tungstenite::{Message, WebSocket};

    type Socket = WebSocket<TcpStream>;

    pub(crate) fn spawn(secret: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("ws://{}/relay/v1", listener.local_addr().unwrap());
        let control: Arc<Mutex<Option<Socket>>> = Arc::new(Mutex::new(None));
        let waiting: Arc<Mutex<HashMap<String, mpsc::Sender<Socket>>>> = Arc::default();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let control = Arc::clone(&control);
                let waiting = Arc::clone(&waiting);
                thread::spawn(move || serve(stream, secret, control, waiting));
            }
        });
        url
    }

    fn reject(status: u16) -> ErrorResponse {
        tungstenite::http::Response::builder()
            .status(status)
            .body(None)
            .unwrap()
    }

    fn serve(
        stream: TcpStream,
        secret: &str,
        control: Arc<Mutex<Option<Socket>>>,
        waiting: Arc<Mutex<HashMap<String, mpsc::Sender<Socket>>>>,
    ) {
        let mut path = String::new();
        let desktop_online = control.lock().unwrap().is_some();
        let accepted = tungstenite::accept_hdr(stream, |request: &Request, response: Response| {
            path = request.uri().path().to_string();
            let auth = request
                .headers()
                .get("Authorization")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default();
            if auth != format!("Bearer {secret}") {
                return Err(reject(403));
            }
            if path.ends_with("/mobile") && !desktop_online {
                return Err(reject(503));
            }
            Ok(response)
        });
        let Ok(mut socket) = accepted else { return };
        if path.ends_with("/desktop") {
            *control.lock().unwrap() = Some(socket);
        } else if path.ends_with("/mobile") {
            let id = uuid::Uuid::new_v4().simple().to_string();
            let (sender, receiver) = mpsc::channel();
            waiting.lock().unwrap().insert(id.clone(), sender);
            let open = serde_json::json!({ "type": "open", "id": id }).to_string();
            if let Some(desktop) = control.lock().unwrap().as_mut() {
                desktop.send(Message::Text(open.into())).unwrap();
            }
            if let Ok(data) = receiver.recv_timeout(Duration::from_secs(5)) {
                bridge(&mut socket, data);
            }
        } else if let Some(id) = path.rsplit('/').next()
            && let Some(sender) = waiting.lock().unwrap().remove(id)
        {
            let _ = sender.send(socket);
        }
    }

    /// 两条 WebSocket 之间原样转发二进制帧，直到任一端关闭。
    fn bridge(mobile: &mut Socket, mut data: Socket) {
        for socket in [mobile.get_ref(), data.get_ref()] {
            socket
                .set_read_timeout(Some(Duration::from_millis(10)))
                .unwrap();
        }
        while forward(mobile, &mut data) && forward(&mut data, mobile) {}
    }

    /// 转发一帧（或一次超时空转）；对端关闭或出错时返回 false。
    fn forward(from: &mut Socket, to: &mut Socket) -> bool {
        match from.read() {
            Ok(Message::Binary(frame)) => to.send(Message::Binary(frame)).is_ok(),
            Ok(Message::Close(_)) => false,
            Ok(_) => true,
            Err(tungstenite::Error::Io(error)) => matches!(
                error.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
            ),
            Err(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::thread;

    const SECRET: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn ticket(url: &str, secret: &str) -> RelayTicket {
        RelayTicket {
            url: url.to_string(),
            room_id: "a".repeat(32),
            secret: secret.to_string(),
        }
    }

    /// 本机桥的替身：把收到的字节原样回给手机。
    fn echo_bridge() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                thread::spawn(move || {
                    let mut buffer = [0; 1024];
                    while let Ok(n) = stream.read(&mut buffer) {
                        if n == 0 || stream.write_all(&buffer[..n]).is_err() {
                            break;
                        }
                    }
                });
            }
        });
        port
    }

    #[test]
    fn a_generated_ticket_has_an_unguessable_room_and_secret() {
        let first = RelayTicket::generate(DEFAULT_RELAY_URL);
        let second = RelayTicket::generate(DEFAULT_RELAY_URL);
        assert!(first.is_valid());
        assert_eq!(first.url, DEFAULT_RELAY_URL);
        assert_eq!(first.room_id.len(), 32);
        assert!(first.room_id.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(first.secret.len(), 64);
        assert_ne!(first.room_id, second.room_id);
        assert_ne!(first.secret, second.secret);
        assert!(!ticket(DEFAULT_RELAY_URL, "short").is_valid());
        assert!(!RelayTicket {
            room_id: "../etc".into(),
            ..first.clone()
        }
        .is_valid());
    }

    #[test]
    fn mobile_bytes_reach_the_desktop_bridge_through_the_relay_and_back() {
        let url = fake::spawn(SECRET);
        let port = echo_bridge();
        let alive = Arc::new(AtomicBool::new(true));
        let running = Arc::clone(&alive);
        let desktop_ticket = ticket(&url, SECRET);
        thread::spawn(move || run_desktop(desktop_ticket, port, move || running.load(Ordering::Acquire)));

        // 电脑的控制连接上线需要一点时间；手机在它上线前得到 DESKTOP_OFFLINE。
        let mut stream = None;
        for _ in 0..50 {
            match connect_mobile(&ticket(&url, SECRET)) {
                Ok(connected) => {
                    stream = Some(connected);
                    break;
                }
                Err(error) => {
                    assert_eq!(error, "RELAY_DESKTOP_OFFLINE");
                    thread::sleep(std::time::Duration::from_millis(50));
                }
            }
        }
        let mut stream = stream.expect("电脑上线后手机应当经中继连上");
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        stream.write_all(b"noise-frame").unwrap();
        let mut echoed = [0; 11];
        stream.read_exact(&mut echoed).unwrap();
        assert_eq!(&echoed, b"noise-frame");
        alive.store(false, Ordering::Release);
    }

    #[test]
    fn relay_refusals_become_error_codes_the_phone_can_show() {
        let url = fake::spawn(SECRET);
        assert_eq!(
            connect_mobile(&ticket(&url, SECRET)).unwrap_err(),
            "RELAY_DESKTOP_OFFLINE"
        );
        assert_eq!(
            connect_mobile(&ticket(&url, &"f".repeat(64))).unwrap_err(),
            "RELAY_UNAUTHORIZED"
        );
        let dead = {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            format!("ws://{}/relay/v1", listener.local_addr().unwrap())
        };
        assert!(connect_mobile(&ticket(&dead, SECRET))
            .unwrap_err()
            .starts_with("RELAY_UNREACHABLE"));
    }

    /// 对真实中继（`wrangler dev` 本地模拟或线上）跑一遍：
    /// `JIUCAIHEZI_RELAY_TEST_URL=ws://127.0.0.1:8799/relay/v1 cargo test -- --ignored real_relay`
    #[test]
    #[ignore]
    fn real_relay_carries_bytes_between_phone_and_desktop() {
        let url = std::env::var("JIUCAIHEZI_RELAY_TEST_URL").expect("JIUCAIHEZI_RELAY_TEST_URL");
        let room = RelayTicket::generate(&url);
        let port = echo_bridge();
        let alive = Arc::new(AtomicBool::new(true));
        let running = Arc::clone(&alive);
        let desktop_ticket = room.clone();
        thread::spawn(move || run_desktop(desktop_ticket, port, move || running.load(Ordering::Acquire)));
        let mut stream = None;
        for _ in 0..100 {
            match connect_mobile(&room) {
                Ok(connected) => {
                    stream = Some(connected);
                    break;
                }
                Err(error) => {
                    assert_eq!(error, "RELAY_DESKTOP_OFFLINE");
                    thread::sleep(std::time::Duration::from_millis(100));
                }
            }
        }
        let mut stream = stream.expect("电脑上线后手机应当经真实中继连上");
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(10)))
            .unwrap();
        // 大于一个隧道读缓冲（64 KiB）的帧也要完整往返。
        let payload: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        stream.write_all(&payload).unwrap();
        let mut echoed = vec![0; payload.len()];
        stream.read_exact(&mut echoed).unwrap();
        assert_eq!(echoed, payload);
        let wrong = RelayTicket {
            secret: "e".repeat(64),
            ..room.clone()
        };
        assert_eq!(connect_mobile(&wrong).unwrap_err(), "RELAY_UNAUTHORIZED");
        alive.store(false, Ordering::Release);
    }

    #[test]
    fn the_desktop_only_opens_data_connections_for_well_formed_ids() {
        assert_eq!(
            open_request(&serde_json::json!({ "type": "open", "id": "b".repeat(32) }).to_string()),
            Some("b".repeat(32))
        );
        assert_eq!(
            open_request(r#"{"type":"open","id":"../../desktop"}"#),
            None
        );
        assert_eq!(open_request("pong"), None);
    }
}
