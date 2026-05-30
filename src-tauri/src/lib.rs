use base64::{engine::general_purpose, Engine as _};
use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::cdp::browser_protocol::page::{
    CaptureScreenshotFormat, CaptureScreenshotParams,
};
use chromiumoxide::page::Page;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::env;
use std::path::{Component, Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use std::sync::LazyLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{ipc::Channel, webview::NewWindowResponse, Emitter, Manager, State, WebviewWindowBuilder};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};

mod secure_store;

// ─── MCP stdio bridge ───

struct McpStdioProcess {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
}

static MCP_PROCESSES: LazyLock<Mutex<HashMap<String, McpStdioProcess>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
async fn mcp_spawn_stdio(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    on_stdout: Channel<String>,
) -> Result<String, String> {
    let program = resolve_local_binary(&command);

    let mut cmd = Command::new(&program);
    cmd.args(&args);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.kill_on_drop(true);

    if let Some(ref dir) = cwd {
        cmd.current_dir(Path::new(dir));
    }

    let mut child = cmd.spawn().map_err(|e| format!("无法启动进程: {e}"))?;
    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let stdin = child.stdin.take().ok_or("无法获取 stdin")?;
    let stderr = child.stderr.take().ok_or("无法获取 stderr")?;

    let handle_id = format!("mcp_{}", uuid_v4());

    // Spawn task to read stdout and send to channel
    let stdout_reader = BufReader::new(stdout);
    let on_stdout_clone = on_stdout.clone();
    tokio::spawn(async move {
        let mut lines = stdout_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = on_stdout_clone.send(line);
        }
        let _ = on_stdout_clone.send("__MCP_EOF__".to_string());
    });

    // Spawn task to read stderr (log only, don't send to channel)
    let stderr_reader = BufReader::new(stderr);
    let stderr_handle_id = handle_id.clone();
    tokio::spawn(async move {
        let mut lines = stderr_reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[MCP stderr:{}] {}", stderr_handle_id, line);
        }
    });

    let process = McpStdioProcess { child, stdin };
    MCP_PROCESSES.lock().await.insert(handle_id.clone(), process);

    Ok(handle_id)
}

#[tauri::command]
async fn mcp_write_stdin(handle_id: String, message: String) -> Result<(), String> {
    let mut processes = MCP_PROCESSES.lock().await;
    let process = processes.get_mut(&handle_id)
        .ok_or_else(|| format!("进程 {handle_id} 不存在"))?;

    process.stdin.write_all(message.as_bytes()).await
        .map_err(|e| format!("写入失败: {e}"))?;
    process.stdin.write_all(b"\n").await
        .map_err(|e| format!("写入失败: {e}"))?;
    process.stdin.flush().await
        .map_err(|e| format!("flush 失败: {e}"))?;

    Ok(())
}

#[tauri::command]
async fn mcp_kill_stdio(handle_id: String) -> Result<(), String> {
    let mut processes = MCP_PROCESSES.lock().await;
    if let Some(mut process) = processes.remove(&handle_id) {
        let _ = process.child.kill().await;
    }
    Ok(())
}

fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    format!("{:x}", ts)
}

// ─── NewAPI 登录回调拦截 ───

fn is_workbench_return_url(url: &tauri::Url) -> bool {
    // 仅拦截登录回调域名（jiucaihezi.studio），不拦截 NewAPI 自身（api.jiucaihezi.studio）
    matches!(
        url.host_str(),
        Some("jiucaihezi.studio")
            | Some("www.jiucaihezi.studio")
            | Some("dazi.studio")
            | Some("www.dazi.studio")
    )
}

fn workbench_url_from_return(url: &tauri::Url) -> tauri::Url {
    let query = url.query().map(|q| format!("?{q}")).unwrap_or_default();
    tauri::Url::parse(&format!("tauri://localhost/index.html{query}"))
        .expect("valid local workbench entry url")
}

// 自定义 HTTP 请求命令，绕过 WebView/CORS，直接走主进程 reqwest。

fn resolve_local_binary(program: &str) -> PathBuf {
    let direct = PathBuf::from(program);
    if direct.is_absolute() && direct.exists() {
        return direct;
    }

    if let Some(home) = env::var_os("HOME") {
        let candidate = PathBuf::from(home)
            .join(".jiucaihezi")
            .join("tools")
            .join("bin")
            .join(program);
        if candidate.exists() {
            return candidate;
        }
    }

    if let Some(paths) = env::var_os("PATH") {
        for dir in env::split_paths(&paths) {
            let candidate = dir.join(program);
            if candidate.exists() {
                return candidate;
            }
        }
    }

    for dir in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ] {
        let candidate = PathBuf::from(dir).join(program);
        if candidate.exists() {
            return candidate;
        }
    }

    PathBuf::from(program)
}

fn local_tools_python_path() -> Option<PathBuf> {
    env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join(".jiucaihezi")
            .join("tools")
            .join("python")
    }).filter(|path| path.exists())
}

fn python_path_from_token(token: &str) -> Option<PathBuf> {
    let trimmed = token.trim().trim_matches('"').trim_matches('\'');
    if !trimmed.to_ascii_lowercase().contains("python") {
        return None;
    }
    let python = PathBuf::from(trimmed);
    if python.exists() {
        Some(python)
    } else {
        None
    }
}

fn python_from_wrapper_script(path: &Path) -> Option<PathBuf> {
    let content = std::fs::read_to_string(path).ok()?;
    let first = content.lines().next()?.trim();
    if let Some(shebang) = first.strip_prefix("#!") {
        if let Some(python) = shebang.split_whitespace().find_map(python_path_from_token) {
            return Some(python);
        }
    }
    for line in content.lines().take(20) {
        let trimmed = line.trim();
        let Some(command) = trimmed.strip_prefix("exec ") else {
            continue;
        };
        if let Some(python) = command.split_whitespace().find_map(python_path_from_token) {
            return Some(python);
        }
    }
    None
}

fn resolve_local_python() -> PathBuf {
    if let Some(home) = env::var_os("HOME") {
        let tools_root = PathBuf::from(home).join(".jiucaihezi").join("tools");
        for candidate in [
            tools_root.join("bin").join("python3"),
            tools_root.join("python").join("bin").join("python3"),
        ] {
            if candidate.exists() {
                return candidate;
            }
        }
        for wrapper in [
            tools_root.join("bin").join("markitdown"),
            tools_root.join("python").join("bin").join("markitdown"),
            tools_root.join("python").join("bin").join("pypdfium2"),
        ] {
            if let Some(python) = python_from_wrapper_script(&wrapper) {
                return python;
            }
        }
    }

    for candidate in [
        "/Library/Frameworks/Python.framework/Versions/3.10/bin/python3",
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
    ] {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return path;
        }
    }

    resolve_local_binary("python3")
}

#[derive(Deserialize)]
struct HttpRequest {
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_secs: Option<u64>,
}

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

struct BrowserSession {
    browser: Browser,
    page: Option<Page>,
    handler_task: JoinHandle<()>,
    profile_dir: PathBuf,
    chrome_path: Option<PathBuf>,
}

#[derive(Default)]
struct BrowserRuntime {
    session: Mutex<Option<BrowserSession>>,
    operation: Mutex<()>,
}

const LOCAL_MLX_PROVIDER_ID: &str = "local-mlx";
const LOCAL_MLX_PORT: u16 = 17880;

struct LocalMlxSession {
    child: tokio::process::Child,
    model_id: String,
    model_repo: String,
    api_base: String,
}

#[derive(Default)]
struct LocalMlxRuntime {
    sessions: Mutex<HashMap<String, LocalMlxSession>>,
    operation: Mutex<()>,
    cleaned_orphan_servers: Mutex<bool>,
}

