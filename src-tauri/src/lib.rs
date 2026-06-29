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
use std::ffi::OsStr;
use std::io::Write;
use std::net::TcpListener;
use std::path::{Component, Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use std::sync::LazyLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{ipc::Channel, webview::NewWindowResponse, Emitter, Manager, State, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};

mod secure_store;
mod skills;

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
    tauri::Url::parse(&format!("tauri://localhost/{query}"))
        .expect("valid local workbench entry url")
}

#[tauri::command]
fn write_clipboard_text(text: String) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|e| format!("剪贴板不可用: {e}"))?;
    clipboard.set_text(&text)
        .map_err(|e| format!("写入失败: {e}"))?;
    Ok(())
}

/// 检测 whisper-cli sidecar 是否为真实二进制（非占位脚本）
#[tauri::command]
fn check_whisper_available(app: tauri::AppHandle) -> Result<bool, String> {
    let bin = match resolve_app_media_binary(&app, "whisper-cli") {
        Ok(p) => p,
        Err(_) => return Ok(false),
    };
    // 占位脚本通常 < 2KB
    let meta = std::fs::metadata(&bin).map_err(|e| e.to_string())?;
    if meta.len() < 2048 {
        return Ok(false);
    }
    // 尝试运行 --version（超时 5s）
    let output = std::process::Command::new(&bin)
        .arg("--version")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    Ok(output.status.success())
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

    // PATH 环境变量查找（已覆盖各平台）
    if let Some(paths) = env::var_os("PATH") {
        for dir in env::split_paths(&paths) {
            let candidate = dir.join(program);
            if candidate.exists() {
                return candidate;
            }
        }
    }

    // Unix 平台补充查找（Windows 上 PATH 已足够）
    #[cfg(not(windows))]
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

/// resolve_local_binary 的 Option 版本：未找到返回 None
fn resolve_local_binary_option(program: &str) -> Option<PathBuf> {
    let candidate = resolve_local_binary(program);
    if candidate.exists() {
        Some(candidate)
    } else {
        None
    }
}

/// 检测 GitHub 工具是否已安装（目录 + 二进制两段式回退）
/// 返回安装路径，未安装返回 None
#[tauri::command]
fn check_tool_installed(tool_id: String) -> Result<Option<String>, String> {
    // 1. 检查 ~/.jiucaihezi/tools/{tool_id}/ 目录
    if let Some(home) = std::env::var_os("HOME") {
        let tool_dir = std::path::PathBuf::from(&home)
            .join(".jiucaihezi")
            .join("tools")
            .join(&tool_id);
        if tool_dir.exists() {
            return Ok(Some(tool_dir.to_string_lossy().to_string()));
        }
    }

    // 2. 已知二进制名 → PATH 查找（brew / apt / choco 系统安装）
    let binary: Option<&str> = match tool_id.as_str() {
        "yt-dlp" => Some("yt-dlp"),
        "ffmpeg" => Some("ffmpeg"),
        "pandoc" => Some("pandoc"),
        "whisper" => Some("whisper"),
        "ripgrep" => Some("rg"),
        "imagemagick" => Some("magick"),
        _ => None,
    };

    if let Some(bin) = binary {
        if let Some(found) = resolve_local_binary_option(bin) {
            return Ok(Some(found.to_string_lossy().to_string()));
        }
    }

    Ok(None)
}

fn opencode_platform_package_dir() -> Option<&'static str> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Some("opencode-darwin-arm64");
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return Some("opencode-darwin-x64");
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Some("opencode-linux-x64");
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return Some("opencode-windows-x64");
    #[allow(unreachable_code)]
    None
}

fn opencode_resource_names() -> Vec<String> {
    let mut names = vec!["opencode".to_string()];
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    names.push("opencode-aarch64-apple-darwin".to_string());
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    names.push("opencode-x86_64-apple-darwin".to_string());
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    names.push("opencode-x86_64-unknown-linux-gnu".to_string());
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        names.push("opencode.exe".to_string());
        names.push("opencode-x86_64-pc-windows-msvc.exe".to_string());
    }
    names
}

fn existing_file(path: PathBuf) -> Option<PathBuf> {
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

fn resolve_opencode_binary_from_inputs(
    resource_dirs: &[PathBuf],
    home: Option<&Path>,
    jc_opencode_bin: Option<&OsStr>,
    opencode_bin_path: Option<&OsStr>,
    path_env: Option<&OsStr>,
) -> Result<PathBuf, String> {
    for value in [jc_opencode_bin, opencode_bin_path].into_iter().flatten() {
        let path = PathBuf::from(value);
        if let Some(found) = existing_file(path.clone()) {
            return Ok(found);
        }
        return Err(format!(
            "OpenCode runtime 路径不可用：{}。请检查 JC_OPENCODE_BIN / OPENCODE_BIN_PATH。",
            path.to_string_lossy()
        ));
    }

    for dir in resource_dirs {
        for name in opencode_resource_names() {
            if let Some(found) = existing_file(dir.join(name)) {
                return Ok(found);
            }
        }
    }

    if let Some(home) = home {
        if let Some(found) = existing_file(home.join(".jiucaihezi/tools/bin/opencode")) {
            return Ok(found);
        }
    }

    if let Some(paths) = path_env {
        for dir in env::split_paths(paths) {
            if let Some(found) = existing_file(dir.join("opencode")) {
                return Ok(found);
            }
            #[cfg(windows)]
            if let Some(found) = existing_file(dir.join("opencode.exe")) {
                return Ok(found);
            }
        }
    }

    for dir in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ] {
        if let Some(found) = existing_file(PathBuf::from(dir).join("opencode")) {
            return Ok(found);
        }
    }

    if let (Some(home), Some(package_dir)) = (home, opencode_platform_package_dir()) {
        let dev_checkout_binary = home
            .join("Documents/1OKAPP/my-opencode/packages/opencode/dist")
            .join(package_dir)
            .join("bin/opencode");
        if let Some(found) = existing_file(dev_checkout_binary) {
            return Ok(found);
        }
    }

    Err(
        "OpenCode runtime 未安装或不可执行。请安装官方 opencode-ai，或设置 JC_OPENCODE_BIN / OPENCODE_BIN_PATH 指向 opencode 原生二进制。".into(),
    )
}

fn app_executable_dir() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf()))
}

fn ensure_binary_executable(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("xattr")
            .args(["-dr", "com.apple.quarantine"])
            .arg(path)
            .output();
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mode = meta.permissions().mode();
            if mode & 0o111 == 0 {
                let mut perms = meta.permissions();
                perms.set_mode(mode | 0o755);
                let _ = std::fs::set_permissions(path, perms);
            }
        }
    }
}

fn opencode_resource_dirs(app: Option<&tauri::AppHandle>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            dirs.push(resource_dir.clone());
            dirs.push(resource_dir.join("binaries"));
            dirs.push(resource_dir.join("bin"));
        }
    }
    if let Some(exe_dir) = app_executable_dir() {
        if !dirs.contains(&exe_dir) {
            dirs.push(exe_dir);
        }
    }
    dirs
}

fn resolve_opencode_binary(app: Option<&tauri::AppHandle>) -> Result<PathBuf, String> {
    let home = env::var_os("HOME").map(PathBuf::from);
    let path = resolve_opencode_binary_from_inputs(
        &opencode_resource_dirs(app),
        home.as_deref(),
        env::var_os("JC_OPENCODE_BIN").as_deref(),
        env::var_os("OPENCODE_BIN_PATH").as_deref(),
        env::var_os("PATH").as_deref(),
    )?;
    ensure_binary_executable(&path);
    Ok(path)
}

fn media_tool_resource_names(program: &str) -> Vec<String> {
    let mut names = vec![program.to_string()];
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    names.push(format!("{}-aarch64-apple-darwin", program));
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    names.push(format!("{}-x86_64-apple-darwin", program));
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    names.push(format!("{}-x86_64-unknown-linux-gnu", program));
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        names.push(format!("{}.exe", program));
        names.push(format!("{}-x86_64-pc-windows-msvc.exe", program));
    }
    names
}

fn resolve_app_media_binary(app: &tauri::AppHandle, program: &str) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir()
        .map_err(|_| "媒体处理组件不可用，请重新安装应用后重试。".to_string())?;
    let mut search_dirs = vec![
        resource_dir.clone(),
        resource_dir.join("binaries"),
        resource_dir.join("bin"),
    ];
    if let Some(exe_dir) = app_executable_dir() {
        if !search_dirs.contains(&exe_dir) {
            search_dirs.push(exe_dir);
        }
    }
    for dir in search_dirs {
        for name in media_tool_resource_names(program) {
            let path = dir.join(&name);
            if path.exists() {
                ensure_binary_executable(&path);
                return Ok(path);
            }
        }
    }

    #[cfg(debug_assertions)]
    {
        let fallback = resolve_local_binary(program);
        if fallback.exists() {
            return Ok(fallback);
        }
    }

    Err("媒体处理组件不可用，请重新安装应用后重试。".into())
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

#[derive(Clone, Debug)]
struct MediaCaptureCommandCandidate {
    program: PathBuf,
    args: Vec<String>,
    cwd: Option<PathBuf>,
    display_path: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaUrlInspectInput {
    url: String,
    job_id: Option<String>,
    use_browser_session: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaUrlInspectOutput {
    id: String,
    url: String,
    title: String,
    site: String,
    duration_seconds: Option<u64>,
    thumbnail_url: Option<String>,
    has_video: bool,
    has_audio: bool,
    has_subtitles: bool,
    has_metadata: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaUrlDownloadInput {
    job_id: String,
    url: String,
    title: Option<String>,
    kind: String,
    video_quality: Option<String>,
    audio_format: Option<String>,
    subtitle_language: Option<String>,
    output_dir: Option<String>,
    use_browser_session: Option<bool>,
    extra_args: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelMediaUrlDownloadInput {
    job_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaUrlDownloadOutput {
    filename: String,
    output_path: String,
    output_dir: String,
    size: Option<u64>,
    duration_seconds: Option<u64>,
    format: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MediaUrlCaptureProgress {
    job_id: String,
    stage: String,
    progress: u8,
    message: String,
}

#[derive(Default)]
struct MediaCaptureJobs {
    cancelled: Mutex<HashSet<String>>,
    pids: Mutex<HashMap<String, u32>>,
    allowed_outputs: Mutex<HashSet<PathBuf>>,
    allowed_inputs: Mutex<HashSet<PathBuf>>,
}

impl MediaCaptureJobs {
    async fn is_cancelled(&self, job_id: &str) -> bool {
        self.cancelled.lock().await.contains(job_id)
    }

    async fn register_pid(&self, job_id: &str, pid: Option<u32>) {
        if let Some(pid) = pid {
            self.pids.lock().await.insert(job_id.to_string(), pid);
        }
    }

    async fn clear_pid(&self, job_id: &str) {
        self.pids.lock().await.remove(job_id);
    }

    async fn finish_job(&self, job_id: &str) {
        self.pids.lock().await.remove(job_id);
        self.cancelled.lock().await.remove(job_id);
    }

    async fn cancel_job(&self, job_id: &str) {
        self.cancelled.lock().await.insert(job_id.to_string());
        let pid = self.pids.lock().await.get(job_id).copied();
        if let Some(pid) = pid {
            terminate_process(pid);
        }
    }

    async fn allow_output(&self, path: &Path) -> Result<(), String> {
        let canonical = std::fs::canonicalize(path).map_err(|e| format!("输出文件不可访问: {}", e))?;
        self.allowed_outputs.lock().await.insert(canonical);
        Ok(())
    }

    async fn is_allowed_output(&self, path: &Path) -> bool {
        let Ok(canonical) = std::fs::canonicalize(path) else {
            return false;
        };
        self.allowed_outputs.lock().await.contains(&canonical)
    }

    async fn allow_input(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = std::fs::canonicalize(path).map_err(|_| "文件不可访问，请重新选择。".to_string())?;
        if !canonical.is_file() {
            return Err("请选择有效的音频或视频文件。".into());
        }
        self.allowed_inputs.lock().await.insert(canonical.clone());
        Ok(canonical)
    }

    async fn is_allowed_input(&self, path: &Path) -> bool {
        let Ok(canonical) = std::fs::canonicalize(path) else {
            return false;
        };
        self.allowed_inputs.lock().await.contains(&canonical)
    }
}

fn terminate_process(pid: u32) {
    #[cfg(unix)]
    {
        let _ = StdCommand::new("kill").arg("-TERM").arg(pid.to_string()).output();
    }
    #[cfg(windows)]
    {
        let _ = StdCommand::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).output();
    }
}

fn push_media_capture_candidate(
    candidates: &mut Vec<MediaCaptureCommandCandidate>,
    candidate: MediaCaptureCommandCandidate,
) {
    if candidates.iter().any(|item| item.display_path == candidate.display_path) {
        return;
    }
    candidates.push(candidate);
}

fn push_media_capture_directory_candidates(
    candidates: &mut Vec<MediaCaptureCommandCandidate>,
    dir: &Path,
) {
    for name in media_capture_resource_names() {
        let path = dir.join(name);
        if path.exists() {
            push_media_capture_candidate(candidates, MediaCaptureCommandCandidate {
                program: path.clone(),
                args: Vec::new(),
                cwd: None,
                display_path: path,
            });
        }
    }
}

fn media_capture_resource_names() -> Vec<&'static str> {
    let mut names = vec!["yt-dlp"];
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    names.push("yt-dlp-aarch64-apple-darwin");
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    names.push("yt-dlp-x86_64-apple-darwin");
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    names.push("yt-dlp-x86_64-unknown-linux-gnu");
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        names.push("yt-dlp.exe");
        names.push("yt-dlp-x86_64-pc-windows-msvc.exe");
    }
    names
}

fn media_capture_command_candidates(
    app: Option<&tauri::AppHandle>,
    home: Option<&Path>,
) -> Vec<MediaCaptureCommandCandidate> {
    let mut candidates = Vec::new();

    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let search_dirs = [
                resource_dir.clone(),
                resource_dir.join("binaries"),
                resource_dir.join("bin"),
            ];
            for dir in search_dirs {
                push_media_capture_directory_candidates(&mut candidates, &dir);
            }
        }
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            push_media_capture_directory_candidates(&mut candidates, exe_dir);
            push_media_capture_directory_candidates(&mut candidates, &exe_dir.join("binaries"));
            push_media_capture_directory_candidates(&mut candidates, &exe_dir.join("bin"));
        }
    }

