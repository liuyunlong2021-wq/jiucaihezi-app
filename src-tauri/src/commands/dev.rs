use base64::engine::general_purpose;
use base64::Engine as _;
use serde::Deserialize;
use std::path::{Component, Path, PathBuf};
use std::process::Command as StdCommand;
use crate::commands::opencode::open_path_with_system;
use crate::*;

pub fn canonical_root(root: &str) -> Result<PathBuf, String> {
    let path = std::path::PathBuf::from(root);
    // Windows: Tauri dialog 返回的路径可能因路径格式问题导致 canonicalize 失败，
    // 先尝试确保目录存在再 canonicalize
    if !path.exists() {
        std::fs::create_dir_all(&path)
            .map_err(|e| format!("项目目录不可访问: {}", e))?;
    }
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("项目目录不可访问: {}", e))?;
    if !canonical.is_dir() {
        return Err("项目根路径必须是文件夹".into());
    }
    Ok(canonical)
}

pub fn clean_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let value = relative_path.trim();
    if value.is_empty() || value == "." {
        return Ok(PathBuf::new());
    }
    let path = Path::new(value);
    if path.is_absolute() {
        return Err("路径必须是项目内相对路径".into());
    }

    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            Component::ParentDir => return Err("路径不能跳出项目目录".into()),
            _ => return Err("路径必须是项目内相对路径".into()),
        }
    }
    Ok(clean)
}

pub fn resolve_existing_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let clean = clean_relative_path(relative_path)?;
    let joined = root.join(clean);
    let canonical = std::fs::canonicalize(&joined)
        .map_err(|e| format!("项目内路径不可访问: {}", e))?;
    if !canonical.starts_with(root) {
        return Err("路径不能跳出项目目录".into());
    }
    Ok(canonical)
}

pub fn resolve_write_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let clean = clean_relative_path(relative_path)?;
    if clean.as_os_str().is_empty() {
        return Err("写入路径不能是项目根目录".into());
    }
    let joined = root.join(clean);
    let parent = joined.parent().ok_or_else(|| "写入路径无效".to_string())?;
    let canonical_parent = if parent.exists() {
        std::fs::canonicalize(parent).map_err(|e| format!("父目录不可访问: {}", e))?
    } else {
        let existing_parent = parent
            .ancestors()
            .find(|candidate| candidate.exists())
            .ok_or_else(|| "找不到可用父目录".to_string())?;
        std::fs::canonicalize(existing_parent).map_err(|e| format!("父目录不可访问: {}", e))?
    };
    if !canonical_parent.starts_with(root) {
        return Err("路径不能跳出项目目录".into());
    }
    Ok(joined)
}

pub fn display_relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

pub fn should_skip_dir(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | ".git" | "target" | "dist" | "dist-desktop" | ".next" | ".nuxt" | "build" | "coverage"
    )
}

pub fn marker_exists(root: &Path, marker: &str) -> bool {
    root.join(marker).exists()
}

pub fn push_unique(values: &mut Vec<String>, value: &str) {
    let owned = value.to_string();
    if !values.contains(&owned) {
        values.push(owned);
    }
}

pub fn detect_package_manager(root: &Path) -> Option<String> {
    if marker_exists(root, "pnpm-lock.yaml") {
        return Some("pnpm".into());
    }
    if marker_exists(root, "yarn.lock") {
        return Some("yarn".into());
    }
    if marker_exists(root, "bun.lockb") || marker_exists(root, "bun.lock") {
        return Some("bun".into());
    }
    if marker_exists(root, "package-lock.json") {
        return Some("npm".into());
    }
    if marker_exists(root, "package.json") {
        return Some("npm".into());
    }
    None
}

