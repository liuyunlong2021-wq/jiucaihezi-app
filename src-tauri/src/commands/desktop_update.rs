use serde::{Deserialize, Serialize};
use std::{collections::{HashMap, HashSet}, sync::Mutex, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    phase: String,
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
    error: Option<String>,
    message: Option<String>,
    downloaded: u64,
    total: Option<u64>,
}

#[derive(Default)]
struct Preparation {
    id: String,
    pending: HashSet<String>,
    error: Option<String>,
}

impl Preparation {
    fn acknowledge(&mut self, id: &str, window: &str, error: Option<String>) {
        if self.id != id || !self.pending.remove(window) { return; }
        if error.is_some() { self.error = error; }
    }
    fn result(&self) -> Result<bool, String> {
        if let Some(error) = &self.error { return Err(error.clone()); }
        Ok(self.pending.is_empty())
    }
}

#[derive(Default)]
struct Inner {
    status: Status,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
    preparation: Preparation,
    tasks: HashMap<String, String>,
}

impl Inner {
    fn begin_task(&mut self, owner: &str) -> Result<String, String> {
        if blocked(&self.status.phase) { return Err("正在准备应用升级，请稍后再试".into()); }
        let id = uuid::Uuid::new_v4().to_string();
        self.tasks.insert(id.clone(), owner.into());
        Ok(id)
    }
    fn begin_preparation(&mut self) -> Result<(), String> {
        if self.bytes.is_none() { return Err("请先下载并验证更新包".into()); }
        if !self.tasks.is_empty() { return Err("还有任务正在运行，完成后再安装升级".into()); }
        self.status.phase = "preparing".into();
        self.status.error = None;
        Ok(())
    }
}

#[derive(Default)]
pub struct DesktopUpdateState {
    inner: Mutex<Inner>,
    operation: tokio::sync::Mutex<()>,
}

fn workbench(label: &str) -> bool { label == "main" || label.starts_with("ws-") || label.starts_with("win-") }

fn allowed(window: &WebviewWindow) -> Result<(), String> {
    if workbench(window.label()) { Ok(()) } else { Err("该窗口不能执行应用升级".into()) }
}

fn blocked(phase: &str) -> bool { matches!(phase, "preparing" | "installing") }

pub fn ensure_task_allowed(app: &AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<DesktopUpdateState>() {
        if blocked(&state.inner.lock().unwrap_or_else(|e| e.into_inner()).status.phase) {
            return Err("正在准备应用升级，请稍后再试".into());
        }
    }
    Ok(())
}

pub struct NativeTask { app: AppHandle, id: String }
impl Drop for NativeTask {
    fn drop(&mut self) {
        if let Some(state) = self.app.try_state::<DesktopUpdateState>() {
            state.inner.lock().unwrap_or_else(|e| e.into_inner()).tasks.remove(&self.id);
        }
    }
}

pub fn native_task(app: &AppHandle) -> Result<Option<NativeTask>, String> {
    let Some(state) = app.try_state::<DesktopUpdateState>() else { return Ok(None); };
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    let id = inner.begin_task("native")?;
    Ok(Some(NativeTask { app: app.clone(), id }))
}

fn publish(app: &AppHandle, state: &DesktopUpdateState) {
    let status = state.inner.lock().unwrap_or_else(|e| e.into_inner()).status.clone();
    let _ = app.emit("desktop-update:status", status);
}

pub fn setup(app: &AppHandle) {
    let state = app.state::<DesktopUpdateState>();
    let result = validate_config(app.config().plugins.0.get("updater"))
        .and_then(|_| app.plugin(tauri_plugin_updater::Builder::new().build()).map_err(|e| e.to_string()));
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    inner.status.current_version = app.package_info().version.to_string();
    inner.status.phase = if result.is_ok() { "idle" } else { "unavailable" }.into();
    inner.status.error = result.err();
}

