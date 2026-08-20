use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Mutex, mpsc};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

const MAX_REQUEST_BYTES: usize = 1_048_576;
const OPERATIONS: &[&str] = &[
    "get_creation_context",
    "list_creation_models",
    "submit_creation_task",
    "get_creation_task",
    "list_creation_history",
    "cancel_creation_task",
    "retry_media_persistence",
    "add_creation_result_to_canvas",
];

#[derive(Default)]
pub struct CreationMcpState {
    pending: Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreationMcpLaunchConfig {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeRequest {
    request_id: String,
    operation: String,
    params: Value,
}

#[derive(Deserialize)]
struct InvokeBody {
    operation: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
struct DiscoveryFile {
    version: u8,
    address: String,
    token: String,
}

#[tauri::command]
pub fn creation_mcp_complete(
    request_id: String,
    result: Option<Value>,
    error: Option<String>,
    state: tauri::State<'_, CreationMcpState>,
) -> Result<(), String> {
    let sender = state
        .pending
        .lock()
        .map_err(|_| "MCP bridge state unavailable".to_string())?
        .remove(&request_id)
        .ok_or_else(|| "MCP bridge request expired".to_string())?;
    sender
        .send(error.map_or_else(|| Ok(result.unwrap_or(Value::Null)), Err))
        .map_err(|_| "MCP bridge response receiver closed".to_string())
}

#[tauri::command]
pub fn resolve_creation_mcp(app: AppHandle) -> Result<CreationMcpLaunchConfig, String> {
    let node = crate::commands::mcp::resolve_mcp_node()?;
    let relative = PathBuf::from("creation-mcp").join("index.mjs");
    let resource_entry = app
        .path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join(&relative));
    let (entry, cwd) = if let Some(path) = resource_entry.filter(|path| path.exists()) {
        (path, None)
    } else {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = root.join("..");
        let path = repo_root.join("scripts/jiucaihezi-creation-mcp/dist/index.mjs");
        if !path.exists() {
            return Err("韭菜盒子创作 MCP 尚未构建，请先运行 build:creation-mcp".to_string());
        }
        (path, Some(repo_root.to_string_lossy().into_owned()))
    };
    Ok(CreationMcpLaunchConfig {
        command: node,
        args: vec![entry.to_string_lossy().into_owned()],
        cwd,
    })
}

pub fn start(app: AppHandle) -> Result<PathBuf, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let address = listener.local_addr().map_err(|error| error.to_string())?;
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let discovery_path = discovery_path()?;
    write_discovery(
        &discovery_path,
        &DiscoveryFile {
            version: 1,
            address: format!("http://{address}"),
            token: token.clone(),
        },
    )?;

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => handle_connection(stream, &app, &token),
                Err(error) => eprintln!("[creation-mcp] accept failed: {error}"),
            }
        }
    });
    Ok(discovery_path)
}

pub fn remove_discovery() {
    if let Ok(path) = discovery_path() {
        let _ = fs::remove_file(path);
    }
}

fn discovery_path() -> Result<PathBuf, String> {
    dirs_next::home_dir()
        .map(|home| home.join(".jiucaihezi").join("mcp-bridge.json"))
        .ok_or_else(|| "home directory unavailable".to_string())
}

fn write_discovery(path: &PathBuf, value: &DiscoveryFile) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "invalid discovery path".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    if fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return Err("refusing to overwrite MCP bridge symlink".to_string());
    }
    let temporary = parent.join(format!(".mcp-bridge-{}.tmp", Uuid::new_v4().simple()));
    fs::write(
        &temporary,
        serde_json::to_vec(value).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn handle_connection(mut stream: TcpStream, app: &AppHandle, token: &str) {
    let response = process_request(&mut stream, app, token)
        .unwrap_or_else(|(status, message)| (status, json!({ "error": message })));
    let body = serde_json::to_vec(&response.1)
        .unwrap_or_else(|_| b"{\"error\":\"serialization failed\"}".to_vec());
    let _ = write!(
        stream,
        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        response.0,
        body.len()
    );
    let _ = stream.write_all(&body);
}

fn process_request(
    stream: &mut TcpStream,
    app: &AppHandle,
    token: &str,
) -> Result<(&'static str, Value), (&'static str, String)> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(internal_error)?;
    let raw = read_http_request(stream)?;
    let (headers, body) = raw
        .split_once("\r\n\r\n")
        .ok_or(("400 Bad Request", "malformed request".to_string()))?;
    let mut lines = headers.lines();
    if lines.next() != Some("POST /v1/invoke HTTP/1.1") {
        return Err(("404 Not Found", "unknown bridge route".to_string()));
    }
    let authorized = lines.any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case("authorization") && value.trim() == format!("Bearer {token}")
        })
    });
    if !authorized {
        return Err(("401 Unauthorized", "invalid bridge token".to_string()));
    }
    let input: InvokeBody = serde_json::from_str(body)
        .map_err(|_| ("400 Bad Request", "invalid JSON body".to_string()))?;
    if !OPERATIONS.contains(&input.operation.as_str()) {
        return Err(("400 Bad Request", "unknown creation operation".to_string()));
    }

    let request_id = Uuid::new_v4().to_string();
    let (sender, receiver) = mpsc::channel();
    app.state::<CreationMcpState>()
        .pending
        .lock()
        .map_err(|_| {
            (
                "500 Internal Server Error",
                "bridge state unavailable".to_string(),
            )
        })?
        .insert(request_id.clone(), sender);
    app.emit(
        "creation-mcp:request",
        BridgeRequest {
            request_id: request_id.clone(),
            operation: input.operation,
            params: input.params,
        },
    )
    .map_err(internal_error)?;
    match receiver.recv_timeout(Duration::from_secs(30)) {
        Ok(Ok(result)) => Ok(("200 OK", json!({ "result": result }))),
        Ok(Err(error)) => Ok(("422 Unprocessable Entity", json!({ "error": error }))),
        Err(_) => {
            if let Ok(mut pending) = app.state::<CreationMcpState>().pending.lock() {
                pending.remove(&request_id);
            }
            Err((
                "504 Gateway Timeout",
                "韭菜盒子前端未就绪或响应超时".to_string(),
            ))
        }
    }
}

fn read_http_request(stream: &mut TcpStream) -> Result<String, (&'static str, String)> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let count = stream.read(&mut chunk).map_err(internal_error)?;
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..count]);
        if bytes.len() > MAX_REQUEST_BYTES {
            return Err(("413 Payload Too Large", "request exceeds 1 MiB".to_string()));
        }
        if let Some(header_end) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&bytes[..header_end]);
            let length = headers
                .lines()
                .find_map(|line| {
                    line.split_once(':').and_then(|(name, value)| {
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                })
                .unwrap_or(0);
            if length > MAX_REQUEST_BYTES {
                return Err(("413 Payload Too Large", "request exceeds 1 MiB".to_string()));
            }
            if bytes.len() >= header_end + 4 + length {
                break;
            }
        }
    }
    String::from_utf8(bytes).map_err(|_| ("400 Bad Request", "request is not UTF-8".to_string()))
}

fn internal_error(error: impl ToString) -> (&'static str, String) {
    ("500 Internal Server Error", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_contract_rejects_unknown_operations() {
        assert!(OPERATIONS.contains(&"submit_creation_task"));
        assert!(!OPERATIONS.contains(&"read_file"));
        assert_eq!(MAX_REQUEST_BYTES, 1_048_576);
    }
}
