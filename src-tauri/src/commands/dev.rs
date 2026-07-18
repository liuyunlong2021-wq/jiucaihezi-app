use base64::engine::general_purpose;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Command as StdCommand;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio::time::{timeout, Duration};
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
    let value = relative_path;
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

pub fn canonical_external_existing_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path.trim());
    if !path.is_absolute() {
        return Err("外部路径必须是绝对路径".into());
    }
    std::fs::canonicalize(&path).map_err(|e| format!("外部路径不可访问: {}", e))
}

pub fn resolve_external_write_path(path: &str) -> Result<PathBuf, String> {
    let raw = PathBuf::from(path.trim());
    if !raw.is_absolute() {
        return Err("外部路径必须是绝对路径".into());
    }
    if raw.exists() {
        let canonical = std::fs::canonicalize(&raw).map_err(|e| format!("外部路径不可访问: {}", e))?;
        if canonical.is_dir() {
            return Err("写入路径必须是文件".into());
        }
        return Ok(canonical);
    }
    let file_name = raw.file_name().ok_or_else(|| "写入路径无效".to_string())?;
    let parent = raw.parent().ok_or_else(|| "写入路径无效".to_string())?;
    let existing_parent = parent
        .ancestors()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| "找不到可用父目录".to_string())?;
    let canonical_parent = std::fs::canonicalize(existing_parent)
        .map_err(|e| format!("外部父目录不可访问: {}", e))?;
    let suffix = parent.strip_prefix(existing_parent).unwrap_or(parent);
    Ok(canonical_parent.join(suffix).join(file_name))
}

pub fn display_external(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn display_relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn copy_file_new(source: &Path, target: &Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(source).map_err(|e| format!("读取来源失败: {}", e))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("不支持符号链接: {}", display_external(source)));
    }
    if !metadata.is_file() {
        return Err(format!("来源必须是文件: {}", display_external(source)));
    }
    let mut source_file = std::fs::File::open(source).map_err(|e| format!("读取来源失败: {}", e))?;
    let mut target_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|e| if e.kind() == std::io::ErrorKind::AlreadyExists { "文件已存在".to_string() } else { format!("创建文件失败: {}", e) })?;
    let result = std::io::copy(&mut source_file, &mut target_file)
        .map(|_| ())
        .map_err(|e| format!("复制文件失败: {}", e));
    if result.is_err() {
        drop(target_file);
        let _ = std::fs::remove_file(target);
    }
    result
}

fn collect_directory_entries(source: &Path) -> Result<Vec<(PathBuf, PathBuf, bool)>, String> {
    let metadata = std::fs::symlink_metadata(source).map_err(|e| format!("读取来源失败: {}", e))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("不支持符号链接: {}", display_external(source)));
    }
    if !metadata.is_dir() {
        return Err("来源必须是文件夹".into());
    }
    let mut entries = vec![(source.to_path_buf(), PathBuf::new(), true)];
    let mut stack = vec![source.to_path_buf()];
    while let Some(current) = stack.pop() {
        for child in std::fs::read_dir(&current).map_err(|e| format!("读取目录失败: {}", e))? {
            let child = child.map_err(|e| format!("读取目录失败: {}", e))?;
            let path = child.path();
            let metadata = std::fs::symlink_metadata(&path).map_err(|e| format!("读取来源失败: {}", e))?;
            if metadata.file_type().is_symlink() {
                return Err(format!("不支持符号链接: {}", display_external(&path)));
            }
            let relative = path.strip_prefix(source).map_err(|_| "来源路径无效".to_string())?.to_path_buf();
            if metadata.is_dir() {
                entries.push((path.clone(), relative, true));
                stack.push(path);
            } else if metadata.is_file() {
                entries.push((path, relative, false));
            } else {
                return Err(format!("不支持的来源类型: {}", display_external(&path)));
            }
        }
    }
    Ok(entries)
}

pub fn import_external_files(root: &Path, sources: &[PathBuf], target_relative: &Path) -> Result<Vec<String>, String> {
    let target_directory = root.join(target_relative);
    let mut targets = HashSet::new();
    let mut planned = Vec::new();
    for source in sources {
        let metadata = std::fs::symlink_metadata(source).map_err(|e| format!("读取来源失败: {}", e))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!("来源必须是普通文件: {}", display_external(source)));
        }
        let name = source.file_name().ok_or_else(|| "来源文件名无效".to_string())?;
        let target = target_directory.join(name);
        let relative = target.strip_prefix(root).map_err(|_| "目标路径无效".to_string())?.to_path_buf();
        if target.exists() || std::fs::symlink_metadata(&target).is_ok() || !targets.insert(target.clone()) {
            return Err(format!("文件已存在: {}", display_relative(root, &target)));
        }
        planned.push((source, target, relative));
    }
    if planned.is_empty() {
        return Ok(Vec::new());
    }
    std::fs::create_dir_all(&target_directory).map_err(|e| format!("创建目标目录失败: {}", e))?;
    let mut imported = Vec::with_capacity(planned.len());
    for (source, target, relative) in planned {
        copy_file_new(source, &target)?;
        imported.push(display_relative(root, &root.join(relative)));
    }
    Ok(imported)
}

pub fn import_external_folder(root: &Path, source: &Path, target_relative: &Path) -> Result<String, String> {
    let source_name = source.file_name().ok_or_else(|| "来源文件夹名无效".to_string())?;
    let target = root.join(target_relative).join(source_name);
    if target.exists() || std::fs::symlink_metadata(&target).is_ok() {
        return Err(format!("文件夹已存在: {}", display_relative(root, &target)));
    }
    let entries = collect_directory_entries(source)?;
    std::fs::create_dir_all(&target).map_err(|e| format!("创建目标目录失败: {}", e))?;
    let result = (|| {
        for (entry, relative, is_dir) in entries {
            let destination = target.join(relative);
            if is_dir {
                std::fs::create_dir_all(destination).map_err(|e| format!("创建目录失败: {}", e))?;
            } else {
                copy_file_new(&entry, &destination)?;
            }
        }
        Ok(display_relative(root, &target))
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&target);
    }
    result
}