pub fn package_json_scripts(root: &Path) -> Vec<String> {
    let path = root.join("package.json");
    let Ok(content) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
        return Vec::new();
    };
    value
        .get("scripts")
        .and_then(|scripts| scripts.as_object())
        .map(|scripts| scripts.keys().cloned().collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn dev_detect_project(input: DevDetectProjectInput) -> Result<DevProjectDetection, String> {
    let root = canonical_root(&input.root)?;
    let mut project_types = Vec::new();
    let mut markers = Vec::new();
    let mut recommended_commands = Vec::new();

    for marker in [
        "package.json",
        "vite.config.ts",
        "vite.config.js",
        "src-tauri/tauri.conf.json",
        "Cargo.toml",
        "pyproject.toml",
        "requirements.txt",
    ] {
        if marker_exists(&root, marker) {
            markers.push(marker.to_string());
        }
    }

    if marker_exists(&root, "package.json") {
        push_unique(&mut project_types, "node");
        let scripts = package_json_scripts(&root);
        if marker_exists(&root, "vite.config.ts") || marker_exists(&root, "vite.config.js") {
            push_unique(&mut project_types, "vite");
        }
        let manager = detect_package_manager(&root).unwrap_or_else(|| "npm".into());
        for script in ["typecheck", "lint", "test", "build"] {
            if scripts.iter().any(|item| item == script) {
                recommended_commands.push(format!("{} run {}", manager, script));
            }
        }
    }

    if marker_exists(&root, "src-tauri/tauri.conf.json") {
        push_unique(&mut project_types, "tauri");
        recommended_commands.push("cargo check --manifest-path src-tauri/Cargo.toml".into());
        if let Some(manager) = detect_package_manager(&root) {
            recommended_commands.push(format!("{} tauri build", manager));
        }
    }

    if marker_exists(&root, "Cargo.toml") {
        push_unique(&mut project_types, "rust");
        recommended_commands.push("cargo check".into());
        recommended_commands.push("cargo test".into());
    }

    if marker_exists(&root, "pyproject.toml") || marker_exists(&root, "requirements.txt") {
        push_unique(&mut project_types, "python");
        recommended_commands.push("pytest".into());
        recommended_commands.push("ruff check .".into());
    }

    Ok(DevProjectDetection {
        project_types,
        markers,
        package_manager: detect_package_manager(&root),
        recommended_commands,
    })
}

#[tauri::command]
pub fn dev_list_files(input: DevListFilesInput) -> Result<Vec<DevFileEntry>, String> {
    let root = canonical_root(&input.root)?;
    let start = resolve_existing_path(&root, input.relative_path.as_deref().unwrap_or("."))?;
    let max_entries = input.max_entries.unwrap_or(300).clamp(1, 1000);
    let mut entries = Vec::new();
    let mut stack = vec![start];

    while let Some(dir) = stack.pop() {
        if entries.len() >= max_entries {
            break;
        }
        let metadata = std::fs::metadata(&dir).map_err(|e| format!("读取文件信息失败: {}", e))?;
        if metadata.is_file() {
            entries.push(DevFileEntry {
                path: display_relative(&root, &dir),
                is_dir: false,
                size: Some(metadata.len()),
            });
            continue;
        }

        let mut children = std::fs::read_dir(&dir)
            .map_err(|e| format!("读取目录失败: {}", e))?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        children.sort_by_key(|entry| entry.file_name());

        for child in children.into_iter().rev() {
            if entries.len() >= max_entries {
                break;
            }
            let path = child.path();
            let metadata = child.metadata().map_err(|e| format!("读取文件信息失败: {}", e))?;
            let file_name = child.file_name().to_string_lossy().to_string();
            let is_dir = metadata.is_dir();
            entries.push(DevFileEntry {
                path: display_relative(&root, &path),
                is_dir,
                size: if is_dir { None } else { Some(metadata.len()) },
            });
            if is_dir && !should_skip_dir(&file_name) {
                stack.push(path);
            }
        }
    }

    Ok(entries)
}

pub fn is_probably_text_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if name.starts_with('.') && !matches!(name, ".env" | ".gitignore") {
        return false;
    }
    let Some(ext) = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
    else {
        return matches!(name, "Dockerfile" | "Makefile");
    };
    matches!(
        ext.as_str(),
        "txt" | "md" | "csv" | "json" | "jsonl" | "xml" | "html" | "css" | "scss" | "js" | "jsx" |
        "ts" | "tsx" | "vue" | "svelte" | "py" | "rs" | "go" | "java" | "c" | "cpp" | "h" | "hpp" |
        "sh" | "bash" | "zsh" | "yaml" | "yml" | "toml" | "sql" | "rb" | "php" | "swift" |
        "kt" | "lua" | "ini" | "conf" | "log"
    )
}

