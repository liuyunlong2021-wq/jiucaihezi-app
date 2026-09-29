//! 工作区窗口：一个工作区一个窗口。
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
    let config = crate::workbench_window_config(&app, &label, Some(&cwd))?;
    let window =
        crate::build_workbench_window(&app, &config, Some(&cwd)).map_err(|error| error.to_string())?;
    crate::attach_window_state(&app, &window, &label);
    Ok(label)
}
