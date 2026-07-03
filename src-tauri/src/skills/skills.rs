use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::State;

use crate::skills::db::{self, Collection, DbPool, SkillForAgent};
use crate::skills::SkillsAppState;

use super::linker::uninstall_skill_from_agent_impl;
use super::scanner::{scan_all_skills_impl, scan_skill_root, ScanDirectoryOptions};

// ─── Types ────────────────────────────────────────────────────────────────────

/// A Central Skill with a list of agent IDs that currently have this skill
/// installed (via symlink or copy).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillWithLinks {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub file_path: String,
    pub canonical_path: Option<String>,
    pub is_central: bool,
    pub source: Option<String>,
    pub scanned_at: String,
    pub created_at: String,
    pub updated_at: String,
    /// Agent IDs that have an installation record for this skill.
    pub linked_agents: Vec<String>,
    /// Agent IDs that observe this skill from a shared/read-only compatibility root.
    pub read_only_agents: Vec<String>,
}

/// An installation record enriched with the `installed_at` timestamp for
/// the skill detail IPC response. This is the frontend-facing version of
/// `db::SkillInstallation` — `created_at` from the DB is exposed as
/// `installed_at` for clarity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInstallationDetail {
    pub skill_id: String,
    pub agent_id: String,
    pub installed_path: String,
    pub link_type: String,
    pub symlink_target: Option<String>,
    /// ISO 8601 timestamp of when the skill was first installed.
    pub installed_at: String,
}

/// A skill with full installation details across all platforms.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDetail {
    pub id: String,
    pub row_id: String,
    pub name: String,
    pub description: Option<String>,
    pub file_path: String,
    pub dir_path: String,
    pub canonical_path: Option<String>,
    pub is_central: bool,
    pub source: Option<String>,
    pub scanned_at: String,
    pub source_kind: Option<String>,
    pub source_root: Option<String>,
    pub is_read_only: bool,
    pub conflict_group: Option<String>,
    pub conflict_count: i64,
    /// Agent IDs that can see this central skill through a read-only compatibility root.
    pub read_only_agents: Vec<String>,
    /// All installation records for this skill across agents.
    pub installations: Vec<SkillInstallationDetail>,
    /// Collections this skill currently belongs to.
    pub collections: Vec<Collection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillDirectoryNode {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub is_dir: bool,
    pub children: Vec<SkillDirectoryNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileAccessContext {
    pub skill_id: String,
    pub agent_id: Option<String>,
    pub row_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCentralSkillOptions {
    pub cascade_uninstall: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCentralSkillResult {
    pub skill_id: String,
    pub removed_canonical_path: String,
    pub uninstalled_agents: Vec<String>,
    pub skipped_read_only_agents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CentralSkillBundle {
    pub name: String,
    pub relative_path: String,
    pub path: String,
    pub is_symlink: bool,
    pub skill_count: usize,
    pub linked_agent_count: usize,
    pub read_only_agent_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CentralSkillBundleDeletePreview {
    pub bundle: CentralSkillBundle,
    pub skills: Vec<SkillWithLinks>,
    pub affected_agents: Vec<String>,
    pub skipped_read_only_agents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CentralSkillBundleDetail {
    pub bundle: CentralSkillBundle,
    pub skills: Vec<SkillWithLinks>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCentralSkillBundleOptions {
    pub cascade_uninstall: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCentralSkillBundleResult {
    pub relative_path: String,
    pub removed_bundle_path: String,
    pub removed_kind: String,
    pub removed_skill_ids: Vec<String>,
    pub uninstalled_agents: Vec<String>,
    pub skipped_read_only_agents: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCentralSkillInput {
    pub skill_id: Option<String>,
    pub skill_md: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCentralSkillResult {
    pub skill_id: String,
    pub file_path: String,
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

fn system_time_to_rfc3339(time: SystemTime) -> String {
    let datetime: DateTime<Utc> = time.into();
    datetime.to_rfc3339()
}

fn sanitize_central_skill_id(raw: &str) -> Result<String, String> {
    let mut sanitized = String::new();
    let mut last_dash = false;
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() {
            sanitized.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            sanitized.push('-');
            last_dash = true;
        }
    }

    let sanitized = sanitized.trim_matches('-').to_string();
    if sanitized.is_empty() {
        Err("Skill ID cannot be empty".to_string())
    } else {
        Ok(sanitized)
    }
}

fn skill_md_frontmatter_name(skill_md: &str) -> Result<String, String> {
    let after_open = skill_md
        .strip_prefix("---\n")
        .or_else(|| skill_md.strip_prefix("---\r\n"))
        .ok_or_else(|| "SKILL.md must start with YAML frontmatter".to_string())?;
    let close_pos = after_open
        .find("\n---")
        .ok_or_else(|| "SKILL.md frontmatter is missing a closing delimiter".to_string())?;
    let frontmatter = &after_open[..close_pos];
    let yaml: serde_yaml::Value =
        serde_yaml::from_str(frontmatter).map_err(|e| format!("Invalid SKILL.md frontmatter: {}", e))?;
    yaml.get("name")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "SKILL.md frontmatter must include a name".to_string())
}

fn skill_filesystem_timestamps(skill: &db::Skill) -> (String, String) {
    let directory_metadata = skill
        .canonical_path
        .as_deref()
        .and_then(|path| std::fs::metadata(path).ok());
    let file_metadata = std::fs::metadata(&skill.file_path).ok();

    let created_at = directory_metadata
        .as_ref()
        .or(file_metadata.as_ref())
        .and_then(|metadata| metadata.created().ok())
        .map(system_time_to_rfc3339)
        .unwrap_or_else(|| skill.scanned_at.clone());

    let updated_at = file_metadata
        .as_ref()
        .or(directory_metadata.as_ref())
        .and_then(|metadata| metadata.modified().ok())
        .map(system_time_to_rfc3339)
        .unwrap_or_else(|| skill.scanned_at.clone());

    (created_at, updated_at)
}

fn skill_dir_path(skill: &db::Skill) -> String {
    skill
        .canonical_path
        .clone()
        .or_else(|| {
            Path::new(&skill.file_path)
                .parent()
                .map(|path| path.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| skill.file_path.clone())
}

fn canonical_delete_dir(skill: &db::Skill, central_root: &Path) -> PathBuf {
    skill
        .canonical_path
        .as_deref()
        .map(PathBuf::from)
        .or_else(|| Path::new(&skill.file_path).parent().map(Path::to_path_buf))
        .unwrap_or_else(|| central_root.join(&skill.id))
}

fn ensure_under_central_root(path: &Path, central_root: &Path) -> Result<(), String> {
    if path.starts_with(central_root) && path != central_root {
        Ok(())
    } else {
        Err("Canonical path is outside Central Skills root".to_string())
    }
}

fn validate_central_delete_target(
    canonical_dir: &Path,
    central_root: &Path,
) -> Result<PathBuf, String> {
    let metadata = std::fs::symlink_metadata(canonical_dir).map_err(|e| {
        format!(
            "Failed to read canonical path '{}': {}",
            canonical_dir.display(),
            e
        )
    })?;

    if metadata.file_type().is_symlink() {
        let parent = canonical_dir
            .parent()
            .ok_or_else(|| "Canonical path has no parent directory".to_string())?
            .canonicalize()
            .map_err(|e| {
                format!(
                    "Failed to resolve canonical path parent '{}': {}",
                    canonical_dir.display(),
                    e
                )
            })?;
        let file_name = canonical_dir
            .file_name()
            .ok_or_else(|| "Canonical path has no directory name".to_string())?;
        ensure_under_central_root(&parent.join(file_name), central_root)?;
        return Ok(canonical_dir.to_path_buf());
    }

    if !metadata.is_dir() {
        return Err(format!(
            "Canonical path '{}' is not a skill directory",
            canonical_dir.display()
        ));
    }

    let resolved = canonical_dir.canonicalize().map_err(|e| {
        format!(
            "Failed to resolve canonical path '{}': {}",
            canonical_dir.display(),
            e
        )
    })?;
    ensure_under_central_root(&resolved, central_root)?;

    if !resolved.join("SKILL.md").exists() {
        return Err(format!(
            "Canonical skill directory '{}' does not contain SKILL.md",
            resolved.display()
        ));
    }

    Ok(resolved)
}

fn remove_central_skill_dir(target: &Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(target).map_err(|e| {
        format!(
            "Failed to read canonical path '{}': {}",
            target.display(),
            e
        )
    })?;

    if metadata.file_type().is_symlink() {
        std::fs::remove_file(target)
            .map_err(|e| format!("Failed to remove central skill symlink: {}", e))
    } else if metadata.is_dir() {
        std::fs::remove_dir_all(target)
            .map_err(|e| format!("Failed to remove central skill directory: {}", e))
    } else {
        Err(format!(
            "Canonical path '{}' is not a removable skill directory",
            target.display()
        ))
    }
}

#[derive(Debug, Clone)]
struct CentralBundleTarget {
    relative_path: String,
    entry_path: PathBuf,
    delete_path: PathBuf,
    content_root: Option<PathBuf>,
    is_symlink: bool,
}

impl CentralBundleTarget {
    fn removed_kind(&self) -> &'static str {
        if self.is_symlink {
            "symlink"
        } else {
            "directory"
        }
    }
}

fn normalize_central_bundle_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err("Invalid Central bundle path".to_string());
    }

    let input = Path::new(trimmed);
    if input.is_absolute() {
        return Err("Invalid Central bundle path".to_string());
    }

    let mut normalized = PathBuf::new();
    for component in input.components() {
        match component {
            std::path::Component::Normal(part) => normalized.push(part),
            _ => return Err("Invalid Central bundle path".to_string()),
        }
    }

    if normalized.as_os_str().is_empty() {
        return Err("Invalid Central bundle path".to_string());
    }

    Ok(normalized)
}

async fn central_root_path(pool: &DbPool) -> Result<PathBuf, String> {
    let central = db::get_agent_by_id(pool, "central")
        .await?
        .ok_or_else(|| "Central agent not found in database".to_string())?;

    PathBuf::from(&central.global_skills_dir)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Central Skills root: {}", e))
}

async fn ensure_central_root_path(pool: &DbPool) -> Result<PathBuf, String> {
    let central = db::get_agent_by_id(pool, "central")
        .await?
        .ok_or_else(|| "Central agent not found in database".to_string())?;
    let central_root = PathBuf::from(&central.global_skills_dir);

    std::fs::create_dir_all(&central_root).map_err(|e| {
        format!(
            "Failed to create Central Skills root '{}': {}",
            central_root.display(),
            e
        )
    })?;

    central_root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Central Skills root: {}", e))
}

fn validate_central_skill_save_target(
    target_dir: &Path,
    central_root: &Path,
) -> Result<(), String> {
    ensure_under_central_root(target_dir, central_root)?;

    match std::fs::symlink_metadata(target_dir) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "Central Skill target '{}' is a symlink; refusing to write through it",
                    target_dir.display()
                ));
            }
            if !metadata.is_dir() {
                return Err(format!(
                    "Central Skill target '{}' is not a directory",
                    target_dir.display()
                ));
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => {
            return Err(format!(
                "Failed to inspect Central Skill target '{}': {}",
                target_dir.display(),
                err
            ));
        }
    }

    Ok(())
}

fn validate_central_bundle_target(
    relative_path: &str,
    central_root: &Path,
) -> Result<CentralBundleTarget, String> {
    let normalized = normalize_central_bundle_relative_path(relative_path)?;
    let entry_path = central_root.join(&normalized);
    let metadata = std::fs::symlink_metadata(&entry_path).map_err(|e| {
        format!(
            "Failed to read Central bundle path '{}': {}",
            entry_path.display(),
            e
        )
    })?;

    let relative_path = normalized.to_string_lossy().into_owned();

    if metadata.file_type().is_symlink() {
        let parent = entry_path
            .parent()
            .ok_or_else(|| "Central bundle path has no parent directory".to_string())?
            .canonicalize()
            .map_err(|e| {
                format!(
                    "Failed to resolve Central bundle parent '{}': {}",
                    entry_path.display(),
                    e
                )
            })?;
        let file_name = entry_path
            .file_name()
            .ok_or_else(|| "Central bundle path has no directory name".to_string())?;
        ensure_under_central_root(&parent.join(file_name), central_root)?;

        return Ok(CentralBundleTarget {
            relative_path,
            entry_path: entry_path.clone(),
            delete_path: entry_path,
            content_root: std::fs::canonicalize(central_root.join(&normalized)).ok(),
            is_symlink: true,
        });
    }

    if !metadata.is_dir() {
        return Err(format!(
            "Central bundle path '{}' is not a directory or symlink",
            entry_path.display()
        ));
    }

    let resolved = entry_path.canonicalize().map_err(|e| {
        format!(
            "Failed to resolve Central bundle path '{}': {}",
            entry_path.display(),
            e
        )
    })?;
    ensure_under_central_root(&resolved, central_root)?;

    Ok(CentralBundleTarget {
        relative_path,
        entry_path,
        delete_path: resolved.clone(),
        content_root: Some(resolved),
        is_symlink: false,
    })
}

fn skill_directory_path_buf(skill: &db::Skill) -> PathBuf {
    skill
        .canonical_path
        .as_deref()
        .map(PathBuf::from)
        .or_else(|| Path::new(&skill.file_path).parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from(&skill.file_path))
}

fn skill_is_under_bundle(skill: &db::Skill, target: &CentralBundleTarget) -> bool {
    let skill_dir = skill_directory_path_buf(skill);
    if skill_dir != target.entry_path && skill_dir.starts_with(&target.entry_path) {
        return true;
    }
    if skill_dir != target.delete_path && skill_dir.starts_with(&target.delete_path) {
        return true;
    }

    matches!(
        (skill_dir.canonicalize(), target.content_root.as_ref()),
        (Ok(resolved_skill), Some(content_root))
            if resolved_skill != *content_root && resolved_skill.starts_with(content_root)
    )
}

async fn central_skills_in_bundle(
    pool: &DbPool,
    target: &CentralBundleTarget,
) -> Result<Vec<db::Skill>, String> {
    let mut skills = db::get_central_skills(pool)
        .await?
        .into_iter()
        .filter(|skill| skill_is_under_bundle(skill, target))
        .collect::<Vec<_>>();
    skills.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(skills)
}

fn remove_central_bundle_target(target: &CentralBundleTarget) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(&target.delete_path).map_err(|e| {
        format!(
            "Failed to read Central bundle path '{}': {}",
            target.delete_path.display(),
            e
        )
    })?;

    if metadata.file_type().is_symlink() {
        std::fs::remove_file(&target.delete_path)
            .map_err(|e| format!("Failed to remove Central bundle symlink: {}", e))
    } else if metadata.is_dir() {
        std::fs::remove_dir_all(&target.delete_path)
            .map_err(|e| format!("Failed to remove Central bundle directory: {}", e))
    } else {
        Err(format!(
            "Central bundle path '{}' is not removable",
            target.delete_path.display()
        ))
    }
}

fn path_resolves_to(path: &Path, target: &Path) -> bool {
    path.canonicalize()
        .ok()
        .zip(target.canonicalize().ok())
        .is_some_and(|(left, right)| left == right)
}

async fn is_shared_central_installation(
    pool: &DbPool,
    installation: &db::SkillInstallation,
    central_root: &Path,
    central_skill_dir: &Path,
) -> Result<bool, String> {
    if installation.agent_id == "central" {
        return Ok(true);
    }

    let agent = match db::get_agent_by_id(pool, &installation.agent_id).await? {
        Some(agent) => agent,
        None => return Ok(false),
    };
    let agent_dir = PathBuf::from(agent.global_skills_dir);
    if agent_dir
        .canonicalize()
        .ok()
        .is_some_and(|resolved| resolved == central_root)
    {
        return Ok(true);
    }

    Ok(installation.link_type == "copy"
        && path_resolves_to(Path::new(&installation.installed_path), central_skill_dir))
}

fn build_skill_directory_nodes(
    root: &Path,
    current: &Path,
    visited_dirs: &[PathBuf],
    allowed_roots: &[PathBuf],
) -> Result<Vec<SkillDirectoryNode>, String> {
    let entries = std::fs::read_dir(current)
        .map_err(|e| format!("Failed to read directory '{}': {}", current.display(), e))?;

    let mut nodes = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| {
            format!(
                "Failed to read directory entry in '{}': {}",
                current.display(),
                e
            )
        })?;
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|e| format!("Failed to read metadata for '{}': {}", path.display(), e))?;
        let is_dir = std::fs::metadata(&path)
            .map(|target_metadata| target_metadata.file_type().is_dir())
            .unwrap_or_else(|_| metadata.file_type().is_dir());
        let canonical_dir = if is_dir {
            Some(path.canonicalize().map_err(|e| {
                format!(
                    "Failed to resolve directory target '{}': {}",
                    path.display(),
                    e
                )
            })?)
        } else {
            None
        };

        if canonical_dir
            .as_ref()
            .is_some_and(|canonical| visited_dirs.iter().any(|visited| visited == canonical))
        {
            continue;
        }
        if canonical_dir
            .as_ref()
            .is_some_and(|canonical| {
                !allowed_roots
                    .iter()
                    .any(|allowed_root| is_path_under_root(canonical, allowed_root))
            })
        {
            continue;
        }

        let children = if is_dir {
            let mut next_visited = visited_dirs.to_vec();
            if let Some(canonical_dir) = canonical_dir.clone() {
                next_visited.push(canonical_dir);
            }
            build_skill_directory_nodes(root, &path, &next_visited, allowed_roots)?
        } else {
            Vec::new()
        };
        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .into_owned();

        nodes.push(SkillDirectoryNode {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            relative_path,
            is_dir,
            children,
        });
    }

    nodes.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a
            .name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.name.cmp(&b.name)),
    });

    Ok(nodes)
}