pub fn batch_copy_project_paths(root: &Path, sources: &[String], target_relative: &str) -> Result<Vec<String>, String> {
    let root = std::fs::canonicalize(root).map_err(|e| format!("项目目录不可访问: {}", e))?;
    let target = resolve_existing_path(&root, target_relative)?;
    if !target.is_dir() {
        return Err("目标必须是文件夹".into());
    }
    let mut planned = Vec::new();
    let mut targets = HashSet::new();
    for relative in sources {
        let source = resolve_existing_path(&root, relative)?;
        let name = source.file_name().ok_or_else(|| "来源文件名无效".to_string())?;
        let destination = target.join(name);
        if source.is_dir() && target.starts_with(&source) {
            return Err("不能复制到资源自身或其子目录".into());
        }
        if destination.exists() || !targets.insert(destination.clone()) {
            return Err(format!("目标已存在: {}", display_relative(&root, &destination)));
        }
        planned.push((source, destination));
    }
    let mut copied = Vec::with_capacity(planned.len());
    for (source, destination) in planned {
        if source.is_file() {
            copy_file_new(&source, &destination)?;
        } else {
            let entries = collect_directory_entries(&source)?;
            std::fs::create_dir(&destination).map_err(|e| format!("创建目标目录失败: {}", e))?;
            let result: Result<(), String> = (|| {
                for (entry, relative, is_dir) in entries {
                    let target = destination.join(relative);
                    if is_dir {
                        std::fs::create_dir_all(target).map_err(|e| format!("创建目录失败: {}", e))?;
                    } else {
                        copy_file_new(&entry, &target)?;
                    }
                }
                Ok(())
            })();
            if result.is_err() {
                let _ = std::fs::remove_dir_all(&destination);
            }
            result?;
        }
        copied.push(display_relative(&root, &destination));
    }
    Ok(copied)
}

fn copy_project_path(source: &Path, destination: &Path) -> Result<(), String> {
    if source.is_file() {
        return copy_file_new(source, destination);
    }
    let entries = collect_directory_entries(source)?;
    std::fs::create_dir(destination).map_err(|e| format!("创建目标目录失败: {}", e))?;
    let result: Result<(), String> = (|| {
        for (entry, relative, is_dir) in entries {
            let target = destination.join(relative);
            if is_dir {
                std::fs::create_dir_all(target).map_err(|e| format!("创建目录失败: {}", e))?;
            } else {
                copy_file_new(&entry, &target)?;
            }
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(destination);
    }
    result
}

fn next_available_destination(parent: &Path, name: &std::ffi::OsStr, reserved: &HashSet<PathBuf>) -> PathBuf {
    let name = name.to_string_lossy();
    let path = Path::new(name.as_ref());
    let stem = path.file_stem().unwrap_or_else(|| std::ffi::OsStr::new(name.as_ref())).to_string_lossy();
    let extension = path.extension().map(|extension| format!(".{}", extension.to_string_lossy())).unwrap_or_default();
    for index in 1.. {
        let candidate = parent.join(format!("{} ({}){}", stem, index, extension));
        if !candidate.exists() && !reserved.contains(&candidate) {
            return candidate;
        }
    }
    unreachable!()
}

fn batch_copy_project_paths_with_policy(
    root: &Path,
    sources: &[String],
    target_relative: &str,
    policy: Option<&str>,
) -> Result<(Vec<String>, Vec<DevBatchProjectFileEntry>), String> {
    let root = std::fs::canonicalize(root).map_err(|e| format!("项目目录不可访问: {}", e))?;
    let target = resolve_existing_path(&root, target_relative)?;
    if !target.is_dir() { return Err("目标必须是文件夹".into()); }
    let mut planned = Vec::new();
    let mut reserved = HashSet::new();
    let mut deleted = Vec::new();
    for relative in sources {
        let source = resolve_existing_path(&root, relative)?;
        let name = source.file_name().ok_or_else(|| "来源文件名无效".to_string())?;
        if source.is_dir() && target.starts_with(&source) { return Err("不能复制到资源自身或其子目录".into()); }
        let mut destination = target.join(name);
        if destination.exists() || reserved.contains(&destination) {
            match policy {
                Some("keep-both") => destination = next_available_destination(&target, name, &reserved),
                Some("overwrite") if destination.exists() => {
                    let target_path = display_relative(&root, &destination);
                    deleted.extend(batch_project_entries(&root, &[target_path])?);
                    if destination.is_dir() { std::fs::remove_dir_all(&destination).map_err(|e| format!("删除覆盖目标失败: {}", e))?; }
                    else { std::fs::remove_file(&destination).map_err(|e| format!("删除覆盖目标失败: {}", e))?; }
                }
                _ => return Err(format!("目标已存在: {}", display_relative(&root, &destination))),
            }
        }
        if !reserved.insert(destination.clone()) { return Err(format!("目标已存在: {}", display_relative(&root, &destination))); }
        planned.push((source, destination));
    }
    let mut copied = Vec::with_capacity(planned.len());
    for (source, destination) in planned {
        copy_project_path(&source, &destination)?;
        copied.push(display_relative(&root, &destination));
    }
    Ok((copied, deleted))
}

pub fn batch_move_project_paths(root: &Path, sources: &[String], target_relative: &str) -> Result<Vec<(String, String)>, String> {
    let root = std::fs::canonicalize(root).map_err(|e| format!("项目目录不可访问: {}", e))?;
    let target = resolve_existing_path(&root, target_relative)?;
    if !target.is_dir() {
        return Err("目标必须是文件夹".into());
    }
    let mut planned = Vec::new();
    let mut targets = HashSet::new();
    for relative in sources {
        let source = resolve_existing_path(&root, relative)?;
        let clean = clean_relative_path(relative)?;
        if clean.as_os_str().is_empty() {
            return Err("不能移动项目根目录".into());
        }
        if source.is_dir() && target.starts_with(&source) {
            return Err("不能移动到资源自身或其子目录".into());
        }
        let name = source.file_name().ok_or_else(|| "来源文件名无效".to_string())?;
        let destination = target.join(name);
        if destination.exists() || !targets.insert(destination.clone()) {
            return Err(format!("目标已存在: {}", display_relative(&root, &destination)));
        }
        planned.push((clean, source, destination));
    }
    let mut moved = Vec::with_capacity(planned.len());
    for (old_relative, source, destination) in planned {
        std::fs::rename(&source, &destination).map_err(|e| format!("移动失败: {}", e))?;
        moved.push((display_relative(&root, &root.join(old_relative)), display_relative(&root, &destination)));
    }
    Ok(moved)
}

fn batch_move_project_paths_with_policy(
    root: &Path,
    sources: &[String],
    target_relative: &str,
    policy: Option<&str>,
) -> Result<(Vec<(String, String)>, Vec<DevBatchProjectFileEntry>), String> {
    let root = std::fs::canonicalize(root).map_err(|e| format!("项目目录不可访问: {}", e))?;
    let target = resolve_existing_path(&root, target_relative)?;
    if !target.is_dir() { return Err("目标必须是文件夹".into()); }
    let mut planned = Vec::new();
    let mut reserved = HashSet::new();
    let mut deleted = Vec::new();
    for relative in sources {
        let clean = clean_relative_path(relative)?;
        if clean.as_os_str().is_empty() { return Err("不能移动项目根目录".into()); }
        let source = resolve_existing_path(&root, relative)?;
        if source.is_dir() && target.starts_with(&source) { return Err("不能移动到资源自身或其子目录".into()); }
        let name = source.file_name().ok_or_else(|| "来源文件名无效".to_string())?;
        let mut destination = target.join(name);
        if destination == source { return Err("目标已是来源目录".into()); }
        if destination.exists() || reserved.contains(&destination) {
            match policy {
                Some("keep-both") => destination = next_available_destination(&target, name, &reserved),
                Some("overwrite") if destination.exists() => {
                    let target_path = display_relative(&root, &destination);
                    deleted.extend(batch_project_entries(&root, &[target_path])?);
                    if destination.is_dir() { std::fs::remove_dir_all(&destination).map_err(|e| format!("删除覆盖目标失败: {}", e))?; }
                    else { std::fs::remove_file(&destination).map_err(|e| format!("删除覆盖目标失败: {}", e))?; }
                }
                _ => return Err(format!("目标已存在: {}", display_relative(&root, &destination))),
            }
        }
        if !reserved.insert(destination.clone()) { return Err(format!("目标已存在: {}", display_relative(&root, &destination))); }
        planned.push((clean, source, destination));
    }
    let mut moved = Vec::with_capacity(planned.len());
    for (old_relative, source, destination) in planned {
        std::fs::rename(&source, &destination).map_err(|e| format!("移动失败: {}", e))?;
        moved.push((display_relative(&root, &root.join(old_relative)), display_relative(&root, &destination)));
    }
    Ok((moved, deleted))
}

pub fn batch_delete_project_paths<F>(root: &Path, sources: &[String], mut mover: F) -> Result<Vec<String>, String>
where
    F: FnMut(&Path) -> Result<(), String>,
{
    let root = std::fs::canonicalize(root).map_err(|e| format!("项目目录不可访问: {}", e))?;
    let mut planned = Vec::new();
    let mut seen = HashSet::new();
    for relative in sources {
        let clean = clean_relative_path(relative)?;
        if clean.as_os_str().is_empty() {
            return Err("不能移入废纸篓项目根目录".into());
        }
        let source = resolve_existing_path(&root, relative)?;
        let display = display_relative(&root, &source);
        if seen.insert(display.clone()) {
            planned.push((source, display));
        }
    }
    let mut deleted = Vec::with_capacity(planned.len());
    for (source, display) in planned {
        mover(&source)?;
        deleted.push(display);
    }
    Ok(deleted)
}

pub fn export_project_to_directory(root: &Path, destination_directory: &Path) -> Result<String, String> {
    if !destination_directory.is_dir() {
        return Err("导出位置必须是文件夹".into());
    }
    if destination_directory.starts_with(root) {
        return Err("不能导出到项目目录或其子目录".into());
    }
    let project_name = root.file_name().ok_or_else(|| "项目文件夹名无效".to_string())?;
    let target = destination_directory.join(project_name);
    if target.exists() || std::fs::symlink_metadata(&target).is_ok() {
        return Err(format!("文件夹已存在: {}", display_external(&target)));
    }
    let entries = collect_directory_entries(root)?;
    std::fs::create_dir(&target).map_err(|e| format!("创建导出目录失败: {}", e))?;
    let result = (|| {
        for (entry, relative, is_dir) in entries {
            let destination = target.join(relative);
            if is_dir {
                std::fs::create_dir_all(destination).map_err(|e| format!("创建目录失败: {}", e))?;
            } else {
                copy_file_new(&entry, &destination)?;
            }
        }
        Ok(display_external(&target))
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&target);
    }
    result
}

pub fn export_project_paths_to_directory(root: &Path, paths: &[String], destination: &Path, policy: Option<&str>) -> Result<Vec<String>, String> {
    let root = std::fs::canonicalize(root).map_err(|e| format!("项目目录不可访问: {}", e))?;
    if !destination.is_dir() || destination.starts_with(&root) { return Err("导出位置无效".into()); }
    let mut reserved = HashSet::new();
    let mut exported = Vec::new();
    for relative in paths {
        let source = resolve_existing_path(&root, relative)?;
        let name = source.file_name().ok_or_else(|| "来源文件名无效".to_string())?;
        let mut target = destination.join(name);
        if target.exists() || reserved.contains(&target) {
            match policy {
                Some("keep-both") => target = next_available_destination(destination, name, &reserved),
                Some("overwrite") if target.exists() => {
                    if target.is_dir() { std::fs::remove_dir_all(&target).map_err(|e| format!("覆盖导出目标失败: {}", e))?; }
                    else { std::fs::remove_file(&target).map_err(|e| format!("覆盖导出目标失败: {}", e))?; }
                }
                _ => return Err(format!("导出目标已存在: {}", display_external(&target))),
            }
        }
        reserved.insert(target.clone());
        copy_project_path(&source, &target)?;
        exported.push(display_external(&target));
    }
    Ok(exported)
}

fn resource_revision(path: &Path) -> Result<DevResourceRevision, String> {
    let metadata = std::fs::metadata(path).map_err(|e| format!("读取文件信息失败: {}", e))?;
    let updated_at = metadata.modified().ok().and_then(|value| value.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_nanos());
    let size = metadata.len() as usize;
    Ok(DevResourceRevision {
        value: format!("{}:{}", updated_at.map(|value| value.to_string()).unwrap_or_default(), size),
        size,
        updated_at,
    })
}

fn modified_millis(metadata: &std::fs::Metadata) -> Option<u64> {
    metadata.modified().ok().and_then(|value| value.duration_since(UNIX_EPOCH).ok()).map(|value| value.as_millis() as u64)
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
                updated_at: modified_millis(&metadata),
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
                updated_at: modified_millis(&metadata),
            });
            if is_dir && !should_skip_dir(&file_name) {
                stack.push(path);
            }
        }
    }

    Ok(entries)
}

