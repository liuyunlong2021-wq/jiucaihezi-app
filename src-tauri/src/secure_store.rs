use keyring::Entry;

const KEYCHAIN_SERVICE: &str = "com.jiucaihezi.app";
const KEYCHAIN_ACCOUNT: &str = "primary-api-key";
const GATEWAY_SESSION_ACCOUNT: &str = "gateway-session-token";
const COMFY_WORKFLOW_ACCOUNT: &str = "comfy-workflow-api-key";
const REMOTE_BRIDGE_IDENTITY_ACCOUNT: &str = "remote-bridge-identity-v1";
const REMOTE_BRIDGE_DEVICES_ACCOUNT: &str = "remote-bridge-devices-v1";
const MOBILE_REMOTE_IDENTITY_ACCOUNT: &str = "mobile-remote-identity-v1";
const MOBILE_REMOTE_CREDENTIAL_ACCOUNT: &str = "mobile-remote-credential-v1";

/// CLI tools (jc_media.py etc.) 读取 Key 的文件路径
fn cli_key_file_path() -> std::path::PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    std::path::PathBuf::from(home)
        .join(".jiucaihezi")
        .join(".jc_api_key")
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

fn comfy_workflow_entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, COMFY_WORKFLOW_ACCOUNT).map_err(|error| error.to_string())
}

fn remote_bridge_entry(account: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, account).map_err(|error| error.to_string())
}

pub(crate) fn get_remote_bridge_identity() -> Result<Option<String>, String> {
    get_entry_value(remote_bridge_entry(REMOTE_BRIDGE_IDENTITY_ACCOUNT)?)
}

pub(crate) fn set_remote_bridge_identity(value: &str) -> Result<(), String> {
    remote_bridge_entry(REMOTE_BRIDGE_IDENTITY_ACCOUNT)?
        .set_password(value)
        .map_err(|error| error.to_string())
}

pub(crate) fn get_remote_bridge_devices() -> Result<Option<String>, String> {
    get_entry_value(remote_bridge_entry(REMOTE_BRIDGE_DEVICES_ACCOUNT)?)
}

pub(crate) fn set_remote_bridge_devices(value: &str) -> Result<(), String> {
    remote_bridge_entry(REMOTE_BRIDGE_DEVICES_ACCOUNT)?
        .set_password(value)
        .map_err(|error| error.to_string())
}

/// 手机控制器的设备身份与配对凭证。
///
/// 与 Desktop 那两条区分开：这里存的是本机的设备私钥和 Desktop 签发的 token，
/// 既不是 Desktop 的长期身份，也不含 Desktop 私钥（合同 §4）。
pub(crate) fn get_mobile_remote_identity() -> Result<Option<String>, String> {
    get_entry_value(remote_bridge_entry(MOBILE_REMOTE_IDENTITY_ACCOUNT)?)
}

pub(crate) fn set_mobile_remote_identity(value: &str) -> Result<(), String> {
    remote_bridge_entry(MOBILE_REMOTE_IDENTITY_ACCOUNT)?
        .set_password(value)
        .map_err(|error| error.to_string())
}

pub(crate) fn get_mobile_remote_credential() -> Result<Option<String>, String> {
    get_entry_value(remote_bridge_entry(MOBILE_REMOTE_CREDENTIAL_ACCOUNT)?)
}

pub(crate) fn set_mobile_remote_credential(value: &str) -> Result<(), String> {
    remote_bridge_entry(MOBILE_REMOTE_CREDENTIAL_ACCOUNT)?
        .set_password(value)
        .map_err(|error| error.to_string())
}

pub(crate) fn clear_mobile_remote_credential() -> Result<(), String> {
    clear_entry_value(remote_bridge_entry(MOBILE_REMOTE_CREDENTIAL_ACCOUNT)?)
}

fn mcp_oauth_entry(server_id: &str) -> Result<Entry, String> {
    let id = server_id.trim();
    if id.is_empty()
        || !id
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || char == '-' || char == '_')
    {
        return Err("无效的 MCP server id".to_string());
    }
    Entry::new(KEYCHAIN_SERVICE, &format!("mcp-oauth-{id}")).map_err(|error| error.to_string())
}

fn mcp_server_secret_entry(server_id: &str) -> Result<Entry, String> {
    let id = server_id.trim();
    if id.is_empty()
        || !id
            .chars()
            .all(|char| char.is_ascii_alphanumeric() || char == '-' || char == '_')
    {
        return Err("无效的 MCP server id".to_string());
    }
    Entry::new(KEYCHAIN_SERVICE, &format!("mcp-server-secret-{id}"))
        .map_err(|error| error.to_string())
}

