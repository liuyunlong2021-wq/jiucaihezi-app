use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json;
use tauri::{Emitter, State};

use crate::skills::db::{self, DbPool};
use crate::skills::path_utils::{central_skills_dir, path_to_string, resolve_home_dir};
use crate::skills::SkillsAppState;

const OBSIDIAN_PLATFORM_ID: &str = "obsidian";
const OBSIDIAN_PLATFORM_NAME: &str = "Obsidian";

// ─── Types ────────────────────────────────────────────────────────────────────

/// A candidate scan root (e.g. ~/projects, ~/Developer).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanRoot {
    pub path: String,
    pub label: String,
    pub exists: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObsidianVault {
    pub id: String,
    pub name: String,
    pub path: String,
    pub skill_count: usize,
}

/// A project-level skill discovered during a full-disk scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredSkill {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub file_path: String,
    pub dir_path: String,
    pub platform_id: String,
    pub platform_name: String,
    pub project_path: String,
    pub project_name: String,
    /// True if this skill already exists in the central skills dir.
    pub is_already_central: bool,
}

/// A project that contains skills, grouped for display.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredProject {
    pub project_path: String,
    pub project_name: String,
    pub skills: Vec<DiscoveredSkill>,
}

/// Payload emitted during scan for progress updates.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressPayload {
    pub percent: u32,
    pub current_path: String,
    pub skills_found: usize,
    pub projects_found: usize,
}

/// Payload emitted when a project with skills is found.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoundPayload {
    pub project: DiscoveredProject,
}

/// Payload emitted when scan completes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletePayload {
    pub total_projects: usize,
    pub total_skills: usize,
}

/// Result of the full project scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoverResult {
    pub total_projects: usize,
    pub total_skills: usize,
    pub projects: Vec<DiscoveredProject>,
}

/// Target for importing a discovered skill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ImportTarget {
    Central,
    Platform(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DiscoveredPlatformInstallMethod {
    Symlink,
    Copy,
}

#[derive(Debug, Default, Deserialize)]
struct ObsidianRegistryFile {
    #[serde(default)]
    vaults: HashMap<String, ObsidianRegistryVault>,
}

#[derive(Debug, Default, Deserialize)]
struct ObsidianRegistryVault {
    #[serde(default)]
    path: Option<String>,
}

impl DiscoveredPlatformInstallMethod {
    fn parse(method: Option<&str>) -> Result<Self, String> {
        match method.unwrap_or("symlink") {
            "symlink" | "auto" => Ok(Self::Symlink),
            "copy" => Ok(Self::Copy),
            other => Err(format!("Unsupported install method '{}'", other)),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Symlink => "symlink",
            Self::Copy => "copy",
        }
    }
}

/// Result of importing a discovered skill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub skill_id: String,
    pub target: String,
}

// ─── Global cancel flag ──────────────────────────────────────────────────────

static SCAN_CANCEL: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
std::thread_local! {
    static SCAN_CANCEL_OVERRIDE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(test)]
fn set_scan_cancel_override(cancelled: bool) {
    SCAN_CANCEL_OVERRIDE.with(|value| value.set(cancelled));
}

fn is_scan_cancelled() -> bool {
    #[cfg(test)]
    if SCAN_CANCEL_OVERRIDE.with(|value| value.get()) {
        return true;
    }

    SCAN_CANCEL.load(Ordering::Relaxed)
}

#[cfg(test)]
type ScanTestHook = Box<dyn Fn(&Path) + Send + Sync + 'static>;

#[cfg(test)]
static SCAN_TEST_HOOK: std::sync::Mutex<Option<ScanTestHook>> = std::sync::Mutex::new(None);

#[cfg(test)]
fn run_scan_test_hook(path: &Path) {
    let hook = SCAN_TEST_HOOK.lock().unwrap();
    if let Some(hook) = hook.as_ref() {
        hook(path);
    }
}

// ─── Default scan roots ───────────────────────────────────────────────────────

/// Returns a list of candidate scan roots, checking which ones exist on disk.
fn default_scan_roots() -> Vec<ScanRoot> {
    let home = resolve_home_dir();
    default_scan_roots_for_home(&home)
}

fn default_scan_roots_for_home(home: &Path) -> Vec<ScanRoot> {
    let candidates = vec![
        (
            path_to_string(
                &home
                    .join("Library")
                    .join("Mobile Documents")
                    .join("com~apple~CloudDocs"),
            ),
            "iCloud",
        ),
        (path_to_string(&home.join("projects")), "projects"),
        (path_to_string(&home.join("Documents")), "Documents"),
        (path_to_string(&home.join("Developer")), "Developer"),
        (path_to_string(&home.join("work")), "work"),
        (path_to_string(&home.join("src")), "src"),
        (path_to_string(&home.join("code")), "code"),
        (path_to_string(&home.join("repos")), "repos"),
        (path_to_string(&home.join("Desktop")), "Desktop"),
        // macOS: scan /Applications for apps with built-in skills (e.g. OpenClaw)
        ("/Applications".to_string(), "Applications"),
    ];

    candidates
        .into_iter()
        .map(|(path, label)| scan_root_from_candidate(path, label))
        .collect()
}

fn scan_root_from_candidate(path: String, label: &str) -> ScanRoot {
    let path = normalize_scan_root_path(&path);
    let exists = Path::new(&path).exists();
    ScanRoot {
        path,
        label: label.to_string(),
        exists,
        enabled: exists, // auto-enable roots that exist
    }
}

fn normalize_scan_root_path(path: &str) -> String {
    let trimmed = path.trim();
    let unquoted = if trimmed.len() >= 2 {
        let first = trimmed.as_bytes()[0];
        let last = trimmed.as_bytes()[trimmed.len() - 1];
        if (first == b'\'' && last == b'\'') || (first == b'"' && last == b'"') {
            &trimmed[1..trimmed.len() - 1]
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    let unescaped = unescape_shell_path(unquoted);
    let without_trailing = unescaped.trim_end_matches(['/', '\\']);
    if without_trailing.is_empty() {
        unescaped
    } else {
        without_trailing.to_string()
    }
}

fn unescape_shell_path(path: &str) -> String {
    let mut output = String::with_capacity(path.len());
    let mut chars = path.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(&next) = chars.peek() {
                if is_shell_escaped_path_char(next) {
                    output.push(next);
                    chars.next();
                    continue;
                }
            }
        }
        output.push(ch);
    }

    output
}

fn is_shell_escaped_path_char(ch: char) -> bool {
    matches!(
        ch,
        ' ' | '\''
            | '"'
            | '\\'
            | '('
            | ')'
            | '['
            | ']'
            | '{'
            | '}'
            | '&'
            | '|'
            | ';'
            | '<'
            | '>'
            | '*'
            | '?'
            | '$'
            | '`'
            | '!'
            | '#'
    )
}

fn normalized_scan_root_key(path: &str) -> String {
    let normalized = normalize_scan_root_path(path);
    if let Ok(canonical) = std::fs::canonicalize(&normalized) {
        return path_to_string(&canonical);
    }

    let without_trailing = normalized.trim_end_matches(['/', '\\']);
    if without_trailing.is_empty() {
        normalized
    } else {
        without_trailing.to_string()
    }
}

fn is_legacy_obsidian_icloud_scan_root(path: &str) -> bool {
    let normalized = normalize_scan_root_path(path);
    let parts: Vec<_> = Path::new(&normalized)
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .collect();

    parts.windows(4).any(|window| {
        window
            == [
                "Library",
                "Mobile Documents",
                "iCloud~md~obsidian",
                "Documents",
            ]
    })
}

fn is_child_scan_root(path: &str, parent: &str) -> bool {
    let path_key = normalized_scan_root_key(path);
    let parent_key = normalized_scan_root_key(parent);
    path_key != parent_key && Path::new(&path_key).starts_with(Path::new(&parent_key))
}

fn is_redundant_custom_scan_root(path: &str, roots: &[ScanRoot]) -> bool {
    roots
        .iter()
        .any(|root| root.exists && is_child_scan_root(path, &root.path))
}

fn label_for_custom_scan_root(path: &str, label: Option<&str>) -> String {
    label
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .or_else(|| {
            Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.to_string())
        })
        .unwrap_or_else(|| path.to_string())
}

async fn build_scan_roots(pool: &DbPool, defaults: Vec<ScanRoot>) -> Result<Vec<ScanRoot>, String> {
    let mut roots: Vec<ScanRoot> = defaults
        .into_iter()
        .filter_map(|root| {
            let path = normalize_scan_root_path(&root.path);
            if is_legacy_obsidian_icloud_scan_root(&path) {
                return None;
            }
            let exists = Path::new(&path).exists();
            Some(ScanRoot {
                path,
                exists,
                ..root
            })
        })
        .collect();
    let mut seen_paths: HashSet<String> = roots
        .iter()
        .map(|root| normalized_scan_root_key(&root.path))
        .collect();

    let mut custom_dirs: Vec<_> = db::get_scan_directories(pool)
        .await?
        .into_iter()
        .filter(|dir| !dir.is_builtin)
        .collect();
    custom_dirs.sort_by(|a, b| {
        normalize_scan_root_path(&a.path)
            .cmp(&normalize_scan_root_path(&b.path))
            .then_with(|| a.label.cmp(&b.label))
            .then_with(|| a.id.cmp(&b.id))
    });

    for dir in custom_dirs {
        let path = normalize_scan_root_path(&dir.path);
        if is_legacy_obsidian_icloud_scan_root(&path) {
            continue;
        }
        let key = normalized_scan_root_key(&path);
        if seen_paths.contains(&key) || is_redundant_custom_scan_root(&path, &roots) {
            continue;
        }
        seen_paths.insert(key);

        roots.push(ScanRoot {
            path: path.clone(),
            label: label_for_custom_scan_root(&path, dir.label.as_deref()),
            exists: Path::new(&path).exists(),
            enabled: dir.is_active,
        });
    }

    // Load persisted enabled states from settings.
    // We store a single JSON blob under the key "discover_scan_roots_config"
    // mapping path -> enabled (bool). This override is applied after default
    // and custom roots are merged so duplicate paths get one deterministic state.
    if let Some(json) = db::get_setting(pool, "discover_scan_roots_config").await? {
        let raw_config: HashMap<String, bool> =
            serde_json::from_str(&json).map_err(|e| format!("Invalid scan roots config: {}", e))?;
        let normalized_config: HashMap<String, bool> = raw_config
            .iter()
            .map(|(path, enabled)| (normalized_scan_root_key(path), *enabled))
            .collect();
        for root in &mut roots {
            if let Some(&enabled) = raw_config.get(&root.path) {
                root.enabled = enabled;
                continue;
            }

            let key = normalized_scan_root_key(&root.path);
            if let Some(&enabled) = normalized_config.get(&key) {
                root.enabled = enabled;
            }
        }
    }

    Ok(roots)
}

async fn get_scan_roots_impl(pool: &DbPool) -> Result<Vec<ScanRoot>, String> {
    build_scan_roots(pool, default_scan_roots()).await
}

/// Build the list of platform skill directory patterns to look for.
/// Prefer each built-in agent's project-relative skill directory. Older rows
/// without one fall back to deriving a relative pattern from `global_skills_dir`.
fn platform_skill_patterns(_pool: &DbPool) -> Vec<(String, String, PathBuf)> {
    // (agent_id, display_name, relative_subpath)
    // We compute this synchronously since it only reads from the built-in
    // agent list which is static after init.
    let home = resolve_home_dir();

    let mut seen = HashSet::new();
    db::builtin_agents()
        .iter()
        .filter(|a| a.id != "central")
        .filter_map(|a| {
            let rel = match a.project_skills_dir.as_deref() {
                Some(project_skills_dir) => PathBuf::from(project_skills_dir),
                None => {
                    let full = PathBuf::from(&a.global_skills_dir);
                    // Strip home prefix to get relative path like ".claude/skills".
                    full.strip_prefix(&home).ok()?.to_path_buf()
                }
            };
            if !seen.insert(rel.to_path_buf()) {
                return None;
            }
            Some((a.id.clone(), a.display_name.clone(), rel))
        })
        .collect()
}

// ─── Core scan logic ──────────────────────────────────────────────────────────

/// Maximum recursion depth for the directory walker.
const MAX_SCAN_DEPTH: u32 = 8;

/// Directory names that should always be skipped during traversal
/// for performance (these never contain project-level skill dirs).
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "build",
    "dist",
    ".cache",
    "__pycache__",
    ".next",
    ".nuxt",
    ".venv",
    "venv",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
    ".idea",
    ".vscode",
];

/// Check whether a directory name should be skipped during traversal.
///
/// - Always skip known heavy/irrelevant directories (node_modules, .git, etc.).
/// - At the root level (depth 0), skip hidden directories (dot-prefixed) since
///   they are typically user config dirs, not project directories.
/// - At deeper levels, allow hidden directories so we can detect platform
///   skill patterns like `.claude/skills/` inside project dirs.
fn should_skip_dir(name: &str, depth: u32) -> bool {
    // Always skip known heavy directories.
    if SKIP_DIRS.contains(&name) {
        return true;
    }

    // At root level, skip hidden directories (dot-prefixed).
    // These are typically user config dirs (~/.config, ~/.local, etc.),
    // not project directories containing skills.
    if depth == 0 && name.starts_with('.') {
        return true;
    }

    false
}

fn is_obsidian_vault_dir(path: &Path) -> bool {
    path.join(".obsidian").is_dir()
}

fn file_name_or_unknown(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown")
        .to_string()
}

fn stable_path_hash(path: &str) -> String {
    // FNV-1a gives us a deterministic, compact path-derived component without
    // adding a dependency or relying on randomized hash seeds.
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in path.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn selected_skill_dir_name(dir_path: &str) -> String {
    Path::new(dir_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("unknown")
        .to_string()
}

fn obsidian_qualified_id(vault_path: &str, skill_id: &str) -> String {
    format!(
        "{}__{}__{}",
        OBSIDIAN_PLATFORM_ID,
        stable_path_hash(vault_path),
        skill_id
    )
}

fn obsidian_vault_id(vault_path: &str) -> String {
    stable_path_hash(vault_path)
}

fn obsidian_registry_path_for_home(home: &Path) -> PathBuf {
    home.join("Library")
        .join("Application Support")
        .join("obsidian")
        .join("obsidian.json")
}

fn obsidian_icloud_documents_dir_for_home(home: &Path) -> PathBuf {
    home.join("Library")
        .join("Mobile Documents")
        .join("iCloud~md~obsidian")
        .join("Documents")
}

fn default_obsidian_registry_path() -> PathBuf {
    obsidian_registry_path_for_home(&resolve_home_dir())
}

fn default_obsidian_icloud_documents_dir() -> PathBuf {
    obsidian_icloud_documents_dir_for_home(&resolve_home_dir())
}

fn read_obsidian_registry_vault_paths(registry_path: &Path) -> Vec<PathBuf> {
    let content = match std::fs::read_to_string(registry_path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };
    let registry: ObsidianRegistryFile = match serde_json::from_str(&content) {
        Ok(registry) => registry,
        Err(_) => return Vec::new(),
    };

    let mut paths: Vec<PathBuf> = registry
        .vaults
        .into_values()
        .filter_map(|vault| vault.path)
        .map(|path| PathBuf::from(normalize_scan_root_path(&path)))
        .filter(|path| path.is_dir() && is_obsidian_vault_dir(path))
        .collect();
    paths.sort();
    paths.dedup();
    paths
}

fn is_obsidian_icloud_documents_child(path: &Path) -> bool {
    let parts: Vec<_> = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .collect();

    if parts.len() < 5 {
        return false;
    }

    for index in 0..=(parts.len() - 4) {
        if parts[index..index + 4]
            == [
                "Library",
                "Mobile Documents",
                "iCloud~md~obsidian",
                "Documents",
            ]
        {
            return parts.len() == index + 5;
        }
    }

    false
}

fn select_obsidian_registry_vault_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let icloud_paths: Vec<PathBuf> = paths
        .iter()
        .filter(|path| is_obsidian_icloud_documents_child(path))
        .cloned()
        .collect();

    if icloud_paths.is_empty() {
        paths
    } else {
        icloud_paths
    }
}

fn obsidian_source_vault_paths_with_registry(
    registry_path: &Path,
    fallback_icloud_parent: &Path,
) -> Vec<PathBuf> {
    let registry_paths =
        select_obsidian_registry_vault_paths(read_obsidian_registry_vault_paths(registry_path));
    if !registry_paths.is_empty() {
        return registry_paths;
    }

    direct_obsidian_vault_children(fallback_icloud_parent)
}

fn obsidian_source_vault_paths() -> Vec<PathBuf> {
    obsidian_source_vault_paths_with_registry(
        &default_obsidian_registry_path(),
        &default_obsidian_icloud_documents_dir(),
    )
}

fn scan_root_contains_path(root: &ScanRoot, path: &Path) -> bool {
    let root_key = normalized_scan_root_key(&root.path);
    let path_key = normalized_scan_root_key(&path.to_string_lossy());
    Path::new(&path_key).starts_with(Path::new(&root_key))
}

fn is_icloud_drive_root(path: &Path) -> bool {
    let parts: Vec<_> = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .collect();

    parts
        .windows(3)
        .any(|window| window == ["Library", "Mobile Documents", "com~apple~CloudDocs"])
}

fn direct_obsidian_vault_children(root: &Path) -> Vec<PathBuf> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };

    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && is_obsidian_vault_dir(path))
        .collect();
    paths.sort();
    paths
}

fn allowed_obsidian_vault_paths_for_roots_with_registry(
    roots: &[&ScanRoot],
    registry_path: &Path,
) -> HashSet<String> {
    let mut registry_paths: Vec<PathBuf> =
        select_obsidian_registry_vault_paths(read_obsidian_registry_vault_paths(registry_path))
            .into_iter()
            .filter(|path| roots.iter().any(|root| scan_root_contains_path(root, path)))
            .collect();

    if registry_paths.is_empty() {
        for root in roots {
            let root_path = PathBuf::from(&root.path);
            if is_obsidian_vault_dir(&root_path) {
                registry_paths.push(root_path.clone());
            }
            if is_icloud_drive_root(&root_path) {
                registry_paths.extend(direct_obsidian_vault_children(&root_path));
            }
        }
    }

    registry_paths
        .into_iter()
        .map(|path| normalized_scan_root_key(&path.to_string_lossy()))
        .collect()
}

fn allowed_obsidian_vault_paths_for_roots(roots: &[&ScanRoot]) -> HashSet<String> {
    allowed_obsidian_vault_paths_for_roots_with_registry(roots, &default_obsidian_registry_path())
}

fn is_allowed_obsidian_vault_dir(path: &Path, allowed_vault_paths: &HashSet<String>) -> bool {
    allowed_vault_paths.contains(&normalized_scan_root_key(&path.to_string_lossy()))
}

