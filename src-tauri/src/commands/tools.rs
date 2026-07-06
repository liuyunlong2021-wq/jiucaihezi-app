use std::collections::HashMap;
use std::env;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use tauri;
use tauri::Manager;

use serde::{Deserialize, Serialize};
use chrono::Utc;

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
        }
    }

    // Unix 平台补充查找（Windows 上 PATH 已足够）
    #[cfg(not(windows))]
    for dir in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ] {
        let candidate = PathBuf::from(dir).join(program);
        if candidate.exists() {
            return candidate;
        }
    }

    PathBuf::from(program)
}

/// resolve_local_binary 的 Option 版本：未找到返回 None
pub(crate) fn resolve_local_binary_option(program: &str) -> Option<PathBuf> {
    let candidate = resolve_local_binary(program);
    if candidate.exists() {
        Some(candidate)
    } else {
        None
    }
}

/// 检测 GitHub 工具是否已安装（目录 + 二进制两段式回退）
/// 返回安装路径，未安装返回 None
#[tauri::command]
pub fn check_tool_installed(tool_id: String) -> Result<Option<String>, String> {
    // 1. 检查 ~/.jiucaihezi/tools/{tool_id}/ 目录
    if let Some(home) = std::env::var_os("HOME") {
        let tool_dir = std::path::PathBuf::from(&home)
            .join(".jiucaihezi")
            .join("tools")
            .join(&tool_id);
        if tool_dir.exists() {
            return Ok(Some(tool_dir.to_string_lossy().to_string()));
        }
    }

    // 2. 已知二进制名 → PATH 查找（brew / apt / choco 系统安装）
    let binary: Option<&str> = match tool_id.as_str() {
        "yt-dlp" => Some("yt-dlp"),
        "ffmpeg" => Some("ffmpeg"),
        "pandoc" => Some("pandoc"),
        "whisper" => Some("whisper"),
        "ripgrep" => Some("rg"),
        "imagemagick" => Some("magick"),
        "gallery-dl" => Some("gallery-dl"),
        "muapi" => Some("muapi"),
        "hyperframes" => Some("hyperframes"),
        _ => None,
    };

    if let Some(bin) = binary {
        if let Some(found) = resolve_local_binary_option(bin) {
            return Ok(Some(found.to_string_lossy().to_string()));
        }
    }

    // 3. npm/npx 工具检测 — 跑 --version 验证（如 hyperframes 是 npm 包，不在 PATH）
    let npx_check: Option<(&str, &[&str])> = match tool_id.as_str() {
        "hyperframes" => Some(("npx", &["hyperframes", "--version"] as &[&str])),
        _ => None,
    };
    if let Some((runner, args)) = npx_check {
        let (tx, rx) = std::sync::mpsc::channel();
        let args = args.to_vec();
        std::thread::spawn(move || {
            let ok = std::process::Command::new(runner)
                .args(&args)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            let _ = tx.send(ok);
        });
        if rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap_or(false) {
            return Ok(Some(format!("npx {} (npm)", tool_id)));
        }
    }

    Ok(None)
}

/// 检查 OpenCode 插件是否已在 opencode.json 的 plugin 数组中配置。
/// 返回配置路径字符串（如 "opencode.json → plugin: [..., \"supermemory\"]"）或 None。
#[tauri::command]
pub fn check_opencode_plugin(tool_id: String, project_dir: String) -> Result<Option<String>, String> {
    let config_path = std::path::PathBuf::from(&project_dir).join("opencode.json");
    let raw = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(_) => return Ok(None), // 文件不存在，未安装
    };
    let config: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("opencode.json 格式错误: {}", e))?;
    let plugin_name = tool_id.strip_prefix("opencode-").unwrap_or(&tool_id);
    let plugins = config.get("plugin").and_then(|v| v.as_array());
    if let Some(list) = plugins {
        for entry in list {
            let name = match entry {
                serde_json::Value::String(s) => s.as_str(),
                obj if obj.is_object() => obj.get("package").and_then(|v| v.as_str()).unwrap_or(""),
                _ => "",
            };
            if name.contains(plugin_name) {
                return Ok(Some(format!(
                    "opencode.json → plugin: [..., \"{}\"]",
                    plugin_name
                )));
            }
        }
    }
    Ok(None)
}

