use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::env;
use std::ffi::OsStr;
#[allow(unused_imports)]
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

mod commands;
mod secure_store;
mod skills;


// ─── Plugin 系统命令 ───

#[tauri::command]
async fn plugin_install_npm(package_name: String, install_dir: String) -> Result<String, String> {
    let dir = std::path::PathBuf::from(&install_dir);
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建插件目录: {e}"))?;
    }

    // ponytail: npm install 可能耗时数秒到数分钟，用 spawn_blocking 避免阻塞 Tauri async runtime
    let result = tokio::task::spawn_blocking(move || {
        let output = std::process::Command::new("npm")
            .args(["install", &package_name, "--prefix", &install_dir, "--no-save", "--silent"])
            .output()
            .map_err(|e| format!("npm install 失败: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("npm install 失败: {}", stderr.trim()));
        }

        Ok(install_dir)
    })
    .await
    .map_err(|e| format!("安装任务异常: {e}"))??;

    Ok(result)
}

#[tauri::command]
async fn plugin_read_manifest(install_dir: String) -> Result<String, String> {
    let install_path = std::path::PathBuf::from(&install_dir);
    let nm_dir = install_path.join("node_modules");
    if !nm_dir.exists() {
        return Err("node_modules 目录不存在".into());
    }

    // 扫描 node_modules 找第一个子目录的 package.json
    for entry in std::fs::read_dir(&nm_dir).map_err(|e| format!("读取失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {e}"))?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
        if entry.file_name().to_string_lossy().starts_with('.') { continue; }
        if entry.file_name() == "node_modules" { continue; }

        let pkg = entry.path().join("package.json");
        if pkg.exists() {
            return std::fs::read_to_string(&pkg)
                .map_err(|e| format!("读取 package.json 失败: {e}"));
        }
    }

    Err("未找到 package.json".into())
}

#[tauri::command]
async fn plugin_read_config() -> Result<String, String> {
    let home = dirs_next::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let config_path = home.join(".jiucaihezi").join("plugins.json");
    if !config_path.exists() {
        return Ok(r#"{"version":1,"plugins":[]}"#.to_string());
    }
    std::fs::read_to_string(&config_path).map_err(|e| format!("读取失败: {e}"))
}

#[tauri::command]
async fn plugin_write_config(content: String) -> Result<(), String> {
    let home = dirs_next::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let jc_dir = home.join(".jiucaihezi");
    std::fs::create_dir_all(&jc_dir).map_err(|e| format!("创建目录失败: {e}"))?;
    std::fs::write(jc_dir.join("plugins.json"), &content).map_err(|e| format!("写入失败: {e}"))
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
        "gallery-dl" => Some("gallery-dl"),
        "muapi" => Some("muapi"),
        "hyperframes" => Some("hyperframes"),
        _ => None,
    };

    if let Some(bin) = binary {
        if let Some(found) = resolve_local_binary_option(bin) {
            return Ok(Some(found.to_string_lossy().to_string()));
        }
    }

    // 3. npm/npx 工具检测 — 跑 --version 验证（如 hyperframes 是 npm 包，不在 PATH）
    let npx_check: Option<(&str, &[&str])> = match tool_id.as_str() {
        "hyperframes" => Some(("npx", &["hyperframes", "--version"] as &[&str])),
        _ => None,
    };
    if let Some((runner, args)) = npx_check {
        let (tx, rx) = std::sync::mpsc::channel();
        let args = args.to_vec();
        std::thread::spawn(move || {
            let ok = std::process::Command::new(runner)
                .args(&args)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            let _ = tx.send(ok);
        });
        if rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap_or(false) {
            return Ok(Some(format!("npx {} (npm)", tool_id)));
        }
    }

    Ok(None)
}