fn platform_display_name(platform_id: &str) -> String {
    if platform_id == OBSIDIAN_PLATFORM_ID {
        return OBSIDIAN_PLATFORM_NAME.to_string();
    }

    db::builtin_agents()
        .iter()
        .find(|agent| agent.id == platform_id)
        .map(|agent| agent.display_name.clone())
        .unwrap_or_else(|| platform_id.to_string())
}

fn scan_obsidian_vault(vault_dir: &Path, central_dir: &Path) -> Option<DiscoveredProject> {
    if !is_obsidian_vault_dir(vault_dir) {
        return None;
    }

    let project_path = path_to_string(vault_dir);
    let project_name = file_name_or_unknown(vault_dir);
    let mut selected_by_skill_id: BTreeMap<String, DiscoveredSkill> = BTreeMap::new();

    // Priority order is intentional: .skills wins over .agents/skills, which
    // wins over .claude/skills. Invalid directories are skipped by
    // scanner::scan_directory and therefore never reserve a dedupe key.
    for rel_source in [
        PathBuf::from(".skills"),
        PathBuf::from(".agents/skills"),
        PathBuf::from(".claude/skills"),
    ] {
        let source_dir = vault_dir.join(rel_source);
        let mut scanned = super::scanner::scan_skill_root(
            &source_dir,
            false,
            super::scanner::ScanDirectoryOptions::nested(),
        );
        scanned.sort_by(|a, b| a.id.cmp(&b.id).then_with(|| a.dir_path.cmp(&b.dir_path)));

        for skill in scanned {
            if selected_by_skill_id.contains_key(&skill.id) {
                continue;
            }

            let skill_dir_name = selected_skill_dir_name(&skill.dir_path);
            let is_already_central = central_dir.join(skill_dir_name).exists();
            selected_by_skill_id.insert(
                skill.id.clone(),
                DiscoveredSkill {
                    id: obsidian_qualified_id(&project_path, &skill.id),
                    name: skill.name,
                    description: skill.description,
                    file_path: skill.file_path,
                    dir_path: skill.dir_path,
                    platform_id: OBSIDIAN_PLATFORM_ID.to_string(),
                    platform_name: OBSIDIAN_PLATFORM_NAME.to_string(),
                    project_path: project_path.clone(),
                    project_name: project_name.clone(),
                    is_already_central,
                },
            );
        }
    }

    if selected_by_skill_id.is_empty() {
        None
    } else {
        Some(DiscoveredProject {
            project_path,
            project_name,
            skills: selected_by_skill_id.into_values().collect(),
        })
    }
}

fn scan_regular_project_dir(
    project_dir: &Path,
    patterns: &[(String, String, PathBuf)],
    central_dir: &Path,
) -> Vec<DiscoveredSkill> {
    let mut project_skills: Vec<DiscoveredSkill> = Vec::new();

    for (agent_id, display_name, rel_pattern) in patterns {
        if rel_pattern == &PathBuf::from("skills")
            && project_dir
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with('.'))
        {
            continue;
        }

        let skill_dir = project_dir.join(rel_pattern);

        if !skill_dir.exists() {
            continue;
        }

        let scanned = super::scanner::scan_skill_root(
            &skill_dir,
            false,
            super::scanner::ScanDirectoryOptions::nested(),
        );

        for skill in scanned {
            // Preserve the established ordinary Discover row identity. Obsidian
            // uses path-hashed IDs because duplicate vault basenames are a
            // mission requirement, but changing ordinary IDs would strand
            // existing cached Discover rows.
            let project_name = file_name_or_unknown(project_dir);
            let project_path = project_dir.to_string_lossy().into_owned();

            let qualified_id = format!(
                "{}__{}__{}",
                agent_id,
                project_name.to_lowercase().replace(' ', "-"),
                skill.id
            );

            // Check if this skill already exists in central.
            let skill_dir_name = selected_skill_dir_name(&skill.dir_path);
            let central_skill_path = central_dir.join(skill_dir_name);
            let is_already_central = central_skill_path.exists();

            project_skills.push(DiscoveredSkill {
                id: qualified_id,
                name: skill.name,
                description: skill.description,
                file_path: skill.file_path,
                dir_path: skill.dir_path,
                platform_id: agent_id.clone(),
                platform_name: display_name.clone(),
                project_path,
                project_name,
                is_already_central,
            });
        }
    }

    project_skills
}

/// Recursively walk a scan root directory, looking for project-level skill dirs.
///
/// Traverses subdirectories up to `MAX_SCAN_DEPTH` levels deep, checking each
/// directory for known platform skill subdirectories (e.g., `.claude/skills/`,
/// `.cursor/skills/`, `.factory/skills/`). When a match is found, the
/// containing directory is treated as a "project" and its skills are collected.
///
/// Skips hidden directories at root level (except dot-prefixed platform dirs
/// which are matched via patterns), and always skips performance-heavy
/// directories like `node_modules`, `.git`, `target`, `build`, `dist`.
///
/// The `project_path` is the directory that CONTAINS the platform dir
/// (e.g., `~/Documents/GitHubMe/minimax-skills` for `.claude/skills/` found there).
#[cfg(test)]
fn scan_root_for_projects(
    root: &Path,
    patterns: &[(String, String, PathBuf)],
    central_dir: &Path,
) -> Vec<DiscoveredProject> {
    let mut projects = Vec::new();
    let mut seen_project_paths = HashSet::new();
    let root_string = path_to_string(root);
    let root_scan = ScanRoot {
        path: root_string,
        label: file_name_or_unknown(root),
        exists: root.exists(),
        enabled: true,
    };
    let mut allowed_obsidian_vault_paths =
        allowed_obsidian_vault_paths_for_roots_with_registry(&[&root_scan], Path::new(""));
    collect_test_obsidian_vault_paths(root, &mut allowed_obsidian_vault_paths);
    scan_root_for_projects_with_seen(
        root,
        patterns,
        central_dir,
        &mut seen_project_paths,
        &mut projects,
        &allowed_obsidian_vault_paths,
    );
    projects
}

#[cfg(test)]
fn collect_test_obsidian_vault_paths(root: &Path, out: &mut HashSet<String>) {
    if is_obsidian_vault_dir(root) {
        out.insert(normalized_scan_root_key(&root.to_string_lossy()));
    }

    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_test_obsidian_vault_paths(&path, out);
        }
    }
}

fn scan_root_for_projects_with_seen(
    root: &Path,
    patterns: &[(String, String, PathBuf)],
    central_dir: &Path,
    seen_project_paths: &mut HashSet<String>,
    projects: &mut Vec<DiscoveredProject>,
    allowed_obsidian_vault_paths: &HashSet<String>,
) {
    scan_root_recursive(
        root,
        patterns,
        central_dir,
        0,
        projects,
        seen_project_paths,
        allowed_obsidian_vault_paths,
    );
}