    #[cfg(debug_assertions)]
    if let Some(home) = home {
        let source_root = home.join("Documents").join("yt-dlp");
        let source_script = source_root.join("yt-dlp.sh");
        if source_script.exists() {
            push_media_capture_candidate(&mut candidates, MediaCaptureCommandCandidate {
                program: PathBuf::from("/bin/sh"),
                args: vec![
                    source_script.to_string_lossy().to_string(),
                ],
                cwd: Some(source_root.clone()),
                display_path: source_script,
            });
        }

        let source_module = source_root.join("yt_dlp").join("__main__.py");
        if source_module.exists() {
            let python = resolve_local_python();
            push_media_capture_candidate(&mut candidates, MediaCaptureCommandCandidate {
                program: python,
                args: vec!["-m".into(), "yt_dlp".into()],
                cwd: Some(source_root.clone()),
                display_path: source_root,
            });
        }

        let path_binary = resolve_local_binary("yt-dlp");
        if path_binary.exists() {
            push_media_capture_candidate(&mut candidates, MediaCaptureCommandCandidate {
                program: path_binary.clone(),
                args: Vec::new(),
                cwd: None,
                display_path: path_binary,
            });
        }
    }

    candidates
}

fn media_capture_command(app: &tauri::AppHandle) -> Result<MediaCaptureCommandCandidate, String> {
    let home = env::var_os("HOME").map(PathBuf::from);
    media_capture_command_candidates(Some(app), home.as_deref())
        .into_iter()
        .next()
        .ok_or_else(|| "App 内置网页媒体采集组件缺失，请重新安装应用后重试。".to_string())
}

fn validate_media_url(raw: &str) -> Result<String, String> {
    let value = raw.trim();
    let parsed = tauri::Url::parse(value).map_err(|_| "链接无效，请粘贴 http 或 https 开头的网页地址。".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("链接无效，请粘贴 http 或 https 开头的网页地址。".to_string());
    }
    if parsed.host_str().unwrap_or("").is_empty() {
        return Err("链接缺少有效域名。".to_string());
    }
    Ok(normalize_media_capture_url(&parsed))
}

fn normalize_media_capture_url(parsed: &tauri::Url) -> String {
    let host = parsed.host_str().unwrap_or("").trim_start_matches("www.");
    if host.eq_ignore_ascii_case("douyin.com") {
        if let Some(modal_id) = parsed
            .query_pairs()
            .find_map(|(key, value)| (key == "modal_id").then(|| value.into_owned()))
            .filter(|value| !value.is_empty() && value.chars().all(|ch| ch.is_ascii_digit()))
        {
            return format!("https://www.douyin.com/video/{}", modal_id);
        }
    }
    parsed.to_string()
}

fn media_capture_browser_name() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        if Path::new("/Applications/Google Chrome.app").exists() {
            return "chrome";
        }
        return "safari";
    }
    #[cfg(target_os = "windows")]
    {
        "chrome"
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        "chrome"
    }
}

fn media_capture_site_args(url: &str, use_browser_session: bool) -> Vec<String> {
    if !use_browser_session {
        return Vec::new();
    }
    let Ok(parsed) = tauri::Url::parse(url) else {
        return Vec::new();
    };
    let host = parsed.host_str().unwrap_or("").trim_start_matches("www.").to_ascii_lowercase();
    let referer = if host == "douyin.com" {
        Some("https://www.douyin.com/")
    } else if host == "bilibili.com" || host.ends_with(".bilibili.com") {
        Some("https://www.bilibili.com/")
    } else {
        None
    };
    let mut args = vec![
        "--cookies-from-browser".into(),
        media_capture_browser_name().into(),
        "--add-headers".into(),
        "User-Agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36".into(),
        "--add-headers".into(),
        "Accept-Language:zh-CN,zh;q=0.9,en;q=0.8".into(),
    ];
    if let Some(referer) = referer {
        args.extend(["--add-headers".into(), format!("Referer:{}", referer)]);
    }
    args
}

fn media_capture_error_message(prefix: &str, stderr: &str) -> String {
    let detail = stderr.trim();
    if detail.is_empty() {
        return format!("{}，请确认链接可以访问。", prefix);
    }
    let lower = detail.to_ascii_lowercase();
    if lower.contains("fresh cookies")
        || lower.contains("http error 412")
        || lower.contains("precondition failed")
        || lower.contains("cookies-from-browser")
    {
        return format!(
            "{}：该网站需要浏览器访问状态，请先用常用浏览器打开一次该视频页面，再回到这里重试。",
            prefix
        );
    }
    format!("{}：{}", prefix, sanitize_media_process_error(detail, "请检查链接后重试。"))
}

fn sanitize_media_process_error(detail: &str, fallback: &str) -> String {
    let value = detail.trim();
    if value.is_empty() {
        return fallback.to_string();
    }
    let lower = value.to_ascii_lowercase();
    if lower.contains("no such file")
        || lower.contains("not found")
        || lower.contains("permission denied")
        || lower.contains("ffmpeg")
        || lower.contains("ffprobe")
        || lower.contains("whisper")
        || lower.contains("/users/")
        || lower.contains("/volumes/")
        || lower.contains("\\users\\")
    {
        return fallback.to_string();
    }
    value
        .lines()
        .next()
        .unwrap_or(fallback)
        .chars()
        .take(160)
        .collect::<String>()
}

fn media_url_site_from_url(url: &str) -> String {
    tauri::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host.trim_start_matches("www.").to_string()))
        .unwrap_or_else(|| "网页媒体".into())
}

fn default_web_media_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        let dir = home.join("Movies").join("韭菜盒子").join("网页媒体");
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建保存目录失败: {}", e))?;
        return std::fs::canonicalize(&dir).map_err(|e| format!("保存目录不可访问: {}", e));
    }
    app_media_dir(app, "web-media-outputs")
}

fn resolve_media_url_output_dir(app: &tauri::AppHandle, job_id: &str, output_dir: Option<&str>) -> Result<PathBuf, String> {
    let root = default_web_media_dir(app)?;
    if let Some(raw) = output_dir.map(str::trim).filter(|value| !value.is_empty()) {
        let requested = PathBuf::from(raw);
        if requested.is_absolute() {
            let canonical = std::fs::canonicalize(&requested).map_err(|_| "保存目录不可访问，请使用默认保存位置。".to_string())?;
            if !canonical.starts_with(&root) {
                return Err("保存目录未授权，请使用默认保存位置。".into());
            }
        }
    }
    let safe_job = sanitize_media_filename(job_id, "media-job");
    let dir = root.join(safe_job);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建保存目录失败: {}", e))?;
    std::fs::canonicalize(&dir).map_err(|e| format!("保存目录不可访问: {}", e))
}

fn media_url_safe_base(title: Option<&str>, url: &str) -> String {
    let fallback = media_url_site_from_url(url);
    let raw = title
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(&fallback);
    let safe = sanitize_media_filename(raw, "web-media");
    Path::new(&safe)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("web-media")
        .to_string()
}

fn build_media_url_download_args(
    input: &MediaUrlDownloadInput,
    output_dir: &Path,
    ffmpeg_location: Option<&Path>,
) -> Result<Vec<String>, String> {
    let url = validate_media_url(&input.url)?;
    let mut args = vec![
        "--no-playlist".into(),
        "--no-warnings".into(),
        "--newline".into(),
        "--paths".into(),
        output_dir.to_string_lossy().to_string(),
        "--output".into(),
        "%(title).200B [%(id)s].%(ext)s".into(),
        "--print".into(),
        "after_move:filepath".into(),
    ];
    if let Some(ffmpeg_location) = ffmpeg_location {
        args.extend([
            "--ffmpeg-location".into(),
            ffmpeg_location.to_string_lossy().to_string(),
        ]);
    }

    match input.kind.as_str() {
        "video" => {
            let format = match input.video_quality.as_deref().unwrap_or("best") {
                "compact" => "bv*[height<=720]+ba/b[height<=720]/b",
                "best" => "bv*+ba/b",
                _ => return Err("不支持的视频质量。".into()),
            };
            args.extend(["-f".into(), format.into(), "--merge-output-format".into(), "mp4".into()]);
        }
        "audio" => {
            let format = match input.audio_format.as_deref().unwrap_or("mp3") {
                "mp3" => "mp3",
                "wav" => "wav",
                _ => return Err("不支持的音频格式。".into()),
            };
            args.extend(["-x".into(), "--audio-format".into(), format.into()]);
        }
        "subtitles" => {
            let lang = match input.subtitle_language.as_deref().unwrap_or("zh") {
                "zh" => "zh.*,zh-Hans,zh-CN,zh",
                "en" => "en.*,en",
                "auto" => "all",
                _ => return Err("不支持的字幕语言。".into()),
            };
            args.extend([
                "--skip-download".into(),
                "--write-subs".into(),
                "--write-auto-subs".into(),
                "--sub-lang".into(),
                lang.into(),
                "--convert-subs".into(),
                "srt".into(),
            ]);
        }
        "metadata" => {
            args.extend([
                "--skip-download".into(),
                "--write-info-json".into(),
                "--write-thumbnail".into(),
            ]);
        }
        _ => return Err("不支持的下载内容。".into()),
    }
    args.extend(media_capture_site_args(&url, input.use_browser_session.unwrap_or(false)));
    if let Some(extra_args) = &input.extra_args {
        args.extend(validate_media_capture_extra_args(extra_args)?);
    }
    args.push(url);
    Ok(args)
}

fn build_media_url_inspect_args(input: &MediaUrlInspectInput) -> Result<Vec<String>, String> {
    let url = validate_media_url(&input.url)?;
    let mut args = vec![
        "--dump-single-json".into(),
        "--skip-download".into(),
        "--no-warnings".into(),
        "--no-playlist".into(),
    ];
    args.extend(media_capture_site_args(&url, input.use_browser_session.unwrap_or(false)));
    args.push(url);
    Ok(args)
}

fn media_url_has_stream_kind(formats: Option<&Vec<serde_json::Value>>, codec_key: &str, extension_fallback: &[&str]) -> bool {
    let Some(items) = formats else {
        return true;
    };
    if items.is_empty() {
        return true;
    }
    items.iter().any(|item| {
        item.get(codec_key)
            .and_then(|value| value.as_str())
            .is_some_and(|value| value != "none")
            || item
                .get("ext")
                .and_then(|value| value.as_str())
                .is_some_and(|value| extension_fallback.contains(&value))
            || item
                .get("url")
                .and_then(|value| value.as_str())
                .is_some_and(|value| {
                    extension_fallback.iter().any(|ext| value.to_ascii_lowercase().contains(&format!(".{ext}")))
                })
    })
}

fn media_url_output_format(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_uppercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "FILE".into())
}

fn validate_media_capture_extra_args(args: &[String]) -> Result<Vec<String>, String> {
    const BLOCKED: &[&str] = &[
        "--exec",
        "--external-downloader",
        "--plugin-dirs",
        "--config-locations",
        "--enable-file-urls",
    ];
    let mut sanitized = Vec::new();
    for arg in args {
        let option = arg.split_once('=').map(|(name, _)| name).unwrap_or(arg.as_str());
        if BLOCKED.contains(&option) {
            return Err("该下载参数不受支持。".into());
        }
        sanitized.push(arg.clone());
    }
    Ok(sanitized)
}

fn select_media_url_output(output_dir: &Path, base: &str, started_at: SystemTime, stdout: &str) -> Result<PathBuf, String> {
    let canonical_output_dir = std::fs::canonicalize(output_dir).map_err(|e| format!("读取保存目录失败: {}", e))?;
    for line in stdout.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let path = PathBuf::from(line);
        if path.is_absolute() && path.exists() {
            let canonical = std::fs::canonicalize(path).map_err(|e| format!("输出文件不可访问: {}", e))?;
            if canonical.starts_with(&canonical_output_dir) {
                return Ok(canonical);
            }
        }
    }

    let mut candidates = Vec::new();
    let entries = std::fs::read_dir(output_dir).map_err(|e| format!("读取保存目录失败: {}", e))?;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with(base) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let modified = metadata.modified().unwrap_or(UNIX_EPOCH);
        if modified < started_at.checked_sub(Duration::from_secs(5)).unwrap_or(started_at) {
            continue;
        }
        candidates.push((modified, path));
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates
        .into_iter()
        .map(|(_, path)| path)
        .next()
        .ok_or_else(|| "下载完成但未找到输出文件。".to_string())
        .and_then(|path| std::fs::canonicalize(path).map_err(|e| format!("输出文件不可访问: {}", e)))
}

fn emit_media_url_progress(app: &tauri::AppHandle, job_id: &str, stage: &str, progress: u8, message: &str) {
    let _ = app.emit("media-url-capture-progress", MediaUrlCaptureProgress {
        job_id: job_id.to_string(),
        stage: stage.to_string(),
        progress,
        message: message.to_string(),
    });
}

async fn run_media_capture_output(
    app: &tauri::AppHandle,
    extra_args: &[String],
    timeout_secs: u64,
) -> Result<std::process::Output, String> {
    let candidate = media_capture_command(app)?;
    let mut command = Command::new(&candidate.program);
    command.args(&candidate.args);
    command.args(extra_args);
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.kill_on_drop(true);
    if let Some(cwd) = &candidate.cwd {
        command.current_dir(cwd);
    }

    timeout(Duration::from_secs(timeout_secs), command.output())
        .await
        .map_err(|_| "网页媒体采集超时，请稍后重试。".to_string())?
        .map_err(|e| format!("网页媒体采集启动失败: {}", e))
}