fn validate_config(value: Option<&serde_json::Value>) -> Result<(), String> {
    use base64::Engine;
    let config: tauri_plugin_updater::Config = serde_json::from_value(value.cloned().ok_or("缺少更新配置")?)
        .map_err(|_| "更新配置无效")?;
    let key = base64::engine::general_purpose::STANDARD.decode(&config.pubkey).map_err(|_| "更新公钥无效")?;
    if !key.starts_with(b"untrusted comment:") || !config.require_signed_version || config.endpoints.is_empty()
        || config.endpoints.iter().any(|url| url.scheme() != "https") {
        return Err("更新配置需要有效公钥及 HTTPS 地址".into());
    }
    Ok(())
}

#[tauri::command]
pub fn desktop_update_status(window: WebviewWindow, state: State<DesktopUpdateState>) -> Result<Status, String> {
    allowed(&window)?;
    Ok(state.inner.lock().unwrap_or_else(|e| e.into_inner()).status.clone())
}

#[tauri::command]
pub fn desktop_update_task_begin(window: WebviewWindow, state: State<DesktopUpdateState>) -> Result<String, String> {
    allowed(&window)?;
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    inner.begin_task(window.label())
}

#[tauri::command]
pub fn desktop_update_task_end(window: WebviewWindow, state: State<DesktopUpdateState>, id: String) -> Result<(), String> {
    allowed(&window)?;
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    if inner.tasks.get(&id).is_some_and(|owner| owner == window.label()) { inner.tasks.remove(&id); }
    Ok(())
}

pub fn window_closed(app: &AppHandle, label: &str) {
    let state = app.state::<DesktopUpdateState>();
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    inner.tasks.retain(|_, owner| owner != label);
    if inner.preparation.pending.contains(label) { inner.preparation.error = Some("工作窗口已关闭，请重新尝试升级".into()); }
    let _ = app.emit("desktop-update:waiting", Option::<String>::None);
}

#[derive(Deserialize, Serialize)]
struct Resume {
    version: String,
    windows: Vec<(String, Option<String>)>,
}

pub fn resume_windows(app: &AppHandle) -> Vec<(String, Option<String>)> {
    let Ok(root) = app.path().app_data_dir() else { return Vec::new(); };
    let path = root.join("updater-relaunch.json");
    let Ok(bytes) = std::fs::read(&path) else { return Vec::new(); };
    let Ok(resume) = serde_json::from_slice::<Resume>(&bytes) else { return Vec::new(); };
    let state = app.state::<DesktopUpdateState>();
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    if resume.version == app.package_info().version.to_string() {
        inner.status.message = Some(format!("已升级至 v{}", resume.version));
    } else { inner.status.error = Some("上次更新未完成，请检查更新后重试".into()); }
    let _ = std::fs::remove_file(path);
    resume.windows.into_iter().filter(|(label, _)| workbench(label)).collect()
}

#[tauri::command]
pub async fn desktop_update_check(window: WebviewWindow, app: AppHandle, state: State<'_, DesktopUpdateState>) -> Result<(), String> {
    allowed(&window)?;
    let _operation = state.operation.try_lock().map_err(|_| "正在处理升级，请稍后")?;
    {
        let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.status.phase == "unavailable" { return Err(inner.status.error.clone().unwrap_or_default()); }
        if inner.bytes.is_some() { return Ok(()); }
        inner.status.phase = "checking".into(); inner.status.error = None;
    }
    publish(&app, &state);
    let result = async {
        let updater = app.updater_builder().timeout(Duration::from_secs(15)).build().map_err(|e| e.to_string())?;
        let mut update = updater.check().await.map_err(|e| e.to_string())?;
        if let Some(update) = &mut update {
            if update.download_url.scheme() != "https" { return Err("更新包地址必须使用 HTTPS".into()); }
            update.timeout = Some(Duration::from_secs(20 * 60));
        }
        Ok(update)
    }.await;
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    match result {
        Ok(update) => {
            inner.status.version = update.as_ref().map(|u| u.version.clone());
            inner.status.notes = update.as_ref().and_then(|u| u.body.clone());
            inner.status.phase = if update.is_some() { "available" } else { "idle" }.into();
            inner.update = update;
        }
        Err(error) => { inner.status.phase = "error".into(); inner.status.error = Some(error); }
    }
    drop(inner);
    publish(&app, &state);
    Ok(())
}