impl Drop for LocalMlxRuntime {
    fn drop(&mut self) {
        if let Ok(mut sessions) = self.sessions.try_lock() {
            for (_, mut session) in sessions.drain() {
                let _ = session.child.start_kill();
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalMlxStatus {
    supported: bool,
    provider_id: &'static str,
    model_id: String,
    model_label: String,
    model_repo: String,
    model_source: String,
    installed: bool,
    running: bool,
    api_base: String,
    message: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LocalMlxModelInput {
    model_id: String,
    model_label: String,
    model_repo: String,
    download_bytes_hint: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalMlxPackageManifest {
    id: Option<String>,
    engine: Option<String>,
    platform: Option<String>,
    repo: Option<String>,
    model_dir: Option<String>,
}

impl LocalMlxModelInput {
    fn safe_dir_name(&self) -> String {
        self.model_id
            .trim()
            .trim_start_matches("local-mlx/")
            .chars()
            .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '-' })
            .collect::<String>()
            .trim_matches('-')
            .to_string()
    }
}

fn jiucaihezi_home_dir() -> Result<PathBuf, String> {
    let home = env::var_os("HOME").ok_or_else(|| "无法读取 HOME 目录".to_string())?;
    Ok(PathBuf::from(home).join(".jiucaihezi"))
}

fn local_mlx_runtime_dir() -> Result<PathBuf, String> {
    Ok(jiucaihezi_home_dir()?.join("local-mlx"))
}

fn local_mlx_model_dir(input: &LocalMlxModelInput) -> Result<PathBuf, String> {
    Ok(jiucaihezi_home_dir()?.join("models").join("local-mlx").join(input.safe_dir_name()))
}

fn local_mlx_imports_dir() -> Result<PathBuf, String> {
    Ok(jiucaihezi_home_dir()?.join("models").join("imports"))
}

fn local_mlx_hf_home() -> Result<PathBuf, String> {
    Ok(jiucaihezi_home_dir()?.join("models").join("huggingface"))
}

fn local_mlx_hf_model_cache_dir(input: &LocalMlxModelInput) -> Result<PathBuf, String> {
    let safe_repo = input
        .model_repo
        .trim()
        .split('/')
        .filter(|part| !part.is_empty())
        .map(|part| {
            part.chars()
                .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' { ch } else { '-' })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("--");
    Ok(local_mlx_hf_home()?.join("hub").join(format!("models--{}", safe_repo)))
}

fn local_mlx_ready_marker(input: &LocalMlxModelInput) -> Result<PathBuf, String> {
    Ok(local_mlx_model_dir(input)?.join(".ready"))
}

fn local_mlx_model_path_marker(input: &LocalMlxModelInput) -> Result<PathBuf, String> {
    Ok(local_mlx_model_dir(input)?.join(".model_path"))
}

fn local_mlx_venv_python() -> Result<PathBuf, String> {
    Ok(local_mlx_runtime_dir()?.join("venv").join("bin").join("python"))
}

fn local_mlx_session_key(input: &LocalMlxModelInput) -> String {
    input.safe_dir_name()
}

fn local_mlx_base_port(input: &LocalMlxModelInput) -> u16 {
    if input.model_id == "local-mlx/jiucai-local" {
        return LOCAL_MLX_PORT;
    }
    let hash = input
        .safe_dir_name()
        .bytes()
        .fold(0u16, |acc, byte| acc.wrapping_mul(31).wrapping_add(byte as u16));
    LOCAL_MLX_PORT + 1 + (hash % 99)
}

fn local_mlx_api_base(input: &LocalMlxModelInput) -> String {
    format!("http://127.0.0.1:{}", local_mlx_base_port(input))
}

fn local_mlx_api_base_for_port(port: u16) -> String {
    format!("http://127.0.0.1:{}", port)
}

fn local_mlx_port_is_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

async fn local_mlx_cleanup_orphan_servers(runtime: &LocalMlxRuntime) {
    let should_cleanup = {
        let mut cleaned = runtime.cleaned_orphan_servers.lock().await;
        if *cleaned {
            false
        } else {
            *cleaned = true;
            true
        }
    };
    if !should_cleanup {
        return;
    }

    let Ok(server_bin) = local_mlx_runtime_dir().map(|dir| dir.join("venv").join("bin").join("mlx_lm.server")) else {
        return;
    };
    let pattern = server_bin.to_string_lossy().to_string();
    let Ok(output) = Command::new("pgrep").args(["-f", pattern.as_str()]).output().await else {
        return;
    };
    if !output.status.success() {
        return;
    }

    let current_pid = std::process::id();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let pids = stdout
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .filter(|pid| *pid != current_pid)
        .collect::<Vec<_>>();

    for pid in pids {
        let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).status().await;
    }
    tokio::time::sleep(Duration::from_millis(500)).await;
}

fn local_mlx_select_port(input: &LocalMlxModelInput, sessions: &HashMap<String, LocalMlxSession>) -> Result<u16, String> {
    let current_key = local_mlx_session_key(input);
    if let Some(existing) = sessions.get(&current_key) {
        if let Some(port_text) = existing.api_base.rsplit(':').next() {
            if let Ok(port) = port_text.parse::<u16>() {
                return Ok(port);
            }
        }
    }

    let base = local_mlx_base_port(input);
    for offset in 0..100u16 {
        let port = LOCAL_MLX_PORT + ((base - LOCAL_MLX_PORT + offset) % 100);
        let api_base = local_mlx_api_base_for_port(port);
        let used_by_other_session = sessions
            .iter()
            .any(|(key, session)| key != &current_key && session.api_base == api_base);
        if !used_by_other_session && local_mlx_port_is_available(port) {
            return Ok(port);
        }
    }

    Err("没有可用的本地模型端口，请关闭占用 17880-17979 的进程后重试。".to_string())
}

fn is_apple_silicon() -> bool {
    cfg!(target_os = "macos") && cfg!(target_arch = "aarch64")
}

async fn local_mlx_python_import_ok() -> bool {
    let Ok(python) = local_mlx_venv_python() else {
        return false;
    };
    if !python.exists() {
        return false;
    }

    Command::new(python)
        .args(["-c", "import mlx_lm"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|status| status.success())
        .unwrap_or(false)
}

fn local_mlx_ready_marker_matches(input: &LocalMlxModelInput) -> bool {
    local_mlx_ready_marker(input)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|content| content.trim() == input.model_repo)
        .unwrap_or(false)
}

fn local_mlx_model_files_ok(model_dir: &Path) -> bool {
    if !model_dir.is_dir() {
        return false;
    }
    let has_config = model_dir.join("config.json").is_file();
    let has_tokenizer = model_dir.join("tokenizer.json").is_file()
        || model_dir.join("tokenizer.model").is_file()
        || model_dir.join("tokenizer_config.json").is_file();
    let has_weights = std::fs::read_dir(model_dir)
        .ok()
        .map(|entries| {
            entries.filter_map(Result::ok).any(|entry| {
                let path = entry.path();
                path.is_file()
                    && path
                        .extension()
                        .and_then(|ext| ext.to_str())
                        .map(|ext| matches!(ext, "safetensors" | "npz"))
                        .unwrap_or(false)
            })
        })
        .unwrap_or(false);
    has_config && has_tokenizer && has_weights
}

fn local_mlx_imported_model_path(input: &LocalMlxModelInput) -> Option<PathBuf> {
    let marker = local_mlx_model_path_marker(input).ok()?;
    let path = std::fs::read_to_string(marker).ok()?;
    let model_dir = PathBuf::from(path.trim());
    local_mlx_model_files_ok(&model_dir).then_some(model_dir)
}

fn local_mlx_hf_snapshot_model_path(input: &LocalMlxModelInput) -> Option<PathBuf> {
    let cache_dir = local_mlx_hf_model_cache_dir(input).ok()?;
    let refs_main = cache_dir.join("refs").join("main");
    if let Ok(revision) = std::fs::read_to_string(refs_main) {
        let snapshot = cache_dir.join("snapshots").join(revision.trim());
        if local_mlx_model_files_ok(&snapshot) {
            return Some(snapshot);
        }
    }

    let snapshots_dir = cache_dir.join("snapshots");
    let mut entries = std::fs::read_dir(snapshots_dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| local_mlx_model_files_ok(path))
        .collect::<Vec<_>>();
    entries.sort();
    entries.into_iter().next()
}

fn local_mlx_effective_model_path(input: &LocalMlxModelInput) -> Option<PathBuf> {
    local_mlx_imported_model_path(input).or_else(|| local_mlx_hf_snapshot_model_path(input))
}

fn local_mlx_installed(input: &LocalMlxModelInput) -> bool {
    local_mlx_ready_marker_matches(input) && local_mlx_effective_model_path(input).is_some()
}

fn local_mlx_model_source_arg(input: &LocalMlxModelInput) -> String {
    local_mlx_effective_model_path(input)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| input.model_repo.clone())
}

fn local_mlx_collect_candidate_package_dirs(root: &Path, depth: usize, dirs: &mut Vec<PathBuf>) -> Result<(), String> {
    if depth > 2 || !root.exists() {
        return Ok(());
    }
    let entries = std::fs::read_dir(root).map_err(|e| format!("读取模型目录失败: {}", e))?;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path.file_name().and_then(|item| item.to_str()).unwrap_or("");
        if name.starts_with('.') || matches!(name, "huggingface" | "local-mlx" | "imports") {
            continue;
        }
        if path.join("manifest.json").is_file() || local_mlx_model_files_ok(&path) {
            dirs.push(path.clone());
        }
        local_mlx_collect_candidate_package_dirs(&path, depth + 1, dirs)?;
    }
    Ok(())
}

fn local_mlx_candidate_package_dirs() -> Result<Vec<PathBuf>, String> {
    let model_root = jiucaihezi_home_dir()?.join("models");
    let imports_dir = local_mlx_imports_dir()?;
    let mut dirs = Vec::new();

    for root in [&imports_dir, &model_root] {
        local_mlx_collect_candidate_package_dirs(root, 0, &mut dirs)?;
    }

    dirs.sort();
    dirs.dedup();
    Ok(dirs)
}

fn local_mlx_find_imported_package(input: &LocalMlxModelInput) -> Result<Option<PathBuf>, String> {
    for package_dir in local_mlx_candidate_package_dirs()? {
        let manifest_path = package_dir.join("manifest.json");
        if !manifest_path.is_file() {
            if local_mlx_model_files_ok(&package_dir) {
                return Ok(Some(package_dir));
            }
            continue;
        }
        let manifest_text = std::fs::read_to_string(&manifest_path)
            .map_err(|e| format!("读取模型清单失败: {}", e))?;
        let manifest: LocalMlxPackageManifest = serde_json::from_str(&manifest_text)
            .map_err(|e| format!("模型清单格式错误: {}", e))?;

        if manifest.engine.as_deref() != Some("mlx") {
            continue;
        }
        if let Some(platform) = manifest.platform.as_deref() {
            if platform != "mac-arm64" {
                continue;
            }
        }

        let id_matches = manifest.id.as_deref() == Some(input.model_id.as_str());
        let repo_matches = manifest.repo.as_deref() == Some(input.model_repo.as_str());
        if !id_matches && !repo_matches {
            continue;
        }

        let model_dir_name = manifest.model_dir.as_deref().unwrap_or("model");
        let model_dir = package_dir.join(model_dir_name);
        if !local_mlx_model_files_ok(&model_dir) {
            return Err("识别到模型包，但缺少 config/tokenizer/权重文件。请确认拖入的是完整的「韭菜盒子本地模型」文件夹。".to_string());
        }

        return Ok(Some(model_dir));
    }

    Ok(None)
}

fn local_mlx_model_id_matches(id: &str, expected_model: &str) -> bool {
    if id == expected_model {
        return true;
    }
    let id_path = Path::new(id);
    let expected_path = Path::new(expected_model);
    if id_path.is_absolute() && expected_path.is_absolute() {
        if let (Ok(id_real), Ok(expected_real)) = (id_path.canonicalize(), expected_path.canonicalize()) {
            return id_real == expected_real;
        }
    }
    let expected_leaf = expected_model
        .rsplit('/')
        .find(|part| !part.is_empty())
        .unwrap_or(expected_model);
    if expected_leaf.len() >= 8 && (id == expected_leaf || id.ends_with(&format!("/{}", expected_leaf))) {
        return true;
    }
    false
}

fn local_mlx_models_response_has_model(body: &str, expected_model: &str) -> bool {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body) else {
        return false;
    };
    json.get("data")
        .and_then(|value| value.as_array())
        .map(|models| {
            models.iter().any(|model| {
                model
                    .get("id")
                    .and_then(|value| value.as_str())
                    .map(|id| local_mlx_model_id_matches(id, expected_model))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

async fn local_mlx_health_ok(api_base: &str, expected_model: &str) -> bool {
    let url = format!("{}/v1/models", api_base.trim_end_matches('/'));
    let Ok(response) = reqwest::Client::new()
        .get(url)
        .timeout(std::time::Duration::from_secs(2))
        .send()
        .await else {
            return false;
        };
    if !response.status().is_success() {
        return false;
    }

    let body = response.text().await.unwrap_or_default();
    local_mlx_models_response_has_model(&body, expected_model)
}

async fn local_mlx_health_ok_for_input(api_base: &str, input: &LocalMlxModelInput, model_source: &str) -> bool {
    if model_source == input.model_repo {
        return local_mlx_health_ok(api_base, &input.model_repo).await;
    }
    local_mlx_health_ok(api_base, model_source).await
}

async fn stop_local_mlx_session(session: &mut Option<LocalMlxSession>) {
    if let Some(mut existing) = session.take() {
        let _ = existing.child.start_kill();
        let _ = timeout(Duration::from_secs(10), existing.child.wait()).await;
    }
}

async fn build_local_mlx_status(runtime: &LocalMlxRuntime, input: &LocalMlxModelInput) -> LocalMlxStatus {
    let model_arg = local_mlx_model_source_arg(input);
    let session_key = local_mlx_session_key(input);
    let (api_base, has_session) = {
        let sessions = runtime.sessions.lock().await;
        let session = sessions.get(&session_key);
        (
            session.map(|item| item.api_base.clone()).unwrap_or_else(|| local_mlx_api_base(input)),
            session
                .map(|item| item.model_id == input.model_id && item.model_repo == input.model_repo)
                .unwrap_or(false),
        )
    };
    let running = has_session && local_mlx_health_ok_for_input(&api_base, input, &model_arg).await;
    let installed = local_mlx_installed(input);
    let supported = is_apple_silicon();
    let message = if !supported {
        "当前第一版本地模型仅支持 Apple Silicon Mac。".to_string()
    } else if installed {
        "本地模型可用，可在对话框模型选择器中手动选择。".to_string()
    } else {
        "未安装本地模型。".to_string()
    };

    LocalMlxStatus {
        supported,
        provider_id: LOCAL_MLX_PROVIDER_ID,
        model_id: input.model_id.clone(),
        model_label: input.model_label.clone(),
        model_repo: input.model_repo.clone(),
        model_source: model_arg,
        installed,
        running,
        api_base,
        message,
    }
}

async fn run_local_mlx_step(
    label: &str,
    program: &Path,
    args: &[&str],
    timeout_secs: u64,
    on_progress: &Channel<serde_json::Value>,
) -> Result<(), String> {
    on_progress
        .send(serde_json::json!({
            "event": "status",
            "message": label,
        }))
        .ok();

    let mut command = Command::new(program);
    command.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Ok(hf_home) = local_mlx_hf_home() {
        let _ = std::fs::create_dir_all(&hf_home);
        command.env("HF_HOME", hf_home);
    }

    let output = timeout(
        Duration::from_secs(timeout_secs),
        command.output(),
    )
    .await
    .map_err(|_| format!("{} 超时", label))?
    .map_err(|e| format!("{} 失败: {}", label, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "{} 失败: {}{}",
            label,
            stderr.trim(),
            if stdout.trim().is_empty() {
                "".to_string()
            } else {
                format!("\n{}", stdout.trim())
            }
        ));
    }

    Ok(())
}

fn dir_size_bytes(path: &Path) -> u64 {
    let Ok(metadata) = std::fs::metadata(path) else {
        return 0;
    };
    if metadata.is_file() {
        return metadata.len();
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| dir_size_bytes(&entry.path()))
        .sum()
}

async fn run_local_mlx_download_step(
    label: &str,
    program: &Path,
    args: &[&str],
    timeout_secs: u64,
    input: &LocalMlxModelInput,
    on_progress: &Channel<serde_json::Value>,
) -> Result<(), String> {
    let total_bytes = input.download_bytes_hint.unwrap_or(0);
    let cache_dir = local_mlx_hf_model_cache_dir(input)?;
    on_progress
        .send(serde_json::json!({
            "event": "status",
            "message": label,
            "progress": 0,
            "downloadedBytes": dir_size_bytes(&cache_dir),
            "totalBytes": total_bytes,
        }))
        .ok();

    let mut command = Command::new(program);
    command.args(args).stdout(Stdio::null()).stderr(Stdio::null());
    if let Ok(hf_home) = local_mlx_hf_home() {
        let _ = std::fs::create_dir_all(&hf_home);
        command.env("HF_HOME", hf_home);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("{} 失败: {}", label, e))?;
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if status.success() {
                    let downloaded = dir_size_bytes(&cache_dir);
                    on_progress
                        .send(serde_json::json!({
                            "event": "status",
                            "message": "模型文件已下载，正在做最后校验...",
                            "progress": 100,
                            "downloadedBytes": downloaded,
                            "totalBytes": total_bytes,
                        }))
                        .ok();
                    return Ok(());
                }
                return Err(format!("{} 失败: {}", label, status));
            }
            Ok(None) => {
                let downloaded = dir_size_bytes(&cache_dir);
                let progress = if total_bytes > 0 {
                    ((downloaded as f64 / total_bytes as f64) * 100.0).floor().clamp(0.0, 99.0) as u64
                } else {
                    0
                };
                on_progress
                    .send(serde_json::json!({
                        "event": "status",
                        "message": label,
                        "progress": progress,
                        "downloadedBytes": downloaded,
                        "totalBytes": total_bytes,
                    }))
                    .ok();
            }
            Err(err) => return Err(format!("检查{}失败: {}", label, err)),
        }

        if Instant::now() >= deadline {
            let _ = child.start_kill();
            let _ = timeout(Duration::from_secs(5), child.wait()).await;
            return Err(format!("{} 超时", label));
        }

        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserOpenInput {
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserReadInput {
    max_chars: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserScreenshotInput {
    full_page: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserSearchInput {
    query: String,
    max_results: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserStateInput {
    max_chars: Option<usize>,
    max_elements: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserClickInput {
    selector: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserTypeInput {
    selector: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserLaunchOutput {
    status: String,
    profile_dir: String,
    chrome_path: Option<String>,
    url: String,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserReadOutput {
    title: String,
    url: String,
    text: String,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserScreenshotOutput {
    mime: String,
    data_base64: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserElementOutput {
    index: usize,
    tag: String,
    text: String,
    selector: String,
    href: String,
    input_type: String,
    aria_label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserStateOutput {
    title: String,
    url: String,
    text: String,
    truncated: bool,
    elements: Vec<BrowserElementOutput>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserSearchResultOutput {
    title: String,
    url: String,
    snippet: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserSearchOutput {
    query: String,
    search_url: String,
    results: Vec<BrowserSearchResultOutput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserCloseOutput {
    closed: bool,
}

fn browser_profile_dir() -> Result<PathBuf, String> {
    let home = env::var_os("HOME").ok_or_else(|| "无法定位用户 HOME 目录".to_string())?;
    let dir = PathBuf::from(home)
        .join(".jiucaihezi")
        .join("browser-profile");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建浏览器资料夹失败: {}", e))?;
    Ok(dir)
}

fn resolve_chrome_executable() -> Option<PathBuf> {
    let home = env::var_os("HOME").map(PathBuf::from);
    let mut candidates = vec![
        PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        PathBuf::from("/Applications/Chromium.app/Contents/MacOS/Chromium"),
        PathBuf::from("/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"),
    ];
    if let Some(home) = home {
        candidates.push(home.join("Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
        candidates.push(home.join("Applications/Chromium.app/Contents/MacOS/Chromium"));
    }

    candidates.into_iter().find(|path| path.exists())
}

fn normalize_browser_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("网址不能为空".into());
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower == "about:blank" || lower.starts_with("http://") || lower.starts_with("https://") {
        return Ok(trimmed.to_string());
    }
    if lower.starts_with("javascript:") || lower.starts_with("file:") || lower.starts_with("data:") {
        return Err("当前浏览器工具只允许打开 http/https 网页".into());
    }
    Ok(format!("https://{}", trimmed))
}

fn truncate_browser_text(text: String, max_chars: usize) -> (String, bool) {
    if text.chars().count() <= max_chars {
        return (text, false);
    }
    let truncated = text.chars().take(max_chars).collect::<String>();
    (truncated, true)
}

async fn page_string(page: &Page, script: &str) -> Result<String, String> {
    page.evaluate_function(script)
        .await
        .map_err(|e| format!("浏览器脚本执行失败: {}", e))?
        .into_value::<String>()
        .map_err(|e| format!("读取页面结果失败: {}", e))
}

fn encode_url_query(input: &str) -> String {
    input
        .as_bytes()
        .iter()
        .map(|byte| match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (*byte as char).to_string()
            }
            b' ' => "+".to_string(),
            other => format!("%{:02X}", other),
        })
        .collect::<Vec<_>>()
        .join("")
}

async fn page_elements(page: &Page, max_elements: usize) -> Result<Vec<BrowserElementOutput>, String> {
    let script = format!(r#"() => {{
      const max = {};
      const cssEscape = globalThis.CSS && CSS.escape ? CSS.escape : (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      const selectorFor = (el) => {{
        if (!el || !el.tagName) return '';
        if (el.id) return `#${{cssEscape(el.id)}}`;
        const parts = [];
        let current = el;
        while (current && current.nodeType === 1 && parts.length < 5) {{
          let part = current.tagName.toLowerCase();
          const classes = Array.from(current.classList || []).filter(Boolean).slice(0, 2);
          if (classes.length) part += '.' + classes.map(cssEscape).join('.');
          const parent = current.parentElement;
          if (parent) {{
            const sameTag = Array.from(parent.children).filter(item => item.tagName === current.tagName);
            if (sameTag.length > 1) {{
              const index = sameTag.indexOf(current) + 1;
              part += `:nth-of-type(${{index}})`;
            }}
          }}
          parts.unshift(part);
          current = parent;
        }}
        return parts.join(' > ');
      }};
      const nodes = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]'));
      return nodes
        .filter(el => {{
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        }})
        .slice(0, max)
        .map((el, index) => ({{
          index,
          tag: (el.tagName || '').toLowerCase(),
          text: (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 160),
          selector: selectorFor(el),
          href: el.href || '',
          inputType: el.type || '',
          ariaLabel: el.getAttribute('aria-label') || ''
        }}));
    }}"#, max_elements);

    page.evaluate_function(&script)
        .await
        .map_err(|e| format!("提取页面元素失败: {}", e))?
        .into_value::<Vec<BrowserElementOutput>>()
        .map_err(|e| format!("解析页面元素失败: {}", e))
}

async fn google_search_results(page: &Page, max_results: usize) -> Result<Vec<BrowserSearchResultOutput>, String> {
    let script = format!(r#"() => {{
      const max = {};
      const normalizeUrl = (href) => {{
        try {{
          const url = new URL(href, location.href);
          if (url.hostname.includes('google.') && url.pathname === '/url') {{
            return url.searchParams.get('q') || '';
          }}
          return url.href;
        }} catch {{
          return '';
        }}
      }};
      const seen = new Set();
      const results = [];
      for (const a of Array.from(document.querySelectorAll('a'))) {{
        const url = normalizeUrl(a.href || '');
        if (!url || !/^https?:\/\//i.test(url)) continue;
        let host = '';
        try {{ host = new URL(url).hostname; }} catch {{}}
        if (!host || host.includes('google.') || host.includes('gstatic.') || host.includes('youtube.com/redirect')) continue;
        if (seen.has(url)) continue;
        const title = (a.querySelector('h3')?.innerText || a.innerText || '').trim().replace(/\s+/g, ' ');
        if (!title || title.length < 2 || title.length > 180) continue;
        const container = a.closest('div') || a.parentElement;
        const snippet = (container?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 500);
        seen.add(url);
        results.push({{ title, url, snippet }});
        if (results.length >= max) break;
      }}
      return results;
    }}"#, max_results);

    page.evaluate_function(&script)
        .await
        .map_err(|e| format!("提取搜索结果失败: {}", e))?
        .into_value::<Vec<BrowserSearchResultOutput>>()
        .map_err(|e| format!("解析搜索结果失败: {}", e))
}

async fn browser_page_snapshot(page: &Page, max_chars: usize) -> Result<BrowserReadOutput, String> {
    let title = page_string(page, "() => document.title || ''").await?;
    let url = page_string(page, "() => location.href || ''").await?;
    let raw_text = page_string(page, "() => document.body ? document.body.innerText : ''").await?;
    let text = raw_text.replace('\r', "").trim().to_string();
    let (text, truncated) = truncate_browser_text(text, max_chars);
    Ok(BrowserReadOutput {
        title,
        url,
        text,
        truncated,
    })
}

async fn close_browser_session(mut session: BrowserSession) {
    if let Some(page) = session.page.take() {
        let _ = page.close().await;
    }
    let _ = session.browser.close().await;
    let _ = timeout(Duration::from_secs(2), session.browser.wait()).await;
    session.handler_task.abort();
}

async fn ensure_browser_page(runtime: &BrowserRuntime) -> Result<Page, String> {
    let current_page = {
        let guard = runtime.session.lock().await;
        guard.as_ref().and_then(|session| session.page.clone())
    };

    if let Some(page) = current_page {
        if page_string(&page, "() => location.href || ''").await.is_ok() {
            return Ok(page);
        }

        let stale_session = {
            let mut guard = runtime.session.lock().await;
            guard.take()
        };
        if let Some(session) = stale_session {
            close_browser_session(session).await;
        }
    }

    let stale_without_page = {
        let mut guard = runtime.session.lock().await;
        if guard.as_ref().is_some_and(|session| session.page.is_none()) {
            guard.take()
        } else {
            None
        }
    };
    if let Some(session) = stale_without_page {
        close_browser_session(session).await;
    }

    let profile_dir = browser_profile_dir()?;
    let chrome_path = resolve_chrome_executable();
    let mut builder = BrowserConfig::builder()
        .with_head()
        .window_size(1280, 900)
        .viewport(None)
        .user_data_dir(&profile_dir)
        .arg("no-first-run")
        .arg("no-default-browser-check")
        .arg("disable-background-networking");

    if let Some(path) = chrome_path.as_ref() {
        builder = builder.chrome_executable(path);
    }

    let config = builder
        .build()
        .map_err(|e| format!("浏览器配置失败: {}", e))?;
    let (browser, mut handler) = Browser::launch(config)
        .await
        .map_err(|e| format!("启动 Google Chrome 失败: {}", e))?;

    let handler_task = tokio::spawn(async move {
        while let Some(event) = handler.next().await {
            if let Err(err) = event {
                eprintln!("[BrowserRuntime] handler error: {}", err);
            }
        }
    });

    let page = match browser.new_page("about:blank").await {
        Ok(page) => page,
        Err(e) => {
            close_browser_session(BrowserSession {
                browser,
                page: None,
                handler_task,
                profile_dir,
                chrome_path,
            }).await;
            return Err(format!("创建浏览器页面失败: {}", e));
        }
    };
    if let Err(e) = page.bring_to_front().await {
        close_browser_session(BrowserSession {
            browser,
            page: Some(page),
            handler_task,
            profile_dir,
            chrome_path,
        }).await;
        return Err(format!("激活浏览器页面失败: {}", e));
    }

    let mut guard = runtime.session.lock().await;
    *guard = Some(BrowserSession {
        browser,
        page: Some(page.clone()),
        handler_task,
        profile_dir,
        chrome_path,
    });

    Ok(page)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevListFilesInput {
    root: String,
    relative_path: Option<String>,
    max_entries: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevReadFileInput {
    root: String,
    relative_path: String,
    max_bytes: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevWriteFileInput {
    root: String,
    relative_path: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevRunCommandInput {
    root: String,
    command: String,
    workdir: Option<String>,
    timeout_seconds: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevDetectProjectInput {
    root: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevSearchTextInput {
    root: String,
    relative_path: Option<String>,
    query: String,
    max_results: Option<usize>,
    context_lines: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevReadManyFilesInput {
    root: String,
    paths: Vec<String>,
    max_bytes_per_file: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevReplaceInFileInput {
    root: String,
    relative_path: String,
    old_text: String,
    new_text: String,
    replace_all: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevGetDiffInput {
    root: String,
    relative_path: Option<String>,
    max_bytes: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaCacheFileInput {
    filename: String,
    data_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaProcessFileInput {
    input_path: String,
    action: String,
    target_format: String,
    output_filename: String,
    start_seconds: Option<f64>,
    end_seconds: Option<f64>,
    crf: Option<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaTranscribeFileInput {
    input_path: String,
    output_format: Option<String>,
    language: Option<String>,
    model: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaBurnSubtitlesInput {
    input_path: String,
    subtitle_text: String,
    output_filename: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentToMarkdownFileInput {
    filename: String,
    #[allow(dead_code)]
    mime_type: Option<String>,
    data_base64: String,
    conversion_mode: Option<String>,
    output_format: Option<String>,
    timeout_seconds: Option<u64>,
    max_chars: Option<usize>,
    job_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentPathToMarkdownInput {
    source_path: String,
    output_dir: Option<String>,
    conversion_mode: Option<String>,
    output_format: Option<String>,
    timeout_seconds: Option<u64>,
    max_chars: Option<usize>,
    job_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelMarkdownConversionInput {
    job_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevFileEntry {
    path: String,
    is_dir: bool,
    size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevReadFileOutput {
    path: String,
    content: String,
    truncated: bool,
    size: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevWriteFileOutput {
    path: String,
    bytes_written: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevRunCommandOutput {
    command: String,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    duration_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevProjectDetection {
    project_types: Vec<String>,
    markers: Vec<String>,
    package_manager: Option<String>,
    recommended_commands: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevTextMatch {
    path: String,
    line_number: usize,
    line: String,
    before: Vec<String>,
    after: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevReplaceInFileOutput {
    path: String,
    replacements: usize,
    bytes_written: usize,
    diff: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DevGetDiffOutput {
    source: String,
    diff: String,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaCacheFileOutput {
    input_path: String,
    filename: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaProcessFileOutput {
    output_path: String,
    output_filename: String,
    output_size: u64,
    stdout: String,
    stderr: String,
    duration_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaTranscribeFileOutput {
    output_path: String,
    output_filename: String,
    output_size: u64,
    text: String,
    stdout: String,
    stderr: String,
    duration_ms: u128,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentToMarkdownFileOutput {
    status: String,
    source: String,
    filename: String,
    content: String,
    engine: String,
    source_path: String,
    output_path: String,
    truncated: bool,
    message: String,
    error: Option<String>,
}

struct MarkdownConversion {
    content: String,
    engine: String,
    truncated: bool,
    message: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MarkdownConversionMode {
    Auto,
    Fast,
    Ocr,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FormatConverterProgress {
    job_id: Option<String>,
    source_path: String,
    completed_pages: usize,
    total_pages: usize,
    progress: u8,
    message: String,
}

#[derive(Default)]
struct ConversionJobs {
    cancelled: Mutex<HashSet<String>>,
    pids: Mutex<HashMap<String, u32>>,
}

impl ConversionJobs {
    async fn is_cancelled(&self, job_id: Option<&str>) -> bool {
        let Some(job_id) = job_id else {
            return false;
        };
        self.cancelled.lock().await.contains(job_id)
    }

    async fn register_pid(&self, job_id: Option<&str>, pid: Option<u32>) {
        if let (Some(job_id), Some(pid)) = (job_id, pid) {
            self.pids.lock().await.insert(job_id.to_string(), pid);
        }
    }

    async fn clear_pid(&self, job_id: Option<&str>) {
        if let Some(job_id) = job_id {
            self.pids.lock().await.remove(job_id);
        }
    }

    async fn finish_job(&self, job_id: Option<&str>) {
        if let Some(job_id) = job_id {
            self.pids.lock().await.remove(job_id);
            self.cancelled.lock().await.remove(job_id);
        }
    }

    async fn cancel_job(&self, job_id: &str) {
        self.cancelled.lock().await.insert(job_id.to_string());
        let pid = self.pids.lock().await.get(job_id).copied();
        if let Some(pid) = pid {
            let _ = StdCommand::new("kill").arg("-TERM").arg(pid.to_string()).output();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveGeneratedFileInput {
    path: String,
    data_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveGeneratedFileOutput {
    path: String,
    bytes_written: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteSessionTokenInput {
    token: String,
}

/// 从 ~/.jiucaihezi/.session 读取 session token（文件权限 0600，仅本用户可读）
/// 比 localStorage 安全：XSS 无法通过 WebView JS 直接读取文件系统
#[tauri::command]
fn read_session_token() -> Result<String, String> {
    let path = jiucaihezi_home_dir()?.join(".session");
    if !path.exists() {
        return Ok(String::new());
    }
    // 确保权限为 0600（仅 owner 可读写）
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&path) {
            let mode = meta.permissions().mode() & 0o777;
            if mode != 0o600 {
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            }
        }
    }
    std::fs::read_to_string(&path)
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("读取 session token 失败: {}", e))
}

/// 将 session token 写入 ~/.jiucaihezi/.session（文件权限 0600），原子写入
#[tauri::command]
fn write_session_token(input: WriteSessionTokenInput) -> Result<(), String> {
    let path = jiucaihezi_home_dir()?.join(".session");
    let token = input.token.trim().to_string();
    if token.is_empty() {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("删除 session token 失败: {}", e))?;
        }
        return Ok(());
    }
    // 原子写入：先写临时文件，再 rename
    let tmp = path.with_extension(".session.tmp");
    std::fs::write(&tmp, &token).map_err(|e| format!("写入 session token 失败: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &path).map_err(|e| format!("保存 session token 失败: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn http_request(request: HttpRequest) -> Result<HttpResponse, String> {
    let mut client_builder = reqwest::Client::builder();
    // 默认 30 秒超时
    client_builder = client_builder.timeout(std::time::Duration::from_secs(
        request.timeout_secs.unwrap_or(30),
    ));
    // DNS 绕过 GFW 污染
    client_builder = client_builder.resolve(
        "api.jiucaihezi.studio",
        std::net::SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::new(47, 82, 86, 196)), 443),
    );
    let client = client_builder
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let method = match request.method.as_deref().unwrap_or("GET").to_uppercase().as_str() {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    let mut req = client.request(method, &request.url);

    if let Some(headers) = &request.headers {
        for (key, value) in headers {
            req = req.header(key.as_str(), value.as_str());
        }
    }

    if let Some(body) = request.body {
        req = req.body(body);
    }

    let resp = req.send().await.map_err(|e| format!("HTTP 请求失败: {}", e))?;

    let status = resp.status().as_u16();
    let mut headers = HashMap::new();
    for (key, value) in resp.headers() {
        if let Ok(v) = value.to_str() {
            headers.insert(key.to_string(), v.to_string());
        }
    }
    let body = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    Ok(HttpResponse { status, headers, body })
}

/// SSE 流式 HTTP 请求 — 通过 Tauri Channel 逐块推送响应
///
/// 流程：
///   1. JS 调用 invoke('http_request_stream', { request, onChunk: channel })
///   2. Rust 发起请求，先推送 { event: "headers", status, headers }
///   3. 逐块推送 { event: "chunk", data: "..." }
///   4. 最后推送 { event: "done" }
///   5. JS 用 ReadableStream 包装，SSE 解析器照常工作
#[tauri::command]
async fn http_request_stream(
    request: HttpRequest,
    on_chunk: Channel<serde_json::Value>,
) -> Result<(), String> {
    use futures::StreamExt;

    let mut client_builder = reqwest::Client::builder();
    // 流式请求默认 120 秒超时（SSE 长连接）
    client_builder = client_builder.timeout(std::time::Duration::from_secs(
        request.timeout_secs.unwrap_or(120),
    ));
    // DNS 绕过 GFW 污染
    client_builder = client_builder.resolve(
        "api.jiucaihezi.studio",
        std::net::SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::new(47, 82, 86, 196)), 443),
    );
    let client = client_builder
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let method = match request.method.as_deref().unwrap_or("GET").to_uppercase().as_str() {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    let mut req = client.request(method, &request.url);

    if let Some(headers) = &request.headers {
        for (key, value) in headers {
            req = req.header(key.as_str(), value.as_str());
        }
    }

    if let Some(body) = request.body {
        req = req.body(body);
    }

    let resp = req.send().await.map_err(|e| format!("HTTP 请求失败: {}", e))?;

    let status = resp.status().as_u16();
    let mut headers_map = HashMap::new();
    for (key, value) in resp.headers() {
        if let Ok(v) = value.to_str() {
            headers_map.insert(key.to_string(), v.to_string());
        }
    }

    // 推送 headers
    on_chunk
        .send(serde_json::json!({
            "event": "headers",
            "status": status,
            "headers": headers_map,
        }))
        .map_err(|e| format!("推送 headers 失败: {}", e))?;

    // 逐块推送 body
    let mut stream = resp.bytes_stream();
    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                on_chunk
                    .send(serde_json::json!({
                        "event": "chunk",
                        "data": text,
                    }))
                    .map_err(|e| format!("推送 chunk 失败: {}", e))?;
            }
            Err(e) => {
                on_chunk
                    .send(serde_json::json!({
                        "event": "error",
                        "message": format!("{}", e),
                    }))
                    .ok();
                return Err(format!("读取流失败: {}", e));
            }
        }
    }

    // 推送完成
    on_chunk
        .send(serde_json::json!({ "event": "done" }))
        .map_err(|e| format!("推送 done 失败: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn local_mlx_status(
    input: LocalMlxModelInput,
    runtime: State<'_, LocalMlxRuntime>,
) -> Result<LocalMlxStatus, String> {
    Ok(build_local_mlx_status(&runtime, &input).await)
}

#[tauri::command]
async fn local_mlx_prepare_model(
    input: LocalMlxModelInput,
    runtime: State<'_, LocalMlxRuntime>,
    on_progress: Channel<serde_json::Value>,
) -> Result<LocalMlxStatus, String> {
    let _operation = runtime.operation.lock().await;
    if !is_apple_silicon() {
        return Err("当前第一版本地模型仅支持 Apple Silicon Mac。".to_string());
    }

    let runtime_dir = local_mlx_runtime_dir()?;
    let model_dir = local_mlx_model_dir(&input)?;
    std::fs::create_dir_all(&runtime_dir).map_err(|e| format!("创建本地模型运行目录失败: {}", e))?;
    std::fs::create_dir_all(&model_dir).map_err(|e| format!("创建本地模型目录失败: {}", e))?;

    let venv_python = local_mlx_venv_python()?;
    if !venv_python.exists() {
        let system_python = resolve_local_python();
        let venv_dir = runtime_dir.join("venv");
        let venv_dir_text = venv_dir.to_string_lossy().to_string();
        run_local_mlx_step(
            "正在创建本地模型运行环境...",
            &system_python,
            &["-m", "venv", venv_dir_text.as_str()],
            180,
            &on_progress,
        )
        .await?;
    }

    run_local_mlx_step(
        "正在安装 MLX 本地模型引擎...",
        &venv_python,
        &["-m", "pip", "install", "-U", "pip", "mlx-lm", "huggingface_hub"],
        1800,
        &on_progress,
    )
    .await?;

    let generate_bin = runtime_dir.join("venv").join("bin").join("mlx_lm.generate");
    let (download_program, download_args): (PathBuf, Vec<String>) = if generate_bin.exists() {
        (
            generate_bin,
            vec![
                "--model".into(),
                input.model_repo.clone(),
                "--prompt".into(),
                "你好".into(),
                "--max-tokens".into(),
                "1".into(),
            ],
        )
    } else {
        (
            venv_python.clone(),
            vec![
                "-m".into(),
                "mlx_lm.generate".into(),
                "--model".into(),
                input.model_repo.clone(),
                "--prompt".into(),
                "你好".into(),
                "--max-tokens".into(),
                "1".into(),
            ],
        )
    };
    let download_refs: Vec<&str> = download_args.iter().map(String::as_str).collect();
    run_local_mlx_download_step(
        "正在下载并校验本地模型，文件较大请保持网络连接...",
        &download_program,
        &download_refs,
        7200,
        &input,
        &on_progress,
    )
    .await?;

    std::fs::write(local_mlx_ready_marker(&input)?, &input.model_repo)
        .map_err(|e| format!("写入本地模型状态失败: {}", e))?;
    if let Some(model_path) = local_mlx_hf_snapshot_model_path(&input) {
        std::fs::write(local_mlx_model_path_marker(&input)?, model_path.to_string_lossy().as_bytes())
            .map_err(|e| format!("写入本地模型路径失败: {}", e))?;
    }

    on_progress
        .send(serde_json::json!({
            "event": "done",
            "message": format!("{} 已安装，可在模型选择器中手动选择。", input.model_label),
        }))
        .ok();

    Ok(build_local_mlx_status(&runtime, &input).await)
}

#[tauri::command]
async fn local_mlx_scan_models(
    input: LocalMlxModelInput,
    runtime: State<'_, LocalMlxRuntime>,
) -> Result<LocalMlxStatus, String> {
    let _operation = runtime.operation.lock().await;
    if !is_apple_silicon() {
        return Err("当前第一版本地模型仅支持 Apple Silicon Mac。".to_string());
    }

    std::fs::create_dir_all(local_mlx_imports_dir()?)
        .map_err(|e| format!("创建本地模型导入目录失败: {}", e))?;

    let model_dir = local_mlx_find_imported_package(&input)?
        .ok_or_else(|| "没有识别到完整的「韭菜盒子本地模型」文件夹。请点击「打开本地模型目录」，把整个模型文件夹拖进去后再重新扫描。".to_string())?;
    let state_dir = local_mlx_model_dir(&input)?;
    std::fs::create_dir_all(&state_dir).map_err(|e| format!("创建本地模型状态目录失败: {}", e))?;
    std::fs::write(local_mlx_ready_marker(&input)?, &input.model_repo)
        .map_err(|e| format!("写入本地模型状态失败: {}", e))?;
    std::fs::write(local_mlx_model_path_marker(&input)?, model_dir.to_string_lossy().as_bytes())
        .map_err(|e| format!("写入本地模型路径失败: {}", e))?;

    Ok(build_local_mlx_status(&runtime, &input).await)
}

#[tauri::command]
async fn local_mlx_ensure_server(
    input: LocalMlxModelInput,
    runtime: State<'_, LocalMlxRuntime>,
) -> Result<LocalMlxStatus, String> {
    let _operation = runtime.operation.lock().await;
    if !is_apple_silicon() {
        return Err("当前第一版本地模型仅支持 Apple Silicon Mac。".to_string());
    }

    let session_key = local_mlx_session_key(&input);
    let model_arg = local_mlx_model_source_arg(&input);
    let existing_api_base = {
        let sessions = runtime.sessions.lock().await;
        sessions
            .get(&session_key)
            .map(|item| item.model_id == input.model_id && item.model_repo == input.model_repo)
            .unwrap_or(false)
            .then(|| sessions.get(&session_key).map(|item| item.api_base.clone()))
            .flatten()
    };
    if let Some(api_base) = existing_api_base {
        if local_mlx_health_ok_for_input(&api_base, &input, &model_arg).await {
            return Ok(build_local_mlx_status(&runtime, &input).await);
        }
    }

    if !local_mlx_installed(&input) {
        return Err(format!("{} 尚未导入，请先在设置中打开本地模型目录，把模型文件夹拖进去后重新扫描。", input.model_label));
    }

    if !local_mlx_python_import_ok().await {
        return Err("本地模型运行环境不可用，请保持网络连接后重启 App，或安装包含本地运行环境的新版安装包。".to_string());
    }

    local_mlx_cleanup_orphan_servers(&runtime).await;

    {
        let mut sessions = runtime.sessions.lock().await;
        if let Some(existing) = sessions.remove(&session_key) {
            let mut existing = Some(existing);
            stop_local_mlx_session(&mut existing).await;
        }
    }

    let selected_port = {
        let sessions = runtime.sessions.lock().await;
        local_mlx_select_port(&input, &sessions)?
    };
    let api_base = local_mlx_api_base_for_port(selected_port);
    let runtime_dir = local_mlx_runtime_dir()?;
    let server_bin = runtime_dir.join("venv").join("bin").join("mlx_lm.server");
    let venv_python = local_mlx_venv_python()?;
    let log_dir = runtime_dir.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join(format!("server-{}.log", input.safe_dir_name()));
    let port_text = selected_port.to_string();
    let mut command = if server_bin.exists() {
        let mut cmd = Command::new(server_bin);
        cmd.args([
            "--model",
            model_arg.as_str(),
            "--host",
            "127.0.0.1",
            "--port",
            port_text.as_str(),
        ]);
        cmd
    } else {
        let mut cmd = Command::new(venv_python);
        cmd.args([
            "-m",
            "mlx_lm.server",
            "--model",
            model_arg.as_str(),
            "--host",
            "127.0.0.1",
            "--port",
            port_text.as_str(),
        ]);
        cmd
    };
    if let Ok(hf_home) = local_mlx_hf_home() {
        let _ = std::fs::create_dir_all(&hf_home);
        command.env("HF_HOME", hf_home);
    }
    if let Ok(log_file) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        if let Ok(stderr_file) = log_file.try_clone() {
            command.stdout(Stdio::from(log_file));
            command.stderr(Stdio::from(stderr_file));
        }
    }

    let child = command
        .spawn()
        .map_err(|e| format!("启动本地模型失败: {}", e))?;

    {
        let mut sessions = runtime.sessions.lock().await;
        sessions.insert(session_key.clone(), LocalMlxSession {
            child,
            model_id: input.model_id.clone(),
            model_repo: input.model_repo.clone(),
            api_base: api_base.clone(),
        });
    }

    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
        {
            let mut sessions = runtime.sessions.lock().await;
            if let Some(existing) = sessions.get_mut(&session_key) {
                match existing.child.try_wait() {
                    Ok(Some(status)) => {
                        sessions.remove(&session_key);
                        return Err(format!("本地模型服务提前退出: {}", status));
                    }
                    Err(err) => {
                        sessions.remove(&session_key);
                        return Err(format!("检查本地模型服务失败: {}", err));
                    }
                    Ok(None) => {}
                }
            }
        }
        if local_mlx_health_ok_for_input(&api_base, &input, &model_arg).await {
            return Ok(build_local_mlx_status(&runtime, &input).await);
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    {
        let mut sessions = runtime.sessions.lock().await;
        if let Some(existing) = sessions.remove(&session_key) {
            let mut existing = Some(existing);
            stop_local_mlx_session(&mut existing).await;
        }
    }
    Err("本地模型启动超时，请稍后重试。".to_string())
}

#[tauri::command]
async fn local_mlx_stop_server(runtime: State<'_, LocalMlxRuntime>) -> Result<(), String> {
    let mut sessions = runtime.sessions.lock().await;
    let drained = sessions.drain().map(|(_, session)| session).collect::<Vec<_>>();
    drop(sessions);
    for session in drained {
        let mut session = Some(session);
        stop_local_mlx_session(&mut session).await;
    }
    Ok(())
}

#[tauri::command]
async fn local_mlx_remove_model(
    input: LocalMlxModelInput,
    runtime: State<'_, LocalMlxRuntime>,
) -> Result<LocalMlxStatus, String> {
    let _operation = runtime.operation.lock().await;
    {
        let mut sessions = runtime.sessions.lock().await;
        let keys = sessions
            .iter()
            .filter_map(|(key, item)| {
                (item.model_id == input.model_id || item.model_repo == input.model_repo)
                    .then_some(key.clone())
            })
            .collect::<Vec<_>>();
        let removed = keys
            .into_iter()
            .filter_map(|key| sessions.remove(&key))
            .collect::<Vec<_>>();
        drop(sessions);
        for session in removed {
            let mut session = Some(session);
            stop_local_mlx_session(&mut session).await;
        }
    }

    if let Ok(path) = local_mlx_model_dir(&input) {
        if path.exists() {
            std::fs::remove_dir_all(&path)
                .map_err(|e| format!("删除本地模型状态失败: {}", e))?;
        }
    }
    if let Ok(path) = local_mlx_hf_model_cache_dir(&input) {
        if path.exists() {
            std::fs::remove_dir_all(&path)
                .map_err(|e| format!("删除本地模型文件失败: {}", e))?;
        }
    }

    Ok(build_local_mlx_status(&runtime, &input).await)
}

#[tauri::command]
async fn local_mlx_open_model_dir() -> Result<(), String> {
    let dir = local_mlx_imports_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建模型目录失败: {}", e))?;
    StdCommand::new("open")
        .arg(dir)
        .spawn()
        .map_err(|e| format!("打开模型目录失败: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn browser_launch(runtime: State<'_, BrowserRuntime>) -> Result<BrowserLaunchOutput, String> {
    let _operation = runtime.operation.lock().await;
    let page = ensure_browser_page(&runtime).await?;
    let snapshot = browser_page_snapshot(&page, 2_000).await?;
    let guard = runtime.session.lock().await;
    let (profile_dir, chrome_path) = guard
        .as_ref()
        .map(|session| {
            (
                session.profile_dir.to_string_lossy().to_string(),
                session.chrome_path.as_ref().map(|path| path.to_string_lossy().to_string()),
            )
        })
        .unwrap_or_else(|| ("".to_string(), None));

    Ok(BrowserLaunchOutput {
        status: "ready".into(),
        profile_dir,
        chrome_path,
        url: snapshot.url,
        title: snapshot.title,
    })
}

#[tauri::command]
async fn browser_open(
    input: BrowserOpenInput,
    runtime: State<'_, BrowserRuntime>,
) -> Result<BrowserReadOutput, String> {
    let url = normalize_browser_url(&input.url)?;
    let _operation = runtime.operation.lock().await;
    let page = ensure_browser_page(&runtime).await?;
    page.goto(url)
        .await
        .map_err(|e| format!("打开网页失败: {}", e))?;
    page.wait_for_navigation()
        .await
        .map_err(|e| format!("等待网页加载失败: {}", e))?;
    page.bring_to_front()
        .await
        .map_err(|e| format!("激活浏览器页面失败: {}", e))?;
    browser_page_snapshot(&page, 20_000).await
}

#[tauri::command]
async fn browser_read(
    input: Option<BrowserReadInput>,
    runtime: State<'_, BrowserRuntime>,
) -> Result<BrowserReadOutput, String> {
    let max_chars = input.and_then(|value| value.max_chars).unwrap_or(40_000).clamp(1_000, 200_000);
    let _operation = runtime.operation.lock().await;
    let page = ensure_browser_page(&runtime).await?;
    browser_page_snapshot(&page, max_chars).await
}

#[tauri::command]
async fn browser_screenshot(
    input: Option<BrowserScreenshotInput>,
    runtime: State<'_, BrowserRuntime>,
) -> Result<BrowserScreenshotOutput, String> {
    let _operation = runtime.operation.lock().await;
    let page = ensure_browser_page(&runtime).await?;
    let params = CaptureScreenshotParams::builder()
        .format(CaptureScreenshotFormat::Png)
        .capture_beyond_viewport(input.and_then(|value| value.full_page).unwrap_or(false))
        .build();
    let data = page
        .screenshot(params)
        .await
        .map_err(|e| format!("浏览器截图失败: {}", e))?;
    Ok(BrowserScreenshotOutput {
        mime: "image/png".into(),
        data_base64: general_purpose::STANDARD.encode(data),
    })
}

#[tauri::command]
async fn browser_state(
    input: Option<BrowserStateInput>,
    runtime: State<'_, BrowserRuntime>,
) -> Result<BrowserStateOutput, String> {
    let max_chars = input.as_ref().and_then(|value| value.max_chars).unwrap_or(8_000).clamp(1_000, 80_000);
    let max_elements = input.as_ref().and_then(|value| value.max_elements).unwrap_or(80).clamp(1, 300);
    let _operation = runtime.operation.lock().await;
    let page = ensure_browser_page(&runtime).await?;
    let snapshot = browser_page_snapshot(&page, max_chars).await?;
    let elements = page_elements(&page, max_elements).await?;
    Ok(BrowserStateOutput {
        title: snapshot.title,
        url: snapshot.url,
        text: snapshot.text,
        truncated: snapshot.truncated,
        elements,
    })
}

#[tauri::command]
async fn browser_search(
    input: BrowserSearchInput,
    runtime: State<'_, BrowserRuntime>,
) -> Result<BrowserSearchOutput, String> {
    let query = input.query.trim();
    if query.is_empty() {
        return Err("搜索词不能为空".into());
    }
    let max_results = input.max_results.unwrap_or(6).clamp(1, 10);
    let search_url = format!(
        "https://www.google.com/search?q={}&hl=zh-CN",
        encode_url_query(query)
    );

    let _operation = runtime.operation.lock().await;
    let page = ensure_browser_page(&runtime).await?;
    page.goto(search_url.as_str())
        .await
        .map_err(|e| format!("打开搜索页失败: {}", e))?;
    page.wait_for_navigation()
        .await
        .map_err(|e| format!("等待搜索页加载失败: {}", e))?;
    tokio::time::sleep(Duration::from_millis(700)).await;
    page.bring_to_front()
        .await
        .map_err(|e| format!("激活浏览器页面失败: {}", e))?;
    let results = google_search_results(&page, max_results).await?;
    Ok(BrowserSearchOutput {
        query: query.to_string(),
        search_url,
        results,
    })
}

#[tauri::command]
async fn browser_click(
    input: BrowserClickInput,
    runtime: State<'_, BrowserRuntime>,
) -> Result<BrowserReadOutput, String> {
    let selector = input.selector.trim();
    if selector.is_empty() {
        return Err("选择器不能为空".into());
    }
    let _operation = runtime.operation.lock().await;
    let page = ensure_browser_page(&runtime).await?;
    let element = page
        .find_element(selector)
        .await
        .map_err(|e| format!("没有找到可点击元素: {}", e))?;
    element
        .click()
        .await
        .map_err(|e| format!("点击元素失败: {}", e))?;
    let _ = timeout(Duration::from_secs(4), page.wait_for_navigation()).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    browser_page_snapshot(&page, 20_000).await
}

#[tauri::command]
async fn browser_type(
    input: BrowserTypeInput,
    runtime: State<'_, BrowserRuntime>,
) -> Result<BrowserReadOutput, String> {
    let selector = input.selector.trim();
    if selector.is_empty() {
        return Err("选择器不能为空".into());
    }
    let _operation = runtime.operation.lock().await;
    let page = ensure_browser_page(&runtime).await?;
    let element = page
        .find_element(selector)
        .await
        .map_err(|e| format!("没有找到输入元素: {}", e))?;
    element
        .click()
        .await
        .map_err(|e| format!("聚焦输入元素失败: {}", e))?;
    element
        .type_str(input.text.as_str())
        .await
        .map_err(|e| format!("输入文字失败: {}", e))?;
    tokio::time::sleep(Duration::from_millis(200)).await;
    browser_page_snapshot(&page, 20_000).await
}

#[tauri::command]
async fn browser_close(runtime: State<'_, BrowserRuntime>) -> Result<BrowserCloseOutput, String> {
    let _operation = runtime.operation.lock().await;
    let session = {
        let mut guard = runtime.session.lock().await;
        guard.take()
    };
    let Some(session) = session else {
        return Ok(BrowserCloseOutput { closed: false });
    };
    close_browser_session(session).await;
    Ok(BrowserCloseOutput { closed: true })
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("你好，{}！韭菜盒子桌面版已就绪。", name)
}

#[tauri::command]
fn save_generated_file(input: SaveGeneratedFileInput) -> Result<SaveGeneratedFileOutput, String> {
    let path = PathBuf::from(input.path);
    let bytes = general_purpose::STANDARD
        .decode(input.data_base64.as_bytes())
        .map_err(|e| format!("导出数据解码失败: {}", e))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建保存目录失败: {}", e))?;
    }
    std::fs::write(&path, &bytes).map_err(|e| format!("保存文件失败: {}", e))?;
    Ok(SaveGeneratedFileOutput {
        path: path.to_string_lossy().to_string(),
        bytes_written: bytes.len(),
    })
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
    let path = std::fs::canonicalize(root)
        .map_err(|e| format!("项目目录不可访问: {}", e))?;
    if !path.is_dir() {
        return Err("项目根路径必须是文件夹".into());
    }
    Ok(path)
}

fn clean_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let value = relative_path.trim();
    if value.is_empty() || value == "." {
        return Ok(PathBuf::new());
    }
    let path = Path::new(value);
    if path.is_absolute() {
        return Err("路径必须是项目内相对路径".into());
    }

    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir => return Err("路径不能跳出项目目录".into()),
            _ => return Err("路径必须是项目内相对路径".into()),
        }
    }
    Ok(clean)
}

fn resolve_existing_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let clean = clean_relative_path(relative_path)?;
    let joined = root.join(clean);
    let canonical = std::fs::canonicalize(&joined)
        .map_err(|e| format!("项目内路径不可访问: {}", e))?;
    if !canonical.starts_with(root) {
        return Err("路径不能跳出项目目录".into());
    }
    Ok(canonical)
}

fn resolve_write_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let clean = clean_relative_path(relative_path)?;
    if clean.as_os_str().is_empty() {
        return Err("写入路径不能是项目根目录".into());
    }
    let joined = root.join(clean);
    let parent = joined.parent().ok_or_else(|| "写入路径无效".to_string())?;
    let canonical_parent = if parent.exists() {
        std::fs::canonicalize(parent).map_err(|e| format!("父目录不可访问: {}", e))?
    } else {
        let existing_parent = parent
            .ancestors()
            .find(|candidate| candidate.exists())
            .ok_or_else(|| "找不到可用父目录".to_string())?;
        std::fs::canonicalize(existing_parent).map_err(|e| format!("父目录不可访问: {}", e))?
    };
    if !canonical_parent.starts_with(root) {
        return Err("路径不能跳出项目目录".into());
    }
    Ok(joined)
}

fn display_relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | ".git" | "target" | "dist" | "dist-desktop" | ".next" | ".nuxt" | "build" | "coverage"
    )
}

fn marker_exists(root: &Path, marker: &str) -> bool {
    root.join(marker).exists()
}

fn push_unique(values: &mut Vec<String>, value: &str) {
    let owned = value.to_string();
    if !values.contains(&owned) {
        values.push(owned);
    }
}

fn detect_package_manager(root: &Path) -> Option<String> {
    if marker_exists(root, "pnpm-lock.yaml") {
        return Some("pnpm".into());
    }
    if marker_exists(root, "yarn.lock") {
        return Some("yarn".into());
    }
    if marker_exists(root, "bun.lockb") || marker_exists(root, "bun.lock") {
        return Some("bun".into());
    }
    if marker_exists(root, "package-lock.json") {
        return Some("npm".into());
    }
    if marker_exists(root, "package.json") {
        return Some("npm".into());
    }
    None
}

fn package_json_scripts(root: &Path) -> Vec<String> {
    let path = root.join("package.json");
    let Ok(content) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Vec::new();
    };
    value
        .get("scripts")
        .and_then(|scripts| scripts.as_object())
        .map(|scripts| scripts.keys().cloned().collect())
        .unwrap_or_default()
}

#[tauri::command]
fn dev_detect_project(input: DevDetectProjectInput) -> Result<DevProjectDetection, String> {
    let root = canonical_root(&input.root)?;
    let mut project_types = Vec::new();
    let mut markers = Vec::new();
    let mut recommended_commands = Vec::new();

    for marker in [
        "package.json",
        "vite.config.ts",
        "vite.config.js",
        "src-tauri/tauri.conf.json",
        "Cargo.toml",
        "pyproject.toml",
        "requirements.txt",
    ] {
        if marker_exists(&root, marker) {
            markers.push(marker.to_string());
        }
    }

    if marker_exists(&root, "package.json") {
        push_unique(&mut project_types, "node");
        let scripts = package_json_scripts(&root);
        if marker_exists(&root, "vite.config.ts") || marker_exists(&root, "vite.config.js") {
            push_unique(&mut project_types, "vite");
        }
        let manager = detect_package_manager(&root).unwrap_or_else(|| "npm".into());
        for script in ["typecheck", "lint", "test", "build"] {
            if scripts.iter().any(|item| item == script) {
                recommended_commands.push(format!("{} run {}", manager, script));
            }
        }
    }

    if marker_exists(&root, "src-tauri/tauri.conf.json") {
        push_unique(&mut project_types, "tauri");
        recommended_commands.push("cargo check --manifest-path src-tauri/Cargo.toml".into());
        if let Some(manager) = detect_package_manager(&root) {
            recommended_commands.push(format!("{} tauri build", manager));
        }
    }

    if marker_exists(&root, "Cargo.toml") {
        push_unique(&mut project_types, "rust");
        recommended_commands.push("cargo check".into());
        recommended_commands.push("cargo test".into());
    }

    if marker_exists(&root, "pyproject.toml") || marker_exists(&root, "requirements.txt") {
        push_unique(&mut project_types, "python");
        recommended_commands.push("pytest".into());
        recommended_commands.push("ruff check .".into());
    }

    Ok(DevProjectDetection {
        project_types,
        markers,
        package_manager: detect_package_manager(&root),
        recommended_commands,
    })
}

#[tauri::command]
fn dev_list_files(input: DevListFilesInput) -> Result<Vec<DevFileEntry>, String> {
    let root = canonical_root(&input.root)?;
    let start = resolve_existing_path(&root, input.relative_path.as_deref().unwrap_or("."))?;
    let max_entries = input.max_entries.unwrap_or(300).clamp(1, 1000);
    let mut entries = Vec::new();
    let mut stack = vec![start];

    while let Some(dir) = stack.pop() {
        if entries.len() >= max_entries {
            break;
        }
        let metadata = std::fs::metadata(&dir).map_err(|e| format!("读取文件信息失败: {}", e))?;
        if metadata.is_file() {
            entries.push(DevFileEntry {
                path: display_relative(&root, &dir),
                is_dir: false,
                size: Some(metadata.len()),
            });
            continue;
        }

        let mut children = std::fs::read_dir(&dir)
            .map_err(|e| format!("读取目录失败: {}", e))?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        children.sort_by_key(|entry| entry.file_name());

        for child in children.into_iter().rev() {
            if entries.len() >= max_entries {
                break;
            }
            let path = child.path();
            let metadata = child.metadata().map_err(|e| format!("读取文件信息失败: {}", e))?;
            let file_name = child.file_name().to_string_lossy().to_string();
            let is_dir = metadata.is_dir();
            entries.push(DevFileEntry {
                path: display_relative(&root, &path),
                is_dir,
                size: if is_dir { None } else { Some(metadata.len()) },
            });
            if is_dir && !should_skip_dir(&file_name) {
                stack.push(path);
            }
        }
    }

    Ok(entries)
}

fn is_probably_text_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if name.starts_with('.') && !matches!(name, ".env" | ".gitignore") {
        return false;
    }
    let Some(ext) = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
    else {
        return matches!(name, "Dockerfile" | "Makefile");
    };
    matches!(
        ext.as_str(),
        "txt" | "md" | "csv" | "json" | "jsonl" | "xml" | "html" | "css" | "scss" | "js" | "jsx" |
        "ts" | "tsx" | "vue" | "svelte" | "py" | "rs" | "go" | "java" | "c" | "cpp" | "h" | "hpp" |
        "sh" | "bash" | "zsh" | "yaml" | "yml" | "toml" | "sql" | "rb" | "php" | "swift" |
        "kt" | "lua" | "ini" | "conf" | "log"
    )
}

#[tauri::command]
fn dev_search_text(input: DevSearchTextInput) -> Result<Vec<DevTextMatch>, String> {
    let root = canonical_root(&input.root)?;
    let start = resolve_existing_path(&root, input.relative_path.as_deref().unwrap_or("."))?;
    let query = input.query.trim();
    if query.is_empty() {
        return Err("搜索关键词不能为空".into());
    }

    let max_results = input.max_results.unwrap_or(80).clamp(1, 300);
    let context_lines = input.context_lines.unwrap_or(1).clamp(0, 3);
    let query_lower = query.to_ascii_lowercase();
    let mut results = Vec::new();
    let mut stack = vec![start];

    while let Some(path) = stack.pop() {
        if results.len() >= max_results {
            break;
        }
        let metadata = std::fs::metadata(&path).map_err(|e| format!("读取文件信息失败: {}", e))?;
        if metadata.is_dir() {
            let mut children = std::fs::read_dir(&path)
                .map_err(|e| format!("读取目录失败: {}", e))?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            children.sort_by_key(|entry| entry.file_name());
            for child in children.into_iter().rev() {
                let child_path = child.path();
                let file_name = child.file_name().to_string_lossy().to_string();
                if child_path.is_dir() && should_skip_dir(&file_name) {
                    continue;
                }
                stack.push(child_path);
            }
            continue;
        }

        if !metadata.is_file() || metadata.len() > 1_000_000 || !is_probably_text_file(&path) {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let lines = content.lines().map(|line| line.to_string()).collect::<Vec<_>>();
        for (index, line) in lines.iter().enumerate() {
            if results.len() >= max_results {
                break;
            }
            if !line.to_ascii_lowercase().contains(&query_lower) {
                continue;
            }
            let before_start = index.saturating_sub(context_lines);
            let after_end = (index + 1 + context_lines).min(lines.len());
            results.push(DevTextMatch {
                path: display_relative(&root, &path),
                line_number: index + 1,
                line: line.clone(),
                before: lines[before_start..index].to_vec(),
                after: lines[index + 1..after_end].to_vec(),
            });
        }
    }

    Ok(results)
}

#[tauri::command]
fn dev_read_file(input: DevReadFileInput) -> Result<DevReadFileOutput, String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_existing_path(&root, &input.relative_path)?;
    if !path.is_file() {
        return Err("读取路径必须是文件".into());
    }
    let max_bytes = input.max_bytes.unwrap_or(120_000).clamp(1, 1_000_000);
    let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败: {}", e))?;
    let truncated = bytes.len() > max_bytes;
    let slice = if truncated { &bytes[..max_bytes] } else { &bytes[..] };
    let content = String::from_utf8_lossy(slice).to_string();
    Ok(DevReadFileOutput {
        path: display_relative(&root, &path),
        content,
        truncated,
        size: bytes.len(),
    })
}

#[tauri::command]
fn dev_read_many_files(input: DevReadManyFilesInput) -> Result<Vec<DevReadFileOutput>, String> {
    let root = canonical_root(&input.root)?;
    let max_bytes = input.max_bytes_per_file.unwrap_or(80_000).clamp(1, 500_000);
    let mut outputs = Vec::new();
    for relative_path in input.paths.iter().take(20) {
        let path = resolve_existing_path(&root, relative_path)?;
        if !path.is_file() {
            return Err(format!("读取路径必须是文件: {}", relative_path));
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败: {}", e))?;
        let truncated = bytes.len() > max_bytes;
        let slice = if truncated { &bytes[..max_bytes] } else { &bytes[..] };
        outputs.push(DevReadFileOutput {
            path: display_relative(&root, &path),
            content: String::from_utf8_lossy(slice).to_string(),
            truncated,
            size: bytes.len(),
        });
    }
    Ok(outputs)
}

#[tauri::command]
fn dev_write_file(input: DevWriteFileInput) -> Result<DevWriteFileOutput, String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_write_path(&root, &input.relative_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    std::fs::write(&path, input.content.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(DevWriteFileOutput {
        path: display_relative(&root, &path),
        bytes_written: input.content.len(),
    })
}

fn build_replacement_diff(path: &str, old_text: &str, new_text: &str) -> String {
    let old_preview = old_text
        .lines()
        .take(20)
        .map(|line| format!("-{}", line))
        .collect::<Vec<_>>()
        .join("\n");
    let new_preview = new_text
        .lines()
        .take(20)
        .map(|line| format!("+{}", line))
        .collect::<Vec<_>>()
        .join("\n");
    format!("--- {}\n+++ {}\n{}\n{}", path, path, old_preview, new_preview)
}

#[tauri::command]
fn dev_replace_in_file(input: DevReplaceInFileInput) -> Result<DevReplaceInFileOutput, String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_existing_path(&root, &input.relative_path)?;
    if !path.is_file() {
        return Err("替换路径必须是文件".into());
    }
    if input.old_text.is_empty() {
        return Err("old_text 不能为空".into());
    }

    let content = std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {}", e))?;
    let matches = content.matches(&input.old_text).count();
    if matches == 0 {
        return Err("未找到 old_text，未写入文件".into());
    }
    let replace_all = input.replace_all.unwrap_or(false);
    if matches > 1 && !replace_all {
        return Err(format!(
            "old_text 命中 {} 处；为避免误改，请提供更精确文本或开启 replace_all",
            matches
        ));
    }

    let next = if replace_all {
        content.replace(&input.old_text, &input.new_text)
    } else {
        content.replacen(&input.old_text, &input.new_text, 1)
    };
    std::fs::write(&path, next.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;
    let display_path = display_relative(&root, &path);
    Ok(DevReplaceInFileOutput {
        path: display_path.clone(),
        replacements: if replace_all { matches } else { 1 },
        bytes_written: next.len(),
        diff: build_replacement_diff(
            &display_path,
            &input.old_text,
            &input.new_text,
        ),
    })
}

#[tauri::command]
fn dev_get_diff(input: DevGetDiffInput) -> Result<DevGetDiffOutput, String> {
    let root = canonical_root(&input.root)?;
    let max_bytes = input.max_bytes.unwrap_or(200_000).clamp(1, 1_000_000);
    let mut command = StdCommand::new("git");
    command.arg("-C").arg(&root).arg("diff").arg("--");

    if let Some(relative_path) = input.relative_path.as_deref() {
        if !relative_path.trim().is_empty() && relative_path.trim() != "." {
            let clean = clean_relative_path(relative_path)?;
            command.arg(clean);
        }
    }

    let output = command
        .output()
        .map_err(|e| format!("读取 Git diff 失败: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let bytes = output.stdout;
    let truncated = bytes.len() > max_bytes;
    let slice = if truncated { &bytes[..max_bytes] } else { &bytes[..] };
    Ok(DevGetDiffOutput {
        source: "git diff".into(),
        diff: String::from_utf8_lossy(slice).to_string(),
        truncated,
    })
}

fn app_media_dir(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?
        .join(name);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建媒体目录失败: {}", e))?;
    std::fs::canonicalize(&dir).map_err(|e| format!("媒体目录不可访问: {}", e))
}

fn sanitize_media_filename(filename: &str, fallback: &str) -> String {
    let raw = Path::new(filename)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback);
    let cleaned = raw
        .chars()
        .map(|ch| {
            if ch.is_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

fn unique_media_filename(filename: &str) -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("{}_{}", now, sanitize_media_filename(filename, "media.bin"))
}

fn media_file_stem(filename: &str) -> String {
    Path::new(filename)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(|value| sanitize_media_filename(value, "media"))
        .unwrap_or_else(|| "media".into())
}

fn strip_data_url_prefix(data: &str) -> &str {
    data.split_once(',').map(|(_, payload)| payload).unwrap_or(data)
}

fn markdown_output_filename(filename: &str) -> String {
    let safe = sanitize_media_filename(filename, "document");
    let base = Path::new(&safe)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .trim_matches('_');
    let base = if base.is_empty() { "document" } else { base };
    format!("{}.md", base)
}

fn converted_output_filename(filename: &str, output_format: &str) -> String {
    let safe = sanitize_media_filename(filename, "document");
    let base = Path::new(&safe)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .trim_matches('_');
    let base = if base.is_empty() { "document" } else { base };
    format!("{}.{}", base, output_format)
}

fn available_output_path(dir: &Path, filename: &str) -> PathBuf {
    let safe = sanitize_media_filename(filename, "document.md");
    let path = dir.join(&safe);
    if !path.exists() {
        return path;
    }

    let stem = Path::new(&safe)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let ext = Path::new(&safe)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("md");

    for index in 2..1000 {
        let candidate = dir.join(format!("{}_{}.{}", stem, index, ext));
        if !candidate.exists() {
            return candidate;
        }
    }

    dir.join(unique_media_filename(&safe))
}

fn meaningful_text_char_count(content: &str) -> usize {
    let mut cleaned = String::with_capacity(content.len());
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("[第") && trimmed.ends_with("页]") {
            continue;
        }
        if trimmed.to_ascii_lowercase().starts_with("[page") && trimmed.ends_with(']') {
            continue;
        }
        for ch in trimmed.chars() {
            if ch.is_alphanumeric() {
                cleaned.push(ch);
            }
        }
    }
    cleaned.chars().count()
}

fn is_meaningful_markdown(content: &str) -> bool {
    meaningful_text_char_count(content) >= 2
}

fn has_meaningful_text_outside_conversion_markers(content: &str) -> bool {
    let mut cleaned = String::with_capacity(content.len());
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("<!--") && trimmed.ends_with("-->") {
            continue;
        }
        if trimmed.starts_with('#') {
            continue;
        }
        if trimmed.starts_with("- 来源文件：")
            || trimmed.starts_with("- 总页数：")
            || trimmed.starts_with("- 已处理页数：")
            || trimmed.starts_with("- OCR 失败页数：")
            || trimmed.starts_with("- 状态：")
        {
            continue;
        }
        if trimmed.starts_with("- 第 ")
            && (trimmed.contains("RapidOCR")
                || trimmed.contains("OCR")
                || trimmed.contains("没有识别到有效正文"))
        {
            continue;
        }
        if trimmed.starts_with('>')
            && (trimmed.contains("本页 OCR 未成功")
                || trimmed.contains("本页未识别到文字")
                || trimmed.contains("OCR 识别失败")
                || trimmed.contains("来源："))
        {
            continue;
        }
        for ch in trimmed.chars() {
            if ch.is_alphanumeric() {
                cleaned.push(ch);
            }
        }
    }
    cleaned.chars().count() >= 2
}

fn is_internal_conversion_failure_markdown(content: &str) -> bool {
    let hard_failure_markers = [
        "RapidOCR 本地引擎不可用",
        "Error importing numpy",
        "OCR 全部页面失败",
        "OCR_CHUNKED_FAILED",
        "LOCAL_CONVERSION_FAILED",
    ];
    if hard_failure_markers.iter().any(|marker| content.contains(marker)) {
        return true;
    }

    let page_count = content.matches("<!-- source-page:").count();
    if page_count == 0 {
        return false;
    }

    let placeholder_count = content.matches("本页 OCR 未成功").count()
        + content.matches("本页未识别到文字").count()
        + content.matches("OCR 识别失败").count();
    placeholder_count >= page_count && !has_meaningful_text_outside_conversion_markers(content)
}

#[cfg_attr(not(test), allow(dead_code))]
fn is_successful_markdown_content(content: &str) -> bool {
    is_meaningful_markdown(content) && !is_internal_conversion_failure_markdown(content)
}

fn is_successful_ocr_markdown(content: &str) -> bool {
    !is_internal_conversion_failure_markdown(content)
        && has_meaningful_text_outside_conversion_markers(content)
}

fn truncate_markdown(content: String, max_chars: usize) -> (String, bool) {
    let max = max_chars.clamp(1, 1_000_000);
    if content.chars().count() <= max {
        return (content, false);
    }
    (content.chars().take(max).collect(), true)
}

fn loose_cache_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(|ch| ch.to_lowercase())
        .collect()
}

async fn count_pdf_pages(source: &Path) -> Option<usize> {
    if source.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("pdf")) != Some(true) {
        return None;
    }
    let mut command = Command::new(resolve_local_python());
    if let Some(python_path) = local_tools_python_path() {
        command.env("PYTHONPATH", python_path.to_string_lossy().to_string());
    }
    command
        .env("PYTHONNOUSERSITE", "1")
        .env_remove("PYTHONHOME")
        .current_dir(env::temp_dir())
        .arg("-c")
        .arg(r#"
import sys

source = sys.argv[1]

try:
    from pypdf import PdfReader
    print(len(PdfReader(source).pages))
    sys.exit(0)
except Exception:
    pass

try:
    import pypdfium2 as pdfium
    print(len(pdfium.PdfDocument(source)))
    sys.exit(0)
except Exception:
    sys.exit(1)
"#)
        .arg(source)
        .kill_on_drop(true);
    let output = match timeout(Duration::from_secs(10), command.output()).await {
        Ok(Ok(output)) => output,
        _ => return None,
    };
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout).trim().parse::<usize>().ok()
}

#[derive(Debug, Clone, Copy)]
struct PdfTextProbe {
    page_count: usize,
    sampled_pages: usize,
    text_pages: usize,
    text_chars: usize,
}

async fn probe_pdf_text_layer(source: &Path) -> Option<PdfTextProbe> {
    if !is_pdf_path(source) {
        return None;
    }

    let mut command = python_command_with_local_tools();
    command
        .arg("-c")
        .arg(r#"
import json
import re
import sys

source = sys.argv[1]

try:
    from pypdf import PdfReader
    reader = PdfReader(source)
    total = len(reader.pages)
    if total <= 0:
        print(json.dumps({"page_count": 0, "sampled_pages": 0, "text_pages": 0, "text_chars": 0}))
        sys.exit(0)

    sample_count = min(total, 12)
    if sample_count == 1:
        indices = [0]
    else:
        indices = sorted(set(round(i * (total - 1) / (sample_count - 1)) for i in range(sample_count)))

    text_pages = 0
    text_chars = 0
    for index in indices:
        try:
            text = reader.pages[index].extract_text() or ""
        except Exception:
            text = ""
        cleaned = re.sub(r"\s+", "", text)
        count = len(cleaned)
        text_chars += count
        if count >= 80:
            text_pages += 1

    print(json.dumps({
        "page_count": total,
        "sampled_pages": len(indices),
        "text_pages": text_pages,
        "text_chars": text_chars,
    }, ensure_ascii=False))
except Exception:
    sys.exit(1)
"#)
        .arg(source)
        .kill_on_drop(true);

    let output = match timeout(Duration::from_secs(20), command.output()).await {
        Ok(Ok(output)) if output.status.success() => output,
        _ => return None,
    };
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    Some(PdfTextProbe {
        page_count: value.get("page_count")?.as_u64()? as usize,
        sampled_pages: value.get("sampled_pages")?.as_u64()? as usize,
        text_pages: value.get("text_pages")?.as_u64()? as usize,
        text_chars: value.get("text_chars")?.as_u64()? as usize,
    })
}

fn pdf_probe_has_text_layer(probe: &PdfTextProbe) -> bool {
    if probe.page_count == 0 || probe.sampled_pages == 0 {
        return false;
    }
    let enough_pages = probe.text_pages >= 2 || probe.text_pages * 2 >= probe.sampled_pages;
    let enough_chars = probe.text_chars >= 400 || probe.text_chars >= probe.sampled_pages * 120;
    enough_pages && enough_chars
}

fn is_meaningful_markitdown_output(content: &str, source: &Path, pdf_probe: Option<&PdfTextProbe>) -> bool {
    if !is_successful_markdown_content(content) {
        return false;
    }
    if !is_pdf_path(source) {
        return true;
    }
    let page_count = pdf_probe.map(|probe| probe.page_count).unwrap_or(1).max(1);
    let text_chars = meaningful_text_char_count(content);
    let min_chars = if page_count >= 30 {
        1_000
    } else if page_count >= 10 {
        350
    } else {
        20
    };
    text_chars >= min_chars
}

fn python_command_with_local_tools() -> Command {
    let mut command = Command::new(resolve_local_python());
    if let Some(python_path) = local_tools_python_path() {
        command.env("PYTHONPATH", python_path.to_string_lossy().to_string());
    }
    command
        .env("PYTHONNOUSERSITE", "1")
        .env_remove("PYTHONHOME")
        .current_dir(env::temp_dir());
    command
}

fn is_pdf_path(source: &Path) -> bool {
    source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

fn is_image_path(source: &Path) -> bool {
    source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" | "tif" | "tiff" | "heic" | "heif"
            )
        })
        .unwrap_or(false)
}

fn source_cache_key(source: &Path) -> String {
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let metadata = std::fs::metadata(source).ok();
    let len = metadata.as_ref().map(|value| value.len()).unwrap_or(0);
    let modified = metadata
        .and_then(|value| value.modified().ok())
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or(0);
    format!("{}_{}_{}", loose_cache_key(stem), len, modified)
}

fn chunk_markdown_cache_path(cache_dir: &Path, source: &Path, start_page: usize, end_page: usize) -> PathBuf {
    cache_dir
        .join("document-markdown-chunks")
        .join(source_cache_key(source))
        .join(format!("p{:04}-p{:04}.md", start_page, end_page))
}

fn read_meaningful_cached_chunk(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    if content.contains("本页 OCR 未成功")
        || content.contains("本页未识别到文字")
        || content.contains("OCR 失败")
        || content.contains("RapidOCR 本地引擎不可用")
    {
        return None;
    }
    if is_successful_ocr_markdown(&content) {
        Some(content)
    } else {
        None
    }
}

fn write_text_file(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败: {}", e))?;
    }
    std::fs::write(path, content).map_err(|e| format!("写入文件失败: {}", e))
}

fn emit_format_progress(
    app: &tauri::AppHandle,
    job_id: Option<&str>,
    source: &Path,
    completed_pages: usize,
    total_pages: usize,
    message: String,
) {
    let progress = if total_pages == 0 {
        0
    } else {
        ((completed_pages as f64 / total_pages as f64) * 100.0).round().clamp(0.0, 100.0) as u8
    };
    let _ = app.emit("format-converter-progress", FormatConverterProgress {
        job_id: job_id.map(|value| value.to_string()),
        source_path: source.to_string_lossy().to_string(),
        completed_pages,
        total_pages,
        progress,
        message,
    });
}

fn placeholder_page_markdown(source_name: &str, page: usize, error: &str) -> String {
    [
        format!("<!-- source-page: {} -->", page),
        format!("## 第 {} 页", page),
        String::new(),
        format!("> 本页 OCR 未成功，已保留占位。原因：{}", error),
        String::new(),
        format!("> 来源：{}", source_name),
        String::new(),
    ].join("\n")
}

fn rapidocr_timeout_for_pages(page_count: usize) -> u64 {
    let per_page = 18u64;
    (30 + page_count as u64 * per_page).clamp(60, 240)
}

async fn run_rapidocr_to_markdown(
    app: &tauri::AppHandle,
    jobs: &ConversionJobs,
    job_id: Option<&str>,
    source: &Path,
    output_path: &Path,
    start_page: usize,
    end_page: usize,
    completed_offset: usize,
    total_pages: usize,
    timeout_secs: u64,
) -> Result<String, String> {
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建 OCR 输出目录失败: {}", e))?;
    }
    let script = r#"
import os
import json
import sys
import traceback

source = sys.argv[1]
start_page = int(sys.argv[2])
end_page = int(sys.argv[3])
output_path = sys.argv[4]

def fail(message):
    sys.stderr.write(message + "\n")
    sys.exit(1)

try:
    from rapidocr_onnxruntime import RapidOCR
    from PIL import Image, ImageSequence
except Exception as exc:
    fail("RapidOCR 本地引擎不可用：" + str(exc))

def clean_text(value):
    return "\n".join(line.strip() for line in str(value or "").splitlines() if line.strip())

def ocr_image(engine, image):
    try:
        image = image.convert("RGB")
        result, _elapsed = engine(image)
    except Exception as exc:
        return "", "OCR 识别失败：" + str(exc)
    lines = []
    for item in result or []:
        try:
            text = item[1]
        except Exception:
            text = ""
        text = clean_text(text)
        if text:
            lines.append(text)
    return "\n".join(lines).strip(), ""

def page_section(page_label, text, error=""):
    body = text.strip()
    if not body:
        body = "> 本页未识别到文字。" if not error else "> " + error
    return f"<!-- source-page: {page_label} -->\n## 第 {page_label} 页\n\n{body}\n"

sections = []
engine = RapidOCR()
ext = os.path.splitext(source)[1].lower()

try:
    if ext == ".pdf":
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(source)
        total = len(pdf)
        start = max(1, start_page)
        end = min(max(start, end_page), total)
        for page_number in range(start, end + 1):
            page = pdf[page_number - 1]
            image = page.render(scale=2.0).to_pil()
            text, error = ocr_image(engine, image)
            print(json.dumps({"page": page_number, "chars": len(text), "lines": len(text.splitlines())}, ensure_ascii=False), flush=True)
            sections.append(page_section(str(page_number), text, error))
    else:
        image = Image.open(source)
        index = 0
        for frame in ImageSequence.Iterator(image):
            index += 1
            text, error = ocr_image(engine, frame)
            label = str(index)
            print(json.dumps({"page": index, "chars": len(text), "lines": len(text.splitlines())}, ensure_ascii=False), flush=True)
            sections.append(page_section(label, text, error))
        if index == 0:
            text, error = ocr_image(engine, image)
            print(json.dumps({"page": 1, "chars": len(text), "lines": len(text.splitlines())}, ensure_ascii=False), flush=True)
            sections.append(page_section("1", text, error))
except Exception:
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)

content = "\n".join(sections).strip() + "\n"
with open(output_path, "w", encoding="utf-8") as handle:
    handle.write(content)
"#;

    let page_count = end_page.saturating_sub(start_page).saturating_add(1);
    let mut command = python_command_with_local_tools();
    command
        .env("PYTHONIOENCODING", "utf-8")
        .arg("-c")
        .arg(script)
        .arg(source)
        .arg(start_page.to_string())
        .arg(end_page.to_string())
        .arg(output_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|e| format!("RapidOCR 启动失败: {}", e))?;
    jobs.register_pid(job_id, child.id()).await;
    let stdout = child.stdout.take().ok_or_else(|| "RapidOCR stdout 初始化失败。".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "RapidOCR stderr 初始化失败。".to_string())?;
    let mut stdout_lines = BufReader::new(stdout).lines();
    let stderr_task = tokio::spawn(async move {
        let mut stderr_text = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut stderr_text).await;
        stderr_text
    });

    let read_result = timeout(Duration::from_secs(timeout_secs), async {
        while let Some(line) = stdout_lines
            .next_line()
            .await
            .map_err(|e| format!("读取 RapidOCR 进度失败: {}", e))?
        {
            if jobs.is_cancelled(job_id).await {
                return Err("转换已取消。".to_string());
            }
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            let page = value.get("page").and_then(|value| value.as_u64()).unwrap_or(start_page as u64) as usize;
            let completed = completed_offset + page.saturating_sub(start_page).saturating_add(1);
            emit_format_progress(
                app,
                job_id,
                source,
                completed.min(total_pages),
                total_pages,
                format!("正在 OCR 第 {} 页（本段 {}-{}）", page, start_page, end_page),
            );
        }
        Ok::<(), String>(())
    }).await;

    match read_result {
        Ok(Ok(())) => {}
        Ok(Err(err)) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            jobs.clear_pid(job_id).await;
            let _ = stderr_task.await;
            return Err(err);
        }
        Err(_) => {
            let _ = child.start_kill();
            let _ = child.wait().await;
            jobs.clear_pid(job_id).await;
            let _ = stderr_task.await;
            return Err(format!("RapidOCR 执行超时（{} 页，{} 秒）", page_count, timeout_secs));
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("RapidOCR 等待失败: {}", e))?;
    jobs.clear_pid(job_id).await;
    let stderr = stderr_task.await.unwrap_or_default().trim().to_string();
    if jobs.is_cancelled(job_id).await {
        return Err("转换已取消。".into());
    }
    if !status.success() {
        return Err(if stderr.is_empty() {
            "RapidOCR 转换失败。".into()
        } else {
            format!("RapidOCR 转换失败: {}", stderr)
        });
    }
    let content = std::fs::read_to_string(output_path)
        .map_err(|e| format!("读取 RapidOCR 输出失败: {}", e))?;
    if !is_successful_ocr_markdown(&content) {
        return Err("RapidOCR 没有识别到有效正文。".into());
    }
    Ok(content)
}

fn build_ocr_markdown(
    source: &Path,
    total_pages: usize,
    failures: &[String],
    pages: &[(usize, String)],
    completed_pages: usize,
    final_pass: bool,
) -> String {
    let source_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document");
    let title = Path::new(source_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(source_name);
    let mut merged = Vec::new();
    merged.push(format!("# {}", title));
    merged.push(String::new());
    merged.push(format!("- 来源文件：{}", source.to_string_lossy()));
    merged.push(format!("- 总页数：{}", total_pages));
    merged.push(format!("- 已处理页数：{}", completed_pages.min(total_pages)));
    merged.push(format!("- OCR 失败页数：{}", failures.len()));
    if !final_pass {
        merged.push("- 状态：正在转换，已完成内容会持续追加。".into());
    }
    merged.push(String::new());
    if !failures.is_empty() {
        merged.push("## OCR 失败页".into());
        for failure in failures {
            merged.push(format!("- {}", failure));
        }
        merged.push(String::new());
    }
    for (_, content) in pages {
        merged.push(content.clone());
    }
    merged.join("\n")
}

fn summarize_ocr_failures(failures: &[String]) -> String {
    let mut summary: Vec<String> = Vec::new();
    for failure in failures {
        let reason = failure
            .split_once('：')
            .map(|(_, value)| value.trim())
            .unwrap_or(failure.trim());
        if reason.is_empty() || summary.iter().any(|item| item == reason) {
            continue;
        }
        summary.push(reason.to_string());
        if summary.len() >= 3 {
            break;
        }
    }
    if summary.is_empty() {
        "OCR 没有识别到有效正文。".into()
    } else {
        summary.join("；")
    }
}

async fn chunked_pdf_ocr_to_markdown(
    app: &tauri::AppHandle,
    jobs: &ConversionJobs,
    job_id: Option<&str>,
    source: &Path,
    output_path: &Path,
    total_pages: usize,
    max_chars: usize,
    timeout_seconds: Option<u64>,
) -> Result<(String, bool, usize, usize), String> {
    let cache_root = app_media_dir(app, "document-markdown-outputs")?;
    let work_root = cache_root
        .join("document-markdown-jobs")
        .join(source_cache_key(source));
    std::fs::create_dir_all(&work_root).map_err(|e| format!("创建 OCR 任务目录失败: {}", e))?;

    let source_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .to_string();
    let mut pending = VecDeque::new();
    let initial_chunk = 10usize;
    let mut start = 1usize;
    while start <= total_pages {
        let end = (start + initial_chunk - 1).min(total_pages);
        pending.push_back((start, end));
        start = end + 1;
    }

    let mut completed_pages = 0usize;
    let mut failures: Vec<String> = Vec::new();
    let mut pages: Vec<(usize, String)> = Vec::new();
    let started_at = Instant::now();
    emit_format_progress(app, job_id, source, 0, total_pages, "正在准备分段 OCR".into());

    while let Some((range_start, range_end)) = pending.pop_front() {
        if jobs.is_cancelled(job_id).await {
            emit_format_progress(app, job_id, source, completed_pages, total_pages, "转换已取消".into());
            return Err("转换已取消。".into());
        }
        if let Some(limit) = timeout_seconds {
            if started_at.elapsed() > Duration::from_secs(limit.max(30)) {
                emit_format_progress(app, job_id, source, completed_pages, total_pages, "转换超时，已停止队列任务".into());
                return Err(format!("转换超时（{} 分钟），已停止转换。", limit.max(30) / 60));
            }
        }
        let page_count = range_end - range_start + 1;
        let cache_path = chunk_markdown_cache_path(&cache_root, source, range_start, range_end);
        if let Some(content) = read_meaningful_cached_chunk(&cache_path) {
            completed_pages += page_count;
            pages.push((range_start, content));
            emit_format_progress(
                app,
                job_id,
                source,
                completed_pages,
                total_pages,
                format!("已复用第 {}-{} 页缓存", range_start, range_end),
            );
            continue;
        }

        emit_format_progress(
            app,
            job_id,
            source,
            completed_pages,
            total_pages,
            format!("正在 OCR 第 {}-{} 页", range_start, range_end),
        );

        match run_rapidocr_to_markdown(
            app,
            jobs,
            job_id,
            source,
            &cache_path,
            range_start,
            range_end,
            completed_pages,
            total_pages,
            rapidocr_timeout_for_pages(page_count),
        ).await {
            Ok(content) => {
                let content = [
                    format!("<!-- source-pages: {}-{} -->", range_start, range_end),
                    format!("## 第 {}-{} 页", range_start, range_end),
                    String::new(),
                    content,
                    String::new(),
                ].join("\n");
                write_text_file(&cache_path, &content)?;
                completed_pages += page_count;
                pages.push((range_start, content));
                pages.sort_by_key(|(page, _)| *page);
                let partial = build_ocr_markdown(
                    source,
                    total_pages,
                    &failures,
                    &pages,
                    completed_pages,
                    false,
                );
                write_text_file(output_path, &partial)?;
                emit_format_progress(
                    app,
                    job_id,
                    source,
                    completed_pages,
                    total_pages,
                    format!("已完成第 {}-{} 页", range_start, range_end),
                );
            }
            Err(err) => {
                if page_count > 1 {
                    let mid = (range_start + range_end) / 2;
                    pending.push_front((mid + 1, range_end));
                    pending.push_front((range_start, mid));
                    emit_format_progress(
                        app,
                        job_id,
                        source,
                        completed_pages,
                        total_pages,
                        format!("第 {}-{} 页 OCR 未完成，已自动细拆", range_start, range_end),
                    );
                } else {
                    let placeholder = placeholder_page_markdown(&source_name, range_start, &err);
                    write_text_file(&cache_path, &placeholder)?;
                    failures.push(format!("第 {} 页：{}", range_start, err));
                    completed_pages += 1;
                    pages.push((range_start, placeholder));
                    pages.sort_by_key(|(page, _)| *page);
                    let partial = build_ocr_markdown(
                        source,
                        total_pages,
                        &failures,
                        &pages,
                        completed_pages,
                        false,
                    );
                    write_text_file(output_path, &partial)?;
                    emit_format_progress(
                        app,
                        job_id,
                        source,
                        completed_pages,
                        total_pages,
                        format!("第 {} 页 OCR 失败，已写入占位", range_start),
                    );
                }
            }
        }
    }

    pages.sort_by_key(|(page, _)| *page);
    let full_content = build_ocr_markdown(source, total_pages, &failures, &pages, total_pages, true);
    write_text_file(output_path, &full_content)?;
    if total_pages > 0 && failures.len() >= total_pages {
        let _ = std::fs::remove_file(output_path);
        emit_format_progress(app, job_id, source, total_pages, total_pages, "OCR 全部页面失败".into());
        return Err(format!(
            "RapidOCR 全部页面失败（{}/{}）：{}",
            failures.len(),
            total_pages,
            summarize_ocr_failures(&failures),
        ));
    }
    let (content, truncated) = truncate_markdown(full_content, max_chars);
    emit_format_progress(app, job_id, source, total_pages, total_pages, "Markdown 已合并完成".into());
    Ok((content, truncated, total_pages, failures.len()))
}

async fn image_ocr_to_markdown(
    app: &tauri::AppHandle,
    jobs: &ConversionJobs,
    job_id: Option<&str>,
    source: &Path,
    output_path: &Path,
    max_chars: usize,
) -> Result<(String, bool), String> {
    emit_format_progress(app, job_id, source, 0, 1, "正在 OCR 识别图片".into());
    let temp_output = output_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!(
            "{}.rapidocr.tmp.md",
            output_path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("image")
        ));
    let content = run_rapidocr_to_markdown(app, jobs, job_id, source, &temp_output, 1, 1, 0, 1, 120).await?;
    let pages = vec![(1usize, content)];
    let full_content = build_ocr_markdown(source, 1, &[], &pages, 1, true);
    write_text_file(output_path, &full_content)?;
    let _ = std::fs::remove_file(temp_output);
    let (content, truncated) = truncate_markdown(full_content, max_chars);
    emit_format_progress(app, job_id, source, 1, 1, "Markdown 已合并完成".into());
    Ok((content, truncated))
}

async fn run_markitdown(source: &Path, output_path: &Path) -> Result<(String, String, String), String> {
    let output = timeout(
        Duration::from_secs(90),
        Command::new(resolve_local_binary("markitdown"))
            .arg(source)
            .arg("-o")
            .arg(output_path)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "MarkItDown 执行超时（90 秒），请先转成 Markdown/TXT 后再导入。".to_string())?
    .map_err(|e| format!("未检测到 MarkItDown，请先安装：pipx install markitdown 或 pip install markitdown。启动失败: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!("MarkItDown 转换失败: {}", stderr.trim()));
    }
    let content = std::fs::read_to_string(output_path)
        .map_err(|e| format!("读取 MarkItDown 输出失败: {}", e))?;
    Ok((content, stdout, stderr))
}

fn parse_markdown_conversion_mode(value: Option<&str>) -> MarkdownConversionMode {
    match value.unwrap_or("auto").trim().to_ascii_lowercase().as_str() {
        "fast" | "markitdown" => MarkdownConversionMode::Fast,
        "ocr" | "rapidocr" => MarkdownConversionMode::Ocr,
        _ => MarkdownConversionMode::Auto,
    }
}

fn normalize_output_format(value: Option<&str>) -> String {
    match value.unwrap_or("md").trim().trim_start_matches('.').to_ascii_lowercase().as_str() {
        "markdown" => "md".into(),
        "md" | "txt" | "html" | "csv" | "json" | "srt" => value.unwrap_or("md").trim().trim_start_matches('.').to_ascii_lowercase(),
        _ => "md".into(),
    }
}

fn strip_markdown_for_plain_text(markdown: &str) -> String {
    let mut out = String::new();
    let mut in_code = false;
    for line in markdown.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        let mut value = if in_code {
            line.to_string()
        } else {
            trimmed
                .trim_start_matches('#')
                .trim_start_matches('>')
                .trim_start_matches("- ")
                .trim_start_matches("* ")
                .replace("**", "")
                .replace("__", "")
                .replace('`', "")
                .replace('*', "")
                .replace('_', "")
        };
        if value.starts_with("![") {
            continue;
        }
        while let Some(start) = value.find('[') {
            let Some(mid) = value[start..].find("](").map(|index| start + index) else { break };
            let Some(end) = value[mid + 2..].find(')').map(|index| mid + 2 + index) else { break };
            let label = value[start + 1..mid].to_string();
            value.replace_range(start..=end, &label);
        }
        if !value.trim().is_empty() {
            out.push_str(value.trim());
            out.push('\n');
        }
    }
    out
}

fn escape_html_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn markdown_to_simple_html(markdown: &str) -> String {
    let mut body = String::new();
    let mut in_code = false;
    for line in markdown.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            if in_code {
                body.push_str("</code></pre>\n");
            } else {
                body.push_str("<pre><code>");
            }
            in_code = !in_code;
            continue;
        }
        if in_code {
            body.push_str(&escape_html_text(line));
            body.push('\n');
            continue;
        }
        if trimmed.is_empty() {
            continue;
        }
        if let Some(heading) = trimmed.strip_prefix("###### ") {
            body.push_str(&format!("<h6>{}</h6>\n", escape_html_text(heading)));
        } else if let Some(heading) = trimmed.strip_prefix("##### ") {
            body.push_str(&format!("<h5>{}</h5>\n", escape_html_text(heading)));
        } else if let Some(heading) = trimmed.strip_prefix("#### ") {
            body.push_str(&format!("<h4>{}</h4>\n", escape_html_text(heading)));
        } else if let Some(heading) = trimmed.strip_prefix("### ") {
            body.push_str(&format!("<h3>{}</h3>\n", escape_html_text(heading)));
        } else if let Some(heading) = trimmed.strip_prefix("## ") {
            body.push_str(&format!("<h2>{}</h2>\n", escape_html_text(heading)));
        } else if let Some(heading) = trimmed.strip_prefix("# ") {
            body.push_str(&format!("<h1>{}</h1>\n", escape_html_text(heading)));
        } else {
            body.push_str(&format!("<p>{}</p>\n", escape_html_text(trimmed)));
        }
    }
    format!(
        "<!doctype html>\n<html lang=\"zh-CN\">\n<head><meta charset=\"utf-8\"><title>韭菜盒子转换</title></head>\n<body>\n{}</body>\n</html>\n",
        body
    )
}

fn split_markdown_table_row(line: &str) -> Vec<String> {
    line.trim()
        .trim_matches('|')
        .split('|')
        .map(|cell| cell.trim().replace("\\|", "|"))
        .collect()
}

fn is_markdown_table_separator(line: &str) -> bool {
    line.trim()
        .trim_matches('|')
        .split('|')
        .all(|cell| cell.trim().chars().all(|ch| matches!(ch, '-' | ':' | ' ')) && cell.contains('-'))
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn markdown_table_to_csv(markdown: &str) -> Option<String> {
    let lines = markdown.lines().collect::<Vec<_>>();
    for index in 0..lines.len().saturating_sub(1) {
        if !lines[index].contains('|') || !is_markdown_table_separator(lines[index + 1]) {
            continue;
        }
        let mut rows = vec![split_markdown_table_row(lines[index])];
        let mut cursor = index + 2;
        while cursor < lines.len() && lines[cursor].contains('|') && !lines[cursor].trim().is_empty() {
            rows.push(split_markdown_table_row(lines[cursor]));
            cursor += 1;
        }
        if rows.len() < 2 {
            return None;
        }
        let csv = rows
            .into_iter()
            .map(|row| row.into_iter().map(|cell| csv_escape(&cell)).collect::<Vec<_>>().join(","))
            .collect::<Vec<_>>()
            .join("\n");
        return Some(format!("{}\n", csv));
    }
    None
}

fn strip_single_code_fence(content: &str, lang: &str) -> String {
    let trimmed = content.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with(&format!("```{}", lang)) && trimmed.ends_with("```") {
        let without_start = trimmed.lines().skip(1).collect::<Vec<_>>().join("\n");
        return without_start.trim_end_matches("```").trim().to_string();
    }
    if trimmed.starts_with("```") && trimmed.ends_with("```") {
        let without_start = trimmed.lines().skip(1).collect::<Vec<_>>().join("\n");
        return without_start.trim_end_matches("```").trim().to_string();
    }
    trimmed.to_string()
}

fn looks_like_srt(content: &str) -> bool {
    content.contains("-->")
        && content.lines().any(|line| line.trim().parse::<usize>().is_ok())
}

fn convert_markdown_for_output(output_format: &str, markdown: &str) -> Result<String, String> {
    match output_format {
        "md" => Ok(markdown.trim_end().to_string() + "\n"),
        "txt" => Ok(strip_markdown_for_plain_text(markdown)),
        "html" => Ok(markdown_to_simple_html(markdown)),
        "csv" => {
            let plain = strip_markdown_for_plain_text(markdown);
            if plain.lines().take(5).filter(|line| line.contains(',')).count() >= 2 {
                return Ok(plain);
            }
            markdown_table_to_csv(markdown).ok_or_else(|| "没有检测到可导出 CSV 的表格内容。".into())
        }
        "json" => {
            let candidate = strip_single_code_fence(markdown, "json");
            let value: serde_json::Value = serde_json::from_str(&candidate)
                .map_err(|_| "没有检测到有效 JSON 内容。".to_string())?;
            serde_json::to_string_pretty(&value)
                .map(|value| format!("{}\n", value))
                .map_err(|e| format!("JSON 格式化失败: {}", e))
        }
        "srt" => {
            let candidate = strip_single_code_fence(markdown, "srt");
            if looks_like_srt(&candidate) {
                Ok(candidate.trim_end().to_string() + "\n")
            } else {
                Err("没有检测到有效 SRT 字幕内容。".into())
            }
        }
        _ => Ok(markdown.trim_end().to_string() + "\n"),
    }
}

fn resolve_cached_media_path(app: &tauri::AppHandle, input_path: &str) -> Result<PathBuf, String> {
    let cache_dir = app_media_dir(app, "media-cache")?;
    let path = std::fs::canonicalize(input_path)
        .map_err(|e| format!("媒体缓存文件不可访问: {}", e))?;
    if !path.starts_with(&cache_dir) {
        return Err("只能处理韭菜盒子缓存中的媒体文件，请重新上传后再试。".into());
    }
    if !path.is_file() {
        return Err("媒体输入路径必须是文件".into());
    }
    Ok(path)
}

fn audio_codec(format: &str) -> &'static str {
    match format {
        "wav" => "pcm_s16le",
        "flac" => "flac",
        "ogg" => "libvorbis",
        "aac" => "aac",
        _ => "libmp3lame",
    }
}

fn supported_media_format(format: &str) -> bool {
    matches!(
        format,
        "mp4" | "mov" | "webm" | "mkv" | "mp3" | "wav" | "aac" | "flac" | "ogg"
    )
}

fn build_ffmpeg_args(input: &MediaProcessFileInput, source: &Path, output: &Path) -> Result<Vec<String>, String> {
    let action = input.action.trim().to_ascii_lowercase();
    let format = input.target_format.trim().trim_start_matches('.').to_ascii_lowercase();
    if !supported_media_format(&format) {
        return Err(format!("不支持的目标格式: {}", format));
    }

    let source_str = source.to_string_lossy().to_string();
    let output_str = output.to_string_lossy().to_string();
    let mut args = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-i".into(),
        source_str,
    ];

    match action.as_str() {
        "compress" => {
            let crf = input.crf.unwrap_or(23).clamp(18, 35).to_string();
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-crf".into(),
                crf,
                "-preset".into(),
                "medium".into(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "128k".into(),
                output_str,
            ]);
        }
        "convert" => {
            match format.as_str() {
                "webm" => args.extend([
                    "-c:v".into(),
                    "libvpx-vp9".into(),
                    "-c:a".into(),
                    "libopus".into(),
                ]),
                "mkv" => args.extend(["-c".into(), "copy".into()]),
                "mp3" | "wav" | "aac" | "flac" | "ogg" => args.extend([
                    "-vn".into(),
                    "-acodec".into(),
                    audio_codec(&format).into(),
                ]),
                _ => args.extend([
                    "-c:v".into(),
                    "libx264".into(),
                    "-c:a".into(),
                    "aac".into(),
                ]),
            }
            args.push(output_str);
        }
        "extract_audio" => {
            args.extend([
                "-vn".into(),
                "-acodec".into(),
                audio_codec(&format).into(),
                output_str,
            ]);
        }
        "trim" => {
            let start = input.start_seconds.unwrap_or(0.0).max(0.0);
            let Some(end) = input.end_seconds else {
                return Err("截取媒体需要提供 end_seconds。".into());
            };
            if end <= start {
                return Err("end_seconds 必须大于 start_seconds。".into());
            }
            args.extend([
                "-ss".into(),
                format!("{:.3}", start),
                "-to".into(),
                format!("{:.3}", end),
                "-c".into(),
                "copy".into(),
                output_str,
            ]);
        }
        "mute" => {
            args.extend([
                "-an".into(),
                "-c:v".into(),
                "copy".into(),
                output_str,
            ]);
        }
        _ => return Err(format!("不支持的媒体处理动作: {}", action)),
    }

    Ok(args)
}

fn supported_transcript_format(format: &str) -> bool {
    matches!(format, "txt" | "srt" | "vtt" | "json")
}

fn find_transcript_output(output_dir: &Path, stem: &str, format: &str) -> Option<PathBuf> {
    let direct = output_dir.join(format!("{}.{}", stem, format));
    if direct.exists() {
        return Some(direct);
    }
    let mut candidates = std::fs::read_dir(output_dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some(format))
        .filter_map(|path| {
            let modified = std::fs::metadata(&path).ok()?.modified().ok()?;
            Some((modified, path))
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|(modified, _)| *modified);
    candidates.pop().map(|(_, path)| path)
}

fn escape_subtitle_filter_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace(':', "\\:")
}

#[tauri::command]
fn media_cache_file(app: tauri::AppHandle, input: MediaCacheFileInput) -> Result<MediaCacheFileOutput, String> {
    let cache_dir = app_media_dir(&app, "media-cache")?;
    let filename = unique_media_filename(&input.filename);
    let path = cache_dir.join(&filename);
    let payload = strip_data_url_prefix(input.data_base64.trim());
    let bytes = general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("媒体文件解码失败: {}", e))?;
    std::fs::write(&path, &bytes).map_err(|e| format!("缓存媒体文件失败: {}", e))?;
    let size = std::fs::metadata(&path).map_err(|e| format!("读取媒体缓存失败: {}", e))?.len();
    Ok(MediaCacheFileOutput {
        input_path: path.to_string_lossy().to_string(),
        filename,
        size,
    })
}

async fn convert_pdf_to_markdown(
    app: &tauri::AppHandle,
    jobs: &ConversionJobs,
    job_id: Option<&str>,
    source_path: &Path,
    output_path: &Path,
    max_chars: usize,
    mode: MarkdownConversionMode,
    timeout_seconds: Option<u64>,
) -> Result<MarkdownConversion, String> {
    if mode == MarkdownConversionMode::Ocr {
        let page_count = count_pdf_pages(source_path).await
            .ok_or_else(|| "OCR 模式读取 PDF 页数失败，未启动转换。".to_string())?;
        let (content, truncated, pages, failures) =
            chunked_pdf_ocr_to_markdown(app, jobs, job_id, source_path, output_path, page_count, max_chars, timeout_seconds).await?;
        return Ok(MarkdownConversion {
            content,
            engine: "rapidocr_chunked".into(),
            truncated,
            message: format!("已完成本地 PDF OCR 转 Markdown：{} 页，失败占位 {} 页。", pages, failures),
        });
    }

    emit_format_progress(app, job_id, source_path, 0, 0, "正在判断文档类型".into());
    let probe = probe_pdf_text_layer(source_path).await;
    let mut markitdown_error: Option<String> = None;
    let mut markitdown_attempted = false;

    if mode == MarkdownConversionMode::Fast || probe.as_ref().map(pdf_probe_has_text_layer).unwrap_or(false) {
        markitdown_attempted = true;
        let message = if mode == MarkdownConversionMode::Fast {
            "快速转换中"
        } else {
            "检测到文字层，快速转换中"
        };
        emit_format_progress(app, job_id, source_path, 0, 0, message.into());
        match run_markitdown(source_path, output_path).await {
            Ok((content, _stdout, _stderr)) => {
                if is_meaningful_markitdown_output(&content, source_path, probe.as_ref()) {
                    let (content, truncated) = truncate_markdown(content, max_chars);
                    return Ok(MarkdownConversion {
                        content,
                        engine: "markitdown".into(),
                        truncated,
                        message: "已使用本地快速转换生成 Markdown。".into(),
                    });
                }
                let _ = std::fs::remove_file(output_path);
                markitdown_error = Some("PDF 文字层不完整，本地快速转换没有得到足够正文。".into());
            }
            Err(err) => {
                let _ = std::fs::remove_file(output_path);
                markitdown_error = Some(err);
            }
        }
    }

    if mode == MarkdownConversionMode::Fast {
        return Err(markitdown_error.unwrap_or_else(|| "快速模式没有提取到有效正文，请切换 OCR 模式。".into()));
    }

    let page_count = match probe.map(|value| value.page_count).filter(|value| *value > 0) {
        Some(value) => Some(value),
        None => count_pdf_pages(source_path).await,
    };

    if let Some(page_count) = page_count {
        emit_format_progress(app, job_id, source_path, 0, page_count, "未检测到有效文字层，进入分段 OCR".into());
        let (content, truncated, pages, failures) =
            chunked_pdf_ocr_to_markdown(app, jobs, job_id, source_path, output_path, page_count, max_chars, timeout_seconds).await?;
        return Ok(MarkdownConversion {
            content,
            engine: "rapidocr_chunked".into(),
            truncated,
            message: format!("已完成本地 PDF OCR 转 Markdown：{} 页，失败占位 {} 页。", pages, failures),
        });
    }

    if !markitdown_attempted {
        match run_markitdown(source_path, output_path).await {
            Ok((content, _stdout, _stderr)) => {
                if is_meaningful_markitdown_output(&content, source_path, probe.as_ref()) {
                    let (content, truncated) = truncate_markdown(content, max_chars);
                    return Ok(MarkdownConversion {
                        content,
                        engine: "markitdown".into(),
                        truncated,
                        message: "已使用本地快速转换生成 Markdown。".into(),
                    });
                }
                let _ = std::fs::remove_file(output_path);
                markitdown_error = Some("PDF 页数读取失败，且本地快速转换没有得到有效正文。".into());
            }
            Err(err) => {
                let _ = std::fs::remove_file(output_path);
                markitdown_error = Some(err);
            }
        }
    }

    Err(markitdown_error.unwrap_or_else(|| "PDF 页数读取失败，无法执行分段 OCR。".into()))
}

async fn convert_source_to_markdown(
    app: &tauri::AppHandle,
    jobs: &ConversionJobs,
    job_id: Option<&str>,
    source_path: &Path,
    output_path: &Path,
    max_chars: usize,
    mode: MarkdownConversionMode,
    timeout_seconds: Option<u64>,
) -> Result<MarkdownConversion, String> {
    if is_pdf_path(source_path) {
        return convert_pdf_to_markdown(app, jobs, job_id, source_path, output_path, max_chars, mode, timeout_seconds).await;
    }

    if is_image_path(source_path) {
        if mode == MarkdownConversionMode::Fast {
            return Err("快速模式不支持图片文字识别，请切换 OCR 模式。".into());
        }
        let (content, truncated) = image_ocr_to_markdown(app, jobs, job_id, source_path, output_path, max_chars).await?;
        return Ok(MarkdownConversion {
            content,
            engine: "rapidocr_image".into(),
            truncated,
            message: "已完成本地图片 OCR 转 Markdown。".into(),
        });
    }

    if mode == MarkdownConversionMode::Ocr {
        return Err("OCR 模式仅支持 PDF 和图片文件。".into());
    }

    match run_markitdown(source_path, output_path).await {
        Ok((content, _stdout, _stderr)) => {
            if is_meaningful_markitdown_output(&content, source_path, None) {
                let (content, truncated) = truncate_markdown(content, max_chars);
                Ok(MarkdownConversion {
                    content,
                    engine: "markitdown".into(),
                    truncated,
                    message: "已使用本地快速转换生成 Markdown。".into(),
                })
            } else {
                let _ = std::fs::remove_file(output_path);
                Err("本地快速转换没有提取到有效正文。".into())
            }
        }
        Err(err) => {
            let _ = std::fs::remove_file(output_path);
            Err(err)
        }
    }
}

fn markdown_success_output(
    source: String,
    source_path: &Path,
    output_path: &Path,
    fallback_filename: &str,
    conversion: MarkdownConversion,
) -> DocumentToMarkdownFileOutput {
    DocumentToMarkdownFileOutput {
        status: "success".into(),
        source,
        filename: output_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(fallback_filename)
            .to_string(),
        content: conversion.content,
        engine: conversion.engine,
        source_path: source_path.to_string_lossy().to_string(),
        output_path: output_path.to_string_lossy().to_string(),
        truncated: conversion.truncated,
        message: conversion.message,
        error: None,
    }
}

fn markdown_error_output(
    source: String,
    source_path: &Path,
    output_path: &Path,
    fallback_filename: &str,
    message: String,
) -> DocumentToMarkdownFileOutput {
    DocumentToMarkdownFileOutput {
        status: "error".into(),
        source,
        filename: output_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(fallback_filename)
            .to_string(),
        content: String::new(),
        engine: "unsupported".into(),
        source_path: source_path.to_string_lossy().to_string(),
        output_path: output_path.to_string_lossy().to_string(),
        truncated: false,
        message: message.clone(),
        error: Some(message),
    }
}

fn finalize_markdown_conversion_output(
    source_name: String,
    source_path: &Path,
    markdown_path: &Path,
    final_path: &Path,
    fallback_filename: &str,
    output_format: &str,
    mut conversion: MarkdownConversion,
    max_chars: usize,
) -> Result<DocumentToMarkdownFileOutput, String> {
    if output_format == "md" {
        return Ok(markdown_success_output(
            source_name,
            source_path,
            final_path,
            fallback_filename,
            conversion,
        ));
    }

    let markdown = std::fs::read_to_string(markdown_path)
        .unwrap_or_else(|_| conversion.content.clone());
    let output_content = convert_markdown_for_output(output_format, &markdown)?;
    write_text_file(final_path, &output_content)?;
    let _ = std::fs::remove_file(markdown_path);
    let (content, truncated) = truncate_markdown(output_content, max_chars);
    conversion.content = content;
    conversion.truncated = truncated;
    conversion.message = format!("已生成 {} 文件。", output_format.to_uppercase());

    Ok(markdown_success_output(
        source_name,
        source_path,
        final_path,
        fallback_filename,
        conversion,
    ))
}

#[tauri::command]
async fn document_to_markdown_file(
    app: tauri::AppHandle,
    jobs: State<'_, ConversionJobs>,
    input: DocumentToMarkdownFileInput,
) -> Result<DocumentToMarkdownFileOutput, String> {
    let job_id = input
        .job_id
        .clone()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let source_dir = app_media_dir(&app, "document-markdown-inputs")?;
    let output_dir = app_media_dir(&app, "document-markdown-outputs")?;
    let source_filename = unique_media_filename(&input.filename);
    let source_path = source_dir.join(&source_filename);
    let output_format = normalize_output_format(input.output_format.as_deref());
    let output_filename = converted_output_filename(&input.filename, &output_format);
    let output_path = output_dir.join(unique_media_filename(&output_filename));
    let markdown_output_filename = markdown_output_filename(&input.filename);
    let markdown_output_path = if output_format == "md" {
        output_path.clone()
    } else {
        output_dir.join(unique_media_filename(&markdown_output_filename))
    };
    let max_chars = input.max_chars.unwrap_or(500_000);
    let mode = parse_markdown_conversion_mode(input.conversion_mode.as_deref());
    let timeout_seconds = input.timeout_seconds;

    let payload = strip_data_url_prefix(input.data_base64.trim());
    let bytes = general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("文档数据解码失败: {}", e))?;
    std::fs::write(&source_path, &bytes).map_err(|e| format!("缓存待转换文档失败: {}", e))?;

    let result = match convert_source_to_markdown(&app, &jobs, job_id.as_deref(), &source_path, &markdown_output_path, max_chars, mode, timeout_seconds).await {
        Ok(conversion) => finalize_markdown_conversion_output(
            input.filename,
            &source_path,
            &markdown_output_path,
            &output_path,
            &output_filename,
            &output_format,
            conversion,
            max_chars,
        ).map_err(|err| err),
        Err(err) => Ok(markdown_error_output(
            input.filename,
            &source_path,
            &output_path,
            &output_filename,
            err,
        )),
    };
    jobs.finish_job(job_id.as_deref()).await;
    result
}

#[tauri::command]
async fn document_path_to_markdown_file(
    app: tauri::AppHandle,
    jobs: State<'_, ConversionJobs>,
    input: DocumentPathToMarkdownInput,
) -> Result<DocumentToMarkdownFileOutput, String> {
    let job_id = input
        .job_id
        .clone()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let source_path = PathBuf::from(input.source_path.trim());
    if !source_path.exists() || !source_path.is_file() {
        return Err("源文件不存在或不是有效文件。".into());
    }

    let source_name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .to_string();
    let output_dir = input
        .output_dir
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| source_path.parent().map(|path| path.to_path_buf()))
        .ok_or_else(|| "无法确定输出目录。".to_string())?;
    std::fs::create_dir_all(&output_dir).map_err(|e| format!("创建输出目录失败: {}", e))?;
    let output_format = normalize_output_format(input.output_format.as_deref());
    let output_filename = converted_output_filename(&source_name, &output_format);
    let output_path = available_output_path(&output_dir, &output_filename);
    let markdown_output_filename = markdown_output_filename(&source_name);
    let markdown_output_path = if output_format == "md" {
        output_path.clone()
    } else {
        let cache_dir = app_media_dir(&app, "document-markdown-outputs")?;
        cache_dir.join(unique_media_filename(&markdown_output_filename))
    };
    let max_chars = input.max_chars.unwrap_or(500_000);
    let mode = parse_markdown_conversion_mode(input.conversion_mode.as_deref());
    let timeout_seconds = input.timeout_seconds;

    let result = match convert_source_to_markdown(&app, &jobs, job_id.as_deref(), &source_path, &markdown_output_path, max_chars, mode, timeout_seconds).await {
        Ok(conversion) => finalize_markdown_conversion_output(
            source_name,
            &source_path,
            &markdown_output_path,
            &output_path,
            &output_filename,
            &output_format,
            conversion,
            max_chars,
        ).map_err(|err| err),
        Err(err) => Ok(markdown_error_output(
            source_name,
            &source_path,
            &output_path,
            &output_filename,
            err,
        )),
    };
    jobs.finish_job(job_id.as_deref()).await;
    result
}

#[tauri::command]
async fn cancel_markdown_conversion(
    jobs: State<'_, ConversionJobs>,
    input: CancelMarkdownConversionInput,
) -> Result<(), String> {
    let job_id = input.job_id.trim();
    if !job_id.is_empty() {
        jobs.cancel_job(job_id).await;
    }
    Ok(())
}

#[tauri::command]
async fn media_process_file(app: tauri::AppHandle, input: MediaProcessFileInput) -> Result<MediaProcessFileOutput, String> {
    let source = resolve_cached_media_path(&app, &input.input_path)?;
    let output_dir = app_media_dir(&app, "media-outputs")?;
    let output_filename = sanitize_media_filename(&input.output_filename, "media-output.mp4");
    let output_path = output_dir.join(unique_media_filename(&output_filename));
    let args = build_ffmpeg_args(&input, &source, &output_path)?;
    let start = Instant::now();

    let output = timeout(
        Duration::from_secs(900),
        Command::new(resolve_local_binary("ffmpeg")).args(args).kill_on_drop(true).output(),
    )
    .await
    .map_err(|_| "ffmpeg 执行超时（900 秒）".to_string())?
    .map_err(|e| format!("未检测到 ffmpeg，或 ffmpeg 启动失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!("ffmpeg 执行失败: {}", stderr.trim()));
    }

    let output_size = std::fs::metadata(&output_path)
        .map_err(|e| format!("读取输出文件失败: {}", e))?
        .len();
    Ok(MediaProcessFileOutput {
        output_path: output_path.to_string_lossy().to_string(),
        output_filename,
        output_size,
        stdout,
        stderr,
        duration_ms: start.elapsed().as_millis(),
    })
}

#[tauri::command]
async fn media_transcribe_file(app: tauri::AppHandle, input: MediaTranscribeFileInput) -> Result<MediaTranscribeFileOutput, String> {
    let source = resolve_cached_media_path(&app, &input.input_path)?;
    let output_dir = app_media_dir(&app, "media-transcripts")?;
    let format = input
        .output_format
        .as_deref()
        .unwrap_or("txt")
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if !supported_transcript_format(&format) {
        return Err(format!("不支持的转写输出格式: {}", format));
    }
    let model = input.model.unwrap_or_else(|| "base".into());
    let stem = media_file_stem(
        source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("media"),
    );
    let start = Instant::now();

    let mut command = Command::new({
        let whisper = resolve_local_binary("whisper");
        if whisper.to_string_lossy() == "whisper" {
            // Homebrew 安装的是 whisper-cli，不是 whisper
            resolve_local_binary("whisper-cli")
        } else {
            whisper
        }
    });
    command
        .arg(source.to_string_lossy().to_string())
        .arg("--model")
        .arg(model)
        .arg("--output_dir")
        .arg(output_dir.to_string_lossy().to_string())
        .arg("--output_format")
        .arg(format.clone());
    if let Some(language) = input.language {
        if !language.trim().is_empty() {
            command.arg("--language").arg(language);
        }
    }

    let output = timeout(Duration::from_secs(1800), command.kill_on_drop(true).output())
        .await
        .map_err(|_| "Whisper 转写超时（1800 秒）".to_string())?
        .map_err(|e| format!("未检测到 whisper 命令，或 whisper 启动失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!("Whisper 转写失败: {}", stderr.trim()));
    }

    let output_path = find_transcript_output(&output_dir, &stem, &format)
        .ok_or_else(|| "Whisper 已运行，但没有找到转写输出文件".to_string())?;
    let output_size = std::fs::metadata(&output_path)
        .map_err(|e| format!("读取转写文件失败: {}", e))?
        .len();
    let text = std::fs::read_to_string(&output_path).unwrap_or_default();
    let output_filename = output_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("transcript.txt")
        .to_string();

    Ok(MediaTranscribeFileOutput {
        output_path: output_path.to_string_lossy().to_string(),
        output_filename,
        output_size,
        text,
        stdout,
        stderr,
        duration_ms: start.elapsed().as_millis(),
    })
}

#[tauri::command]
async fn media_burn_subtitles(app: tauri::AppHandle, input: MediaBurnSubtitlesInput) -> Result<MediaProcessFileOutput, String> {
    let source = resolve_cached_media_path(&app, &input.input_path)?;
    let subtitle_text = input.subtitle_text.trim();
    if subtitle_text.is_empty() {
        return Err("字幕文本不能为空".into());
    }
    let subtitle_dir = app_media_dir(&app, "media-subtitles")?;
    let subtitle_path = subtitle_dir.join(unique_media_filename("subtitle.srt"));
    std::fs::write(&subtitle_path, subtitle_text.as_bytes())
        .map_err(|e| format!("写入字幕文件失败: {}", e))?;

    let output_dir = app_media_dir(&app, "media-outputs")?;
    let fallback = format!(
        "{}_subtitled.mp4",
        media_file_stem(source.file_name().and_then(|value| value.to_str()).unwrap_or("video"))
    );
    let output_filename = sanitize_media_filename(
        input.output_filename.as_deref().unwrap_or(&fallback),
        &fallback,
    );
    let output_path = output_dir.join(unique_media_filename(&output_filename));
    let filter = format!("subtitles=filename='{}'", escape_subtitle_filter_path(&subtitle_path));
    let start = Instant::now();

    let output = timeout(
        Duration::from_secs(900),
        Command::new(resolve_local_binary("ffmpeg"))
            .args([
                "-y",
                "-hide_banner",
                "-i",
                &source.to_string_lossy(),
                "-vf",
                &filter,
                "-c:v",
                "libx264",
                "-c:a",
                "copy",
                &output_path.to_string_lossy(),
            ])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "字幕烧录超时（900 秒）".to_string())?
    .map_err(|e| format!("ffmpeg 启动失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!("字幕烧录失败: {}", stderr.trim()));
    }
    let output_size = std::fs::metadata(&output_path)
        .map_err(|e| format!("读取输出文件失败: {}", e))?
        .len();
    Ok(MediaProcessFileOutput {
        output_path: output_path.to_string_lossy().to_string(),
        output_filename,
        output_size,
        stdout,
        stderr,
        duration_ms: start.elapsed().as_millis(),
    })
}

fn has_unsafe_shell_syntax(command: &str) -> bool {
    command.contains("&&")
        || command.contains("||")
        || command.contains(';')
        || command.contains('|')
        || command.contains('>')
        || command.contains('<')
        || command.contains('`')
        || command.contains('$')
        || command.contains('\n')
        || command.contains('\r')
}

fn split_command(command: &str) -> Result<(String, Vec<String>), String> {
    let value = command.trim();
    if value.is_empty() {
        return Err("缺少要执行的命令".into());
    }
    if has_unsafe_shell_syntax(value) {
        return Err("命令包含不支持的 shell 语法，请改为单条命令".into());
    }

    let mut parts: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for ch in value.chars() {
        if (ch == '"' || ch == '\'') && quote.is_none() {
            quote = Some(ch);
            continue;
        }
        if Some(ch) == quote {
            quote = None;
            continue;
        }
        if ch.is_whitespace() && quote.is_none() {
            if !current.is_empty() {
                parts.push(current.clone());
                current.clear();
            }
            continue;
        }
        current.push(ch);
    }
    if quote.is_some() {
        return Err("命令引号未闭合".into());
    }
    if !current.is_empty() {
        parts.push(current);
    }
    let program = parts.first().ok_or_else(|| "缺少要执行的命令".to_string())?.clone();
    let allowed = [
        "pnpm", "npm", "yarn", "bun", "cargo", "node", "npx", "deno", "tsc", "vite", "tauri",
        "pytest", "ruff",
    ];
    if !allowed.contains(&program.as_str()) {
        return Err(format!("不允许执行此命令入口: {}", program));
    }
    Ok((program, parts.into_iter().skip(1).collect()))
}

#[tauri::command]
async fn dev_run_command(input: DevRunCommandInput) -> Result<DevRunCommandOutput, String> {
    let root = canonical_root(&input.root)?;
    let workdir = resolve_existing_path(&root, input.workdir.as_deref().unwrap_or("."))?;
    if !workdir.is_dir() {
        return Err("命令工作目录必须是文件夹".into());
    }
    let (program, args) = split_command(&input.command)?;
    let timeout_seconds = input.timeout_seconds.unwrap_or(120).clamp(1, 900);
    let start = Instant::now();

    let mut command = Command::new(program);
    command.args(args);
    command.current_dir(workdir);
    command.kill_on_drop(true);

    let output = timeout(Duration::from_secs(timeout_seconds), command.output())
        .await
        .map_err(|_| format!("命令执行超时（{} 秒）", timeout_seconds))?
        .map_err(|e| format!("命令启动失败: {}", e))?;

    Ok(DevRunCommandOutput {
        command: input.command,
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        duration_ms: start.elapsed().as_millis(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_ocr_report_is_not_valid_markdown_cache() {
        let content = r#"# 编剧心理学

- 来源文件：/tmp/book.pdf
- 总页数：2
- 已处理页数：2
- OCR 失败页数：2

## OCR 失败页
- 第 1 页：RapidOCR 转换失败: RapidOCR 本地引擎不可用：Error importing numpy
- 第 2 页：RapidOCR 转换失败: RapidOCR 本地引擎不可用：Error importing numpy

<!-- source-page: 1 -->
## 第 1 页

> 本页 OCR 未成功，已保留占位。原因：RapidOCR 转换失败: RapidOCR 本地引擎不可用：Error importing numpy

<!-- source-page: 2 -->
## 第 2 页

> 本页 OCR 未成功，已保留占位。原因：RapidOCR 转换失败: RapidOCR 本地引擎不可用：Error importing numpy
"#;

        assert!(is_meaningful_markdown(content));
        assert!(!is_successful_markdown_content(content));
        assert!(!is_successful_ocr_markdown(content));
    }

    #[test]
    fn empty_rapidocr_page_is_not_successful_ocr_output() {
        let content = r#"<!-- source-page: 1 -->
## 第 1 页

> 本页未识别到文字。
"#;

        assert!(!is_successful_ocr_markdown(content));
    }

    #[test]
    fn normal_markdown_is_valid_cache_content() {
        let content = r#"# 第一章 故事结构

这一章讲三幕式结构、人物目标和反击战的节奏设计。
"#;

        assert!(is_successful_markdown_content(content));
        assert!(is_successful_ocr_markdown(content));
    }

    #[test]
    fn converts_markdown_table_to_csv() {
        let markdown = "| 姓名 | 年龄 |\n| --- | --- |\n| 张三 | 18 |\n| 李四 | 20 |";
        let csv = convert_markdown_for_output("csv", markdown).expect("csv output");
        assert_eq!(csv, "姓名,年龄\n张三,18\n李四,20\n");
    }

    #[test]
    fn validates_json_and_srt_outputs() {
        let json = convert_markdown_for_output("json", "```json\n{\"a\":1}\n```").expect("json output");
        assert_eq!(json, "{\n  \"a\": 1\n}\n");

        let srt = "1\n00:00:00,000 --> 00:00:01,000\n你好\n";
        assert_eq!(convert_markdown_for_output("srt", srt).expect("srt output"), srt);
        assert!(convert_markdown_for_output("srt", "# 普通正文").is_err());
    }

    #[test]
    fn shell_wrapper_shebang_is_not_treated_as_python() {
        assert!(python_path_from_token("/bin/sh").is_none());
        let wrapper = Path::new("/Users/by3/.jiucaihezi/tools/bin/markitdown");
        if wrapper.exists() {
            let python = python_from_wrapper_script(wrapper).expect("python from markitdown wrapper");
            assert!(python.to_string_lossy().contains("python"));
        }
    }

    #[test]
    fn local_mlx_health_check_requires_structured_model_match() {
        let body = r#"{"object":"list","data":[{"id":"mlx-community/gemma-4-e4b-it-OptiQ-4bit","object":"model"}]}"#;
        assert!(local_mlx_models_response_has_model(body, "mlx-community/gemma-4-e4b-it-OptiQ-4bit"));
        assert!(local_mlx_models_response_has_model(body, "gemma-4-e4b-it-OptiQ-4bit"));
        assert!(!local_mlx_models_response_has_model(body, "gemma-4"));
        assert!(!local_mlx_models_response_has_model("mlx-community/gemma-4-e4b-it-OptiQ-4bit", "gemma-4-e4b-it-OptiQ-4bit"));
    }

    #[test]
    fn local_mlx_model_id_matches_canonical_paths() {
        let cwd = std::env::current_dir().expect("current dir");
        let canonical = cwd.canonicalize().expect("canonical cwd");
        assert!(local_mlx_model_id_matches(
            &canonical.to_string_lossy(),
            &cwd.to_string_lossy(),
        ));
    }

    #[test]
    fn local_mlx_default_model_keeps_stable_port() {
        let input = LocalMlxModelInput {
            model_id: "local-mlx/jiucai-local".into(),
            model_label: "韭菜盒子本地模型".into(),
            model_repo: "mlx-community/gemma-4-e4b-it-OptiQ-4bit".into(),
            download_bytes_hint: None,
        };
        assert_eq!(local_mlx_base_port(&input), LOCAL_MLX_PORT);
        assert_eq!(local_mlx_api_base(&input), "http://127.0.0.1:17880");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ConversionJobs::default())
        .manage(BrowserRuntime::default())
        .manage(LocalMlxRuntime::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            // 确保应用数据目录存在
            let app_data = app.path().app_data_dir().expect("failed to get app data dir");
            std::fs::create_dir_all(&app_data).ok();
            // 创建 vault 子目录
            std::fs::create_dir_all(app_data.join("vault")).ok();

            // ★ 手动建窗以挂载 on_navigation 拦截 NewAPI 登录回调
            let window_config = app.config().app.windows.first()
                .ok_or("missing main window config")?;
            let app_handle_nav = app.handle().clone();
            let app_handle_new = app.handle().clone();

            WebviewWindowBuilder::from_config(app.handle(), window_config)?
                .on_navigation(move |url| {
                    if is_workbench_return_url(url) {
                        if let Some(main) = app_handle_nav.get_webview_window("main") {
                            let _ = main.navigate(workbench_url_from_return(url));
                            let _ = main.set_focus();
                        }
                        false  // 阻止真实导航
                    } else {
                        true
                    }
                })
                .on_new_window(move |url, _features| {
                    if is_workbench_return_url(&url) {
                        if let Some(main) = app_handle_new.get_webview_window("main") {
                            let _ = main.navigate(workbench_url_from_return(&url));
                            let _ = main.set_focus();
                        }
                    }
                    NewWindowResponse::Deny
                })
                .initialization_script(
                    r#"
(() => {
  const workbenchHosts = new Set([
    'jiucaihezi.studio',
    'www.jiucaihezi.studio',
  ]);
  function isWorkbenchReturn(value) {
    try {
      const url = new URL(String(value || ''), window.location.href);
      return workbenchHosts.has(url.hostname);
    } catch (_) { return false; }
  }
  function goWorkbench(value) {
    let target = new URL('tauri://localhost/index.html');
    try {
      const url = new URL(String(value || ''), window.location.href);
      const hasKey = ['key', 'jcApiKey', 'api_key'].some((name) => {
        const v = url.searchParams.get(name);
        return v && String(v).trim();
      });
      if (hasKey) {
        target = new URL('tauri://localhost/index.html');
        target.search = url.search;
      }
    } catch (_) {}
    window.location.href = target.href;
  }
  const nativeOpen = window.open;
  window.open = function(url, target, features) {
    if (isWorkbenchReturn(url)) { goWorkbench(url); return window; }
    return nativeOpen ? nativeOpen.call(window, url, target, features) : null;
  };
  document.addEventListener('click', (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (anchor && isWorkbenchReturn(anchor.href)) {
      event.preventDefault(); goWorkbench(anchor.href);
    }
  }, true);

  // ═══ NewAPI 页面增强 ═══
  const host = window.location.hostname;
  if (host === 'api.jiucaihezi.studio' || host === 'jiucaihezi.studio' || host === 'www.jiucaihezi.studio') {
    var btnAdded = false;
    function addFloatBtn() {
      if (btnAdded || !document.body) return;
      btnAdded = true;
      var b = document.createElement('button');
      b.textContent = '\u2190 \u8fd4\u56de\u5de5\u4f5c\u53f0';
      Object.assign(b.style, {
        position:'fixed',bottom:'20px',left:'20px',zIndex:'99999',
        padding:'10px 18px',border:'none',borderRadius:'10px',
        background:'#6B8E23',color:'#fff',fontSize:'14px',fontWeight:'700',
        cursor:'pointer',fontFamily:'inherit',
        boxShadow:'0 4px 16px rgba(107,142,35,.35)',
        transition:'transform .15s',
      });
      b.onmouseenter=function(){b.style.transform='scale(1.05)'};
      b.onmouseleave=function(){b.style.transform='scale(1)'};
      b.onclick=function(){goWorkbench('https://jiucaihezi.studio')};
      document.body.appendChild(b);
    }
    // ★ 检测密钥页：基于表格行的鲁棒注入
    function scanForKeys() {
      // 1. 扫描完整 sk- 文本
      var walker = document.createTreeWalker(document.body, 4);
      var node;
      while (node = walker.nextNode()) {
        var m = (node.textContent||'').match(/\b(sk-[a-zA-Z0-9]{20,60})\b/);
        if (m && !node.parentNode.querySelector('[data-jc-login-btn]')) {
          addKeyBtnInline(node, m[1]);
        }
      }
      // 2. ★ 核心：找到所有包含 sk- 的表格行，在行尾注入按钮
      var rows = document.querySelectorAll('tr, [class*="row"], [class*="Row"], [class*="item"], [class*="Item"]');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (row.querySelector('[data-jc-login-btn]')) continue;
        if (!(/\bsk-/.test(row.textContent||''))) continue;
        // 在行尾加"一键登录"按钮
        var td = document.createElement('td');
        td.style.cssText = 'padding:4px 8px;white-space:nowrap;';
        var b = document.createElement('button');
        b.setAttribute('data-jc-login-btn', '1');
        b.textContent = '\uD83D\uDD11 \u4e00\u952e\u767b\u5f55';
        Object.assign(b.style, {
          padding:'5px 14px',border:'none',borderRadius:'6px',
          background:'#6B8E23',color:'#fff',fontSize:'13px',fontWeight:'700',
          cursor:'pointer',fontFamily:'inherit',
        });
        (function(r) {
          b.onclick = async function() {
            b.textContent = '\u23f3 \u6b63\u5728\u83b7\u53d6...';
            b.disabled = true;
            try {
              // 策略 A: 点击行内所有按钮（触发复制/显示完整key）
              var btns = r.querySelectorAll('button, [role="button"], svg, img, .copy, [class*="copy"], [class*="icon"]');
              for (var j = 0; j < btns.length; j++) { try { btns[j].click() } catch(e){} }
              await new Promise(function(rr){setTimeout(rr,400)});
              var key = await navigator.clipboard.readText();
              var km = key.match(/\b(sk-[a-zA-Z0-9]{20,60})\b/);
              if (km) {
                window.location.href = 'tauri://localhost/index.html?key=' + encodeURIComponent(km[1]);
                return;
              }
            } catch(e) {}
            // 降级: 回到工作台
            b.textContent = '\u26a0\ufe0f \u8bf7\u624b\u52a8\u590d\u5236Key\u540e\u8fd4\u56de';
            b.style.background = '#e08020';
            setTimeout(function(){
              goWorkbench('https://jiucaihezi.studio');
            }, 1500);
          };
        })(row);
        td.appendChild(b);
        // 追加到行尾
        var cells = row.querySelectorAll('td, th');
        if (cells.length) {
          var last = cells[cells.length-1];
          last.parentNode.insertBefore(td, last.nextSibling);
        } else {
          row.appendChild(td);
        }
      }
    }
    function addKeyBtnInline(node, key) {
      if (node.parentNode && node.parentNode.querySelector('[data-jc-login-btn]')) return;
      var b = document.createElement('button');
      b.setAttribute('data-jc-login-btn', '1');
      b.textContent = '\uD83D\uDD11 \u4e00\u952e\u767b\u5f55';
      Object.assign(b.style, {
        display:'inline-block',marginLeft:'6px',padding:'2px 10px',
        border:'none',borderRadius:'5px',background:'#6B8E23',color:'#fff',
        fontSize:'12px',fontWeight:'700',cursor:'pointer',fontFamily:'inherit',
      });
      b.onclick = function() {
        window.location.href = 'tauri://localhost/index.html?key=' + encodeURIComponent(key);
      };
      node.parentNode && node.parentNode.insertBefore(b, node.nextSibling);
    }
    addFloatBtn();
    setTimeout(function() { addFloatBtn(); scanForKeys(); }, 800);
    setTimeout(function() { addFloatBtn(); scanForKeys(); }, 2500);
    setTimeout(function() { addFloatBtn(); scanForKeys(); }, 6000);
    new MutationObserver(function() {
      addFloatBtn();
      setTimeout(scanForKeys, 600);
    }).observe(document.documentElement || document.body, { childList: true, subtree: true });
  }
})();
"#,
                )
                .build()?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            read_session_token,
            write_session_token,
            http_request,
            http_request_stream,
            secure_store::get_api_key,
            secure_store::set_api_key,
            secure_store::clear_api_key,
            local_mlx_status,
            local_mlx_prepare_model,
            local_mlx_scan_models,
            local_mlx_ensure_server,
            local_mlx_stop_server,
            local_mlx_remove_model,
            local_mlx_open_model_dir,
            browser_launch,
            browser_open,
            browser_read,
            browser_screenshot,
            browser_state,
            browser_search,
            browser_click,
            browser_type,
            browser_close,
            save_generated_file,
            dev_detect_project,
            dev_list_files,
            dev_search_text,
            dev_read_file,
            dev_read_many_files,
            dev_write_file,
            dev_replace_in_file,
            dev_get_diff,
            dev_run_command,
            media_cache_file,
            document_to_markdown_file,
            document_path_to_markdown_file,
            cancel_markdown_conversion,
            media_process_file,
            media_transcribe_file,
            media_burn_subtitles,
            mcp_spawn_stdio,
            mcp_write_stdin,
            mcp_kill_stdio,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
