use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("你好，{}！韭菜盒子桌面版已就绪。", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 确保应用数据目录存在
            let app_data = app.path().app_data_dir().expect("failed to get app data dir");
            std::fs::create_dir_all(&app_data).ok();
            // 创建 vault 子目录
            std::fs::create_dir_all(app_data.join("vault")).ok();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
