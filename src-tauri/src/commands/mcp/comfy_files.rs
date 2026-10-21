//! Local private staging only. All ComfyUI network operations belong to the official MCP.
use base64::{engine::general_purpose, Engine as _};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

fn write_input(root: &Path, id: &str, name: &str, data: &str) -> Result<String, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "ComfyUI 工作目录 ID 无效")?;
    let allowed = name == "workflow.json" || name == "result.marker" ||
        (name.starts_with("reference-") && [".png", ".jpg", ".webp"].iter().any(|ext| name.ends_with(ext)));
    if !allowed || name.contains(['/', '\\']) || name.contains("..") {
        return Err("ComfyUI 输入文件名无效".into());
    }
    let bytes = general_purpose::STANDARD.decode(data).map_err(|_| "ComfyUI 输入数据无效")?;
    if name.starts_with("reference-") && bytes.len() > 20 * 1024 * 1024 { return Err("参考图超过 20 MB 上限".into()); }
    let dir = root.join(id);
    if dir.symlink_metadata().is_ok_and(|m| m.file_type().is_symlink()) { return Err("ComfyUI 工作目录不能是符号链接".into()); }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    let path = dir.join(name);
    if name == "result.marker" && path.is_file() { return Ok(path.to_string_lossy().into_owned()); }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).map_err(|e| format!("创建 ComfyUI 输入失败: {e}"))?;
    if let Err(error) = file.write_all(&bytes) {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err(error.to_string());
    }
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn comfy_mcp_write_input(app: tauri::AppHandle, id: String, name: String, data_base64: String) -> Result<String, String> {
    let root: PathBuf = app.path().app_data_dir().map_err(|e| e.to_string())?.join("comfy-mcp");
    write_input(&root, &id, &name, &data_base64)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_staging_rejects_escape_and_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        assert!(write_input(dir.path(), "../x", "workflow.json", "e30=").is_err());
        assert!(write_input(dir.path(), &id, "../workflow.json", "e30=").is_err());
        let file = write_input(dir.path(), &id, "workflow.json", "e30=").unwrap();
        assert_eq!(std::fs::read(&file).unwrap(), b"{}");
        assert!(write_input(dir.path(), &id, "workflow.json", "e30=").is_err());
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(file).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }
}