fn opencode_platform_package_dir() -> Option<&'static str> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return Some("opencode-darwin-arm64");
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return Some("opencode-darwin-x64");
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return Some("opencode-linux-x64");
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return Some("opencode-windows-x64");
    #[allow(unreachable_code)]
    None
}

fn opencode_resource_names() -> Vec<String> {
    let mut names = vec!["opencode".to_string()];
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    names.push("opencode-aarch64-apple-darwin".to_string());
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    names.push("opencode-x86_64-apple-darwin".to_string());
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    names.push("opencode-x86_64-unknown-linux-gnu".to_string());
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        names.push("opencode.exe".to_string());
        names.push("opencode-x86_64-pc-windows-msvc.exe".to_string());
    }
    names
}

fn existing_file(path: PathBuf) -> Option<PathBuf> {
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

fn resolve_opencode_binary_from_inputs(
    resource_dirs: &[PathBuf],
    home: Option<&Path>,
    jc_opencode_bin: Option<&OsStr>,
    opencode_bin_path: Option<&OsStr>,
    path_env: Option<&OsStr>,
) -> Result<PathBuf, String> {
    for value in [jc_opencode_bin, opencode_bin_path].into_iter().flatten() {
        let path = PathBuf::from(value);
        if let Some(found) = existing_file(path.clone()) {
            return Ok(found);
        }
        return Err(format!(
            "OpenCode runtime 路径不可用：{}。请检查 JC_OPENCODE_BIN / OPENCODE_BIN_PATH。",
            path.to_string_lossy()
        ));
    }

    for dir in resource_dirs {
        for name in opencode_resource_names() {
            if let Some(found) = existing_file(dir.join(name)) {
                return Ok(found);
            }
        }
    }

    if let Some(home) = home {
        if let Some(found) = existing_file(home.join(".jiucaihezi/tools/bin/opencode")) {
            return Ok(found);
        }
    }

    if let Some(paths) = path_env {
        for dir in env::split_paths(paths) {
            if let Some(found) = existing_file(dir.join("opencode")) {
                return Ok(found);
            }
            #[cfg(windows)]
            if let Some(found) = existing_file(dir.join("opencode.exe")) {
                return Ok(found);
            }
        }
    }

    for dir in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ] {
        if let Some(found) = existing_file(PathBuf::from(dir).join("opencode")) {
            return Ok(found);
        }
    }

    if let (Some(home), Some(package_dir)) = (home, opencode_platform_package_dir()) {
        let dev_checkout_binary = home
            .join("Documents/1OKAPP/my-opencode/packages/opencode/dist")
            .join(package_dir)
            .join("bin/opencode");
        if let Some(found) = existing_file(dev_checkout_binary) {
            return Ok(found);
        }
    }

    Err(
        "OpenCode runtime 未安装或不可执行。请安装官方 opencode-ai，或设置 JC_OPENCODE_BIN / OPENCODE_BIN_PATH 指向 opencode 原生二进制。".into(),
    )
}

fn app_executable_dir() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf()))
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

fn opencode_resource_dirs(app: Option<&tauri::AppHandle>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            dirs.push(resource_dir.clone());
            dirs.push(resource_dir.join("binaries"));
            dirs.push(resource_dir.join("bin"));
        }
    }
    if let Some(exe_dir) = app_executable_dir() {
        if !dirs.contains(&exe_dir) {
            dirs.push(exe_dir);
        }
    }
    dirs
}

pub(crate) fn resolve_opencode_binary(app: Option<&tauri::AppHandle>) -> Result<PathBuf, String> {
    let home = env::var_os("HOME").map(PathBuf::from);
    let path = resolve_opencode_binary_from_inputs(
        &opencode_resource_dirs(app),
        home.as_deref(),
        env::var_os("JC_OPENCODE_BIN").as_deref(),
        env::var_os("OPENCODE_BIN_PATH").as_deref(),
        env::var_os("PATH").as_deref(),
    )?;
    ensure_binary_executable(&path);
    Ok(path)
}

