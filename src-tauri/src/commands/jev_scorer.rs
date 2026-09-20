//! 本地 Skill 打分器（@Jev 决策链第一层）的自动拉起。
//!
//! 和 local_mlx 不一样：这是**可选增强**。python 环境和 2.1GB 微调模型在
//! `~/.cache/jiucaihezi/jev-scorer`（不在 app 包里，也不该在），环境不全就安静地
//! 什么都不做 —— 决策链会自己降级到规则层 + 模型层（准确率 95% → 71%）。
//! 所以「没装」不是错误，只有真的 spawn 失败才回报错。
//!
//! 启动方式、变量名和 scripts/jev-scorer/start.sh 保持一致，两边可以互相接替
//! （谁先起谁占端口，另一个看到 /health 通就复用）。

use crate::skills::path_utils::resolve_home_dir;
use std::path::PathBuf;
use std::sync::LazyLock;
use tauri::Manager;
use tokio::process::Command;
use tokio::sync::Mutex;

static SCORER_PROCESS: LazyLock<Mutex<Option<tokio::process::Child>>> =
    LazyLock::new(|| Mutex::new(None));

/// 和 start.sh、`localScorer.ts` 的默认值三处一致。
const DEFAULT_PORT: u16 = 4789;

fn scorer_port() -> u16 {
    std::env::var("JEV_SCORER_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

fn scorer_home() -> PathBuf {
    std::env::var("JEV_SCORER_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| resolve_home_dir().join(".cache/jiucaihezi/jev-scorer"))
}

fn resolve_python() -> Option<PathBuf> {
    let path = std::env::var("JEV_SCORER_PYTHON")
        .map(PathBuf::from)
        .unwrap_or_else(|_| scorer_home().join("venv/bin/python"));
    path.is_file().then_some(path)
}

fn resolve_model() -> Option<PathBuf> {
    let path = std::env::var("JEV_SCORER_MODEL")
        .map(PathBuf::from)
        .unwrap_or_else(|_| scorer_home().join("model-v1"));
    path.is_dir().then_some(path)
}

/// serve.py 只有 6KB，跟着 app 走；开发时用仓库里的那份。
fn resolve_script(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app.path().resource_dir() {
        let packaged = dir.join("jev-scorer/serve.py");
        if packaged.is_file() {
            return Some(packaged);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/jev-scorer/serve.py");
    dev.is_file().then_some(dev)
}

async fn healthy() -> bool {
    let url = format!("http://127.0.0.1:{}/health", scorer_port());
    matches!(reqwest::get(url).await, Ok(response) if response.status().is_success())
}

/// 探测环境、必要时后台拉起打分服务。
///
/// 返回（都当正常结果，不是错误）：`started` / `already_running` / `unavailable`。
/// 不等待模型加载完成 —— 2.1GB 权重在 MPS 上要十几秒，等它会把界面卡住，
/// 而第一轮 @Jev 判断来不及就自己降级，比卡住强。
#[tauri::command]
pub async fn jev_scorer_ensure(app: tauri::AppHandle) -> Result<String, String> {
    if healthy().await {
        return Ok("already_running".to_string());
    }
    let (Some(python), Some(model), Some(script)) =
        (resolve_python(), resolve_model(), resolve_script(&app))
    else {
        return Ok("unavailable".to_string());
    };
    {
        let mut process = SCORER_PROCESS.lock().await;
        if let Some(child) = process.as_mut() {
            match child.try_wait() {
                // 自己起的还活着（比如 /health 刚好在加载中没应答）。
                Ok(None) => return Ok("already_running".to_string()),
                Ok(Some(_)) | Err(_) => *process = None,
            }
        }
    }

    let child = Command::new(&python)
        .arg(&script)
        .args([
            "--model",
            &model.to_string_lossy(),
            "--port",
            &scorer_port().to_string(),
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        // 不挂管道：加载日志能填满管道把 python 卡死（MLX 那边踩过同样的事）。
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("无法启动本地打分器: {error}"))?;
    *SCORER_PROCESS.lock().await = Some(child);
    Ok("started".to_string())
}