#[tauri::command]
pub fn dev_search_text(input: DevSearchTextInput) -> Result<Vec<DevTextMatch>, String> {
    let root = canonical_root(&input.root)?;
    let start = resolve_existing_path(&root, input.relative_path.as_deref().unwrap_or("."))?;
    let query = input.query.trim();
    if query.is_empty() {
        return Err("搜索关键词不能为空".into());
    }

    let max_results = input.max_results.unwrap_or(80).clamp(1, 300);
    let context_lines = input.context_lines.unwrap_or(1).clamp(0, 3);
    let query_lower = query.to_ascii_lowercase();
    let mut results = Vec::new();
    let mut stack = vec![start];

    while let Some(path) = stack.pop() {
        if results.len() >= max_results {
            break;
        }
        let metadata = std::fs::metadata(&path).map_err(|e| format!("读取文件信息失败: {}", e))?;
        if metadata.is_dir() {
            let mut children = std::fs::read_dir(&path)
                .map_err(|e| format!("读取目录失败: {}", e))?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();
            children.sort_by_key(|entry| entry.file_name());
            for child in children.into_iter().rev() {
                let child_path = child.path();
                let file_name = child.file_name().to_string_lossy().to_string();
                if child_path.is_dir() && should_skip_dir(&file_name) {
                    continue;
                }
                stack.push(child_path);
            }
            continue;
        }

        if !metadata.is_file() || metadata.len() > 1_000_000 || !is_probably_text_file(&path) {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let lines = content.lines().map(|line| line.to_string()).collect::<Vec<_>>();
        for (index, line) in lines.iter().enumerate() {
            if results.len() >= max_results {
                break;
            }
            if !line.to_ascii_lowercase().contains(&query_lower) {
                continue;
            }
            let before_start = index.saturating_sub(context_lines);
            let after_end = (index + 1 + context_lines).min(lines.len());
            results.push(DevTextMatch {
                path: display_relative(&root, &path),
                line_number: index + 1,
                line: line.clone(),
                before: lines[before_start..index].to_vec(),
                after: lines[index + 1..after_end].to_vec(),
            });
        }
    }

    Ok(results)
}

#[tauri::command]
pub fn dev_read_file(input: DevReadFileInput) -> Result<DevReadFileOutput, String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_existing_path(&root, &input.relative_path)?;
    if !path.is_file() {
        return Err("读取路径必须是文件".into());
    }
    let max_bytes = input.max_bytes.unwrap_or(120_000).clamp(1, 1_000_000);
    let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败: {}", e))?;
    let truncated = bytes.len() > max_bytes;
    let slice = if truncated { &bytes[..max_bytes] } else { &bytes[..] };
    let content = String::from_utf8_lossy(slice).to_string();
    let base64_str = general_purpose::STANDARD.encode(slice);
    Ok(DevReadFileOutput {
        path: display_relative(&root, &path),
        content,
        base64: base64_str,
        truncated,
        size: bytes.len(),
    })
}

