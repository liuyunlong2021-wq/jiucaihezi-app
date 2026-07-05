use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::time::Instant;
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;
use tokio::time::{timeout, Duration};
use crate::{SkillMaterialSourceInput, SkillMaterialCompileInput, SkillMaterialRawFile, SkillMaterialCompileOutput};
use crate::commands::dev::canonical_root;

#[derive(Debug, Clone, PartialEq, Eq)]
struct SkillMaterialCommandSpec {
    program: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    display_command: String,
}

fn validate_skill_material_source(source: &SkillMaterialSourceInput) -> Result<(), String> {
    let value = source.value.trim();
    if value.is_empty() || value.contains('\0') {
        return Err("资料来源无效".into());
    }
    match source.source_type.as_str() {
        "pdf" | "local_codebase" => {
            let path = Path::new(value);
            if !path.is_absolute() {
                return Err("本地资料路径必须是绝对路径".into());
            }
            if path.components().any(|part| matches!(part, Component::ParentDir)) {
                return Err("本地资料路径不能包含 ..".into());
            }
            reject_symlink_path(path)?;
            Ok(())
        }
        "documentation_url" => {
            validate_public_http_url(value)
        }
        "github_repo" => {
            let parts: Vec<&str> = value.split('/').collect();
            let valid = parts.len() == 2
                && parts.iter().all(|part| {
                    !part.is_empty()
                        && part.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
                });
            if valid { Ok(()) } else { Err("GitHub 仓库必须使用 owner/repo 格式".into()) }
        }
        _ => Err("当前素材转Skill暂不支持这个资料来源".into()),
    }
}

fn reject_symlink_path(path: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if let Ok(metadata) = std::fs::symlink_metadata(&current) {
            if metadata.file_type().is_symlink() {
                return Err("本地资料路径不能包含符号链接".into());
            }
        }
    }
    Ok(())
}

fn validate_public_http_url(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "文档 URL 无效".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("文档 URL 只支持 http/https".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("文档 URL 不能包含账号密码".into());
    }
    let Some(host) = url.host_str() else {
        return Err("文档 URL 缺少域名".into());
    };
    if is_unsafe_skill_material_host(host) {
        return Err("文档 URL 不能指向本机、内网或元数据地址".into());
    }
    Ok(())
}

fn is_unsafe_skill_material_host(host: &str) -> bool {
    let normalized = host.trim_matches(['[', ']']).trim_end_matches('.').to_ascii_lowercase();
    if normalized.is_empty() {
        return true;
    }
    if normalized == "localhost" || normalized.ends_with(".localhost") || normalized == "metadata.google.internal" {
        return true;
    }
    if let Ok(ip) = normalized.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(ipv4) => {
                let octets = ipv4.octets();
                ipv4.is_loopback()
                    || ipv4.is_private()
                    || ipv4.is_link_local()
                    || octets[0] == 0
            }
            std::net::IpAddr::V6(ipv6) => {
                let segments = ipv6.segments();
                ipv6.is_loopback()
                    || (segments[0] & 0xfe00) == 0xfc00
                    || (segments[0] & 0xffc0) == 0xfe80
            }
        };
    }
    false
}

fn build_skill_material_command(input: &SkillMaterialCompileInput) -> Result<SkillMaterialCommandSpec, String> {
    validate_skill_material_source(&input.source)?;
    let runtime_root = canonical_root(&input.runtime_root)?;
    let name = input.name.trim();
    if name.is_empty() {
        return Err("Skill 名称不能为空".into());
    }
    let preset = input.preset.as_deref().unwrap_or("quick");
    if !matches!(preset, "quick" | "standard") {
        return Err("preset 只支持 quick 或 standard".into());
    }

    let mut args = vec![
        "run".to_string(),
        "skill-seekers".to_string(),
        "create".to_string(),
        input.source.value.trim().to_string(),
        "--name".to_string(),
        name.to_string(),
        "--preset".to_string(),
        preset.to_string(),
        "--output".to_string(),
        input.workspace_path.trim().to_string(),
    ];
    if input.source.source_type == "documentation_url" {
        if let Some(max_pages) = input.max_pages {
            args.push("--max-pages".into());
            args.push(max_pages.clamp(1, 1000).to_string());
        }
    }
    args.extend([
        "--enhance-level".to_string(),
        "0".to_string(),
        "--quiet".to_string(),
        "--non-interactive".to_string(),
    ]);

    let mut env = HashMap::new();
    if input.source.source_type == "github_repo" {
        if let Some(token) = input.source.github_token.as_deref() {
            if !token.trim().is_empty() {
                env.insert("GITHUB_TOKEN".into(), token.trim().into());
            }
        }
    }

    let display_command = format!("uv {}", args.join(" "));
    Ok(SkillMaterialCommandSpec {
        program: "uv".into(),
        args,
        env,
        display_command,
    })
    .map(|mut spec| {
        spec.display_command = redact_skill_material_log(&spec.display_command, &spec.env);
        let _ = runtime_root;
        spec
    })
}