/// 检查 OpenCode 插件是否已在 opencode.json 的 plugin 数组中配置。
/// 返回配置路径字符串（如 "opencode.json → plugin: [..., \"supermemory\"]"）或 None。
#[tauri::command]
fn check_opencode_plugin(tool_id: String, project_dir: String) -> Result<Option<String>, String> {
    let config_path = std::path::PathBuf::from(&project_dir).join("opencode.json");
    let raw = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(_) => return Ok(None), // 文件不存在，未安装
    };
    let config: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("opencode.json 格式错误: {}", e))?;
    let plugin_name = tool_id.strip_prefix("opencode-").unwrap_or(&tool_id);
    let plugins = config.get("plugin").and_then(|v| v.as_array());
    if let Some(list) = plugins {
        for entry in list {
            let name = match entry {
                serde_json::Value::String(s) => s.as_str(),
                obj if obj.is_object() => obj.get("package").and_then(|v| v.as_str()).unwrap_or(""),
                _ => "",
            };
            if name.contains(plugin_name) {
                return Ok(Some(format!(
                    "opencode.json → plugin: [..., \"{}\"]",
                    plugin_name
                )));
            }
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

fn resolve_app_media_binary(_app: &tauri::AppHandle, program: &str) -> Result<PathBuf, String> {
    // ponytail: 只从 PATH / ~/.jiucaihezi/tools/ 查找，不再内置媒体二进制。
    let local = resolve_local_binary(program);
    if local.exists() {
        ensure_binary_executable(&local);
        return Ok(local);
    }
    let hint = match program {
        "ffmpeg" => "请通过工具仓库安装 ffmpeg：brew install ffmpeg",
        "ffprobe" => "请通过工具仓库安装 ffprobe（随 ffmpeg 一起安装）：brew install ffmpeg",
        "whisper-cli" | "whisper" => "请通过工具仓库安装 whisper",
        "yt-dlp" | "yt_dlp" => "请通过工具仓库安装 yt-dlp：brew install yt-dlp",
        _ => "请通过工具仓库安装此工具",
    };
    Err(format!("未找到 {}。{}", program, hint))
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
                    // ponytail: OpenCode 二进制是单目录模式（--current-dir 决定
                    // 工作目录），session.directory 参数不 override 它。
                    // 切项目目录时需 kill 重启进程，确保新 session 文件系统范围正确。
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

    // ponytail: Windows 上 OpenCode 是控制台程序，不加 CREATE_NO_WINDOW 会弹黑框。
    // 天花板：仅防控制台窗口，若 OpenCode 自身弹 GUI 窗口则无效（OpenCode 不会）。
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

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
    #[serde(default)]
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DevWriteFileBytesInput {
    root: String,
    relative_path: String,
    data_base64: String,
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
struct MediaCaptureJobs {
    cancelled: Mutex<HashSet<String>>,
    pids: Mutex<HashMap<String, u32>>,
    allowed_outputs: Mutex<HashSet<PathBuf>>,
    allowed_inputs: Mutex<HashSet<PathBuf>>,
}

impl MediaCaptureJobs {
    async fn is_allowed_input(&self, path: &Path) -> bool {
        let Ok(canonical) = std::fs::canonicalize(path) else { return false; };
        self.allowed_inputs.lock().await.contains(&canonical)
    }
    async fn allow_input(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = std::fs::canonicalize(path).map_err(|_| "文件不可访问，请重新选择。")?;
        if !canonical.is_file() { return Err("请选择有效的音频或视频文件。".into()); }
        self.allowed_inputs.lock().await.insert(canonical.clone());
        Ok(canonical)
    }
    async fn allow_output(&self, path: &Path) -> Result<(), String> {
        let canonical = std::fs::canonicalize(path).map_err(|e| format!("输出文件不可访问: {e}"))?;
        self.allowed_outputs.lock().await.insert(canonical);
        Ok(())
    }
}

fn sanitize_media_process_error(detail: &str, fallback: &str) -> String {
    let v = detail.trim();
    if v.is_empty() { return fallback.into(); }
    v.lines().next().unwrap_or(fallback).chars().take(200).collect()
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

fn jiucaihezi_home_dir() -> Result<PathBuf, String> {
    let home = user_home_dir().ok_or_else(|| "无法读取用户目录".to_string())?;
    Ok(home.join(".jiucaihezi"))
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
    let path = std::path::PathBuf::from(root);
    // Windows: Tauri dialog 返回的路径可能因路径格式问题导致 canonicalize 失败，
    // 先尝试确保目录存在再 canonicalize
    if !path.exists() {
        std::fs::create_dir_all(&path)
            .map_err(|e| format!("项目目录不可访问: {}", e))?;
    }
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("项目目录不可访问: {}", e))?;
    if !canonical.is_dir() {
        return Err("项目根路径必须是文件夹".into());
    }
    Ok(canonical)
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

#[tauri::command]
fn dev_write_file_bytes(input: DevWriteFileBytesInput) -> Result<DevWriteFileOutput, String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_write_path(&root, &input.relative_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let bytes = general_purpose::STANDARD
        .decode(&input.data_base64)
        .map_err(|e| format!("base64 解码失败: {}", e))?;
    std::fs::write(&path, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(DevWriteFileOutput {
        path: display_relative(&root, &path),
        bytes_written: bytes.len(),
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

            // 解析内置 Skill 源目录（同步，不阻塞窗口创建）
            // dev: 从 target/debug/ 上 3 层到项目根 → public/skills/
            // prod: resource_dir()/skills/
            let resource_dir = app.path().resource_dir().ok();
            let preset_skills_src = resource_dir.as_ref().and_then(|rd| {
                let prod_path = rd.join("skills");
                if prod_path.exists() { return Some(prod_path); }
                let dev_path = rd.join("../../..").join("public").join("skills");
                if dev_path.exists() { return Some(dev_path); }
                eprintln!("[JC] seed: neither prod ({}) nor dev ({}) exists", prod_path.display(), dev_path.display());
                None
            });

            // 创建目录（同步），确保路径存在
            // skills DB 连接池和表迁移移到后台——不阻塞窗口创建
            let app_handle = app.handle().clone();
            let db_path = skills_db_path.clone();
            let skills_src = preset_skills_src.clone();
            tauri::async_runtime::spawn(async move {
                match skills::db::create_pool(&db_path).await {
                    Ok(pool) => {
                        if let Err(e) = skills::db::init_database(&pool).await {
                            eprintln!("[JC] skills DB init failed: {e}");
                        }
                        // 播种内置预设 Skill 到 ~/.agents/skills/
                        if let Some(ref src) = skills_src {
                            if let Err(e) = skills::db::seed_preset_skills(&pool, src).await {
                                eprintln!("[JC] seed preset skills failed: {e}");
                            }
                        }
                        app_handle.manage(skills::SkillsAppState {
                            db: pool,
                            preset_skills_src: skills_src,
                        });
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
            commands::http::http_request,
            commands::http::http_download_base64,
            commands::http::http_request_stream,
            secure_store::get_api_key,
            secure_store::set_api_key,
            secure_store::clear_api_key,
            secure_store::get_gateway_session_token,
            secure_store::set_gateway_session_token,
            secure_store::clear_gateway_session_token,
            opencode_mcp_status,
            opencode_ensure_server,
            opencode_stop,
            save_generated_file,
            dev_detect_project,
            dev_list_files,
            dev_search_text,
            dev_read_file,
            dev_read_many_files,
            dev_write_file,
            dev_write_file_bytes,
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
            plugin_install_npm,
            plugin_read_manifest,
            plugin_read_config,
            plugin_write_config,
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
            check_opencode_plugin,
            mdfind_obsidian,
            scaffold_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