fn get_entry_value(entry: Entry) -> Result<Option<String>, String> {
    match entry.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn set_entry_value(
    entry: Entry,
    value: String,
    clear: fn() -> Result<(), String>,
) -> Result<(), String> {
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
    #[cfg(target_os = "ios")]
    return get_api_key();

    #[cfg(not(target_os = "ios"))]
    {
        let path = cli_key_file_path();
        match std::fs::read_to_string(&path) {
            Ok(content) => {
                let trimmed = content.trim().to_string();
                if trimmed.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(trimmed))
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
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
pub fn get_comfy_workflow_api_key() -> Result<Option<String>, String> {
    get_entry_value(comfy_workflow_entry()?)
}

#[tauri::command]
pub fn set_comfy_workflow_api_key(value: String) -> Result<(), String> {
    set_entry_value(comfy_workflow_entry()?, value, clear_comfy_workflow_api_key)
}

#[tauri::command]
pub fn clear_comfy_workflow_api_key() -> Result<(), String> {
    clear_entry_value(comfy_workflow_entry()?)
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

/// Reuse the durable CLI credential location; task JSON contains only a digest reference.
fn media_key_directory() -> std::path::PathBuf {
    cli_key_file_path().parent().unwrap().join("download-keys")
}

fn retain_download_key_at(root: &std::path::Path, key: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let key = key.trim();
    if key.is_empty() { return Err("缺少任务提交密钥".into()); }
    if std::fs::symlink_metadata(root).is_ok_and(|m| m.file_type().is_symlink()) { return Err("下载凭据目录不能是符号链接".into()); }
    std::fs::create_dir_all(root).map_err(|_| "创建下载凭据目录失败")?;
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700)).map_err(|_| "保护下载凭据目录失败")?; }
    let reference = format!("{:x}", Sha256::digest(key.as_bytes()));
    let path = root.join(&reference);
    if path.exists() { read_download_key_at(root, &reference)?; return Ok(reference); }
    let staged = root.join(format!(".{reference}.{}.tmp", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut file = options.open(&staged).map_err(|_| "保存任务下载密钥失败")?;
    use std::io::Write;
    file.write_all(key.as_bytes()).and_then(|_| file.sync_all()).map_err(|_| "保存任务下载密钥失败")?;
    drop(file);
    // Link publishes a fully written credential without replacing an existing file.
    let result = std::fs::hard_link(&staged, &path);
    let _ = std::fs::remove_file(staged);
    if result.is_err() { read_download_key_at(root, &reference)?; }
    Ok(reference)
}

#[tauri::command]
pub fn retain_media_download_key(api_key: String) -> Result<String, String> {
    retain_download_key_at(&media_key_directory(), &api_key)
}

pub(crate) fn media_download_key(reference: &str) -> Result<String, String> {
    read_download_key_at(&media_key_directory(), reference)
}

fn read_download_key_at(root: &std::path::Path, reference: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    if reference.len() != 64 || !reference.bytes().all(|byte| byte.is_ascii_hexdigit()) { return Err("无效的下载密钥引用".into()); }
    let path = root.join(reference);
    if std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) { return Err("下载凭据不能是符号链接".into()); }
    let key = std::fs::read_to_string(path).map_err(|_| "任务提交密钥已不可用，请恢复对应密钥后重试下载")?;
    if format!("{:x}", Sha256::digest(key.as_bytes())) != reference { return Err("任务下载密钥校验失败".into()); }
    Ok(key)
}

#[cfg(test)]
mod download_key_tests {
    use super::*;
    #[test]
    fn references_survive_a_key_switch_without_putting_credentials_in_tasks() {
        let root = tempfile::TempDir::new().unwrap();
        let first = retain_download_key_at(root.path(), "local-first").unwrap();
        let second = retain_download_key_at(root.path(), "local-second").unwrap();
        assert_ne!(first, second);
        assert_eq!(read_download_key_at(root.path(), &first).unwrap(), "local-first");
        assert_eq!(retain_download_key_at(root.path(), "local-first").unwrap(), first);
        assert!(read_download_key_at(root.path(), "../escape").is_err());
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; assert_eq!(std::fs::metadata(root.path().join(first)).unwrap().permissions().mode() & 0o777, 0o600); }
    }
}

#[tauri::command]
pub fn get_media_download_key(reference: String) -> Result<String, String> {
    media_download_key(&reference)
}