fn redact_skill_material_log(value: &str, env: &HashMap<String, String>) -> String {
    let mut text = value.to_string();
    for secret in env.values() {
        if !secret.is_empty() {
            text = text.replace(secret, "[REDACTED]");
        }
    }
    text
}

fn safe_skill_material_raw_path(path: &Path, root: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(root).map_err(|_| "输出路径不在工作区内".to_string())?;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => {
                let Some(text) = part.to_str() else {
                    return Err("输出路径不是有效 UTF-8".into());
                };
                if text.is_empty() || text.contains('\0') {
                    return Err("输出路径不安全".into());
                }
                parts.push(text.to_string());
            }
            Component::CurDir => {}
            _ => return Err("输出路径不安全".into()),
        }
    }
    if parts.is_empty() {
        return Err("输出路径不安全".into());
    }
    Ok(parts.join("/"))
}

fn collect_skill_material_raw_files(root: &Path, max_files: usize, max_bytes_per_file: u64) -> Result<Vec<SkillMaterialRawFile>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let canonical_root = std::fs::canonicalize(root).map_err(|e| format!("读取编译输出失败: {}", e))?;
    let mut files = Vec::new();
    let mut stack = vec![canonical_root.clone()];
    while let Some(dir) = stack.pop() {
        let entries = std::fs::read_dir(&dir).map_err(|e| format!("读取编译输出失败: {}", e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取编译输出失败: {}", e))?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|e| format!("读取编译输出失败: {}", e))?;
            if file_type.is_symlink() {
                return Err("编译输出不能包含符号链接".into());
            }
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if files.len() >= max_files {
                return Err("编译输出文件过多".into());
            }
            let metadata = entry.metadata().map_err(|e| format!("读取编译输出失败: {}", e))?;
            if metadata.len() > max_bytes_per_file {
                continue;
            }
            let canonical_path = std::fs::canonicalize(&path).map_err(|e| format!("读取编译输出失败: {}", e))?;
            if !canonical_path.starts_with(&canonical_root) {
                return Err("编译输出路径逃逸".into());
            }
            let content = std::fs::read_to_string(&canonical_path).map_err(|e| format!("读取编译输出失败: {}", e))?;
            files.push(SkillMaterialRawFile {
                path: safe_skill_material_raw_path(&canonical_path, &canonical_root)?,
                content,
                mime_type: None,
            });
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn has_skill_material_entry(files: &[SkillMaterialRawFile]) -> bool {
    files.iter().any(|file| file.path == "SKILL.md")
}

fn latest_skill_seekers_output_dir(runtime_root: &Path, started_at: std::time::SystemTime) -> Option<PathBuf> {
    let output_root = runtime_root.join("output");
    let entries = std::fs::read_dir(output_root).ok()?;
    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else { continue };
        if !file_type.is_dir() {
            continue;
        }
        let path = entry.path();
        if !path.join("SKILL.md").is_file() {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        if modified.duration_since(started_at).is_err() {
            continue;
        }
        candidates.push((modified, path));
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates.into_iter().next().map(|(_, path)| path)
}

#[tauri::command]
pub async fn skill_material_compile(input: SkillMaterialCompileInput) -> Result<SkillMaterialCompileOutput, String> {
    let runtime_root = canonical_root(&input.runtime_root)?;
    let workspace_path = PathBuf::from(input.workspace_path.trim());
    if !workspace_path.is_absolute() || workspace_path.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err("编译工作区路径不安全".into());
    }
    std::fs::create_dir_all(&workspace_path).map_err(|e| format!("创建编译工作区失败: {}", e))?;
    let spec = build_skill_material_command(&input)?;
    let timeout_seconds = input.timeout_seconds.unwrap_or(900).clamp(1, 1800);
    let start = Instant::now();
    let started_at = std::time::SystemTime::now();

    let mut command = Command::new(&spec.program);
    command.args(&spec.args);
    command.current_dir(&runtime_root);
    command.envs(&spec.env);
    command.kill_on_drop(true);

    let output = timeout(Duration::from_secs(timeout_seconds), command.output())
        .await
        .map_err(|_| format!("资料编译执行超时（{} 秒）", timeout_seconds))?
        .map_err(|e| format!("资料编译启动失败: {}", e))?;

    let stdout = redact_skill_material_log(&String::from_utf8_lossy(&output.stdout), &spec.env);
    let stderr = redact_skill_material_log(&String::from_utf8_lossy(&output.stderr), &spec.env);
    let mut raw_files = collect_skill_material_raw_files(&workspace_path, 500, 20 * 1024 * 1024)?;
    if !has_skill_material_entry(&raw_files) {
        if let Some(fallback_dir) = latest_skill_seekers_output_dir(&runtime_root, started_at) {
            raw_files = collect_skill_material_raw_files(&fallback_dir, 500, 20 * 1024 * 1024)?;
        }
    }

    Ok(SkillMaterialCompileOutput {
        command: spec.display_command,
        exit_code: output.status.code(),
        stdout,
        stderr,
        duration_ms: start.elapsed().as_millis(),
        raw_files,
    })
}