pub(crate) fn resolve_app_media_binary(_app: &tauri::AppHandle, program: &str) -> Result<PathBuf, String> {
    // ponytail: 只从 PATH / ~/.jiucaihezi/tools/ 查找，不再内置媒体二进制。
    let local = resolve_local_binary(program);
    if local.exists() {
        ensure_binary_executable(&local);
        return Ok(local);
    }
    let hint = match program {
        "ffmpeg" => "请通过工具仓库安装 ffmpeg：brew install ffmpeg",
        "ffprobe" => "请通过工具仓库安装 ffprobe（随 ffmpeg 一起安装）：brew install ffmpeg",
        "whisper-cli" | "whisper" => "请通过工具仓库安装 whisper",
        "yt-dlp" | "yt_dlp" => "请通过工具仓库安装 yt-dlp：brew install yt-dlp",
        _ => "请通过工具仓库安装此工具",
    };
    Err(format!("未找到 {}。{}", program, hint))
}

pub(crate) fn local_tools_python_path() -> Option<PathBuf> {
    env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join(".jiucaihezi")
            .join("tools")
            .join("python")
    }).filter(|path| path.exists())
}

fn python_path_from_token(token: &str) -> Option<PathBuf> {
    let trimmed = token.trim().trim_matches('"').trim_matches('\'');
    if !trimmed.to_ascii_lowercase().contains("python") {
        return None;
    }
    let python = PathBuf::from(trimmed);
    if python.exists() {
        Some(python)
    } else {
        None
    }
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

// ══════════════════════════════════════════════════════════════════════════════
// check_all_tools — 批量扫描 + 缓存（抄 vscode-project-manager alreadyLocated 模式）
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ToolsCache {
    scanned_at: String,
    ttl_seconds: u64,
    tools: HashMap<String, ToolCacheEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCacheEntry {
    pub installed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ToolDefinition {
    id: String,
    #[serde(default)]
    detection: Vec<DetectionStrategy>,
}

#[derive(Debug, Deserialize)]
struct DetectionStrategy {
    #[serde(rename = "type")]
    type_: String,
    #[serde(default)]
    binary: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    package: Option<String>,
}

fn tools_cache_path() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("HOME")?)
        .join(".jiucaihezi")
        .join("tools")
        .join("tools_cache.json"))
}

fn read_cache() -> Option<ToolsCache> {
    let path = tools_cache_path()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    let cache: ToolsCache = serde_json::from_str(&raw).ok()?;
    let scanned: chrono::DateTime<Utc> = cache.scanned_at.parse().ok()?;
    let age = Utc::now().signed_duration_since(scanned);
    if age.num_seconds() < cache.ttl_seconds as i64 {
        Some(cache)
    } else {
        None
    }
}

fn write_cache(tools: &HashMap<String, ToolCacheEntry>) {
    if let Some(path) = tools_cache_path() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let cache = ToolsCache {
            scanned_at: Utc::now().to_rfc3339(),
            ttl_seconds: 300,
            tools: tools.clone(),
        };
        let _ = std::fs::write(&path, serde_json::to_string_pretty(&cache).unwrap_or_default());
    }
}

fn run_checked(cmd: &str, args: &[&str], timeout_secs: u64) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let cmd = cmd.to_string();
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    std::thread::spawn(move || {
        let out = std::process::Command::new(&cmd)
            .args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok());
        let _ = tx.send(out);
    });
    rx.recv_timeout(std::time::Duration::from_secs(timeout_secs))
        .unwrap_or(None)
        .filter(|s| !s.is_empty())
}

