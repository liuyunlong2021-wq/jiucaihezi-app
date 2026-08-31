use crate::commands::tools::resolve_local_binary;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tokio::io::AsyncReadExt;
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
        .unwrap_or((authority, Ok(9523)));
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
    if let Some(home) = env::var_os("HOME") {
        for candidate in [
            PathBuf::from(&home).join(".jiucaihezi/local-mlx/venv/bin/mlx_lm.server"),
            PathBuf::from(&home).join("MLX/.venv/bin/mlx_lm.server"),
        ] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let candidate = resolve_local_binary("mlx_lm.server");
    candidate.is_file().then_some(candidate)
}

fn resolve_default_model_path() -> Option<String> {
    let home = env::var_os("HOME")?;
    let candidates = [
        PathBuf::from(&home).join("MLX/Qwen3.8-27B-Uncensored-MLX/6-bit"),
        PathBuf::from(&home).join("MLX/Qwen3.8-27B-Uncensored-MLX"),
    ];
    candidates
        .into_iter()
        .find(|candidate| candidate.is_dir())
        .map(|path| path.to_string_lossy().into_owned())
}

fn normalized_model_name(value: &str) -> String {
    value.to_lowercase().chars().filter(|ch| ch.is_ascii_alphanumeric()).collect()
}

fn requested_model_name(model_path: &str) -> String {
    let path = Path::new(model_path);
    let last = path.file_name().and_then(|name| name.to_str()).unwrap_or(model_path);
    if matches!(last.to_ascii_lowercase().as_str(), "4-bit" | "6-bit" | "8-bit" | "bf16" | "q4" | "q8") {
        path.parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            .unwrap_or(last)
            .to_string()
    } else {
        last.to_string()
    }
}

async fn terminate_process_on_port(port: u16) {
    let output = Command::new("/usr/sbin/lsof")
        .args(["-ti", &format!("tcp:{port}")])
        .output()
        .await;
    let Ok(output) = output else { return };
    for pid in String::from_utf8_lossy(&output.stdout).lines().filter_map(|line| line.trim().parse::<i32>().ok()) {
        let _ = Command::new("/bin/kill").args(["-TERM", &pid.to_string()]).status().await;
    }
    for _ in 0..10 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_err() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

async fn endpoint_matches_model(endpoint: &str, model_path: &str) -> bool {
    let Ok(response) = reqwest::get(endpoint).await else { return false };
    if !response.status().is_success() { return false }
    let Ok(body) = response.text().await else { return false };
    let requested = normalized_model_name(&requested_model_name(model_path));
    serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| value.get("data").and_then(|data| data.as_array()).cloned())
        .map(|models| models.iter().any(|model| {
            model.get("id").and_then(|id| id.as_str()).map(|id| {
                let actual = normalized_model_name(id);
                actual.contains(&requested) || requested.contains(&actual)
            }).unwrap_or(false)
        }))
        .unwrap_or(false)
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
        let model_path = model_path.trim().to_string();
        let model_path = if model_path.is_empty() {
            resolve_default_model_path().ok_or_else(|| {
                "未找到默认模型 Qwen3.8-27B-Uncensored-MLX，请先从 Hugging Face 安装。".to_string()
            })?
        } else {
            model_path
        };
        let (host, port) = parse_api_base(&api_base)?;
        let endpoint = format!("http://{host}:{port}/v1/models");
        let mut replaced_existing = false;
        if endpoint_matches_model(&endpoint, &model_path).await {
            return Ok("already_running".to_string());
        }
        if reqwest::get(&endpoint).await.is_ok() {
            terminate_process_on_port(port).await;
            replaced_existing = true;
        }
        {
            let mut process = MLX_PROCESS.lock().await;
            if let Some(child) = process.as_mut() {
                match child.try_wait() {
                    Ok(None) if !replaced_existing => return Ok("already_running".to_string()),
                    Ok(None) => {
                        let _ = child.start_kill();
                        *process = None;
                    }
                    Ok(Some(_)) | Err(_) => *process = None,
                }
            }
        }

        let executable = find_mlx_server(&model_path)
            .ok_or_else(|| "找不到 mlx_lm.server，请先安装 MLX 环境".to_string())?;
        let child = Command::new(&executable)
            .args(["--model", &model_path, "--host", &host, "--port", &port.to_string()])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            // Do not pipe startup logs without a concurrent reader: large MLX models can fill the pipe and deadlock Python.
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| format!("无法启动 MLX 服务: {error}"))?;
        *MLX_PROCESS.lock().await = Some(child);

        for _ in 0..1200 {
            if endpoint_matches_model(&endpoint, &model_path).await {
                return Ok("started".to_string());
            }
            {
                let mut process = MLX_PROCESS.lock().await;
                if let Some(child) = process.as_mut() {
                    if child.try_wait().ok().flatten().is_some() {
                        let mut exited = process.take().expect("MLX child exists");
                        let mut stderr = String::new();
                        if let Some(mut pipe) = exited.stderr.take() {
                            let _ = pipe.read_to_string(&mut stderr).await;
                        }
                        let detail = stderr.trim();
                        return Err(if detail.is_empty() {
                            "MLX 服务启动后立即退出，请检查模型路径和依赖".to_string()
                        } else {
                            format!("MLX 服务启动失败：{detail}")
                        });
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
        assert_eq!(parse_api_base("http://127.0.0.1:9523").unwrap().1, 9523);
        assert_eq!(parse_api_base("http://127.0.0.1").unwrap().1, 9523);
        assert!(parse_api_base("https://127.0.0.1:9523").is_err());
        assert!(parse_api_base("http://192.168.1.2:9523").is_err());
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
