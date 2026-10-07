use super::{
    screenshot_capture::{self as capture, Frame},
    screenshot_geometry::{check_task, crop_bounds},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::{
    borrow::Cow,
    str::FromStr,
    sync::{Arc, Mutex, MutexGuard},
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub shortcut: String,
    pub auto_copy: bool,
    pub directory: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcut: "Control+Shift+A".into(),
            auto_copy: true,
            directory: String::new(),
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    settings: Settings,
    permission: bool,
    error: String,
}
struct Active {
    // 与截图编辑会话同寿命；截图窗不具备安装权限，但安装必须等待它结束。
    update_task: Option<super::desktop_update::NativeTask>,
    id: String,
    label: String,
    source: Option<String>,
    owner: Option<String>,
    restore_focus: bool,
    monitor: tauri::Monitor,
    frame: Option<Arc<Frame>>,
    selected: Option<Arc<Frame>>,
    saving: bool,
}
#[derive(Default)]
struct Runtime {
    active: Option<Active>,
    settings: Settings,
    error: String,
    recording: Option<String>,
}
pub struct ScreenshotRuntime(Mutex<Runtime>);
fn lock(app: &tauri::AppHandle) -> MutexGuard<'_, Runtime> {
    app.state::<ScreenshotRuntime>()
        .inner()
        .0
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}
fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("screenshot-settings.json"))
}
fn persist(app: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(
        &temp,
        serde_json::to_vec(settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(&temp, path).map_err(|e| e.to_string())
}
fn report(app: &tauri::AppHandle, error: String) {
    lock(app).error = error.clone();
    let _ = app.emit("screenshot:error", error);
}
pub fn setup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let mut runtime = Runtime::default();
    if let Ok(path) = settings_path(app) {
        if path.exists() {
            match std::fs::read(path)
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
            {
                Some(settings) => runtime.settings = settings,
                None => runtime.error = "截图设置读取失败，已使用默认值".into(),
            }
        }
    }
    // 用户确认默认使用 Control；迁移此前截图功能的默认组合，保留其他自定义键。
    if runtime.settings.shortcut == "CommandOrControl+Shift+A" {
        runtime.settings.shortcut = Settings::default().shortcut;
        persist(app, &runtime.settings)?;
    }
    if Shortcut::from_str(&runtime.settings.shortcut).is_err() {
        runtime.settings.shortcut = Settings::default().shortcut;
        runtime.error = "截图快捷键配置无效，已使用默认值".into();
    }
    let shortcut = runtime.settings.shortcut.clone();
    app.manage(ScreenshotRuntime(Mutex::new(runtime)));
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _, event| {
                if event.state() != ShortcutState::Pressed || lock(app).recording.is_some() {
                    return;
                }
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let source = crate::remote_target_window(&app)
                        .filter(|w| !w.label().starts_with("shot-"));
                    if let Err(error) = begin(app.clone(), source).await {
                        report(&app, error);
                    }
                });
            })
            .build(),
    )?;
    if let Err(error) = app.global_shortcut().register(shortcut.as_str()) {
        report(app, format!("截图快捷键注册失败（可能已被占用）：{error}"));
    }
    Ok(())
}
fn ensure_workbench(window: &tauri::WebviewWindow) -> Result<(), String> {
    let label = window.label();
    if label != "main" && !label.starts_with("ws-") && !label.starts_with("win-") {
        return Err("此窗口不能修改截图设置".into());
    }
    Ok(())
}
#[tauri::command]
pub fn screenshot_settings(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Status, String> {
    ensure_workbench(&window)?;
    let state = lock(&app);
    Ok(Status {
        settings: state.settings.clone(),
        permission: capture::permission(false),
        error: state.error.clone(),
    })
}
#[tauri::command]
pub fn screenshot_set_settings(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    settings: Settings,
) -> Result<(), String> {
    ensure_workbench(&window)?;
    let new = Shortcut::from_str(&settings.shortcut).map_err(|e| format!("快捷键无效：{e}"))?;
    if new.mods.is_empty() {
        return Err("快捷键必须包含 Command/Control/Alt/Shift 等修饰键".into());
    }
    if !settings.directory.is_empty() && !std::path::Path::new(&settings.directory).is_dir() {
        return Err("默认目录不存在".into());
    }
    let mut state = lock(&app);
    let old = Shortcut::from_str(&state.settings.shortcut).map_err(|e| e.to_string())?;
    let changed = old != new;
    if changed {
        app.global_shortcut()
            .register(new)
            .map_err(|e| format!("新快捷键注册失败（可能已被占用），旧键保留：{e}"))?;
        if let Err(error) = app.global_shortcut().unregister(old) {
            let rollback = app.global_shortcut().unregister(new);
            return Err(format!("旧快捷键注销失败：{error}；撤销新键：{rollback:?}"));
        }
    } else if !app.global_shortcut().is_registered(new) {
        app.global_shortcut()
            .register(new)
            .map_err(|e| e.to_string())?;
    }
    if let Err(error) = persist(&app, &settings) {
        if changed {
            let rollback_old = app.global_shortcut().register(old);
            let rollback_new = app.global_shortcut().unregister(new);
            return Err(format!(
                "设置保存失败：{error}；恢复旧键：{rollback_old:?}；撤销新键：{rollback_new:?}"
            ));
        }
        return Err(error);
    }
    state.settings = settings;
    state.error.clear();
    drop(state);
    let _ = app.emit("screenshot:settings-changed", ());
    Ok(())
}
#[tauri::command]
pub fn screenshot_recording(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    recording: bool,
) -> Result<(), String> {
    ensure_workbench(&window)?;
    let mut state = lock(&app);
    if recording {
        if state
            .recording
            .as_deref()
            .is_some_and(|label| label != window.label())
        {
            return Err("另一窗口正在录制快捷键".into());
        }
        state.recording = Some(window.label().into());
    } else if state.recording.as_deref() == Some(window.label()) {
        state.recording = None;
    }
    Ok(())
}
#[tauri::command]
pub fn screenshot_permission(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<bool, String> {
    ensure_workbench(&window)?;
    let granted = capture::permission(true);
    if !granted {
        report(
            &app,
            "请在系统设置 → 隐私与安全性 → 屏幕录制中授权韭菜盒子；必要时重启应用".into(),
        );
    }
    Ok(granted)
}
#[tauri::command]
pub async fn screenshot_begin(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    ensure_workbench(&window)?;
    begin(app, Some(window)).await
}
async fn begin(app: tauri::AppHandle, source: Option<tauri::WebviewWindow>) -> Result<(), String> {
    let update_task = super::desktop_update::native_task(&app)?;
    {
        let state = lock(&app);
        if let Some(active) = &state.active {
            if let Some(window) = app.get_webview_window(&active.label) {
                let _ = window.set_focus();
            }
            return Ok(());
        }
    }
    let monitor = capture::target_monitor(&app)?;
    let id = uuid::Uuid::new_v4().to_string();
    let label = format!("shot-{id}");
    {
        let mut state = lock(&app);
        if state.active.is_some() {
            return Ok(());
        }
        state.active = Some(Active {
            update_task,
            id: id.clone(),
            label: label.clone(),
            source: source.as_ref().map(|w| w.label().to_string()),
            owner: source
                .as_ref()
                .and_then(|w| super::workspace::workspace_for_window(w.label())),
            restore_focus: source
                .as_ref()
                .is_some_and(|w| w.is_focused().unwrap_or(false)),
            monitor: monitor.clone(),
            frame: None,
            selected: None,
            saving: false,
        });
    }
    if !capture::permission(false) && !capture::permission(true) {
        finish(&app, &id, false);
        return Err("需要屏幕录制权限，请在截图设置中授权".into());
    }
    if !monitor_unchanged(&app, &monitor) {
        finish(&app, &id, false);
        return Err("显示器已变化，请重新截图".into());
    }
    let target = monitor.clone();
    let result = tauri::async_runtime::spawn_blocking(move || capture::capture(&target))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    match result {
        Ok(frame) => {
            let mut state = lock(&app);
            let active = state.active.as_mut().ok_or("截图任务已结束")?;
            check_task(&active.id, &active.label, &id, &label)?;
            active.frame = Some(Arc::new(frame));
        }
        Err(error) => {
            finish(&app, &id, false);
            return Err(error);
        }
    }
    let result = (|| {
        let window = tauri::WebviewWindowBuilder::new(
            &app,
            &label,
            tauri::WebviewUrl::App("/screenshot/index.html".into()),
        )
        .title("截图")
        .visible(false)
        .decorations(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .build()
        .map_err(|e| e.to_string())?;
        let app_clone = app.clone();
        let id_clone = id.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                finish(&app_clone, &id_clone, false);
            }
        });
        window
            .set_position(*monitor.position())
            .map_err(|e| e.to_string())?;
        window
            .set_size(*monitor.size())
            .map_err(|e| e.to_string())?;
        // 没有 ready 的页面必须有回收期限，不能无限占用唯一截图任务。
        let timeout_app = app.clone();
        let timeout_id = id.clone();
        let timeout_label = label.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            if let Some(w) = timeout_app.get_webview_window(&timeout_label) {
                if !w.is_visible().unwrap_or(false) {
                    finish(&timeout_app, &timeout_id, true);
                    report(&timeout_app, "截图界面未能启动，请重试".into());
                }
            }
        });
        Ok(())
    })();
    if result.is_err() {
        finish(&app, &id, true);
    }
    result
}
fn monitor_unchanged(app: &tauri::AppHandle, original: &tauri::Monitor) -> bool {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .any(|m| {
            m.position() == original.position()
                && m.size() == original.size()
                && m.scale_factor() == original.scale_factor()
                && m.name() == original.name()
        })
}
fn frame_for(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    id: &str,
    selected: bool,
) -> Result<Arc<Frame>, String> {
    let state = lock(app);
    let active = state.active.as_ref().ok_or("截图任务已结束")?;
    check_task(&active.id, &active.label, id, window.label())?;
    if !monitor_unchanged(app, &active.monitor) {
        return Err("显示器已变化，请取消并重新截图".into());
    }
    (if selected {
        &active.selected
    } else {
        &active.frame
    })
    .clone()
    .ok_or("请先选择截图区域".into())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    id: String,
    png_base64: String,
    width: u32,
    height: u32,
    can_save_project: bool,
    auto_copy: bool,
    directory: String,
}
#[tauri::command]
pub async fn screenshot_read(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Snapshot, String> {
    let (id, can_save_project, settings) = {
        let state = lock(&app);
        let active = state.active.as_ref().ok_or("截图任务已结束")?;
        check_task(&active.id, &active.label, &active.id, window.label())?;
        (
            active.id.clone(),
            active.owner.is_some(),
            state.settings.clone(),
        )
    };
    let frame = frame_for(&app, &window, &id, false)?;
    let width = frame.width;
    let height = frame.height;
    let bytes = tauri::async_runtime::spawn_blocking(move || frame.png())
        .await
        .map_err(|e| e.to_string())??;
    Ok(Snapshot {
        id,
        png_base64: STANDARD.encode(bytes),
        width,
        height,
        can_save_project,
        auto_copy: settings.auto_copy,
        directory: settings.directory,
    })
}
#[tauri::command]
pub fn screenshot_ready(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    frame_for(&app, &window, &id, false)?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cropped {
    png_base64: String,
    width: u32,
    height: u32,
}
#[tauri::command]
pub async fn screenshot_crop(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    selection: [f64; 6],
) -> Result<Cropped, String> {
    let frame = frame_for(&app, &window, &id, false)?;
    let bounds = crop_bounds(frame.width, frame.height, selection)?;
    let (selected, bytes) = tauri::async_runtime::spawn_blocking(move || {
        let selected = frame.crop(bounds);
        let bytes = selected.png()?;
        Ok::<_, String>((Arc::new(selected), bytes))
    })
    .await
    .map_err(|e| e.to_string())??;
    let mut state = lock(&app);
    let active = state.active.as_mut().ok_or("截图任务已结束")?;
    check_task(&active.id, &active.label, &id, window.label())?;
    let result = Cropped {
        width: selected.width,
        height: selected.height,
        png_base64: STANDARD.encode(bytes),
    };
    active.selected = Some(selected);
    Ok(result)
}
#[tauri::command]
pub async fn screenshot_copy(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    let frame = frame_for(&app, &window, &id, true)?;
    let caller = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let state = lock(&app);
        let active = state.active.as_ref().ok_or("截图任务已结束")?;
        check_task(&active.id, &active.label, &id, &caller)?;
        arboard::Clipboard::new()
            .map_err(|e| e.to_string())?
            .set_image(arboard::ImageData {
                width: frame.width as usize,
                height: frame.height as usize,
                bytes: Cow::Borrowed(&frame.rgba),
            })
            .map_err(|e| format!("复制失败：{e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn finish(app: &tauri::AppHandle, id: &str, close: bool) {
    let active = {
        let mut state = lock(app);
        if state.active.as_ref().is_none_or(|a| a.id != id) {
            return;
        }
        state.active.take().unwrap()
    };
    if close {
        if let Some(w) = app.get_webview_window(&active.label) {
            let _ = w.destroy();
        }
    }
    if active.restore_focus {
        if let Some(w) = active
            .source
            .and_then(|label| app.get_webview_window(&label))
        {
            let _ = w.set_focus();
        }
    }
}
#[tauri::command]
pub fn screenshot_end(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    let state = lock(&app);
    if let Some(active) = &state.active {
        check_task(&active.id, &active.label, &id, window.label())?;
        if active.saving {
            return Err("正在保存截图，请等待结果后取消".into());
        }
    }
    drop(state);
    finish(&app, &id, true);
    Ok(())
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    id: String,
    owner: String,
    png_base64: String,
}
#[tauri::command]
pub async fn screenshot_save_project(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    let frame = frame_for(&app, &window, &id, true)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || frame.png())
        .await
        .map_err(|e| e.to_string())??;
    let mut state = lock(&app);
    let active = state.active.as_mut().ok_or("截图任务已结束")?;
    check_task(&active.id, &active.label, &id, window.label())?;
    let source = active.source.as_ref().ok_or("没有来源工作台")?;
    let owner = active.owner.as_ref().ok_or("没有来源项目")?;
    if active.saving {
        return Err("正在保存，请稍候".into());
    }
    if super::workspace::workspace_for_window(source).as_ref() != Some(owner)
        || app.get_webview_window(source).is_none()
    {
        return Err("来源工作台已关闭或切换项目，不能保存".into());
    }
    active.saving = true;
    let request = SaveRequest {
        id: id.clone(),
        owner: owner.clone(),
        png_base64: STANDARD.encode(bytes),
    };
    if let Err(error) = app.emit_to(source, "screenshot:save-project", request) {
        active.saving = false;
        return Err(error.to_string());
    }
    drop(state);
    // 前端崩溃/未回执时允许重试，而不永久禁用按钮。
    let timeout_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        let mut state = lock(&timeout_app);
        if let Some(a) = state.active.as_mut().filter(|a| a.id == id && a.saving) {
            a.saving = false;
            let _ = timeout_app.emit_to(
                &a.label,
                "screenshot:save-result",
                serde_json::json!({"id":id,"error":"项目保存未收到回执，请查看项目后重试"}),
            );
        }
    });
    Ok(())
}
#[tauri::command]
pub fn screenshot_save_result(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    error: Option<String>,
) -> Result<(), String> {
    let mut state = lock(&app);
    let active = state.active.as_mut().ok_or("截图任务已结束")?;
    if active.id != id || active.source.as_deref() != Some(window.label()) || !active.saving {
        return Err("保存回执不属于此任务".into());
    }
    active.saving = false;
    app.emit_to(
        &active.label,
        "screenshot:save-result",
        serde_json::json!({"id":id,"error":error}),
    )
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn screenshot_remember_directory(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    directory: String,
) -> Result<(), String> {
    frame_for(&app, &window, &id, true)?;
    if !std::path::Path::new(&directory).is_dir() {
        return Err("目录不存在".into());
    }
    let mut state = lock(&app);
    let mut settings = state.settings.clone();
    settings.directory = directory;
    persist(&app, &settings)?;
    state.settings = settings;
    drop(state);
    let _ = app.emit("screenshot:settings-changed", ());
    Ok(())
}

#[tauri::command]
pub fn screenshot_validate_project(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
    owner: String,
) -> Result<(), String> {
    let state = lock(&app);
    let active = state.active.as_ref().ok_or("截图任务已结束")?;
    if active.id != id
        || active.source.as_deref() != Some(window.label())
        || active.owner.as_deref() != Some(&owner)
        || !active.saving
    {
        return Err("项目保存不属于此截图任务".into());
    }
    if super::workspace::workspace_for_window(window.label()).as_deref() != Some(&owner) {
        return Err("来源项目已切换".into());
    }
    Ok(())
}
#[tauri::command]
pub fn screenshot_check(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<bool, String> {
    if let Err(error) = frame_for(&app, &window, &id, false) {
        // frame_for 同时验证窗口身份；不允许外来请求关闭别人的任务。
        let state = lock(&app);
        let ours = state
            .active
            .as_ref()
            .is_some_and(|a| a.id == id && a.label == window.label());
        drop(state);
        if ours {
            finish(&app, &id, true);
            report(&app, error.clone());
        }
        return Err(error);
    }
    let state = lock(&app);
    let active = state.active.as_ref().ok_or("截图任务已结束")?;
    Ok(active.source.as_ref().is_some_and(|source| {
        app.get_webview_window(source).is_some()
            && active.owner.is_some()
            && super::workspace::workspace_for_window(source) == active.owner
    }))
}
pub fn window_closed(app: &tauri::AppHandle, label: &str) {
    let mut state = lock(app);
    if state.recording.as_deref() == Some(label) {
        state.recording = None;
    }
}