fn try_detect(strategy: &DetectionStrategy, ctx: &ScanContext) -> Option<(String, String)> {
    match strategy.type_.as_str() {
        "dir" => {
            // ponytail: ~ 展开用 std::env，不加 shellexpand 依赖
            let raw = strategy.path.as_ref()?;
            let p = if raw.starts_with('~') {
                std::env::var_os("HOME")
                    .map(|h| {
                        let mut pb = PathBuf::from(h);
                        if raw.len() > 2 {
                            pb.push(&raw[2..]);
                        }
                        pb.to_string_lossy().to_string()
                    })
                    .unwrap_or_else(|| raw.to_string())
            } else {
                raw.to_string()
            };
            std::fs::metadata(&p).ok().map(|_| (p, "dir".into()))
        }
        "which" => {
            let bin = strategy.binary.as_ref()?;
            resolve_local_binary_option(bin)
                .map(|p| (p.to_string_lossy().to_string(), "which".into()))
        }
        "brew" => {
            let name = strategy.name.as_ref()?;
            // ponytail: brew list 只跑一次，结果缓存在 ctx 里复用
            ctx.brew_list
                .as_ref()
                .filter(|out| out.lines().any(|l| l.trim() == name))
                .map(|_| (format!("brew: {}", name), "brew".into()))
        }
        "npm" => {
            let pkg = strategy.package.as_ref()?;
            // ponytail: npm ls 只跑一次，结果缓存在 ctx 里复用
            ctx.npm_list
                .as_ref()
                .filter(|out| out.contains(pkg))
                .map(|_| (format!("npm: {}", pkg), "npm".into()))
        }
        "pip" => {
            let name = strategy.name.as_ref()?;
            run_checked("python3", &["-c", &format!("import {}", name)], 3)
                .map(|_| (format!("pip: {}", name), "pip".into()))
        }
        // ponytail: npx 策略已移除 — npx 会下载包而非仅检测，导致超长延迟
        "command" => {
            let bin = strategy.binary.as_ref()?;
            #[cfg(windows)]
            let (cmd, args) = ("where", vec![bin.as_str()]);
            #[cfg(not(windows))]
            let (cmd, args) = ("command", vec!["-v", bin.as_str()]);
            run_checked(cmd, &args, 3)
                .map(|out| (out.trim().to_string(), "command".into()))
        }
        _ => None,
    }
}

/// 扫描上下文：缓存慢命令的结果，避免每个工具重复执行
struct ScanContext {
    brew_list: Option<String>,
    npm_list: Option<String>,
}

fn scan_one(tool: &ToolDefinition, ctx: &ScanContext) -> ToolCacheEntry {
    if tool.detection.is_empty() {
        return ToolCacheEntry { installed: false, path: None, method: None };
    }
    for strategy in &tool.detection {
        if let Some((path, method)) = try_detect(strategy, ctx) {
            return ToolCacheEntry { installed: true, path: Some(path), method: Some(method) };
        }
    }
    ToolCacheEntry { installed: false, path: None, method: None }
}

/// 批量检测所有工具的安装状态（带缓存，抄 vscode-project-manager alreadyLocated 模式）
/// force=true 跳过缓存直接扫描
#[tauri::command]
pub fn check_all_tools(force: bool) -> Result<HashMap<String, ToolCacheEntry>, String> {
    if !force {
        if let Some(cache) = read_cache() {
            return Ok(cache.tools);
        }
    }

    let raw = include_str!("../../../src/data/githubTools.json");
    let defs: serde_json::Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let tools: Vec<ToolDefinition> = serde_json::from_value(defs["tools"].clone())
        .map_err(|e| e.to_string())?;

    // ponytail: 慢命令只跑一次，结果缓存在 ScanContext 里复用
    let ctx = ScanContext {
        brew_list: run_checked("brew", &["list", "--formula"], 5),
        npm_list: run_checked("npm", &["ls", "-g", "--depth=0"], 8),
    };

    let mut results = HashMap::new();
    for tool in &tools {
        let status = scan_one(tool, &ctx);
        results.insert(tool.id.clone(), status);
    }

    // ponytail: write_cache is best-effort; failure shouldn't block the result
    write_cache(&results);

    Ok(results)
}
