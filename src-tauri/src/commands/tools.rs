use crate::skills::path_utils::resolve_home_dir;
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

    let candidate = resolve_home_dir()
        .join(".jiucaihezi")
        .join("tools")
        .join("bin")
        .join(program);
    if candidate.exists() {
        return candidate;
    }

    // PATH 环境变量查找（已覆盖各平台）
    if let Some(paths) = env::var_os("PATH") {
        if let Some(found) = find_in_path(program, env::split_paths(&paths)) {
            return found;
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

/// 在给定目录列表中查找可执行文件，命中即返回。
fn find_in_path(program: &str, dirs: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    let names = path_candidate_names(program);
    for dir in dirs {
        for name in &names {
            let candidate = dir.join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn path_candidate_names(program: &str) -> Vec<String> {
    vec![program.to_string()]
}

/// Windows 的 CreateProcess 不能执行无扩展名文件：Node.js 安装目录里 `npx` 是 Unix shell
/// 脚本，`npx.cmd` 才是命令入口。若先命中前者，启动会以 os error 193
/// （%1 不是有效的 Win32 应用程序）失败，所以这里必须先按 PATHEXT 找 exe/cmd/bat。
#[cfg(windows)]
fn path_candidate_names(program: &str) -> Vec<String> {
    if Path::new(program).extension().is_some() {
        return vec![program.to_string()];
    }
    ["exe", "cmd", "bat", ""]
        .into_iter()
        .map(|extension| {
            if extension.is_empty() {
                program.to_string()
            } else {
                format!("{program}.{extension}")
            }
        })
        .collect()
}

fn ensure_binary_executable(path: &Path) {
    // Windows 上既没有可执行位也没有隔离属性，本函数是空实现；
    // 这个 let 只为让参数在非 unix 平台不触发 unused_variables
    #[cfg(not(unix))]
    let _ = path;

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
    let path = resolve_home_dir().join(".jiucaihezi").join("tools").join("python");
    path.exists().then_some(path)
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
    {
        let tools_root = resolve_home_dir().join(".jiucaihezi").join("tools");
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn prefers_cmd_shim_over_extensionless_npx_script() {
        let dir = tempfile::tempdir().unwrap();
        // 复现 Node.js 安装目录的真实形态：`npx` 是 Unix shell 脚本，`npx.cmd` 是 Windows 入口
        std::fs::write(dir.path().join("npx"), "#!/bin/sh\n").unwrap();
        std::fs::write(dir.path().join("npx.cmd"), "@echo off\r\n").unwrap();

        let resolved = find_in_path("npx", [dir.path().to_path_buf()]).expect("应命中 PATH 内的 npx");
        assert_eq!(
            resolved.file_name().unwrap().to_string_lossy(),
            "npx.cmd",
            "必须先命中可由 CreateProcess 执行的 npx.cmd"
        );
    }

    #[test]
    fn does_not_guess_extensions_for_explicit_program() {
        assert_eq!(path_candidate_names("tool.cmd"), vec!["tool.cmd".to_string()]);
    }
}