fn is_path_under_root(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn canonicalize_existing_path(path: &Path, label: &str) -> Result<PathBuf, String> {
    path.canonicalize()
        .map_err(|e| format!("Failed to resolve {} '{}': {}", label, path.display(), e))
}

fn canonical_skill_dir_from_file_path(file_path: &str) -> Option<PathBuf> {
    let parent = Path::new(file_path).parent()?;
    parent.canonicalize().ok()
}

fn canonical_skill_dir_from_dir_path(dir_path: &str) -> Option<PathBuf> {
    Path::new(dir_path).canonicalize().ok()
}

async fn skill_file_allowed_roots(
    pool: &DbPool,
    context: &SkillFileAccessContext,
) -> Result<Vec<PathBuf>, String> {
    let skill = db::get_skill_by_id(pool, &context.skill_id).await?;
    let mut roots = Vec::new();

    if let Some(skill) = skill.as_ref() {
        if let Some(root) = canonical_skill_dir_from_file_path(&skill.file_path) {
            roots.push(root);
        }
        if let Some(path) = skill.canonical_path.as_deref() {
            if let Some(root) = canonical_skill_dir_from_dir_path(path) {
                roots.push(root);
            }
        }
    }

    if let Some(agent_id) = context.agent_id.as_deref() {
        let observations = db::get_agent_skill_observations(pool, agent_id).await?;
        let matching_observations = observations
            .into_iter()
            .filter(|observation| observation.skill_id == context.skill_id)
            .filter(|observation| {
                context
                    .row_id
                    .as_deref()
                    .map(|row_id| observation.row_id == row_id)
                    .unwrap_or(true)
            });
        for observation in matching_observations {
            if let Some(root) = canonical_skill_dir_from_dir_path(&observation.dir_path) {
                roots.push(root);
            }
            if let Some(root) = canonical_skill_dir_from_file_path(&observation.file_path) {
                roots.push(root);
            }
        }
    }

    for installation in db::get_skill_installations(pool, &context.skill_id).await? {
        if context
            .agent_id
            .as_deref()
            .map(|agent_id| installation.agent_id != agent_id)
            .unwrap_or(false)
        {
            continue;
        }
        if let Some(root) = canonical_skill_dir_from_dir_path(&installation.installed_path) {
            roots.push(root);
        }
    }

    roots.sort();
    roots.dedup();
    if roots.is_empty() {
        Err(format!(
            "No readable Skill directory found for '{}'",
            context.skill_id
        ))
    } else {
        Ok(roots)
    }
}

async fn authorize_skill_file_path(
    pool: &DbPool,
    path: &str,
    context: &SkillFileAccessContext,
) -> Result<(PathBuf, Vec<PathBuf>), String> {
    let target = canonicalize_existing_path(Path::new(path), "path")?;
    let roots = skill_file_allowed_roots(pool, context).await?;
    if roots.iter().any(|root| is_path_under_root(&target, root)) {
        Ok((target, roots))
    } else {
        Err("Path is outside the allowed Skill directories".to_string())
    }
}

fn observation_conflict_group(agent_id: &str, skill_id: &str) -> String {
    format!("{agent_id}::{skill_id}")
}

fn observation_conflict_counts(observations: &[db::AgentSkillObservation]) -> HashMap<String, i64> {
    let mut counts = HashMap::new();
    for observation in observations {
        *counts.entry(observation.skill_id.clone()).or_insert(0) += 1;
    }
    counts
}

fn observation_conflict_metadata(
    agent_id: &str,
    skill_id: &str,
    counts: &HashMap<String, i64>,
) -> (Option<String>, i64) {
    let count = counts.get(skill_id).copied().unwrap_or(0);
    if count > 1 {
        (Some(observation_conflict_group(agent_id, skill_id)), count)
    } else {
        (None, 0)
    }
}

fn installation_details(installations: Vec<db::SkillInstallation>) -> Vec<SkillInstallationDetail> {
    installations
        .into_iter()
        .map(|i| SkillInstallationDetail {
            skill_id: i.skill_id,
            agent_id: i.agent_id,
            installed_path: i.installed_path,
            link_type: i.link_type,
            symlink_target: i.symlink_target,
            installed_at: i.created_at,
        })
        .collect()
}

async fn read_only_agent_ids_for_skill(
    pool: &DbPool,
    skill_id: &str,
    is_central: bool,
) -> Result<Vec<String>, String> {
    let mut agent_ids: BTreeSet<String> =
        db::get_read_only_observed_agent_ids_for_skill(pool, skill_id)
            .await?
            .into_iter()
            .collect();

    if is_central {
        for agent in db::get_all_agents(pool).await? {
            if agent.is_enabled && db::agent_supports_universal_agents_skills(&agent.id) {
                agent_ids.insert(agent.id);
            }
        }
    }

    for installation in db::get_skill_installations(pool, skill_id).await? {
        agent_ids.remove(&installation.agent_id);
    }

    Ok(agent_ids.into_iter().collect())
}

async fn get_observation_detail(
    pool: &DbPool,
    skill_id: &str,
    agent_id: &str,
    row_id: Option<&str>,
) -> Result<Option<SkillDetail>, String> {
    let observations = db::get_agent_skill_observations(pool, agent_id).await?;
    if observations.is_empty() {
        return Ok(None);
    }

    let conflict_counts = observation_conflict_counts(&observations);
    let matches: Vec<db::AgentSkillObservation> = observations
        .into_iter()
        .filter(|observation| observation.skill_id == skill_id)
        .collect();

    if matches.is_empty() {
        return Ok(None);
    }

    let observation = match row_id {
        Some(row_id) => matches
            .into_iter()
            .find(|observation| observation.row_id == row_id)
            .ok_or_else(|| {
                format!(
                    "Observation row '{}' not found for skill '{}'",
                    row_id, skill_id
                )
            })?,
        None if matches.len() == 1 => matches.into_iter().next().expect("single match"),
        None => {
            return Err(format!(
                "Multiple observed rows found for skill '{}'; row_id is required",
                skill_id
            ))
        }
    };

    let manageable_skill = db::get_skill_by_id(pool, &observation.skill_id).await?;
    let installations = if observation.is_read_only {
        Vec::new()
    } else {
        installation_details(db::get_skill_installations(pool, &observation.skill_id).await?)
    };
    let collections = if observation.is_read_only {
        Vec::new()
    } else {
        db::get_skill_collections(pool, &observation.skill_id).await?
    };
    let (conflict_group, conflict_count) =
        observation_conflict_metadata(agent_id, &observation.skill_id, &conflict_counts);

    Ok(Some(SkillDetail {
        row_id: observation.row_id,
        id: observation.skill_id.clone(),
        name: observation.name,
        description: observation.description.or_else(|| {
            manageable_skill
                .as_ref()
                .and_then(|skill| skill.description.clone())
        }),
        file_path: observation.file_path,
        dir_path: observation.dir_path,
        canonical_path: if observation.is_read_only {
            None
        } else {
            manageable_skill
                .as_ref()
                .and_then(|skill| skill.canonical_path.clone())
        },
        is_central: manageable_skill
            .as_ref()
            .map(|skill| skill.is_central)
            .unwrap_or(false),
        source: manageable_skill
            .as_ref()
            .and_then(|skill| skill.source.clone())
            .or_else(|| Some(observation.link_type.clone())),
        scanned_at: observation.scanned_at,
        source_kind: Some(observation.source_kind),
        source_root: Some(observation.source_root),
        is_read_only: observation.is_read_only,
        conflict_group,
        conflict_count,
        read_only_agents: Vec::new(),
        installations,
        collections,
    }))
}

async fn get_skill_detail_with_row_impl(
    pool: &DbPool,
    skill_id: &str,
    agent_id: Option<&str>,
    row_id: Option<&str>,
) -> Result<SkillDetail, String> {
    if let Some(agent_id) = agent_id {
        if let Some(detail) = get_observation_detail(pool, skill_id, agent_id, row_id).await? {
            return Ok(detail);
        }
    }

    let skill = db::get_skill_by_id(pool, skill_id)
        .await?
        .ok_or_else(|| format!("Skill '{}' not found", skill_id))?;

    let row_id = skill.id.clone();
    let dir_path = skill_dir_path(&skill);
    let installations = installation_details(db::get_skill_installations(pool, skill_id).await?);
    let collections = db::get_skill_collections(pool, skill_id).await?;
    let read_only_agents = read_only_agent_ids_for_skill(pool, skill_id, skill.is_central).await?;

    Ok(SkillDetail {
        row_id,
        id: skill.id,
        name: skill.name,
        description: skill.description,
        file_path: skill.file_path,
        dir_path,
        canonical_path: skill.canonical_path,
        is_central: skill.is_central,
        source: skill.source,
        scanned_at: skill.scanned_at,
        source_kind: None,
        source_root: None,
        is_read_only: false,
        conflict_group: None,
        conflict_count: 0,
        read_only_agents,
        installations,
        collections,
    })
}

/// Testable core implementation of `get_skills_by_agent`.
///
/// Returns skills for the given agent enriched with installation metadata
/// (`dir_path`, `link_type`, `symlink_target`) so the frontend `SkillCard`
/// can display the correct source indicator.
pub async fn get_skills_by_agent_impl(
    pool: &DbPool,
    agent_id: &str,
) -> Result<Vec<SkillForAgent>, String> {
    db::get_skills_for_agent(pool, agent_id).await
}

/// Tauri command: return all skills installed for a given agent, including
/// installation metadata needed by the platform-view skill cards.
#[tauri::command]
pub async fn get_skills_by_agent(
    state: State<'_, SkillsAppState>,
    agent_id: String,
) -> Result<Vec<SkillForAgent>, String> {
    get_skills_by_agent_impl(&state.db, &agent_id).await
}

async fn skill_with_links(pool: &DbPool, skill: db::Skill) -> Result<SkillWithLinks, String> {
    let installations = db::get_skill_installations(pool, &skill.id).await?;
    let linked_agents: Vec<String> = installations.into_iter().map(|i| i.agent_id).collect();
    let read_only_agents = read_only_agent_ids_for_skill(pool, &skill.id, skill.is_central).await?;
    let (created_at, updated_at) = skill_filesystem_timestamps(&skill);

    Ok(SkillWithLinks {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        file_path: skill.file_path,
        canonical_path: skill.canonical_path,
        is_central: skill.is_central,
        source: skill.source,
        scanned_at: skill.scanned_at,
        created_at,
        updated_at,
        linked_agents,
        read_only_agents,
    })
}

fn scan_count_for_bundle(target: &CentralBundleTarget) -> usize {
    scan_skill_root(&target.entry_path, true, ScanDirectoryOptions::nested()).len()
}

async fn central_skill_bundle_from_target(
    pool: &DbPool,
    target: &CentralBundleTarget,
    skills: &[db::Skill],
    scanned_skill_count: usize,
) -> Result<CentralSkillBundle, String> {
    let mut linked_agents = BTreeSet::new();
    let mut read_only_agents = BTreeSet::new();

    for skill in skills {
        for installation in db::get_skill_installations(pool, &skill.id).await? {
            linked_agents.insert(installation.agent_id);
        }
        for agent_id in read_only_agent_ids_for_skill(pool, &skill.id, skill.is_central).await? {
            read_only_agents.insert(agent_id);
        }
    }

    let name = Path::new(&target.relative_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&target.relative_path)
        .to_string();

    Ok(CentralSkillBundle {
        name,
        relative_path: target.relative_path.clone(),
        path: target.delete_path.to_string_lossy().into_owned(),
        is_symlink: target.is_symlink,
        skill_count: scanned_skill_count.max(skills.len()),
        linked_agent_count: linked_agents.len(),
        read_only_agent_count: read_only_agents.len(),
    })
}

async fn central_bundle_preview_for_target(
    pool: &DbPool,
    target: CentralBundleTarget,
) -> Result<CentralSkillBundleDeletePreview, String> {
    let skills = central_skills_in_bundle(pool, &target).await?;
    let scanned_skill_count = scan_count_for_bundle(&target);

    if skills.is_empty() && scanned_skill_count == 0 {
        return Err(format!(
            "No Central Skills found under bundle '{}'",
            target.relative_path
        ));
    }

    let bundle =
        central_skill_bundle_from_target(pool, &target, &skills, scanned_skill_count).await?;
    let mut affected_agents = BTreeSet::new();
    let mut skipped_read_only_agents = BTreeSet::new();
    let mut skills_with_links = Vec::with_capacity(skills.len());

    for skill in skills {
        let linked = skill_with_links(pool, skill).await?;
        affected_agents.extend(linked.linked_agents.iter().cloned());
        skipped_read_only_agents.extend(linked.read_only_agents.iter().cloned());
        skills_with_links.push(linked);
    }

    Ok(CentralSkillBundleDeletePreview {
        bundle,
        skills: skills_with_links,
        affected_agents: affected_agents.into_iter().collect(),
        skipped_read_only_agents: skipped_read_only_agents.into_iter().collect(),
    })
}

/// Tauri command: return all Central Skills with per-platform link status.
///
/// For each skill in the central skills directory, the response includes a
/// `linked_agents` array listing every agent that has an installation record
/// for that skill (regardless of whether the link type is symlink or copy).
#[tauri::command]
pub async fn get_central_skills(state: State<'_, SkillsAppState>) -> Result<Vec<SkillWithLinks>, String> {
    let skills = db::get_central_skills(&state.db).await?;

    let mut result = Vec::with_capacity(skills.len());
    for skill in skills {
        result.push(skill_with_links(&state.db, skill).await?);
    }

    Ok(result)
}

pub async fn save_central_skill_impl(
    pool: &DbPool,
    input: SaveCentralSkillInput,
) -> Result<SaveCentralSkillResult, String> {
    let skill_md = input.skill_md.trim();
    if skill_md.is_empty() {
        return Err("SKILL.md content cannot be empty".to_string());
    }

    let name = skill_md_frontmatter_name(skill_md)?;
    let skill_id = sanitize_central_skill_id(input.skill_id.as_deref().unwrap_or(&name))?;
    let central_root = ensure_central_root_path(pool).await?;

    let target_dir = central_root.join(&skill_id);
    if let Some(existing) = db::get_skill_by_id(pool, &skill_id).await? {
        if existing.is_central {
            let existing_dir = skill_directory_path_buf(&existing);
            let existing_dir = existing_dir.canonicalize().unwrap_or(existing_dir);
            ensure_under_central_root(&existing_dir, &central_root)?;
        } else {
            return Err(format!("Skill ID '{}' is already used outside Central Skills", skill_id));
        }
    }

    validate_central_skill_save_target(&target_dir, &central_root)?;
    std::fs::create_dir_all(&target_dir).map_err(|e| {
        format!(
            "Failed to create Central Skill directory '{}': {}",
            target_dir.display(),
            e
        )
    })?;

    let file_path = target_dir.join("SKILL.md");
    std::fs::write(&file_path, format!("{}\n", skill_md)).map_err(|e| {
        format!(
            "Failed to write Central Skill '{}': {}",
            file_path.display(),
            e
        )
    })?;

    scan_all_skills_impl(pool).await?;

    Ok(SaveCentralSkillResult {
        skill_id,
        file_path: file_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn save_central_skill(
    state: State<'_, SkillsAppState>,
    input: SaveCentralSkillInput,
) -> Result<SaveCentralSkillResult, String> {
    save_central_skill_impl(&state.db, input).await
}

pub async fn get_central_skill_bundles_impl(
    pool: &DbPool,
) -> Result<Vec<CentralSkillBundle>, String> {
    let central_root = ensure_central_root_path(pool).await?;
    let entries = std::fs::read_dir(&central_root).map_err(|e| {
        format!(
            "Failed to read Central Skills root '{}': {}",
            central_root.display(),
            e
        )
    })?;

    let mut bundles = Vec::new();
    for entry in entries.flatten() {
        let entry_path = entry.path();
        let Ok(metadata) = std::fs::symlink_metadata(&entry_path) else {
            continue;
        };
        if !metadata.file_type().is_symlink() && !metadata.is_dir() {
            continue;
        }
        if entry_path.join("SKILL.md").exists() {
            continue;
        }

        let relative_path = entry.file_name().to_string_lossy().into_owned();
        let Ok(target) = validate_central_bundle_target(&relative_path, &central_root) else {
            continue;
        };
        let scanned_skill_count = scan_count_for_bundle(&target);
        let skills = central_skills_in_bundle(pool, &target).await?;
        if scanned_skill_count == 0 && skills.is_empty() {
            continue;
        }

        bundles.push(
            central_skill_bundle_from_target(pool, &target, &skills, scanned_skill_count).await?,
        );
    }

    bundles.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(bundles)
}

#[tauri::command]
pub async fn get_central_skill_bundles(
    state: State<'_, SkillsAppState>,
) -> Result<Vec<CentralSkillBundle>, String> {
    get_central_skill_bundles_impl(&state.db).await
}

pub async fn get_central_skill_bundle_detail_impl(
    pool: &DbPool,
    relative_path: &str,
) -> Result<CentralSkillBundleDetail, String> {
    let central_root = ensure_central_root_path(pool).await?;
    let target = validate_central_bundle_target(relative_path, &central_root)?;
    let skills = central_skills_in_bundle(pool, &target).await?;
    let scanned_skill_count = scan_count_for_bundle(&target);

    if skills.is_empty() && scanned_skill_count == 0 {
        return Err(format!(
            "No Central Skills found under bundle '{}'",
            target.relative_path
        ));
    }

    let bundle =
        central_skill_bundle_from_target(pool, &target, &skills, scanned_skill_count).await?;
    let mut skills_with_links = Vec::with_capacity(skills.len());
    for skill in skills {
        skills_with_links.push(skill_with_links(pool, skill).await?);
    }

    Ok(CentralSkillBundleDetail {
        bundle,
        skills: skills_with_links,
    })
}

#[tauri::command]
pub async fn get_central_skill_bundle_detail(
    state: State<'_, SkillsAppState>,
    relative_path: String,
) -> Result<CentralSkillBundleDetail, String> {
    get_central_skill_bundle_detail_impl(&state.db, &relative_path).await
}

pub async fn preview_delete_central_skill_bundle_impl(
    pool: &DbPool,
    relative_path: &str,
) -> Result<CentralSkillBundleDeletePreview, String> {
    let central_root = ensure_central_root_path(pool).await?;
    let target = validate_central_bundle_target(relative_path, &central_root)?;
    central_bundle_preview_for_target(pool, target).await
}

#[tauri::command]
pub async fn preview_delete_central_skill_bundle(
    state: State<'_, SkillsAppState>,
    relative_path: String,
) -> Result<CentralSkillBundleDeletePreview, String> {
    preview_delete_central_skill_bundle_impl(&state.db, &relative_path).await
}

pub async fn delete_central_skill_bundle_impl(
    pool: &DbPool,
    relative_path: &str,
    options: DeleteCentralSkillBundleOptions,
) -> Result<DeleteCentralSkillBundleResult, String> {
    let central_root = ensure_central_root_path(pool).await?;
    let target = validate_central_bundle_target(relative_path, &central_root)?;
    let preview = central_bundle_preview_for_target(pool, target.clone()).await?;
    let skills = central_skills_in_bundle(pool, &target).await?;

    if !options.cascade_uninstall && !preview.affected_agents.is_empty() {
        return Err(format!(
            "Bundle skills are installed on agents: {}",
            preview.affected_agents.join(", ")
        ));
    }

    let mut uninstalled_agents = BTreeSet::new();
    if options.cascade_uninstall {
        for skill in &skills {
            let central_skill_dir = skill_directory_path_buf(skill);
            let installations = db::get_skill_installations(pool, &skill.id).await?;
            for installation in installations {
                if is_shared_central_installation(
                    pool,
                    &installation,
                    &central_root,
                    &central_skill_dir,
                )
                .await?
                {
                    continue;
                }

                uninstall_skill_from_agent_impl(pool, &skill.id, &installation.agent_id).await?;
                uninstalled_agents.insert(installation.agent_id);
            }
        }
    }

    remove_central_bundle_target(&target)?;

    let mut removed_skill_ids = Vec::with_capacity(skills.len());
    for skill in &skills {
        db::delete_central_skill_records(pool, &skill.id, &skill.name).await?;
        removed_skill_ids.push(skill.id.clone());
    }

    let removed_kind = target.removed_kind().to_string();

    Ok(DeleteCentralSkillBundleResult {
        relative_path: target.relative_path,
        removed_bundle_path: target.delete_path.to_string_lossy().into_owned(),
        removed_kind,
        removed_skill_ids,
        uninstalled_agents: uninstalled_agents.into_iter().collect(),
        skipped_read_only_agents: preview.skipped_read_only_agents,
    })
}

#[tauri::command]
pub async fn delete_central_skill_bundle(
    state: State<'_, SkillsAppState>,
    relative_path: String,
    options: Option<DeleteCentralSkillBundleOptions>,
) -> Result<DeleteCentralSkillBundleResult, String> {
    delete_central_skill_bundle_impl(
        &state.db,
        &relative_path,
        options.unwrap_or(DeleteCentralSkillBundleOptions {
            cascade_uninstall: false,
        }),
    )
    .await
}

pub async fn delete_central_skill_impl(
    pool: &DbPool,
    skill_id: &str,
    options: DeleteCentralSkillOptions,
) -> Result<DeleteCentralSkillResult, String> {
    let skill = db::get_skill_by_id(pool, skill_id)
        .await?
        .ok_or_else(|| format!("Skill '{}' not found", skill_id))?;

    if !skill.is_central {
        return Err(format!("Skill '{}' is not central", skill_id));
    }

    let central = db::get_agent_by_id(pool, "central")
        .await?
        .ok_or_else(|| "Central agent not found in database".to_string())?;
    let central_root = PathBuf::from(&central.global_skills_dir)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Central Skills root: {}", e))?;
    let canonical_dir = canonical_delete_dir(&skill, &central_root);
    let delete_target = validate_central_delete_target(&canonical_dir, &central_root)?;

    let installations = db::get_skill_installations(pool, skill_id).await?;
    if !options.cascade_uninstall && !installations.is_empty() {
        let agents = installations
            .iter()
            .map(|installation| installation.agent_id.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!("Skill is installed on agents: {}", agents));
    }

    let skipped_read_only_agents = read_only_agent_ids_for_skill(pool, skill_id, true).await?;
    let mut uninstalled_agents = Vec::new();

    if options.cascade_uninstall {
        for installation in &installations {
            if is_shared_central_installation(pool, installation, &central_root, &delete_target)
                .await?
            {
                continue;
            }

            uninstall_skill_from_agent_impl(pool, skill_id, &installation.agent_id).await?;
            uninstalled_agents.push(installation.agent_id.clone());
        }
    }

    remove_central_skill_dir(&delete_target)?;
    db::delete_central_skill_records(pool, skill_id, &skill.name).await?;

    Ok(DeleteCentralSkillResult {
        skill_id: skill_id.to_string(),
        removed_canonical_path: delete_target.to_string_lossy().into_owned(),
        uninstalled_agents,
        skipped_read_only_agents,
    })
}

#[tauri::command]
pub async fn delete_central_skill(
    state: State<'_, SkillsAppState>,
    skill_id: String,
    options: Option<DeleteCentralSkillOptions>,
) -> Result<DeleteCentralSkillResult, String> {
    delete_central_skill_impl(
        &state.db,
        &skill_id,
        options.unwrap_or(DeleteCentralSkillOptions {
            cascade_uninstall: false,
        }),
    )
    .await
}

/// Tauri command: return detailed information about a skill, including all
/// installation records across agents. Each installation includes `installed_at`
/// (the `created_at` timestamp from the DB, renamed for frontend clarity).
#[tauri::command]
pub async fn get_skill_detail(
    state: State<'_, SkillsAppState>,
    skill_id: String,
    agent_id: Option<String>,
    row_id: Option<String>,
) -> Result<SkillDetail, String> {
    get_skill_detail_with_row_impl(&state.db, &skill_id, agent_id.as_deref(), row_id.as_deref())
        .await
}

/// Tauri command: read and return the raw content of a skill's `SKILL.md` file.
#[tauri::command]
pub async fn read_skill_content(
    state: State<'_, SkillsAppState>,
    skill_id: String,
) -> Result<String, String> {
    let skill = db::get_skill_by_id(&state.db, &skill_id)
        .await?
        .ok_or_else(|| format!("Skill '{}' not found", skill_id))?;

    std::fs::read_to_string(&skill.file_path)
        .map_err(|e| format!("Failed to read '{}': {}", skill.file_path, e))
}

#[tauri::command]
pub async fn read_file_by_path(
    state: State<'_, SkillsAppState>,
    path: String,
    context: SkillFileAccessContext,
) -> Result<String, String> {
    read_file_by_path_impl(&state.db, &path, &context).await
}

async fn read_file_by_path_impl(
    pool: &DbPool,
    path: &str,
    context: &SkillFileAccessContext,
) -> Result<String, String> {
    let (authorized_path, _) = authorize_skill_file_path(pool, path, context).await?;
    std::fs::read_to_string(&authorized_path)
        .map_err(|e| format!("Failed to read '{}': {}", authorized_path.display(), e))
}

#[tauri::command]
pub async fn list_skill_directory(
    state: State<'_, SkillsAppState>,
    dir_path: String,
    context: SkillFileAccessContext,
) -> Result<Vec<SkillDirectoryNode>, String> {
    list_skill_directory_impl(&state.db, &dir_path, &context).await
}

async fn list_skill_directory_impl(
    pool: &DbPool,
    dir_path: &str,
    context: &SkillFileAccessContext,
) -> Result<Vec<SkillDirectoryNode>, String> {
    let root = Path::new(&dir_path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", dir_path));
    }
    if !root.is_dir() {
        return Err(format!("Path is not a directory: {}", dir_path));
    }

    let (canonical_root, allowed_roots) =
        authorize_skill_file_path(pool, dir_path, context).await?;
    if !canonical_root.is_dir() {
        return Err(format!("Path is not a directory: {}", dir_path));
    }
    if !allowed_roots
        .iter()
        .any(|allowed_root| canonical_root == *allowed_root)
    {
        return Err("Directory listing is limited to the Skill root".to_string());
    }

    build_skill_directory_nodes(root, root, &[canonical_root], &allowed_roots)
}

#[tauri::command]
pub async fn open_in_file_manager(
    state: State<'_, SkillsAppState>,
    path: String,
    context: SkillFileAccessContext,
) -> Result<(), String> {
    open_in_file_manager_checked_impl(&state.db, &path, &context).await
}

async fn open_in_file_manager_checked_impl(
    pool: &DbPool,
    path: &str,
    context: &SkillFileAccessContext,
) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    authorize_skill_file_path(pool, path, context).await?;
    open_in_file_manager_impl(path)
}

fn open_in_file_manager_impl(path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    Ok(())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::linker::create_symlink;
    use crate::skills::db::{self, AgentSkillObservation, Skill, SkillInstallation};
    use chrono::Utc;
    use sqlx::SqlitePool;
    use std::{fs, path::Path};
    use tempfile::TempDir;

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        db::init_database(&pool).await.unwrap();
        pool
    }

    fn expected_universal_read_only_agents(extra: &[&str]) -> Vec<String> {
        let agent_ids = db::UNIVERSAL_AGENTS_SKILLS_AGENT_IDS
            .iter()
            .chain(extra.iter())
            .map(|agent_id| (*agent_id).to_string())
            .collect::<std::collections::BTreeSet<_>>();
        agent_ids.into_iter().collect()
    }

    fn make_skill(id: &str, name: &str, is_central: bool) -> Skill {
        Skill {
            id: id.to_string(),
            name: name.to_string(),
            description: Some(format!("Desc for {}", name)),
            file_path: format!("/tmp/{}/SKILL.md", id),
            canonical_path: if is_central {
                Some(format!("/tmp/central/{}", id))
            } else {
                None
            },
            is_central,
            source: if is_central {
                Some("native".to_string())
            } else {
                Some("copy".to_string())
            },
            content: None,
            scanned_at: Utc::now().to_rfc3339(),
        }
    }

    fn make_observation(
        row_id: &str,
        skill_id: &str,
        name: &str,
        dir_path: &str,
        source_kind: &str,
        read_only: bool,
    ) -> AgentSkillObservation {
        AgentSkillObservation {
            row_id: row_id.to_string(),
            agent_id: "claude-code".to_string(),
            skill_id: skill_id.to_string(),
            name: name.to_string(),
            description: Some(format!("{source_kind} copy")),
            file_path: format!("{dir_path}/SKILL.md"),
            dir_path: dir_path.to_string(),
            source_kind: source_kind.to_string(),
            source_root: if source_kind == "user" {
                "/tmp/.claude/skills".to_string()
            } else {
                "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0".to_string()
            },
            link_type: "copy".to_string(),
            symlink_target: None,
            is_read_only: read_only,
            scanned_at: Utc::now().to_rfc3339(),
        }
    }

    fn make_observation_for_agent(
        agent_id: &str,
        row_id: &str,
        skill_id: &str,
        name: &str,
        dir_path: &str,
        source_kind: &str,
        source_root: &str,
        read_only: bool,
    ) -> AgentSkillObservation {
        AgentSkillObservation {
            row_id: row_id.to_string(),
            agent_id: agent_id.to_string(),
            skill_id: skill_id.to_string(),
            name: name.to_string(),
            description: Some(format!("{source_kind} copy")),
            file_path: format!("{dir_path}/SKILL.md"),
            dir_path: dir_path.to_string(),
            source_kind: source_kind.to_string(),
            source_root: source_root.to_string(),
            link_type: "copy".to_string(),
            symlink_target: None,
            is_read_only: read_only,
            scanned_at: Utc::now().to_rfc3339(),
        }
    }

    fn file_context(
        skill_id: &str,
        agent_id: Option<&str>,
        row_id: Option<&str>,
    ) -> SkillFileAccessContext {
        SkillFileAccessContext {
            skill_id: skill_id.to_string(),
            agent_id: agent_id.map(str::to_string),
            row_id: row_id.map(str::to_string),
        }
    }

    async fn set_agent_dir(pool: &SqlitePool, agent_id: &str, dir: &Path) {
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = ?")
            .bind(dir.to_string_lossy().into_owned())
            .bind(agent_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn create_central_skill(pool: &SqlitePool, central_dir: &Path, skill_id: &str) -> Skill {
        let skill_dir = central_dir.join(skill_id);
        fs::create_dir_all(&skill_dir).unwrap();
        let skill_md_path = skill_dir.join("SKILL.md");
        fs::write(
            &skill_md_path,
            format!("---\nname: {skill_id}\ndescription: Test skill\n---\n\n# {skill_id}\n"),
        )
        .unwrap();

        let skill = Skill {
            id: skill_id.to_string(),
            name: skill_id.to_string(),
            description: Some("Test skill".to_string()),
            file_path: skill_md_path.to_string_lossy().into_owned(),
            canonical_path: Some(skill_dir.to_string_lossy().into_owned()),
            is_central: true,
            source: Some("native".to_string()),
            content: None,
            scanned_at: Utc::now().to_rfc3339(),
        };
        db::upsert_skill(pool, &skill).await.unwrap();
        skill
    }

    #[tokio::test]
    async fn save_central_skill_creates_missing_central_root() {
        let pool = setup_test_db().await;
        let temp = TempDir::new().unwrap();
        let central_dir = temp.path().join("missing-central-root");
        set_agent_dir(&pool, "central", &central_dir).await;

        let result = save_central_skill_impl(
            &pool,
            SaveCentralSkillInput {
                skill_id: Some("fresh-root".to_string()),
                skill_md: "---\nname: Fresh Root\ndescription: Saved into a missing root\n---\n\n# Fresh Root"
                    .to_string(),
            },
        )
        .await
        .unwrap();

        let skill_file = central_dir.join("fresh-root").join("SKILL.md");
        assert_eq!(result.skill_id, "fresh-root");
        assert!(skill_file.exists());
        let expected_skill_file = skill_file.canonicalize().unwrap_or(skill_file);
        assert_eq!(result.file_path, expected_skill_file.to_string_lossy());

        let skill = db::get_skill_by_id(&pool, "fresh-root")
            .await
            .unwrap()
            .unwrap();
        assert!(skill.is_central);
        assert_eq!(skill.name, "Fresh Root");
    }

    #[tokio::test]
    async fn save_central_skill_rejects_symlink_target() {
        let pool = setup_test_db().await;
        let temp = TempDir::new().unwrap();
        let central_dir = temp.path().join("central");
        let outside_dir = temp.path().join("outside");
        fs::create_dir_all(&central_dir).unwrap();
        fs::create_dir_all(&outside_dir).unwrap();
        set_agent_dir(&pool, "central", &central_dir).await;
        create_symlink(&outside_dir, &central_dir.join("escape")).unwrap();

        let result = save_central_skill_impl(
            &pool,
            SaveCentralSkillInput {
                skill_id: Some("escape".to_string()),
                skill_md: "---\nname: Escape\ndescription: Should not write through a symlink\n---\n\n# Escape"
                    .to_string(),
            },
        )
        .await;

        assert!(result.unwrap_err().contains("refusing to write through it"));
        assert!(!outside_dir.join("SKILL.md").exists());
        assert!(db::get_skill_by_id(&pool, "escape").await.unwrap().is_none());
    }

    async fn create_nested_central_skill(
        pool: &SqlitePool,
        bundle_dir: &Path,
        skill_id: &str,
    ) -> Skill {
        let skill_dir = bundle_dir.join(skill_id);
        fs::create_dir_all(&skill_dir).unwrap();
        let skill_md_path = skill_dir.join("SKILL.md");
        fs::write(
            &skill_md_path,
            format!("---\nname: {skill_id}\ndescription: Nested test skill\n---\n\n# {skill_id}\n"),
        )
        .unwrap();

        let skill = Skill {
            id: skill_id.to_string(),
            name: skill_id.to_string(),
            description: Some("Nested test skill".to_string()),
            file_path: skill_md_path.to_string_lossy().into_owned(),
            canonical_path: Some(skill_dir.to_string_lossy().into_owned()),
            is_central: true,
            source: Some("native".to_string()),
            content: None,
            scanned_at: Utc::now().to_rfc3339(),
        };
        db::upsert_skill(pool, &skill).await.unwrap();
        skill
    }

    // ── get_skills_by_agent ───────────────────────────────────────────────────

    #[tokio::test]
    async fn test_get_skills_by_agent_returns_correct_skills() {
        let pool = setup_test_db().await;

        let skill_a = make_skill("skill-a", "Skill A", false);
        let skill_b = make_skill("skill-b", "Skill B", false);
        db::upsert_skill(&pool, &skill_a).await.unwrap();
        db::upsert_skill(&pool, &skill_b).await.unwrap();

        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "skill-a".to_string(),
                agent_id: "claude-code".to_string(),
                installed_path: "/tmp/claude/skill-a/SKILL.md".to_string(),
                link_type: "symlink".to_string(),
                symlink_target: Some("/tmp/central/skill-a".to_string()),
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let skills = db::get_skills_by_agent(&pool, "claude-code").await.unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "skill-a");
    }

    #[tokio::test]
    async fn test_get_skills_by_agent_empty_for_unknown_agent() {
        let pool = setup_test_db().await;
        let skills = db::get_skills_by_agent(&pool, "nonexistent-agent")
            .await
            .unwrap();
        assert!(skills.is_empty());
    }

    // ── get_central_skills ────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_get_central_skills_includes_linked_agents() {
        let pool = setup_test_db().await;

        let central_skill = make_skill("central-a", "Central A", true);
        db::upsert_skill(&pool, &central_skill).await.unwrap();

        // Install to claude-code and cursor.
        for agent_id in &["claude-code", "cursor"] {
            db::upsert_skill_installation(
                &pool,
                &SkillInstallation {
                    skill_id: "central-a".to_string(),
                    agent_id: agent_id.to_string(),
                    installed_path: format!("/tmp/{}/central-a/SKILL.md", agent_id),
                    link_type: "symlink".to_string(),
                    symlink_target: Some("/tmp/central/central-a".to_string()),
                    created_at: Utc::now().to_rfc3339(),
                },
            )
            .await
            .unwrap();
        }

        let skills_with_links = get_central_skills_impl(&pool).await.unwrap();
        assert_eq!(skills_with_links.len(), 1);

        let mut linked = skills_with_links[0].linked_agents.clone();
        linked.sort();
        assert_eq!(linked, vec!["claude-code", "cursor"]);
    }

    #[tokio::test]
    async fn test_get_central_skills_no_links() {
        let pool = setup_test_db().await;

        let central_skill = make_skill("central-solo", "Solo Central", true);
        db::upsert_skill(&pool, &central_skill).await.unwrap();

        let skills_with_links = get_central_skills_impl(&pool).await.unwrap();
        assert_eq!(skills_with_links.len(), 1);
        assert!(
            skills_with_links[0].linked_agents.is_empty(),
            "no links when no installations"
        );
    }

    #[tokio::test]
    async fn test_get_central_skills_ignores_claude_plugin_observations() {
        let pool = setup_test_db().await;

        let central_skill = make_skill("shared-skill", "Shared Skill", true);
        db::upsert_skill(&pool, &central_skill).await.unwrap();
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "plugin",
                true,
            ),
        )
        .await
        .unwrap();

        let skills_with_links = get_central_skills_impl(&pool).await.unwrap();
        assert_eq!(skills_with_links.len(), 1);
        assert!(
            skills_with_links[0].linked_agents.is_empty(),
            "plugin observations must not pollute linked_agents state"
        );
    }

    #[tokio::test]
    async fn test_get_central_skills_reports_factory_compatibility_as_read_only_agent() {
        let pool = setup_test_db().await;

        let central_skill = make_skill("shared-skill", "Shared Skill", true);
        db::upsert_skill(&pool, &central_skill).await.unwrap();
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation_for_agent(
                "factory-droid",
                "factory-droid::/tmp/.agents/skills/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.agents/skills/shared-skill",
                "compatibility",
                "/tmp/.agents/skills",
                true,
            ),
        )
        .await
        .unwrap();

        let skills_with_links = get_central_skills_impl(&pool).await.unwrap();
        assert_eq!(skills_with_links.len(), 1);
        assert!(
            skills_with_links[0].linked_agents.is_empty(),
            "read-only compatibility observations are not removable installation links"
        );
        assert_eq!(
            skills_with_links[0].read_only_agents,
            expected_universal_read_only_agents(&["factory-droid"])
        );
    }

    #[tokio::test]
    async fn test_get_central_skills_excludes_non_central() {
        let pool = setup_test_db().await;

        let central = make_skill("c-skill", "Central", true);
        let non_central = make_skill("nc-skill", "Non-Central", false);
        db::upsert_skill(&pool, &central).await.unwrap();
        db::upsert_skill(&pool, &non_central).await.unwrap();

        let skills_with_links = get_central_skills_impl(&pool).await.unwrap();
        assert_eq!(
            skills_with_links.len(),
            1,
            "only central skills should be returned"
        );
        assert_eq!(skills_with_links[0].id, "c-skill");
    }

    // ── delete_central_skill ──────────────────────────────────────────────────

    #[tokio::test]
    async fn test_delete_central_skill_removes_files_and_related_rows() {
        let tmp = TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        fs::create_dir_all(&central_dir).unwrap();
        let pool = setup_test_db().await;
        set_agent_dir(&pool, "central", &central_dir).await;
        create_central_skill(&pool, &central_dir, "delete-me").await;

        let collection = db::create_collection(&pool, "Cleanup", None).await.unwrap();
        db::add_skill_to_collection(&pool, &collection.id, "delete-me")
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO skill_explanations (skill_id, explanation, lang, model, created_at, updated_at)
             VALUES ('delete-me', 'cached', 'en', 'test-model', 'now', 'now')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO skill_registries
             (id, name, source_type, url, is_builtin, is_enabled, last_sync_status, created_at)
             VALUES ('test-registry', 'Test Registry', 'github', 'https://example.com/repo', 0, 1, 'success', 'now')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO marketplace_skills
             (id, registry_id, name, description, download_url, is_installed, synced_at)
             VALUES ('test-registry::delete-me', 'test-registry', 'delete-me', NULL, 'https://example.com/SKILL.md', 1, 'now')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let result = delete_central_skill_impl(
            &pool,
            "delete-me",
            DeleteCentralSkillOptions {
                cascade_uninstall: false,
            },
        )
        .await
        .unwrap();

        assert_eq!(result.skill_id, "delete-me");
        assert!(!central_dir.join("delete-me").exists());
        assert!(db::get_skill_by_id(&pool, "delete-me")
            .await
            .unwrap()
            .is_none());

        let collection_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM collection_skills WHERE skill_id = 'delete-me'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let explanation_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM skill_explanations WHERE skill_id = 'delete-me'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let is_installed: i64 = sqlx::query_scalar(
            "SELECT is_installed FROM marketplace_skills WHERE id = 'test-registry::delete-me'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(collection_count, 0);
        assert_eq!(explanation_count, 0);
        assert_eq!(is_installed, 0);
    }

    #[tokio::test]
    async fn test_delete_central_skill_refuses_linked_skill_without_cascade() {
        let tmp = TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        fs::create_dir_all(&central_dir).unwrap();
        let pool = setup_test_db().await;
        set_agent_dir(&pool, "central", &central_dir).await;
        create_central_skill(&pool, &central_dir, "linked-skill").await;

        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "linked-skill".to_string(),
                agent_id: "claude-code".to_string(),
                installed_path: tmp
                    .path()
                    .join("claude")
                    .join("linked-skill")
                    .to_string_lossy()
                    .into_owned(),
                link_type: "symlink".to_string(),
                symlink_target: Some(
                    central_dir
                        .join("linked-skill")
                        .to_string_lossy()
                        .into_owned(),
                ),
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let err = delete_central_skill_impl(
            &pool,
            "linked-skill",
            DeleteCentralSkillOptions {
                cascade_uninstall: false,
            },
        )
        .await
        .unwrap_err();

        assert!(err.contains("installed on agents"));
        assert!(central_dir.join("linked-skill").exists());
        assert!(db::get_skill_by_id(&pool, "linked-skill")
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn test_delete_central_skill_cascades_platform_symlinks() {
        let tmp = TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        let claude_dir = tmp.path().join("claude");
        fs::create_dir_all(&central_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        let pool = setup_test_db().await;
        set_agent_dir(&pool, "central", &central_dir).await;
        set_agent_dir(&pool, "claude-code", &claude_dir).await;
        create_central_skill(&pool, &central_dir, "cascade-me").await;

        let install_path = claude_dir.join("cascade-me");
        create_symlink(&central_dir.join("cascade-me"), &install_path).unwrap();
        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "cascade-me".to_string(),
                agent_id: "claude-code".to_string(),
                installed_path: install_path.to_string_lossy().into_owned(),
                link_type: "symlink".to_string(),
                symlink_target: Some(
                    central_dir
                        .join("cascade-me")
                        .to_string_lossy()
                        .into_owned(),
                ),
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let result = delete_central_skill_impl(
            &pool,
            "cascade-me",
            DeleteCentralSkillOptions {
                cascade_uninstall: true,
            },
        )
        .await
        .unwrap();

        assert_eq!(result.uninstalled_agents, vec!["claude-code".to_string()]);
        assert!(!install_path.exists());
        assert!(!central_dir.join("cascade-me").exists());
        assert!(db::get_skill_installations(&pool, "cascade-me")
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn test_delete_central_skill_refuses_canonical_path_outside_central_root() {
        let tmp = TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        let outside_dir = tmp.path().join("outside").join("escape-skill");
        fs::create_dir_all(&central_dir).unwrap();
        fs::create_dir_all(&outside_dir).unwrap();
        fs::write(outside_dir.join("SKILL.md"), "---\nname: escape\n---\n").unwrap();
        let pool = setup_test_db().await;
        set_agent_dir(&pool, "central", &central_dir).await;

        let mut skill = make_skill("escape-skill", "escape-skill", true);
        skill.file_path = outside_dir.join("SKILL.md").to_string_lossy().into_owned();
        skill.canonical_path = Some(outside_dir.to_string_lossy().into_owned());
        db::upsert_skill(&pool, &skill).await.unwrap();

        let err = delete_central_skill_impl(
            &pool,
            "escape-skill",
            DeleteCentralSkillOptions {
                cascade_uninstall: true,
            },
        )
        .await
        .unwrap_err();

        assert!(err.contains("outside Central Skills root"));
        assert!(outside_dir.exists());
        assert!(db::get_skill_by_id(&pool, "escape-skill")
            .await
            .unwrap()
            .is_some());
    }

    #[tokio::test]
    async fn test_delete_central_skill_does_not_uninstall_shared_codex_root_as_copy() {
        let tmp = TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        fs::create_dir_all(&central_dir).unwrap();
        let pool = setup_test_db().await;
        set_agent_dir(&pool, "central", &central_dir).await;
        set_agent_dir(&pool, "codex", &central_dir).await;
        create_central_skill(&pool, &central_dir, "shared-root").await;

        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "shared-root".to_string(),
                agent_id: "codex".to_string(),
                installed_path: central_dir
                    .join("shared-root")
                    .to_string_lossy()
                    .into_owned(),
                link_type: "copy".to_string(),
                symlink_target: None,
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let result = delete_central_skill_impl(
            &pool,
            "shared-root",
            DeleteCentralSkillOptions {
                cascade_uninstall: true,
            },
        )
        .await
        .unwrap();

        assert!(result.uninstalled_agents.is_empty());
        assert!(!central_dir.join("shared-root").exists());
        assert!(db::get_skill_installations(&pool, "shared-root")
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn test_preview_delete_central_skill_bundle_reports_nested_skills_and_agents() {
        let tmp = TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        let claude_dir = tmp.path().join("claude");
        let bundle_dir = central_dir.join("Superpowers");
        fs::create_dir_all(&central_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        let pool = setup_test_db().await;
        set_agent_dir(&pool, "central", &central_dir).await;
        set_agent_dir(&pool, "claude-code", &claude_dir).await;
        create_nested_central_skill(&pool, &bundle_dir, "using-superpowers").await;
        create_nested_central_skill(&pool, &bundle_dir, "writing-plans").await;

        let install_path = claude_dir.join("using-superpowers");
        create_symlink(&bundle_dir.join("using-superpowers"), &install_path).unwrap();
        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "using-superpowers".to_string(),
                agent_id: "claude-code".to_string(),
                installed_path: install_path.to_string_lossy().into_owned(),
                link_type: "symlink".to_string(),
                symlink_target: Some(
                    bundle_dir
                        .join("using-superpowers")
                        .to_string_lossy()
                        .into_owned(),
                ),
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let preview = preview_delete_central_skill_bundle_impl(&pool, "Superpowers")
            .await
            .unwrap();

        assert_eq!(preview.bundle.relative_path, "Superpowers");
        assert!(!preview.bundle.is_symlink);
        assert_eq!(preview.bundle.skill_count, 2);
        assert_eq!(preview.affected_agents, vec!["claude-code".to_string()]);
        assert_eq!(
            preview
                .skills
                .iter()
                .map(|skill| skill.id.as_str())
                .collect::<Vec<_>>(),
            vec!["using-superpowers", "writing-plans"]
        );
    }

    #[tokio::test]
    async fn test_get_central_skill_bundle_detail_returns_skills_and_links() {
        let tmp = TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        let cursor_dir = tmp.path().join("cursor");
        let bundle_dir = central_dir.join("Superpowers");
        fs::create_dir_all(&central_dir).unwrap();
        fs::create_dir_all(&cursor_dir).unwrap();
        let pool = setup_test_db().await;
        set_agent_dir(&pool, "central", &central_dir).await;
        set_agent_dir(&pool, "cursor", &cursor_dir).await;
        create_nested_central_skill(&pool, &bundle_dir, "using-superpowers").await;
        create_nested_central_skill(&pool, &bundle_dir, "writing-plans").await;

        let install_path = cursor_dir.join("using-superpowers");
        create_symlink(&bundle_dir.join("using-superpowers"), &install_path).unwrap();
        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "using-superpowers".to_string(),
                agent_id: "cursor".to_string(),
                installed_path: install_path.to_string_lossy().into_owned(),
                link_type: "symlink".to_string(),
                symlink_target: Some(
                    bundle_dir
                        .join("using-superpowers")
                        .to_string_lossy()
                        .into_owned(),
                ),
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let detail = get_central_skill_bundle_detail_impl(&pool, "Superpowers")
            .await
            .unwrap();

        assert_eq!(detail.bundle.relative_path, "Superpowers");
        assert_eq!(detail.bundle.skill_count, 2);
        assert_eq!(detail.bundle.linked_agent_count, 1);
        assert_eq!(
            detail
                .skills
                .iter()
                .map(|skill| skill.id.as_str())
                .collect::<Vec<_>>(),
            vec!["using-superpowers", "writing-plans"]
        );
        assert_eq!(detail.skills[0].linked_agents, vec!["cursor".to_string()]);
    }

    #[tokio::test]
    async fn test_get_central_skill_bundle_detail_rejects_unsafe_paths() {
        let tmp = TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        fs::create_dir_all(&central_dir).unwrap();
        let pool = setup_test_db().await;
        set_agent_dir(&pool, "central", &central_dir).await;

        let err = get_central_skill_bundle_detail_impl(&pool, "../Superpowers")
            .await
            .unwrap_err();

        assert!(err.contains("Invalid Central bundle path"));
    }

    #[tokio::test]
    async fn test_delete_central_skill_bundle_removes_local_dir_records_and_platform_links() {
        let tmp = TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        let claude_dir = tmp.path().join("claude");
        let bundle_dir = central_dir.join("Superpowers");
        fs::create_dir_all(&central_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        let pool = setup_test_db().await;
        set_agent_dir(&pool, "central", &central_dir).await;
        set_agent_dir(&pool, "claude-code", &claude_dir).await;
        create_nested_central_skill(&pool, &bundle_dir, "using-superpowers").await;
        create_nested_central_skill(&pool, &bundle_dir, "writing-plans").await;

        let install_path = claude_dir.join("using-superpowers");
        create_symlink(&bundle_dir.join("using-superpowers"), &install_path).unwrap();
        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "using-superpowers".to_string(),
                agent_id: "claude-code".to_string(),
                installed_path: install_path.to_string_lossy().into_owned(),
                link_type: "symlink".to_string(),
                symlink_target: Some(
                    bundle_dir
                        .join("using-superpowers")
                        .to_string_lossy()
                        .into_owned(),
                ),
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let result = delete_central_skill_bundle_impl(
            &pool,
            "Superpowers",
            DeleteCentralSkillBundleOptions {
                cascade_uninstall: true,
            },
        )
        .await
        .unwrap();

        assert_eq!(result.relative_path, "Superpowers");
        assert_eq!(result.removed_kind, "directory");
        assert_eq!(
            result.removed_skill_ids,
            vec!["using-superpowers".to_string(), "writing-plans".to_string()]
        );
        assert_eq!(result.uninstalled_agents, vec!["claude-code".to_string()]);
        assert!(!bundle_dir.exists());
        assert!(!install_path.exists());
        assert!(db::get_skill_by_id(&pool, "using-superpowers")
            .await
            .unwrap()
            .is_none());
        assert!(db::get_skill_by_id(&pool, "writing-plans")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn test_delete_central_skill_bundle_removes_symlink_but_keeps_target() {
        let tmp = TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        let real_bundle_dir = tmp.path().join("real-superpowers");
        let central_bundle_link = central_dir.join("Superpowers");
        fs::create_dir_all(&central_dir).unwrap();
        fs::create_dir_all(&real_bundle_dir).unwrap();
        let pool = setup_test_db().await;
        set_agent_dir(&pool, "central", &central_dir).await;
        create_nested_central_skill(&pool, &central_bundle_link, "using-superpowers").await;
        fs::remove_dir_all(&central_bundle_link).unwrap();
        create_nested_central_skill(&pool, &real_bundle_dir, "using-superpowers").await;
        create_symlink(&real_bundle_dir, &central_bundle_link).unwrap();

        let mut skill = db::get_skill_by_id(&pool, "using-superpowers")
            .await
            .unwrap()
            .unwrap();
        skill.file_path = central_bundle_link
            .join("using-superpowers/SKILL.md")
            .to_string_lossy()
            .into_owned();
        skill.canonical_path = Some(
            central_bundle_link
                .join("using-superpowers")
                .to_string_lossy()
                .into_owned(),
        );
        db::upsert_skill(&pool, &skill).await.unwrap();

        let result = delete_central_skill_bundle_impl(
            &pool,
            "Superpowers",
            DeleteCentralSkillBundleOptions {
                cascade_uninstall: true,
            },
        )
        .await
        .unwrap();

        assert_eq!(result.removed_kind, "symlink");
        assert!(std::fs::symlink_metadata(&central_bundle_link).is_err());
        assert!(real_bundle_dir.join("using-superpowers/SKILL.md").exists());
        assert!(db::get_skill_by_id(&pool, "using-superpowers")
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn test_delete_central_skill_bundle_rejects_unsafe_paths() {
        let tmp = TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        fs::create_dir_all(&central_dir).unwrap();
        let pool = setup_test_db().await;
        set_agent_dir(&pool, "central", &central_dir).await;

        let err = preview_delete_central_skill_bundle_impl(&pool, "../Superpowers")
            .await
            .unwrap_err();
        assert!(err.contains("Invalid Central bundle path"));

        let err = delete_central_skill_bundle_impl(
            &pool,
            "",
            DeleteCentralSkillBundleOptions {
                cascade_uninstall: true,
            },
        )
        .await
        .unwrap_err();
        assert!(err.contains("Invalid Central bundle path"));
    }

    // ── get_skill_detail ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_get_skill_detail_returns_installations() {
        let pool = setup_test_db().await;

        let skill = make_skill("detail-skill", "Detail Skill", false);
        db::upsert_skill(&pool, &skill).await.unwrap();

        let now = Utc::now().to_rfc3339();
        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "detail-skill".to_string(),
                agent_id: "claude-code".to_string(),
                installed_path: "/tmp/claude/detail-skill/SKILL.md".to_string(),
                link_type: "copy".to_string(),
                symlink_target: None,
                created_at: now.clone(),
            },
        )
        .await
        .unwrap();

        let detail = get_skill_detail_impl(&pool, "detail-skill").await.unwrap();
        assert_eq!(detail.id, "detail-skill");
        assert_eq!(detail.installations.len(), 1);
        assert_eq!(detail.installations[0].agent_id, "claude-code");
        // installed_at should be populated from created_at
        assert!(
            !detail.installations[0].installed_at.is_empty(),
            "installed_at must be set"
        );
        assert!(
            detail.collections.is_empty(),
            "skill should have no collections by default"
        );
    }

    #[tokio::test]
    async fn test_get_skill_detail_returns_collections() {
        let pool = setup_test_db().await;

        let skill = make_skill("detail-skill", "Detail Skill", false);
        db::upsert_skill(&pool, &skill).await.unwrap();

        let alpha = db::create_collection(&pool, "Alpha", Some("First collection"))
            .await
            .unwrap();
        let beta = db::create_collection(&pool, "Beta", None).await.unwrap();

        db::add_skill_to_collection(&pool, &alpha.id, "detail-skill")
            .await
            .unwrap();
        db::add_skill_to_collection(&pool, &beta.id, "detail-skill")
            .await
            .unwrap();

        let detail = get_skill_detail_impl(&pool, "detail-skill").await.unwrap();
        let collection_names: Vec<&str> =
            detail.collections.iter().map(|c| c.name.as_str()).collect();

        assert_eq!(collection_names, vec!["Alpha", "Beta"]);
    }

    #[tokio::test]
    async fn test_get_skill_detail_not_found() {
        let pool = setup_test_db().await;
        let result = get_skill_detail_impl(&pool, "nonexistent").await;
        assert!(result.is_err(), "should error for unknown skill_id");
    }

    // ── read_skill_content ────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_read_skill_content_returns_file_content() {
        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;

        let skill_dir = tmp.path().join("my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        let skill_md_path = skill_dir.join("SKILL.md");
        let expected_content = "---\nname: My Skill\n---\n\n# My Skill\n\nContent here.";
        fs::write(&skill_md_path, expected_content).unwrap();

        let skill = Skill {
            id: "my-skill".to_string(),
            name: "My Skill".to_string(),
            description: None,
            file_path: skill_md_path.to_string_lossy().into_owned(),
            canonical_path: None,
            is_central: false,
            source: None,
            content: None,
            scanned_at: Utc::now().to_rfc3339(),
        };
        db::upsert_skill(&pool, &skill).await.unwrap();

        let content = read_skill_content_impl(&pool, "my-skill").await.unwrap();
        assert_eq!(content, expected_content);
    }

    #[tokio::test]
    async fn test_read_skill_content_file_not_found() {
        let pool = setup_test_db().await;

        let skill = Skill {
            id: "missing-file-skill".to_string(),
            name: "Missing File".to_string(),
            description: None,
            file_path: "/nonexistent/SKILL.md".to_string(),
            canonical_path: None,
            is_central: false,
            source: None,
            content: None,
            scanned_at: Utc::now().to_rfc3339(),
        };
        db::upsert_skill(&pool, &skill).await.unwrap();

        let result = read_skill_content_impl(&pool, "missing-file-skill").await;
        assert!(result.is_err(), "should error when file does not exist");
    }

    // ── Testable core implementations (without Tauri State) ───────────────────

    async fn get_central_skills_impl(pool: &SqlitePool) -> Result<Vec<SkillWithLinks>, String> {
        let skills = db::get_central_skills(pool).await?;
        let mut result = Vec::with_capacity(skills.len());
        for skill in skills {
            let installations = db::get_skill_installations(pool, &skill.id).await?;
            let linked_agents: Vec<String> =
                installations.into_iter().map(|i| i.agent_id).collect();
            let read_only_agents =
                read_only_agent_ids_for_skill(pool, &skill.id, skill.is_central).await?;
            let (created_at, updated_at) = skill_filesystem_timestamps(&skill);
            result.push(SkillWithLinks {
                id: skill.id,
                name: skill.name,
                description: skill.description,
                file_path: skill.file_path,
                canonical_path: skill.canonical_path,
                is_central: skill.is_central,
                source: skill.source,
                scanned_at: skill.scanned_at,
                created_at,
                updated_at,
                linked_agents,
                read_only_agents,
            });
        }
        Ok(result)
    }

    async fn get_skill_detail_impl(
        pool: &SqlitePool,
        skill_id: &str,
    ) -> Result<SkillDetail, String> {
        super::get_skill_detail_with_row_impl(pool, skill_id, None, None).await
    }

    async fn read_skill_content_impl(pool: &SqlitePool, skill_id: &str) -> Result<String, String> {
        let skill = db::get_skill_by_id(pool, skill_id)
            .await?
            .ok_or_else(|| format!("Skill '{}' not found", skill_id))?;
        std::fs::read_to_string(&skill.file_path)
            .map_err(|e| format!("Failed to read '{}': {}", skill.file_path, e))
    }

    // ── Regression: get_skills_by_agent_impl returns installation metadata ─────

    /// `get_skills_by_agent_impl` must return `SkillForAgent` objects that
    /// include `link_type`, `dir_path`, and `symlink_target` from the
    /// installation record so the frontend `SkillCard` can show the correct
    /// source indicator.
    #[tokio::test]
    async fn test_get_skills_by_agent_impl_includes_installation_metadata() {
        let pool = setup_test_db().await;

        let skill = make_skill("meta-skill", "Meta Skill", false);
        db::upsert_skill(&pool, &skill).await.unwrap();

        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "meta-skill".to_string(),
                agent_id: "claude-code".to_string(),
                installed_path: "/tmp/claude/meta-skill".to_string(),
                link_type: "symlink".to_string(),
                symlink_target: Some("/tmp/central/meta-skill".to_string()),
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let skills = get_skills_by_agent_impl(&pool, "claude-code")
            .await
            .unwrap();
        assert_eq!(skills.len(), 1, "should find one skill for claude-code");

        let s = &skills[0];
        assert_eq!(s.id, "meta-skill");
        assert_eq!(
            s.link_type, "symlink",
            "link_type must come from installation record"
        );
        assert_eq!(
            s.dir_path, "/tmp/claude/meta-skill",
            "dir_path must be installed_path from installation record"
        );
        assert_eq!(
            s.symlink_target.as_deref(),
            Some("/tmp/central/meta-skill"),
            "symlink_target must be forwarded from installation record"
        );
    }

    #[tokio::test]
    async fn test_get_skills_by_agent_impl_empty_for_unknown_agent() {
        let pool = setup_test_db().await;
        let skills = get_skills_by_agent_impl(&pool, "nobody").await.unwrap();
        assert!(
            skills.is_empty(),
            "no skills for an agent with no installations"
        );
    }

    #[tokio::test]
    async fn test_get_skills_by_agent_impl_claude_uses_observations_for_duplicate_rows() {
        let pool = setup_test_db().await;

        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/skills/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/skills/shared-skill",
                "user",
                false,
            ),
        )
        .await
        .unwrap();
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "plugin",
                true,
            ),
        )
        .await
        .unwrap();

        let mut skills = get_skills_by_agent_impl(&pool, "claude-code")
            .await
            .unwrap();
        skills.sort_by(|a, b| a.dir_path.cmp(&b.dir_path));

        assert_eq!(
            skills.len(),
            2,
            "Claude queries should surface duplicate logical skills from different sources"
        );
        assert_eq!(skills[0].id, "shared-skill");
        assert_eq!(skills[1].id, "shared-skill");
        assert_ne!(skills[0].dir_path, skills[1].dir_path);
    }

    #[tokio::test]
    async fn test_get_skills_by_agent_impl_claude_includes_source_identity_and_conflict_grouping() {
        let pool = setup_test_db().await;

        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/skills/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/skills/shared-skill",
                "user",
                false,
            ),
        )
        .await
        .unwrap();
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "plugin",
                true,
            ),
        )
        .await
        .unwrap();

        let mut skills = get_skills_by_agent_impl(&pool, "claude-code")
            .await
            .unwrap();
        skills.sort_by(|a, b| a.dir_path.cmp(&b.dir_path));

        assert_eq!(skills.len(), 2);
        assert_eq!(
            skills[0].row_id,
            "claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill"
        );
        assert_eq!(
            skills[1].row_id,
            "claude-code::/tmp/.claude/skills/shared-skill"
        );
        assert_eq!(skills[0].source_kind.as_deref(), Some("plugin"));
        assert_eq!(skills[1].source_kind.as_deref(), Some("user"));
        assert_eq!(
            skills[0].source_root.as_deref(),
            Some("/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0")
        );
        assert_eq!(
            skills[1].source_root.as_deref(),
            Some("/tmp/.claude/skills")
        );
        assert!(skills[0].is_read_only);
        assert!(!skills[1].is_read_only);
        assert_eq!(
            skills[0].conflict_group.as_deref(),
            Some("claude-code::shared-skill")
        );
        assert_eq!(
            skills[1].conflict_group.as_deref(),
            Some("claude-code::shared-skill")
        );
        assert_eq!(skills[0].conflict_count, 2);
        assert_eq!(skills[1].conflict_count, 2);
    }

    #[tokio::test]
    async fn test_get_skills_by_agent_impl_includes_generic_read_only_observations() {
        let pool = setup_test_db().await;

        let skill = make_skill("shared-skill", "Shared Skill", true);
        db::upsert_skill(&pool, &skill).await.unwrap();
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation_for_agent(
                "factory-droid",
                "factory-droid::/tmp/.agents/skills/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.agents/skills/shared-skill",
                "compatibility",
                "/tmp/.agents/skills",
                true,
            ),
        )
        .await
        .unwrap();

        let skills = get_skills_by_agent_impl(&pool, "factory-droid")
            .await
            .unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "shared-skill");
        assert_eq!(skills[0].source_kind.as_deref(), Some("compatibility"));
        assert!(skills[0].is_read_only);
        assert_eq!(
            skills[0].source_root.as_deref(),
            Some("/tmp/.agents/skills")
        );
    }

    #[tokio::test]
    async fn test_get_skills_by_agent_impl_prefers_manageable_install_over_read_only_observation() {
        let pool = setup_test_db().await;

        let skill = make_skill("shared-skill", "Shared Skill", false);
        db::upsert_skill(&pool, &skill).await.unwrap();
        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "shared-skill".to_string(),
                agent_id: "factory-droid".to_string(),
                installed_path: "/tmp/.factory/skills/shared-skill".to_string(),
                link_type: "copy".to_string(),
                symlink_target: None,
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation_for_agent(
                "factory-droid",
                "factory-droid::/tmp/.agents/skills/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.agents/skills/shared-skill",
                "compatibility",
                "/tmp/.agents/skills",
                true,
            ),
        )
        .await
        .unwrap();

        let skills = get_skills_by_agent_impl(&pool, "factory-droid")
            .await
            .unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "shared-skill");
        assert!(!skills[0].is_read_only);
        assert_eq!(skills[0].dir_path, "/tmp/.factory/skills/shared-skill");
        assert!(skills[0].source_kind.is_none());
    }

    #[tokio::test]
    async fn test_get_skill_detail_with_row_impl_claude_plugin_row_uses_selected_observation() {
        let pool = setup_test_db().await;

        let skill = make_skill("shared-skill", "Shared Skill", false);
        db::upsert_skill(&pool, &skill).await.unwrap();
        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "shared-skill".to_string(),
                agent_id: "claude-code".to_string(),
                installed_path: "/tmp/.claude/skills/shared-skill".to_string(),
                link_type: "copy".to_string(),
                symlink_target: None,
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let collection = db::create_collection(&pool, "Alpha", None).await.unwrap();
        db::add_skill_to_collection(&pool, &collection.id, "shared-skill")
            .await
            .unwrap();

        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/skills/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/skills/shared-skill",
                "user",
                false,
            ),
        )
        .await
        .unwrap();
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "plugin",
                true,
            ),
        )
        .await
        .unwrap();

        let detail = get_skill_detail_with_row_impl(
            &pool,
            "shared-skill",
            Some("claude-code"),
            Some("claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill"),
        )
        .await
        .unwrap();

        assert_eq!(
            detail.row_id,
            "claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill"
        );
        assert_eq!(
            detail.dir_path,
            "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill"
        );
        assert_eq!(
            detail.file_path,
            "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill/SKILL.md"
        );
        assert_eq!(detail.source_kind.as_deref(), Some("plugin"));
        assert_eq!(
            detail.source_root.as_deref(),
            Some("/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0")
        );
        assert!(detail.is_read_only);
        assert_eq!(detail.conflict_count, 2);
        assert_eq!(
            detail.conflict_group.as_deref(),
            Some("claude-code::shared-skill")
        );
        assert!(
            detail.installations.is_empty(),
            "plugin detail should not expose manageable installations"
        );
        assert!(
            detail.collections.is_empty(),
            "plugin detail should not expose collection management state"
        );
    }

    #[tokio::test]
    async fn test_get_skill_detail_with_row_impl_claude_user_row_keeps_manageable_state() {
        let pool = setup_test_db().await;

        let skill = make_skill("shared-skill", "Shared Skill", false);
        db::upsert_skill(&pool, &skill).await.unwrap();
        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "shared-skill".to_string(),
                agent_id: "claude-code".to_string(),
                installed_path: "/tmp/.claude/skills/shared-skill".to_string(),
                link_type: "copy".to_string(),
                symlink_target: None,
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let collection = db::create_collection(&pool, "Alpha", None).await.unwrap();
        db::add_skill_to_collection(&pool, &collection.id, "shared-skill")
            .await
            .unwrap();

        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/skills/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/skills/shared-skill",
                "user",
                false,
            ),
        )
        .await
        .unwrap();
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                "claude-code::/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.claude/plugins/cache/publisher/plugin-a/1.0.0/shared-skill",
                "plugin",
                true,
            ),
        )
        .await
        .unwrap();

        let detail = get_skill_detail_with_row_impl(
            &pool,
            "shared-skill",
            Some("claude-code"),
            Some("claude-code::/tmp/.claude/skills/shared-skill"),
        )
        .await
        .unwrap();

        assert_eq!(
            detail.row_id,
            "claude-code::/tmp/.claude/skills/shared-skill"
        );
        assert_eq!(detail.dir_path, "/tmp/.claude/skills/shared-skill");
        assert_eq!(detail.source_kind.as_deref(), Some("user"));
        assert!(!detail.is_read_only);
        assert_eq!(detail.conflict_count, 2);
        assert_eq!(detail.installations.len(), 1);
        assert_eq!(detail.collections.len(), 1);
    }

    #[tokio::test]
    async fn test_get_skill_detail_with_row_impl_factory_compatibility_row_is_read_only() {
        let pool = setup_test_db().await;

        let skill = make_skill("shared-skill", "Shared Skill", true);
        db::upsert_skill(&pool, &skill).await.unwrap();
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation_for_agent(
                "factory-droid",
                "factory-droid::/tmp/.agents/skills/shared-skill",
                "shared-skill",
                "Shared Skill",
                "/tmp/.agents/skills/shared-skill",
                "compatibility",
                "/tmp/.agents/skills",
                true,
            ),
        )
        .await
        .unwrap();

        let detail = get_skill_detail_with_row_impl(
            &pool,
            "shared-skill",
            Some("factory-droid"),
            Some("factory-droid::/tmp/.agents/skills/shared-skill"),
        )
        .await
        .unwrap();

        assert_eq!(
            detail.row_id,
            "factory-droid::/tmp/.agents/skills/shared-skill"
        );
        assert_eq!(detail.source_kind.as_deref(), Some("compatibility"));
        assert_eq!(detail.source_root.as_deref(), Some("/tmp/.agents/skills"));
        assert!(detail.is_read_only);
        assert!(
            detail.installations.is_empty(),
            "Factory .agents compatibility rows must not expose removable install records"
        );
        assert!(
            detail.collections.is_empty(),
            "read-only compatibility rows should not expose collection mutation state"
        );
    }

    #[tokio::test]
    async fn test_get_skills_by_agent_impl_copy_link_type() {
        let pool = setup_test_db().await;

        let skill = make_skill("copy-skill", "Copy Skill", false);
        db::upsert_skill(&pool, &skill).await.unwrap();

        db::upsert_skill_installation(
            &pool,
            &SkillInstallation {
                skill_id: "copy-skill".to_string(),
                agent_id: "cursor".to_string(),
                installed_path: "/tmp/cursor/copy-skill".to_string(),
                link_type: "copy".to_string(),
                symlink_target: None,
                created_at: Utc::now().to_rfc3339(),
            },
        )
        .await
        .unwrap();

        let skills = get_skills_by_agent_impl(&pool, "cursor").await.unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].link_type, "copy");
        assert!(
            skills[0].symlink_target.is_none(),
            "copy skills have no symlink target"
        );
    }

    // ── Skill file access IPC boundaries ───────────────────────────────────────

    #[tokio::test]
    async fn test_read_file_by_path_allows_central_skill_file() {
        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let central_dir = tmp.path().join("central");
        fs::create_dir_all(&central_dir).unwrap();
        set_agent_dir(&pool, "central", &central_dir).await;
        create_central_skill(&pool, &central_dir, "central-access").await;

        let file_path = central_dir.join("central-access").join("SKILL.md");
        let result = read_file_by_path_impl(
            &pool,
            &file_path.to_string_lossy(),
            &file_context("central-access", None, None),
        )
        .await;

        assert!(result.is_ok());
        assert!(result.unwrap().contains("# central-access"));
    }

    #[tokio::test]
    async fn test_read_file_by_path_rejects_arbitrary_home_file() {
        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let central_dir = tmp.path().join("central");
        fs::create_dir_all(&central_dir).unwrap();
        set_agent_dir(&pool, "central", &central_dir).await;
        create_central_skill(&pool, &central_dir, "central-access").await;
        let foreign_file = tmp.path().join("profile.md");
        fs::write(&foreign_file, "# not a skill").unwrap();

        let result = read_file_by_path_impl(
            &pool,
            &foreign_file.to_string_lossy(),
            &file_context("central-access", None, None),
        )
        .await;

        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("outside the allowed Skill directories"),
            "arbitrary files must not be readable"
        );
    }

    #[tokio::test]
    async fn test_read_file_by_path_allows_scanned_platform_skill_file() {
        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let skill_dir = tmp.path().join("claude").join("skills").join("platform-access");
        fs::create_dir_all(&skill_dir).unwrap();
        let skill_file = skill_dir.join("SKILL.md");
        fs::write(&skill_file, "# platform-access").unwrap();

        let row_id = "claude-code::platform-access";
        db::upsert_agent_skill_observation(
            &pool,
            &make_observation(
                row_id,
                "platform-access",
                "Platform Access",
                &skill_dir.to_string_lossy(),
                "user",
                false,
            ),
        )
        .await
        .unwrap();

        let result = read_file_by_path_impl(
            &pool,
            &skill_file.to_string_lossy(),
            &file_context("platform-access", Some("claude-code"), Some(row_id)),
        )
        .await;

        assert_eq!(result.unwrap(), "# platform-access");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_read_file_by_path_rejects_symlink_escape() {
        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let central_dir = tmp.path().join("central");
        fs::create_dir_all(&central_dir).unwrap();
        set_agent_dir(&pool, "central", &central_dir).await;
        create_central_skill(&pool, &central_dir, "central-access").await;
        let outside_dir = tmp.path().join("outside");
        fs::create_dir_all(&outside_dir).unwrap();
        let outside_file = outside_dir.join("secret.md");
        fs::write(&outside_file, "# secret").unwrap();
        create_symlink(
            &outside_file,
            &central_dir.join("central-access").join("secret-link.md"),
        )
        .unwrap();

        let result = read_file_by_path_impl(
            &pool,
            &central_dir
                .join("central-access")
                .join("secret-link.md")
                .to_string_lossy(),
            &file_context("central-access", None, None),
        )
        .await;

        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("outside the allowed Skill directories"));
    }

    #[tokio::test]
    async fn test_list_skill_directory_returns_nested_sorted_tree() {
        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let root = tmp.path().join("frontend-design");
        let docs_dir = root.join("docs");
        let nested_dir = docs_dir.join("guides");

        fs::create_dir_all(&nested_dir).unwrap();
        fs::write(root.join("SKILL.md"), "# Skill").unwrap();
        fs::write(root.join("notes.txt"), "notes").unwrap();
        fs::write(docs_dir.join("README.md"), "# Docs").unwrap();
        fs::write(nested_dir.join("tips.md"), "# Tips").unwrap();
        let skill = Skill {
            id: "frontend-design".to_string(),
            name: "Frontend Design".to_string(),
            description: None,
            file_path: root.join("SKILL.md").to_string_lossy().into_owned(),
            canonical_path: Some(root.to_string_lossy().into_owned()),
            is_central: true,
            source: Some("native".to_string()),
            content: None,
            scanned_at: Utc::now().to_rfc3339(),
        };
        db::upsert_skill(&pool, &skill).await.unwrap();

        let nodes = list_skill_directory_impl(
            &pool,
            &root.to_string_lossy(),
            &file_context("frontend-design", None, None),
        )
        .await
        .unwrap();

        assert_eq!(nodes.len(), 3);
        assert_eq!(nodes[0].name, "docs");
        assert!(nodes[0].is_dir);
        assert_eq!(nodes[0].relative_path, "docs");
        assert_eq!(nodes[0].children.len(), 2);
        assert_eq!(nodes[0].children[0].name, "guides");
        assert!(nodes[0].children[0].is_dir);
        assert_eq!(
            nodes[0].children[0].children[0].relative_path,
            "docs/guides/tips.md"
        );
        assert_eq!(nodes[1].name, "notes.txt");
        assert!(!nodes[1].is_dir);
        assert_eq!(nodes[2].name, "SKILL.md");
        assert!(!nodes[2].is_dir);
    }

    #[tokio::test]
    async fn test_list_skill_directory_rejects_missing_path() {
        let pool = setup_test_db().await;
        let result = list_skill_directory_impl(
            &pool,
            "/nonexistent/directory",
            &file_context("frontend-design", None, None),
        )
        .await;
        assert!(result.is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_list_skill_directory_skips_recursive_directory_symlink() {
        let tmp = TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let root = tmp.path().join("planning-with-files-zh");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("SKILL.md"), "# Skill").unwrap();
        create_symlink(&root, &root.join("planning-with-files-zh")).unwrap();
        let skill = Skill {
            id: "planning-with-files-zh".to_string(),
            name: "Planning With Files".to_string(),
            description: None,
            file_path: root.join("SKILL.md").to_string_lossy().into_owned(),
            canonical_path: Some(root.to_string_lossy().into_owned()),
            is_central: true,
            source: Some("native".to_string()),
            content: None,
            scanned_at: Utc::now().to_rfc3339(),
        };
        db::upsert_skill(&pool, &skill).await.unwrap();

        let nodes = list_skill_directory_impl(
            &pool,
            &root.to_string_lossy(),
            &file_context("planning-with-files-zh", None, None),
        )
        .await
        .unwrap();

        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].name, "SKILL.md");
    }

    // ── open_in_file_manager ───────────────────────────────────────────────────

    #[tokio::test]
    async fn test_open_in_file_manager_nonexistent_path() {
        let pool = setup_test_db().await;
        let result = open_in_file_manager_checked_impl(
            &pool,
            "/nonexistent/path/that/does/not/exist",
            &file_context("missing", None, None),
        )
        .await;
        assert!(result.is_err());
    }
}
