use base64::{Engine as _, engine::general_purpose};
use serde::Serialize;

#[cfg(not(any(target_os = "ios", target_os = "android")))]
use arboard;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardImage {
    width: usize,
    height: usize,
    rgba_base64: String,
}

#[tauri::command]
pub fn write_clipboard_text(text: String) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    #[cfg(any(target_os = "ios", target_os = "android"))]
    return Err("移动端暂不支持原生剪贴板写入".into());
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("剪贴板不可用: {e}"))?;
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    clipboard
        .set_text(&text)
        .map_err(|e| format!("写入失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn read_clipboard_image() -> Result<Option<ClipboardImage>, String> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    return Err("移动端暂不支持原生剪贴板图片读取".into());
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("剪贴板不可用: {e}"))?;
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    match clipboard.get_image() {
        Ok(image) => {
            build_clipboard_image(image.width, image.height, image.bytes.as_ref()).map(Some)
        }
        Err(arboard::Error::ContentNotAvailable) => Ok(None),
        Err(e) => Err(format!("读取剪贴板图片失败: {e}")),
    }
}

fn build_clipboard_image(
    width: usize,
    height: usize,
    rgba: &[u8],
) -> Result<ClipboardImage, String> {
    let expected = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "剪贴板图片尺寸无效".to_string())?;
    if width == 0 || height == 0 || rgba.len() != expected {
        return Err("剪贴板图片数据无效".into());
    }
    Ok(ClipboardImage {
        width,
        height,
        rgba_base64: general_purpose::STANDARD.encode(rgba),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_native_clipboard_rgba() {
        let image = build_clipboard_image(1, 1, &[1, 2, 3, 4]).expect("valid RGBA");
        assert_eq!(image.width, 1);
        assert_eq!(image.height, 1);
        assert_eq!(image.rgba_base64, "AQIDBA==");
        assert!(build_clipboard_image(1, 1, &[1, 2, 3]).is_err());
        assert!(build_clipboard_image(0, 1, &[]).is_err());
    }
}