#[tauri::command]
pub fn dev_list_file_descendants(input: DevListFilesInput) -> Result<Vec<DevFileEntry>, String> {
    let root = canonical_root(&input.root)?;
    let relative_path = input.relative_path.as_deref().ok_or_else(|| "目录路径不能为空".to_string())?;
    let start = resolve_existing_path(&root, relative_path)?;
    let mut entries = Vec::new();
    let mut stack = vec![start];

    while let Some(dir) = stack.pop() {
        let metadata = std::fs::metadata(&dir).map_err(|e| format!("读取文件信息失败: {}", e))?;
        if metadata.is_file() {
            entries.push(DevFileEntry {
                path: display_relative(&root, &dir),
                is_dir: false,
                size: Some(metadata.len()),
                updated_at: modified_millis(&metadata),
            });
            continue;
        }
        let mut children = std::fs::read_dir(&dir)
            .map_err(|e| format!("读取目录失败: {}", e))?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        children.sort_by_key(|entry| entry.file_name());
        for child in children.into_iter().rev() {
            let path = child.path();
            let metadata = child.metadata().map_err(|e| format!("读取文件信息失败: {}", e))?;
            let file_name = child.file_name().to_string_lossy().to_string();
            let is_dir = metadata.is_dir();
            entries.push(DevFileEntry {
                path: display_relative(&root, &path),
                is_dir,
                size: if is_dir { None } else { Some(metadata.len()) },
                updated_at: modified_millis(&metadata),
            });
            if is_dir && !should_skip_dir(&file_name) {
                stack.push(path);
            }
        }
    }
    Ok(entries)
}

