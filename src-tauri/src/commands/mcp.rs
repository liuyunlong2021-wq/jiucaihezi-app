use crate::commands::tools::resolve_local_binary;
use std::collections::HashMap;
use std::sync::LazyLock;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

struct McpStdioProcess {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
}

#[cfg(unix)]
fn exit_signal(status: &std::process::ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt;
    status.signal().map(|signal| signal.to_string())
}

#[cfg(not(unix))]
fn exit_signal(_status: &std::process::ExitStatus) -> Option<String> { None }

static MCP_PROCESSES: LazyLock<Mutex<HashMap<String, McpStdioProcess>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub async fn mcp_spawn_stdio(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    on_stdout: Channel<String>,
    on_stderr: Channel<String>,
    on_exit: Channel<String>,
) -> Result<String, String> {
    let mut resolved_command = resolve_local_binary(&command);
    let mut resolved_args = args;
    if command.replace('\\', "/").ends_with("/tsx/dist/cli.mjs") {
        for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
            if std::path::Path::new(candidate).exists() {
                resolved_command = std::path::PathBuf::from(candidate);
                resolved_args.insert(0, command.clone());
                break;
            }
        }
    }
    #[cfg(windows)]
    let mut cmd = if resolved_command
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("cmd"))
    {
        let mut command = Command::new("cmd.exe");
        command.arg("/C").arg(&resolved_command);
        command
    } else {
        Command::new(&resolved_command)
    };
    #[cfg(not(windows))]
    let mut cmd = Command::new(&resolved_command);
    cmd.args(resolved_args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    if let Some(env) = env {
        cmd.envs(env);
    }
    #[cfg(unix)]
    if let Some(bin_dir) = resolved_command.parent() {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let mut paths = vec![bin_dir.to_path_buf()];
        paths.extend(std::env::split_paths(&path));
        if let Ok(path) = std::env::join_paths(paths) {
            cmd.env("PATH", path);
        }
    }

    let mut child = cmd
        .spawn()
        .map_err(|error| format!("无法启动 MCP 进程: {error}"))?;
    let stdout = child.stdout.take().ok_or("无法获取 MCP stdout")?;
    let stdin = child.stdin.take().ok_or("无法获取 MCP stdin")?;
    let stderr = child.stderr.take().ok_or("无法获取 MCP stderr")?;
    let handle_id = format!("mcp_{}", uuid::Uuid::new_v4());

    let stdout_channel = on_stdout.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = stdout_channel.send(line);
        }
        let _ = stdout_channel.send("__MCP_EOF__".to_string());
    });

    let stderr_handle_id = handle_id.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = on_stderr.send(line.clone());
            eprintln!("[MCP stderr:{stderr_handle_id}] {line}");
        }
    });

    MCP_PROCESSES
        .lock()
        .await
        .insert(handle_id.clone(), McpStdioProcess { child, stdin });
    let exit_handle_id = handle_id.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            let mut processes = MCP_PROCESSES.lock().await;
            let Some(process) = processes.get_mut(&exit_handle_id) else { break };
            match process.child.try_wait() {
                Ok(Some(status)) => {
                    let _ = on_exit.send(serde_json::json!({
                            "code": status.code(),
                            "signal": exit_signal(&status),
                    }).to_string());
                    break;
                }
                Ok(None) => {}
                Err(_) => break,
            }
        }
    });
    Ok(handle_id)
}


#[tauri::command]
pub async fn mcp_write_stdin(handle_id: String, message: String) -> Result<(), String> {
    let mut processes = MCP_PROCESSES.lock().await;
    let process = processes
        .get_mut(&handle_id)
        .ok_or_else(|| format!("MCP 进程不存在: {handle_id}"))?;
    process
        .stdin
        .write_all(message.as_bytes())
        .await
        .map_err(|error| format!("写入 MCP 进程失败: {error}"))?;
    process
        .stdin
        .write_all(b"\n")
        .await
        .map_err(|error| format!("写入 MCP 换行失败: {error}"))?;
    process
        .stdin
        .flush()
        .await
        .map_err(|error| format!("刷新 MCP stdin 失败: {error}"))
}

#[tauri::command]
pub async fn mcp_kill_stdio(handle_id: String) -> Result<(), String> {
    if let Some(mut process) = MCP_PROCESSES.lock().await.remove(&handle_id) {
        let _ = process.child.kill().await;
    }
    Ok(())
}

#[tauri::command]
pub fn resolve_mcp_node() -> Result<String, String> {
    for candidate in ["/opt/homebrew/bin/node", "/usr/local/bin/node"] {
        if std::path::Path::new(candidate).exists() { return Ok(candidate.to_string()); }
    }
    let candidate = resolve_local_binary("node");
    candidate.exists().then(|| candidate.to_string_lossy().into_owned())
        .ok_or_else(|| "找不到 Node.js 运行时".to_string())
}
