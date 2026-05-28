use keyring::Entry;

const KEYCHAIN_SERVICE: &str = "com.jiucaihezi.app";
const KEYCHAIN_ACCOUNT: &str = "primary-api-key";

fn entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|error| error.to_string())
}

fn media_entry(key: &str) -> Result<Entry, String> {
    let account = format!("media-key-{}", key);
    Entry::new(KEYCHAIN_SERVICE, &account).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn get_api_key() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn set_api_key(api_key: String) -> Result<(), String> {
    let clean = api_key.trim();
    if clean.is_empty() {
        return clear_api_key();
    }
    entry()?.set_password(clean).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_api_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

// ── 媒体独立 Key 存储 ──

#[tauri::command]
pub fn get_media_key(key: String) -> Result<Option<String>, String> {
    match media_entry(&key)?.get_password() {
        Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
        Ok(_) => Ok(None),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn set_media_key(key: String, value: String) -> Result<(), String> {
    let clean = value.trim();
    if clean.is_empty() {
        return delete_media_key(key);
    }
    media_entry(&key)?.set_password(clean).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_media_key(key: String) -> Result<(), String> {
    match media_entry(&key)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