#[tauri::command]
pub fn dev_list_external_files(input: DevExternalListFilesInput) -> Result<Vec<DevFileEntry>, String> {
    let start = canonical_external_existing_path(&input.path)?;
    let max_entries = input.max_entries.unwrap_or(300).clamp(1, 1000);
    let start_metadata = std::fs::metadata(&start).map_err(|e| format!("读取文件信息失败: {}", e))?;
    if start_metadata.is_file() {
        return Ok(vec![DevFileEntry {
            path: display_external(&start),
            is_dir: false,
            size: Some(start_metadata.len()),
            updated_at: modified_millis(&start_metadata),
        }]);
    }
    let mut entries = vec![DevFileEntry { path: display_external(&start), is_dir: true, size: None, updated_at: modified_millis(&start_metadata) }];
    let mut stack = vec![start];

    while let Some(path) = stack.pop() {
        if entries.len() >= max_entries {
            break;
        }
        let mut children = std::fs::read_dir(&path)
            .map_err(|e| format!("读取目录失败: {}", e))?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        children.sort_by_key(|entry| entry.file_name());
        for child in children.into_iter().rev() {
            if entries.len() >= max_entries {
                break;
            }
            let child_path = child.path();
            let metadata = child.metadata().map_err(|e| format!("读取文件信息失败: {}", e))?;
            let file_name = child.file_name().to_string_lossy().to_string();
            entries.push(DevFileEntry {
                path: display_external(&child_path),
                is_dir: metadata.is_dir(),
                size: if metadata.is_dir() { None } else { Some(metadata.len()) },
                updated_at: modified_millis(&metadata),
            });
            if metadata.is_dir() && !should_skip_dir(&file_name) {
                stack.push(child_path);
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
pub fn dev_file_exists(input: DevFileExistsInput) -> Result<bool, String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_write_path(&root, &input.relative_path)?;
    Ok(path.is_file())
}

#[tauri::command]
pub fn dev_read_file(input: DevReadFileInput) -> Result<DevReadFileOutput, String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_existing_path(&root, &input.relative_path)?;
    if !path.is_file() {
        return Err("读取路径必须是文件".into());
    }
    let max_bytes = input.max_bytes.unwrap_or(120_000).clamp(1, 30_000_000);
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
        revision: resource_revision(&path)?,
    })
}

#[tauri::command]
pub fn dev_read_external_file(input: DevExternalReadFileInput) -> Result<DevReadFileOutput, String> {
    let path = canonical_external_existing_path(&input.path)?;
    if !path.is_file() {
        return Err("读取路径必须是文件".into());
    }
    let max_bytes = input.max_bytes.unwrap_or(120_000).clamp(1, 30_000_000);
    let bytes = std::fs::read(&path).map_err(|e| format!("读取文件失败: {}", e))?;
    let truncated = bytes.len() > max_bytes;
    let slice = if truncated { &bytes[..max_bytes] } else { &bytes[..] };
    Ok(DevReadFileOutput {
        path: display_external(&path),
        content: String::from_utf8_lossy(slice).to_string(),
        base64: general_purpose::STANDARD.encode(slice),
        truncated,
        size: bytes.len(),
        revision: resource_revision(&path)?,
    })
}

#[tauri::command]
pub fn dev_save_project_file_as(input: DevSaveProjectFileAsInput) -> Result<(), String> {
    let root = canonical_root(&input.root)?;
    let source = resolve_existing_path(&root, &input.relative_path)?;
    if !source.is_file() {
        return Err("另存为来源必须是文件".into());
    }
    let destination = PathBuf::from(&input.destination_path);
    if source == destination {
        return Err("另存为目标不能与原文件相同".into());
    }
    std::fs::copy(&source, &destination).map_err(|e| format!("另存为失败: {}", e))?;
    Ok(())
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
            revision: resource_revision(&path)?,
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
pub fn dev_create_file_if_missing(input: DevWriteFileInput) -> Result<DevWriteFileOutput, String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_write_path(&root, &input.relative_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| if e.kind() == std::io::ErrorKind::AlreadyExists { "文件已存在".to_string() } else { format!("创建文件失败: {}", e) })?;
    file.write_all(input.content.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(DevWriteFileOutput {
        path: display_relative(&root, &path),
        bytes_written: input.content.len(),
    })
}

#[tauri::command]
pub fn dev_write_file_if_revision(input: DevWriteFileIfRevisionInput) -> Result<DevWriteFileIfRevisionOutput, String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_write_path(&root, &input.relative_path)?;
    if !path.exists() {
        return Ok(DevWriteFileIfRevisionOutput { status: "missing".into(), revision: None });
    }
    let path = resolve_existing_path(&root, &input.relative_path)?;
    if !path.is_file() {
        return Err("写入路径必须是文件".into());
    }
    let current_revision = resource_revision(&path)?;
    if current_revision.value != input.expected_revision {
        return Ok(DevWriteFileIfRevisionOutput { status: "conflict".into(), revision: Some(current_revision) });
    }

    let parent = path.parent().ok_or_else(|| "写入路径无效".to_string())?;
    let temporary_path = parent.join(format!(".{}.{}.tmp", path.file_name().and_then(|name| name.to_str()).unwrap_or("file"), uuid::Uuid::new_v4()));
    std::fs::write(&temporary_path, input.content.as_bytes()).map_err(|e| format!("写入临时文件失败: {}", e))?;
    if let Err(error) = replace_file_atomically(&temporary_path, &path) {
        let _ = std::fs::remove_file(&temporary_path);
        return Err(format!("原子替换文件失败: {}", error));
    }
    Ok(DevWriteFileIfRevisionOutput { status: "saved".into(), revision: Some(resource_revision(&path)?) })
}

#[tauri::command]
pub fn dev_append_file(input: DevWriteFileInput) -> Result<DevWriteFileOutput, String> {
    let root = canonical_root(&input.root)?;
    let path = resolve_write_path(&root, &input.relative_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("追加文件失败: {}", e))?;
    file.write_all(input.content.as_bytes())
        .map_err(|e| format!("追加文件失败: {}", e))?;
    Ok(DevWriteFileOutput {
        path: display_relative(&root, &path),
        bytes_written: input.content.len(),
    })
}

