use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};
use crate::commands::tools::resolve_opencode_binary;

#[tauri::command]
pub async fn open_in_shell(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    // 若路径不存在，尝试创建目录（用户首次点击「我的文件」时）
    if !p.exists() {
        std::fs::create_dir_all(&p)
            .map_err(|e| format!("创建目录失败: {}", e))?;
    }
    open_path_with_system(&p, false)
}

pub(crate) fn open_path_with_system(path: &Path, reveal: bool) -> Result<(), String> {
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


pub(crate) struct OpenCodeSession {
    pub(crate) child: tokio::process::Child,
    url: String,
    password: String,
    directory: String,
    config_signature: String,
}

#[derive(Default)]
pub(crate) struct OpenCodeRuntime {
    pub(crate) session: Mutex<Option<OpenCodeSession>>,
    pub(crate) operation: Mutex<()>,
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
pub struct OpenCodeEnsureInput {
    config: serde_json::Value,
    port: Option<u16>,
    hostname: Option<String>,
    timeout_ms: Option<u64>,
    directory: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeServerStatus {
    running: bool,
    url: Option<String>,
    authorization: Option<String>,
    pid: Option<u32>,
    directory: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeMcpServerStatus {
    name: String,
    status: String,
    detail: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeMcpStatus {
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
pub(crate) fn user_home_dir() -> Option<PathBuf> {
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

pub(crate) fn prepare_opencode_runtime_dirs(root: &Path) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf), String> {
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

pub fn opencode_status_from_session(session: &OpenCodeSession) -> OpenCodeServerStatus {
    OpenCodeServerStatus {
        running: true,
        url: Some(session.url.clone()),
        authorization: Some(basic_auth_header("opencode", &session.password)),
        pid: session.child.id(),
        directory: Some(session.directory.clone()),
    }
}

async fn stop_opencode_session(mut current: OpenCodeSession) {
    let _ = current.child.start_kill();
    if timeout(Duration::from_millis(6_000), current.child.wait())
        .await
        .is_err()
    {
        let _ = current.child.kill().await;
    }
}

pub(crate) async fn stop_opencode_runtime(runtime: &OpenCodeRuntime) {
    let _guard = runtime.operation.lock().await;
    let current = runtime.session.lock().await.take();
    if let Some(current) = current {
        stop_opencode_session(current).await;
    }
}

#[tauri::command]
pub async fn opencode_status(runtime: State<'_, OpenCodeRuntime>) -> Result<OpenCodeServerStatus, String> {
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
pub async fn opencode_stop(runtime: State<'_, OpenCodeRuntime>) -> Result<(), String> {
    stop_opencode_runtime(&runtime).await;
    Ok(())
}

// ponytail: 照抄 OpenCode desktop/main/ipc.ts "relaunch" handler
#[tauri::command]
pub async fn opencode_relaunch(app: tauri::AppHandle, runtime: State<'_, OpenCodeRuntime>) -> Result<(), String> {
    stop_opencode_runtime(&runtime).await;
    // Step 2: 重启应用（此调用不会返回）
    #[allow(unreachable_code)]
    {
        app.restart();
        Ok(())
    }
}

// ponytail: 照抄 OpenCode desktop/main/ipc.ts "export-debug-logs" handler
#[tauri::command]
pub async fn opencode_export_debug_logs(app: tauri::AppHandle) -> Result<String, String> {
    use std::fs;
    let log_dir = app.path().app_log_dir().map_err(|e| format!("无法获取日志目录: {e}"))?;
    let mut logs = String::new();
    if let Ok(entries) = fs::read_dir(&log_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "log") {
                if let Ok(content) = fs::read_to_string(&path) {
                    logs.push_str(&format!("=== {} ===\n{}\n", path.display(), content));
                }
            }
        }
    }
    Ok(logs)
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
pub async fn opencode_mcp_status(app: tauri::AppHandle) -> Result<OpenCodeMcpStatus, String> {
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

// ponytail: 照抄 OpenCode desktop/main/shell-env.ts — 加载 Shell 环境变量
// macOS GUI 应用不会自动继承终端 PATH（nvm/pyenv/rbenv 等工具依赖）
fn load_shell_env() -> std::collections::HashMap<String, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let shell_name = shell.rsplit('/').next().unwrap_or(&shell).to_lowercase();
    if shell_name == "nu" || shell_name == "nu.exe" || shell.ends_with("\\nu.exe") {
        return std::collections::HashMap::new();
    }
    let output = StdCommand::new(&shell)
        .args(["-il", "-c", "env -0"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();
    match output {
        Ok(out) if out.status.success() => {
            let mut env = std::collections::HashMap::new();
            for line in out.stdout.split(|&b| b == 0) {
                if line.is_empty() { continue; }
                if let Ok(s) = std::str::from_utf8(line) {
                    if let Some(ix) = s.find('=') {
                        env.insert(s[..ix].to_string(), s[ix+1..].to_string());
                    }
                }
            }
            env
        }
        _ => std::collections::HashMap::new(),
    }
}

#[tauri::command]
pub async fn opencode_ensure_server(
    app: tauri::AppHandle,
    runtime: State<'_, OpenCodeRuntime>,
    input: OpenCodeEnsureInput,
) -> Result<OpenCodeServerStatus, String> {
    // ponytail: load_shell_env() 是阻塞调用（spawn shell 子进程），必须在锁外面执行
    let shell_env = load_shell_env();
    let _guard = runtime.operation.lock().await;
    let requested_dir = input.directory.as_deref().unwrap_or("").to_string();
    let requested_config_signature = input.config.to_string();
    let replaced_session = {
        let mut session = runtime.session.lock().await;
        let should_replace = if let Some(current) = session.as_mut() {
            match current.child.try_wait() {
                Ok(Some(_)) => true,
                Ok(None) => {
                    // ponytail: OpenCode 二进制是单目录模式（--current-dir 决定
                    // 工作目录），session.directory 参数不 override 它。
                    // 切项目目录时需 kill 重启进程，确保新 session 文件系统范围正确。
                    if (!requested_dir.is_empty() && current.directory != requested_dir)
                        || current.config_signature != requested_config_signature
                    {
                        true
                    } else {
                        return Ok(opencode_status_from_session(current));
                    }
                }
                Err(_) => true,
            }
        } else {
            false
        };
        if should_replace {
            session.take()
        } else {
            None
        }
    };
    // ponytail: wait before opening the same SQLite DB in a replacement process.
    if let Some(current) = replaced_session {
        stop_opencode_session(current).await;
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
    // ponytail: 照抄 OpenCode desktop/main/server.ts SIDECAR_START_STALL_TIMEOUT = 60_000
    // Intel Mac 冷启动可能需要 30-50s，8s 太短会导致启动超时报错。
    let timeout_ms = input.timeout_ms.unwrap_or(60_000).clamp(1_000, 120_000);
    let password = random_opencode_password();
    let program = resolve_opencode_binary(Some(&app))?;
    let runtime_root = opencode_runtime_root()?;
    let (data_dir, state_dir, config_dir, workspace_dir) = prepare_opencode_runtime_dirs(&runtime_root)?;
    let fallback_dir = user_home_dir().unwrap_or(workspace_dir.clone());
    let effective_dir = if !requested_dir.is_empty() {
        let p = PathBuf::from(&requested_dir);
        if !p.is_dir() {
            return Err(format!("所选项目目录不存在或不是文件夹：{}", p.display()));
        }
        p
    } else {
        fallback_dir
    };
    let database_path = data_dir.join("jiucaihezi-opencode.db");
    let mut command = Command::new(program);
    command
        .arg("serve")
        .arg(format!("--hostname={hostname}"))
        .arg(format!("--port={port}"))
        .current_dir(&effective_dir)
        .envs(shell_env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .env("OPENCODE_CONFIG_CONTENT", &requested_config_signature)
        .env("OPENCODE_AUTH_CONTENT", "{}")
        .env("OPENCODE_DB", database_path)
        .env("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY", "true")
        .env("OPENCODE_EXPERIMENTAL_FILEWATCHER", "true")
        .env("OPENCODE_CLIENT", "desktop")
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
                        Ok(None) => {
                            // ponytail: stdout 关闭时先检查子进程是否已退出，
                            // Windows 上常见二进制崩溃/stdout 提前关闭但 stderr 有线索。
                            // 优先报告退出码，其次报告收集到的 stderr 输出。
                            match child.try_wait() {
                                Ok(Some(status)) => {
                                    let code = status.code();
                                    return Err(format!(
                                        "OpenCode server 启动失败（退出码 {:?}）。\n{}",
                                        code,
                                        output.trim()
                                    ));
                                }
                                _ => {
                                    return Err(format!(
                                        "OpenCode server 启动时 stdout 已关闭（进程未退出）。\n{}",
                                        output.trim()
                                    ));
                                }
                            }
                        }
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