#[tauri::command]
async fn media_url_inspect(app: tauri::AppHandle, input: MediaUrlInspectInput) -> Result<MediaUrlInspectOutput, String> {
    let url = validate_media_url(&input.url)?;
    emit_media_url_progress(&app, input.job_id.as_deref().unwrap_or("inspect"), "inspect", 12, "正在获取媒体信息");
    let args = build_media_url_inspect_args(&input)?;
    let output = run_media_capture_output(&app, &args, 60).await?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        return Err(media_capture_error_message("解析失败", &stderr));
    }
    let data: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|_| "解析失败，返回内容格式不可识别。".to_string())?;
    let title = data.get("title").and_then(|value| value.as_str()).unwrap_or("网页媒体素材").to_string();
    let site = data
        .get("extractor_key")
        .or_else(|| data.get("extractor"))
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| media_url_site_from_url(&url));
    let duration_seconds = data.get("duration").and_then(|value| value.as_f64()).map(|value| value.max(0.0).round() as u64);
    let thumbnail_url = data.get("thumbnail").and_then(|value| value.as_str()).map(str::to_string);
    let formats = data.get("formats").and_then(|value| value.as_array());
    let has_video = media_url_has_stream_kind(formats, "vcodec", &["mp4", "webm", "m3u8", "mpd", "mov", "mkv"]);
    let has_audio = media_url_has_stream_kind(formats, "acodec", &["m4a", "mp3", "aac", "opus", "webm", "wav", "flac"]);
    let has_subtitles = data.get("subtitles").and_then(|value| value.as_object()).is_some_and(|value| !value.is_empty())
        || data.get("automatic_captions").and_then(|value| value.as_object()).is_some_and(|value| !value.is_empty());

    Ok(MediaUrlInspectOutput {
        id: input.job_id.unwrap_or_else(uuid_v4),
        url,
        title,
        site,
        duration_seconds,
        thumbnail_url,
        has_video,
        has_audio,
        has_subtitles,
        has_metadata: true,
    })
}

#[tauri::command]
async fn media_url_download(
    app: tauri::AppHandle,
    jobs: State<'_, MediaCaptureJobs>,
    input: MediaUrlDownloadInput,
) -> Result<MediaUrlDownloadOutput, String> {
    let url = validate_media_url(&input.url)?;
    if jobs.is_cancelled(&input.job_id).await {
        return Err("下载已停止。".into());
    }
    let output_dir = resolve_media_url_output_dir(&app, &input.job_id, input.output_dir.as_deref())?;
    let base = media_url_safe_base(input.title.as_deref(), &url);
    let ffmpeg_location = resolve_app_media_binary(&app, "ffmpeg").ok();
    let args = build_media_url_download_args(&input, &output_dir, ffmpeg_location.as_deref())?;
    let candidate = media_capture_command(&app)?;

    emit_media_url_progress(&app, &input.job_id, "prepare", 8, "正在获取媒体信息");
    let started_at = SystemTime::now();
    let mut command = Command::new(&candidate.program);
    command.args(&candidate.args);
    command.args(&args);
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.kill_on_drop(true);
    if let Some(cwd) = &candidate.cwd {
        command.current_dir(cwd);
    }

    let child = command.spawn().map_err(|e| format!("网页媒体采集启动失败: {}", e))?;
    jobs.register_pid(&input.job_id, child.id()).await;
    emit_media_url_progress(&app, &input.job_id, "download", 28, "正在下载媒体");
    let output_result = timeout(Duration::from_secs(1800), child.wait_with_output()).await;
    jobs.clear_pid(&input.job_id).await;
    let output = output_result
        .map_err(|_| "下载超时，请稍后重试。".to_string())?
        .map_err(|e| format!("下载失败: {}", e))?;
    if jobs.is_cancelled(&input.job_id).await {
        jobs.finish_job(&input.job_id).await;
        return Err("下载已停止。".into());
    }
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        jobs.finish_job(&input.job_id).await;
        return Err(media_capture_error_message("下载失败", &stderr));
    }

    emit_media_url_progress(&app, &input.job_id, "finalize", 86, "正在整理输出文件");
    let output_path = select_media_url_output(&output_dir, &base, started_at, &stdout)?;
    jobs.allow_output(&output_path).await?;
    jobs.finish_job(&input.job_id).await;
    emit_media_url_progress(&app, &input.job_id, "done", 100, "写入完成");
    let metadata = std::fs::metadata(&output_path).ok();
    let filename = output_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("web-media")
        .to_string();

    Ok(MediaUrlDownloadOutput {
        filename,
        output_path: output_path.to_string_lossy().to_string(),
        output_dir: output_dir.to_string_lossy().to_string(),
        size: metadata.map(|value| value.len()),
        duration_seconds: None,
        format: media_url_output_format(&output_path),
    })
}

#[tauri::command]
async fn cancel_media_url_download(
    jobs: State<'_, MediaCaptureJobs>,
    input: CancelMediaUrlDownloadInput,
) -> Result<(), String> {
    jobs.cancel_job(&input.job_id).await;
    Ok(())
}

#[tauri::command]
async fn media_open_file(jobs: State<'_, MediaCaptureJobs>, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !jobs.is_allowed_output(&path).await {
        return Err("只能打开本次工具生成的文件。".into());
    }
    open_path_with_system(&path, false)
}

#[tauri::command]
async fn media_reveal_file(jobs: State<'_, MediaCaptureJobs>, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !jobs.is_allowed_output(&path).await {
        return Err("只能定位本次工具生成的文件。".into());
    }
    open_path_with_system(&path, true)
}

