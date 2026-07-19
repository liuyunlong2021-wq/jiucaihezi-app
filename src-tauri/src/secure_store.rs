use keyring::Entry;

const KEYCHAIN_SERVICE: &str = "com.jiucaihezi.app";
const KEYCHAIN_ACCOUNT: &str = "primary-api-key";
const GATEWAY_SESSION_ACCOUNT: &str = "gateway-session-token";

/// CLI tools (jc_media.py etc.) 读取 Key 的文件路径
fn cli_key_file_path() -> std::path::PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home).join(".jiucaihezi").join(".jc_api_key")
}

/// 将 Key 同步写入 ~/.jiucaihezi/.jc_api_key，供 CLI 工具读取
fn sync_key_to_cli_file(key: &str) {
    let path = cli_key_file_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, key.trim());
    // 设置权限 600（仅 owner 可读写）
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
}

/// 删除 CLI Key 文件（清除 Key 时）
fn clear_cli_key_file() {
    let path = cli_key_file_path();
    let _ = std::fs::remove_file(&path);
}

fn entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|error| error.to_string())
}

fn gateway_session_entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, GATEWAY_SESSION_ACCOUNT).map_err(|error| error.to_string())
}

fn mcp_oauth_entry(server_id: &str) -> Result<Entry, String> {
    let id = server_id.trim();
    if id.is_empty() || !id.chars().all(|char| char.is_ascii_alphanumeric() || char == '-' || char == '_') {
        return Err("无效的 MCP server id".to_string());
    }
    Entry::new(KEYCHAIN_SERVICE, &format!("mcp-oauth-{id}")).map_err(|error| error.to_string())
}

fn mcp_server_secret_entry(server_id: &str) -> Result<Entry, String> {
    let id = server_id.trim();
    if id.is_empty() || !id.chars().all(|char| char.is_ascii_alphanumeric() || char == '-' || char == '_') {
        return Err("无效的 MCP server id".to_string());
    }
    Entry::new(KEYCHAIN_SERVICE, &format!("mcp-server-secret-{id}")).map_err(|error| error.to_string())
}

fn get_entry_value(entry: Entry) -> Result<Option<String>, String> {
    match entry.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn set_entry_value(entry: Entry, value: String, clear: fn() -> Result<(), String>) -> Result<(), String> {
    let clean = value.trim();
    if clean.is_empty() {
        return clear();
    }
    entry.set_password(clean).map_err(|error| error.to_string())
}

fn clear_entry_value(entry: Entry) -> Result<(), String> {
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn get_api_key() -> Result<Option<String>, String> {
    get_entry_value(entry()?)
}

/// 兜底：直接从 CLI 文件读取 Key（Skill 同款路径）
/// 用于 Keychain 不可用时的降级方案
#[tauri::command]
pub fn get_cli_api_key() -> Result<Option<String>, String> {
    let path = cli_key_file_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            let trimmed = content.trim().to_string();
            if trimmed.is_empty() { Ok(None) } else { Ok(Some(trimmed)) }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn set_api_key(api_key: String) -> Result<(), String> {
    let result = set_entry_value(entry()?, api_key.clone(), clear_api_key);
    if result.is_ok() {
        sync_key_to_cli_file(&api_key);
    }
    result
}

#[tauri::command]
pub fn clear_api_key() -> Result<(), String> {
    clear_cli_key_file();
    clear_entry_value(entry()?)
}

#[tauri::command]
pub fn get_gateway_session_token() -> Result<Option<String>, String> {
    get_entry_value(gateway_session_entry()?)
}

#[tauri::command]
pub fn set_gateway_session_token(token: String) -> Result<(), String> {
    set_entry_value(gateway_session_entry()?, token, clear_gateway_session_token)
}

#[tauri::command]
pub fn clear_gateway_session_token() -> Result<(), String> {
    clear_entry_value(gateway_session_entry()?)
}

#[tauri::command]
pub fn get_mcp_oauth_credential(server_id: String) -> Result<Option<String>, String> {
    get_entry_value(mcp_oauth_entry(&server_id)?)
}

#[tauri::command]
pub fn set_mcp_oauth_credential(server_id: String, value: String) -> Result<(), String> {
    let entry = mcp_oauth_entry(&server_id)?;
    let clean = value.trim();
    if clean.is_empty() {
        return clear_entry_value(entry);
    }
    entry.set_password(clean).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_mcp_oauth_credential(server_id: String) -> Result<(), String> {
    clear_entry_value(mcp_oauth_entry(&server_id)?)
}

#[tauri::command]
pub fn get_mcp_server_secret(server_id: String) -> Result<Option<String>, String> {
    get_entry_value(mcp_server_secret_entry(&server_id)?)
}

#[tauri::command]
pub fn set_mcp_server_secret(server_id: String, value: String) -> Result<(), String> {
    let entry = mcp_server_secret_entry(&server_id)?;
    let clean = value.trim();
    if clean.is_empty() {
        return clear_entry_value(entry);
    }
    entry.set_password(clean).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_mcp_server_secret(server_id: String) -> Result<(), String> {
    clear_entry_value(mcp_server_secret_entry(&server_id)?)
}
