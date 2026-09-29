//! 工作台窗口：一个工作区一个窗口，另外可以开空的「新建窗口」。
//!
//! 命令放这里而不是 `lib.rs`：`#[tauri::command]` 会在**当前模块**导出 `__cmd__*` 宏，
//! 放在 crate root 会变成宏重复定义（实测错误 `the name __cmd__open_workspace_window is
//! defined multiple times`）。仓库里所有命令都遵循这条。

use tauri::Manager;

/// 在一个新窗口里打开工作区。
///
/// 已经开过就聚焦那个窗口，对齐 VS Code「同一文件夹第二次打开只聚焦」：**一个工作区同时
/// 只能有一个窗口**是硬约束，因为 `ensureRuntime` 按 cwd 只有一个 runner 槽，而 abort 会
/// `stopRuntime` 连坐 —— 允许两个窗口绑同一工作区，会变成「点 A 窗口的停止，B 窗口的任务死了」。
#[tauri::command]
pub async fn open_workspace_window(app: tauri::AppHandle, cwd: String) -> Result<String, String> {
    if cwd.trim().is_empty() {
        return Err("工作区路径为空".to_string());
    }
    let label = crate::workspace_window_label(&cwd);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.unminimize();
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(label);
    }
    crate::spawn_workbench_window(&app, &label, Some(&cwd))
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
