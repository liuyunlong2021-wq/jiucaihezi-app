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

static MCP_PROCESSES: LazyLock<Mutex<HashMap<String, McpStdioProcess>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub async fn mcp_spawn_stdio(
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    on_stdout: Channel<String>,
) -> Result<String, String> {
    let mut cmd = Command::new(resolve_local_binary(&command));
    cmd.args(args)
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

    let mut child = cmd.spawn().map_err(|error| format!("无法启动 MCP 进程: {error}"))?;
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
            eprintln!("[MCP stderr:{stderr_handle_id}] {line}");
        }
    });

    MCP_PROCESSES.lock().await.insert(handle_id.clone(), McpStdioProcess { child, stdin });
    Ok(handle_id)
}

#[tauri::command]
pub async fn mcp_write_stdin(handle_id: String, message: String) -> Result<(), String> {
    let mut processes = MCP_PROCESSES.lock().await;
    let process = processes.get_mut(&handle_id)
        .ok_or_else(|| format!("MCP 进程不存在: {handle_id}"))?;
    process.stdin.write_all(message.as_bytes()).await
        .map_err(|error| format!("写入 MCP 进程失败: {error}"))?;
    process.stdin.write_all(b"\n").await
        .map_err(|error| format!("写入 MCP 换行失败: {error}"))?;
    process.stdin.flush().await
        .map_err(|error| format!("刷新 MCP stdin 失败: {error}"))
}

#[tauri::command]
pub async fn mcp_kill_stdio(handle_id: String) -> Result<(), String> {
    if let Some(mut process) = MCP_PROCESSES.lock().await.remove(&handle_id) {
        let _ = process.child.kill().await;
    }
    Ok(())
}
