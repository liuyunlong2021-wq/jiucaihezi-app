use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGeneratedFileInput {
    pub path: String,
    pub data_base64: String,
    pub keep_both: Option<bool>,
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
pub fn save_generated_file(
    input: SaveGeneratedFileInput,
) -> Result<SaveGeneratedFileOutput, String> {
    let path = PathBuf::from(&input.path);
    let bytes = general_purpose::STANDARD
        .decode(input.data_base64.as_bytes())
        .map_err(|e| format!("导出数据解码失败: {}", e))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建保存目录失败: {}", e))?;
    }
    let path = if input.keep_both.unwrap_or(false) {
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("韭菜盒子作品");
        let extension = path.extension().and_then(|value| value.to_str());
        let parent = path.parent().ok_or_else(|| "保存路径无效".to_string())?;
        let mut index = 0;
        loop {
            let filename = match (index, extension) {
                (0, Some(extension)) => format!("{}.{}", stem, extension),
                (0, None) => stem.to_string(),
                (_, Some(extension)) => format!("{} ({}).{}", stem, index, extension),
                (_, None) => format!("{} ({})", stem, index),
            };
            let candidate = parent.join(filename);
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&candidate)
            {
                Ok(mut file) => {
                    file.write_all(&bytes)
                        .map_err(|e| format!("保存文件失败: {}", e))?;
                    break candidate;
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => index += 1,
                Err(error) => return Err(format!("保存文件失败: {}", error)),
            }
        }
    } else {
        std::fs::write(&path, &bytes).map_err(|e| format!("保存文件失败: {}", e))?;
        path
    };
    Ok(SaveGeneratedFileOutput {
        path: path.to_string_lossy().to_string(),
        bytes_written: bytes.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keep_both_preserves_existing_generated_file() {
        let dir = std::env::temp_dir().join(format!("jc-generated-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let original = dir.join("周报.png");
        std::fs::write(&original, b"old").unwrap();

        let output = save_generated_file(SaveGeneratedFileInput {
            path: original.to_string_lossy().to_string(),
            data_base64: general_purpose::STANDARD.encode(b"new"),
            keep_both: Some(true),
        })
        .unwrap();

        assert_eq!(std::fs::read(&original).unwrap(), b"old");
        assert_eq!(std::fs::read(&output.path).unwrap(), b"new");
        assert!(output.path.ends_with("周报 (1).png"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