/// Inner recursive walker. Accumulates found projects into `projects`.
/// `seen_project_paths` prevents duplicates when the same project dir
/// is reached via different scan roots.
fn scan_root_recursive(
    current_dir: &Path,
    patterns: &[(String, String, PathBuf)],
    central_dir: &Path,
    depth: u32,
    projects: &mut Vec<DiscoveredProject>,
    seen_project_paths: &mut HashSet<String>,
    allowed_obsidian_vault_paths: &HashSet<String>,
) {
    if depth > MAX_SCAN_DEPTH {
        return;
    }
    if is_scan_cancelled() {
        return;
    }
    #[cfg(test)]
    {
        run_scan_test_hook(current_dir);
        if is_scan_cancelled() {
            return;
        }
    }

    let current_path_key = current_dir.to_string_lossy().into_owned();
    if !seen_project_paths.contains(&current_path_key) {
        if is_allowed_obsidian_vault_dir(current_dir, allowed_obsidian_vault_paths) {
            if let Some(project) = scan_obsidian_vault(current_dir, central_dir) {
                seen_project_paths.insert(current_path_key.clone());
                projects.push(project);
                // A vault is a single Discover project. Do not also treat its
                // `.agents/skills` or `.claude/skills` directories as ordinary
                // platform projects.
                return;
            }
        } else if is_obsidian_vault_dir(current_dir) {
            seen_project_paths.insert(current_path_key.clone());
        }

        let project_skills = scan_regular_project_dir(current_dir, patterns, central_dir);
        if !project_skills.is_empty() {
            seen_project_paths.insert(current_path_key.clone());
            projects.push(DiscoveredProject {
                project_path: current_path_key,
                project_name: file_name_or_unknown(current_dir),
                skills: project_skills,
            });
        }
    }

    let entries = match std::fs::read_dir(current_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if is_scan_cancelled() {
            break;
        }

        let entry_path = entry.path();

        // Only look at directories.
        let meta = match std::fs::metadata(&entry_path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_dir() {
            continue;
        }

        let dir_name = entry_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        // Skip directories that should never be traversed.
        if should_skip_dir(dir_name, depth) {
            continue;
        }

        scan_root_recursive(
            &entry_path,
            patterns,
            central_dir,
            depth + 1,
            projects,
            seen_project_paths,
            allowed_obsidian_vault_paths,
        );
    }
}

// ─── Cache Reconciliation ─────────────────────────────────────────────────────

/// Reconcile the `discovered_skills` table after a scan.
///
/// For each previously discovered skill whose `project_path` falls under one of
/// the scanned roots, check whether the skill's `dir_path` still exists on disk.
/// If not, delete the stale record from the database.
///
/// Skills that were found during the current scan (identified by `found_skill_ids`)
/// are always kept — they are fresh and valid.
async fn reconcile_discovered_skills(
    pool: &DbPool,
    scan_roots: &[&ScanRoot],
    found_skill_ids: &[String],
) -> Result<(), String> {
    let all_rows = db::get_all_discovered_skills(pool).await?;

    let found_set: std::collections::HashSet<&str> =
        found_skill_ids.iter().map(|s| s.as_str()).collect();

    for row in &all_rows {
        // Skip skills just found in this scan — they are valid.
        if found_set.contains(row.id.as_str()) {
            continue;
        }

        // Only reconcile skills under the scanned roots.
        let project_path = Path::new(&row.project_path);
        let under_scanned_root = scan_roots.iter().any(|root| {
            project_path.starts_with(&root.path)
                || project_path.as_os_str() == std::ffi::OsStr::new(&root.path)
        });

        if !under_scanned_root {
            continue;
        }

        // Obsidian rows are authoritative for the scanned vault scope: if a
        // rescan did not emit the row, it may have lost validity, priority, or
        // its `.obsidian` marker even if the old directory still exists. For
        // ordinary rows, preserve the prior conservative behavior and only
        // purge directories that are actually gone.
        let should_delete = if row.platform_id == OBSIDIAN_PLATFORM_ID {
            true
        } else {
            !Path::new(&row.dir_path).exists()
        };

        if should_delete {
            db::delete_discovered_skill(pool, &row.id).await?;
        }
    }

    Ok(())
}

#[derive(Debug, Clone)]
enum DiscoverEvent {
    Found(FoundPayload),
    Progress(ProgressPayload),
    Complete(CompletePayload),
}

async fn start_project_scan_impl<F>(
    pool: &DbPool,
    roots: Vec<ScanRoot>,
    central_dir: &Path,
    mut emit_event: F,
) -> Result<DiscoverResult, String>
where
    F: FnMut(DiscoverEvent),
{
    // Build platform skill patterns from registered agents.
    let patterns = platform_skill_patterns(pool);

    // Filter to enabled roots that exist.
    let enabled_roots: Vec<&ScanRoot> = roots.iter().filter(|r| r.enabled && r.exists).collect();
    let allowed_obsidian_vault_paths = allowed_obsidian_vault_paths_for_roots(&enabled_roots);
    let total_roots = enabled_roots.len();

    let mut all_projects: Vec<DiscoveredProject> = Vec::new();
    let mut total_skills = 0;
    let mut roots_scanned = 0;
    let mut seen_project_paths = HashSet::new();
    let mut completed_roots: Vec<&ScanRoot> = Vec::new();

    for root in &enabled_roots {
        if is_scan_cancelled() {
            break;
        }

        let root_path = Path::new(&root.path);
        let before_project_count = all_projects.len();
        scan_root_for_projects_with_seen(
            root_path,
            &patterns,
            central_dir,
            &mut seen_project_paths,
            &mut all_projects,
            &allowed_obsidian_vault_paths,
        );
        let found_projects: Vec<DiscoveredProject> = all_projects[before_project_count..].to_vec();
        let root_completed = !is_scan_cancelled();

        if root_completed {
            completed_roots.push(*root);
        }

        roots_scanned += 1;
        let percent = if total_roots > 0 {
            (roots_scanned as u32 * 100) / total_roots as u32
        } else {
            100
        };

        for project in &found_projects {
            total_skills += project.skills.len();

            emit_event(DiscoverEvent::Found(FoundPayload {
                project: project.clone(),
            }));
        }

        emit_event(DiscoverEvent::Progress(ProgressPayload {
            percent: percent.min(100),
            current_path: root.path.clone(),
            skills_found: total_skills,
            projects_found: all_projects.len(),
        }));

        if is_scan_cancelled() {
            break;
        }
    }

    // Persist discovered skills to the database.
    let now = Utc::now().to_rfc3339();

    // Collect all discovered skill IDs found in this scan for reconciliation.
    let mut found_skill_ids: Vec<String> = Vec::new();

    for project in &all_projects {
        for skill in &project.skills {
            found_skill_ids.push(skill.id.clone());

            db::insert_discovered_skill(
                pool,
                &skill.id,
                &skill.name,
                skill.description.as_deref(),
                &skill.file_path,
                &skill.dir_path,
                &skill.project_path,
                &skill.project_name,
                &skill.platform_id,
                &now,
            )
            .await?;
        }
    }

    // ── Cache reconciliation ──────────────────────────────────────────────────
    // Remove stale discovered_skills rows only within roots that were fully
    // traversed. Cancellation before a root, between roots, or during a root
    // traversal must not purge cached rows for unvisited/incomplete scopes.
    reconcile_discovered_skills(pool, &completed_roots, &found_skill_ids).await?;

    let total_projects = all_projects.len();

    emit_event(DiscoverEvent::Complete(CompletePayload {
        total_projects,
        total_skills,
    }));

    Ok(DiscoverResult {
        total_projects,
        total_skills,
        projects: all_projects,
    })
}

fn obsidian_vaults_from_allowed_paths(
    allowed_vault_paths: &HashSet<String>,
    central_dir: &Path,
) -> Vec<ObsidianVault> {
    let mut vaults: Vec<ObsidianVault> = allowed_vault_paths
        .iter()
        .filter_map(|path| {
            let vault_path = PathBuf::from(path);
            if !vault_path.is_dir() || !is_obsidian_vault_dir(&vault_path) {
                return None;
            }

            let skill_count = scan_obsidian_vault(&vault_path, central_dir)
                .map(|project| project.skills.len())
                .unwrap_or(0);
            if skill_count == 0 {
                return None;
            }

            Some(ObsidianVault {
                id: obsidian_vault_id(path),
                name: file_name_or_unknown(&vault_path),
                path: path.clone(),
                skill_count,
            })
        })
        .collect();

    vaults.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
    vaults
}

async fn get_obsidian_vaults_impl(_pool: &DbPool) -> Result<Vec<ObsidianVault>, String> {
    let allowed_vault_paths: HashSet<String> = obsidian_source_vault_paths()
        .into_iter()
        .map(|path| normalized_scan_root_key(&path.to_string_lossy()))
        .collect();
    Ok(obsidian_vaults_from_allowed_paths(
        &allowed_vault_paths,
        &central_skills_dir(),
    ))
}

async fn get_obsidian_vault_skills_impl(
    pool: &DbPool,
    vault_id: &str,
) -> Result<Vec<DiscoveredSkill>, String> {
    let allowed_vault_paths: HashSet<String> = obsidian_source_vault_paths()
        .into_iter()
        .map(|path| normalized_scan_root_key(&path.to_string_lossy()))
        .collect();

    let vault_path = allowed_vault_paths
        .iter()
        .find(|path| obsidian_vault_id(path) == vault_id || path.as_str() == vault_id)
        .cloned()
        .ok_or_else(|| format!("Obsidian vault '{}' not found", vault_id))?;

    let skills = scan_obsidian_vault(&PathBuf::from(&vault_path), &central_skills_dir())
        .map(|project| project.skills)
        .unwrap_or_default();

    let now = Utc::now().to_rfc3339();
    for skill in &skills {
        db::insert_discovered_skill(
            pool,
            &skill.id,
            &skill.name,
            skill.description.as_deref(),
            &skill.file_path,
            &skill.dir_path,
            &skill.project_path,
            &skill.project_name,
            &skill.platform_id,
            &now,
        )
        .await?;
    }

    Ok(skills)
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// Auto-detect candidate scan roots and return them.
#[tauri::command]
pub async fn discover_scan_roots() -> Result<Vec<ScanRoot>, String> {
    Ok(default_scan_roots())
}

/// Get scan roots with persisted enabled state from DB.
///
/// Returns auto-detected default roots, then overlays any previously
/// persisted enabled/disabled states from the settings table.
#[tauri::command]
pub async fn get_scan_roots(state: State<'_, SkillsAppState>) -> Result<Vec<ScanRoot>, String> {
    get_scan_roots_impl(&state.db).await
}

#[tauri::command]
pub async fn get_obsidian_vaults(state: State<'_, SkillsAppState>) -> Result<Vec<ObsidianVault>, String> {
    get_obsidian_vaults_impl(&state.db).await
}

#[tauri::command]
pub async fn get_obsidian_vault_skills(
    state: State<'_, SkillsAppState>,
    vault_id: String,
) -> Result<Vec<DiscoveredSkill>, String> {
    get_obsidian_vault_skills_impl(&state.db, &vault_id).await
}

/// Persist the enabled/disabled state of a scan root.
///
/// Updates the "discover_scan_roots_config" setting in the DB, which
/// stores a JSON object mapping root paths to their enabled state.
#[tauri::command]
pub async fn set_scan_root_enabled(
    state: State<'_, SkillsAppState>,
    path: String,
    enabled: bool,
) -> Result<(), String> {
    set_scan_root_enabled_impl(&state.db, path, enabled).await
}

async fn set_scan_root_enabled_impl(
    pool: &DbPool,
    path: String,
    enabled: bool,
) -> Result<(), String> {
    // Load existing config or start fresh.
    let mut config: HashMap<String, bool> =
        match db::get_setting(pool, "discover_scan_roots_config").await? {
            Some(json) => serde_json::from_str(&json)
                .map_err(|e| format!("Invalid scan roots config: {}", e))?,
            None => HashMap::new(),
        };

    let normalized_path = normalize_scan_root_path(&path);
    let normalized_key = normalized_scan_root_key(&normalized_path);
    config.retain(|existing_path, _| normalized_scan_root_key(existing_path) != normalized_key);
    config.insert(normalized_path, enabled);

    let json = serde_json::to_string(&config)
        .map_err(|e| format!("Failed to serialize scan roots config: {}", e))?;
    db::set_setting(pool, "discover_scan_roots_config", &json).await
}

/// Start a project-discovery scan across the given root directories.
/// Emits streaming events (`discover:progress`, `discover:found`, `discover:complete`).
#[tauri::command]
pub async fn start_project_scan(
    state: State<'_, SkillsAppState>,
    app: tauri::AppHandle,
    roots: Vec<ScanRoot>,
) -> Result<DiscoverResult, String> {
    // Reset cancel flag.
    SCAN_CANCEL.store(false, Ordering::Relaxed);

    let pool = &state.db;
    let central_dir = central_skills_dir();
    start_project_scan_impl(pool, roots, &central_dir, |event| match event {
        DiscoverEvent::Found(payload) => {
            let _ = app.emit("discover:found", payload);
        }
        DiscoverEvent::Progress(payload) => {
            let _ = app.emit("discover:progress", payload);
        }
        DiscoverEvent::Complete(payload) => {
            let _ = app.emit("discover:complete", payload);
        }
    })
    .await
}

/// Cancel an in-progress project scan.
#[tauri::command]
pub async fn stop_project_scan() -> Result<(), String> {
    SCAN_CANCEL.store(true, Ordering::Relaxed);
    Ok(())
}

/// Load previously discovered skills from the database, grouped by project.
#[tauri::command]
pub async fn get_discovered_skills(
    state: State<'_, SkillsAppState>,
) -> Result<Vec<DiscoveredProject>, String> {
    let central_dir = central_skills_dir();
    get_discovered_skills_impl(&state.db, &central_dir).await
}

async fn get_discovered_skills_impl(
    pool: &DbPool,
    central_dir: &Path,
) -> Result<Vec<DiscoveredProject>, String> {
    let rows = db::get_all_discovered_skills(pool).await?;

    // Convert DB rows to DiscoveredSkill structs, adding is_already_central.
    let skills: Vec<DiscoveredSkill> = rows
        .into_iter()
        .map(|row| {
            let skill_dir_name = Path::new(&row.dir_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown");
            // A discovered skill is "already central" if:
            // 1. The skill directory name exists in the central skills dir, OR
            // 2. There is a skill_installations record for this skill name
            //    (meaning it's been installed to at least one platform).
            let is_already_central = central_dir.join(skill_dir_name).exists();
            let platform_id = row.platform_id.clone();

            DiscoveredSkill {
                id: row.id,
                name: row.name,
                description: row.description,
                file_path: row.file_path,
                dir_path: row.dir_path,
                platform_id: platform_id.clone(),
                platform_name: platform_display_name(&platform_id),
                project_path: row.project_path,
                project_name: row.project_name,
                is_already_central,
            }
        })
        .collect();

    // Group skills by project_path.
    let mut by_project: HashMap<String, Vec<DiscoveredSkill>> = HashMap::new();
    let mut project_names: HashMap<String, String> = HashMap::new();

    for skill in skills {
        project_names.insert(skill.project_path.clone(), skill.project_name.clone());
        by_project
            .entry(skill.project_path.clone())
            .or_default()
            .push(skill);
    }

    let mut projects: Vec<DiscoveredProject> = by_project
        .into_iter()
        .map(|(path, skills)| DiscoveredProject {
            project_path: path.clone(),
            project_name: project_names.get(&path).cloned().unwrap_or_default(),
            skills,
        })
        .collect();

    // Sort by project name for stable ordering.
    projects.sort_by(|a, b| a.project_name.cmp(&b.project_name));

    Ok(projects)
}

/// Import a discovered skill to the central skills directory.
///
/// Copies the skill directory from its project location to `~/.agents/skills/<skill_dir_name>`,
/// then records it in the skills table.
#[tauri::command]
pub async fn import_discovered_skill_to_central(
    state: State<'_, SkillsAppState>,
    discovered_skill_id: String,
) -> Result<ImportResult, String> {
    let pool = &state.db;

    // Look up the discovered skill.
    let skill = db::get_discovered_skill_by_id(pool, &discovered_skill_id)
        .await?
        .ok_or_else(|| format!("Discovered skill '{}' not found", discovered_skill_id))?;

    // Determine central dir.
    let central_dir = central_skills_dir();

    // Extract the original skill directory name (last component of dir_path).
    let skill_dir_name = Path::new(&skill.dir_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Cannot extract skill directory name".to_string())?
        .to_string();

    let target_dir = central_dir.join(&skill_dir_name);

    // Check if a skill with this name already exists in central.
    if target_dir.exists() {
        return Err(format!(
            "A skill named '{}' already exists in central skills",
            skill_dir_name
        ));
    }

    // Copy the skill directory to central.
    super::linker::copy_dir_all(Path::new(&skill.dir_path), &target_dir)?;

    // Now we need to re-scan so the new central skill gets picked up.
    // Record the skill in the DB as a central skill.
    let skill_md_path = target_dir.join("SKILL.md");
    let info = super::scanner::parse_skill_md(&skill_md_path);

    if let Some(skill_info) = info {
        let now = Utc::now().to_rfc3339();
        let db_skill = db::Skill {
            id: skill_dir_name.clone(),
            name: skill_info.name,
            description: skill_info.description,
            file_path: skill_md_path.to_string_lossy().into_owned(),
            canonical_path: Some(target_dir.to_string_lossy().into_owned()),
            is_central: true,
            source: Some("copy".to_string()),
            content: None,
            scanned_at: now,
        };
        db::upsert_skill(pool, &db_skill).await?;
    }

    // Remove the discovered skill record since it's now centralized.
    db::delete_discovered_skill(pool, &discovered_skill_id).await?;

    Ok(ImportResult {
        skill_id: skill_dir_name,
        target: "central".to_string(),
    })
}

/// Import a discovered skill to a specific platform's global skills directory.
///
/// Creates a symlink (or copy) from the discovered skill's dir to the platform's
/// global skills directory.
#[tauri::command]
pub async fn import_discovered_skill_to_platform(
    state: State<'_, SkillsAppState>,
    discovered_skill_id: String,
    agent_id: String,
    method: Option<String>,
) -> Result<ImportResult, String> {
    import_discovered_skill_to_platform_from_pool(
        &state.db,
        &discovered_skill_id,
        &agent_id,
        method.as_deref(),
    )
    .await
}

async fn import_discovered_skill_to_platform_from_pool(
    pool: &DbPool,
    discovered_skill_id: &str,
    agent_id: &str,
    method: Option<&str>,
) -> Result<ImportResult, String> {
    if agent_id == OBSIDIAN_PLATFORM_ID {
        return Err("Obsidian vaults are Discover sources, not install targets".to_string());
    }
    let install_method = DiscoveredPlatformInstallMethod::parse(method)?;

    // Look up the discovered skill.
    let skill = db::get_discovered_skill_by_id(pool, discovered_skill_id)
        .await?
        .ok_or_else(|| format!("Discovered skill '{}' not found", discovered_skill_id))?;

    // Look up the target agent.
    let agent = db::get_agent_by_id(pool, agent_id)
        .await?
        .ok_or_else(|| format!("Agent '{}' not found", agent_id))?;

    // Extract the original skill directory name.
    let skill_dir_name = Path::new(&skill.dir_path)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Cannot extract skill directory name".to_string())?
        .to_string();

    let agent_dir = PathBuf::from(&agent.global_skills_dir);
    let target_path = agent_dir.join(&skill_dir_name);

    // Ensure agent skills dir exists.
    std::fs::create_dir_all(&agent_dir)
        .map_err(|e| format!("Failed to create agent skills directory: {}", e))?;

    // Check if already installed.
    if target_path.exists() || std::fs::symlink_metadata(&target_path).is_ok() {
        return Err(format!(
            "Skill '{}' already exists in {}",
            skill_dir_name, agent.display_name
        ));
    }

    // Create symlink from discovered skill dir to platform dir.
    let src_path = Path::new(&skill.dir_path);
    match install_method {
        DiscoveredPlatformInstallMethod::Symlink => {
            let relative_target = super::linker::symlink_target_path(&agent_dir, src_path);
            super::linker::create_symlink(&relative_target, &target_path)?;
        }
        DiscoveredPlatformInstallMethod::Copy => {
            super::linker::copy_dir_all(src_path, &target_path)?;
        }
    }

    // Record the installation.
    let now = Utc::now().to_rfc3339();

    // Also ensure the skill is in the skills table.
    let skill_md_path = src_path.join("SKILL.md");
    let info = super::scanner::parse_skill_md(&skill_md_path);
    let stored_skill_md_path = match install_method {
        DiscoveredPlatformInstallMethod::Symlink => skill_md_path.clone(),
        DiscoveredPlatformInstallMethod::Copy => target_path.join("SKILL.md"),
    };

    if let Some(skill_info) = info {
        let db_skill = db::Skill {
            id: skill_dir_name.clone(),
            name: skill_info.name,
            description: skill_info.description,
            file_path: stored_skill_md_path.to_string_lossy().into_owned(),
            canonical_path: None,
            is_central: false,
            source: Some(install_method.as_str().to_string()),
            content: None,
            scanned_at: now.clone(),
        };
        db::upsert_skill(pool, &db_skill).await?;
    }

    let installation = db::SkillInstallation {
        skill_id: skill_dir_name.clone(),
        agent_id: agent_id.to_string(),
        installed_path: target_path.to_string_lossy().into_owned(),
        link_type: install_method.as_str().to_string(),
        symlink_target: match install_method {
            DiscoveredPlatformInstallMethod::Symlink => Some(skill.dir_path.clone()),
            DiscoveredPlatformInstallMethod::Copy => None,
        },
        created_at: now,
    };
    db::upsert_skill_installation(pool, &installation).await?;

    // NOTE: We intentionally do NOT delete the discovered skill record here.
    // Keeping the record allows multi-platform install (importing the same
    // discovered skill to multiple platforms in sequence). The record will be
    // cleaned up by cache reconciliation on the next rescan, or when the user
    // imports it to central (which does delete the record).

    Ok(ImportResult {
        skill_id: skill_dir_name,
        target: agent_id.to_string(),
    })
}

/// Clear all discovered skills from the database.
#[tauri::command]
pub async fn clear_discovered_skills(state: State<'_, SkillsAppState>) -> Result<(), String> {
    db::clear_all_discovered_skills(&state.db).await
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::linker;

    static SCAN_CANCEL_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    const CROSS_AREA_FIXTURE_ROOT: &str = "/tmp/skills-manage-val-cross-012";
    const CROSS_AREA_FIXTURE_CENTRAL_DIR: &str = "/tmp/skills-manage-val-cross-012/central";
    const CROSS_AREA_FIXTURE_CLAUDE_PLATFORM_DIR: &str =
        "/tmp/skills-manage-val-cross-012/claude-platform-skills";
    const CROSS_AREA_FIXTURE_CURSOR_PLATFORM_DIR: &str =
        "/tmp/skills-manage-val-cross-012/cursor-platform-skills";
    const CROSS_AREA_FIXTURE_PARENT_PATH: &str =
        "/tmp/skills-manage-val-cross-012/Library/Mobile Documents/iCloud~md~obsidian/Documents";
    const CROSS_AREA_FIXTURE_VAULT_PATH: &str =
        "/tmp/skills-manage-val-cross-012/Library/Mobile Documents/iCloud~md~obsidian/Documents/make-money";
    const CROSS_AREA_FIXTURE_VAULT_NAME: &str = "make-money";
    const CROSS_AREA_FIXTURE_SKILL_DIR_NAME: &str = "money-researcher";
    const CROSS_AREA_FIXTURE_SKILL_NAME: &str = "Money Researcher";
    const CROSS_AREA_FIXTURE_SKILL_DESCRIPTION: &str = "Correlated fixture skill";
    const CROSS_AREA_FIXTURE_SKILL_ID: &str = "obsidian__ef800504428ee0cc__money-researcher";
    const CROSS_AREA_FIXTURE_SOURCE_DIR: &str =
        "/tmp/skills-manage-val-cross-012/Library/Mobile Documents/iCloud~md~obsidian/Documents/make-money/.agents/skills/money-researcher";
    const CROSS_AREA_FIXTURE_SOURCE_FILE: &str =
        "/tmp/skills-manage-val-cross-012/Library/Mobile Documents/iCloud~md~obsidian/Documents/make-money/.agents/skills/money-researcher/SKILL.md";
    const CROSS_AREA_FIXTURE_CENTRAL_TARGET: &str =
        "/tmp/skills-manage-val-cross-012/central/money-researcher";
    const CROSS_AREA_FIXTURE_SYMLINK_TARGET: &str =
        "/tmp/skills-manage-val-cross-012/claude-platform-skills/money-researcher";
    const CROSS_AREA_FIXTURE_COPY_TARGET: &str =
        "/tmp/skills-manage-val-cross-012/cursor-platform-skills/money-researcher";

    #[test]
    fn test_default_scan_roots_returns_candidates() {
        let roots = default_scan_roots();
        assert!(!roots.is_empty(), "should return at least some candidates");
        // Each root should have a path and label.
        for root in &roots {
            assert!(!root.path.is_empty());
            assert!(!root.label.is_empty());
        }
    }

    #[test]
    fn test_default_scan_roots_start_with_icloud_drive() {
        let tmp = tempfile::TempDir::new().unwrap();
        let home = tmp.path().join("home");
        let roots = default_scan_roots_for_home(&home);
        let expected = home
            .join("Library")
            .join("Mobile Documents")
            .join("com~apple~CloudDocs");

        assert_eq!(roots[0].path, expected.to_string_lossy());
        assert_eq!(roots[0].label, "iCloud");
    }

    #[test]
    fn test_default_scan_roots_excludes_legacy_obsidian_icloud() {
        let tmp = tempfile::TempDir::new().unwrap();
        let home = tmp.path().join("home");
        let roots = default_scan_roots_for_home(&home);

        assert!(
            roots
                .iter()
                .all(|root| !root.path.contains("iCloud~md~obsidian")),
            "legacy Obsidian iCloud container should not be a default scan root"
        );
    }

    #[test]
    fn test_scan_root_exists_matches_filesystem() {
        let roots = default_scan_roots();
        for root in &roots {
            let actually_exists = Path::new(&root.path).exists();
            assert_eq!(
                root.exists, actually_exists,
                "exists flag should match actual filesystem for {}",
                root.path
            );
        }
    }

    #[tokio::test]
    async fn test_platform_skill_patterns_excludes_central() {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        db::init_database(&pool).await.unwrap();
        let patterns = platform_skill_patterns(&pool);
        // Central should be excluded.
        assert!(
            !patterns.iter().any(|(id, _, _)| id == "central"),
            "central should not appear in platform skill patterns"
        );
        // Claude Code should be included.
        assert!(
            patterns.iter().any(|(id, _, _)| id == "claude-code"),
            "claude-code should appear in platform skill patterns"
        );
    }

    use sqlx::SqlitePool;

    fn valid_skill_md(name: &str, description: &str) -> String {
        format!(
            "---\nname: {}\ndescription: {}\n---\n\n# {}\n",
            name, description, name
        )
    }

    fn create_skill(parent: &Path, dir_name: &str, name: &str, description: &str) -> PathBuf {
        let skill_dir = parent.join(dir_name);
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            valid_skill_md(name, description),
        )
        .unwrap();
        skill_dir
    }

    fn create_invalid_skill(parent: &Path, dir_name: &str) -> PathBuf {
        let skill_dir = parent.join(dir_name);
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\ndescription: Missing name\n---\n\n# Invalid\n",
        )
        .unwrap();
        skill_dir
    }

    fn basic_patterns() -> Vec<(String, String, PathBuf)> {
        vec![
            (
                "codex".to_string(),
                "Codex CLI".to_string(),
                PathBuf::from(".agents/skills"),
            ),
            (
                "claude-code".to_string(),
                "Claude Code".to_string(),
                PathBuf::from(".claude/skills"),
            ),
        ]
    }

    fn scan_for_test(root: &Path, central_dir: &Path) -> Vec<DiscoveredProject> {
        scan_root_for_projects(root, &basic_patterns(), central_dir)
    }

    fn scan_root(path: &Path, enabled: bool, exists: bool) -> ScanRoot {
        ScanRoot {
            path: path.to_string_lossy().into_owned(),
            label: "test".to_string(),
            exists,
            enabled,
        }
    }

    fn vault_manifest(root: &Path) -> Vec<(String, bool, bool, Option<Vec<u8>>)> {
        fn walk(root: &Path, current: &Path, out: &mut Vec<(String, bool, bool, Option<Vec<u8>>)>) {
            let mut entries: Vec<_> = std::fs::read_dir(current)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .collect();
            entries.sort();

            for path in entries {
                let rel = path
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned();
                let metadata = std::fs::symlink_metadata(&path).unwrap();
                let is_symlink = metadata.file_type().is_symlink();
                let is_dir = metadata.is_dir();
                let content = if metadata.is_file() {
                    Some(std::fs::read(&path).unwrap())
                } else {
                    None
                };
                out.push((rel, is_dir, is_symlink, content));
                if is_dir && !is_symlink {
                    walk(root, &path, out);
                }
            }
        }

        let mut manifest = Vec::new();
        walk(root, root, &mut manifest);
        manifest
    }

    fn reset_cross_area_fixture_root(root: &Path) {
        if let Ok(metadata) = std::fs::symlink_metadata(root) {
            if metadata.is_dir() && !metadata.file_type().is_symlink() {
                std::fs::remove_dir_all(root).unwrap();
            } else {
                std::fs::remove_file(root).unwrap();
            }
        }
    }

    struct CrossAreaFixtureCleanup(PathBuf);

    impl Drop for CrossAreaFixtureCleanup {
        fn drop(&mut self) {
            reset_cross_area_fixture_root(&self.0);
        }
    }

    #[tokio::test]
    async fn test_scan_root_for_projects_finds_nested_skills() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // Create a project with a .claude/skills/ subdirectory.
        let project_dir = tmp.path().join("my-project");
        let skill_dir = project_dir.join(".claude/skills/deploy-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: deploy\ndescription: Deploy stuff\n---\n\n# Deploy\n",
        )
        .unwrap();

        // Build patterns: .claude/skills
        let patterns = vec![(
            "claude-code".to_string(),
            "Claude Code".to_string(),
            PathBuf::from(".claude/skills"),
        )];

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);

        assert_eq!(projects.len(), 1, "should find 1 project");
        assert_eq!(projects[0].project_name, "my-project");
        assert_eq!(projects[0].skills.len(), 1);
        assert_eq!(projects[0].skills[0].platform_id, "claude-code");
        assert_eq!(projects[0].skills[0].name, "deploy");
    }

    #[tokio::test]
    async fn test_scan_root_for_projects_finds_category_nested_platform_skills() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        let project_dir = tmp.path().join("hermes-project");
        let skill_dir = project_dir.join(".hermes/skills/mlops/evaluation/weights-and-biases");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: weights-and-biases\ndescription: Hermes category skill\n---\n",
        )
        .unwrap();

        let patterns = vec![(
            "hermes".to_string(),
            "Hermes".to_string(),
            PathBuf::from(".hermes/skills"),
        )];

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].project_name, "hermes-project");
        assert_eq!(projects[0].skills.len(), 1);
        assert_eq!(projects[0].skills[0].platform_id, "hermes");
        assert_eq!(
            projects[0].skills[0].id,
            "hermes__hermes-project__weights-and-biases"
        );
        assert!(projects[0].skills[0]
            .dir_path
            .contains(".hermes/skills/mlops/evaluation/weights-and-biases"));
    }

    #[tokio::test]
    async fn test_obsidian_exact_vault_root_discovers_vault_skills() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        let vault_dir = tmp.path().join("vault");
        std::fs::create_dir_all(vault_dir.join(".obsidian")).unwrap();
        let skill_dir = vault_dir.join(".agents/skills/research-helper");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: Research Helper\ndescription: Vault skill\n---\n\n# Research Helper\n",
        )
        .unwrap();

        let patterns = vec![(
            "codex".to_string(),
            "Codex CLI".to_string(),
            PathBuf::from(".agents/skills"),
        )];

        let projects = scan_root_for_projects(&vault_dir, &patterns, &central_dir);

        assert_eq!(projects.len(), 1, "exact vault root should be scanned");
        assert_eq!(projects[0].project_path, vault_dir.to_string_lossy());
        assert_eq!(projects[0].project_name, "vault");
        assert_eq!(projects[0].skills.len(), 1);
        assert_eq!(projects[0].skills[0].platform_id, "obsidian");
        assert_eq!(projects[0].skills[0].platform_name, "Obsidian");
        assert_eq!(projects[0].skills[0].name, "Research Helper");
    }

    #[tokio::test]
    async fn test_obsidian_registry_limits_allowed_vaults() {
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp
            .path()
            .join("Library/Mobile Documents/com~apple~CloudDocs");
        let happy = root.join("happy-geek");
        let make_money = root.join("make-money");
        let wiznote = root.join("wiznote-bak");
        let unregistered = root.join("0412");
        for vault in [&happy, &make_money, &wiznote, &unregistered] {
            std::fs::create_dir_all(vault.join(".obsidian")).unwrap();
        }

        let registry_path = tmp.path().join("obsidian.json");
        std::fs::write(
            &registry_path,
            serde_json::json!({
                "vaults": {
                    "happy": { "path": happy.to_string_lossy() },
                    "money": { "path": make_money.to_string_lossy() },
                    "wiz": { "path": wiznote.to_string_lossy() }
                }
            })
            .to_string(),
        )
        .unwrap();
        let root_scan = ScanRoot {
            path: root.to_string_lossy().to_string(),
            label: "iCloud".to_string(),
            exists: true,
            enabled: true,
        };

        let allowed =
            allowed_obsidian_vault_paths_for_roots_with_registry(&[&root_scan], &registry_path);
        let mut names: Vec<_> = allowed
            .iter()
            .map(|path| file_name_or_unknown(Path::new(path)))
            .collect();
        names.sort();

        assert_eq!(names, vec!["happy-geek", "make-money", "wiznote-bak"]);
        assert!(!names.contains(&"0412".to_string()));
    }

    #[tokio::test]
    async fn test_obsidian_registry_prefers_icloud_container_over_documents_vaults() {
        let tmp = tempfile::TempDir::new().unwrap();
        let obsidian_parent = tmp
            .path()
            .join("Library/Mobile Documents/iCloud~md~obsidian/Documents");
        let happy = obsidian_parent.join("happy-geek");
        let make_money = obsidian_parent.join("make-money");
        let wiznote = obsidian_parent.join("wiznote-bak");
        let orbit = tmp.path().join("Documents/Github/OrbitOS-vault");
        let cursor_project = tmp.path().join("Documents/CursorProjects/0412");
        for vault in [&happy, &make_money, &wiznote, &orbit, &cursor_project] {
            std::fs::create_dir_all(vault.join(".obsidian")).unwrap();
        }

        let registry_path = tmp.path().join("obsidian.json");
        std::fs::write(
            &registry_path,
            serde_json::json!({
                "vaults": {
                    "happy": { "path": happy.to_string_lossy() },
                    "money": { "path": make_money.to_string_lossy() },
                    "wiz": { "path": wiznote.to_string_lossy() },
                    "orbit": { "path": orbit.to_string_lossy() },
                    "cursor": { "path": cursor_project.to_string_lossy() }
                }
            })
            .to_string(),
        )
        .unwrap();
        let root_scan = ScanRoot {
            path: tmp.path().to_string_lossy().to_string(),
            label: "home".to_string(),
            exists: true,
            enabled: true,
        };

        let allowed =
            allowed_obsidian_vault_paths_for_roots_with_registry(&[&root_scan], &registry_path);
        let mut names: Vec<_> = allowed
            .iter()
            .map(|path| file_name_or_unknown(Path::new(path)))
            .collect();
        names.sort();

        assert_eq!(names, vec!["happy-geek", "make-money", "wiznote-bak"]);
    }

    #[tokio::test]
    async fn test_obsidian_vault_list_hides_vaults_without_skills() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        let obsidian_parent = tmp
            .path()
            .join("Library/Mobile Documents/iCloud~md~obsidian/Documents");
        let happy = obsidian_parent.join("happy-geek");
        let make_money = obsidian_parent.join("make-money");
        let wiznote = obsidian_parent.join("wiznote-bak");
        for vault in [&happy, &make_money, &wiznote] {
            std::fs::create_dir_all(vault.join(".obsidian")).unwrap();
        }
        std::fs::create_dir_all(&central_dir).unwrap();
        create_skill(
            &make_money.join(".agents/skills"),
            "money-researcher",
            "Money Researcher",
            "Only populated vault",
        );

        let allowed: HashSet<String> = [&happy, &make_money, &wiznote]
            .into_iter()
            .map(|path| normalized_scan_root_key(&path.to_string_lossy()))
            .collect();
        let vaults = obsidian_vaults_from_allowed_paths(&allowed, &central_dir);
        let names: Vec<_> = vaults.iter().map(|vault| vault.name.as_str()).collect();

        assert_eq!(names, vec!["make-money"]);
        assert_eq!(vaults[0].skill_count, 1);
    }

    #[tokio::test]
    async fn test_project_scan_fallback_uses_only_direct_icloud_vault_children() {
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp
            .path()
            .join("Library/Mobile Documents/com~apple~CloudDocs");
        let central_dir = tmp.path().join("central");
        let happy = root.join("happy-geek");
        let nested = root.join("CursorProjects").join("0412");
        std::fs::create_dir_all(happy.join(".obsidian")).unwrap();
        std::fs::create_dir_all(nested.join(".obsidian")).unwrap();
        std::fs::create_dir_all(&central_dir).unwrap();
        create_skill(
            &happy.join(".agents/skills"),
            "happy-skill",
            "Happy Skill",
            "Allowed direct child vault",
        );
        create_skill(
            &nested.join(".agents/skills"),
            "nested-skill",
            "Nested Skill",
            "Not a direct iCloud child vault",
        );

        let pool = setup_test_db().await;
        let roots = vec![ScanRoot {
            path: root.to_string_lossy().to_string(),
            label: "iCloud".to_string(),
            exists: true,
            enabled: true,
        }];

        let result = start_project_scan_impl(&pool, roots, &central_dir, |_| {})
            .await
            .unwrap();
        let project_names: Vec<_> = result
            .projects
            .iter()
            .map(|project| project.project_name.as_str())
            .collect();

        assert_eq!(project_names, vec!["0412", "happy-geek"]);
        assert_eq!(result.total_skills, 2);
        let happy_project = result
            .projects
            .iter()
            .find(|project| project.project_name == "happy-geek")
            .unwrap();
        let nested_project = result
            .projects
            .iter()
            .find(|project| project.project_name == "0412")
            .unwrap();
        assert_eq!(happy_project.skills[0].platform_id, OBSIDIAN_PLATFORM_ID);
        assert_ne!(nested_project.skills[0].platform_id, OBSIDIAN_PLATFORM_ID);
    }

    #[tokio::test]
    async fn test_get_scan_roots_merges_icloud_drive_and_custom_roots() {
        let tmp = tempfile::TempDir::new().unwrap();
        let home = tmp.path().join("home");
        let icloud_root = home
            .join("Library")
            .join("Mobile Documents")
            .join("com~apple~CloudDocs");
        let custom_active = tmp.path().join("custom-active-vault");
        let custom_inactive = tmp.path().join("custom-inactive-vault");
        std::fs::create_dir_all(&icloud_root).unwrap();
        std::fs::create_dir_all(&custom_active).unwrap();
        std::fs::create_dir_all(&custom_inactive).unwrap();

        let pool = setup_test_db().await;
        db::add_scan_directory(
            &pool,
            &custom_active.to_string_lossy(),
            Some("Custom Active"),
        )
        .await
        .unwrap();
        db::add_scan_directory(&pool, &custom_inactive.to_string_lossy(), None)
            .await
            .unwrap();
        db::toggle_scan_directory(&pool, &custom_inactive.to_string_lossy(), false)
            .await
            .unwrap();
        db::add_scan_directory(
            &pool,
            &icloud_root.to_string_lossy(),
            Some("Duplicate iCloud"),
        )
        .await
        .unwrap();

        let mut config = HashMap::new();
        config.insert(icloud_root.to_string_lossy().to_string(), false);
        db::set_setting(
            &pool,
            "discover_scan_roots_config",
            &serde_json::to_string(&config).unwrap(),
        )
        .await
        .unwrap();

        let roots = build_scan_roots(&pool, default_scan_roots_for_home(&home))
            .await
            .unwrap();

        let icloud_matches: Vec<_> = roots
            .iter()
            .filter(|root| root.path == icloud_root.to_string_lossy())
            .collect();
        assert_eq!(
            icloud_matches.len(),
            1,
            "default iCloud root and custom duplicate should collapse"
        );
        assert_eq!(icloud_matches[0].label, "iCloud");
        assert!(icloud_matches[0].exists);
        assert!(
            !icloud_matches[0].enabled,
            "persisted Discover override should apply to merged default root"
        );

        let active = roots
            .iter()
            .find(|root| root.path == custom_active.to_string_lossy())
            .expect("custom active root should be merged");
        assert_eq!(active.label, "Custom Active");
        assert!(active.exists);
        assert!(active.enabled);

        let inactive = roots
            .iter()
            .find(|root| root.path == custom_inactive.to_string_lossy())
            .expect("custom inactive root should be merged");
        assert_eq!(inactive.label, "custom-inactive-vault");
        assert!(inactive.exists);
        assert!(!inactive.enabled);

        assert!(
            roots
                .iter()
                .all(|root| !root.path.ends_with(".claude/skills")),
            "built-in agent scan directory rows must not be merged into Discover roots"
        );
    }

    #[tokio::test]
    async fn test_build_scan_roots_normalizes_quoted_custom_path() {
        let tmp = tempfile::TempDir::new().unwrap();
        let vault = tmp
            .path()
            .join("Library")
            .join("Mobile Documents")
            .join("com~apple~CloudDocs")
            .join("make-money");
        std::fs::create_dir_all(&vault).unwrap();

        let pool = setup_test_db().await;
        let quoted_path = format!("'{}'", vault.to_string_lossy());
        db::add_scan_directory(&pool, &quoted_path, None)
            .await
            .unwrap();

        let roots = build_scan_roots(&pool, vec![]).await.unwrap();

        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].path, vault.to_string_lossy());
        assert_eq!(roots[0].label, "make-money");
        assert!(roots[0].exists);
    }

    #[tokio::test]
    async fn test_build_scan_roots_filters_custom_child_of_default_root() {
        let tmp = tempfile::TempDir::new().unwrap();
        let icloud = tmp
            .path()
            .join("Library")
            .join("Mobile Documents")
            .join("com~apple~CloudDocs");
        let child = icloud.join("make-money");
        std::fs::create_dir_all(&child).unwrap();

        let pool = setup_test_db().await;
        db::add_scan_directory(&pool, &child.to_string_lossy(), Some("make-money"))
            .await
            .unwrap();

        let roots = build_scan_roots(
            &pool,
            vec![ScanRoot {
                path: icloud.to_string_lossy().to_string(),
                label: "iCloud".to_string(),
                exists: true,
                enabled: true,
            }],
        )
        .await
        .unwrap();

        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].path, icloud.to_string_lossy());
    }

    #[tokio::test]
    async fn test_build_scan_roots_filters_custom_child_of_custom_parent() {
        let tmp = tempfile::TempDir::new().unwrap();
        let parent = tmp.path().join("workspace");
        let child = parent.join("nested project");
        std::fs::create_dir_all(&child).unwrap();

        let pool = setup_test_db().await;
        db::add_scan_directory(&pool, &parent.to_string_lossy(), Some("Workspace"))
            .await
            .unwrap();
        let quoted_child = format!("'{}'", child.to_string_lossy());
        db::add_scan_directory(&pool, &quoted_child, Some("Nested Project"))
            .await
            .unwrap();

        let roots = build_scan_roots(&pool, vec![]).await.unwrap();

        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].path, parent.to_string_lossy());
        assert_eq!(roots[0].label, "Workspace");
    }

    #[tokio::test]
    async fn test_build_scan_roots_filters_legacy_obsidian_icloud_custom_paths() {
        let tmp = tempfile::TempDir::new().unwrap();
        let legacy_parent = tmp
            .path()
            .join("Library")
            .join("Mobile Documents")
            .join("iCloud~md~obsidian")
            .join("Documents");
        let legacy_child = legacy_parent.join("make-money");
        std::fs::create_dir_all(&legacy_child).unwrap();

        let pool = setup_test_db().await;
        db::add_scan_directory(
            &pool,
            &legacy_parent.to_string_lossy(),
            Some("Obsidian iCloud"),
        )
        .await
        .unwrap();
        let quoted_child = format!("'{}'", legacy_child.to_string_lossy());
        db::add_scan_directory(&pool, &quoted_child, Some("make-money"))
            .await
            .unwrap();

        let roots = build_scan_roots(&pool, vec![]).await.unwrap();

        assert!(
            roots.is_empty(),
            "legacy Obsidian iCloud roots and their children should be hidden"
        );
    }

    #[tokio::test]
    async fn test_build_scan_roots_unescapes_shell_escaped_spaces() {
        let tmp = tempfile::TempDir::new().unwrap();
        let vault = tmp
            .path()
            .join("Library")
            .join("Mobile Documents")
            .join("com~apple~CloudDocs")
            .join("skills");
        std::fs::create_dir_all(&vault).unwrap();

        let pool = setup_test_db().await;
        let escaped_path = vault
            .to_string_lossy()
            .replace("Mobile Documents", "Mobile\\ Documents");
        db::add_scan_directory(&pool, &escaped_path, Some("Escaped iCloud"))
            .await
            .unwrap();

        let roots = build_scan_roots(&pool, vec![]).await.unwrap();

        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].path, vault.to_string_lossy());
        assert_eq!(roots[0].label, "Escaped iCloud");
        assert!(roots[0].exists);
    }

    #[tokio::test]
    async fn test_build_scan_roots_preserves_apostrophes_inside_path() {
        let tmp = tempfile::TempDir::new().unwrap();
        let vault = tmp.path().join("Bob's Vault");
        std::fs::create_dir_all(&vault).unwrap();

        let pool = setup_test_db().await;
        db::add_scan_directory(&pool, &vault.to_string_lossy(), None)
            .await
            .unwrap();

        let roots = build_scan_roots(&pool, vec![]).await.unwrap();

        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].path, vault.to_string_lossy());
        assert_eq!(roots[0].label, "Bob's Vault");
        assert!(roots[0].exists);
    }

    #[tokio::test]
    async fn test_build_scan_roots_applies_quoted_persisted_config_key() {
        let tmp = tempfile::TempDir::new().unwrap();
        let icloud = tmp
            .path()
            .join("Library")
            .join("Mobile Documents")
            .join("com~apple~CloudDocs");
        std::fs::create_dir_all(&icloud).unwrap();
        let icloud_path = icloud.to_string_lossy().to_string();

        let pool = setup_test_db().await;
        let mut config = HashMap::new();
        config.insert(format!("'{}'", icloud_path), false);
        db::set_setting(
            &pool,
            "discover_scan_roots_config",
            &serde_json::to_string(&config).unwrap(),
        )
        .await
        .unwrap();

        let roots = build_scan_roots(
            &pool,
            vec![ScanRoot {
                path: icloud_path.clone(),
                label: "iCloud".to_string(),
                exists: true,
                enabled: true,
            }],
        )
        .await
        .unwrap();

        assert_eq!(roots[0].path, icloud_path);
        assert!(!roots[0].enabled);
    }

    #[tokio::test]
    async fn test_set_scan_root_enabled_writes_normalized_config_key() {
        let tmp = tempfile::TempDir::new().unwrap();
        let icloud = tmp
            .path()
            .join("Library")
            .join("Mobile Documents")
            .join("com~apple~CloudDocs");
        std::fs::create_dir_all(&icloud).unwrap();
        let icloud_path = icloud.to_string_lossy().to_string();

        let pool = setup_test_db().await;
        super::set_scan_root_enabled_impl(&pool, format!("'{}'", icloud_path), false)
            .await
            .unwrap();

        let json = db::get_setting(&pool, "discover_scan_roots_config")
            .await
            .unwrap()
            .expect("config should be persisted");
        let config: HashMap<String, bool> = serde_json::from_str(&json).unwrap();

        assert_eq!(config.get(&icloud_path), Some(&false));
        assert!(
            !config.contains_key(&format!("'{}'", icloud_path)),
            "quoted shell path must not be persisted as the config key"
        );
    }

    #[tokio::test]
    async fn test_obsidian_parent_scan_supported_locations_and_marker_requirement() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        let vault_dir = tmp.path().join("marked-vault");
        std::fs::create_dir_all(vault_dir.join(".obsidian")).unwrap();
        create_skill(
            &vault_dir.join(".skills"),
            "native-skill",
            "Native Skill",
            "From .skills",
        );
        create_skill(
            &vault_dir.join(".agents/skills"),
            "agents-skill",
            "Agents Skill",
            "From .agents",
        );
        create_skill(
            &vault_dir.join(".claude/skills"),
            "claude-skill",
            "Claude Skill",
            "From .claude",
        );

        let ordinary_dir = tmp.path().join("ordinary-project");
        create_skill(
            &ordinary_dir.join(".agents/skills"),
            "ordinary-skill",
            "Ordinary Skill",
            "No vault marker",
        );

        let mut projects = scan_for_test(tmp.path(), &central_dir);
        projects.sort_by(|a, b| a.project_name.cmp(&b.project_name));

        let vault = projects
            .iter()
            .find(|project| project.project_path == vault_dir.to_string_lossy())
            .expect("marked vault should be discovered as its own project");
        assert_eq!(vault.skills.len(), 3);
        assert!(vault
            .skills
            .iter()
            .all(|skill| skill.platform_id == OBSIDIAN_PLATFORM_ID
                && skill.platform_name == OBSIDIAN_PLATFORM_NAME));
        let selected_dirs: Vec<String> = vault
            .skills
            .iter()
            .map(|skill| selected_skill_dir_name(&skill.dir_path))
            .collect();
        assert!(selected_dirs.contains(&"native-skill".to_string()));
        assert!(selected_dirs.contains(&"agents-skill".to_string()));
        assert!(selected_dirs.contains(&"claude-skill".to_string()));

        let ordinary = projects
            .iter()
            .find(|project| project.project_path == ordinary_dir.to_string_lossy())
            .expect("unmarked project should retain ordinary Discover behavior");
        assert_eq!(ordinary.skills.len(), 1);
        assert_eq!(ordinary.skills[0].platform_id, "codex");
        assert_ne!(ordinary.skills[0].platform_id, OBSIDIAN_PLATFORM_ID);
    }

    #[tokio::test]
    async fn test_obsidian_duplicate_priority_and_invalid_fallback() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();
        let vault_dir = tmp.path().join("vault");
        std::fs::create_dir_all(vault_dir.join(".obsidian")).unwrap();

        create_skill(
            &vault_dir.join(".skills"),
            "shared",
            "Shared Native",
            "native",
        );
        create_skill(
            &vault_dir.join(".agents/skills"),
            "shared",
            "Shared Agents",
            "agents",
        );
        create_skill(
            &vault_dir.join(".claude/skills"),
            "shared",
            "Shared Claude",
            "claude",
        );

        let projects = scan_for_test(&vault_dir, &central_dir);
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].skills.len(), 1);
        assert!(
            projects[0].skills[0].dir_path.contains(".skills/shared"),
            ".skills should win over lower-priority duplicates"
        );

        std::fs::remove_dir_all(vault_dir.join(".skills/shared")).unwrap();
        let projects = scan_for_test(&vault_dir, &central_dir);
        assert_eq!(projects[0].skills.len(), 1);
        assert!(
            projects[0].skills[0]
                .dir_path
                .contains(".agents/skills/shared"),
            ".agents/skills should win when .skills is absent"
        );

        std::fs::remove_dir_all(vault_dir.join(".agents/skills/shared")).unwrap();
        create_invalid_skill(&vault_dir.join(".agents/skills"), "shared");
        let projects = scan_for_test(&vault_dir, &central_dir);
        assert_eq!(projects[0].skills.len(), 1);
        assert!(
            projects[0].skills[0]
                .dir_path
                .contains(".claude/skills/shared"),
            "invalid higher-priority duplicate must fall back to valid lower-priority source"
        );
    }

    #[tokio::test]
    async fn test_obsidian_dedupe_is_scoped_by_full_vault_path() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        let vault_a = tmp.path().join("team-a").join("same-name");
        let vault_b = tmp.path().join("team-b").join("same-name");
        for vault in [&vault_a, &vault_b] {
            std::fs::create_dir_all(vault.join(".obsidian")).unwrap();
            create_skill(
                &vault.join(".skills"),
                "shared-id",
                "Shared",
                "same skill id in different vaults",
            );
        }

        let projects = scan_for_test(tmp.path(), &central_dir);
        let vault_projects: Vec<_> = projects
            .iter()
            .filter(|project| project.project_name == "same-name")
            .collect();
        assert_eq!(vault_projects.len(), 2);

        let ids: std::collections::HashSet<_> = vault_projects
            .iter()
            .map(|project| project.skills[0].id.as_str())
            .collect();
        assert_eq!(
            ids.len(),
            2,
            "same basename and skill id in different vaults must remain distinct"
        );
        assert!(vault_projects
            .iter()
            .any(|project| project.project_path == vault_a.to_string_lossy()));
        assert!(vault_projects
            .iter()
            .any(|project| project.project_path == vault_b.to_string_lossy()));
    }

    #[tokio::test]
    async fn test_scan_root_for_projects_skips_dirs_without_skills() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // A project dir with no skill subdirectories.
        let project_dir = tmp.path().join("empty-project");
        std::fs::create_dir_all(project_dir.join("src")).unwrap();

        let patterns = vec![(
            "claude-code".to_string(),
            "Claude Code".to_string(),
            PathBuf::from(".claude/skills"),
        )];

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);
        assert!(
            projects.is_empty(),
            "should not find projects without skills"
        );
    }

    #[tokio::test]
    async fn test_scan_root_for_projects_handles_multiple_platforms() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        let project_dir = tmp.path().join("multi-project");
        // Create skills for two platforms.
        let claude_skill = project_dir.join(".claude/skills/claude-skill");
        std::fs::create_dir_all(&claude_skill).unwrap();
        std::fs::write(
            claude_skill.join("SKILL.md"),
            "---\nname: claude-skill\ndescription: test\n---\n\n# Test\n",
        )
        .unwrap();

        let cursor_skill = project_dir.join(".cursor/skills/cursor-skill");
        std::fs::create_dir_all(&cursor_skill).unwrap();
        std::fs::write(
            cursor_skill.join("SKILL.md"),
            "---\nname: cursor-skill\ndescription: test\n---\n\n# Test\n",
        )
        .unwrap();

        let patterns = vec![
            (
                "claude-code".to_string(),
                "Claude Code".to_string(),
                PathBuf::from(".claude/skills"),
            ),
            (
                "cursor".to_string(),
                "Cursor".to_string(),
                PathBuf::from(".cursor/skills"),
            ),
        ];

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].skills.len(), 2);
    }

    #[tokio::test]
    async fn test_scan_root_for_projects_detects_already_central() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // Create a skill in central.
        let central_skill = central_dir.join("shared-skill");
        std::fs::create_dir_all(&central_skill).unwrap();
        std::fs::write(
            central_skill.join("SKILL.md"),
            "---\nname: shared-skill\n---\n\n# Test\n",
        )
        .unwrap();

        // Create the same skill name in a project.
        let project_dir = tmp.path().join("my-project");
        let project_skill = project_dir.join(".claude/skills/shared-skill");
        std::fs::create_dir_all(&project_skill).unwrap();
        std::fs::write(
            project_skill.join("SKILL.md"),
            "---\nname: shared-skill\n---\n\n# Test\n",
        )
        .unwrap();

        let patterns = vec![(
            "claude-code".to_string(),
            "Claude Code".to_string(),
            PathBuf::from(".claude/skills"),
        )];

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].skills.len(), 1);
        assert!(
            projects[0].skills[0].is_already_central,
            "should detect skill is already in central"
        );
    }

    #[tokio::test]
    async fn test_import_discovered_skill_to_central_copies_and_persists() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        db::init_database(&pool).await.unwrap();

        // Override central dir for testing.
        let central_dir = tmp.path().join("central");
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'central'")
            .bind(central_dir.to_str().unwrap())
            .execute(&pool)
            .await
            .unwrap();

        std::fs::create_dir_all(&central_dir).unwrap();

        // Create a discovered skill.
        let skill_dir = tmp.path().join("project/.claude/skills/my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: my-skill\ndescription: A test skill\n---\n\n# My Skill\n",
        )
        .unwrap();

        // Insert discovered skill record.
        let now = Utc::now().to_rfc3339();
        db::insert_discovered_skill(
            &pool,
            "claude-code__project__my-skill",
            "my-skill",
            Some("A test skill"),
            &skill_dir.join("SKILL.md").to_string_lossy(),
            &skill_dir.to_string_lossy(),
            &tmp.path().join("project").to_string_lossy(),
            "project",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        // Set HOME to tmp so import_discovered_skill_to_central finds the right dir.
        // We'll call the impl directly instead.
        let result = import_discovered_skill_to_central_impl(
            &pool,
            "claude-code__project__my-skill",
            &central_dir,
        )
        .await;

        assert!(result.is_ok(), "import should succeed: {:?}", result);

        // Verify the skill was copied to central.
        let target = central_dir.join("my-skill");
        assert!(target.exists(), "skill should be copied to central");
        assert!(
            target.join("SKILL.md").exists(),
            "SKILL.md should exist in central"
        );

        // Verify discovered skill record was removed.
        let record = db::get_discovered_skill_by_id(&pool, "claude-code__project__my-skill")
            .await
            .unwrap();
        assert!(
            record.is_none(),
            "discovered skill record should be removed"
        );
    }

    /// Implementation of import_discovered_skill_to_central that accepts a custom central_dir
    /// for testing (avoids depending on $HOME).
    async fn import_discovered_skill_to_central_impl(
        pool: &DbPool,
        discovered_skill_id: &str,
        central_dir: &Path,
    ) -> Result<ImportResult, String> {
        let skill = db::get_discovered_skill_by_id(pool, discovered_skill_id)
            .await?
            .ok_or_else(|| format!("Discovered skill '{}' not found", discovered_skill_id))?;

        let skill_dir_name = Path::new(&skill.dir_path)
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "Cannot extract skill directory name".to_string())?
            .to_string();

        let target_dir = central_dir.join(&skill_dir_name);

        if target_dir.exists() {
            return Err(format!(
                "A skill named '{}' already exists in central skills",
                skill_dir_name
            ));
        }

        std::fs::create_dir_all(central_dir)
            .map_err(|e| format!("Failed to create central dir: {}", e))?;

        linker::copy_dir_all(Path::new(&skill.dir_path), &target_dir)?;

        let skill_md_path = target_dir.join("SKILL.md");
        let info = super::super::scanner::parse_skill_md(&skill_md_path);

        if let Some(skill_info) = info {
            let now = Utc::now().to_rfc3339();
            let db_skill = db::Skill {
                id: skill_dir_name.clone(),
                name: skill_info.name,
                description: skill_info.description,
                file_path: skill_md_path.to_string_lossy().into_owned(),
                canonical_path: Some(target_dir.to_string_lossy().into_owned()),
                is_central: true,
                source: Some("copy".to_string()),
                content: None,
                scanned_at: now,
            };
            db::upsert_skill(pool, &db_skill).await?;
        }

        db::delete_discovered_skill(pool, discovered_skill_id).await?;

        Ok(ImportResult {
            skill_id: skill_dir_name,
            target: "central".to_string(),
        })
    }

    // ── Additional tests ──────────────────────────────────────────────────────

    /// Helper: set up an in-memory DB with initialized schema.
    async fn setup_test_db() -> DbPool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        db::init_database(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn test_import_discovered_skill_to_platform_creates_symlink() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;

        // Override agent skills dir for testing.
        let agent_dir = tmp.path().join("agent-skills");
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'claude-code'")
            .bind(agent_dir.to_str().unwrap())
            .execute(&pool)
            .await
            .unwrap();

        std::fs::create_dir_all(&agent_dir).unwrap();

        // Create a discovered skill in a project.
        let skill_dir = tmp.path().join("project/.claude/skills/my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: my-skill\ndescription: A test skill\n---\n\n# My Skill\n",
        )
        .unwrap();

        let now = Utc::now().to_rfc3339();
        db::insert_discovered_skill(
            &pool,
            "claude-code__project__my-skill",
            "my-skill",
            Some("A test skill"),
            &skill_dir.join("SKILL.md").to_string_lossy(),
            &skill_dir.to_string_lossy(),
            &tmp.path().join("project").to_string_lossy(),
            "project",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        // Import to platform using the impl function.
        let result = import_discovered_skill_to_platform_impl(
            &pool,
            "claude-code__project__my-skill",
            "claude-code",
            &agent_dir,
        )
        .await;

        assert!(result.is_ok(), "import should succeed: {:?}", result);

        // Verify the symlink was created.
        let link_path = agent_dir.join("my-skill");
        assert!(link_path.exists(), "symlink target should exist");
        let meta = std::fs::symlink_metadata(&link_path).unwrap();
        assert!(meta.is_symlink(), "should be a symlink");

        // Verify discovered skill record is KEPT (not deleted) after platform install.
        // This enables multi-platform install — the record stays so it can be
        // installed to additional platforms.
        let record = db::get_discovered_skill_by_id(&pool, "claude-code__project__my-skill")
            .await
            .unwrap();
        assert!(
            record.is_some(),
            "discovered skill record should be kept after platform install"
        );
    }

    #[tokio::test]
    async fn test_obsidian_correlated_fixture_scan_import_cache_and_vault_manifest() {
        let fixture_root = PathBuf::from(CROSS_AREA_FIXTURE_ROOT);
        reset_cross_area_fixture_root(&fixture_root);
        let _cleanup = CrossAreaFixtureCleanup(fixture_root.clone());
        let pool = setup_test_db().await;
        let central_dir = PathBuf::from(CROSS_AREA_FIXTURE_CENTRAL_DIR);
        let claude_install_dir = PathBuf::from(CROSS_AREA_FIXTURE_CLAUDE_PLATFORM_DIR);
        let cursor_install_dir = PathBuf::from(CROSS_AREA_FIXTURE_CURSOR_PLATFORM_DIR);
        std::fs::create_dir_all(&central_dir).unwrap();
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'claude-code'")
            .bind(claude_install_dir.to_string_lossy().to_string())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'cursor'")
            .bind(cursor_install_dir.to_string_lossy().to_string())
            .execute(&pool)
            .await
            .unwrap();

        let obsidian_parent = PathBuf::from(CROSS_AREA_FIXTURE_PARENT_PATH);
        let vault_dir = PathBuf::from(CROSS_AREA_FIXTURE_VAULT_PATH);
        std::fs::create_dir_all(vault_dir.join(".obsidian")).unwrap();
        let source_skill_dir = create_skill(
            &vault_dir.join(".agents/skills"),
            CROSS_AREA_FIXTURE_SKILL_DIR_NAME,
            CROSS_AREA_FIXTURE_SKILL_NAME,
            CROSS_AREA_FIXTURE_SKILL_DESCRIPTION,
        );
        assert_eq!(
            source_skill_dir,
            PathBuf::from(CROSS_AREA_FIXTURE_SOURCE_DIR)
        );
        std::fs::write(
            source_skill_dir.join("notes.md"),
            "vault-owned fixture content must remain unchanged",
        )
        .unwrap();

        std::fs::create_dir_all(vault_dir.join(".claude/skills")).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                &source_skill_dir,
                vault_dir
                    .join(".claude/skills")
                    .join(CROSS_AREA_FIXTURE_SKILL_DIR_NAME),
            )
            .unwrap();
            std::os::unix::fs::symlink(
                vault_dir.join(".agents/skills/missing-target"),
                vault_dir.join(".claude/skills/broken-money-researcher"),
            )
            .unwrap();
        }

        let ordinary_project = obsidian_parent.join("ordinary-project");
        let ordinary_skill_dir = create_skill(
            &ordinary_project.join(".claude/skills"),
            "ordinary-check",
            "Ordinary Check",
            "Non-Obsidian regression",
        );

        db::add_scan_directory(
            &pool,
            &obsidian_parent.to_string_lossy(),
            Some("Fixture Obsidian Parent"),
        )
        .await
        .unwrap();
        let roots = vec![
            ScanRoot {
                path: CROSS_AREA_FIXTURE_VAULT_PATH.to_string(),
                label: CROSS_AREA_FIXTURE_VAULT_NAME.to_string(),
                exists: true,
                enabled: true,
            },
            ScanRoot {
                path: ordinary_project.to_string_lossy().to_string(),
                label: "ordinary-project".to_string(),
                exists: true,
                enabled: true,
            },
        ];

        let before_manifest = vault_manifest(&vault_dir);
        let result = start_project_scan_impl(&pool, roots.clone(), &central_dir, |_| {})
            .await
            .unwrap();

        assert_eq!(result.total_projects, 2);
        assert_eq!(result.total_skills, 2);

        let vault = result
            .projects
            .iter()
            .find(|project| project.project_path == CROSS_AREA_FIXTURE_VAULT_PATH)
            .expect("Obsidian vault project should be present");
        assert_eq!(vault.project_name, CROSS_AREA_FIXTURE_VAULT_NAME);
        assert_eq!(vault.skills.len(), 1);
        let fixture_skill = &vault.skills[0];
        assert_eq!(fixture_skill.id, CROSS_AREA_FIXTURE_SKILL_ID);
        assert_eq!(fixture_skill.name, CROSS_AREA_FIXTURE_SKILL_NAME);
        assert_eq!(
            fixture_skill.description.as_deref(),
            Some(CROSS_AREA_FIXTURE_SKILL_DESCRIPTION)
        );
        assert_eq!(fixture_skill.platform_id, OBSIDIAN_PLATFORM_ID);
        assert_eq!(fixture_skill.platform_name, OBSIDIAN_PLATFORM_NAME);
        assert_eq!(fixture_skill.project_path, CROSS_AREA_FIXTURE_VAULT_PATH);
        assert_eq!(fixture_skill.dir_path, CROSS_AREA_FIXTURE_SOURCE_DIR);
        assert_eq!(fixture_skill.file_path, CROSS_AREA_FIXTURE_SOURCE_FILE);

        let ordinary = result
            .projects
            .iter()
            .find(|project| project.project_path == ordinary_project.to_string_lossy())
            .expect("ordinary non-Obsidian project should remain discoverable");
        assert_eq!(ordinary.skills.len(), 1);
        assert_eq!(ordinary.skills[0].platform_id, "claude-code");
        assert_eq!(
            ordinary.skills[0].dir_path,
            ordinary_skill_dir.to_string_lossy()
        );

        let persisted = db::get_discovered_skill_by_id(&pool, &fixture_skill.id)
            .await
            .unwrap()
            .expect("Obsidian fixture should be persisted");
        assert_eq!(persisted.id, CROSS_AREA_FIXTURE_SKILL_ID);
        assert_eq!(persisted.project_path, CROSS_AREA_FIXTURE_VAULT_PATH);
        assert_eq!(persisted.file_path, CROSS_AREA_FIXTURE_SOURCE_FILE);
        assert_eq!(persisted.dir_path, CROSS_AREA_FIXTURE_SOURCE_DIR);

        let cached = get_discovered_skills_impl(&pool, &central_dir)
            .await
            .unwrap();
        let cached_vault = cached
            .iter()
            .find(|project| project.project_path == CROSS_AREA_FIXTURE_VAULT_PATH)
            .expect("cached Obsidian vault should reload by project path");
        assert_eq!(cached_vault.project_name, CROSS_AREA_FIXTURE_VAULT_NAME);
        assert_eq!(cached_vault.skills[0].id, CROSS_AREA_FIXTURE_SKILL_ID);
        assert_eq!(
            cached_vault.skills[0].file_path,
            CROSS_AREA_FIXTURE_SOURCE_FILE
        );
        assert!(!cached_vault.skills[0].is_already_central);

        let platform_result = import_discovered_skill_to_platform_from_pool(
            &pool,
            &fixture_skill.id,
            "claude-code",
            Some("symlink"),
        )
        .await
        .unwrap();
        assert_eq!(platform_result.skill_id, CROSS_AREA_FIXTURE_SKILL_DIR_NAME);
        let platform_target = PathBuf::from(CROSS_AREA_FIXTURE_SYMLINK_TARGET);
        assert!(std::fs::symlink_metadata(&platform_target)
            .unwrap()
            .file_type()
            .is_symlink());
        let platform_install =
            db::get_skill_installations(&pool, CROSS_AREA_FIXTURE_SKILL_DIR_NAME)
                .await
                .unwrap()
                .into_iter()
                .find(|installation| installation.agent_id == "claude-code")
                .expect("platform install row should be recorded for the same fixture skill");
        assert_eq!(platform_install.link_type, "symlink");
        assert_eq!(
            platform_install.symlink_target.as_deref(),
            Some(CROSS_AREA_FIXTURE_SOURCE_DIR)
        );

        let copy_result = import_discovered_skill_to_platform_from_pool(
            &pool,
            &fixture_skill.id,
            "cursor",
            Some("copy"),
        )
        .await
        .unwrap();
        assert_eq!(copy_result.skill_id, CROSS_AREA_FIXTURE_SKILL_DIR_NAME);
        let copy_target = PathBuf::from(CROSS_AREA_FIXTURE_COPY_TARGET);
        let copy_meta = std::fs::symlink_metadata(&copy_target).unwrap();
        assert!(copy_meta.is_dir());
        assert!(!copy_meta.file_type().is_symlink());
        assert_eq!(
            std::fs::read_to_string(copy_target.join("notes.md")).unwrap(),
            "vault-owned fixture content must remain unchanged"
        );
        let copy_install = db::get_skill_installations(&pool, CROSS_AREA_FIXTURE_SKILL_DIR_NAME)
            .await
            .unwrap()
            .into_iter()
            .find(|installation| installation.agent_id == "cursor")
            .expect("copy install row should be recorded for the same fixture skill");
        assert_eq!(copy_install.link_type, "copy");
        assert_eq!(copy_install.installed_path, CROSS_AREA_FIXTURE_COPY_TARGET);
        assert!(
            db::get_discovered_skill_by_id(&pool, &fixture_skill.id)
                .await
                .unwrap()
                .is_some(),
            "platform install should keep the fixture row available for later central import"
        );
        assert_eq!(
            before_manifest,
            vault_manifest(&vault_dir),
            "platform install must not mutate the source Obsidian vault"
        );

        let import_result =
            import_discovered_skill_to_central_impl(&pool, &fixture_skill.id, &central_dir)
                .await
                .unwrap();
        assert_eq!(import_result.skill_id, CROSS_AREA_FIXTURE_SKILL_DIR_NAME);
        let central_target = PathBuf::from(CROSS_AREA_FIXTURE_CENTRAL_TARGET);
        assert!(central_target.join("SKILL.md").exists());
        assert_eq!(
            std::fs::read_to_string(central_target.join("notes.md")).unwrap(),
            "vault-owned fixture content must remain unchanged"
        );
        assert!(
            db::get_discovered_skill_by_id(&pool, &fixture_skill.id)
                .await
                .unwrap()
                .is_none(),
            "central import should remove the immediate Obsidian discovered row"
        );
        assert!(
            db::get_discovered_skill_by_id(&pool, &ordinary.skills[0].id)
                .await
                .unwrap()
                .is_some(),
            "central import should not remove ordinary Discover rows"
        );
        assert_eq!(
            before_manifest,
            vault_manifest(&vault_dir),
            "scan and import must not mutate the source Obsidian vault"
        );

        let rescan = start_project_scan_impl(&pool, roots, &central_dir, |_| {})
            .await
            .unwrap();
        let rescanned_vault = rescan
            .projects
            .iter()
            .find(|project| project.project_path == CROSS_AREA_FIXTURE_VAULT_PATH)
            .expect("vault should be rediscovered after central import");
        assert_eq!(rescanned_vault.skills[0].id, CROSS_AREA_FIXTURE_SKILL_ID);
        assert!(
            rescanned_vault.skills[0].is_already_central,
            "rescan should correlate the same fixture with its central target"
        );
    }

    #[tokio::test]
    async fn test_obsidian_discovered_platform_install_honors_symlink_and_copy_methods() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;

        let claude_dir = tmp.path().join("claude-skills");
        let cursor_dir = tmp.path().join("cursor-skills");
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'claude-code'")
            .bind(claude_dir.to_string_lossy().to_string())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE agents SET global_skills_dir = ? WHERE id = 'cursor'")
            .bind(cursor_dir.to_string_lossy().to_string())
            .execute(&pool)
            .await
            .unwrap();

        let vault_dir = tmp.path().join("make-money");
        std::fs::create_dir_all(vault_dir.join(".obsidian")).unwrap();
        let skill_dir = create_skill(
            &vault_dir.join(".agents/skills"),
            "platform-methods",
            "Platform Methods",
            "Install method fixture",
        );
        std::fs::write(skill_dir.join("extra.txt"), "copy me").unwrap();

        let now = Utc::now().to_rfc3339();
        db::insert_discovered_skill(
            &pool,
            "obsidian__fixture__platform-methods",
            "Platform Methods",
            Some("Install method fixture"),
            &skill_dir.join("SKILL.md").to_string_lossy(),
            &skill_dir.to_string_lossy(),
            &vault_dir.to_string_lossy(),
            "make-money",
            OBSIDIAN_PLATFORM_ID,
            &now,
        )
        .await
        .unwrap();

        let before_manifest = vault_manifest(&vault_dir);

        import_discovered_skill_to_platform_from_pool(
            &pool,
            "obsidian__fixture__platform-methods",
            "claude-code",
            Some("symlink"),
        )
        .await
        .unwrap();
        let symlink_path = claude_dir.join("platform-methods");
        let symlink_meta = std::fs::symlink_metadata(&symlink_path).unwrap();
        assert!(symlink_meta.file_type().is_symlink());
        let symlink_install = db::get_skill_installations(&pool, "platform-methods")
            .await
            .unwrap()
            .into_iter()
            .find(|installation| installation.agent_id == "claude-code")
            .expect("symlink installation row should exist");
        assert_eq!(symlink_install.link_type, "symlink");
        assert_eq!(
            symlink_install.symlink_target.as_deref(),
            Some(&*skill_dir.to_string_lossy())
        );

        import_discovered_skill_to_platform_from_pool(
            &pool,
            "obsidian__fixture__platform-methods",
            "cursor",
            Some("copy"),
        )
        .await
        .unwrap();
        let copy_path = cursor_dir.join("platform-methods");
        let copy_meta = std::fs::symlink_metadata(&copy_path).unwrap();
        assert!(copy_meta.is_dir());
        assert!(!copy_meta.file_type().is_symlink());
        assert_eq!(
            std::fs::read_to_string(copy_path.join("extra.txt")).unwrap(),
            "copy me"
        );
        let copy_install = db::get_skill_installations(&pool, "platform-methods")
            .await
            .unwrap()
            .into_iter()
            .find(|installation| installation.agent_id == "cursor")
            .expect("copy installation row should exist");
        assert_eq!(copy_install.link_type, "copy");
        assert!(copy_install.symlink_target.is_none());

        assert!(
            db::get_discovered_skill_by_id(&pool, "obsidian__fixture__platform-methods")
                .await
                .unwrap()
                .is_some(),
            "platform installs must keep cached Obsidian row for multi-install"
        );
        assert_eq!(
            before_manifest,
            vault_manifest(&vault_dir),
            "platform installs must not mutate the source Obsidian vault"
        );
    }

    /// Implementation of import_discovered_skill_to_platform that accepts a custom agent_dir
    /// for testing (avoids depending on $HOME and real agent dirs).
    async fn import_discovered_skill_to_platform_impl(
        pool: &DbPool,
        discovered_skill_id: &str,
        agent_id: &str,
        agent_dir: &Path,
    ) -> Result<ImportResult, String> {
        let skill = db::get_discovered_skill_by_id(pool, discovered_skill_id)
            .await?
            .ok_or_else(|| format!("Discovered skill '{}' not found", discovered_skill_id))?;

        let skill_dir_name = Path::new(&skill.dir_path)
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "Cannot extract skill directory name".to_string())?
            .to_string();

        let target_path = agent_dir.join(&skill_dir_name);

        std::fs::create_dir_all(agent_dir)
            .map_err(|e| format!("Failed to create agent skills directory: {}", e))?;

        if target_path.exists() || std::fs::symlink_metadata(&target_path).is_ok() {
            return Err(format!(
                "Skill '{}' already exists in agent {}",
                skill_dir_name, agent_id
            ));
        }

        let src_path = Path::new(&skill.dir_path);
        let relative_target = linker::symlink_target_path(agent_dir, src_path);
        linker::create_symlink(&relative_target, &target_path)?;

        // Record the installation.
        let now = Utc::now().to_rfc3339();

        let skill_md_path = src_path.join("SKILL.md");
        let info = super::super::scanner::parse_skill_md(&skill_md_path);

        if let Some(skill_info) = info {
            let db_skill = db::Skill {
                id: skill_dir_name.clone(),
                name: skill_info.name,
                description: skill_info.description,
                file_path: skill_md_path.to_string_lossy().into_owned(),
                canonical_path: None,
                is_central: false,
                source: Some("symlink".to_string()),
                content: None,
                scanned_at: now.clone(),
            };
            db::upsert_skill(pool, &db_skill).await?;
        }

        let installation = db::SkillInstallation {
            skill_id: skill_dir_name.clone(),
            agent_id: agent_id.to_string(),
            installed_path: target_path.to_string_lossy().into_owned(),
            link_type: "symlink".to_string(),
            symlink_target: Some(skill.dir_path.clone()),
            created_at: now,
        };
        db::upsert_skill_installation(pool, &installation).await?;

        // NOTE: Intentionally do NOT delete the discovered skill record.
        // This allows multi-platform install (importing the same discovered
        // skill to multiple platforms in sequence).

        Ok(ImportResult {
            skill_id: skill_dir_name,
            target: agent_id.to_string(),
        })
    }

    #[tokio::test]
    async fn test_stop_project_scan_sets_cancel_flag() {
        let _cancel_guard = SCAN_CANCEL_TEST_LOCK.lock().await;

        // Before calling stop, the flag should be false.
        clear_scan_test_state();
        assert!(!SCAN_CANCEL.load(Ordering::Relaxed));

        // After calling stop, the flag should be true.
        SCAN_CANCEL.store(true, Ordering::Relaxed);
        assert!(SCAN_CANCEL.load(Ordering::Relaxed));

        // Reset for other tests.
        clear_scan_test_state();
    }

    #[tokio::test]
    async fn test_get_discovered_skills_groups_by_project() {
        let pool = setup_test_db().await;
        let now = Utc::now().to_rfc3339();

        // Insert two discovered skills in the same project.
        db::insert_discovered_skill(
            &pool,
            "claude-code__proj1__skill-a",
            "skill-a",
            Some("Skill A"),
            "/tmp/proj1/.claude/skills/skill-a/SKILL.md",
            "/tmp/proj1/.claude/skills/skill-a",
            "/tmp/proj1",
            "proj1",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        db::insert_discovered_skill(
            &pool,
            "cursor__proj1__skill-b",
            "skill-b",
            Some("Skill B"),
            "/tmp/proj1/.cursor/skills/skill-b/SKILL.md",
            "/tmp/proj1/.cursor/skills/skill-b",
            "/tmp/proj1",
            "proj1",
            "cursor",
            &now,
        )
        .await
        .unwrap();

        // Insert a skill in a different project.
        db::insert_discovered_skill(
            &pool,
            "claude-code__proj2__skill-c",
            "skill-c",
            Some("Skill C"),
            "/tmp/proj2/.claude/skills/skill-c/SKILL.md",
            "/tmp/proj2/.claude/skills/skill-c",
            "/tmp/proj2",
            "proj2",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        let rows = db::get_all_discovered_skills(&pool).await.unwrap();
        assert_eq!(rows.len(), 3, "should have 3 discovered skill rows");

        // Group by project_path.
        let mut by_project: HashMap<String, Vec<db::DiscoveredSkillRow>> = HashMap::new();
        for row in rows {
            by_project
                .entry(row.project_path.clone())
                .or_default()
                .push(row);
        }

        assert_eq!(by_project.len(), 2, "should have 2 projects");
        let proj1_skills = by_project.get("/tmp/proj1").unwrap();
        assert_eq!(proj1_skills.len(), 2, "proj1 should have 2 skills");
        let proj2_skills = by_project.get("/tmp/proj2").unwrap();
        assert_eq!(proj2_skills.len(), 1, "proj2 should have 1 skill");
    }

    #[tokio::test]
    async fn test_get_discovered_skills_recomputes_obsidian_central_status() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let central_dir = tmp.path().join("central");
        let vault_dir = tmp.path().join("vault");
        let skill_dir = create_skill(
            &vault_dir.join(".skills"),
            "cached-skill",
            "Cached Skill",
            "from cache",
        );
        std::fs::create_dir_all(central_dir.join("cached-skill")).unwrap();

        let now = Utc::now().to_rfc3339();
        db::insert_discovered_skill(
            &pool,
            "obsidian__fixture__cached-skill",
            "Cached Skill",
            Some("from cache"),
            &skill_dir.join("SKILL.md").to_string_lossy(),
            &skill_dir.to_string_lossy(),
            &vault_dir.to_string_lossy(),
            "vault",
            OBSIDIAN_PLATFORM_ID,
            &now,
        )
        .await
        .unwrap();

        let projects = get_discovered_skills_impl(&pool, &central_dir)
            .await
            .unwrap();
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].skills.len(), 1);
        assert_eq!(projects[0].skills[0].platform_id, OBSIDIAN_PLATFORM_ID);
        assert_eq!(projects[0].skills[0].platform_name, OBSIDIAN_PLATFORM_NAME);
        assert!(
            projects[0].skills[0].is_already_central,
            "cached Obsidian row should recompute central status from selected dir name"
        );

        std::fs::remove_dir_all(central_dir.join("cached-skill")).unwrap();
        let projects = get_discovered_skills_impl(&pool, &central_dir)
            .await
            .unwrap();
        assert!(
            !projects[0].skills[0].is_already_central,
            "central status should not be a stale cached snapshot"
        );
    }

    #[tokio::test]
    async fn test_clear_discovered_skills_removes_all() {
        let pool = setup_test_db().await;
        let now = Utc::now().to_rfc3339();

        db::insert_discovered_skill(
            &pool,
            "id1",
            "skill-1",
            None,
            "/tmp/skill1/SKILL.md",
            "/tmp/skill1",
            "/tmp/proj1",
            "proj1",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        db::insert_discovered_skill(
            &pool,
            "id2",
            "skill-2",
            None,
            "/tmp/skill2/SKILL.md",
            "/tmp/skill2",
            "/tmp/proj1",
            "proj1",
            "cursor",
            &now,
        )
        .await
        .unwrap();

        let before = db::get_all_discovered_skills(&pool).await.unwrap();
        assert_eq!(before.len(), 2);

        db::clear_all_discovered_skills(&pool).await.unwrap();

        let after = db::get_all_discovered_skills(&pool).await.unwrap();
        assert!(after.is_empty(), "all discovered skills should be cleared");
    }

    #[tokio::test]
    async fn test_get_scan_roots_returns_defaults() {
        let pool = setup_test_db().await;

        // No persisted config yet — should return defaults.
        let roots = get_scan_roots_impl(&pool).await.unwrap();
        assert!(!roots.is_empty(), "should return default scan roots");

        // Each root should have a path and label.
        for root in &roots {
            assert!(!root.path.is_empty());
            assert!(!root.label.is_empty());
        }
    }

    #[tokio::test]
    async fn test_set_scan_root_enabled_persists_state() {
        let pool = setup_test_db().await;

        // Get defaults.
        let roots = get_scan_roots_impl(&pool).await.unwrap();
        let some_path = roots[0].path.clone();

        // Disable a root.
        set_scan_root_enabled_impl(&pool, some_path.clone(), false)
            .await
            .unwrap();

        // Verify the change is reflected.
        let updated = get_scan_roots_impl(&pool).await.unwrap();
        let changed = updated.iter().find(|r| r.path == some_path).unwrap();
        assert!(
            !changed.enabled,
            "root should be disabled after set_scan_root_enabled"
        );

        // Re-enable it.
        set_scan_root_enabled_impl(&pool, some_path.clone(), true)
            .await
            .unwrap();

        let re_updated = get_scan_roots_impl(&pool).await.unwrap();
        let re_changed = re_updated.iter().find(|r| r.path == some_path).unwrap();
        assert!(re_changed.enabled, "root should be re-enabled");
    }

    /// Implementation of get_scan_roots that takes a pool directly for testing.
    async fn get_scan_roots_impl(pool: &DbPool) -> Result<Vec<ScanRoot>, String> {
        let mut roots = default_scan_roots();

        if let Some(json) = db::get_setting(pool, "discover_scan_roots_config").await? {
            let config: HashMap<String, bool> = serde_json::from_str(&json)
                .map_err(|e| format!("Invalid scan roots config: {}", e))?;
            for root in &mut roots {
                if let Some(&enabled) = config.get(&root.path) {
                    root.enabled = enabled;
                }
            }
        }

        Ok(roots)
    }

    /// Implementation of set_scan_root_enabled that takes a pool directly for testing.
    async fn set_scan_root_enabled_impl(
        pool: &DbPool,
        path: String,
        enabled: bool,
    ) -> Result<(), String> {
        let mut config: HashMap<String, bool> =
            match db::get_setting(pool, "discover_scan_roots_config").await? {
                Some(json) => serde_json::from_str(&json)
                    .map_err(|e| format!("Invalid scan roots config: {}", e))?,
                None => HashMap::new(),
            };

        config.insert(path, enabled);

        let json = serde_json::to_string(&config)
            .map_err(|e| format!("Failed to serialize scan roots config: {}", e))?;
        db::set_setting(pool, "discover_scan_roots_config", &json).await
    }

    #[tokio::test]
    async fn test_scan_cancellation_stops_early() {
        let _cancel_guard = SCAN_CANCEL_TEST_LOCK.lock().await;
        clear_scan_test_state();

        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // Create multiple project dirs with skills.
        for i in 0..5 {
            let project_dir = tmp.path().join(format!("project-{}", i));
            let skill_dir = project_dir.join(".claude/skills/deploy-skill");
            std::fs::create_dir_all(&skill_dir).unwrap();
            std::fs::write(
                skill_dir.join("SKILL.md"),
                format!(
                    "---\nname: deploy-{}\ndescription: Deploy stuff\n---\n\n# Deploy {}\n",
                    i, i
                ),
            )
            .unwrap();
        }

        let patterns = vec![(
            "claude-code".to_string(),
            "Claude Code".to_string(),
            PathBuf::from(".claude/skills"),
        )];

        // Set cancel flag before scanning.
        set_scan_cancel_override(true);

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);
        assert!(
            projects.is_empty(),
            "should find no projects when cancel flag is set"
        );

        // Reset for other tests.
        clear_scan_test_state();
    }

    #[tokio::test]
    async fn test_discovered_skill_insert_and_get_by_id() {
        let pool = setup_test_db().await;
        let now = Utc::now().to_rfc3339();

        db::insert_discovered_skill(
            &pool,
            "test-id-1",
            "test-skill",
            Some("A description"),
            "/tmp/project/.claude/skills/test-skill/SKILL.md",
            "/tmp/project/.claude/skills/test-skill",
            "/tmp/project",
            "project",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        let found = db::get_discovered_skill_by_id(&pool, "test-id-1")
            .await
            .unwrap();
        assert!(found.is_some());
        let row = found.unwrap();
        assert_eq!(row.name, "test-skill");
        assert_eq!(row.platform_id, "claude-code");
        assert_eq!(row.project_name, "project");

        let not_found = db::get_discovered_skill_by_id(&pool, "nonexistent")
            .await
            .unwrap();
        assert!(not_found.is_none());
    }

    #[tokio::test]
    async fn test_insert_discovered_skill_upserts_metadata() {
        let pool = setup_test_db().await;
        let now = Utc::now().to_rfc3339();

        db::insert_discovered_skill(
            &pool,
            "dup-id",
            "dup-skill",
            None,
            "/tmp/dup/SKILL.md",
            "/tmp/dup",
            "/tmp/proj",
            "proj",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        db::insert_discovered_skill(
            &pool,
            "dup-id",
            "dup-skill-updated",
            Some("updated description"),
            "/tmp/dup-new/SKILL.md",
            "/tmp/dup-new",
            "/tmp/proj",
            "proj",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        let rows = db::get_all_discovered_skills(&pool).await.unwrap();
        assert_eq!(rows.len(), 1, "should still have only 1 row");
        assert_eq!(rows[0].name, "dup-skill-updated");
        assert_eq!(rows[0].description.as_deref(), Some("updated description"));
        assert_eq!(rows[0].dir_path, "/tmp/dup-new");
    }

    #[tokio::test]
    async fn test_delete_discovered_skill() {
        let pool = setup_test_db().await;
        let now = Utc::now().to_rfc3339();

        db::insert_discovered_skill(
            &pool,
            "to-delete",
            "delete-me",
            None,
            "/tmp/del/SKILL.md",
            "/tmp/del",
            "/tmp/proj",
            "proj",
            "cursor",
            &now,
        )
        .await
        .unwrap();

        let found = db::get_discovered_skill_by_id(&pool, "to-delete")
            .await
            .unwrap();
        assert!(found.is_some());

        db::delete_discovered_skill(&pool, "to-delete")
            .await
            .unwrap();

        let gone = db::get_discovered_skill_by_id(&pool, "to-delete")
            .await
            .unwrap();
        assert!(gone.is_none());
    }

    #[tokio::test]
    async fn test_import_to_central_refuses_duplicate() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // Create a skill already in central.
        let existing = central_dir.join("existing-skill");
        std::fs::create_dir_all(&existing).unwrap();
        std::fs::write(
            existing.join("SKILL.md"),
            "---\nname: existing-skill\n---\n\n# Test\n",
        )
        .unwrap();

        // Also create the same skill in a project (discovered).
        let project_skill = tmp.path().join("project/.claude/skills/existing-skill");
        std::fs::create_dir_all(&project_skill).unwrap();
        std::fs::write(
            project_skill.join("SKILL.md"),
            "---\nname: existing-skill\n---\n\n# Test\n",
        )
        .unwrap();

        let now = Utc::now().to_rfc3339();
        db::insert_discovered_skill(
            &pool,
            "claude-code__project__existing-skill",
            "existing-skill",
            None,
            &project_skill.join("SKILL.md").to_string_lossy(),
            &project_skill.to_string_lossy(),
            &tmp.path().join("project").to_string_lossy(),
            "project",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        let result = import_discovered_skill_to_central_impl(
            &pool,
            "claude-code__project__existing-skill",
            &central_dir,
        )
        .await;

        assert!(
            result.is_err(),
            "should refuse to import when skill already exists in central"
        );
    }

    #[tokio::test]
    async fn test_import_to_platform_refuses_existing_installation() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let agent_dir = tmp.path().join("agent-skills");
        std::fs::create_dir_all(&agent_dir).unwrap();

        // Create an existing skill in agent dir.
        let existing = agent_dir.join("existing-skill");
        std::fs::create_dir_all(&existing).unwrap();

        // Also create a discovered skill with the same name.
        let project_skill = tmp.path().join("project/.claude/skills/existing-skill");
        std::fs::create_dir_all(&project_skill).unwrap();
        std::fs::write(
            project_skill.join("SKILL.md"),
            "---\nname: existing-skill\n---\n\n# Test\n",
        )
        .unwrap();

        let now = Utc::now().to_rfc3339();
        db::insert_discovered_skill(
            &pool,
            "claude-code__project__existing-skill",
            "existing-skill",
            None,
            &project_skill.join("SKILL.md").to_string_lossy(),
            &project_skill.to_string_lossy(),
            &tmp.path().join("project").to_string_lossy(),
            "project",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        let result = import_discovered_skill_to_platform_impl(
            &pool,
            "claude-code__project__existing-skill",
            "claude-code",
            &agent_dir,
        )
        .await;

        assert!(
            result.is_err(),
            "should refuse to import when skill already exists in agent dir"
        );
    }

    #[tokio::test]
    async fn test_platform_skill_patterns_dedupes_shared_paths_and_excludes_central() {
        let pool = setup_test_db().await;
        let patterns = platform_skill_patterns(&pool);

        assert!(
            !patterns.iter().any(|(id, _, _)| id == "central"),
            "central must not be treated as a Discover platform pattern"
        );
        assert!(
            patterns
                .iter()
                .any(|(_, _, rel_path)| rel_path == &PathBuf::from(".agents/skills")),
            "the shared .agents/skills pattern should be discoverable once"
        );

        let mut seen_paths = HashSet::new();
        for (_, _, rel_path) in &patterns {
            assert!(
                seen_paths.insert(rel_path.clone()),
                "duplicate platform pattern path {:?}",
                rel_path
            );
        }
    }

    #[tokio::test]
    async fn test_platform_skill_patterns_prefer_project_skills_dir() {
        let pool = setup_test_db().await;
        let patterns = platform_skill_patterns(&pool);
        let by_id: HashMap<&str, &PathBuf> = patterns
            .iter()
            .map(|(id, _, rel_path)| (id.as_str(), rel_path))
            .collect();

        assert_eq!(by_id.get("openclaw"), Some(&&PathBuf::from("skills")));
        assert_eq!(
            by_id.get("windsurf"),
            Some(&&PathBuf::from(".windsurf/skills"))
        );
        assert_eq!(by_id.get("cortex"), Some(&&PathBuf::from(".cortex/skills")));
        assert_eq!(by_id.get("crush"), Some(&&PathBuf::from(".crush/skills")));
        assert_eq!(by_id.get("devin"), Some(&&PathBuf::from(".devin/skills")));
        assert_eq!(by_id.get("pi"), Some(&&PathBuf::from(".pi/skills")));

        assert!(
            patterns
                .iter()
                .any(|(_, _, rel_path)| rel_path == &PathBuf::from(".trae/skills")),
            "Trae CN shares the project .trae/skills path instead of using .trae-cn/skills"
        );
        assert!(
            !patterns
                .iter()
                .any(|(_, _, rel_path)| rel_path == &PathBuf::from(".trae-cn/skills")),
            "Discover must not derive Trae CN project scans from its global root"
        );
        assert!(
            !patterns
                .iter()
                .any(|(_, _, rel_path)| rel_path == &PathBuf::from(".snowflake/cortex/skills")),
            "Discover must not derive Cortex project scans from its global root"
        );
        assert!(
            !patterns
                .iter()
                .any(|(_, _, rel_path)| rel_path == &PathBuf::from(".config/crush/skills")),
            "Discover must not derive Crush project scans from its global root"
        );
        assert!(
            !patterns
                .iter()
                .any(|(_, _, rel_path)| rel_path == &PathBuf::from(".config/devin/skills")),
            "Discover must not derive Devin project scans from its global root"
        );
    }

    #[tokio::test]
    async fn test_discovered_project_count() {
        let pool = setup_test_db().await;
        let now = Utc::now().to_rfc3339();

        // Insert skills across 3 different projects.
        for i in 0..3 {
            db::insert_discovered_skill(
                &pool,
                &format!("skill-{}", i),
                &format!("skill {}", i),
                None,
                &format!("/tmp/proj{}/SKILL.md", i),
                &format!("/tmp/proj{}", i),
                &format!("/tmp/proj{}", i),
                &format!("proj{}", i),
                "claude-code",
                &now,
            )
            .await
            .unwrap();
        }

        let count = db::get_discovered_project_count(&pool).await.unwrap();
        assert_eq!(count, 3, "should have 3 distinct projects");
    }

    // ── Recursive scan tests ──────────────────────────────────────────────────

    #[tokio::test]
    async fn test_recursive_scan_finds_deeply_nested_project() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // Create a project nested 3 levels deep: root/org/team/my-project/.claude/skills/...
        let project_dir = tmp.path().join("org").join("team").join("my-project");
        let skill_dir = project_dir.join(".claude/skills/deploy-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: deploy\ndescription: Deploy stuff\n---\n\n# Deploy\n",
        )
        .unwrap();

        let patterns = vec![(
            "claude-code".to_string(),
            "Claude Code".to_string(),
            PathBuf::from(".claude/skills"),
        )];

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);

        assert_eq!(projects.len(), 1, "should find 1 project at depth 3");
        assert_eq!(projects[0].project_name, "my-project");
        assert_eq!(projects[0].skills.len(), 1);
        assert_eq!(projects[0].skills[0].platform_id, "claude-code");
        assert_eq!(projects[0].skills[0].name, "deploy");
        // project_path should be the directory containing the platform dir
        assert!(
            projects[0].project_path.contains("my-project"),
            "project_path should be the project dir, got: {}",
            projects[0].project_path
        );
    }

    #[tokio::test]
    async fn test_recursive_scan_skips_hidden_dirs_at_root() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // A hidden directory at root level should be skipped (not traversed).
        let hidden_project = tmp.path().join(".hidden-org").join("my-project");
        let skill_dir = hidden_project.join(".claude/skills/deploy-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: deploy\ndescription: Deploy stuff\n---\n\n# Deploy\n",
        )
        .unwrap();

        // A visible directory should be traversed.
        let visible_project = tmp.path().join("visible-org").join("my-project");
        let visible_skill_dir = visible_project.join(".claude/skills/visible-skill");
        std::fs::create_dir_all(&visible_skill_dir).unwrap();
        std::fs::write(
            visible_skill_dir.join("SKILL.md"),
            "---\nname: visible-skill\ndescription: Visible\n---\n\n# Visible\n",
        )
        .unwrap();

        let patterns = vec![(
            "claude-code".to_string(),
            "Claude Code".to_string(),
            PathBuf::from(".claude/skills"),
        )];

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);

        // Should only find the project in the visible directory.
        assert_eq!(projects.len(), 1, "should only find the visible project");
        assert_eq!(projects[0].skills[0].name, "visible-skill");
    }

    #[tokio::test]
    async fn test_recursive_scan_skips_node_modules_and_git() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // node_modules with a skill inside should NOT be found.
        let nm_project = tmp.path().join("node_modules").join("some-pkg");
        let nm_skill = nm_project.join(".claude/skills/hidden-skill");
        std::fs::create_dir_all(&nm_skill).unwrap();
        std::fs::write(
            nm_skill.join("SKILL.md"),
            "---\nname: hidden-skill\n---\n\n# Hidden\n",
        )
        .unwrap();

        // .git with a skill inside should NOT be found.
        let git_project = tmp.path().join(".git").join("subdir");
        let git_skill = git_project.join(".claude/skills/git-skill");
        std::fs::create_dir_all(&git_skill).unwrap();
        std::fs::write(
            git_skill.join("SKILL.md"),
            "---\nname: git-skill\n---\n\n# Git\n",
        )
        .unwrap();

        // A normal project should be found.
        let project_dir = tmp.path().join("my-project");
        let skill_dir = project_dir.join(".claude/skills/good-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: good-skill\ndescription: Good\n---\n\n# Good\n",
        )
        .unwrap();

        let patterns = vec![(
            "claude-code".to_string(),
            "Claude Code".to_string(),
            PathBuf::from(".claude/skills"),
        )];

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);

        assert_eq!(projects.len(), 1, "should only find the good project");
        assert_eq!(projects[0].skills[0].name, "good-skill");
    }

    #[tokio::test]
    async fn test_recursive_scan_finds_multiple_projects_at_different_depths() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // Project at depth 1 (immediate child).
        let project1 = tmp.path().join("project-1");
        let skill1 = project1.join(".claude/skills/skill-1");
        std::fs::create_dir_all(&skill1).unwrap();
        std::fs::write(
            skill1.join("SKILL.md"),
            "---\nname: skill-1\ndescription: First\n---\n\n# First\n",
        )
        .unwrap();

        // Project at depth 3 (nested under org/team).
        let project2 = tmp.path().join("org").join("team").join("project-2");
        let skill2 = project2.join(".factory/skills/skill-2");
        std::fs::create_dir_all(&skill2).unwrap();
        std::fs::write(
            skill2.join("SKILL.md"),
            "---\nname: skill-2\ndescription: Second\n---\n\n# Second\n",
        )
        .unwrap();

        let patterns = vec![
            (
                "claude-code".to_string(),
                "Claude Code".to_string(),
                PathBuf::from(".claude/skills"),
            ),
            (
                "factory-droid".to_string(),
                "Factory Droid".to_string(),
                PathBuf::from(".factory/skills"),
            ),
        ];

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);

        assert_eq!(
            projects.len(),
            2,
            "should find 2 projects at different depths"
        );
        let names: Vec<&str> = projects.iter().map(|p| p.project_name.as_str()).collect();
        assert!(names.contains(&"project-1"), "should find project-1");
        assert!(names.contains(&"project-2"), "should find project-2");
    }

    #[tokio::test]
    async fn test_recursive_scan_respects_max_depth() {
        let tmp = tempfile::TempDir::new().unwrap();
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        // Create a project deeper than MAX_SCAN_DEPTH.
        // MAX_SCAN_DEPTH = 8, so depth 10 should not be reached.
        let mut deep_path = tmp.path().to_path_buf();
        for i in 0..10 {
            deep_path = deep_path.join(format!("level-{}", i));
        }
        let skill_dir = deep_path.join(".claude/skills/deep-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: deep-skill\ndescription: Too deep\n---\n\n# Deep\n",
        )
        .unwrap();

        let patterns = vec![(
            "claude-code".to_string(),
            "Claude Code".to_string(),
            PathBuf::from(".claude/skills"),
        )];

        let projects = scan_root_for_projects(tmp.path(), &patterns, &central_dir);

        assert!(
            projects.is_empty(),
            "should not find projects beyond MAX_SCAN_DEPTH"
        );
    }

    #[tokio::test]
    async fn test_should_skip_dir_rules() {
        // Always-skipped directories.
        assert!(should_skip_dir("node_modules", 0));
        assert!(should_skip_dir("node_modules", 5));
        assert!(should_skip_dir("target", 0));
        assert!(should_skip_dir("target", 3));
        assert!(should_skip_dir(".git", 0));
        assert!(should_skip_dir(".git", 5));
        assert!(should_skip_dir("build", 0));
        assert!(should_skip_dir("dist", 0));
        assert!(should_skip_dir("__pycache__", 0));
        assert!(should_skip_dir(".cache", 0));

        // Hidden dirs at root level (depth 0) should be skipped.
        assert!(should_skip_dir(".config", 0));
        assert!(should_skip_dir(".local", 0));
        assert!(should_skip_dir(".hidden-project", 0));

        // Hidden dirs at deeper levels should NOT be skipped
        // (they might contain platform patterns like .claude).
        assert!(!should_skip_dir(".claude", 1));
        assert!(!should_skip_dir(".hidden-project", 2));

        // Normal directories should never be skipped.
        assert!(!should_skip_dir("my-project", 0));
        assert!(!should_skip_dir("src", 0));
        assert!(!should_skip_dir("Documents", 0));
        assert!(!should_skip_dir("projects", 1));
    }

    // ── Cache reconciliation tests ─────────────────────────────────────────────

    #[tokio::test]
    async fn test_cache_reconciliation_removes_stale_skills() {
        let pool = setup_test_db().await;
        let tmp = tempfile::TempDir::new().unwrap();
        let now = Utc::now().to_rfc3339();

        // Create a real skill on disk under the scan root.
        let project_dir = tmp.path().join("project");
        let skill_dir = project_dir.join(".claude/skills/real-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: real-skill\ndescription: Exists\n---\n\n# Real\n",
        )
        .unwrap();

        // Insert a discovered skill for a path that EXISTS.
        db::insert_discovered_skill(
            &pool,
            "claude-code__project__real-skill",
            "real-skill",
            Some("Exists"),
            &skill_dir.join("SKILL.md").to_string_lossy(),
            &skill_dir.to_string_lossy(),
            &project_dir.to_string_lossy(),
            "project",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        // Insert a discovered skill whose project_path is under the scan root
        // but whose dir_path no longer exists on disk.
        let stale_project_dir = tmp.path().join("stale-project");
        let stale_skill_dir = stale_project_dir.join(".claude/skills/stale-skill");
        // NOTE: We do NOT create the stale directory on disk.
        db::insert_discovered_skill(
            &pool,
            "claude-code__stale-project__stale-skill",
            "stale-skill",
            Some("Deleted"),
            &stale_skill_dir.join("SKILL.md").to_string_lossy(),
            &stale_skill_dir.to_string_lossy(),
            &stale_project_dir.to_string_lossy(),
            "stale-project",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        // Simulate a scan: the real skill was found, the stale one was not.
        let scan_root = ScanRoot {
            path: tmp.path().to_string_lossy().into_owned(),
            label: "test".to_string(),
            exists: true,
            enabled: true,
        };

        let found_ids = vec!["claude-code__project__real-skill".to_string()];

        reconcile_discovered_skills(&pool, &[&scan_root], &found_ids)
            .await
            .unwrap();

        // The real skill should still be in the DB.
        let real = db::get_discovered_skill_by_id(&pool, "claude-code__project__real-skill")
            .await
            .unwrap();
        assert!(real.is_some(), "real skill should remain in DB");

        // The stale skill should be removed from the DB.
        let stale =
            db::get_discovered_skill_by_id(&pool, "claude-code__stale-project__stale-skill")
                .await
                .unwrap();
        assert!(stale.is_none(), "stale skill should be removed from DB");
    }

    #[tokio::test]
    async fn test_cache_reconciliation_only_affects_scanned_scope() {
        let pool = setup_test_db().await;
        let tmp = tempfile::TempDir::new().unwrap();
        let now = Utc::now().to_rfc3339();

        // Insert a stale skill whose project_path is NOT under the scanned root.
        db::insert_discovered_skill(
            &pool,
            "claude-code__other__stale-skill",
            "stale-skill",
            Some("Outside scope"),
            "/other/location/.claude/skills/stale-skill/SKILL.md",
            "/other/location/.claude/skills/stale-skill",
            "/other/location",
            "other",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        // Scan a different root — the stale skill is outside the scope.
        let scan_root = ScanRoot {
            path: tmp.path().to_string_lossy().into_owned(),
            label: "test".to_string(),
            exists: true,
            enabled: true,
        };

        let found_ids: Vec<String> = vec![];

        reconcile_discovered_skills(&pool, &[&scan_root], &found_ids)
            .await
            .unwrap();

        // The stale skill should still be in the DB (outside scanned scope).
        let outside = db::get_discovered_skill_by_id(&pool, "claude-code__other__stale-skill")
            .await
            .unwrap();
        assert!(
            outside.is_some(),
            "stale skill outside scan scope should remain in DB"
        );
    }

    async fn insert_cached_obsidian_row(
        pool: &DbPool,
        id: &str,
        vault_dir: &Path,
        skill_dir: &Path,
    ) {
        let now = Utc::now().to_rfc3339();
        db::insert_discovered_skill(
            pool,
            id,
            "Cached Obsidian Skill",
            Some("cached before cancellation"),
            &skill_dir.join("SKILL.md").to_string_lossy(),
            &skill_dir.to_string_lossy(),
            &vault_dir.to_string_lossy(),
            &file_name_or_unknown(vault_dir),
            OBSIDIAN_PLATFORM_ID,
            &now,
        )
        .await
        .unwrap();
    }

    fn clear_scan_test_state() {
        SCAN_CANCEL.store(false, Ordering::Relaxed);
        set_scan_cancel_override(false);
        let mut hook = SCAN_TEST_HOOK.lock().unwrap();
        *hook = None;
    }

    #[tokio::test]
    async fn test_cancel_before_first_root_skips_obsidian_reconciliation() {
        let _cancel_guard = SCAN_CANCEL_TEST_LOCK.lock().await;
        clear_scan_test_state();

        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        let vault_dir = tmp.path().join("vault");
        std::fs::create_dir_all(vault_dir.join(".obsidian")).unwrap();
        let skill_dir = create_skill(
            &vault_dir.join(".skills"),
            "cached-skill",
            "Cached Obsidian Skill",
            "cached before cancellation",
        );
        insert_cached_obsidian_row(&pool, "cached-before-first-root", &vault_dir, &skill_dir).await;

        set_scan_cancel_override(true);
        let result = start_project_scan_impl(
            &pool,
            vec![scan_root(&vault_dir, true, true)],
            &central_dir,
            |_| {},
        )
        .await
        .unwrap();
        clear_scan_test_state();

        assert_eq!(result.total_projects, 0);
        assert!(
            db::get_discovered_skill_by_id(&pool, "cached-before-first-root")
                .await
                .unwrap()
                .is_some(),
            "canceling before any enabled root is scanned must not purge cached Obsidian rows"
        );
    }

    #[tokio::test]
    async fn test_cancel_between_roots_reconciles_only_completed_roots() {
        let _cancel_guard = SCAN_CANCEL_TEST_LOCK.lock().await;
        clear_scan_test_state();

        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        let completed_vault = tmp.path().join("completed-vault");
        let unvisited_vault = tmp.path().join("unvisited-vault");
        std::fs::create_dir_all(completed_vault.join(".obsidian")).unwrap();
        std::fs::create_dir_all(unvisited_vault.join(".obsidian")).unwrap();

        let completed_stale_dir = completed_vault.join(".skills/stale-completed");
        let unvisited_stale_dir = unvisited_vault.join(".skills/stale-unvisited");
        insert_cached_obsidian_row(
            &pool,
            "stale-completed-root",
            &completed_vault,
            &completed_stale_dir,
        )
        .await;
        insert_cached_obsidian_row(
            &pool,
            "stale-unvisited-root",
            &unvisited_vault,
            &unvisited_stale_dir,
        )
        .await;

        let completed_path = completed_vault.to_string_lossy().into_owned();
        let result = start_project_scan_impl(
            &pool,
            vec![
                scan_root(&completed_vault, true, true),
                scan_root(&unvisited_vault, true, true),
            ],
            &central_dir,
            |event| {
                if let DiscoverEvent::Progress(payload) = event {
                    if payload.current_path == completed_path {
                        set_scan_cancel_override(true);
                    }
                }
            },
        )
        .await
        .unwrap();
        clear_scan_test_state();

        assert_eq!(result.total_projects, 0);
        assert!(
            db::get_discovered_skill_by_id(&pool, "stale-completed-root")
                .await
                .unwrap()
                .is_none(),
            "a fully completed root should still reconcile stale Obsidian rows"
        );
        assert!(
            db::get_discovered_skill_by_id(&pool, "stale-unvisited-root")
                .await
                .unwrap()
                .is_some(),
            "canceling between roots must preserve cached Obsidian rows under unvisited roots"
        );
    }

    #[tokio::test]
    async fn test_cancel_during_root_traversal_skips_incomplete_root_reconciliation() {
        let _cancel_guard = SCAN_CANCEL_TEST_LOCK.lock().await;
        clear_scan_test_state();

        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        let scan_root_dir = tmp.path().join("scan-root");
        let vault_dir = scan_root_dir.join("cached-vault");
        std::fs::create_dir_all(vault_dir.join(".obsidian")).unwrap();
        let stale_dir = vault_dir.join(".skills/stale-during-root");
        insert_cached_obsidian_row(&pool, "stale-during-root", &vault_dir, &stale_dir).await;

        let trigger_path = scan_root_dir.to_string_lossy().into_owned();
        {
            let mut hook = SCAN_TEST_HOOK.lock().unwrap();
            *hook = Some(Box::new(move |path: &Path| {
                if path.to_string_lossy() == trigger_path {
                    set_scan_cancel_override(true);
                }
            }));
        }

        let result = start_project_scan_impl(
            &pool,
            vec![scan_root(&scan_root_dir, true, true)],
            &central_dir,
            |_| {},
        )
        .await
        .unwrap();
        clear_scan_test_state();

        assert_eq!(result.total_projects, 0);
        assert!(
            db::get_discovered_skill_by_id(&pool, "stale-during-root")
                .await
                .unwrap()
                .is_some(),
            "canceling during root traversal must not purge rows in that incomplete root"
        );
    }

    #[tokio::test]
    async fn test_multi_platform_install_keeps_discovered_record() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;

        // Set up two agent dirs.
        let agent_dir_a = tmp.path().join("agent-a-skills");
        let agent_dir_b = tmp.path().join("agent-b-skills");
        std::fs::create_dir_all(&agent_dir_a).unwrap();
        std::fs::create_dir_all(&agent_dir_b).unwrap();

        // Create a discovered skill.
        let skill_dir = tmp.path().join("project/.claude/skills/my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: my-skill\ndescription: A test skill\n---\n\n# My Skill\n",
        )
        .unwrap();

        let now = Utc::now().to_rfc3339();
        db::insert_discovered_skill(
            &pool,
            "claude-code__project__my-skill",
            "my-skill",
            Some("A test skill"),
            &skill_dir.join("SKILL.md").to_string_lossy(),
            &skill_dir.to_string_lossy(),
            &tmp.path().join("project").to_string_lossy(),
            "project",
            "claude-code",
            &now,
        )
        .await
        .unwrap();

        // Import to first platform.
        let result_a = import_discovered_skill_to_platform_impl(
            &pool,
            "claude-code__project__my-skill",
            "agent-a",
            &agent_dir_a,
        )
        .await;
        assert!(result_a.is_ok(), "first import should succeed");

        // Import to second platform — this should also succeed because
        // the discovered record is NOT deleted after platform install.
        let result_b = import_discovered_skill_to_platform_impl(
            &pool,
            "claude-code__project__my-skill",
            "agent-b",
            &agent_dir_b,
        )
        .await;
        assert!(result_b.is_ok(), "second import should succeed");

        // Both symlinks should exist.
        assert!(agent_dir_a.join("my-skill").exists());
        assert!(agent_dir_b.join("my-skill").exists());

        // Discovered record should still exist.
        let record = db::get_discovered_skill_by_id(&pool, "claude-code__project__my-skill")
            .await
            .unwrap();
        assert!(
            record.is_some(),
            "discovered record should be kept after platform installs"
        );
    }

    #[tokio::test]
    async fn test_obsidian_start_scan_persists_updates_and_reconciles_marker_removal() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        let vault_dir = tmp.path().join("vault");
        std::fs::create_dir_all(vault_dir.join(".obsidian")).unwrap();
        let lower_priority = create_skill(
            &vault_dir.join(".agents/skills"),
            "changing-skill",
            "Changing Skill",
            "old description",
        );

        let roots = vec![scan_root(&vault_dir, true, true)];
        let first = start_project_scan_impl(&pool, roots.clone(), &central_dir, |_| {})
            .await
            .unwrap();
        assert_eq!(first.total_projects, 1);
        assert_eq!(first.total_skills, 1);
        let discovered_id = first.projects[0].skills[0].id.clone();

        let row = db::get_discovered_skill_by_id(&pool, &discovered_id)
            .await
            .unwrap()
            .expect("first scan should persist Obsidian row");
        assert_eq!(row.description.as_deref(), Some("old description"));
        assert_eq!(row.platform_id, OBSIDIAN_PLATFORM_ID);
        assert_eq!(row.dir_path, lower_priority.to_string_lossy());

        let higher_priority = create_skill(
            &vault_dir.join(".skills"),
            "changing-skill",
            "Changing Skill",
            "new description",
        );
        let second = start_project_scan_impl(&pool, roots.clone(), &central_dir, |_| {})
            .await
            .unwrap();
        assert_eq!(second.total_projects, 1);
        assert_eq!(second.total_skills, 1);
        assert_eq!(
            second.projects[0].skills[0].id, discovered_id,
            "dedupe identity should stay stable when selected source changes"
        );

        let updated = db::get_discovered_skill_by_id(&pool, &discovered_id)
            .await
            .unwrap()
            .expect("row should still exist after selected source update");
        assert_eq!(updated.description.as_deref(), Some("new description"));
        assert_eq!(updated.dir_path, higher_priority.to_string_lossy());

        std::fs::remove_dir_all(vault_dir.join(".obsidian")).unwrap();
        let third = start_project_scan_impl(&pool, roots, &central_dir, |_| {})
            .await
            .unwrap();
        assert_eq!(third.total_projects, 1);
        assert_eq!(
            third.projects[0].skills[0].platform_id, "codex",
            "after marker removal the remaining .agents/skills directory is ordinary Discover data"
        );
        let stale = db::get_discovered_skill_by_id(&pool, &discovered_id)
            .await
            .unwrap();
        assert!(
            stale.is_none(),
            "stale platform_id=obsidian row should be removed after marker removal"
        );
    }

    #[tokio::test]
    async fn test_obsidian_scan_is_read_only_and_does_not_create_managed_state() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        let vault_dir = tmp.path().join("readonly-vault");
        std::fs::create_dir_all(vault_dir.join(".obsidian")).unwrap();
        create_skill(
            &vault_dir.join(".claude/skills"),
            "readonly-skill",
            "Readonly Skill",
            "must not mutate vault",
        );
        let before_manifest = vault_manifest(&vault_dir);

        let skills_before: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM skills")
            .fetch_one(&pool)
            .await
            .unwrap();
        let installs_before: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM skill_installations")
            .fetch_one(&pool)
            .await
            .unwrap();
        let agents_before: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM agents")
            .fetch_one(&pool)
            .await
            .unwrap();

        let result = start_project_scan_impl(
            &pool,
            vec![scan_root(&vault_dir, true, true)],
            &central_dir,
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(result.total_projects, 1);
        assert_eq!(result.total_skills, 1);

        let after_manifest = vault_manifest(&vault_dir);
        assert_eq!(
            before_manifest, after_manifest,
            "Discover scan must not create, remove, rewrite, or relink vault files"
        );

        let skills_after: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM skills")
            .fetch_one(&pool)
            .await
            .unwrap();
        let installs_after: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM skill_installations")
            .fetch_one(&pool)
            .await
            .unwrap();
        let agents_after: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM agents")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(skills_after, skills_before);
        assert_eq!(installs_after, installs_before);
        assert_eq!(agents_after, agents_before);
        assert!(
            db::get_agent_by_id(&pool, OBSIDIAN_PLATFORM_ID)
                .await
                .unwrap()
                .is_none(),
            "Obsidian must not be seeded as an agent"
        );
    }

    #[tokio::test]
    async fn test_obsidian_disabled_or_missing_roots_do_not_scan_or_reconcile() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        let disabled_vault = tmp.path().join("disabled-vault");
        std::fs::create_dir_all(disabled_vault.join(".obsidian")).unwrap();
        let skill_dir = create_skill(
            &disabled_vault.join(".skills"),
            "disabled-skill",
            "Disabled Skill",
            "not scanned",
        );
        let now = Utc::now().to_rfc3339();
        db::insert_discovered_skill(
            &pool,
            "preexisting-disabled",
            "Disabled Skill",
            Some("cached"),
            &skill_dir.join("SKILL.md").to_string_lossy(),
            &skill_dir.to_string_lossy(),
            &disabled_vault.to_string_lossy(),
            "disabled-vault",
            OBSIDIAN_PLATFORM_ID,
            &now,
        )
        .await
        .unwrap();
        std::fs::remove_dir_all(&skill_dir).unwrap();

        let result = start_project_scan_impl(
            &pool,
            vec![
                scan_root(&disabled_vault, false, true),
                scan_root(&tmp.path().join("missing"), true, false),
            ],
            &central_dir,
            |_| {},
        )
        .await
        .unwrap();

        assert_eq!(result.total_projects, 0);
        assert_eq!(result.total_skills, 0);
        assert!(
            db::get_discovered_skill_by_id(&pool, "preexisting-disabled")
                .await
                .unwrap()
                .is_some(),
            "disabled roots must not scan or reconcile cached rows"
        );
    }

    #[tokio::test]
    async fn test_obsidian_import_platform_target_is_rejected() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let skill_dir = create_skill(
            &tmp.path().join("vault/.skills"),
            "portable-skill",
            "Portable Skill",
            "source only",
        );
        let now = Utc::now().to_rfc3339();
        db::insert_discovered_skill(
            &pool,
            "obsidian__fixture__portable-skill",
            "Portable Skill",
            Some("source only"),
            &skill_dir.join("SKILL.md").to_string_lossy(),
            &skill_dir.to_string_lossy(),
            &tmp.path().join("vault").to_string_lossy(),
            "vault",
            OBSIDIAN_PLATFORM_ID,
            &now,
        )
        .await
        .unwrap();

        let result = import_discovered_skill_to_platform_from_pool(
            &pool,
            "obsidian__fixture__portable-skill",
            OBSIDIAN_PLATFORM_ID,
            Some("symlink"),
        )
        .await;
        assert!(result.is_err(), "Obsidian is not an install target");

        let skills: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM skills")
            .fetch_one(&pool)
            .await
            .unwrap();
        let installs: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM skill_installations")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(skills.0, 0);
        assert_eq!(installs.0, 0);
    }

    #[tokio::test]
    async fn test_obsidian_streaming_events_use_deduped_totals() {
        let tmp = tempfile::TempDir::new().unwrap();
        let pool = setup_test_db().await;
        let central_dir = tmp.path().join("central");
        std::fs::create_dir_all(&central_dir).unwrap();

        let vault_dir = tmp.path().join("vault");
        std::fs::create_dir_all(vault_dir.join(".obsidian")).unwrap();
        create_invalid_skill(&vault_dir.join(".skills"), "deduped");
        create_skill(
            &vault_dir.join(".agents/skills"),
            "deduped",
            "Deduped Skill",
            "valid fallback",
        );
        create_skill(
            &vault_dir.join(".claude/skills"),
            "deduped",
            "Deduped Skill",
            "lower duplicate",
        );

        let empty_vault = tmp.path().join("empty-vault");
        std::fs::create_dir_all(empty_vault.join(".obsidian")).unwrap();

        let mut events = Vec::new();
        let result = start_project_scan_impl(
            &pool,
            vec![
                scan_root(tmp.path(), true, true),
                scan_root(&vault_dir, true, true),
            ],
            &central_dir,
            |event| events.push(event),
        )
        .await
        .unwrap();

        assert_eq!(result.total_projects, 1);
        assert_eq!(result.total_skills, 1);
        let found_count = events
            .iter()
            .filter(|event| matches!(event, DiscoverEvent::Found(_)))
            .count();
        assert_eq!(
            found_count, 1,
            "overlapping roots should emit one found event"
        );

        let complete = events
            .iter()
            .find_map(|event| match event {
                DiscoverEvent::Complete(payload) => Some(payload),
                _ => None,
            })
            .expect("complete event should be emitted");
        assert_eq!(complete.total_projects, 1);
        assert_eq!(complete.total_skills, 1);

        let last_progress = events.iter().rev().find_map(|event| match event {
            DiscoverEvent::Progress(payload) => Some(payload),
            _ => None,
        });
        let last_progress = last_progress.expect("progress event should be emitted");
        assert_eq!(last_progress.projects_found, 1);
        assert_eq!(last_progress.skills_found, 1);
    }
}
