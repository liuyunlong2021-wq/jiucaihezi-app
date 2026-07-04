use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGeneratedFileInput {
    pub path: String,
    pub data_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGeneratedFileOutput {
    pub path: String,
    pub bytes_written: usize,
}

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("你好，{}！韭菜盒子桌面版已就绪。", name)
}

#[tauri::command]
pub fn save_generated_file(input: SaveGeneratedFileInput) -> Result<SaveGeneratedFileOutput, String> {
    let path = PathBuf::from(&input.path);
    let bytes = general_purpose::STANDARD
        .decode(input.data_base64.as_bytes())
        .map_err(|e| format!("导出数据解码失败: {}", e))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建保存目录失败: {}", e))?;
    }
    std::fs::write(&path, &bytes).map_err(|e| format!("保存文件失败: {}", e))?;
    Ok(SaveGeneratedFileOutput {
        path: path.to_string_lossy().to_string(),
        bytes_written: bytes.len(),
    })
}