#[tauri::command]
pub fn dev_read_many_files(input: DevReadManyFilesInput) -> Result<Vec<DevReadFileOutput>, String> {
    let root = canonical_root(&input.root)?;
    let max_bytes = input.max_bytes_per_file.unwrap_or(80_000).clamp(1, 500_000);
    let mut outputs = Vec::new();
    for relative_path in input.paths.iter().take(20) {
        let path = resolve_existing_path(&root, relative_path)?;
        if !path.is_file() {
            return Err(format!("读取路径必须是文件: {}", relative_path));
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败: {}", e))?;
        let truncated = bytes.len() > max_bytes;
        let slice = if truncated { &bytes[..max_bytes] } else { &bytes[..] };
        outputs.push(DevReadFileOutput {
            path: display_relative(&root, &path),
            content: String::from_utf8_lossy(slice).to_string(),
            base64: general_purpose::STANDARD.encode(slice),
            truncated,
            size: bytes.len(),
        });
    }
    Ok(outputs)
}

#[tauri::command]
pub fn dev_write_file(input: DevWriteFileInput) -> Result<DevWriteFileOutput, String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_write_path(&root, &input.relative_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    std::fs::write(&path, input.content.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(DevWriteFileOutput {
        path: display_relative(&root, &path),
        bytes_written: input.content.len(),
    })
}

#[tauri::command]
pub fn dev_write_file_bytes(input: DevWriteFileBytesInput) -> Result<DevWriteFileOutput, String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_write_path(&root, &input.relative_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    let bytes = general_purpose::STANDARD
        .decode(&input.data_base64)
        .map_err(|e| format!("base64 解码失败: {}", e))?;
    std::fs::write(&path, &bytes).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(DevWriteFileOutput {
        path: display_relative(&root, &path),
        bytes_written: bytes.len(),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevRenameInput {
    root: String,
    old_relative_path: String,
    new_relative_path: String,
}

#[tauri::command]
pub fn dev_rename_file(input: DevRenameInput) -> Result<String, String> {
    let root = canonical_root(&input.root)?;
    let old_path = resolve_existing_path(&root, &input.old_relative_path)?;
    let new_path = resolve_write_path(&root, &input.new_relative_path)?;
    if let Some(parent) = new_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目标目录失败: {}", e))?;
    }
    std::fs::rename(&old_path, &new_path).map_err(|e| format!("重命名失败: {}", e))?;
    Ok(display_relative(&root, &new_path))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevDeleteInput {
    root: String,
    relative_path: String,
}

#[tauri::command]
pub fn dev_delete_file(input: DevDeleteInput) -> Result<(), String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_existing_path(&root, &input.relative_path)?;
    if path.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| format!("删除目录失败: {}", e))?;
    } else {
        std::fs::remove_file(&path).map_err(|e| format!("删除文件失败: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn dev_create_dir(input: DevWriteFileInput) -> Result<(), String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_write_path(&root, &input.relative_path)?;
    std::fs::create_dir_all(&path).map_err(|e| format!("创建目录失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn dev_reveal_in_finder(path: String) -> Result<(), String> {
    open_path_with_system(&PathBuf::from(&path), true)
}

#[tauri::command]
pub fn scaffold_vault(input: ScaffoldVaultInput) -> Result<(), String> {
    let root = canonical_root(&input.vault_root)?;

    for folder in input.folders.iter().take(200) {
        let clean = clean_relative_path(folder)?;
        if clean.as_os_str().is_empty() {
            continue;
        }
        let dir = root.join(clean);
        if !dir.starts_with(&root) {
            return Err("路径不能跳出知识库目录".into());
        }
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {}", e))?;
    }

    for (relative_path, content) in input.files.iter().take(50) {
        let path = resolve_write_path(&root, relative_path)?;
        if path.exists() {
            return Err(format!("文件已存在，已停止避免覆盖: {}", display_relative(&root, &path)));
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
        std::fs::write(&path, content.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;
    }

    Ok(())
}

pub fn build_replacement_diff(path: &str, old_text: &str, new_text: &str) -> String {
    let old_preview = old_text
        .lines()
        .take(20)
        .map(|line| format!("-{}", line))
        .collect::<Vec<_>>()
        .join("\n");
    let new_preview = new_text
        .lines()
        .take(20)
        .map(|line| format!("+{}", line))
        .collect::<Vec<_>>()
        .join("\n");
    format!("--- {}\n+++ {}\n{}\n{}", path, path, old_preview, new_preview)
}

#[tauri::command]
pub fn dev_replace_in_file(input: DevReplaceInFileInput) -> Result<DevReplaceInFileOutput, String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_existing_path(&root, &input.relative_path)?;
    if !path.is_file() {
        return Err("替换路径必须是文件".into());
    }
    if input.old_text.is_empty() {
        return Err("old_text 不能为空".into());
    }

    let content = std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {}", e))?;
    let matches = content.matches(&input.old_text).count();
    if matches == 0 {
        return Err("未找到 old_text，未写入文件".into());
    }
    let replace_all = input.replace_all.unwrap_or(false);
    if matches > 1 && !replace_all {
        return Err(format!(
            "old_text 命中 {} 处；为避免误改，请提供更精确文本或开启 replace_all",
            matches
        ));
    }

    let next = if replace_all {
        content.replace(&input.old_text, &input.new_text)
    } else {
        content.replacen(&input.old_text, &input.new_text, 1)
    };
    std::fs::write(&path, next.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;
    let display_path = display_relative(&root, &path);
    Ok(DevReplaceInFileOutput {
        path: display_path.clone(),
        replacements: if replace_all { matches } else { 1 },
        bytes_written: next.len(),
        diff: build_replacement_diff(
            &display_path,
            &input.old_text,
            &input.new_text,
        ),
    })
}

#[tauri::command]
pub fn dev_get_diff(input: DevGetDiffInput) -> Result<DevGetDiffOutput, String> {
    let root = canonical_root(&input.root)?;
    let max_bytes = input.max_bytes.unwrap_or(200_000).clamp(1, 1_000_000);
    let mut command = StdCommand::new("git");
    command.arg("-C").arg(&root).arg("diff").arg("--");

    if let Some(relative_path) = input.relative_path.as_deref() {
        if !relative_path.trim().is_empty() && relative_path.trim() != "." {
            let clean = clean_relative_path(relative_path)?;
            command.arg(clean);
        }
    }

    let output = command
        .output()
        .map_err(|e| format!("读取 Git diff 失败: {}", e))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let bytes = output.stdout;
    let truncated = bytes.len() > max_bytes;
    let slice = if truncated { &bytes[..max_bytes] } else { &bytes[..] };
    Ok(DevGetDiffOutput {
        source: "git diff".into(),
        diff: String::from_utf8_lossy(slice).to_string(),
        truncated,
    })
}


#[tauri::command]
pub async fn dev_run_command(input: DevRunCommandInput) -> Result<DevRunCommandOutput, String> {
    let root = canonical_root(&input.root)?;
    let workdir = resolve_existing_path(&root, input.workdir.as_deref().unwrap_or("."))?;
    if !workdir.is_dir() {
        return Err("命令工作目录必须是文件夹".into());
    }
    let (program, args) = split_command(&input.command)?;
    let timeout_seconds = input.timeout_seconds.unwrap_or(120).clamp(1, 900);
    let start = Instant::now();

    let mut command = Command::new(program);
    command.args(args);
    command.current_dir(workdir);
    command.kill_on_drop(true);

    let output = timeout(Duration::from_secs(timeout_seconds), command.output())
        .await
        .map_err(|_| format!("命令执行超时（{} 秒）", timeout_seconds))?
        .map_err(|e| format!("命令启动失败: {}", e))?;

    Ok(DevRunCommandOutput {
        command: input.command,
        exit_code: output.status.code(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        duration_ms: start.elapsed().as_millis(),
    })
}

#[tauri::command]
pub fn pick_project_folder() -> Result<Option<String>, String> {
    let folder = rfd::FileDialog::new()
        .set_title("选择项目文件夹")
        .pick_folder();
    Ok(folder.map(|p| p.to_string_lossy().to_string()))
}

// ponytail: 照抄 OpenCode desktop/main/ipc.ts "open-file-picker" handler
#[tauri::command]
pub fn open_file_picker() -> Result<Option<String>, String> {
    let file = rfd::FileDialog::new()
        .set_title("选择文件")
        .pick_file();
    Ok(file.map(|p| p.to_string_lossy().to_string()))
}

// ponytail: 照抄 OpenCode desktop/main/ipc.ts "save-file-picker" handler
#[tauri::command]
pub fn save_file_picker(default_name: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new()
        .set_title("保存文件");
    if let Some(name) = default_name {
        dialog = dialog.set_file_name(&name);
    }
    let file = dialog.save_file();
    Ok(file.map(|p| p.to_string_lossy().to_string()))
}

