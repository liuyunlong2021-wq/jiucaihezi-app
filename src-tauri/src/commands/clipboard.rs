#[cfg(not(any(target_os = "ios", target_os = "android")))]
#[tauri::command]
pub fn write_clipboard_text(text: String) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("剪贴板不可用: {e}"))?;
    clipboard
        .set_text(&text)
        .map_err(|e| format!("写入失败: {e}"))?;
    Ok(())
}

#[cfg(any(target_os = "ios", target_os = "android"))]
#[tauri::command]
pub fn write_clipboard_text(_text: String) -> Result<(), String> {
    Err("移动端系统剪贴板尚未接入".to_string())
}
