use serde::Deserialize;
use std::path::PathBuf;

use crate::commands::opencode::user_home_dir;

fn jiucaihezi_home_dir() -> Result<PathBuf, String> {
    let home = user_home_dir().ok_or_else(|| "无法读取用户目录".to_string())?;
    Ok(home.join(".jiucaihezi"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WriteSessionTokenInput {
    token: String,
}

/// 从 ~/.jiucaihezi/.session 读取 session token（文件权限 0600，仅本用户可读）
#[tauri::command]
pub fn read_session_token() -> Result<String, String> {
    let path = jiucaihezi_home_dir()?.join(".session");
    if !path.exists() {
        return Ok(String::new());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&path) {
            let mode = meta.permissions().mode() & 0o777;
            if mode != 0o600 {
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            }
        }
    }
    std::fs::read_to_string(&path)
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("读取 session token 失败: {}", e))
}

/// 将 session token 写入 ~/.jiucaihezi/.session（文件权限 0600），原子写入
#[tauri::command]
pub fn write_session_token(input: WriteSessionTokenInput) -> Result<(), String> {
    let path = jiucaihezi_home_dir()?.join(".session");
    let token = input.token.trim().to_string();
    if token.is_empty() {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("删除 session token 失败: {}", e))?;
        }
        return Ok(());
    }
    let tmp = path.with_extension(".session.tmp");
    std::fs::write(&tmp, &token).map_err(|e| format!("写入 session token 失败: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp, &path).map_err(|e| format!("保存 session token 失败: {}", e))?;
    Ok(())
}