/// P3: 在系统文件管理器中打开路径（我的文件入口）。目录不存在则先创建。
#[tauri::command]
async fn open_in_shell(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    // 若路径不存在，尝试创建目录（用户首次点击「我的文件」时）
    if !p.exists() {
        std::fs::create_dir_all(&p)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    open_path_with_system(&p, false)
}

fn open_path_with_system(path: &Path, reveal: bool) -> Result<(), String> {
    if !path.exists() {
        return Err("文件不存在。".into());
    }
    #[cfg(target_os = "macos")]
    {
        let status = if reveal {
            StdCommand::new("open").arg("-R").arg(path).status()
        } else {
            StdCommand::new("open").arg(path).status()
        }
        .map_err(|e| format!("打开文件失败: {}", e))?;
        return status.success().then_some(()).ok_or_else(|| "打开文件失败。".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        let status = if reveal {
            StdCommand::new("explorer").arg(format!("/select,{}", path.to_string_lossy())).status()
        } else {
            StdCommand::new("cmd").args(["/C", "start", "", &path.to_string_lossy()]).status()
        }
        .map_err(|e| format!("打开文件失败: {}", e))?;
        return status.success().then_some(()).ok_or_else(|| "打开文件失败。".to_string());
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let target = if reveal { path.parent().unwrap_or(path) } else { path };
        let status = StdCommand::new("xdg-open")
            .arg(target)
            .status()
            .map_err(|e| format!("打开文件失败: {}", e))?;
        return status.success().then_some(()).ok_or_else(|| "打开文件失败。".to_string());
    }
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

#[derive(Deserialize)]
struct HttpDownloadRequest {
    url: String,
    timeout_secs: Option<u64>,
}

#[derive(Serialize)]
struct HttpDownloadResponse {
    status: u16,
    headers: HashMap<String, String>,
    data_base64: String,
}

fn is_unified_api_host(url: &str) -> bool {
    tauri::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host == "api.jiucaihezi.studio"))
        .unwrap_or(false)
}

fn is_newapi_passthrough_path(url: &str) -> bool {
    tauri::Url::parse(url)
        .ok()
        .map(|parsed| parsed.path().starts_with("/v1/"))
        .unwrap_or(false)
}

fn has_gateway_session_header(headers: &Option<HashMap<String, String>>) -> bool {
    headers.as_ref().is_some_and(|headers| {
        headers.keys().any(|key| key.eq_ignore_ascii_case("x-jc-session"))
    })
}

fn should_direct_unified_api_to_newapi(request: &HttpRequest) -> bool {
    is_unified_api_host(&request.url)
        && is_newapi_passthrough_path(&request.url)
        && !has_gateway_session_header(&request.headers)
}

fn should_direct_unified_download_to_newapi(request: &HttpDownloadRequest) -> bool {
    is_unified_api_host(&request.url) && is_newapi_passthrough_path(&request.url)
}

fn with_newapi_source_resolution(mut client_builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    client_builder = client_builder.resolve(
        "api.jiucaihezi.studio",
        std::net::SocketAddr::new(
            std::net::IpAddr::V4(std::net::Ipv4Addr::new(47, 82, 86, 196)),
            443,
        ),
    );
    client_builder
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

struct OpenCodeSession {
    child: tokio::process::Child,
    url: String,
    password: String,
    directory: String,
    config_signature: String,
}

#[derive(Default)]
struct OpenCodeRuntime {
    session: Mutex<Option<OpenCodeSession>>,
    operation: Mutex<()>,
}

impl Drop for OpenCodeRuntime {
    fn drop(&mut self) {
        // 必须杀掉子进程。try_lock 偶尔因并发操作失败，加 3 次重试兜底。
        // 如果还是失败，说明进程卡死，依赖 OS 在父进程退出后回收孤儿进程。
        for _ in 0..3 {
            if let Ok(mut session) = self.session.try_lock() {
                if let Some(mut current) = session.take() {
                    let _ = current.child.start_kill();
                }
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        eprintln!("[OpenCode] 警告：无法获取 session 锁，OpenCode 子进程可能未被清理");
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenCodeEnsureInput {
    config: serde_json::Value,
    port: Option<u16>,
    hostname: Option<String>,
    timeout_ms: Option<u64>,
    directory: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OpenCodeServerStatus {
    running: bool,
    url: Option<String>,
    authorization: Option<String>,
    pid: Option<u32>,
    directory: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OpenCodeMcpServerStatus {
    name: String,
    status: String,
    detail: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OpenCodeMcpStatus {
    available: bool,
    configured: bool,
    count: usize,
    servers: Vec<OpenCodeMcpServerStatus>,
    raw_output: String,
    error: Option<String>,
    command: String,
    directory: String,
}

fn basic_auth_header(username: &str, password: &str) -> String {
    format!(
        "Basic {}",
        general_purpose::STANDARD.encode(format!("{username}:{password}").as_bytes())
    )
}

fn random_opencode_password() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("jc-opencode-{nanos:x}-{}", std::process::id())
}

/// 跨平台获取用户 home 目录（Windows 用 USERPROFILE，Unix 用 HOME）
fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
}

fn opencode_runtime_root() -> Result<PathBuf, String> {
    let home = user_home_dir()
        .ok_or_else(|| "无法定位用户目录，不能启动 OpenCode runtime。".to_string())?;
    Ok(home.join(".jiucaihezi").join("opencode-runtime"))
}

fn prepare_opencode_runtime_dirs(root: &Path) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf), String> {
    let data = root.join("data");
    let state = root.join("state");
    let config = root.join("config");
    let workspace = root.join("workspace").join("default");
    for dir in [&data, &state, &config, &workspace] {
        std::fs::create_dir_all(dir).map_err(|e| {
            format!("无法创建 OpenCode runtime 目录 {}: {e}", dir.to_string_lossy())
        })?;
    }
    Ok((data, state, config, workspace))
}

fn reserve_local_port(hostname: &str) -> Result<u16, String> {
    let listener = TcpListener::bind((hostname, 0))
        .map_err(|e| format!("无法为 OpenCode server 申请本机端口: {e}"))?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|e| format!("无法读取 OpenCode server 本机端口: {e}"))
}

fn opencode_status_from_session(session: &OpenCodeSession) -> OpenCodeServerStatus {
    OpenCodeServerStatus {
        running: true,
        url: Some(session.url.clone()),
        authorization: Some(basic_auth_header("opencode", &session.password)),
        pid: session.child.id(),
        directory: Some(session.directory.clone()),
    }
}

#[tauri::command]
async fn opencode_status(runtime: State<'_, OpenCodeRuntime>) -> Result<OpenCodeServerStatus, String> {
    let mut session = runtime.session.lock().await;
    if let Some(current) = session.as_mut() {
        match current.child.try_wait() {
            Ok(Some(_)) => {
                *session = None;
            }
            Ok(None) => return Ok(opencode_status_from_session(current)),
            Err(_) => {
                *session = None;
            }
        }
    }
    Ok(OpenCodeServerStatus {
        running: false,
        url: None,
        authorization: None,
        pid: None,
        directory: None,
    })
}

#[tauri::command]
async fn opencode_stop(runtime: State<'_, OpenCodeRuntime>) -> Result<(), String> {
    let _guard = runtime.operation.lock().await;
    let mut session = runtime.session.lock().await;
    if let Some(mut current) = session.take() {
        let _ = current.child.kill().await;
    }
    Ok(())
}

fn strip_ansi_codes(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if ('@'..='~').contains(&next) {
                    break;
                }
            }
            continue;
        }
        output.push(ch);
    }
    output
}

fn parse_opencode_mcp_servers(raw: &str) -> Vec<OpenCodeMcpServerStatus> {
    raw.lines()
        .map(|line| {
            line.trim()
                .trim_start_matches(['│', '├', '└', '┌', '▲', '●', '○', '✓', '✕', '-'])
                .trim()
        })
        .filter(|line| {
            !line.is_empty()
                && !line.eq_ignore_ascii_case("MCP Servers")
                && !line.contains("No MCP servers configured")
                && !line.contains("Add servers with:")
        })
        .map(|line| {
            let lower = line.to_lowercase();
            let status = if lower.contains("connected") || lower.contains("enabled") {
                "connected"
            } else if lower.contains("error") || lower.contains("failed") {
                "error"
            } else if lower.contains("auth") {
                "needs_auth"
            } else {
                "configured"
            };
            let name = line
                .split_whitespace()
                .next()
                .unwrap_or(line)
                .trim_matches([':', '-', '•'])
                .to_string();
            OpenCodeMcpServerStatus {
                name: if name.is_empty() { line.to_string() } else { name },
                status: status.to_string(),
                detail: line.to_string(),
            }
        })
        .collect()
}

#[tauri::command]
async fn opencode_mcp_status(app: tauri::AppHandle) -> Result<OpenCodeMcpStatus, String> {
    let runtime_root = opencode_runtime_root()?;
    let (data_dir, state_dir, config_dir, workspace_dir) = prepare_opencode_runtime_dirs(&runtime_root)?;
    let directory = workspace_dir.to_string_lossy().to_string();
    let program = match resolve_opencode_binary(Some(&app)) {
        Ok(program) => program,
        Err(error) => {
            return Ok(OpenCodeMcpStatus {
                available: false,
                configured: false,
                count: 0,
                servers: vec![],
                raw_output: String::new(),
                error: Some(error),
                command: "opencode mcp list".to_string(),
                directory,
            });
        }
    };

    let command_label = format!("{} mcp list", program.to_string_lossy());
    let mut command = Command::new(&program);
    command
        .arg("mcp")
        .arg("list")
        .current_dir(&workspace_dir)
        .env("NO_COLOR", "1")
        .env("OPENCODE_AUTH_CONTENT", "{}")
        .env("XDG_DATA_HOME", data_dir)
        .env("XDG_STATE_HOME", state_dir)
        .env("XDG_CONFIG_HOME", config_dir)
        .stdin(Stdio::null())
        .kill_on_drop(true);

    let output = match timeout(Duration::from_millis(8000), command.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            return Ok(OpenCodeMcpStatus {
                available: true,
                configured: false,
                count: 0,
                servers: vec![],
                raw_output: String::new(),
                error: Some(format!("无法执行 OpenCode MCP 状态命令：{error}")),
                command: command_label,
                directory,
            });
        }
        Err(_) => {
            return Ok(OpenCodeMcpStatus {
                available: true,
                configured: false,
                count: 0,
                servers: vec![],
                raw_output: String::new(),
                error: Some("OpenCode MCP 状态命令超时。".to_string()),
                command: command_label,
                directory,
            });
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let raw_output = strip_ansi_codes(format!("{stdout}{stderr}").trim());
    let servers = parse_opencode_mcp_servers(&raw_output);
    let configured = !raw_output.contains("No MCP servers configured") && !servers.is_empty();
    let error = if output.status.success() {
        None
    } else {
        Some(format!(
            "OpenCode MCP 状态命令退出码 {:?}。",
            output.status.code()
        ))
    };

    Ok(OpenCodeMcpStatus {
        available: true,
        configured,
        count: servers.len(),
        servers,
        raw_output,
        error,
        command: command_label,
        directory,
    })
}

#[tauri::command]
async fn opencode_ensure_server(
    app: tauri::AppHandle,
    runtime: State<'_, OpenCodeRuntime>,
    input: OpenCodeEnsureInput,
) -> Result<OpenCodeServerStatus, String> {
    let _guard = runtime.operation.lock().await;
    let requested_dir = input.directory.as_deref().unwrap_or("").to_string();
    let requested_config_signature = input.config.to_string();
    {
        let mut session = runtime.session.lock().await;
        if let Some(current) = session.as_mut() {
            match current.child.try_wait() {
                Ok(Some(_)) => {
                    *session = None;
                }
                Ok(None) => {
                    if (!requested_dir.is_empty() && current.directory != requested_dir)
                        || current.config_signature != requested_config_signature
                    {
                        let _ = current.child.start_kill();
                        *session = None;
                    } else {
                        return Ok(opencode_status_from_session(current));
                    }
                }
                Err(_) => {
                    *session = None;
                }
            }
        }
    }

    let hostname = input
        .hostname
        .unwrap_or_else(|| "127.0.0.1".to_string())
        .trim()
        .to_string();
    if hostname != "127.0.0.1" && hostname != "localhost" {
        return Err("OpenCode server 只允许绑定本机地址。".into());
    }

    let port = match input.port {
        Some(port) => port,
        None => reserve_local_port(&hostname)?,
    };
    let timeout_ms = input.timeout_ms.unwrap_or(8000).clamp(1000, 30000);
    let password = random_opencode_password();
    let program = resolve_opencode_binary(Some(&app))?;
    let runtime_root = opencode_runtime_root()?;
    let (data_dir, state_dir, config_dir, workspace_dir) = prepare_opencode_runtime_dirs(&runtime_root)?;
    let fallback_dir = user_home_dir().unwrap_or(workspace_dir.clone());
    let effective_dir = if !requested_dir.is_empty() {
        let p = PathBuf::from(&requested_dir);
        if p.is_dir() { p } else { fallback_dir }
    } else {
        fallback_dir
    };
    let database_path = data_dir.join("jiucaihezi-opencode.db");
    // ponytail: 清理可能损坏的 SQLite WAL/SHM 残留。OpenCode 非正常退出时
    // 留下 -wal/-shm 文件，再次启动时 SQLite 可能报 "SQLiteError: no such table" 等。
    // 删除残留文件让 SQLite 从主 DB 重建，数据不丢失（WAL 仅含未提交事务）。
    for suffix in &["-wal", "-shm"] {
        let stale = database_path.with_extension(format!("db{}", suffix));
        if stale.exists() {
            let _ = std::fs::remove_file(&stale);
            eprintln!("[OpenCode] 已清理残留 SQLite {} 文件: {}", suffix, stale.display());
        }
    }
    let mut command = Command::new(program);
    command
        .arg("serve")
        .arg(format!("--hostname={hostname}"))
        .arg(format!("--port={port}"))
        .current_dir(&effective_dir)
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .env("OPENCODE_CONFIG_CONTENT", &requested_config_signature)
        .env("OPENCODE_AUTH_CONTENT", "{}")
        .env("OPENCODE_DB", database_path)
        .env("OPENCODE_EXPERIMENTAL", "true")
        .env("XDG_DATA_HOME", data_dir)
        .env("XDG_STATE_HOME", state_dir)
        .env("XDG_CONFIG_HOME", config_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command.spawn().map_err(|e| format!("无法启动 OpenCode server: {e}"))?;
    let stdout = child.stdout.take().ok_or("无法读取 OpenCode server stdout")?;
    let stderr = child.stderr.take().ok_or("无法读取 OpenCode server stderr")?;
    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();
    let mut output = String::new();

    let ready_url = timeout(Duration::from_millis(timeout_ms), async {
        loop {
            tokio::select! {
                line = stdout_reader.next_line() => {
                    match line {
                        Ok(Some(line)) => {
                            output.push_str(&line);
                            output.push('\n');
                            if line.starts_with("opencode server listening") {
                                if let Some(url) = line.split_whitespace().find(|part| part.starts_with("http://") || part.starts_with("https://")) {
                                    return Ok(url.to_string());
                                }
                                return Err(format!("无法解析 OpenCode server 地址: {line}"));
                            }
                        }
                        Ok(None) => return Err("OpenCode server 启动时 stdout 已关闭。".to_string()),
                        Err(e) => return Err(format!("读取 OpenCode stdout 失败: {e}")),
                    }
                }
                line = stderr_reader.next_line() => {
                    if let Ok(Some(line)) = line {
                        output.push_str(&line);
                        output.push('\n');
                    }
                }
                status = child.wait() => {
                    let code = status.map(|s| s.code()).unwrap_or(None);
                    return Err(format!("OpenCode server 启动失败，退出码 {:?}: {}", code, output.trim()));
                }
            }
        }
    })
    .await
    .map_err(|_| format!("OpenCode server 启动超时（{}ms）。", timeout_ms))??;

    tokio::spawn(async move {
        let mut lines = stderr_reader;
        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[OpenCode stderr] {line}");
        }
    });

    let mut session = runtime.session.lock().await;
    *session = Some(OpenCodeSession {
        child,
        url: ready_url,
        password,
        directory: effective_dir.to_string_lossy().to_string(),
        config_signature: requested_config_signature,
    });
    Ok(opencode_status_from_session(session.as_ref().expect("session inserted")))
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
    let home = user_home_dir().ok_or_else(|| "无法读取用户目录".to_string())?;
    Ok(home.join(".jiucaihezi"))
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
struct ScaffoldVaultInput {
    vault_root: String,
    folders: Vec<String>,
    files: Vec<(String, String)>,
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
struct SkillMaterialSourceInput {
    source_type: String,
    value: String,
    github_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillMaterialCompileInput {
    runtime_root: String,
    workspace_path: String,
    name: String,
    source: SkillMaterialSourceInput,
    preset: Option<String>,
    max_pages: Option<u32>,
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
struct MediaInspectFileInput {
    input_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaSelectFileInput {
    title: Option<String>,
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SkillMaterialRawFile {
    path: String,
    content: String,
    mime_type: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillMaterialCompileOutput {
    command: String,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    duration_ms: u128,
    raw_files: Vec<SkillMaterialRawFile>,
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
struct MediaInspectFileOutput {
    input_path: String,
    filename: String,
    size: u64,
    format: String,
    kind: String,
    duration_seconds: Option<f64>,
    width: Option<u64>,
    height: Option<u64>,
    fps: Option<f64>,
    audio_codec: Option<String>,
    video_codec: Option<String>,
    has_audio: bool,
    has_video: bool,
    has_subtitles: bool,
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
    let mut client_builder = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .pool_idle_timeout(std::time::Duration::from_secs(90));
    // 默认 30 秒总超时（非流式请求适用）
    client_builder = client_builder.timeout(std::time::Duration::from_secs(
        request.timeout_secs.unwrap_or(30),
    ));
    if should_direct_unified_api_to_newapi(&request) {
        client_builder = with_newapi_source_resolution(client_builder);
    }
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

#[tauri::command]
async fn http_download_base64(request: HttpDownloadRequest) -> Result<HttpDownloadResponse, String> {
    let mut client_builder = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .pool_idle_timeout(std::time::Duration::from_secs(90));
    client_builder = client_builder.timeout(std::time::Duration::from_secs(
        request.timeout_secs.unwrap_or(60),
    ));
    if should_direct_unified_download_to_newapi(&request) {
        client_builder = with_newapi_source_resolution(client_builder);
    }
    let client = client_builder
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;
    let resp = client
        .get(&request.url)
        .send()
        .await
        .map_err(|e| format!("HTTP 下载失败: {}", e))?;
    let status = resp.status().as_u16();
    let mut headers = HashMap::new();
    for (key, value) in resp.headers() {
        if let Ok(v) = value.to_str() {
            headers.insert(key.to_string(), v.to_string());
        }
    }
    let bytes = resp.bytes().await.map_err(|e| format!("读取下载数据失败: {}", e))?;
    Ok(HttpDownloadResponse {
        status,
        headers,
        data_base64: general_purpose::STANDARD.encode(bytes),
    })
}

#[derive(Default)]
struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    fn push(&mut self, bytes: &[u8]) -> String {
        if bytes.is_empty() {
            return String::new();
        }

        self.pending.extend_from_slice(bytes);
        match std::str::from_utf8(&self.pending) {
            Ok(text) => {
                let output = text.to_string();
                self.pending.clear();
                output
            }
            Err(err) => {
                let valid_up_to = err.valid_up_to();
                if valid_up_to == 0 {
                    return String::new();
                }
                let output = String::from_utf8_lossy(&self.pending[..valid_up_to]).to_string();
                self.pending.drain(..valid_up_to);
                output
            }
        }
    }

    fn finish(&mut self) -> String {
        if self.pending.is_empty() {
            return String::new();
        }
        let output = String::from_utf8_lossy(&self.pending).to_string();
        self.pending.clear();
        output
    }
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

    // SSE 流式请求：仅设连接超时，不设 total timeout（避免误杀长时间流式对话）
    let mut client_builder = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .pool_idle_timeout(std::time::Duration::from_secs(90));
    // 仅在显式指定 timeout_secs 时才设置 total timeout
    if let Some(secs) = request.timeout_secs {
        client_builder = client_builder.timeout(std::time::Duration::from_secs(secs));
    }
    if should_direct_unified_api_to_newapi(&request) {
        client_builder = with_newapi_source_resolution(client_builder);
    }
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
    let mut utf8_decoder = Utf8StreamDecoder::default();
    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(bytes) => {
                let text = utf8_decoder.push(&bytes);
                if !text.is_empty() {
                    on_chunk
                        .send(serde_json::json!({
                            "event": "chunk",
                            "data": text,
                        }))
                        .map_err(|e| format!("推送 chunk 失败: {}", e))?;
                }
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

    let tail = utf8_decoder.finish();
    if !tail.is_empty() {
        on_chunk
            .send(serde_json::json!({
                "event": "chunk",
                "data": tail,
            }))
            .map_err(|e| format!("推送 chunk 失败: {}", e))?;
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevRenameInput {
    root: String,
    old_relative_path: String,
    new_relative_path: String,
}

#[tauri::command]
fn dev_rename_file(input: DevRenameInput) -> Result<String, String> {
    let root = canonical_root(&input.root)?;
    let old_path = resolve_existing_path(&root, &input.old_relative_path)?;
    let new_path = resolve_write_path(&root, &input.new_relative_path)?;
    if let Some(parent) = new_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败: {}", e))?;
    }
    std::fs::rename(&old_path, &new_path).map_err(|e| format!("重命名失败: {}", e))?;
    Ok(display_relative(&root, &new_path))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevDeleteInput {
    root: String,
    relative_path: String,
}

#[tauri::command]
fn dev_delete_file(input: DevDeleteInput) -> Result<(), String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_existing_path(&root, &input.relative_path)?;
    if path.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| format!("删除目录失败: {}", e))?;
    } else {
        std::fs::remove_file(&path).map_err(|e| format!("删除文件失败: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn dev_create_dir(input: DevWriteFileInput) -> Result<(), String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_write_path(&root, &input.relative_path)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("创建目录失败: {}", e))?;
    Ok(())
}

#[tauri::command]
fn dev_reveal_in_finder(path: String) -> Result<(), String> {
    open_path_with_system(&PathBuf::from(&path), true)
}

#[tauri::command]
fn scaffold_vault(input: ScaffoldVaultInput) -> Result<(), String> {
    let root = canonical_root(&input.vault_root)?;

    for folder in input.folders.iter().take(200) {
        let clean = clean_relative_path(folder)?;
        if clean.as_os_str().is_empty() {
            continue;
        }
        let dir = root.join(clean);
        if !dir.starts_with(&root) {
            return Err("路径不能跳出知识库目录".into());
        }
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    for (relative_path, content) in input.files.iter().take(50) {
        let path = resolve_write_path(&root, relative_path)?;
        if path.exists() {
            return Err(format!("文件已存在，已停止避免覆盖: {}", display_relative(&root, &path)));
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
        std::fs::write(&path, content.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;
    }

    Ok(())
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

fn validate_selected_media_path(input_path: &str) -> Result<PathBuf, String> {
    let raw = input_path.trim();
    if raw.is_empty() || raw.contains('\0') {
        return Err("请选择有效的音频或视频文件。".into());
    }
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err("请选择有效的音频或视频文件。".into());
    }
    if path.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err("文件路径不安全，请重新选择文件。".into());
    }
    let canonical = std::fs::canonicalize(&path).map_err(|_| "文件不可访问，请重新选择。".to_string())?;
    if !canonical.is_file() {
        return Err("请选择有效的音频或视频文件。".into());
    }
    Ok(canonical)
}

async fn resolve_media_input_path(
    app: &tauri::AppHandle,
    jobs: &MediaCaptureJobs,
    input_path: &str,
) -> Result<PathBuf, String> {
    let cache_dir = app_media_dir(app, "media-cache")?;
    let path = validate_selected_media_path(input_path)?;
    if path.starts_with(&cache_dir) || jobs.is_allowed_input(&path).await {
        return Ok(path);
    }
    Err("请选择工具中添加的音频或视频文件。".into())
}

fn parse_fps(raw: &str) -> Option<f64> {
    let value = raw.trim();
    if value.is_empty() || value == "0/0" {
        return None;
    }
    if let Some((left, right)) = value.split_once('/') {
        let numerator = left.parse::<f64>().ok()?;
        let denominator = right.parse::<f64>().ok()?;
        if denominator <= 0.0 {
            return None;
        }
        return Some(numerator / denominator);
    }
    value.parse::<f64>().ok()
}

fn media_kind(has_video: bool, has_audio: bool) -> String {
    if has_video {
        "video".into()
    } else if has_audio {
        "audio".into()
    } else {
        "unknown".into()
    }
}

async fn inspect_media_path(app: &tauri::AppHandle, source: &Path) -> Result<MediaInspectFileOutput, String> {
    let metadata = std::fs::metadata(source).map_err(|_| "文件不可访问，请重新选择。".to_string())?;
    let filename = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("media")
        .to_string();
    let fallback_format = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_uppercase();

    let output = timeout(
        Duration::from_secs(20),
        Command::new(resolve_app_media_binary(app, "ffprobe")?)
            .args([
                "-v",
                "error",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                &source.to_string_lossy(),
            ])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "读取媒体信息超时，请稍后重试。".to_string())?
    .map_err(|_| "媒体处理组件暂时不可用，请重启应用后重试。".to_string())?;

    if !output.status.success() {
        return Err("无法读取这个媒体文件的信息。".into());
    }

    let data: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "媒体信息格式不可识别。".to_string())?;
    let streams = data.get("streams").and_then(|value| value.as_array()).cloned().unwrap_or_default();
    let mut width = None;
    let mut height = None;
    let mut fps = None;
    let mut audio_codec = None;
    let mut video_codec = None;
    let mut has_audio = false;
    let mut has_video = false;
    let mut has_subtitles = false;

    for stream in streams {
        let codec_type = stream.get("codec_type").and_then(|value| value.as_str()).unwrap_or("");
        match codec_type {
            "video" => {
                has_video = true;
                if width.is_none() {
                    width = stream.get("width").and_then(|value| value.as_u64());
                    height = stream.get("height").and_then(|value| value.as_u64());
                    fps = stream
                        .get("avg_frame_rate")
                        .or_else(|| stream.get("r_frame_rate"))
                        .and_then(|value| value.as_str())
                        .and_then(parse_fps);
                    video_codec = stream.get("codec_name").and_then(|value| value.as_str()).map(str::to_string);
                }
            }
            "audio" => {
                has_audio = true;
                if audio_codec.is_none() {
                    audio_codec = stream.get("codec_name").and_then(|value| value.as_str()).map(str::to_string);
                }
            }
            "subtitle" => {
                has_subtitles = true;
            }
            _ => {}
        }
    }

    let duration_seconds = data
        .get("format")
        .and_then(|value| value.get("duration"))
        .and_then(|value| value.as_str())
        .and_then(|value| value.parse::<f64>().ok());
    let format = data
        .get("format")
        .and_then(|value| value.get("format_name"))
        .and_then(|value| value.as_str())
        .map(|value| value.split(',').next().unwrap_or(value).to_ascii_uppercase())
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback_format);

    Ok(MediaInspectFileOutput {
        input_path: source.to_string_lossy().to_string(),
        filename,
        size: metadata.len(),
        format,
        kind: media_kind(has_video, has_audio),
        duration_seconds,
        width,
        height,
        fps,
        audio_codec,
        video_codec,
        has_audio,
        has_video,
        has_subtitles,
    })
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

fn find_transcript_output(output_dir: &Path, stem: &str, format: &str, started_at: SystemTime) -> Option<PathBuf> {
    let direct = output_dir.join(format!("{}.{}", stem, format));
    if direct.exists()
        && std::fs::metadata(&direct)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .is_some_and(|modified| modified >= started_at.checked_sub(Duration::from_secs(5)).unwrap_or(started_at))
    {
        return Some(direct);
    }
    let mut candidates = std::fs::read_dir(output_dir)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some(format))
        .filter(|path| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.starts_with(stem))
        })
        .filter_map(|path| {
            let modified = std::fs::metadata(&path).ok()?.modified().ok()?;
            if modified < started_at.checked_sub(Duration::from_secs(5)).unwrap_or(started_at) {
                return None;
            }
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
async fn media_select_file(
    app: tauri::AppHandle,
    jobs: State<'_, MediaCaptureJobs>,
    input: MediaSelectFileInput,
) -> Result<Option<MediaInspectFileOutput>, String> {
    let selected = app
        .dialog()
        .file()
        .set_title(input.title.unwrap_or_else(|| "选择音频或视频".into()))
        .add_filter("音频视频", &["mp4", "mov", "mkv", "webm", "mp3", "wav", "aac", "m4a", "flac", "ogg"])
        .blocking_pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected
        .as_path()
        .ok_or_else(|| "请选择有效的音频或视频文件。".to_string())?;
    let source = jobs.allow_input(path).await?;
    inspect_media_path(&app, &source).await.map(Some)
}

#[tauri::command]
async fn media_inspect_file(
    app: tauri::AppHandle,
    jobs: State<'_, MediaCaptureJobs>,
    input: MediaInspectFileInput,
) -> Result<MediaInspectFileOutput, String> {
    let source = resolve_media_input_path(&app, &jobs, &input.input_path).await?;
    inspect_media_path(&app, &source).await
}

#[tauri::command]
async fn media_process_file(
    app: tauri::AppHandle,
    jobs: State<'_, MediaCaptureJobs>,
    input: MediaProcessFileInput,
) -> Result<MediaProcessFileOutput, String> {
    let source = resolve_media_input_path(&app, &jobs, &input.input_path).await?;
    let output_dir = app_media_dir(&app, "media-outputs")?;
    let output_filename = sanitize_media_filename(&input.output_filename, "media-output.mp4");
    let output_path = output_dir.join(unique_media_filename(&output_filename));
    let args = build_ffmpeg_args(&input, &source, &output_path)?;
    let start = Instant::now();

    let output = timeout(
        Duration::from_secs(900),
        Command::new(resolve_app_media_binary(&app, "ffmpeg")?).args(args).kill_on_drop(true).output(),
    )
    .await
    .map_err(|_| "媒体处理超时，请稍后重试。".to_string())?
    .map_err(|_| "媒体处理组件暂时不可用，请重启应用后重试。".to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let detail = stderr.trim();
        if detail.is_empty() {
            return Err("媒体处理失败，请检查文件后重试。".into());
        }
        return Err(format!(
            "媒体处理失败：{}",
            sanitize_media_process_error(detail, "请检查文件后重试。")
        ));
    }

    let output_size = std::fs::metadata(&output_path)
        .map_err(|e| format!("读取输出文件失败: {}", e))?
        .len();
    jobs.allow_output(&output_path).await?;
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
async fn media_transcribe_file(
    app: tauri::AppHandle,
    jobs: State<'_, MediaCaptureJobs>,
    input: MediaTranscribeFileInput,
) -> Result<MediaTranscribeFileOutput, String> {
    let source = resolve_media_input_path(&app, &jobs, &input.input_path).await?;
    let output_root = app_media_dir(&app, "media-transcripts")?;
    let output_dir = output_root.join(unique_media_filename("transcript-job"));
    std::fs::create_dir_all(&output_dir).map_err(|e| format!("创建转文字目录失败: {}", e))?;
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
    let started_at = SystemTime::now();

    let mut command = Command::new({
        resolve_app_media_binary(&app, "whisper-cli")
            .or_else(|_| resolve_app_media_binary(&app, "whisper"))
            .map_err(|_| "媒体处理组件不可用，请重新安装应用后重试。".to_string())?
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
        .map_err(|_| "转文字超时，请稍后重试。".to_string())?
        .map_err(|_| "媒体处理组件暂时不可用，请重启应用后重试。".to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let detail = stderr.trim();
        if detail.is_empty() {
            return Err("转文字失败，请检查文件后重试。".into());
        }
        return Err(format!(
            "转文字失败：{}",
            sanitize_media_process_error(detail, "请检查文件后重试。")
        ));
    }

    let output_path = find_transcript_output(&output_dir, &stem, &format, started_at)
        .ok_or_else(|| "转文字完成后没有找到输出文件。".to_string())?;
    let output_size = std::fs::metadata(&output_path)
        .map_err(|e| format!("读取转写文件失败: {}", e))?
        .len();
    let text = std::fs::read_to_string(&output_path).unwrap_or_default();
    let output_filename = output_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("transcript.txt")
        .to_string();

    jobs.allow_output(&output_path).await?;
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
async fn media_burn_subtitles(
    app: tauri::AppHandle,
    jobs: State<'_, MediaCaptureJobs>,
    input: MediaBurnSubtitlesInput,
) -> Result<MediaProcessFileOutput, String> {
    let source = resolve_media_input_path(&app, &jobs, &input.input_path).await?;
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
        Command::new(resolve_app_media_binary(&app, "ffmpeg")?)
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
    .map_err(|_| "视频上字幕超时，请稍后重试。".to_string())?
    .map_err(|_| "媒体处理组件暂时不可用，请重启应用后重试。".to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let detail = stderr.trim();
        if detail.is_empty() {
            return Err("视频上字幕失败，请检查字幕文件后重试。".into());
        }
        return Err(format!(
            "视频上字幕失败：{}",
            sanitize_media_process_error(detail, "请检查字幕文件后重试。")
        ));
    }
    let output_size = std::fs::metadata(&output_path)
        .map_err(|e| format!("读取输出文件失败: {}", e))?
        .len();
    jobs.allow_output(&output_path).await?;
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct SkillMaterialCommandSpec {
    program: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    display_command: String,
}

fn validate_skill_material_source(source: &SkillMaterialSourceInput) -> Result<(), String> {
    let value = source.value.trim();
    if value.is_empty() || value.contains('\0') {
        return Err("资料来源无效".into());
    }
    match source.source_type.as_str() {
        "pdf" | "local_codebase" => {
            let path = Path::new(value);
            if !path.is_absolute() {
                return Err("本地资料路径必须是绝对路径".into());
            }
            if path.components().any(|part| matches!(part, Component::ParentDir)) {
                return Err("本地资料路径不能包含 ..".into());
            }
            reject_symlink_path(path)?;
            Ok(())
        }
        "documentation_url" => {
            validate_public_http_url(value)
        }
        "github_repo" => {
            let parts: Vec<&str> = value.split('/').collect();
            let valid = parts.len() == 2
                && parts.iter().all(|part| {
                    !part.is_empty()
                        && part.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
                });
            if valid { Ok(()) } else { Err("GitHub 仓库必须使用 owner/repo 格式".into()) }
        }
        _ => Err("当前素材转Skill暂不支持这个资料来源".into()),
    }
}

fn reject_symlink_path(path: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if let Ok(metadata) = std::fs::symlink_metadata(&current) {
            if metadata.file_type().is_symlink() {
                return Err("本地资料路径不能包含符号链接".into());
            }
        }
    }
    Ok(())
}

fn validate_public_http_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "文档 URL 无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("文档 URL 只支持 http/https".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("文档 URL 不能包含账号密码".into());
    }
    let Some(host) = url.host_str() else {
        return Err("文档 URL 缺少域名".into());
    };
    if is_unsafe_skill_material_host(host) {
        return Err("文档 URL 不能指向本机、内网或元数据地址".into());
    }
    Ok(())
}

fn is_unsafe_skill_material_host(host: &str) -> bool {
    let normalized = host.trim_matches(['[', ']']).trim_end_matches('.').to_ascii_lowercase();
    if normalized.is_empty() {
        return true;
    }
    if normalized == "localhost" || normalized.ends_with(".localhost") || normalized == "metadata.google.internal" {
        return true;
    }
    if let Ok(ip) = normalized.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(ipv4) => {
                let octets = ipv4.octets();
                ipv4.is_loopback()
                    || ipv4.is_private()
                    || ipv4.is_link_local()
                    || octets[0] == 0
            }
            std::net::IpAddr::V6(ipv6) => {
                let segments = ipv6.segments();
                ipv6.is_loopback()
                    || (segments[0] & 0xfe00) == 0xfc00
                    || (segments[0] & 0xffc0) == 0xfe80
            }
        };
    }
    false
}

fn build_skill_material_command(input: &SkillMaterialCompileInput) -> Result<SkillMaterialCommandSpec, String> {
    validate_skill_material_source(&input.source)?;
    let runtime_root = canonical_root(&input.runtime_root)?;
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Skill 名称不能为空".into());
    }
    let preset = input.preset.as_deref().unwrap_or("quick");
    if !matches!(preset, "quick" | "standard") {
        return Err("preset 只支持 quick 或 standard".into());
    }

    let mut args = vec![
        "run".to_string(),
        "skill-seekers".to_string(),
        "create".to_string(),
        input.source.value.trim().to_string(),
        "--name".to_string(),
        name.to_string(),
        "--preset".to_string(),
        preset.to_string(),
        "--output".to_string(),
        input.workspace_path.trim().to_string(),
    ];
    if input.source.source_type == "documentation_url" {
        if let Some(max_pages) = input.max_pages {
            args.push("--max-pages".into());
            args.push(max_pages.clamp(1, 1000).to_string());
        }
    }
    args.extend([
        "--enhance-level".to_string(),
        "0".to_string(),
        "--quiet".to_string(),
        "--non-interactive".to_string(),
    ]);

    let mut env = HashMap::new();
    if input.source.source_type == "github_repo" {
        if let Some(token) = input.source.github_token.as_deref() {
            if !token.trim().is_empty() {
                env.insert("GITHUB_TOKEN".into(), token.trim().into());
            }
        }
    }

    let display_command = format!("uv {}", args.join(" "));
    Ok(SkillMaterialCommandSpec {
        program: "uv".into(),
        args,
        env,
        display_command,
    })
    .map(|mut spec| {
        spec.display_command = redact_skill_material_log(&spec.display_command, &spec.env);
        let _ = runtime_root;
        spec
    })
}

fn redact_skill_material_log(value: &str, env: &HashMap<String, String>) -> String {
    let mut text = value.to_string();
    for secret in env.values() {
        if !secret.is_empty() {
            text = text.replace(secret, "[REDACTED]");
        }
    }
    text
}

fn safe_skill_material_raw_path(path: &Path, root: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(root).map_err(|_| "输出路径不在工作区内".to_string())?;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => {
                let Some(text) = part.to_str() else {
                    return Err("输出路径不是有效 UTF-8".into());
                };
                if text.is_empty() || text.contains('\0') {
                    return Err("输出路径不安全".into());
                }
                parts.push(text.to_string());
            }
            Component::CurDir => {}
            _ => return Err("输出路径不安全".into()),
        }
    }
    if parts.is_empty() {
        return Err("输出路径不安全".into());
    }
    Ok(parts.join("/"))
}

fn collect_skill_material_raw_files(root: &Path, max_files: usize, max_bytes_per_file: u64) -> Result<Vec<SkillMaterialRawFile>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let canonical_root = std::fs::canonicalize(root).map_err(|e| format!("读取编译输出失败: {}", e))?;
    let mut files = Vec::new();
    let mut stack = vec![canonical_root.clone()];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| format!("读取编译输出失败: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取编译输出失败: {}", e))?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|e| format!("读取编译输出失败: {}", e))?;
            if file_type.is_symlink() {
                return Err("编译输出不能包含符号链接".into());
            }
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if files.len() >= max_files {
                return Err("编译输出文件过多".into());
            }
            let metadata = entry.metadata().map_err(|e| format!("读取编译输出失败: {}", e))?;
            if metadata.len() > max_bytes_per_file {
                continue;
            }
            let canonical_path = std::fs::canonicalize(&path).map_err(|e| format!("读取编译输出失败: {}", e))?;
            if !canonical_path.starts_with(&canonical_root) {
                return Err("编译输出路径逃逸".into());
            }
            let content = std::fs::read_to_string(&canonical_path).map_err(|e| format!("读取编译输出失败: {}", e))?;
            files.push(SkillMaterialRawFile {
                path: safe_skill_material_raw_path(&canonical_path, &canonical_root)?,
                content,
                mime_type: None,
            });
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn has_skill_material_entry(files: &[SkillMaterialRawFile]) -> bool {
    files.iter().any(|file| file.path == "SKILL.md")
}

fn latest_skill_seekers_output_dir(runtime_root: &Path, started_at: std::time::SystemTime) -> Option<PathBuf> {
    let output_root = runtime_root.join("output");
    let entries = std::fs::read_dir(output_root).ok()?;
    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else { continue };
        if !file_type.is_dir() {
            continue;
        }
        let path = entry.path();
        if !path.join("SKILL.md").is_file() {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        if modified.duration_since(started_at).is_err() {
            continue;
        }
        candidates.push((modified, path));
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.into_iter().next().map(|(_, path)| path)
}

#[tauri::command]
async fn skill_material_compile(input: SkillMaterialCompileInput) -> Result<SkillMaterialCompileOutput, String> {
    let runtime_root = canonical_root(&input.runtime_root)?;
    let workspace_path = PathBuf::from(input.workspace_path.trim());
    if !workspace_path.is_absolute() || workspace_path.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err("编译工作区路径不安全".into());
    }
    std::fs::create_dir_all(&workspace_path).map_err(|e| format!("创建编译工作区失败: {}", e))?;
    let spec = build_skill_material_command(&input)?;
    let timeout_seconds = input.timeout_seconds.unwrap_or(900).clamp(1, 1800);
    let start = Instant::now();
    let started_at = std::time::SystemTime::now();

    let mut command = Command::new(&spec.program);
    command.args(&spec.args);
    command.current_dir(&runtime_root);
    command.envs(&spec.env);
    command.kill_on_drop(true);

    let output = timeout(Duration::from_secs(timeout_seconds), command.output())
        .await
        .map_err(|_| format!("资料编译执行超时（{} 秒）", timeout_seconds))?
        .map_err(|e| format!("资料编译启动失败: {}", e))?;

    let stdout = redact_skill_material_log(&String::from_utf8_lossy(&output.stdout), &spec.env);
    let stderr = redact_skill_material_log(&String::from_utf8_lossy(&output.stderr), &spec.env);
    let mut raw_files = collect_skill_material_raw_files(&workspace_path, 500, 20 * 1024 * 1024)?;
    if !has_skill_material_entry(&raw_files) {
        if let Some(fallback_dir) = latest_skill_seekers_output_dir(&runtime_root, started_at) {
            raw_files = collect_skill_material_raw_files(&fallback_dir, 500, 20 * 1024 * 1024)?;
        }
    }

    Ok(SkillMaterialCompileOutput {
        command: spec.display_command,
        exit_code: output.status.code(),
        stdout,
        stderr,
        duration_ms: start.elapsed().as_millis(),
        raw_files,
    })
}

/// 检测 Obsidian.app 是否已安装（跨平台）
#[tauri::command]
fn check_obsidian_installed() -> bool {
    #[cfg(target_os = "macos")]
    {
        for path in &["/Applications/Obsidian.app", &format!("{}/Applications/Obsidian.app", std::env::var("HOME").unwrap_or_default())] {
            if std::path::Path::new(path).exists() {
                return true;
            }
        }
        false
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            for exe in &["Obsidian.exe", "obsidian.exe"] {
                if std::path::Path::new(&format!("{}\\Obsidian\\{}", local, exe)).exists() {
                    return true;
                }
            }
        }
        false
    }
    #[cfg(target_os = "linux")]
    {
        for path in &["/usr/bin/obsidian", "/usr/local/bin/obsidian", "/snap/bin/obsidian"] {
            if std::path::Path::new(path).exists() {
                return true;
            }
        }
        false
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    false
}

/// macOS Spotlight 搜索 Obsidian.app（终极回退，不依赖路径假设）
#[tauri::command]
fn mdfind_obsidian() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("mdfind")
            .args(["kMDItemKind == 'Application'", "-name", "Obsidian"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            return stdout.lines().next().unwrap_or("").to_string();
        }
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "jc_skill_material_{}_{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }

    fn compile_input(runtime_root: &Path, source_type: &str, value: &str) -> SkillMaterialCompileInput {
        SkillMaterialCompileInput {
            runtime_root: runtime_root.to_string_lossy().to_string(),
            workspace_path: temp_test_dir("workspace").to_string_lossy().to_string(),
            name: "Repo Skill".into(),
            source: SkillMaterialSourceInput {
                source_type: source_type.into(),
                value: value.into(),
                github_token: None,
            },
            preset: Some("quick".into()),
            max_pages: Some(12),
            timeout_seconds: Some(1),
        }
    }

    #[test]
    fn media_url_validation_accepts_only_http_links() {
        assert!(validate_media_url("https://www.xinpianchang.com/a-demo").is_ok());
        assert!(validate_media_url("http://example.com/video").is_ok());
        assert!(validate_media_url("file:///tmp/video.mp4").is_err());
        assert!(validate_media_url("javascript:alert(1)").is_err());
        assert!(validate_media_url("not a url").is_err());
    }

    #[test]
    fn media_url_validation_normalizes_unicode_urls_before_capture() {
        let normalized = validate_media_url("https://example.com/watch/中文路径?标题=测试").expect("valid unicode url");

        assert!(!normalized.contains("中文路径"));
        assert!(!normalized.contains("测试"));
        assert!(normalized.contains("%E4%B8%AD%E6%96%87%E8%B7%AF%E5%BE%84"));
        assert!(normalized.contains("%E6%B5%8B%E8%AF%95"));
    }

    #[test]
    fn media_url_validation_rewrites_douyin_modal_links_to_video_links() {
        let normalized = validate_media_url("https://www.douyin.com/jingxuan/beauty/search/%E8%8B%8D%E8%80%81%E5%B8%88?aid=204f4248-6c6f-46b4-b48d-b73dee52f33b&modal_id=7602293488697232881&type=general")
            .expect("valid douyin modal url");

        assert_eq!(normalized, "https://www.douyin.com/video/7602293488697232881");
    }

    #[test]
    fn selected_media_path_validation_accepts_real_files_only() {
        let root = temp_test_dir("media_workbench_path");
        let file = root.join("demo.mp4");
        std::fs::write(&file, b"media").expect("write media placeholder");

        assert!(validate_selected_media_path(&file.to_string_lossy()).is_ok());
        assert!(validate_selected_media_path("demo.mp4").is_err());
        assert!(validate_selected_media_path("").is_err());
        assert!(validate_selected_media_path(&format!("{}/../demo.mp4", root.to_string_lossy())).is_err());
        assert!(validate_selected_media_path(&root.to_string_lossy()).is_err());
    }

    #[test]
    fn media_url_download_args_are_structured_and_whitelisted() {
            let input = MediaUrlDownloadInput {
                job_id: "job".into(),
                url: "https://example.com/watch".into(),
                title: Some("Demo".into()),
                kind: "video".into(),
                video_quality: Some("compact".into()),
                audio_format: None,
                subtitle_language: None,
                output_dir: None,
                use_browser_session: None,
                extra_args: None,
            };
        let args = build_media_url_download_args(&input, Path::new("/tmp/jc-media-job"), None).expect("build args");

        assert!(args.contains(&"--no-playlist".to_string()));
        assert!(args.contains(&"-f".to_string()));
        assert!(args.contains(&"bv*[height<=720]+ba/b[height<=720]/b".to_string()));
        assert!(args.contains(&"https://example.com/watch".to_string()));
    }

    #[test]
    fn media_url_download_args_do_not_add_browser_context_by_default() {
        for url in [
            "https://www.douyin.com/video/7642682043537800905",
            "https://www.bilibili.com/video/BV1ah5i6ZEJ3",
        ] {
            let input = MediaUrlDownloadInput {
                job_id: "job".into(),
                url: url.into(),
                title: Some("Demo".into()),
                kind: "video".into(),
                video_quality: Some("compact".into()),
                audio_format: None,
                subtitle_language: None,
                output_dir: None,
                use_browser_session: None,
                extra_args: None,
            };
            let args = build_media_url_download_args(&input, Path::new("/tmp/jc-media-job"), None).expect("build args");

            assert!(!args.contains(&"--cookies-from-browser".to_string()));
            assert!(!args.contains(&"--add-headers".to_string()));
        }
    }

    #[test]
    fn media_url_download_args_add_browser_context_only_when_requested() {
        let input = MediaUrlDownloadInput {
            job_id: "job".into(),
            url: "https://www.bilibili.com/video/BV1ah5i6ZEJ3".into(),
            title: Some("Demo".into()),
            kind: "video".into(),
            video_quality: Some("compact".into()),
            audio_format: None,
            subtitle_language: None,
            output_dir: None,
            use_browser_session: Some(true),
            extra_args: None,
        };
        let args = build_media_url_download_args(&input, Path::new("/tmp/jc-media-job"), None).expect("build args");

        assert!(args.contains(&"--cookies-from-browser".to_string()));
        assert!(args.contains(&"--add-headers".to_string()));
            assert!(args.iter().any(|value| value.starts_with("Referer:")));
            assert!(args.iter().any(|value| value.starts_with("User-Agent:")));
    }

    #[test]
    fn media_capture_browser_context_is_not_limited_to_known_sites() {
        let args = media_capture_site_args("https://example.com/watch/123", true);

        assert!(args.contains(&"--cookies-from-browser".to_string()));
        assert!(args.iter().any(|value| value == "chrome" || value == "safari"));
        assert!(!args.iter().any(|value| value.starts_with("Referer:")));
    }

    #[test]
    fn media_url_download_args_include_bundled_ffmpeg_location_when_available() {
        let input = MediaUrlDownloadInput {
            job_id: "job".into(),
            url: "https://example.com/watch".into(),
            title: Some("Demo".into()),
            kind: "video".into(),
            video_quality: Some("compact".into()),
            audio_format: None,
            subtitle_language: None,
            output_dir: None,
            use_browser_session: None,
            extra_args: None,
        };
        let ffmpeg = Path::new("/Applications/韭菜盒子.app/Contents/MacOS/ffmpeg");

        let args = build_media_url_download_args(&input, Path::new("/tmp/jc-media-job"), Some(ffmpeg))
            .expect("build args");

        assert!(args.contains(&"--ffmpeg-location".to_string()));
        assert!(args.contains(&ffmpeg.to_string_lossy().to_string()));
    }

    #[test]
    fn media_url_download_args_use_native_output_contract() {
        let output_dir = Path::new("/tmp/jc-media-job");
        let input = MediaUrlDownloadInput {
            job_id: "job".into(),
            url: "https://example.com/watch".into(),
            title: Some("Demo".into()),
            kind: "video".into(),
            video_quality: Some("best".into()),
            audio_format: None,
            subtitle_language: None,
            output_dir: None,
            use_browser_session: None,
            extra_args: None,
        };

        let args = build_media_url_download_args(&input, output_dir, None).expect("build args");

        assert!(args.contains(&"--paths".to_string()));
        assert!(args.contains(&output_dir.to_string_lossy().to_string()));
        assert!(args.contains(&"--output".to_string()));
        assert!(args.contains(&"%(title).200B [%(id)s].%(ext)s".to_string()));
        assert!(args.contains(&"--print".to_string()));
        assert!(args.contains(&"after_move:filepath".to_string()));
        assert!(!args.contains(&"-o".to_string()));
    }

    #[test]
    fn media_url_download_args_support_safe_internal_extra_args_only() {
        let mut input = MediaUrlDownloadInput {
            job_id: "job".into(),
            url: "https://example.com/watch".into(),
            title: Some("Demo".into()),
            kind: "video".into(),
            video_quality: Some("best".into()),
            audio_format: None,
            subtitle_language: None,
            output_dir: None,
            use_browser_session: None,
            extra_args: Some(vec!["--impersonate".into(), "chrome".into()]),
        };

        let args = build_media_url_download_args(&input, Path::new("/tmp/jc-media-job"), None)
            .expect("safe extra args");
        assert!(args.contains(&"--impersonate".to_string()));
        assert!(args.contains(&"chrome".to_string()));

        input.extra_args = Some(vec!["--exec".into(), "echo {}".into()]);
        let blocked = build_media_url_download_args(&input, Path::new("/tmp/jc-media-job"), None);
        assert!(blocked.is_err());
    }

    #[test]
    fn media_url_inspect_args_add_browser_context_only_when_requested() {
        let default_input = MediaUrlInspectInput {
            url: "https://www.bilibili.com/video/BV1ah5i6ZEJ3".into(),
            job_id: Some("job".into()),
            use_browser_session: None,
        };
        let browser_input = MediaUrlInspectInput {
            url: "https://www.bilibili.com/video/BV1ah5i6ZEJ3".into(),
            job_id: Some("job".into()),
            use_browser_session: Some(true),
        };

        let default_args = build_media_url_inspect_args(&default_input).expect("build default inspect args");
        let browser_args = build_media_url_inspect_args(&browser_input).expect("build browser inspect args");

        assert!(!default_args.contains(&"--cookies-from-browser".to_string()));
        assert!(browser_args.contains(&"--cookies-from-browser".to_string()));
        assert!(browser_args.contains(&"--add-headers".to_string()));
        assert!(browser_args.iter().any(|value| value.starts_with("Referer:")));
    }

    #[test]
    fn media_url_stream_detection_allows_download_when_codec_fields_are_missing() {
        let formats = vec![
            serde_json::json!({
                "format_id": "progressive",
                "ext": "mp4",
                "url": "https://cdn.example.com/video.mp4"
            }),
            serde_json::json!({
                "format_id": "audio",
                "ext": "m4a",
                "url": "https://cdn.example.com/audio.m4a"
            }),
        ];

        assert!(media_url_has_stream_kind(Some(&formats), "vcodec", &["mp4", "webm", "m3u8", "mpd", "mov", "mkv"]));
        assert!(media_url_has_stream_kind(Some(&formats), "acodec", &["m4a", "mp3", "aac", "opus", "webm", "wav", "flac"]));
        assert!(media_url_has_stream_kind(None, "vcodec", &["mp4"]));
    }

    #[test]
    fn media_url_output_selection_rejects_stdout_path_outside_output_dir() {
        let output_dir = temp_test_dir("media_url_output");
        let outside = temp_test_dir("media_url_outside").join("secret.mp4");
        std::fs::write(&outside, b"secret").expect("write outside file");

        let selected = select_media_url_output(
            &output_dir,
            "Demo",
            SystemTime::now(),
            &outside.to_string_lossy(),
        );

        assert!(selected.is_err());
    }

    #[test]
    fn media_url_output_selection_rejects_stdout_path_with_wrong_base() {
        let output_dir = temp_test_dir("media_url_wrong_base");
        let wrong = output_dir.join("Other.mp4");
        std::fs::write(&wrong, b"video").expect("write wrong output");

        let selected = select_media_url_output(
            &output_dir,
            "Demo",
            SystemTime::now(),
            "",
        );

        assert!(selected.is_err());
    }

    #[test]
    fn media_url_output_selection_accepts_after_move_path_without_name_prefix() {
        let output_dir = temp_test_dir("media_url_after_move");
        let output = output_dir.join("Native yt-dlp Title [abc123].mp4");
        std::fs::write(&output, b"video").expect("write output");

        let selected = select_media_url_output(
            &output_dir,
            "Different UI Title",
            SystemTime::now(),
            &output.to_string_lossy(),
        )
        .expect("select output");

        assert_eq!(selected, std::fs::canonicalize(output).expect("canonical output"));
    }

    #[test]
    fn media_capture_extra_args_reject_dangerous_native_options() {
        for arg in [
            "--exec",
            "--exec=echo {}",
            "--external-downloader",
            "--plugin-dirs",
            "--config-locations",
            "--enable-file-urls",
        ] {
            let result = validate_media_capture_extra_args(&[arg.to_string()]);
            assert!(result.is_err(), "expected {arg} to be rejected");
        }

        let safe = validate_media_capture_extra_args(&[
            "--impersonate".into(),
            "chrome".into(),
            "--retries".into(),
            "20".into(),
        ])
        .expect("safe args");
        assert_eq!(safe, ["--impersonate", "chrome", "--retries", "20"]);
    }

    #[test]
    fn transcript_output_selection_requires_matching_stem_and_recent_mtime() {
        let output_dir = temp_test_dir("media_transcript_output");
        let wrong = output_dir.join("other.txt");
        std::fs::write(&wrong, b"old").expect("write wrong transcript");

        assert!(find_transcript_output(&output_dir, "demo", "txt", SystemTime::now()).is_none());

        let expected = output_dir.join("demo.txt");
        std::fs::write(&expected, b"new").expect("write transcript");

        let selected = find_transcript_output(&output_dir, "demo", "txt", SystemTime::now())
            .expect("find transcript");
        assert_eq!(selected, expected);
    }

    #[test]
    fn media_process_error_sanitizer_hides_internal_tool_details() {
        let raw = "ffmpeg failed opening /Users/by3/private/demo.mp4";
        let sanitized = sanitize_media_process_error(raw, "请检查文件后重试。");

        assert_eq!(sanitized, "请检查文件后重试。");
        assert!(!sanitized.contains("ffmpeg"));
        assert!(!sanitized.contains("/Users/"));
    }

    #[test]
    fn media_capture_errors_explain_browser_state_failures() {
        let douyin = media_capture_error_message("解析失败", "ERROR: [Douyin] Fresh cookies (not necessarily logged in) are needed");
        let bilibili = media_capture_error_message("解析失败", "ERROR: [BiliBili] Unable to download webpage: HTTP Error 412: Precondition Failed");

        assert!(douyin.contains("浏览器访问状态"));
        assert!(bilibili.contains("浏览器访问状态"));
        assert!(!douyin.contains("Fresh cookies"));
        assert!(!bilibili.contains("HTTP Error 412"));
    }

    #[test]
    fn media_capture_debug_candidates_include_documents_source_checkout() {
        let home = temp_test_dir("media_capture_home");
        let source_root = home.join("Documents").join("yt-dlp");
        std::fs::create_dir_all(source_root.join("yt_dlp")).expect("mkdir media source");
        std::fs::write(source_root.join("yt-dlp.sh"), "#!/usr/bin/env sh\n").expect("write wrapper");
        std::fs::write(source_root.join("yt_dlp").join("__main__.py"), "print('test')\n").expect("write module");

        let candidates = media_capture_command_candidates(None, Some(&home));

        #[cfg(debug_assertions)]
        {
            assert!(candidates.iter().any(|candidate| {
                candidate.display_path == source_root.join("yt-dlp.sh")
            }));
            assert!(candidates.iter().any(|candidate| {
                candidate.display_path == source_root
            }));
        }
    }

    #[test]
    fn media_capture_candidates_include_tauri_sidecar_executable_dir() {
        let sidecar_dir = temp_test_dir("media_capture_sidecar");
        std::fs::write(sidecar_dir.join("yt-dlp"), "#!/usr/bin/env sh\n").expect("write sidecar");

        let mut candidates = Vec::new();
        push_media_capture_directory_candidates(&mut candidates, &sidecar_dir);

        assert!(candidates.iter().any(|candidate| {
            candidate.display_path == sidecar_dir.join("yt-dlp")
        }));
    }

    #[test]
    fn skill_material_command_keeps_github_token_out_of_argv() {
        let runtime_root = temp_test_dir("runtime");
        let mut input = compile_input(&runtime_root, "github_repo", "owner/project");
        input.source.github_token = Some("ghp_secret_token".into());

        let spec = build_skill_material_command(&input).expect("build command");

        assert_eq!(spec.program, "uv");
        assert_eq!(spec.env.get("GITHUB_TOKEN").map(String::as_str), Some("ghp_secret_token"));
        assert!(!spec.args.iter().any(|arg| arg.contains("ghp_secret_token")));
        assert!(!spec.display_command.contains("ghp_secret_token"));
        assert_eq!(spec.args, vec![
            "run",
            "skill-seekers",
            "create",
            "owner/project",
            "--name",
            "Repo Skill",
            "--preset",
            "quick",
            "--output",
            input.workspace_path.as_str(),
            "--enhance-level",
            "0",
            "--quiet",
            "--non-interactive",
        ]);
    }

    #[test]
    fn skill_material_command_writes_to_job_workspace() {
        let runtime_root = temp_test_dir("runtime_workspace");
        let input = compile_input(&runtime_root, "local_codebase", "/Users/by3/Documents/project");

        let spec = build_skill_material_command(&input).expect("build command");

        let output_index = spec.args.iter().position(|arg| arg == "--output").expect("output flag");
        assert_eq!(spec.args.get(output_index + 1).map(String::as_str), Some(input.workspace_path.as_str()));
    }

    #[test]
    fn skill_material_source_validation_rejects_unsafe_inputs() {
        let runtime_root = temp_test_dir("runtime_validation");
        assert!(build_skill_material_command(&compile_input(&runtime_root, "documentation_url", "file:///tmp/a")).is_err());
        assert!(build_skill_material_command(&compile_input(&runtime_root, "documentation_url", "http://localhost:3000/docs")).is_err());
        assert!(build_skill_material_command(&compile_input(&runtime_root, "documentation_url", "https://user:pass@example.com/docs")).is_err());
        assert!(build_skill_material_command(&compile_input(&runtime_root, "documentation_url", "http://169.254.169.254/latest/meta-data")).is_err());
        assert!(build_skill_material_command(&compile_input(&runtime_root, "local_codebase", "../project")).is_err());
        assert!(build_skill_material_command(&compile_input(&runtime_root, "github_repo", "https://example.com/repo")).is_err());
        assert!(build_skill_material_command(&compile_input(&runtime_root, "openapi", "https://example.com/openapi.json")).is_err());

        #[cfg(unix)]
        {
            let secret_target = temp_test_dir("source_secret_target");
            let link = runtime_root.join("link_to_secret");
            std::os::unix::fs::symlink(&secret_target, &link).expect("create source symlink");
            assert!(build_skill_material_command(&compile_input(&runtime_root, "local_codebase", &link.to_string_lossy())).is_err());
        }
    }

    #[test]
    fn collect_skill_material_raw_files_rejects_symlinks_and_keeps_relative_paths() {
        let root = temp_test_dir("raw_files");
        std::fs::create_dir_all(root.join("references")).expect("mkdir references");
        std::fs::write(root.join("SKILL.md"), "# Skill").expect("write skill");
        std::fs::write(root.join("references/source.md"), "# Source").expect("write reference");

        let files = collect_skill_material_raw_files(&root, 10, 1024).expect("collect files");
        let paths: Vec<String> = files.into_iter().map(|file| file.path).collect();
        assert_eq!(paths, vec!["SKILL.md", "references/source.md"]);

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("SKILL.md"), root.join("references/link.md")).expect("symlink");
            assert!(collect_skill_material_raw_files(&root, 10, 1024).is_err());
        }
    }

    #[test]
    fn skill_material_latest_skill_seekers_output_dir_finds_output_with_skill_md() {
        let runtime_root = temp_test_dir("runtime_output");
        let old_dir = runtime_root.join("output/old");
        let new_dir = runtime_root.join("output/new");
        std::fs::create_dir_all(&old_dir).expect("mkdir old");
        std::fs::create_dir_all(&new_dir).expect("mkdir new");
        std::fs::write(old_dir.join("SKILL.md"), "# Old").expect("write old");
        std::thread::sleep(std::time::Duration::from_millis(2));
        std::fs::write(new_dir.join("SKILL.md"), "# New").expect("write new");

        let found = latest_skill_seekers_output_dir(&runtime_root, std::time::SystemTime::UNIX_EPOCH).expect("find latest output");
        assert_eq!(found.file_name().and_then(|name| name.to_str()), Some("new"));

        let files = collect_skill_material_raw_files(&found, 10, 1024).expect("collect latest");
        assert_eq!(files[0].path, "SKILL.md");
        assert_eq!(files[0].content, "# New");
    }

    #[test]
    fn skill_material_latest_skill_seekers_output_dir_ignores_stale_outputs() {
        let runtime_root = temp_test_dir("runtime_stale_output");
        let output = runtime_root.join("output/old-output");
        std::fs::create_dir_all(&output).expect("mkdir output");
        std::fs::write(output.join("SKILL.md"), "# Old Skill").expect("write skill");

        let future_start = std::time::SystemTime::now() + Duration::from_secs(60);
        assert!(latest_skill_seekers_output_dir(&runtime_root, future_start).is_none());
    }

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
    fn utf8_stream_decoder_preserves_multibyte_characters_split_across_chunks() {
        let sample = "开头 中文 emoji 😄 结尾";
        let bytes = sample.as_bytes();
        let split_at = bytes
            .windows(3)
            .position(|window| window == "中".as_bytes())
            .expect("sample contains chinese character")
            + 1;

        let mut decoder = Utf8StreamDecoder::default();
        let mut output = String::new();
        output.push_str(&decoder.push(&bytes[..split_at]));
        output.push_str(&decoder.push(&bytes[split_at..]));
        output.push_str(&decoder.finish());

        assert_eq!(output, sample);
        assert!(!output.contains('\u{fffd}'));
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

    #[test]
    fn opencode_binary_resolution_prefers_explicit_jc_path() {
        let root = temp_test_dir("opencode_explicit");
        let explicit = root.join("custom-opencode");
        std::fs::write(&explicit, b"#!/bin/sh\n").expect("write fake opencode");

        let resolved = resolve_opencode_binary_from_inputs(
            &[],
            None,
            Some(explicit.as_os_str()),
            None,
            None,
        )
        .expect("resolve explicit opencode");

        assert_eq!(resolved, explicit);
    }

    #[test]
    fn opencode_binary_resolution_uses_path_before_dev_checkout() {
        let home = temp_test_dir("opencode_home");
        let path_dir = temp_test_dir("opencode_path");
        let path_binary = path_dir.join("opencode");
        std::fs::write(&path_binary, b"#!/bin/sh\n").expect("write path opencode");

        let dev_binary = home
            .join("Documents/1OKAPP/my-opencode/packages/opencode/dist")
            .join(opencode_platform_package_dir().expect("platform package"))
            .join("bin/opencode");
        std::fs::create_dir_all(dev_binary.parent().expect("dev parent")).expect("mkdir dev parent");
        std::fs::write(&dev_binary, b"#!/bin/sh\n").expect("write dev opencode");

        let resolved = resolve_opencode_binary_from_inputs(
            &[],
            Some(home.as_path()),
            None,
            None,
            Some(path_dir.as_os_str()),
        )
        .expect("resolve path opencode");

        assert_eq!(resolved, path_binary);
    }

    #[test]
    fn opencode_binary_resolution_can_use_local_dev_checkout() {
        let home = temp_test_dir("opencode_dev_home");
        let dev_binary = home
            .join("Documents/1OKAPP/my-opencode/packages/opencode/dist")
            .join(opencode_platform_package_dir().expect("platform package"))
            .join("bin/opencode");
        std::fs::create_dir_all(dev_binary.parent().expect("dev parent")).expect("mkdir dev parent");
        std::fs::write(&dev_binary, b"#!/bin/sh\n").expect("write dev opencode");

        let resolved = resolve_opencode_binary_from_inputs(
            &[],
            Some(home.as_path()),
            None,
            None,
            None,
        )
        .expect("resolve dev checkout opencode");

        assert_eq!(resolved, dev_binary);
    }

    #[test]
    fn opencode_binary_resolution_uses_bundled_resource_before_path() {
        let resource_dir = temp_test_dir("opencode_resource");
        let path_dir = temp_test_dir("opencode_path_with_resource");
        let bundled = resource_dir.join("binaries").join(opencode_resource_names()[0].clone());
        let path_binary = path_dir.join("opencode");
        std::fs::create_dir_all(bundled.parent().expect("bundled parent")).expect("mkdir bundled parent");
        std::fs::write(&bundled, b"#!/bin/sh\n").expect("write bundled opencode");
        std::fs::write(&path_binary, b"#!/bin/sh\n").expect("write path opencode");

        let resolved = resolve_opencode_binary_from_inputs(
            &[resource_dir.join("binaries")],
            None,
            None,
            None,
            Some(path_dir.as_os_str()),
        )
        .expect("resolve bundled opencode");

        assert_eq!(resolved, bundled);
    }

    #[test]
    fn opencode_binary_resolution_reports_missing_runtime() {
        let err = resolve_opencode_binary_from_inputs(&[], None, None, None, None)
            .expect_err("missing opencode should be explicit");

        assert!(err.contains("OpenCode runtime 未安装"));
        assert!(err.contains("JC_OPENCODE_BIN"));
    }

    #[test]
    fn opencode_runtime_dirs_are_created_under_runtime_root() {
        let root = temp_test_dir("opencode_runtime_dirs");

        let (data, state, config, workspace) = prepare_opencode_runtime_dirs(&root)
            .expect("prepare runtime dirs");

        assert_eq!(data, root.join("data"));
        assert_eq!(state, root.join("state"));
        assert_eq!(config, root.join("config"));
        assert_eq!(workspace, root.join("workspace/default"));
        assert!(data.is_dir());
        assert!(state.is_dir());
        assert!(config.is_dir());
        assert!(workspace.is_dir());
    }

    #[test]
    fn manual_key_unified_api_requests_direct_to_newapi_source() {
        let mut headers = HashMap::new();
        headers.insert("Authorization".into(), "Bearer sk-manual-key".into());
        let request = HttpRequest {
            url: "https://api.jiucaihezi.studio/v1/chat/completions".into(),
            method: Some("POST".into()),
            headers: Some(headers),
            body: None,
            timeout_secs: None,
        };

        assert!(should_direct_unified_api_to_newapi(&request));
    }

    #[test]
    fn gateway_session_unified_api_requests_stay_on_cloudflare_worker() {
        let mut headers = HashMap::new();
        headers.insert("Authorization".into(), "Bearer sess_123".into());
        headers.insert("X-JC-Session".into(), "sess_123".into());
        let request = HttpRequest {
            url: "https://api.jiucaihezi.studio/v1/chat/completions".into(),
            method: Some("POST".into()),
            headers: Some(headers),
            body: None,
            timeout_secs: None,
        };

        assert!(!should_direct_unified_api_to_newapi(&request));
    }

    #[test]
    fn auth_login_always_stays_on_cloudflare_worker() {
        let mut headers = HashMap::new();
        headers.insert("Content-Type".into(), "application/json".into());
        let request = HttpRequest {
            url: "https://api.jiucaihezi.studio/auth/login".into(),
            method: Some("POST".into()),
            headers: Some(headers),
            body: None,
            timeout_secs: None,
        };

        assert!(!should_direct_unified_api_to_newapi(&request));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ─── Windows WebView2 检测 ───
    // Tauri v2 在 Windows 上依赖系统 WebView2 Runtime（不像 Electron 自带 Chromium）。
    // 若未安装，Tauri 自身会弹错误对话框引导安装；此处为补充日志。
    #[cfg(target_os = "windows")]
    {
        let pf = std::env::var("ProgramFiles").unwrap_or_default();
        let pfx86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();
        let mut found = false;
        let mut checked_paths: Vec<String> = Vec::new();
        for base in [&pf, &pfx86] {
            let candidate = std::path::PathBuf::from(base)
                .join("Microsoft/EdgeWebView/Application/msedgewebview2.exe");
            checked_paths.push(candidate.display().to_string());
            if candidate.exists() {
                found = true;
                break;
            }
        }
        if found {
            eprintln!("[JC] ✅ WebView2 Runtime 已安装");
        } else {
            eprintln!("[JC] ❌ WebView2 Runtime 未安装！（已检查: {}）", checked_paths.join(", "));
            eprintln!("[JC] 请从以下地址下载安装：");
            eprintln!("[JC] https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            eprintln!("[JC] 安装后重新运行韭菜盒子即可。");
        }
    }

    tauri::Builder::default()
        .manage(ConversionJobs::default())
        .manage(MediaCaptureJobs::default())
        .manage(BrowserRuntime::default())
        .manage(LocalMlxRuntime::default())
        .manage(OpenCodeRuntime::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            let skills_db_dir = skills::path_utils::app_data_dir();
            std::fs::create_dir_all(&skills_db_dir)
                .expect("Failed to create ~/.skillsmanage directory");
            let skills_db_path =
                skills::path_utils::path_to_string(&skills_db_dir.join("db.sqlite"));

            // 创建目录（同步），确保路径存在
            // skills DB 连接池和表迁移移到后台——不阻塞窗口创建
            let app_handle = app.handle().clone();
            let db_path = skills_db_path.clone();
            tauri::async_runtime::spawn(async move {
                match skills::db::create_pool(&db_path).await {
                    Ok(pool) => {
                        if let Err(e) = skills::db::init_database(&pool).await {
                            eprintln!("[JC] skills DB init failed: {e}");
                        }
                        app_handle.manage(skills::SkillsAppState { db: pool });
                    }
                    Err(e) => {
                        eprintln!("[JC] skills DB pool failed: {e}");
                    }
                }
            });

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
    let target = new URL('tauri://localhost/');
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
    addFloatBtn();
    setTimeout(addFloatBtn, 800);
    setTimeout(addFloatBtn, 2500);
    setTimeout(addFloatBtn, 6000);
    new MutationObserver(function() {
      addFloatBtn();
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
            write_clipboard_text,
            check_whisper_available,
            http_request,
            http_download_base64,
            http_request_stream,
            secure_store::get_api_key,
            secure_store::set_api_key,
            secure_store::clear_api_key,
            secure_store::get_gateway_session_token,
            secure_store::set_gateway_session_token,
            secure_store::clear_gateway_session_token,
            media_url_inspect,
            media_url_download,
            cancel_media_url_download,
            media_open_file,
            media_reveal_file,
            open_in_shell,
            local_mlx_status,
            local_mlx_prepare_model,
            local_mlx_scan_models,
            local_mlx_ensure_server,
            local_mlx_stop_server,
            local_mlx_remove_model,
            local_mlx_open_model_dir,
            opencode_status,
            opencode_mcp_status,
            opencode_ensure_server,
            opencode_stop,
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
            dev_rename_file,
            dev_delete_file,
            dev_create_dir,
            dev_reveal_in_finder,
            scaffold_vault,
            dev_replace_in_file,
            dev_get_diff,
            dev_run_command,
            skill_material_compile,
            media_cache_file,
            document_to_markdown_file,
            document_path_to_markdown_file,
            cancel_markdown_conversion,
            media_select_file,
            media_inspect_file,
            media_process_file,
            media_transcribe_file,
            media_burn_subtitles,
            mcp_spawn_stdio,
            mcp_write_stdin,
            mcp_kill_stdio,
            skills::scanner::scan_all_skills,
            skills::agents::get_agents,
            skills::agents::detect_agents,
            skills::agents::add_custom_agent,
            skills::agents::update_custom_agent,
            skills::agents::remove_custom_agent,
            skills::linker::install_skill_to_agent,
            skills::linker::uninstall_skill_from_agent,
            skills::linker::batch_install_to_agents,
            skills::skills::get_skills_by_agent,
            skills::skills::get_central_skills,
            skills::skills::save_central_skill,
            skills::skills::get_central_skill_bundles,
            skills::skills::get_central_skill_bundle_detail,
            skills::skills::preview_delete_central_skill_bundle,
            skills::skills::delete_central_skill_bundle,
            skills::skills::delete_central_skill,
            skills::skills::get_skill_detail,
            skills::skills::read_skill_content,
            skills::skills::read_file_by_path,
            skills::skills::list_skill_directory,
            skills::skills::open_in_file_manager,
            skills::collections::create_collection,
            skills::collections::get_collections,
            skills::collections::get_collection_detail,
            skills::collections::add_skill_to_collection,
            skills::collections::remove_skill_from_collection,
            skills::collections::delete_collection,
            skills::collections::update_collection,
            skills::collections::batch_install_collection,
            skills::collections::export_collection,
            skills::collections::import_collection,
            skills::settings::get_scan_directories,
            skills::settings::add_scan_directory,
            skills::settings::remove_scan_directory,
            skills::settings::set_scan_directory_active,
            skills::settings::get_setting,
            skills::settings::set_setting,
            skills::settings::get_skills_database_path,
            skills::discover::discover_scan_roots,
            skills::discover::get_scan_roots,
            skills::discover::get_obsidian_vaults,
            skills::discover::get_obsidian_vault_skills,
            skills::discover::set_scan_root_enabled,
            skills::discover::start_project_scan,
            skills::discover::stop_project_scan,
            skills::discover::get_discovered_skills,
            skills::discover::import_discovered_skill_to_central,
            skills::discover::import_discovered_skill_to_platform,
            skills::discover::clear_discovered_skills,
            skills::github_import::preview_github_repo_import,
            skills::github_import::import_github_repo_skills,
            skills::github_import::fetch_github_skill_markdown,
            skills::marketplace::list_registries,
            skills::marketplace::add_registry,
            skills::marketplace::remove_registry,
            skills::marketplace::sync_registry,
            skills::marketplace::sync_registry_with_options,
            skills::marketplace::search_marketplace_skills,
            skills::marketplace::install_marketplace_skill,
            skills::marketplace::explain_skill,
            skills::marketplace::get_skill_explanation,
            skills::marketplace::explain_skill_stream,
            skills::marketplace::refresh_skill_explanation,
            check_obsidian_installed,
            check_tool_installed,
            mdfind_obsidian,
            scaffold_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
