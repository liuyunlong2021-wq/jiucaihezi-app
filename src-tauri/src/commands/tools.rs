use std::env;
use std::path::{Path, PathBuf};
use tauri;

#[tauri::command]
pub fn check_whisper_available(app: tauri::AppHandle) -> Result<bool, String> {
    let bin = match resolve_app_media_binary(&app, "whisper-cli") {
        Ok(p) => p,
        Err(_) => return Ok(false),
    };
    // 占位脚本通常 < 2KB
    let meta = std::fs::metadata(&bin).map_err(|e| e.to_string())?;
    if meta.len() < 2048 {
        return Ok(false);
    }
    // 尝试运行 --version（超时 5s）
    let output = std::process::Command::new(&bin)
        .arg("--version")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| e.to_string())?;
    Ok(output.status.success())
}

// 自定义 HTTP 请求命令，绕过 WebView/CORS，直接走主进程 reqwest。

pub(crate) fn resolve_local_binary(program: &str) -> PathBuf {
    let direct = PathBuf::from(program);
    if direct.is_absolute() && direct.exists() {
        return direct;
    }

    if let Some(home) = env::var_os("HOME") {
        let candidate = PathBuf::from(home)
            .join(".jiucaihezi")
            .join("tools")
            .join("bin")
            .join(program);
        if candidate.exists() {
            return candidate;
        }
    }

    // PATH 环境变量查找（已覆盖各平台）
    if let Some(paths) = env::var_os("PATH") {
        for dir in env::split_paths(&paths) {
            let candidate = dir.join(program);
            if candidate.exists() {
                return candidate;
            }
            #[cfg(windows)]
            if Path::new(program).extension().is_none() {
                for extension in ["exe", "cmd"] {
                    let candidate = dir.join(format!("{program}.{extension}"));
                    if candidate.exists() {
                        return candidate;
                    }
                }
            }
        }
    }

    #[cfg(windows)]
    if program.eq_ignore_ascii_case("npx") {
        let candidates = [
            env::var_os("ProgramFiles")
                .map(PathBuf::from)
                .map(|path| path.join("nodejs").join("npx.cmd")),
            env::var_os("APPDATA")
                .map(PathBuf::from)
                .map(|path| path.join("npm").join("npx.cmd")),
        ];
        for candidate in candidates.into_iter().flatten() {
            if candidate.exists() {
                return candidate;
            }
        }
    }

    // Unix 平台补充查找（Windows 上 PATH 已足够）
    #[cfg(not(windows))]
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
        let candidate = PathBuf::from(dir).join(program);
        if candidate.exists() {
            return candidate;
        }
    }

    PathBuf::from(program)
}

fn ensure_binary_executable(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("xattr")
            .args(["-dr", "com.apple.quarantine"])
            .arg(path)
            .output();
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mode = meta.permissions().mode();
            if mode & 0o111 == 0 {
                let mut perms = meta.permissions();
                perms.set_mode(mode | 0o755);
                let _ = std::fs::set_permissions(path, perms);
            }
        }
    }
}

pub(crate) fn resolve_app_media_binary(
    _app: &tauri::AppHandle,
    program: &str,
) -> Result<PathBuf, String> {
    // ponytail: 只从 PATH / ~/.jiucaihezi/tools/ 查找，不再内置媒体二进制。
    let local = resolve_local_binary(program);
    if local.exists() {
        ensure_binary_executable(&local);
        return Ok(local);
    }
    let hint = match program {
        "ffmpeg" => "请先安装 ffmpeg，例如 macOS 可运行：brew install ffmpeg",
        "ffprobe" => "请先安装 ffprobe（通常随 ffmpeg 一起安装）。",
        "whisper-cli" | "whisper" => "请先安装 whisper。",
        "yt-dlp" | "yt_dlp" => "请先安装 yt-dlp。",
        _ => "请先安装此工具。",
    };
    Err(format!("未找到 {}。{}", program, hint))
}

pub(crate) fn local_tools_python_path() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(|home| {
            PathBuf::from(home)
                .join(".jiucaihezi")
                .join("tools")
                .join("python")
        })
        .filter(|path| path.exists())
}

fn python_path_from_token(token: &str) -> Option<PathBuf> {
    let trimmed = token.trim().trim_matches('"').trim_matches('\'');
    if !trimmed.to_ascii_lowercase().contains("python") {
        return None;
    }
    let python = PathBuf::from(trimmed);
    if python.exists() { Some(python) } else { None }
}

fn python_from_wrapper_script(path: &Path) -> Option<PathBuf> {
    let content = std::fs::read_to_string(path).ok()?;
    let first = content.lines().next()?.trim();
    if let Some(shebang) = first.strip_prefix("#!") {
        if let Some(python) = shebang.split_whitespace().find_map(python_path_from_token) {
            return Some(python);
        }
    }
    for line in content.lines().take(20) {
        let trimmed = line.trim();
        let Some(command) = trimmed.strip_prefix("exec ") else {
            continue;
        };
        if let Some(python) = command.split_whitespace().find_map(python_path_from_token) {
            return Some(python);
        }
    }
    None
}

pub(crate) fn resolve_local_python() -> PathBuf {
    if let Some(home) = env::var_os("HOME") {
        let tools_root = PathBuf::from(home).join(".jiucaihezi").join("tools");
        for candidate in [
            tools_root.join("bin").join("python3"),
            tools_root.join("python").join("bin").join("python3"),
        ] {
            if candidate.exists() {
                return candidate;
            }
        }
        for wrapper in [
            tools_root.join("bin").join("markitdown"),
            tools_root.join("python").join("bin").join("markitdown"),
            tools_root.join("python").join("bin").join("pypdfium2"),
        ] {
            if let Some(python) = python_from_wrapper_script(&wrapper) {
                return python;
            }
        }
    }

    for candidate in [
        "/Library/Frameworks/Python.framework/Versions/3.10/bin/python3",
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
    ] {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return path;
        }
    }

    resolve_local_binary("python3")
}
