use crate::commands::tools::resolve_local_binary;
use std::collections::HashMap;
use std::sync::LazyLock;
use tauri::ipc::Channel;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

struct McpStdioProcess {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    /// Harness 运行时（`runner.mjs`）。页面重载后要单独回收，见 [`mcp_reap_stale_harness`]。
    is_harness_runner: bool,
    /// 归属：哪个窗口、哪一代页面起的。见 [`ReapScope`]。
    owner: Option<Owner>,
}

/// 一个 stdio 子进程的归属。
///
/// 只需要窗口 label 是不够的：dev 的 F5/HMR 重挂时 label 不变（还是 `main`），光看 label
/// 就分不出「上一个页面留下的孤儿」和「本页面的活进程」—— 那样要么收不掉旧 runner
/// （下一轮 resume 撞写锁），要么把多窗口里别人的进程一起误杀。加上每次挂载都会换的
/// realm，两件事才能分开。
#[derive(Clone, Debug, PartialEq, Eq)]
struct Owner {
    window: String,
    realm: String,
}

/// 一次收割的视野：哪些窗口还活着、当前是谁在收。
#[derive(Debug)]
struct ReapScope<'a> {
    /// 当前存在的窗口 label（`AppHandle::webview_windows()` 的键）。
    live_windows: &'a [String],
    /// 发起收割的窗口。
    window: &'a str,
    /// 发起收割的这个页面 realm。
    realm: &'a str,
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
    window: tauri::WebviewWindow,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    realm: String,
    on_stdout: Channel<String>,
    on_stderr: Channel<String>,
    on_exit: Channel<String>,
) -> Result<String, String> {
    let owner = Owner { window: window.label().to_string(), realm };
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
    // `runner.mjs` 自己还会拉起一个 `dsh --profile sdk` 子进程，收尾必须按进程树走。
    let is_harness_runner = resolved_args.iter().any(|arg| arg.ends_with("runner.mjs"));
    #[cfg(not(windows))]
    let mut cmd = Command::new(&resolved_command);
    cmd.args(resolved_args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    // POSIX：先让子进程自立门户（组号 = pid），收尾时一次带走它和它的子孙。
    #[cfg(unix)]
    cmd.process_group(0);
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
        .insert(handle_id.clone(), McpStdioProcess { child, stdin, is_harness_runner, owner: Some(owner) });
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

/// 结束一个 stdio 子进程的整棵进程树（程序 + 参数，便于按平台断言）。
///
/// 只收直接子进程是不够的：Harness 的 `runner.mjs` 自己再拉起一个 `dsh --profile sdk` 子进程，
/// 而会话的写所有权是一把**跨进程内核锁**（jsonl 后端的 lease：Windows 命名信号量 / POSIX `flock`），
/// 官方明确不给它过期时间 —— 谁留下一个活着的 `dsh`，这个会话在本机就再也写不进去。
/// 实测：Windows 上 node 会把非 `detached` 的子进程挂进一个 job object，杀掉 runner 会连带带走它，
/// 但那是 libuv 的实现细节、不是契约；这里显式按进程树收尾（Windows `/T`，POSIX 收进程组）。
#[cfg(windows)]
fn tree_kill_plan(pid: u32) -> (&'static str, Vec<String>) {
    (
        "taskkill",
        vec!["/T".into(), "/F".into(), "/PID".into(), pid.to_string()],
    )
}

#[cfg(unix)]
fn tree_kill_plan(pid: u32) -> (&'static str, Vec<String>) {
    // 负号表示「这个进程组」；子进程在 spawn 时用 `process_group(0)` 把组号定成了自己的 pid。
    ("/bin/kill", vec!["-KILL".into(), format!("-{pid}")])
}

/// 收尾路径专用：`taskkill` / `kill` 都是毫秒级命令，阻塞等到返回，换来「返回即已收干净」。
fn kill_process_tree(pid: u32) {
    let (program, args) = tree_kill_plan(pid);
    let _ = std::process::Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

/// 收掉一个 stdio 进程：先带走整棵树，再回收直接子进程。
async fn reap_stdio_process(mut process: McpStdioProcess) {
    if let Some(pid) = process.child.id() {
        kill_process_tree(pid);
    }
    let _ = process.child.kill().await;
    let _ = process.child.wait().await;
}

/// 这个进程是不是孤儿：归属的窗口已经不存在，或它就是**本窗口上一代页面**留下的。
///
/// `scope` 为 `None` 表示不判归属（应用退出路径：所有窗口都要关，全收）。
///
/// 两条必须同时成立，缺一条就会出 bug：
/// - 只看窗口 label：dev 的 F5 重挂收不掉旧 runner，下一轮 resume 撞
///   `already owned by an active write handle`；
/// - 不看窗口 label：新窗口一挂载就把别的窗口的 runner 全杀了。
fn is_orphan(owner: Option<&Owner>, scope: Option<&ReapScope<'_>>) -> bool {
    let Some(scope) = scope else { return true };
    let Some(owner) = owner else { return true };
    if !scope.live_windows.iter().any(|live| live == &owner.window) { return true }
    owner.window == scope.window && owner.realm != scope.realm
}

/// 不等待登记表锁的收尾（退出路径与页面重载路径专用）：能把谁收掉就收掉。
///
/// `only_harness` 为真时只收 Harness 运行时：新页面挂载时创作 MCP 等其他 stdio 子进程
/// 可能已经起来了，不能被顺手带走。
fn reap_stdio_processes_blocking(only_harness: bool, scope: Option<&ReapScope<'_>>) -> usize {
    let Ok(mut processes) = MCP_PROCESSES.try_lock() else { return 0 };
    let handles: Vec<String> = processes
        .iter()
        .filter(|(_, process)| !only_harness || process.is_harness_runner)
        .filter(|(_, process)| is_orphan(process.owner.as_ref(), scope))
        .map(|(handle_id, _)| handle_id.clone())
        .collect();
    let mut reaped = 0;
    for handle_id in handles {
        if let Some(process) = processes.remove(&handle_id) {
            if let Some(pid) = process.child.id() {
                kill_process_tree(pid);
            }
            reaped += 1;
        }
    }
    reaped
}

#[tauri::command]
pub async fn mcp_kill_stdio(handle_id: String) -> Result<(), String> {
    if let Some(process) = MCP_PROCESSES.lock().await.remove(&handle_id) {
        reap_stdio_process(process).await;
    }
    Ok(())
}

/// 页面重载（dev 的 F5、HMR 重挂）会丢掉 App 里唯一指向运行时的句柄：进程还活着、stdin 还开着、
/// 会话写句柄还握着那把跨进程写锁，但再没有人能关掉它。新页面启动时先把**同一窗口上一代页面**
/// 留下的 Harness 收掉，否则同一会话的下一轮 resume 必撞 `already owned by an active write handle`。
///
/// 只收同窗口的：多开时另一个窗口的运行时是活着的，一个字都不能碰。
#[tauri::command]
pub fn mcp_reap_stale_harness(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    realm: String,
) -> usize {
    let live_windows: Vec<String> = app.webview_windows().keys().cloned().collect();
    reap_stdio_processes_blocking(
        true,
        Some(&ReapScope { live_windows: &live_windows, window: window.label(), realm: &realm }),
    )
}

/// 应用退出时收掉所有还在跑的 stdio 进程树（同步，退出路径上不再进一次异步调度）。
pub fn reap_all_stdio_processes() -> usize {
    reap_stdio_processes_blocking(false, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_kill_covers_the_whole_process_tree() {
        let (program, args) = tree_kill_plan(4242);
        #[cfg(windows)]
        {
            // 少了 `/T` 就只杀 runner，它拉起的 dsh 会变成握着会话写锁的孤儿。
            assert_eq!(program, "taskkill");
            assert!(args.contains(&"/T".to_string()), "taskkill 必须带 /T: {args:?}");
            assert!(args.contains(&"/F".to_string()), "taskkill 必须带 /F: {args:?}");
            assert_eq!(args.last().map(String::as_str), Some("4242"));
        }
        #[cfg(unix)]
        {
            assert_eq!(program, "/bin/kill");
            assert_eq!(args, vec!["-KILL".to_string(), "-4242".to_string()]);
        }
    }

    fn owned(window: &str, realm: &str) -> Owner {
        Owner { window: window.to_string(), realm: realm.to_string() }
    }

    fn scope<'a>(live: &'a [String], window: &'a str, realm: &'a str) -> ReapScope<'a> {
        ReapScope { live_windows: live, window, realm }
    }

    /// 退出路径：不判归属，全收。
    #[test]
    fn exit_reaps_everything_regardless_of_owner() {
        let owner = owned("main", "r1");
        assert!(is_orphan(Some(&owner), None));
    }

    /// 多窗口的核心合同：**另一个窗口的运行时一个字都不能碰**。
    ///
    /// 没有这条，新窗口一挂载就把主窗口正在跑的那轮任务杀了 —— 收割遍历的是进程内
    /// 全局表，而每个窗口都会在自己的 main.ts 里调一次收割。
    #[test]
    fn another_live_window_is_never_reaped() {
        let live = vec!["main".to_string(), "ws-abc".to_string()];
        let owner = owned("ws-abc", "whatever");
        assert!(!is_orphan(Some(&owner), Some(&scope(&live, "main", "r-main"))));
    }

    /// dev 的 F5/HMR：同一窗口、新的一代页面，旧 runner 必须收掉。
    ///
    /// 少了这条，下一轮 resume 会撞 `already owned by an active write handle` ——
    /// 这正是收割存在的原因，不能为了多窗口把它丢掉。
    #[test]
    fn same_window_previous_realm_is_reaped() {
        let live = vec!["main".to_string()];
        let owner = owned("main", "old-realm");
        assert!(is_orphan(Some(&owner), Some(&scope(&live, "main", "new-realm"))));
    }

    /// 本窗口本代页面的进程是活的。
    #[test]
    fn same_window_same_realm_survives() {
        let live = vec!["main".to_string()];
        let owner = owned("main", "realm");
        assert!(!is_orphan(Some(&owner), Some(&scope(&live, "main", "realm"))));
    }

    /// 窗口已经关掉了，它留下的进程就是孤儿（哪怕 realm 恰好相同）。
    #[test]
    fn closed_window_is_reaped() {
        let live = vec!["main".to_string()];
        let owner = owned("ws-gone", "realm");
        assert!(is_orphan(Some(&owner), Some(&scope(&live, "main", "realm"))));
    }

    /// 没有归属信息的进程（理论上不存在，留作保守兜底）按孤儿处理。
    #[test]
    fn unknown_owner_is_reaped() {
        let live = vec!["main".to_string()];
        assert!(is_orphan(None, Some(&scope(&live, "main", "realm"))));
    }
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