#[tauri::command]
pub fn dev_write_external_file(input: DevExternalWriteFileInput) -> Result<DevWriteFileOutput, String> {
    let path = resolve_external_write_path(&input.path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    std::fs::write(&path, input.content.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(DevWriteFileOutput { path: display_external(&path), bytes_written: input.content.len() })
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
pub struct DevReplaceFileInput {
    root: String,
    temporary_relative_path: String,
    target_relative_path: String,
}

#[cfg(not(windows))]
fn replace_file_atomically(temporary_path: &Path, target_path: &Path) -> std::io::Result<()> {
    std::fs::rename(temporary_path, target_path)
}

#[cfg(windows)]
fn replace_file_atomically(temporary_path: &Path, target_path: &Path) -> std::io::Result<()> {
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x0000_0001;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;
    let temporary = temporary_path.as_os_str().encode_wide().chain(once(0)).collect::<Vec<_>>();
    let target = target_path.as_os_str().encode_wide().chain(once(0)).collect::<Vec<_>>();
    let replaced = unsafe {
        MoveFileExW(
            temporary.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[tauri::command]
pub fn dev_replace_file(input: DevReplaceFileInput) -> Result<String, String> {
    let root = canonical_root(&input.root)?;
    let temporary_path = resolve_existing_path(&root, &input.temporary_relative_path)?;
    let target_path = resolve_write_path(&root, &input.target_relative_path)?;
    if !temporary_path.is_file() {
        return Err("临时文件必须是文件".into());
    }
    if temporary_path.parent() != target_path.parent() {
        return Err("临时文件和目标文件必须位于同一目录".into());
    }
    if target_path.exists() && !target_path.is_file() {
        return Err("目标路径必须是文件".into());
    }

    replace_file_atomically(&temporary_path, &target_path)
        .map_err(|e| format!("原子替换文件失败: {}", e))?;
    Ok(display_relative(&root, &target_path))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevDeleteInput {
    root: String,
    relative_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevBatchProjectOperationInput {
    root: String,
    kind: String,
    relative_paths: Vec<String>,
    target_relative_path: Option<String>,
    policy: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevBatchProjectFileEntry {
    path: String,
    is_dir: bool,
    size: Option<u64>,
    updated_at: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevBatchProjectRename {
    old_path: String,
    entry: DevBatchProjectFileEntry,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevBatchProjectOperationOutput {
    created: Vec<DevBatchProjectFileEntry>,
    renamed: Vec<DevBatchProjectRename>,
    deleted: Vec<DevBatchProjectFileEntry>,
}

fn batch_project_entries(root: &Path, paths: &[String]) -> Result<Vec<DevBatchProjectFileEntry>, String> {
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    for relative in paths {
        let source = resolve_existing_path(root, relative)?;
        let source_entries = if source.is_dir() {
            collect_directory_entries(&source)?
        } else {
            vec![(source.clone(), PathBuf::new(), false)]
        };
        for (path, _, is_dir) in source_entries {
            let relative_path = display_relative(root, &path);
            if !seen.insert(relative_path.clone()) {
                continue;
            }
            let metadata = std::fs::metadata(&path).map_err(|e| format!("读取文件信息失败: {}", e))?;
            entries.push(DevBatchProjectFileEntry {
                path: relative_path,
                is_dir,
                size: if is_dir { None } else { Some(metadata.len()) },
                updated_at: modified_millis(&metadata),
            });
        }
    }
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(entries)
}

#[tauri::command]
pub fn dev_batch_project_operation(input: DevBatchProjectOperationInput) -> Result<DevBatchProjectOperationOutput, String> {
    let root = canonical_root(&input.root)?;
    if input.relative_paths.is_empty() {
        return Err("请先选择项目资源".into());
    }
    match input.kind.as_str() {
        "copy" => {
            let target = input.target_relative_path.as_deref().ok_or_else(|| "复制必须指定目标文件夹".to_string())?;
            let (created_roots, deleted) = batch_copy_project_paths_with_policy(&root, &input.relative_paths, target, input.policy.as_deref())?;
            Ok(DevBatchProjectOperationOutput {
                created: batch_project_entries(&root, &created_roots)?,
                renamed: Vec::new(),
                deleted,
            })
        }
        "move" => {
            let target = input.target_relative_path.as_deref().ok_or_else(|| "移动必须指定目标文件夹".to_string())?;
            let before = batch_project_entries(&root, &input.relative_paths)?;
            let (moved_roots, deleted) = batch_move_project_paths_with_policy(&root, &input.relative_paths, target, input.policy.as_deref())?;
            let renamed = before.into_iter().map(|old| {
                let (old_root, new_root) = moved_roots.iter()
                    .find(|(old_root, _)| old.path == *old_root || old.path.starts_with(&format!("{}/", old_root)))
                    .ok_or_else(|| format!("移动映射缺失: {}", old.path))?;
                let new_path = format!("{}{}", new_root, &old.path[old_root.len()..]);
                Ok(DevBatchProjectRename {
                    old_path: old.path,
                    entry: DevBatchProjectFileEntry { path: new_path, is_dir: old.is_dir, size: old.size, updated_at: old.updated_at },
                })
            }).collect::<Result<Vec<_>, String>>()?;
            Ok(DevBatchProjectOperationOutput {
                created: Vec::new(),
                renamed,
                deleted,
            })
        }
        "delete" => {
            let deleted = batch_project_entries(&root, &input.relative_paths)?;
            batch_delete_project_paths(&root, &input.relative_paths, |path| {
                trash::delete(path).map_err(|e| format!("移入废纸篓失败: {}", e))
            })?;
            Ok(DevBatchProjectOperationOutput { created: Vec::new(), renamed: Vec::new(), deleted })
        }
        _ => Err("批量操作类型无效".into()),
    }
}

pub fn trash_project_path<F>(root: &Path, relative_path: &str, mover: F) -> Result<(), String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    if clean_relative_path(relative_path)?.as_os_str().is_empty() {
        return Err("不能移入废纸篓项目根目录".into());
    }
    let path = resolve_existing_path(root, relative_path)?;
    mover(&path)
}

#[tauri::command]
pub fn dev_delete_file(input: DevDeleteInput) -> Result<DevDeleteFileOutput, String> {
    let root = canonical_root(&input.root)?;
    let clean = clean_relative_path(&input.relative_path)?;
    if clean.as_os_str().is_empty() {
        return Err("不能移入废纸篓项目根目录".into());
    }
    match std::fs::symlink_metadata(root.join(&clean)) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DevDeleteFileOutput { status: "missing".into() });
        }
        Err(error) => return Err(format!("项目内路径不可访问: {}", error)),
        Ok(_) => {}
    }
    trash_project_path(&root, &input.relative_path, |path| {
        trash::delete(path).map_err(|e| format!("移入废纸篓失败: {}", e))
    })?;
    Ok(DevDeleteFileOutput { status: "trashed".into() })
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
pub fn dev_replace_in_external_file(input: DevExternalReplaceInFileInput) -> Result<DevReplaceInFileOutput, String> {
    let path = canonical_external_existing_path(&input.path)?;
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
    let display_path = display_external(&path);
    Ok(DevReplaceInFileOutput {
        path: display_path.clone(),
        replacements: if replace_all { matches } else { 1 },
        bytes_written: next.len(),
        diff: build_replacement_diff(&display_path, &input.old_text, &input.new_text),
    })
}

#[tauri::command]
pub fn dev_get_diff(input: DevGetDiffInput) -> Result<DevGetDiffOutput, String> {
    let root = canonical_root(&input.root)?;
    let max_bytes = input.max_bytes.unwrap_or(200_000).clamp(1, 30_000_000);
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
    let workdir = match input.external_workdir.as_deref() {
        Some(path) => canonical_external_existing_path(path)?,
        None => resolve_existing_path(&root, input.workdir.as_deref().unwrap_or("."))?,
    };
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

/// 文件树专用：后台提取并缓存视频缩略图，不让 WebView 解码视频首帧。
#[tauri::command]
pub async fn dev_generate_video_thumbnail(app: AppHandle, input: DevReadFileInput) -> Result<String, String> {
    let root = canonical_root(&input.root)?;
    let source = resolve_existing_path(&root, &input.relative_path)?;
    let extension = source.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(extension.as_str(), "mp4" | "mov" | "avi" | "webm" | "mkv") {
        return Err("仅支持视频缩略图".into());
    }

    let metadata = std::fs::metadata(&source).map_err(|e| format!("读取视频信息失败: {}", e))?;
    let cache_key = format!(
        "{}:{}:{:?}",
        source.display(),
        metadata.len(),
        metadata.modified().ok(),
    );
    let cache_dir = app.path().app_data_dir()
        .map_err(|e| format!("缩略图缓存目录不可用: {}", e))?
        .join("output")
        .join("thumbnails");
    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("创建缩略图缓存目录失败: {}", e))?;
    let thumbnail = cache_dir.join(format!("project-video-{:x}.jpg", md5::compute(cache_key)));
    if thumbnail.is_file() {
        return Ok(thumbnail.to_string_lossy().to_string());
    }

    let mut command = Command::new("ffmpeg");
    command
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-ss")
        .arg("0")
        .arg("-i")
        .arg(&source)
        .arg("-frames:v")
        .arg("1")
        .arg("-vf")
        .arg("scale=160:-2")
        .arg("-q:v")
        .arg("4")
        .arg("-y")
        .arg(&thumbnail);
    command.kill_on_drop(true);
    let output = timeout(Duration::from_secs(30), command.output())
        .await
        .map_err(|_| "生成视频缩略图超时".to_string())?
        .map_err(|e| format!("无法启动视频缩略图工具: {}", e))?;
    if !output.status.success() || !thumbnail.is_file() {
        return Err("生成视频缩略图失败".into());
    }
    Ok(thumbnail.to_string_lossy().to_string())
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

#[tauri::command]
pub fn dev_import_project_files(input: DevImportProjectFilesInput) -> Result<Option<Vec<String>>, String> {
    let root = canonical_root(&input.root)?;
    let target_relative = clean_relative_path(&input.target_relative_path)?;
    let Some(files) = rfd::FileDialog::new().set_title("上传文件到项目").pick_files() else {
        return Ok(None);
    };
    Ok(Some(import_external_files(&root, &files, &target_relative)?))
}

#[tauri::command]
pub fn dev_import_project_folder(input: DevImportProjectFolderInput) -> Result<Option<String>, String> {
    let root = canonical_root(&input.root)?;
    let target_relative = clean_relative_path(&input.target_relative_path)?;
    let Some(folder) = rfd::FileDialog::new().set_title("上传文件夹到项目").pick_folder() else {
        return Ok(None);
    };
    Ok(Some(import_external_folder(&root, &folder, &target_relative)?))
}

#[tauri::command]
pub fn dev_export_project(input: DevExportProjectInput) -> Result<Option<String>, String> {
    let root = canonical_root(&input.root)?;
    let Some(destination) = rfd::FileDialog::new().set_title("选择项目导出位置").pick_folder() else {
        return Ok(None);
    };
    let destination = canonical_external_existing_path(&destination.to_string_lossy())?;
    Ok(Some(export_project_to_directory(&root, &destination)?))
}

#[tauri::command]
pub fn dev_export_project_paths(input: DevExportProjectPathsInput) -> Result<Vec<String>, String> {
    let root = canonical_root(&input.root)?;
    let destination = canonical_external_existing_path(&input.destination_directory)?;
    export_project_paths_to_directory(&root, &input.relative_paths, &destination, input.policy.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_file_promotes_the_temporary_contents() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().to_string_lossy().to_string();
        std::fs::create_dir_all(temp.path().join("jc-canvas")).unwrap();
        std::fs::write(temp.path().join("jc-canvas/default.jccanvas"), "old").unwrap();
        std::fs::write(temp.path().join("jc-canvas/default.jccanvas.tmp"), "new").unwrap();

        dev_replace_file(DevReplaceFileInput {
            root,
            temporary_relative_path: "jc-canvas/default.jccanvas.tmp".into(),
            target_relative_path: "jc-canvas/default.jccanvas".into(),
        })
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(temp.path().join("jc-canvas/default.jccanvas")).unwrap(),
            "new"
        );
        assert!(!temp.path().join("jc-canvas/default.jccanvas.tmp").exists());
    }

    #[test]
    fn file_exists_distinguishes_a_missing_canvas_from_a_present_one() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().to_string_lossy().to_string();
        let input = DevFileExistsInput {
            root: root.clone(),
            relative_path: "jc-canvas/default.jccanvas".into(),
        };

        assert!(!dev_file_exists(input).unwrap());
        std::fs::create_dir_all(temp.path().join("jc-canvas")).unwrap();
        std::fs::write(temp.path().join("jc-canvas/default.jccanvas"), "{}").unwrap();

        assert!(dev_file_exists(DevFileExistsInput {
            root,
            relative_path: "jc-canvas/default.jccanvas".into(),
        })
        .unwrap());
    }

    #[test]
    fn append_file_keeps_existing_project_ledger_content() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().to_string_lossy().to_string();
        dev_append_file(DevWriteFileInput {
            root: root.clone(),
            relative_path: ".raw/sessions/jcses_test.jsonl".into(),
            content: "first\n".into(),
        }).unwrap();
        dev_append_file(DevWriteFileInput {
            root,
            relative_path: ".raw/sessions/jcses_test.jsonl".into(),
            content: "second\n".into(),
        }).unwrap();
        assert_eq!(
            std::fs::read_to_string(temp.path().join(".raw/sessions/jcses_test.jsonl")).unwrap(),
            "first\nsecond\n",
        );
    }

    #[test]
    fn conditional_text_write_rejects_a_stale_file_revision() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().to_string_lossy().to_string();
        std::fs::write(temp.path().join("note.md"), "server").unwrap();
        let read = dev_read_file(DevReadFileInput {
            root: root.clone(),
            relative_path: "note.md".into(),
            max_bytes: None,
        }).unwrap();
        std::fs::write(temp.path().join("note.md"), "external change").unwrap();

        let result = dev_write_file_if_revision(DevWriteFileIfRevisionInput {
            root,
            relative_path: "note.md".into(),
            content: "local".into(),
            expected_revision: read.revision.value,
        }).unwrap();

        assert_eq!(result.status, "conflict");
        assert_eq!(std::fs::read_to_string(temp.path().join("note.md")).unwrap(), "external change");
    }

    #[test]
    fn create_file_if_missing_never_overwrites_an_existing_file() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().to_string_lossy().to_string();
        std::fs::write(temp.path().join("note.md"), "original").unwrap();

        let result = dev_create_file_if_missing(DevWriteFileInput {
            root,
            relative_path: "note.md".into(),
            content: "replacement".into(),
        });

        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(temp.path().join("note.md")).unwrap(), "original");
    }

    #[test]
    fn list_file_descendants_is_not_limited_by_the_tree_page_size() {
        let temp = tempfile::tempdir().unwrap();
        let docs = temp.path().join("docs");
        std::fs::create_dir_all(&docs).unwrap();
        for index in 0..1_001 {
            std::fs::write(docs.join(format!("note-{index}.md")), "# note").unwrap();
        }

        let entries = dev_list_file_descendants(DevListFilesInput {
            root: temp.path().to_string_lossy().to_string(),
            relative_path: Some("docs".into()),
            max_entries: Some(1),
        })
        .unwrap();

        assert_eq!(entries.len(), 1_001);
    }

    #[test]
    fn save_project_file_as_copies_binary_content() {
        let project = tempfile::tempdir().unwrap();
        let destination_dir = tempfile::tempdir().unwrap();
        let destination = destination_dir.path().join("copy.bin");
        let root = project.path().to_string_lossy().to_string();
        std::fs::write(project.path().join("source.bin"), [0, 1, 2, 253, 254, 255]).unwrap();

        dev_save_project_file_as(DevSaveProjectFileAsInput {
            root,
            relative_path: "source.bin".into(),
            destination_path: destination.to_string_lossy().to_string(),
        })
        .unwrap();

        assert_eq!(std::fs::read(destination).unwrap(), [0, 1, 2, 253, 254, 255]);
    }

    #[test]
    fn batch_copy_project_paths_preserves_directory_layout_and_bytes() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("assets/nested")).unwrap();
        std::fs::create_dir_all(project.path().join("target")).unwrap();
        std::fs::write(project.path().join("note.md"), "# note").unwrap();
        std::fs::write(project.path().join("assets/nested/clip.bin"), [0, 1, 2, 253, 254, 255]).unwrap();

        let copied = batch_copy_project_paths(
            project.path(),
            &["note.md".into(), "assets".into()],
            "target",
        )
        .unwrap();

        assert_eq!(copied, vec!["target/note.md", "target/assets"]);
        assert_eq!(std::fs::read_to_string(project.path().join("target/note.md")).unwrap(), "# note");
        assert_eq!(std::fs::read(project.path().join("target/assets/nested/clip.bin")).unwrap(), [0, 1, 2, 253, 254, 255]);
    }

    #[test]
    fn batch_move_project_paths_moves_a_directory_without_changing_bytes() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("assets/nested")).unwrap();
        std::fs::create_dir_all(project.path().join("target")).unwrap();
        std::fs::write(project.path().join("assets/nested/clip.bin"), [0, 1, 2, 253, 254, 255]).unwrap();

        let moved = batch_move_project_paths(project.path(), &["assets".into()], "target").unwrap();

        assert_eq!(moved, vec![("assets".into(), "target/assets".into())]);
        assert!(!project.path().join("assets").exists());
        assert_eq!(std::fs::read(project.path().join("target/assets/nested/clip.bin")).unwrap(), [0, 1, 2, 253, 254, 255]);
    }

    #[test]
    fn batch_delete_project_paths_reports_each_trashed_path() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("one.md"), "one").unwrap();
        std::fs::write(project.path().join("two.md"), "two").unwrap();
        let mut trashed = Vec::new();

        let deleted = batch_delete_project_paths(project.path(), &["one.md".into(), "two.md".into()], |path| {
            trashed.push(path.file_name().unwrap().to_string_lossy().to_string());
            Ok(())
        })
        .unwrap();

        assert_eq!(deleted, vec!["one.md", "two.md"]);
        assert_eq!(trashed, vec!["one.md", "two.md"]);
    }

    #[test]
    fn batch_project_operation_dispatches_copy_move_and_trash() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("copy-target")).unwrap();
        std::fs::create_dir_all(project.path().join("move-target")).unwrap();
        std::fs::create_dir_all(project.path().join("assets/nested")).unwrap();
        std::fs::write(project.path().join("assets/nested/one.md"), "one").unwrap();

        let copied = dev_batch_project_operation(DevBatchProjectOperationInput {
            root: project.path().to_string_lossy().to_string(),
            kind: "copy".into(),
            relative_paths: vec!["assets".into()],
            target_relative_path: Some("copy-target".into()),
            policy: None,
        }).unwrap();
        assert_eq!(
            copied.created.iter().map(|entry| entry.path.as_str()).collect::<Vec<_>>(),
            vec!["copy-target/assets", "copy-target/assets/nested", "copy-target/assets/nested/one.md"],
        );

        let moved = dev_batch_project_operation(DevBatchProjectOperationInput {
            root: project.path().to_string_lossy().to_string(),
            kind: "move".into(),
            relative_paths: vec!["assets".into()],
            target_relative_path: Some("move-target".into()),
            policy: None,
        }).unwrap();
        assert_eq!(
            moved.renamed.iter().map(|entry| (entry.old_path.as_str(), entry.entry.path.as_str())).collect::<Vec<_>>(),
            vec![
                ("assets", "move-target/assets"),
                ("assets/nested", "move-target/assets/nested"),
                ("assets/nested/one.md", "move-target/assets/nested/one.md"),
            ],
        );
    }

    #[test]
    fn batch_project_operation_keeps_both_or_overwrites_conflicting_directory() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("target/assets")).unwrap();
        std::fs::create_dir_all(project.path().join("assets")).unwrap();
        std::fs::write(project.path().join("assets/new.md"), "new").unwrap();
        std::fs::write(project.path().join("target/assets/old.md"), "old").unwrap();

        let kept = dev_batch_project_operation(DevBatchProjectOperationInput {
            root: project.path().to_string_lossy().to_string(), kind: "copy".into(),
            relative_paths: vec!["assets".into()], target_relative_path: Some("target".into()),
            policy: Some("keep-both".into()),
        }).unwrap();
        assert_eq!(kept.created.iter().map(|entry| entry.path.as_str()).collect::<Vec<_>>(), vec!["target/assets (1)", "target/assets (1)/new.md"]);

        let overwritten = dev_batch_project_operation(DevBatchProjectOperationInput {
            root: project.path().to_string_lossy().to_string(), kind: "copy".into(),
            relative_paths: vec!["assets".into()], target_relative_path: Some("target".into()),
            policy: Some("overwrite".into()),
        }).unwrap();
        assert_eq!(overwritten.deleted.iter().map(|entry| entry.path.as_str()).collect::<Vec<_>>(), vec!["target/assets", "target/assets/old.md"]);
        assert_eq!(std::fs::read_to_string(project.path().join("target/assets/new.md")).unwrap(), "new");
        assert!(!project.path().join("target/assets/old.md").exists());
    }

    #[test]
    fn batch_project_move_keeps_identity_and_reports_overwritten_target() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("target/assets")).unwrap();
        std::fs::create_dir_all(project.path().join("assets")).unwrap();
        std::fs::write(project.path().join("assets/new.md"), "new").unwrap();
        std::fs::write(project.path().join("target/assets/old.md"), "old").unwrap();

        let moved = dev_batch_project_operation(DevBatchProjectOperationInput {
            root: project.path().to_string_lossy().to_string(), kind: "move".into(),
            relative_paths: vec!["assets".into()], target_relative_path: Some("target".into()), policy: Some("overwrite".into()),
        }).unwrap();
        assert_eq!(moved.deleted.iter().map(|entry| entry.path.as_str()).collect::<Vec<_>>(), vec!["target/assets", "target/assets/old.md"]);
        assert_eq!(moved.renamed.iter().map(|entry| (entry.old_path.as_str(), entry.entry.path.as_str())).collect::<Vec<_>>(), vec![
            ("assets", "target/assets"), ("assets/new.md", "target/assets/new.md"),
        ]);
        assert!(!project.path().join("assets").exists());
    }

    #[test]
    fn importing_files_preserves_bytes_and_refuses_name_collisions() {
        let source_dir = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let source = source_dir.path().join("track.mp3");
        std::fs::write(&source, [0, 1, 2, 253, 254, 255]).unwrap();

        import_external_files(project.path(), &[source.clone()], Path::new("jc-media")).unwrap();
        assert_eq!(std::fs::read(project.path().join("jc-media/track.mp3")).unwrap(), [0, 1, 2, 253, 254, 255]);

        let error = import_external_files(project.path(), &[source], Path::new("jc-media")).unwrap_err();
        assert_eq!(error, "文件已存在: jc-media/track.mp3");
    }

    #[test]
    fn importing_a_folder_keeps_its_top_level_name_without_overwriting() {
        let source_root = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let source = source_root.path().join("素材包");
        std::fs::create_dir_all(source.join("audio")).unwrap();
        std::fs::write(source.join("audio/track.mp3"), "audio").unwrap();

        import_external_folder(project.path(), &source, Path::new("assets")).unwrap();
        assert_eq!(std::fs::read_to_string(project.path().join("assets/素材包/audio/track.mp3")).unwrap(), "audio");

        let error = import_external_folder(project.path(), &source, Path::new("assets")).unwrap_err();
        assert_eq!(error, "文件夹已存在: assets/素材包");
    }

    #[test]
    fn trash_project_path_resolves_the_project_folder_before_moving_it() {
        let project = tempfile::tempdir().unwrap();
        let uploaded = project.path().join("uploaded-folder");
        std::fs::create_dir_all(&uploaded).unwrap();
        std::fs::write(uploaded.join("note.md"), "note").unwrap();
        let mut moved = None;

        let root = std::fs::canonicalize(project.path()).unwrap();
        trash_project_path(&root, "uploaded-folder", |path| {
            moved = Some(path.to_path_buf());
            Ok(())
        })
        .unwrap();

        assert_eq!(moved.as_deref(), Some(std::fs::canonicalize(&uploaded).unwrap().as_path()));
        assert!(uploaded.is_dir());
    }

    #[test]
    fn deleting_an_already_missing_project_path_reports_missing_instead_of_failing() {
        let project = tempfile::tempdir().unwrap();

        let result = dev_delete_file(DevDeleteInput {
            root: project.path().to_string_lossy().to_string(),
            relative_path: "stale-folder".into(),
        })
        .unwrap();

        assert_eq!(result.status, "missing");
    }

    #[test]
    fn trash_project_path_preserves_leading_and_trailing_spaces_in_names() {
        let project = tempfile::tempdir().unwrap();
        let uploaded = project.path().join(" 东周 ");
        std::fs::create_dir_all(&uploaded).unwrap();
        let root = std::fs::canonicalize(project.path()).unwrap();
        let mut moved = None;

        trash_project_path(&root, " 东周 ", |path| {
            moved = Some(path.to_path_buf());
            Ok(())
        })
        .unwrap();

        assert_eq!(moved.as_deref(), Some(std::fs::canonicalize(&uploaded).unwrap().as_path()));
    }

    #[test]
    fn exporting_a_project_refuses_an_existing_or_nested_destination() {
        let project = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("note.md"), "note").unwrap();

        export_project_to_directory(project.path(), destination.path()).unwrap();
        let exported = destination.path().join(project.path().file_name().unwrap());
        assert_eq!(std::fs::read_to_string(exported.join("note.md")).unwrap(), "note");
        assert!(export_project_to_directory(project.path(), destination.path()).is_err());
        assert!(export_project_to_directory(project.path(), project.path()).is_err());
    }

    #[test]
    fn external_file_commands_support_an_absolute_temporary_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let frames = temp.path().join("frames");
        let image = frames.join("frame_01.jpg");
        std::fs::create_dir_all(&frames).unwrap();
        std::fs::write(&image, [1, 2, 3]).unwrap();

        let listed = dev_list_external_files(DevExternalListFilesInput {
            path: temp.path().to_string_lossy().to_string(),
            max_entries: None,
        })
        .unwrap();
        assert!(listed.iter().any(|entry| entry.path.ends_with("frames/frame_01.jpg")));

        let read = dev_read_external_file(DevExternalReadFileInput {
            path: image.to_string_lossy().to_string(),
            max_bytes: None,
        })
        .unwrap();
        assert_eq!(read.size, 3);

        let notes = temp.path().join("output/notes.txt");
        dev_write_external_file(DevExternalWriteFileInput {
            path: notes.to_string_lossy().to_string(),
            content: "林风".into(),
        })
        .unwrap();
        let replaced = dev_replace_in_external_file(DevExternalReplaceInFileInput {
            path: notes.to_string_lossy().to_string(),
            old_text: "林风".into(),
            new_text: "陆川".into(),
            replace_all: None,
        })
        .unwrap();
        assert_eq!(replaced.replacements, 1);
        assert_eq!(std::fs::read_to_string(notes).unwrap(), "陆川");
    }
}
