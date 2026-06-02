use keyring::Entry;

const KEYCHAIN_SERVICE: &str = "com.jiucaihezi.app";
const KEYCHAIN_ACCOUNT: &str = "primary-api-key";
const GATEWAY_SESSION_ACCOUNT: &str = "gateway-session-token";

fn entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|error| error.to_string())
}

fn gateway_session_entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, GATEWAY_SESSION_ACCOUNT).map_err(|error| error.to_string())
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

#[tauri::command]
pub fn set_api_key(api_key: String) -> Result<(), String> {
    set_entry_value(entry()?, api_key, clear_api_key)
}

#[tauri::command]
pub fn clear_api_key() -> Result<(), String> {
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
