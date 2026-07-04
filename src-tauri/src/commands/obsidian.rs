/// 检测 Obsidian.app 是否已安装（跨平台）
#[tauri::command]
pub fn check_obsidian_installed() -> bool {
    #[cfg(target_os = "macos")]
    {
        for path in &["/Applications/Obsidian.app", &format!("{}/Applications/Obsidian.app", std::env::var("HOME").unwrap_or_default())] {
            if std::path::Path::new(path).exists() {
                return true;
            }
        }
        false
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            for exe in &["Obsidian.exe", "obsidian.exe"] {
                if std::path::Path::new(&format!("{}\\Obsidian\\{}", local, exe)).exists() {
                    return true;
                }
            }
        }
        false
    }
    #[cfg(target_os = "linux")]
    {
        for path in &["/usr/bin/obsidian", "/usr/local/bin/obsidian", "/snap/bin/obsidian"] {
            if std::path::Path::new(path).exists() {
                return true;
            }
        }
        false
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    false
}

/// macOS Spotlight 搜索 Obsidian.app（终极回退，不依赖路径假设）
#[tauri::command]
pub fn mdfind_obsidian() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("mdfind")
            .args(["kMDItemKind == 'Application'", "-name", "Obsidian"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            return stdout.lines().next().unwrap_or("").to_string();
        }
    }
    String::new()
}
