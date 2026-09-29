//! 工作台窗口：一个工作区一个窗口，另外可以开空的「新建窗口」。
//!
//! 命令放这里而不是 `lib.rs`：`#[tauri::command]` 会在**当前模块**导出 `__cmd__*` 宏，
//! 放在 crate root 会变成宏重复定义（实测错误 `the name __cmd__open_workspace_window is
//! defined multiple times`）。仓库里所有命令都遵循这条。

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, OnceLock};
use tauri::Manager;

/// 哪个窗口正在看哪个工作区（key = 工作区路径，value = 窗口 label）。
///
/// 为什么必须记账，而不是靠 label 本身：「一个工作区一个窗口」原本靠 label 形如
/// `ws-<sha256(cwd)>` 白拿，但 label 是**建窗时定死的**，而窗口可以在里面换工作区 ——
/// 空的 `win-1` 窗口选一个工作区、或 `ws-A` 窗口切到 B，label 就与它正在显示的东西脱钩了。
///
/// 不复用这张表会怎样：两个窗口各有自己的一份前端运行时表（每个 webview 是独立 realm），
/// 但 `DSH_HOME` 是按 cwd 取的**同一个目录**，于是同一个工作区起两个 runner，第二个会撞会话
/// 写锁，表现成「这个窗口发消息，那个窗口报 already owned by an active write handle」。
///
/// 表里的死窗口不主动清：查询时发现窗口已经没了就地删掉（见 `owner_of_workspace`），
/// 比额外挂一个销毁回调少一处会漂移的地方。
fn workspace_owners() -> &'static Mutex<HashMap<String, String>> {
    static OWNERS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    OWNERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_owners() -> MutexGuard<'static, HashMap<String, String>> {
    // 毒锁不影响正确性：里面只有字符串，没有会被 panic 破坏的不变量。
    workspace_owners().lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 该工作区现在归哪个**还活着**的窗口。
fn owner_of_workspace(app: &tauri::AppHandle, cwd: &str) -> Option<String> {
    let mut owners = lock_owners();
    let label = owners.get(cwd).cloned()?;
    if app.get_webview_window(&label).is_some() {
        return Some(label);
    }
    owners.remove(cwd);
    None
}

/// 把焦点还给某个窗口 —— 「已经开过」时唯一正确的动作（对齐 VS Code）。
fn focus_window(app: &tauri::AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 在一个新窗口里打开工作区。
///
/// 已经开过就聚焦那个窗口，对齐 VS Code「同一文件夹第二次打开只聚焦」。「已经开过」的判据是
/// 登记表而不是 label：窗口可以在里面换工作区，label 会与它显示的东西脱钩。
#[tauri::command]
pub async fn open_workspace_window(app: tauri::AppHandle, cwd: String) -> Result<String, String> {
    if cwd.trim().is_empty() {
        return Err("工作区路径为空".to_string());
    }
    if let Some(owner) = owner_of_workspace(&app, &cwd) {
        focus_window(&app, &owner);
        return Ok(owner);
    }
    let label = crate::workspace_window_label(&cwd);
    if app.get_webview_window(&label).is_some() {
        focus_window(&app, &label);
        lock_owners().insert(cwd, label.clone());
        return Ok(label);
    }
    let spawned = crate::spawn_workbench_window(&app, &label, Some(&cwd))?;
    lock_owners().insert(cwd, spawned.clone());
    Ok(spawned)
}

/// 打开一个**空**工作台窗口（对齐 VS Code 的「新建窗口」⌘⇧N）。
///
/// 空窗口不注入工作区，前端于是停在「没有项目」，由用户在里面选最近项目或打开本地文件夹。
/// 之前 ⌘⇧N 做的是「把当前工作区在新窗口打开」，用户看到的就是一个一模一样的窗口。
#[tauri::command]
pub async fn open_new_window(app: tauri::AppHandle) -> Result<String, String> {
    let label = crate::unbound_window_label(&app);
    crate::spawn_workbench_window(&app, &label, None)
}

/// 前端切换工作区**之前**先认领，返回真正拥有它的窗口 label。
///
/// 返回自己的 label = 没有冲突，可以切；返回别人的 = 那个工作区已经在别的窗口开着，
/// 调用方应当拒绝切换并提示（并把焦点给那个窗口）。同一个工作区两个窗口的代价见
/// `workspace_owners` 的说明。
#[tauri::command]
pub async fn claim_workspace(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    cwd: String,
) -> Result<String, String> {
    if cwd.trim().is_empty() {
        return Err("工作区路径为空".to_string());
    }
    let mine = window.label().to_string();
    if let Some(owner) = owner_of_workspace(&app, &cwd) {
        if owner != mine {
            focus_window(&app, &owner);
            return Ok(owner);
        }
    }
    let mut owners = lock_owners();
    // 一个窗口同时只显示一个工作区：认领新的就清掉这个窗口名下的旧记录，否则它切走之后，
    // 那个工作区在别的窗口里会永远被当成「已经打开」。
    owners.retain(|_, label| label != &mine);
    owners.insert(cwd, mine.clone());
    Ok(mine)
}
