use crate::commands::tools::resolve_local_binary;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tokio::process::Command;
use tokio::sync::Mutex;

static MLX_PROCESS: LazyLock<Mutex<Option<tokio::process::Child>>> =
    LazyLock::new(|| Mutex::new(None));

fn parse_api_base(api_base: &str) -> Result<(String, u16), String> {
    let raw = api_base.trim().trim_end_matches('/');
    let authority = raw
        .strip_prefix("http://")
        .ok_or_else(|| "MLX 只支持 http:// 本机服务".to_string())?;
    if authority.contains('/') || authority.contains('?') || authority.contains('#') {
        return Err("MLX 服务地址格式无效".to_string());
    }
    let (host, port) = authority
        .rsplit_once(':')
        .map(|(host, port)| (host, port.parse::<u16>().map_err(|_| "MLX 端口无效".to_string())))
        .unwrap_or((authority, Ok(8081)));
    if !matches!(host, "127.0.0.1" | "localhost" | "[::1]") {
        return Err("MLX 首版仅支持本机回环地址".to_string());
    }
    Ok((host.to_string(), port?))
}

fn find_mlx_server(model_path: &str) -> Option<PathBuf> {
    let model = Path::new(model_path);
    for ancestor in model.ancestors().take(6) {
        for env_dir in [".venv", "venv"] {
            let candidate = ancestor.join(env_dir).join("bin/mlx_lm.server");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let candidate = resolve_local_binary("mlx_lm.server");
    candidate.is_file().then_some(candidate)
}

#[tauri::command]
pub async fn start_mlx_service(model_path: String, api_base: String) -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (model_path, api_base);
        return Err("MLX 自动启动仅支持 Apple Silicon Mac".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let model_path = model_path.trim();
        if model_path.is_empty() {
            return Err("请先填写 MLX 模型路径或仓库 ID".to_string());
        }
        let (host, port) = parse_api_base(&api_base)?;
        let endpoint = format!("http://{host}:{port}/v1/models");
        if let Ok(response) = reqwest::get(&endpoint).await {
            if response.status().is_success() {
                return Ok("already_running".to_string());
            }
        }
        {
            let mut process = MLX_PROCESS.lock().await;
            if let Some(child) = process.as_mut() {
                match child.try_wait() {
                    Ok(None) => return Ok("already_running".to_string()),
                    Ok(Some(_)) | Err(_) => *process = None,
                }
            }
        }

        let executable = find_mlx_server(model_path)
            .ok_or_else(|| "找不到 mlx_lm.server，请先安装 MLX 环境".to_string())?;
        let child = Command::new(&executable)
            .args(["--model", model_path, "--host", &host, "--port", &port.to_string()])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("无法启动 MLX 服务: {error}"))?;
        *MLX_PROCESS.lock().await = Some(child);

        for _ in 0..120 {
            if let Ok(response) = reqwest::get(&endpoint).await {
                if response.status().is_success() {
                    return Ok("started".to_string());
                }
            }
            {
                let mut process = MLX_PROCESS.lock().await;
                if let Some(child) = process.as_mut() {
                    if child.try_wait().ok().flatten().is_some() {
                        *process = None;
                        return Err("MLX 服务启动后立即退出，请检查模型路径和依赖".to_string());
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }

        if let Some(mut child) = MLX_PROCESS.lock().await.take() {
            let _ = child.kill().await;
        }
        Err("MLX 服务启动超时，请检查模型大小、内存和端口".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::parse_api_base;

    #[test]
    fn only_loopback_http_addresses_are_accepted() {
        assert_eq!(parse_api_base("http://127.0.0.1:8081").unwrap().1, 8081);
        assert!(parse_api_base("https://127.0.0.1:8081").is_err());
        assert!(parse_api_base("http://192.168.1.2:8081").is_err());
    }
}

pub fn stop_mlx_service() {
    if let Ok(mut process) = MLX_PROCESS.try_lock() {
        if let Some(child) = process.as_mut() {
            let _ = child.start_kill();
        }
        *process = None;
    }
}