#[tauri::command]
pub async fn desktop_update_download(window: WebviewWindow, app: AppHandle, state: State<'_, DesktopUpdateState>) -> Result<(), String> {
    allowed(&window)?;
    let _operation = state.operation.try_lock().map_err(|_| "正在处理升级，请稍后")?;
    let update = {
        let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.bytes.is_some() { return Ok(()); }
        let update = inner.update.clone().ok_or("请先检查更新")?;
        inner.status.phase = "downloading".into(); inner.status.error = None;
        inner.status.downloaded = 0; inner.status.total = None;
        update
    };
    publish(&app, &state);
    let mut last_event = Instant::now();
    let result = update.download(|size, total| {
        {
            let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.status.downloaded += size as u64; inner.status.total = total;
        }
        if last_event.elapsed() > Duration::from_millis(200) { publish(&app, &state); last_event = Instant::now(); }
    }, || {}).await;
    let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
    match result {
        Ok(bytes) => { inner.bytes = Some(bytes); inner.status.phase = "ready".into(); }
        Err(error) => { inner.status.phase = "available".into(); inner.status.error = Some(error.to_string()); }
    }
    drop(inner);
    publish(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn desktop_update_ack(window: WebviewWindow, state: State<DesktopUpdateState>, id: String, error: Option<String>) -> Result<(), String> {
    allowed(&window)?;
    state.inner.lock().unwrap_or_else(|e| e.into_inner()).preparation.acknowledge(&id, window.label(), error);
    Ok(())
}

async fn prepare_windows(app: &AppHandle, state: &DesktopUpdateState, stage: &str) -> Result<(), String> {
    let windows: Vec<_> = app.webview_windows().into_iter().filter(|(label, _)| workbench(label)).collect();
    if windows.is_empty() { return Err("没有可确认保存状态的工作窗口".into()); }
    let id = uuid::Uuid::new_v4().to_string();
    {
        let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.preparation = Preparation { id: id.clone(), pending: windows.iter().map(|(label, _)| label.clone()).collect(), error: None };
    }
    for (_, window) in &windows {
        window.emit("desktop-update:prepare", serde_json::json!({"id":id,"stage":stage})).map_err(|e| e.to_string())?;
    }
    let start = Instant::now();
    loop {
        if state.inner.lock().unwrap_or_else(|e| e.into_inner()).preparation.result()? { return Ok(()); }
        if start.elapsed() > Duration::from_secs(25) { return Err("工作窗口未确认保存或关闭，请稍后重试".into()); }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[tauri::command]
pub async fn desktop_update_install(window: WebviewWindow, app: AppHandle, state: State<'_, DesktopUpdateState>) -> Result<(), String> {
    allowed(&window)?;
    let _operation = state.operation.try_lock().map_err(|_| "正在处理升级，请稍后")?;
    {
        let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.begin_preparation()?;
    }
    publish(&app, &state);
    let result = async {
        validate_install_location()?;
        prepare_windows(&app, &state, "save").await?;
        prepare_windows(&app, &state, "close").await?;
        let (update, bytes) = {
            let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
            if !inner.tasks.is_empty() { return Err("还有任务正在运行".into()); }
            inner.status.phase = "installing".into();
            (inner.update.clone().ok_or("更新信息已失效")?, inner.bytes.take().ok_or("更新包已失效")?)
        };
        publish(&app, &state);
        let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let windows = app.webview_windows().into_iter().filter(|(label, _)| workbench(label)).map(|(label, window)| {
            if let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) {
                let _ = std::fs::write(root.join(format!("window-state-{label}.json")), serde_json::json!({"x":position.x,"y":position.y,"width":size.width,"height":size.height}).to_string());
            }
            let cwd = super::workspace::workspace_for_window(&label);
            (label, cwd)
        }).collect();
        let resume = Resume { version: update.version.clone(), windows };
        std::fs::write(root.join("updater-relaunch.json"), serde_json::to_vec(&resume).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        // Windows updater 会直接退出进程，不能只依赖 RunEvent::Exit 回收子进程。
        super::mcp::reap_all_stdio_processes();
        update.install(&bytes).map_err(|e| e.to_string())?;
        #[cfg(not(target_os = "windows"))]
        app.restart();
        #[allow(unreachable_code)]
        Ok::<(), String>(())
    }.await;
    if let Err(error) = result {
        if let Ok(root) = app.path().app_data_dir() { let _ = std::fs::remove_file(root.join("updater-relaunch.json")); }
        let mut inner = state.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.status.phase = if inner.bytes.is_some() { "ready" } else { "available" }.into();
        inner.status.error = Some(error.clone());
        drop(inner);
        publish(&app, &state);
        return Err(error);
    }
    Ok(())
}

fn validate_install_location() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    if exe.starts_with("/Volumes") { return Err("请先将韭菜盒子安装到应用程序目录，再进行升级".into()); }
    #[cfg(target_os = "windows")]
    if !exe.parent().is_some_and(|path| path.join("uninstall.exe").is_file()) {
        return Err("便携版或未知安装类型，请先通过官方安装器安装韭菜盒子".into());
    }
    let _ = exe;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    async fn download_fixture(corrupt: bool, announced: &str) -> Result<Vec<u8>, tauri_plugin_updater::Error> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let signature = include_str!("fixtures/updater.sig").trim();
        let manifest = serde_json::json!({"version":announced,"url":format!("http://{address}/artifact"),"signature":signature}).to_string();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(2) {
                let mut stream = stream.unwrap();
                let mut request = [0u8; 4096];
                let length = stream.read(&mut request).unwrap();
                let body = if String::from_utf8_lossy(&request[..length]).starts_with("GET /artifact") {
                    if corrupt { b"tampered updater package".to_vec() } else { b"updater signature fixture".to_vec() }
                } else { manifest.as_bytes().to_vec() };
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                stream.write_all(&body).unwrap();
            }
        });
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        // 仅隔离测试允许 HTTP；正式配置及入口校验始终要求 HTTPS。
        context.config_mut().plugins.0.insert("updater".into(), serde_json::json!({
            "pubkey":include_str!("../../updater.pub").trim(), "endpoints":[format!("http://{address}/manifest")],
            "dangerousInsecureTransportProtocol":true,"requireSignedVersion":true
        }));
        let app = tauri::test::mock_builder().plugin(tauri_plugin_updater::Builder::new().build()).build(context).unwrap();
        let update = app.updater().unwrap().check().await?.unwrap();
        update.download(|_, _| {}, || {}).await
    }

    // 只由隔离原生升级任务调用：真实包、真实签名和官方安装器，不接触用户目录。
    #[tokio::test]
    #[ignore = "requires isolated installed baseline and signed release package"]
    async fn native_release_upgrade() {
        let executable = std::path::PathBuf::from(std::env::var("JC_UPGRADE_INSTALLED_EXE").unwrap());
        let artifact = std::path::PathBuf::from(std::env::var("JC_UPGRADE_PACKAGE").unwrap());
        assert!(executable.is_file() && artifact.is_file());
        let version = std::env::var("JC_UPGRADE_VERSION").unwrap();
        let old_version = std::env::var("JC_UPGRADE_OLD_VERSION").unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let signature = std::fs::read_to_string(format!("{}.sig", artifact.display())).unwrap();
        let manifest = serde_json::json!({"version":version,"url":format!("http://{address}/artifact"),"signature":signature.trim()}).to_string();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(2) {
                let mut stream = stream.unwrap();
                let mut request = [0u8; 4096];
                let length = stream.read(&mut request).unwrap();
                let body = if String::from_utf8_lossy(&request[..length]).starts_with("GET /artifact") {
                    std::fs::read(&artifact).unwrap()
                } else { manifest.as_bytes().to_vec() };
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
                stream.write_all(&body).unwrap();
            }
        });
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.package_info_mut().version = old_version.parse().unwrap();
        context.config_mut().plugins.0.insert("updater".into(), serde_json::json!({
            "pubkey":include_str!("../../updater.pub").trim(), "endpoints":[format!("http://{address}/manifest")],
            "dangerousInsecureTransportProtocol":true,"requireSignedVersion":true,
            "windows":{"installMode":"quiet"}
        }));
        let app = tauri::test::mock_builder().plugin(tauri_plugin_updater::Builder::new().build()).build(context).unwrap();
        let builder = app.updater_builder().executable_path(&executable).restart_after_install(false);
        #[cfg(target_os = "windows")]
        let builder = builder.installer_arg(format!("/D={}", executable.parent().unwrap().display()));
        let update = builder.build().unwrap().check().await.unwrap().unwrap();
        assert_eq!(update.version, version);
        let bytes = update.download(|_, _| {}, || {}).await.unwrap();
        update.install(&bytes).unwrap();
    }

    #[tokio::test]
    async fn official_updater_download_verifies_real_signature_and_bound_version() {
        assert_eq!(download_fixture(false, "2.2.19").await.unwrap(), b"updater signature fixture");
        assert!(download_fixture(true, "2.2.19").await.is_err());
        assert!(download_fixture(false, "9.9.9").await.is_err());
    }
    #[test]
    fn stale_unknown_and_duplicate_window_acks_never_release_other_windows() {
        let mut p = Preparation { id: "save-2".into(), pending: ["main".into(), "ws-one".into()].into(), error: None };
        p.acknowledge("save-1", "main", None);
        p.acknowledge("save-2", "screenshot", None);
        assert_eq!(p.result(), Ok(false));
        p.acknowledge("save-2", "main", None);
        p.acknowledge("save-2", "main", None);
        assert_eq!(p.result(), Ok(false));
        p.acknowledge("save-2", "ws-one", Some("保存失败".into()));
        assert_eq!(p.result(), Err("保存失败".into()));
    }
    #[test]
    fn admission_and_preparation_share_one_atomic_gate_across_windows() {
        let mut inner = Inner::default();
        assert!(inner.begin_preparation().is_err());
        inner.bytes = Some(vec![1]);
        let task = inner.begin_task("ws-other").unwrap();
        assert!(inner.begin_preparation().is_err());
        assert_eq!(inner.tasks.len(), 1);
        inner.tasks.remove(&task);
        inner.begin_preparation().unwrap();
        assert!(inner.begin_task("main").is_err());
        assert!(inner.begin_task("native").is_err());
        inner.status.phase = "ready".into(); // 保存失败后恢复准入。
        assert!(inner.begin_task("main").is_ok());
    }

    #[test]
    fn installation_blocks_new_work_but_download_does_not() {
        assert!(blocked("preparing") && blocked("installing"));
        assert!(!blocked("downloading") && !blocked("ready"));
        assert!(!workbench("screenshot") && workbench("win-project"));
    }
    #[test]
    fn missing_or_invalid_updater_config_returns_error_without_panicking() {
        assert!(validate_config(None).is_err());
        assert!(validate_config(Some(&serde_json::json!({}))).is_err());
        assert!(validate_config(Some(&serde_json::json!({"pubkey":"invalid", "endpoints":["http://example.com"]}))).is_err());
        let config: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert!(validate_config(config["plugins"].get("updater")).is_ok());
    }
}
