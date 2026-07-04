#[tauri::command]
pub async fn plugin_install_npm(package_name: String, install_dir: String) -> Result<String, String> {
    let dir = std::path::PathBuf::from(&install_dir);
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建插件目录: {e}"))?;
    }

    let result = tokio::task::spawn_blocking(move || {
        let output = std::process::Command::new("npm")
            .args(["install", &package_name, "--prefix", &install_dir, "--no-save", "--silent"])
            .output()
            .map_err(|e| format!("npm install 失败: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("npm install 失败: {}", stderr.trim()));
        }

        Ok(install_dir)
    })
    .await
    .map_err(|e| format!("安装任务异常: {e}"))??;

    Ok(result)
}

#[tauri::command]
pub async fn plugin_read_manifest(install_dir: String) -> Result<String, String> {
    let install_path = std::path::PathBuf::from(&install_dir);
    let nm_dir = install_path.join("node_modules");
    if !nm_dir.exists() {
        return Err("node_modules 目录不存在".into());
    }

    for entry in std::fs::read_dir(&nm_dir).map_err(|e| format!("读取失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {e}"))?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
        if entry.file_name().to_string_lossy().starts_with('.') { continue; }
        if entry.file_name() == "node_modules" { continue; }

        let pkg = entry.path().join("package.json");
        if pkg.exists() {
            return std::fs::read_to_string(&pkg)
                .map_err(|e| format!("读取 package.json 失败: {e}"));
        }
    }

    Err("未找到 package.json".into())
}

#[tauri::command]
pub async fn plugin_read_config() -> Result<String, String> {
    let home = dirs_next::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let config_path = home.join(".jiucaihezi").join("plugins.json");
    if !config_path.exists() {
        return Ok(r#"{"version":1,"plugins":[]}"#.to_string());
    }
    std::fs::read_to_string(&config_path).map_err(|e| format!("读取失败: {e}"))
}

#[tauri::command]
pub async fn plugin_write_config(content: String) -> Result<(), String> {
    let home = dirs_next::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let jc_dir = home.join(".jiucaihezi");
    std::fs::create_dir_all(&jc_dir).map_err(|e| format!("创建目录失败: {e}"))?;
    std::fs::write(jc_dir.join("plugins.json"), &content).map_err(|e| format!("写入失败: {e}"))
}
