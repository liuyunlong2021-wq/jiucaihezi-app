use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    FromRow, Row, SqlitePool,
};
use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
};
use uuid::Uuid;

use crate::skills::path_utils::{path_to_string, resolve_home_dir};

pub type DbPool = SqlitePool;

// ─── Data Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub file_path: String,
    pub canonical_path: Option<String>,
    pub is_central: bool,
    pub source: Option<String>,
    pub content: Option<String>,
    pub commands: Option<String>,
    pub scanned_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SkillInstallation {
    pub skill_id: String,
    pub agent_id: String,
    pub installed_path: String,
    pub link_type: String,
    pub symlink_target: Option<String>,
    /// ISO 8601 timestamp of when the skill was first installed.
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AgentSkillObservation {
    pub row_id: String,
    pub agent_id: String,
    pub skill_id: String,
    pub name: String,
    pub description: Option<String>,
    pub file_path: String,
    pub dir_path: String,
    pub source_kind: String,
    pub source_root: String,
    pub link_type: String,
    pub symlink_target: Option<String>,
    pub is_read_only: bool,
    pub scanned_at: String,
    pub commands: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Agent {
    pub id: String,
    pub display_name: String,
    pub category: String,
    pub global_skills_dir: String,
    pub project_skills_dir: Option<String>,
    pub icon_name: Option<String>,
    pub is_detected: bool,
    pub is_builtin: bool,
    pub is_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ScanDirectory {
    pub id: i64,
    pub path: String,
    pub label: Option<String>,
    pub is_active: bool,
    pub is_builtin: bool,
    pub added_at: String,
}

// ─── Pool Creation ────────────────────────────────────────────────────────────

/// Create a production SQLite pool for the given file path with WAL mode enabled.
pub async fn create_pool(db_path: &str) -> Result<DbPool, String> {
    let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path))
        .map_err(|e| e.to_string())?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal);

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
        .map_err(|e| e.to_string())
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/// Initialize all database tables (idempotent) and seed built-in agents.
pub async fn init_database(pool: &DbPool) -> Result<(), String> {
    // Enable WAL mode (no-op for in-memory databases)
    sqlx::query("PRAGMA journal_mode=WAL")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    // skills table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS skills (
            id             TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            description    TEXT,
            file_path      TEXT NOT NULL,
            canonical_path TEXT,
            is_central     BOOLEAN NOT NULL DEFAULT 0,
            source         TEXT,
            content        TEXT,
            commands       TEXT,
            scanned_at     TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // skill_installations table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS skill_installations (
            skill_id       TEXT NOT NULL,
            agent_id       TEXT NOT NULL,
            installed_path TEXT NOT NULL,
            link_type      TEXT NOT NULL,
            symlink_target TEXT,
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (skill_id, agent_id)
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS agent_skill_observations (
            row_id         TEXT PRIMARY KEY,
            agent_id       TEXT NOT NULL,
            skill_id       TEXT NOT NULL,
            name           TEXT NOT NULL,
            description    TEXT,
            file_path      TEXT NOT NULL,
            dir_path       TEXT NOT NULL,
            source_kind    TEXT NOT NULL,
            source_root    TEXT NOT NULL,
            link_type      TEXT NOT NULL,
            symlink_target TEXT,
            is_read_only   BOOLEAN NOT NULL DEFAULT 0,
            commands       TEXT,
            scanned_at     TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Migration: add created_at column to skill_installations for existing databases
    // that were created before this column was introduced. We check via PRAGMA table_info
    // and run a two-step migration only when the column is absent:
    //   1. ALTER TABLE ADD COLUMN created_at TEXT  (nullable, no default expression –
    //      SQLite's ALTER TABLE does not support non-constant default expressions on
    //      some builds, e.g. the Apple-modified SQLite on macOS).
    //   2. UPDATE … SET created_at = datetime('now') WHERE created_at IS NULL  –
    //      backfills existing rows with the current timestamp.
    // New rows written by the application always supply created_at explicitly, so
    // there is no need for a database-level DEFAULT after the migration runs.
    let columns = sqlx::query("PRAGMA table_info(skill_installations)")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let has_created_at = columns.iter().any(|row| {
        row.try_get::<String, _>("name")
            .map(|name| name == "created_at")
            .unwrap_or(false)
    });

    if !has_created_at {
        // Step 1: add the column (nullable, no expression default for compatibility).
        sqlx::query("ALTER TABLE skill_installations ADD COLUMN created_at TEXT")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

        // Step 2: backfill existing rows with the current timestamp.
        sqlx::query(
            "UPDATE skill_installations SET created_at = datetime('now') WHERE created_at IS NULL",
        )
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Migration: add commands column to skills (2026-06-30)
    ensure_column(
        pool,
        "skills",
        "commands",
        "ALTER TABLE skills ADD COLUMN commands TEXT",
    )
    .await?;

    ensure_column(
        pool,
        "agent_skill_observations",
        "commands",
        "ALTER TABLE agent_skill_observations ADD COLUMN commands TEXT",
    )
    .await?;

    // agents table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS agents (
            id                 TEXT PRIMARY KEY,
            display_name       TEXT NOT NULL,
            category           TEXT NOT NULL,
            global_skills_dir  TEXT NOT NULL,
            project_skills_dir TEXT,
            icon_name          TEXT,
            is_detected        BOOLEAN NOT NULL DEFAULT 0,
            is_builtin         BOOLEAN NOT NULL DEFAULT 1,
            is_enabled         BOOLEAN NOT NULL DEFAULT 1
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // collections table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS collections (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // collection_skills table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS collection_skills (
            collection_id TEXT NOT NULL,
            skill_id      TEXT NOT NULL,
            added_at      TEXT NOT NULL,
            PRIMARY KEY (collection_id, skill_id)
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // scan_directories table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS scan_directories (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            path       TEXT NOT NULL UNIQUE,
            label      TEXT,
            is_active  BOOLEAN NOT NULL DEFAULT 1,
            is_builtin BOOLEAN NOT NULL DEFAULT 0,
            added_at   TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // settings table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // discovered_skills table — skills found in project-level directories
    // during a "discover project skills" scan.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS discovered_skills (
            id             TEXT PRIMARY KEY,
            name           TEXT NOT NULL,
            description    TEXT,
            file_path      TEXT NOT NULL,
            dir_path       TEXT NOT NULL,
            project_path   TEXT NOT NULL,
            project_name   TEXT NOT NULL,
            platform_id    TEXT NOT NULL,
            discovered_at  TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // skill_registries table — remote skill sources (marketplace)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS skill_registries (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            source_type TEXT NOT NULL,
            url         TEXT NOT NULL,
            is_builtin  BOOLEAN NOT NULL DEFAULT 0,
            is_enabled  BOOLEAN NOT NULL DEFAULT 1,
            last_synced TEXT,
            last_attempted_sync TEXT,
            last_sync_status TEXT NOT NULL DEFAULT 'never',
            last_sync_error TEXT,
            cache_updated_at TEXT,
            cache_expires_at TEXT,
            etag TEXT,
            last_modified TEXT,
            created_at  TEXT NOT NULL
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // marketplace_skills table — cached remote skill metadata
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS marketplace_skills (
            id           TEXT PRIMARY KEY,
            registry_id  TEXT NOT NULL,
            name         TEXT NOT NULL,
            description  TEXT,
            download_url TEXT NOT NULL,
            is_installed BOOLEAN NOT NULL DEFAULT 0,
            synced_at    TEXT NOT NULL,
            cache_updated_at TEXT,
            FOREIGN KEY (registry_id) REFERENCES skill_registries(id)
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    // skill_explanations table — cached AI-generated skill explanations
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS skill_explanations (
            skill_id    TEXT NOT NULL,
            explanation TEXT NOT NULL,
            lang        TEXT NOT NULL DEFAULT 'zh',
            model       TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (skill_id, lang)
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    ensure_column(
        pool,
        "skill_registries",
        "last_attempted_sync",
        "ALTER TABLE skill_registries ADD COLUMN last_attempted_sync TEXT",
    )
    .await?;
    ensure_column(
        pool,
        "skill_registries",
        "last_sync_status",
        "ALTER TABLE skill_registries ADD COLUMN last_sync_status TEXT NOT NULL DEFAULT 'never'",
    )
    .await?;
    ensure_column(
        pool,
        "skill_registries",
        "last_sync_error",
        "ALTER TABLE skill_registries ADD COLUMN last_sync_error TEXT",
    )
    .await?;
    ensure_column(
        pool,
        "skill_registries",
        "cache_updated_at",
        "ALTER TABLE skill_registries ADD COLUMN cache_updated_at TEXT",
    )
    .await?;
    ensure_column(
        pool,
        "skill_registries",
        "cache_expires_at",
        "ALTER TABLE skill_registries ADD COLUMN cache_expires_at TEXT",
    )
    .await?;
    ensure_column(
        pool,
        "skill_registries",
        "etag",
        "ALTER TABLE skill_registries ADD COLUMN etag TEXT",
    )
    .await?;
    ensure_column(
        pool,
        "skill_registries",
        "last_modified",
        "ALTER TABLE skill_registries ADD COLUMN last_modified TEXT",
    )
    .await?;
    ensure_column(
        pool,
        "marketplace_skills",
        "cache_updated_at",
        "ALTER TABLE marketplace_skills ADD COLUMN cache_updated_at TEXT",
    )
    .await?;

    // Seed built-in agents (INSERT OR IGNORE so repeated init is safe)
    seed_builtin_agents(pool).await?;

    // Seed built-in scan directories from the built-in agent registry.
    seed_builtin_scan_directories(pool).await?;

    // Seed built-in skill registries (marketplace sources)
    seed_builtin_registries(pool).await?;

    Ok(())
}

async fn seed_builtin_agents(pool: &DbPool) -> Result<(), String> {
    let agents = builtin_agents();
    let builtin_ids: Vec<&str> = agents.iter().map(|a| a.id.as_str()).collect();

    for agent in &agents {
        sqlx::query(
            "INSERT INTO agents
             (id, display_name, category, global_skills_dir, project_skills_dir,
              icon_name, is_detected, is_builtin, is_enabled)
             VALUES (?, ?, ?, ?, ?, ?, 0, 1, 1)
             ON CONFLICT(id) DO UPDATE SET
              display_name = excluded.display_name,
              category = excluded.category,
              global_skills_dir = excluded.global_skills_dir,
              project_skills_dir = excluded.project_skills_dir,
              icon_name = excluded.icon_name",
        )
        .bind(&agent.id)
        .bind(&agent.display_name)
        .bind(&agent.category)
        .bind(&agent.global_skills_dir)
        .bind(&agent.project_skills_dir)
        .bind(&agent.icon_name)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Remove builtin agents that no longer exist in code
    let all_db_agents: Vec<(String,)> =
        sqlx::query_as("SELECT id FROM agents WHERE is_builtin = 1")
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

    for (id,) in &all_db_agents {
        if !builtin_ids.contains(&id.as_str()) {
            sqlx::query("DELETE FROM agents WHERE id = ? AND is_builtin = 1")
                .bind(id)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Seed `scan_directories` with one row per unique `global_skills_dir` path
/// across all built-in agents.  Rows are marked `is_builtin = 1` and cannot
/// be removed by the user.  `INSERT OR IGNORE` keeps the operation idempotent:
/// if two built-in agents share the same path (codex and central both use
/// `~/.agents/skills`) only the first insert takes effect.
async fn seed_builtin_scan_directories(pool: &DbPool) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    for agent in builtin_agents() {
        sqlx::query(
            "INSERT OR IGNORE INTO scan_directories
             (path, label, is_active, is_builtin, added_at)
             VALUES (?, ?, 1, 1, ?)",
        )
        .bind(&agent.global_skills_dir)
        .bind(&agent.display_name)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    // Remove builtin scan directories that no longer exist in code
    let builtin_paths: std::collections::HashSet<String> = builtin_agents()
        .into_iter()
        .map(|a| a.global_skills_dir)
        .collect();
    let all_db_dirs: Vec<(String,)> =
        sqlx::query_as("SELECT path FROM scan_directories WHERE is_builtin = 1")
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;
    for (path,) in &all_db_dirs {
        if !builtin_paths.contains(path) {
            sqlx::query("DELETE FROM scan_directories WHERE path = ? AND is_builtin = 1")
                .bind(path)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

async fn seed_builtin_registries(pool: &DbPool) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let registries = vec![
        (
            "anthropic",
            "Anthropic",
            "github",
            "https://github.com/anthropics/skills",
        ),
        (
            "openai",
            "OpenAI",
            "github",
            "https://github.com/openai/skills",
        ),
        (
            "baoyu-skills",
            "baoyu-skills",
            "github",
            "https://github.com/jimliu/baoyu-skills",
        ),
    ];
    for (id, name, source_type, url) in registries {
        sqlx::query(
            "INSERT OR IGNORE INTO skill_registries
             (id, name, source_type, url, is_builtin, is_enabled, created_at)
             VALUES (?, ?, ?, ?, 1, 1, ?)",
        )
        .bind(id)
        .bind(name)
        .bind(source_type)
        .bind(url)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Seed built-in skills from the resource directory into ~/.agents/skills/.
/// Called before every scan_all_skills to ensure built-in skills are present.
///
/// Strategy (per TDD §4.3.1):
/// - Scans src_dir for all subdirectories containing SKILL.md (no manifest.json needed)
/// - Target does not exist → atomic copy (tmp dir → rename)
/// - Target is symlink → delete old symlink → atomic copy
/// - Target is directory → skip (preserve user modifications)
/// - Writes source='builtin' into the skills DB row
/// - Sets execute permission on .py/.sh files after copy (unix)
pub async fn seed_preset_skills(pool: &DbPool, src_dir: &std::path::Path) -> Result<(), String> {
    let home = resolve_home_dir();
    let target_dir = home.join(".agents").join("skills");
    std::fs::create_dir_all(&target_dir)
        .map_err(|e| format!("seed: create ~/.agents/skills failed: {e}"))?;

    let entries = match std::fs::read_dir(src_dir) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[JC] seed_preset_skills: cannot read src dir {:?}: {e}", src_dir);
            return Ok(());
        }
    };

    let now = chrono::Utc::now().to_rfc3339();

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with('.') || name == "SKILL.md" { continue; }
        if !path.is_dir() { continue; }
        if !path.join("SKILL.md").exists() { continue; }

        let dst = target_dir.join(name);

        // Check existing target
        if dst.exists() {
            let meta = match std::fs::symlink_metadata(&dst) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.file_type().is_symlink() {
                // Old symlink → remove and replace with copy
                let _ = std::fs::remove_file(&dst);
            } else {
                // Real directory -> check sentinel for incomplete copies from crashes
                let sentinel = dst.join(".seed_complete");
                if sentinel.exists() {
                    continue; // Complete copy, preserve user modifications
                }
                // Incomplete copy from previous crash -> remove and redo
                eprintln!("[JC] seed: {} has no .seed_complete, re-seeding", dst.display());
                let _ = std::fs::remove_dir_all(&dst);
            }
        }

        // Atomic copy: write to temp dir first, then rename
        let tmp = target_dir.join(format!(".tmp_{}", name));
        if tmp.exists() { let _ = std::fs::remove_dir_all(&tmp); }
        copy_dir_recursive(&path, &tmp)?;

        // Set execute permissions on scripts (unix only)
        #[cfg(unix)]
        set_script_permissions(&tmp);

        // Write sentinel BEFORE rename (atomic with the copy)
        std::fs::write(tmp.join(".seed_complete"), "1")
            .map_err(|e| format!("seed: write sentinel for {}: {e}", name))?;

        std::fs::rename(&tmp, &dst)
            .map_err(|e| format!("seed: atomic rename failed for {}: {e}", name))?;

        // Write DB row with source='builtin' (ON CONFLICT ensures existing rows are updated)
        // ponytail: lowercase id to match scanner's id format (scanner lowercases directory names).
        // Without this, seed creates "JC-xxx" and scanner creates "jc-xxx" → two rows → duplicate display.
        let seed_id = name.to_lowercase().replace(' ', "-");
        let _ = sqlx::query(
            "INSERT INTO skills (id, name, description, file_path, is_central, source, scanned_at)
             VALUES (?, ?, ?, ?, 1, 'builtin', ?)
             ON CONFLICT(id) DO UPDATE SET source = 'builtin'",
        )
        .bind(&seed_id)
        .bind(name)
        .bind::<Option<String>>(None)
        .bind(dst.join("SKILL.md").to_string_lossy().to_string())
        .bind(&now)
        .execute(pool)
        .await;
    }

    Ok(())
}

/// Set execute permission (0o755) on .py and .sh files recursively (unix only).
#[cfg(unix)]
fn set_script_permissions(dir: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    fn walk(d: &std::path::Path) {
        if let Ok(entries) = std::fs::read_dir(d) {
            for e in entries.flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(&p);
                } else if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
                    if ext == "py" || ext == "sh" {
                        let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755));
                    }
                }
            }
        }
    }
    walk(dir);
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| format!("创建目录失败: {e}"))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("读取目录失败: {e}"))?.flatten() {
        let src_path = entry.path();
        let name = src_path.file_name().unwrap();
        let dst_path = dst.join(name);
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("复制文件失败: {e}"))?;
        }
    }
    Ok(())
}

async fn ensure_column(
    pool: &DbPool,
    table: &str,
    column: &str,
    alter_sql: &str,
) -> Result<(), String> {
    let pragma = format!("PRAGMA table_info({table})");
    let rows = sqlx::query(&pragma)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    let has_column = rows.iter().any(|row| {
        use sqlx::Row;
        row.get::<String, _>("name") == column
    });

    if !has_column {
        sqlx::query(alter_sql)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub const UNIVERSAL_AGENTS_SKILLS_AGENT_IDS: &[&str] = &[
    "amp",
    "antigravity",
    "cline",
    "codex",
    "cursor",
    "deep-agents",
    "dexto",
    "firebender",
    "gemini-cli",
    "copilot",
    "kimi-code-cli",
    "opencode",
    "warp",
];

pub fn agent_supports_universal_agents_skills(agent_id: &str) -> bool {
    UNIVERSAL_AGENTS_SKILLS_AGENT_IDS.contains(&agent_id)
}

/// Returns the list of built-in agents using the current user's home directory.
pub fn builtin_agents() -> Vec<Agent> {
    let home = resolve_home_dir();
    let in_home = |relative: &str| path_to_string(&home.join(relative));
    let agent = |id: &str,
                 display_name: &str,
                 category: &str,
                 global_relative: &str,
                 project_relative: Option<&str>,
                 icon_name: &str| {
        Agent {
            id: id.to_string(),
            display_name: display_name.to_string(),
            category: category.to_string(),
            global_skills_dir: in_home(global_relative),
            project_skills_dir: project_relative.map(|value| value.to_string()),
            icon_name: Some(icon_name.to_string()),
            is_detected: false,
            is_builtin: true,
            is_enabled: true,
        }
    };

    vec![
        // ── Coding platforms ─────────────────────────────────────────────────
        agent(
            "claude-code",
            "Claude Code",
            "coding",
            ".claude/skills",
            Some(".claude/skills"),
            "claude",
        ),
        agent(
            "codex",
            "Codex CLI",
            "coding",
            ".codex/skills",
            None,
            "codex",
        ),
        agent(
            "cursor",
            "Cursor",
            "coding",
            ".cursor/skills",
            None,
            "cursor",
        ),
        agent(
            "antigravity",
            "Antigravity",
            "coding",
            ".agents/skills",
            None,
            "antigravity",
        ),
        agent("cline", "Cline", "coding", ".cline/skills", None, "cline"),
        agent(
            "deep-agents",
            "Deep Agents",
            "coding",
            ".agents/skills",
            None,
            "deep-agents",
        ),
        agent("dexto", "Dexto", "coding", ".agents/skills", None, "dexto"),
        agent(
            "firebender",
            "Firebender",
            "coding",
            ".agents/skills",
            None,
            "firebender",
        ),
        agent(
            "gemini-cli",
            "Gemini CLI",
            "coding",
            ".gemini/skills",
            None,
            "gemini",
        ),
        agent(
            "kimi-code-cli",
            "Kimi Code CLI",
            "coding",
            ".agents/skills",
            None,
            "kimi-code-cli",
        ),
        agent(
            "aider-desk",
            "AiderDesk",
            "coding",
            ".aider-desk/skills",
            Some(".aider-desk/skills"),
            "aider-desk",
        ),
        agent(
            "trae",
            "Trae",
            "coding",
            ".trae/skills",
            Some(".trae/skills"),
            "trae",
        ),
        agent(
            "factory-droid",
            "Factory Droid",
            "coding",
            ".factory/skills",
            Some(".factory/skills"),
            "factory",
        ),
        agent(
            "junie",
            "Junie",
            "coding",
            ".junie/skills",
            Some(".junie/skills"),
            "junie",
        ),
        agent(
            "qwen",
            "Qwen Code",
            "coding",
            ".qwen/skills",
            Some(".qwen/skills"),
            "qwen",
        ),
        agent(
            "trae-cn",
            "Trae CN",
            "coding",
            ".trae-cn/skills",
            Some(".trae/skills"),
            "trae-cn",
        ),
        agent(
            "windsurf",
            "Windsurf",
            "coding",
            ".codeium/windsurf/skills",
            Some(".windsurf/skills"),
            "windsurf",
        ),
        agent(
            "qoder",
            "Qoder",
            "coding",
            ".qoder/skills",
            Some(".qoder/skills"),
            "qoder",
        ),
        agent(
            "augment",
            "Augment",
            "coding",
            ".augment/skills",
            Some(".augment/skills"),
            "augment",
        ),
        agent(
            "opencode",
            "OpenCode",
            "coding",
            ".opencode/skills",
            None,
            "opencode",
        ),
        agent(
            "kilocode",
            "Kilo Code",
            "coding",
            ".kilocode/skills",
            Some(".kilocode/skills"),
            "kilocode",
        ),
        agent("ob1", "OB1", "coding", ".ob1/skills", None, "ob1"),
        agent("amp", "Amp", "coding", ".amp/skills", None, "amp"),
        agent(
            "kiro",
            "Kiro CLI",
            "coding",
            ".kiro/skills",
            Some(".kiro/skills"),
            "kiro",
        ),
        agent(
            "codebuddy",
            "CodeBuddy",
            "coding",
            ".codebuddy/skills",
            Some(".codebuddy/skills"),
            "codebuddy",
        ),
        agent(
            "bob",
            "IBM Bob",
            "coding",
            ".bob/skills",
            Some(".bob/skills"),
            "bob",
        ),
        agent(
            "codearts-agent",
            "CodeArts Agent",
            "coding",
            ".codeartsdoer/skills",
            Some(".codeartsdoer/skills"),
            "codearts-agent",
        ),
        agent(
            "codemaker",
            "Codemaker",
            "coding",
            ".codemaker/skills",
            Some(".codemaker/skills"),
            "codemaker",
        ),
        agent(
            "codestudio",
            "Code Studio",
            "coding",
            ".codestudio/skills",
            Some(".codestudio/skills"),
            "codestudio",
        ),
        agent(
            "command-code",
            "Command Code",
            "coding",
            ".commandcode/skills",
            Some(".commandcode/skills"),
            "command-code",
        ),
        agent(
            "continue",
            "Continue",
            "coding",
            ".continue/skills",
            Some(".continue/skills"),
            "continue",
        ),
        agent(
            "cortex",
            "Cortex Code",
            "coding",
            ".snowflake/cortex/skills",
            Some(".cortex/skills"),
            "cortex",
        ),
        agent(
            "crush",
            "Crush",
            "coding",
            ".config/crush/skills",
            Some(".crush/skills"),
            "crush",
        ),
        agent(
            "devin",
            "Devin for Terminal",
            "coding",
            ".config/devin/skills",
            Some(".devin/skills"),
            "devin",
        ),
        agent(
            "forgecode",
            "ForgeCode",
            "coding",
            ".forge/skills",
            Some(".forge/skills"),
            "forgecode",
        ),
        agent(
            "goose",
            "Goose",
            "coding",
            ".config/goose/skills",
            Some(".goose/skills"),
            "goose",
        ),
        agent(
            "iflow-cli",
            "iFlow CLI",
            "coding",
            ".iflow/skills",
            Some(".iflow/skills"),
            "iflow-cli",
        ),
        agent(
            "kode",
            "Kode",
            "coding",
            ".kode/skills",
            Some(".kode/skills"),
            "kode",
        ),
        agent(
            "mcpjam",
            "MCPJam",
            "coding",
            ".mcpjam/skills",
            Some(".mcpjam/skills"),
            "mcpjam",
        ),
        agent(
            "mistral-vibe",
            "Mistral Vibe",
            "coding",
            ".vibe/skills",
            Some(".vibe/skills"),
            "mistral-vibe",
        ),
        agent(
            "mux",
            "Mux",
            "coding",
            ".mux/skills",
            Some(".mux/skills"),
            "mux",
        ),
        agent(
            "openhands",
            "OpenHands",
            "coding",
            ".openhands/skills",
            Some(".openhands/skills"),
            "openhands",
        ),
        agent(
            "pi",
            "Pi",
            "coding",
            ".pi/agent/skills",
            Some(".pi/skills"),
            "pi",
        ),
        agent(
            "rovodev",
            "Rovo Dev",
            "coding",
            ".rovodev/skills",
            Some(".rovodev/skills"),
            "rovodev",
        ),
        agent(
            "roo",
            "Roo Code",
            "coding",
            ".roo/skills",
            Some(".roo/skills"),
            "roo",
        ),
        agent(
            "tabnine-cli",
            "Tabnine CLI",
            "coding",
            ".tabnine/agent/skills",
            Some(".tabnine/agent/skills"),
            "tabnine-cli",
        ),
        agent(
            "zencoder",
            "Zencoder",
            "coding",
            ".zencoder/skills",
            Some(".zencoder/skills"),
            "zencoder",
        ),
        agent(
            "neovate",
            "Neovate",
            "coding",
            ".neovate/skills",
            Some(".neovate/skills"),
            "neovate",
        ),
        agent(
            "pochi",
            "Pochi",
            "coding",
            ".pochi/skills",
            Some(".pochi/skills"),
            "pochi",
        ),
        agent(
            "adal",
            "AdaL",
            "coding",
            ".adal/skills",
            Some(".adal/skills"),
            "adal",
        ),
        agent(
            "copilot",
            "GitHub Copilot",
            "coding",
            ".copilot/skills",
            None,
            "copilot",
        ),
        agent("warp", "Warp", "coding", ".agents/skills", None, "warp"),
        agent("aider", "Aider", "coding", ".aider/skills", None, "aider"),
        // ── Lobster platforms ────────────────────────────────────────────────
        agent(
            "hermes",
            "Hermes",
            "lobster",
            ".hermes/skills",
            None,
            "hermes",
        ),
        agent(
            "openclaw",
            "OpenClaw",
            "lobster",
            ".openclaw/skills",
            Some("skills"),
            "openclaw",
        ),
        agent(
            "grok",
            "Grok",
            "coding",
            ".grok/skills",
            None,
            "grok",
        ),
        agent(
            "grok-bundled",
            "Grok (Bundled)",
            "coding",
            ".grok/bundled/skills",
            None,
            "grok",
        ),
        agent("qclaw", "QClaw", "lobster", ".qclaw/skills", None, "qclaw"),
        agent(
            "easyclaw",
            "EasyClaw",
            "lobster",
            ".easyclaw/skills",
            None,
            "easyclaw",
        ),
        agent(
            "autoclaw",
            "AutoClaw",
            "lobster",
            ".openclaw-autoclaw/skills",
            None,
            "autoclaw",
        ),
        agent(
            "workbuddy",
            "WorkBuddy",
            "lobster",
            ".workbuddy/skills-marketplace/skills",
            None,
            "workbuddy",
        ),
        // ── Central Skills ────────────────────────────────────────────────────
        agent(
            "central",
            "Central Skills",
            "central",
            ".agents/skills",
            None,
            "central",
        ),
    ]
}

// ─── Skills ───────────────────────────────────────────────────────────────────

/// Insert or update a skill record.
///
/// Uses `ON CONFLICT DO UPDATE` to preserve `is_central = true` if a prior
/// scan already marked the skill as central (e.g., when the central agent and
/// codex both point to `~/.agents/skills/` and are scanned in different
/// orders). Once a skill is flagged as central it must never be downgraded to
/// non-central by a subsequent scan of the same directory by a non-central agent.
pub async fn upsert_skill(pool: &DbPool, skill: &Skill) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO skills
         (id, name, description, file_path, canonical_path, is_central, source, content, commands, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name           = CASE
                              WHEN skills.is_central = 1 AND excluded.is_central = 0 THEN skills.name
                              ELSE excluded.name
                            END,
           description    = CASE
                              WHEN skills.is_central = 1 AND excluded.is_central = 0 THEN skills.description
                              ELSE excluded.description
                            END,
           file_path      = CASE
                              WHEN skills.is_central = 1 AND excluded.is_central = 0 THEN skills.file_path
                              ELSE excluded.file_path
                            END,
           canonical_path = CASE
                              WHEN skills.is_central = 1 AND excluded.is_central = 0 THEN skills.canonical_path
                              ELSE COALESCE(excluded.canonical_path, skills.canonical_path)
                            END,
           is_central     = MAX(skills.is_central, excluded.is_central),
           source         = CASE
                              WHEN skills.source = 'builtin' THEN 'builtin'
                              WHEN skills.is_central = 1 AND excluded.is_central = 0 THEN skills.source
                              ELSE excluded.source
                            END,
           content        = CASE
                              WHEN skills.is_central = 1 AND excluded.is_central = 0 THEN skills.content
                              ELSE excluded.content
                            END,
           commands       = CASE
                              WHEN skills.is_central = 1 AND excluded.is_central = 0 THEN skills.commands
                              ELSE excluded.commands
                            END,
           scanned_at     = excluded.scanned_at",
    )
    .bind(&skill.id)
    .bind(&skill.name)
    .bind(&skill.description)
    .bind(&skill.file_path)
    .bind(&skill.canonical_path)
    .bind(skill.is_central)
    .bind(&skill.source)
    .bind(&skill.content)
    .bind(&skill.commands)
    .bind(&skill.scanned_at)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[allow(dead_code)]
fn observation_to_skill(observation: AgentSkillObservation) -> Skill {
    Skill {
        id: observation.skill_id,
        name: observation.name,
        description: observation.description,
        file_path: observation.file_path,
        canonical_path: None,
        is_central: false,
        source: Some(observation.link_type),
        content: None,
        commands: observation.commands,
        scanned_at: observation.scanned_at,
    }
}

/// Retrieve all skills installed for a given agent.
#[allow(dead_code)]
pub async fn get_skills_by_agent(pool: &DbPool, agent_id: &str) -> Result<Vec<Skill>, String> {
    if agent_id == "claude-code" {
        let observations = get_agent_skill_observations(pool, agent_id).await?;
        if !observations.is_empty() {
            return Ok(observations.into_iter().map(observation_to_skill).collect());
        }
    }

    sqlx::query_as::<_, Skill>(
        "SELECT s.* FROM skills s
         JOIN skill_installations si ON s.id = si.skill_id
         WHERE si.agent_id = ?",
    )
    .bind(agent_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// A skill enriched with the installation-specific fields for a given agent.
///
/// Returned by `get_skills_for_agent`. The extra fields come from the
/// `skill_installations` row and allow the frontend `SkillCard` to display
/// the correct source indicator without a second round-trip.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SkillForAgent {
    pub id: String,
    /// Stable row identity for list/detail routing.
    pub row_id: String,
    pub name: String,
    pub description: Option<String>,
    /// Absolute path to the `SKILL.md` file.
    pub file_path: String,
    /// Absolute path to the skill directory as installed for this agent
    /// (i.e., `skill_installations.installed_path`).
    pub dir_path: String,
    /// How the skill is linked: "symlink", "copy", or "native".
    pub link_type: String,
    /// Symlink target path, if `link_type` is "symlink".
    pub symlink_target: Option<String>,
    pub is_central: bool,
    pub source_kind: Option<String>,
    pub source_root: Option<String>,
    pub is_read_only: bool,
    pub conflict_group: Option<String>,
    pub conflict_count: i64,
}

fn observation_to_skill_for_agent(observation: AgentSkillObservation) -> SkillForAgent {
    SkillForAgent {
        id: observation.skill_id,
        row_id: observation.row_id,
        name: observation.name,
        description: observation.description,
        file_path: observation.file_path,
        dir_path: observation.dir_path,
        link_type: observation.link_type,
        symlink_target: observation.symlink_target,
        is_central: false,
        source_kind: Some(observation.source_kind),
        source_root: Some(observation.source_root),
        is_read_only: observation.is_read_only,
        conflict_group: None,
        conflict_count: 0,
    }
}

fn claude_conflict_group(agent_id: &str, skill_id: &str) -> String {
    format!("{agent_id}::{skill_id}")
}

/// Retrieve skills installed for a given agent, enriched with installation
/// metadata (`dir_path`, `link_type`, `symlink_target`) required by the
/// platform-view skill cards.
pub async fn get_skills_for_agent(
    pool: &DbPool,
    agent_id: &str,
) -> Result<Vec<SkillForAgent>, String> {
    if agent_id == "claude-code" {
        let observations = get_agent_skill_observations(pool, agent_id).await?;
        if !observations.is_empty() {
            let mut conflict_counts: HashMap<String, i64> = HashMap::new();
            for observation in &observations {
                *conflict_counts
                    .entry(observation.skill_id.clone())
                    .or_insert(0) += 1;
            }

            return Ok(observations
                .into_iter()
                .map(|observation| {
                    let conflict_count = conflict_counts
                        .get(&observation.skill_id)
                        .copied()
                        .unwrap_or(0);
                    let mut skill = observation_to_skill_for_agent(observation);
                    if conflict_count > 1 {
                        skill.conflict_group = Some(claude_conflict_group(agent_id, &skill.id));
                        skill.conflict_count = conflict_count;
                    }
                    skill
                })
                .collect());
        }
    }

    let mut skills = sqlx::query_as::<_, SkillForAgent>(
        "SELECT s.id,
                s.id AS row_id,
                s.name,
                s.description,
                s.file_path,
                si.installed_path AS dir_path,
                si.link_type,
                si.symlink_target,
                s.is_central,
                NULL AS source_kind,
                NULL AS source_root,
                0 AS is_read_only,
                NULL AS conflict_group,
                0 AS conflict_count
         FROM skills s
         JOIN skill_installations si ON s.id = si.skill_id
         WHERE si.agent_id = ?",
    )
    .bind(agent_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let installed_ids: HashSet<String> = skills.iter().map(|skill| skill.id.clone()).collect();
    let observations = get_agent_skill_observations(pool, agent_id).await?;
    skills.extend(
        observations
            .into_iter()
            .filter(|observation| !installed_ids.contains(&observation.skill_id))
            .map(observation_to_skill_for_agent),
    );
    skills.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.dir_path.cmp(&b.dir_path))
    });

    Ok(skills)
}

pub async fn upsert_agent_skill_observation(
    pool: &DbPool,
    observation: &AgentSkillObservation,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO agent_skill_observations
         (row_id, agent_id, skill_id, name, description, file_path, dir_path,
          source_kind, source_root, link_type, symlink_target, is_read_only, commands, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(row_id) DO UPDATE SET
           agent_id       = excluded.agent_id,
           skill_id       = excluded.skill_id,
           name           = excluded.name,
           description    = excluded.description,
           file_path      = excluded.file_path,
           dir_path       = excluded.dir_path,
           source_kind    = excluded.source_kind,
           source_root    = excluded.source_root,
           link_type      = excluded.link_type,
           symlink_target = excluded.symlink_target,
           is_read_only   = excluded.is_read_only,
           commands       = excluded.commands,
           scanned_at     = excluded.scanned_at",
    )
    .bind(&observation.row_id)
    .bind(&observation.agent_id)
    .bind(&observation.skill_id)
    .bind(&observation.name)
    .bind(&observation.description)
    .bind(&observation.file_path)
    .bind(&observation.dir_path)
    .bind(&observation.source_kind)
    .bind(&observation.source_root)
    .bind(&observation.link_type)
    .bind(&observation.symlink_target)
    .bind(observation.is_read_only)
    .bind(&observation.commands)
    .bind(&observation.scanned_at)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub async fn get_agent_skill_observations(
    pool: &DbPool,
    agent_id: &str,
) -> Result<Vec<AgentSkillObservation>, String> {
    sqlx::query_as::<_, AgentSkillObservation>(
        "SELECT * FROM agent_skill_observations
         WHERE agent_id = ?
         ORDER BY name, dir_path",
    )
    .bind(agent_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Retrieve all Central Skills (is_central = true).
pub async fn get_central_skills(pool: &DbPool) -> Result<Vec<Skill>, String> {
    sqlx::query_as::<_, Skill>("SELECT * FROM skills WHERE is_central = 1")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Retrieve a skill by its ID.
pub async fn get_skill_by_id(pool: &DbPool, skill_id: &str) -> Result<Option<Skill>, String> {
    sqlx::query_as::<_, Skill>("SELECT * FROM skills WHERE id = ?")
        .bind(skill_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Delete a skill and all its installation records.
/// Delete all local database state owned by a Central Skill removal.
///
/// This intentionally does not delete `discovered_skills`: those rows describe
/// project-level sources and `is_already_central` is recomputed from the
/// filesystem when discovery results are loaded.
pub async fn delete_central_skill_records(
    pool: &DbPool,
    skill_id: &str,
    skill_name: &str,
) -> Result<(), String> {
    sqlx::query("DELETE FROM skill_installations WHERE skill_id = ?")
        .bind(skill_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM collection_skills WHERE skill_id = ?")
        .bind(skill_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM skill_explanations WHERE skill_id = ?")
        .bind(skill_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query(
        "UPDATE marketplace_skills
         SET is_installed = 0
         WHERE name = ? OR name = ? OR id = ? OR id LIKE ?",
    )
    .bind(skill_name)
    .bind(skill_id)
    .bind(skill_id)
    .bind(format!("%::{}", skill_id))
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM skills WHERE id = ?")
        .bind(skill_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ─── Skill Installations ──────────────────────────────────────────────────────

/// Insert or update a skill installation record.
///
/// On conflict (same skill_id + agent_id), updates the mutable fields
/// (installed_path, link_type, symlink_target) but **preserves the original
/// `created_at`** so the installation timestamp reflects when the skill was
/// first installed, not when it was last re-scanned.
pub async fn upsert_skill_installation(
    pool: &DbPool,
    installation: &SkillInstallation,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO skill_installations
         (skill_id, agent_id, installed_path, link_type, symlink_target, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(skill_id, agent_id) DO UPDATE SET
           installed_path = excluded.installed_path,
           link_type      = excluded.link_type,
           symlink_target = excluded.symlink_target",
    )
    .bind(&installation.skill_id)
    .bind(&installation.agent_id)
    .bind(&installation.installed_path)
    .bind(&installation.link_type)
    .bind(&installation.symlink_target)
    .bind(&installation.created_at)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Delete an installation record for a specific skill+agent pair.
pub async fn delete_skill_installation(
    pool: &DbPool,
    skill_id: &str,
    agent_id: &str,
) -> Result<(), String> {
    sqlx::query("DELETE FROM skill_installations WHERE skill_id = ? AND agent_id = ?")
        .bind(skill_id)
        .bind(agent_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Remove installation records for a given agent where the skill ID is NOT in
/// `found_skill_ids`. Pass an empty slice to remove ALL installations for the
/// agent (used when the agent's skills directory no longer exists).
pub async fn delete_stale_skill_installations(
    pool: &DbPool,
    agent_id: &str,
    found_skill_ids: &[String],
) -> Result<(), String> {
    if found_skill_ids.is_empty() {
        return sqlx::query("DELETE FROM skill_installations WHERE agent_id = ?")
            .bind(agent_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string());
    }

    let placeholders = found_skill_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "DELETE FROM skill_installations WHERE agent_id = ? AND skill_id NOT IN ({})",
        placeholders
    );

    let mut q = sqlx::query(&sql).bind(agent_id);
    for id in found_skill_ids {
        q = q.bind(id.as_str());
    }
    q.execute(pool).await.map(|_| ()).map_err(|e| e.to_string())
}

pub async fn delete_stale_agent_skill_observations(
    pool: &DbPool,
    agent_id: &str,
    found_row_ids: &[String],
) -> Result<(), String> {
    if found_row_ids.is_empty() {
        return sqlx::query("DELETE FROM agent_skill_observations WHERE agent_id = ?")
            .bind(agent_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string());
    }

    let placeholders = found_row_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "DELETE FROM agent_skill_observations WHERE agent_id = ? AND row_id NOT IN ({})",
        placeholders
    );

    let mut q = sqlx::query(&sql).bind(agent_id);
    for row_id in found_row_ids {
        q = q.bind(row_id.as_str());
    }
    q.execute(pool).await.map(|_| ()).map_err(|e| e.to_string())
}

/// Delete skills whose IDs are NOT in `found_skill_ids`. Also cascades to
/// remove any orphaned `skill_installations` rows for those skills.
///
/// This is the global reconciliation step run after a full scan to purge rows
/// for skills that no longer exist on disk in any scanned scope.
///
/// Pass an empty slice to delete ALL skills (used only when every scanned
/// directory is empty or missing).
pub async fn delete_skills_not_in_scope(
    pool: &DbPool,
    found_skill_ids: &[String],
) -> Result<(), String> {
    if found_skill_ids.is_empty() {
        // Nothing found — delete all installation records first, then all skills.
        sqlx::query("DELETE FROM skill_installations")
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        return sqlx::query("DELETE FROM skills")
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string());
    }

    let placeholders = found_skill_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");

    // Cascade: remove installation rows for skills that are no longer on disk.
    let install_sql = format!(
        "DELETE FROM skill_installations WHERE skill_id NOT IN ({})",
        placeholders
    );
    let mut q = sqlx::query(&install_sql);
    for id in found_skill_ids {
        q = q.bind(id.as_str());
    }
    q.execute(pool).await.map_err(|e| e.to_string())?;

    // Remove the stale skills themselves.
    let skill_sql = format!("DELETE FROM skills WHERE id NOT IN ({})", placeholders);
    let mut q2 = sqlx::query(&skill_sql);
    for id in found_skill_ids {
        q2 = q2.bind(id.as_str());
    }
    q2.execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Retrieve all installation records for a given skill.
pub async fn get_skill_installations(
    pool: &DbPool,
    skill_id: &str,
) -> Result<Vec<SkillInstallation>, String> {
    sqlx::query_as::<_, SkillInstallation>("SELECT * FROM skill_installations WHERE skill_id = ?")
        .bind(skill_id)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

pub async fn get_read_only_observed_agent_ids_for_skill(
    pool: &DbPool,
    skill_id: &str,
) -> Result<Vec<String>, String> {
    sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT agent_id
         FROM agent_skill_observations
         WHERE skill_id = ?
           AND is_read_only = 1
           AND source_kind = 'compatibility'
         ORDER BY agent_id",
    )
    .bind(skill_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

// ─── Agents ───────────────────────────────────────────────────────────────────

/// Retrieve all agents.
pub async fn get_all_agents(pool: &DbPool) -> Result<Vec<Agent>, String> {
    sqlx::query_as::<_, Agent>("SELECT * FROM agents ORDER BY is_builtin DESC, display_name")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Retrieve a single agent by ID.
pub async fn get_agent_by_id(pool: &DbPool, agent_id: &str) -> Result<Option<Agent>, String> {
    sqlx::query_as::<_, Agent>("SELECT * FROM agents WHERE id = ?")
        .bind(agent_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Update the `is_detected` flag for an agent.
pub async fn update_agent_detected(
    pool: &DbPool,
    agent_id: &str,
    is_detected: bool,
) -> Result<(), String> {
    sqlx::query("UPDATE agents SET is_detected = ? WHERE id = ?")
        .bind(is_detected)
        .bind(agent_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Insert a new custom agent (non-builtin).
pub async fn insert_custom_agent(pool: &DbPool, agent: &Agent) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO agents
         (id, display_name, category, global_skills_dir, project_skills_dir,
          icon_name, is_detected, is_builtin, is_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)",
    )
    .bind(&agent.id)
    .bind(&agent.display_name)
    .bind(&agent.category)
    .bind(&agent.global_skills_dir)
    .bind(&agent.project_skills_dir)
    .bind(&agent.icon_name)
    .bind(agent.is_detected)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Delete a custom (non-builtin) agent by ID. Returns an error if the agent is builtin.
pub async fn delete_custom_agent(pool: &DbPool, agent_id: &str) -> Result<(), String> {
    let agent = get_agent_by_id(pool, agent_id).await?;
    match agent {
        None => Err(format!("Agent '{}' not found", agent_id)),
        Some(a) if a.is_builtin => Err(format!("Cannot delete built-in agent '{}'", agent_id)),
        Some(_) => sqlx::query("DELETE FROM agents WHERE id = ?")
            .bind(agent_id)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string()),
    }
}

/// Update a custom (non-builtin) agent's mutable fields.
/// Returns the updated agent record, or an error if the agent is builtin or not found.
pub async fn update_custom_agent(
    pool: &DbPool,
    agent_id: &str,
    display_name: &str,
    category: &str,
    global_skills_dir: &str,
) -> Result<Agent, String> {
    let agent = get_agent_by_id(pool, agent_id).await?;
    match agent {
        None => return Err(format!("Agent '{}' not found", agent_id)),
        Some(a) if a.is_builtin => {
            return Err(format!("Cannot update built-in agent '{}'", agent_id))
        }
        Some(_) => {}
    }

    sqlx::query(
        "UPDATE agents SET display_name = ?, category = ?, global_skills_dir = ? WHERE id = ?",
    )
    .bind(display_name)
    .bind(category)
    .bind(global_skills_dir)
    .bind(agent_id)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    get_agent_by_id(pool, agent_id)
        .await?
        .ok_or_else(|| "Failed to retrieve updated agent".to_string())
}

// ─── Collections ──────────────────────────────────────────────────────────────

/// Create a new collection and return it.
pub async fn create_collection(
    pool: &DbPool,
    name: &str,
    description: Option<&str>,
) -> Result<Collection, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO collections (id, name, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(name)
    .bind(description)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    get_collection_by_id(pool, &id)
        .await?
        .ok_or_else(|| "Failed to retrieve newly created collection".to_string())
}

/// Retrieve all collections.
pub async fn get_all_collections(pool: &DbPool) -> Result<Vec<Collection>, String> {
    sqlx::query_as::<_, Collection>("SELECT * FROM collections ORDER BY created_at")
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Retrieve a collection by ID.
pub async fn get_collection_by_id(
    pool: &DbPool,
    collection_id: &str,
) -> Result<Option<Collection>, String> {
    sqlx::query_as::<_, Collection>("SELECT * FROM collections WHERE id = ?")
        .bind(collection_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Update a collection's name and/or description.
pub async fn update_collection(
    pool: &DbPool,
    collection_id: &str,
    name: &str,
    description: Option<&str>,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    sqlx::query("UPDATE collections SET name = ?, description = ?, updated_at = ? WHERE id = ?")
        .bind(name)
        .bind(description)
        .bind(&now)
        .bind(collection_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Delete a collection and all its skill memberships.
pub async fn delete_collection(pool: &DbPool, collection_id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM collection_skills WHERE collection_id = ?")
        .bind(collection_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM collections WHERE id = ?")
        .bind(collection_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Add a skill to a collection (idempotent).
pub async fn add_skill_to_collection(
    pool: &DbPool,
    collection_id: &str,
    skill_id: &str,
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT OR IGNORE INTO collection_skills (collection_id, skill_id, added_at)
         VALUES (?, ?, ?)",
    )
    .bind(collection_id)
    .bind(skill_id)
    .bind(&now)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Remove a skill from a collection.
pub async fn remove_skill_from_collection(
    pool: &DbPool,
    collection_id: &str,
    skill_id: &str,
) -> Result<(), String> {
    sqlx::query("DELETE FROM collection_skills WHERE collection_id = ? AND skill_id = ?")
        .bind(collection_id)
        .bind(skill_id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Retrieve all skills belonging to a collection.
pub async fn get_collection_skills(
    pool: &DbPool,
    collection_id: &str,
) -> Result<Vec<Skill>, String> {
    sqlx::query_as::<_, Skill>(
        "SELECT s.* FROM skills s
         JOIN collection_skills cs ON s.id = cs.skill_id
         WHERE cs.collection_id = ?
         ORDER BY cs.added_at",
    )
    .bind(collection_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Retrieve all collections that contain a given skill.
pub async fn get_skill_collections(
    pool: &DbPool,
    skill_id: &str,
) -> Result<Vec<Collection>, String> {
    sqlx::query_as::<_, Collection>(
        "SELECT c.* FROM collections c
         JOIN collection_skills cs ON c.id = cs.collection_id
         WHERE cs.skill_id = ?
         ORDER BY cs.added_at",
    )
    .bind(skill_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

// ─── Scan Directories ─────────────────────────────────────────────────────────

/// Retrieve all scan directories.
pub async fn get_scan_directories(pool: &DbPool) -> Result<Vec<ScanDirectory>, String> {
    sqlx::query_as::<_, ScanDirectory>(
        "SELECT * FROM scan_directories ORDER BY is_builtin DESC, added_at",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Add a new scan directory entry (non-builtin by default).
pub async fn add_scan_directory(
    pool: &DbPool,
    path: &str,
    label: Option<&str>,
) -> Result<ScanDirectory, String> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "INSERT INTO scan_directories (path, label, is_active, is_builtin, added_at)
         VALUES (?, ?, 1, 0, ?)",
    )
    .bind(path)
    .bind(label)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query_as::<_, ScanDirectory>("SELECT * FROM scan_directories WHERE path = ?")
        .bind(path)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Remove a scan directory. Returns an error if the directory is builtin.
pub async fn remove_scan_directory(pool: &DbPool, path: &str) -> Result<(), String> {
    let row = sqlx::query("SELECT is_builtin FROM scan_directories WHERE path = ?")
        .bind(path)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    match row {
        None => Err(format!("Scan directory '{}' not found", path)),
        Some(r) => {
            let is_builtin: bool = r.try_get("is_builtin").map_err(|e| e.to_string())?;
            if is_builtin {
                return Err(format!("Cannot remove built-in scan directory '{}'", path));
            }
            sqlx::query("DELETE FROM scan_directories WHERE path = ?")
                .bind(path)
                .execute(pool)
                .await
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
    }
}

/// Toggle the `is_active` flag on a scan directory.
pub async fn toggle_scan_directory(
    pool: &DbPool,
    path: &str,
    is_active: bool,
) -> Result<(), String> {
    sqlx::query("UPDATE scan_directories SET is_active = ? WHERE path = ?")
        .bind(is_active)
        .bind(path)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ─── Discovered Skills ────────────────────────────────────────────────────────

/// A skill discovered in a project-level directory during a full-disk scan.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DiscoveredSkillRow {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub file_path: String,
    pub dir_path: String,
    pub project_path: String,
    pub project_name: String,
    pub platform_id: String,
    pub discovered_at: String,
}

/// Insert or update a discovered skill record.
#[allow(clippy::too_many_arguments)]
pub async fn insert_discovered_skill(
    pool: &DbPool,
    id: &str,
    name: &str,
    description: Option<&str>,
    file_path: &str,
    dir_path: &str,
    project_path: &str,
    project_name: &str,
    platform_id: &str,
    discovered_at: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO discovered_skills
         (id, name, description, file_path, dir_path, project_path, project_name, platform_id, discovered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name          = excluded.name,
           description   = excluded.description,
           file_path     = excluded.file_path,
           dir_path      = excluded.dir_path,
           project_path  = excluded.project_path,
           project_name  = excluded.project_name,
           platform_id   = excluded.platform_id,
           discovered_at = excluded.discovered_at",
    )
    .bind(id)
    .bind(name)
    .bind(description)
    .bind(file_path)
    .bind(dir_path)
    .bind(project_path)
    .bind(project_name)
    .bind(platform_id)
    .bind(discovered_at)
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Retrieve a discovered skill by its qualified ID.
pub async fn get_discovered_skill_by_id(
    pool: &DbPool,
    id: &str,
) -> Result<Option<DiscoveredSkillRow>, String> {
    sqlx::query_as::<_, DiscoveredSkillRow>("SELECT * FROM discovered_skills WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())
}

/// Retrieve all discovered skills.
pub async fn get_all_discovered_skills(pool: &DbPool) -> Result<Vec<DiscoveredSkillRow>, String> {
    sqlx::query_as::<_, DiscoveredSkillRow>(
        "SELECT * FROM discovered_skills ORDER BY project_name, platform_id, name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())
}

/// Delete a discovered skill by ID.
pub async fn delete_discovered_skill(pool: &DbPool, id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM discovered_skills WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Clear all discovered skills.
pub async fn clear_all_discovered_skills(pool: &DbPool) -> Result<(), String> {
    sqlx::query("DELETE FROM discovered_skills")
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Get count of discovered projects (distinct project_path values).
// ─── Settings ─────────────────────────────────────────────────────────────────

/// Get a setting value by key.
pub async fn get_setting(pool: &DbPool, key: &str) -> Result<Option<String>, String> {
    let row = sqlx::query("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(row.map(|r| r.get::<String, _>("value")))
}

/// Set (upsert) a setting value.
pub async fn set_setting(pool: &DbPool, key: &str, value: &str) -> Result<(), String> {
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// Create an in-memory SQLite pool and initialize the schema.
    async fn setup_test_db() -> DbPool {
        let pool = SqlitePool::connect(":memory:")
            .await
            .expect("Failed to create in-memory SQLite pool");
        init_database(&pool)
            .await
            .expect("Failed to initialize test database");
        pool
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_init_creates_all_tables() {
        let pool = setup_test_db().await;

        // Verify all core tables exist by counting rows (empty is fine)
        let tables = [
            "skills",
            "skill_installations",
            "agent_skill_observations",
            "agents",
            "collections",
            "collection_skills",
            "scan_directories",
            "settings",
        ];
        for table in &tables {
            let result = sqlx::query(&format!("SELECT COUNT(*) as cnt FROM {}", table))
                .fetch_one(&pool)
                .await;
            assert!(result.is_ok(), "Table '{}' should exist", table);
        }
    }

    #[tokio::test]
    async fn test_init_is_idempotent() {
        let pool = setup_test_db().await;
        // Calling init_database again should not fail
        let result = init_database(&pool).await;
        assert!(result.is_ok(), "Second init should be idempotent");
    }

    #[tokio::test]
    async fn test_builtin_agents_seeded() {
        let pool = setup_test_db().await;
        let agents = get_all_agents(&pool).await.unwrap();
        assert_eq!(
            agents.len(),
            builtin_agents().len(),
            "Should have exactly the configured built-in agents"
        );

        let ids: Vec<&str> = agents.iter().map(|a| a.id.as_str()).collect();
        // Coding platforms
        assert!(ids.contains(&"claude-code"));
        assert!(ids.contains(&"codex"));
        assert!(ids.contains(&"cursor"));
        assert!(ids.contains(&"antigravity"));
        assert!(ids.contains(&"cline"));
        assert!(ids.contains(&"deep-agents"));
        assert!(ids.contains(&"dexto"));
        assert!(ids.contains(&"firebender"));
        assert!(ids.contains(&"gemini-cli"));
        assert!(ids.contains(&"kimi-code-cli"));
        assert!(ids.contains(&"trae"));
        assert!(ids.contains(&"factory-droid"));
        assert!(ids.contains(&"junie"));
        assert!(ids.contains(&"qwen"));
        assert!(ids.contains(&"trae-cn"));
        assert!(ids.contains(&"windsurf"));
        assert!(ids.contains(&"qoder"));
        assert!(ids.contains(&"augment"));
        assert!(ids.contains(&"opencode"));
        assert!(ids.contains(&"kilocode"));
        assert!(ids.contains(&"ob1"));
        assert!(ids.contains(&"amp"));
        assert!(ids.contains(&"kiro"));
        assert!(ids.contains(&"codebuddy"));
        assert!(ids.contains(&"aider-desk"));
        assert!(ids.contains(&"bob"));
        assert!(ids.contains(&"codearts-agent"));
        assert!(ids.contains(&"codemaker"));
        assert!(ids.contains(&"codestudio"));
        assert!(ids.contains(&"command-code"));
        assert!(ids.contains(&"continue"));
        assert!(ids.contains(&"cortex"));
        assert!(ids.contains(&"crush"));
        assert!(ids.contains(&"devin"));
        assert!(ids.contains(&"forgecode"));
        assert!(ids.contains(&"goose"));
        assert!(ids.contains(&"iflow-cli"));
        assert!(ids.contains(&"kode"));
        assert!(ids.contains(&"mcpjam"));
        assert!(ids.contains(&"mistral-vibe"));
        assert!(ids.contains(&"mux"));
        assert!(ids.contains(&"openhands"));
        assert!(ids.contains(&"pi"));
        assert!(ids.contains(&"rovodev"));
        assert!(ids.contains(&"roo"));
        assert!(ids.contains(&"tabnine-cli"));
        assert!(ids.contains(&"zencoder"));
        assert!(ids.contains(&"neovate"));
        assert!(ids.contains(&"pochi"));
        assert!(ids.contains(&"adal"));
        assert!(ids.contains(&"hermes"));
        assert!(ids.contains(&"copilot"));
        assert!(ids.contains(&"warp"));
        assert!(ids.contains(&"aider"));
        // Lobster platforms
        assert!(ids.contains(&"openclaw"));
        assert!(ids.contains(&"qclaw"));
        assert!(ids.contains(&"easyclaw"));
        assert!(ids.contains(&"autoclaw"));
        assert!(ids.contains(&"workbuddy"));
        // Central
        assert!(ids.contains(&"central"));
    }

    #[test]
    fn test_builtin_agents_have_expected_39_platform_skill_dirs() {
        let home = resolve_home_dir();
        let agents_by_id: std::collections::HashMap<String, Agent> = builtin_agents()
            .into_iter()
            .map(|agent| (agent.id.clone(), agent))
            .collect();

        let expected = [
            (
                "aider-desk",
                "AiderDesk",
                ".aider-desk/skills",
                ".aider-desk/skills",
            ),
            ("augment", "Augment", ".augment/skills", ".augment/skills"),
            ("bob", "IBM Bob", ".bob/skills", ".bob/skills"),
            (
                "claude-code",
                "Claude Code",
                ".claude/skills",
                ".claude/skills",
            ),
            ("openclaw", "OpenClaw", ".openclaw/skills", "skills"),
            (
                "codearts-agent",
                "CodeArts Agent",
                ".codeartsdoer/skills",
                ".codeartsdoer/skills",
            ),
            (
                "codebuddy",
                "CodeBuddy",
                ".codebuddy/skills",
                ".codebuddy/skills",
            ),
            (
                "codemaker",
                "Codemaker",
                ".codemaker/skills",
                ".codemaker/skills",
            ),
            (
                "codestudio",
                "Code Studio",
                ".codestudio/skills",
                ".codestudio/skills",
            ),
            (
                "command-code",
                "Command Code",
                ".commandcode/skills",
                ".commandcode/skills",
            ),
            (
                "continue",
                "Continue",
                ".continue/skills",
                ".continue/skills",
            ),
            (
                "cortex",
                "Cortex Code",
                ".snowflake/cortex/skills",
                ".cortex/skills",
            ),
            ("crush", "Crush", ".config/crush/skills", ".crush/skills"),
            (
                "devin",
                "Devin for Terminal",
                ".config/devin/skills",
                ".devin/skills",
            ),
            (
                "factory-droid",
                "Factory Droid",
                ".factory/skills",
                ".factory/skills",
            ),
            ("forgecode", "ForgeCode", ".forge/skills", ".forge/skills"),
            ("goose", "Goose", ".config/goose/skills", ".goose/skills"),
            ("junie", "Junie", ".junie/skills", ".junie/skills"),
            ("iflow-cli", "iFlow CLI", ".iflow/skills", ".iflow/skills"),
            (
                "kilocode",
                "Kilo Code",
                ".kilocode/skills",
                ".kilocode/skills",
            ),
            ("kiro", "Kiro CLI", ".kiro/skills", ".kiro/skills"),
            ("kode", "Kode", ".kode/skills", ".kode/skills"),
            ("mcpjam", "MCPJam", ".mcpjam/skills", ".mcpjam/skills"),
            (
                "mistral-vibe",
                "Mistral Vibe",
                ".vibe/skills",
                ".vibe/skills",
            ),
            ("mux", "Mux", ".mux/skills", ".mux/skills"),
            (
                "openhands",
                "OpenHands",
                ".openhands/skills",
                ".openhands/skills",
            ),
            ("pi", "Pi", ".pi/agent/skills", ".pi/skills"),
            ("qoder", "Qoder", ".qoder/skills", ".qoder/skills"),
            ("qwen", "Qwen Code", ".qwen/skills", ".qwen/skills"),
            ("rovodev", "Rovo Dev", ".rovodev/skills", ".rovodev/skills"),
            ("roo", "Roo Code", ".roo/skills", ".roo/skills"),
            (
                "tabnine-cli",
                "Tabnine CLI",
                ".tabnine/agent/skills",
                ".tabnine/agent/skills",
            ),
            ("trae", "Trae", ".trae/skills", ".trae/skills"),
            ("trae-cn", "Trae CN", ".trae-cn/skills", ".trae/skills"),
            (
                "windsurf",
                "Windsurf",
                ".codeium/windsurf/skills",
                ".windsurf/skills",
            ),
            (
                "zencoder",
                "Zencoder",
                ".zencoder/skills",
                ".zencoder/skills",
            ),
            ("neovate", "Neovate", ".neovate/skills", ".neovate/skills"),
            ("pochi", "Pochi", ".pochi/skills", ".pochi/skills"),
            ("adal", "AdaL", ".adal/skills", ".adal/skills"),
        ];

        for (id, display_name, global_rel, project_rel) in expected {
            let agent = agents_by_id
                .get(id)
                .unwrap_or_else(|| panic!("missing built-in agent {id}"));
            assert_eq!(agent.display_name, display_name, "display_name for {id}");
            assert_eq!(
                agent.global_skills_dir,
                path_to_string(&home.join(global_rel)),
                "global_skills_dir for {id}"
            );
            assert_eq!(
                agent.project_skills_dir.as_deref(),
                Some(project_rel),
                "project_skills_dir for {id}"
            );
        }

        assert!(!agents_by_id.contains_key("droid"));
        assert!(!agents_by_id.contains_key("qwen-code"));
        assert!(!agents_by_id.contains_key("kilo"));
        assert!(!agents_by_id.contains_key("kiro-cli"));
    }

    #[tokio::test]
    async fn test_builtin_agents_are_marked_builtin() {
        let pool = setup_test_db().await;
        let agents = get_all_agents(&pool).await.unwrap();
        for agent in &agents {
            assert!(agent.is_builtin, "All seeded agents should be builtin");
        }
    }

    #[tokio::test]
    async fn test_init_does_not_duplicate_agents_on_reinit() {
        let pool = setup_test_db().await;
        init_database(&pool).await.unwrap(); // Call a second time
        let agents = get_all_agents(&pool).await.unwrap();
        assert_eq!(
            agents.len(),
            builtin_agents().len(),
            "Reinit must not duplicate agents"
        );
    }

    // ── Skills ────────────────────────────────────────────────────────────────

    fn make_skill(id: &str, name: &str, is_central: bool) -> Skill {
        Skill {
            id: id.to_string(),
            name: name.to_string(),
            description: Some(format!("Description for {}", name)),
            file_path: format!("/tmp/{}/SKILL.md", id),
            canonical_path: if is_central {
                Some(format!("/tmp/.agents/skills/{}", id))
            } else {
                None
            },
            is_central,
            source: None,
            content: Some("# Test Skill\n\nContent here.".to_string()),
            commands: None,
            scanned_at: Utc::now().to_rfc3339(),
        }
    }

    #[tokio::test]
    async fn test_upsert_skill_insert() {
        let pool = setup_test_db().await;
        let skill = make_skill("test-skill", "Test Skill", false);
        upsert_skill(&pool, &skill).await.unwrap();

        let retrieved = get_skill_by_id(&pool, "test-skill").await.unwrap();
        assert!(retrieved.is_some());
        let s = retrieved.unwrap();
        assert_eq!(s.name, "Test Skill");
        assert!(!s.is_central);
    }

    #[tokio::test]
    async fn test_upsert_skill_update() {
        let pool = setup_test_db().await;
        let mut skill = make_skill("skill-1", "Original Name", false);
        upsert_skill(&pool, &skill).await.unwrap();

        skill.name = "Updated Name".to_string();
        upsert_skill(&pool, &skill).await.unwrap();

        let retrieved = get_skill_by_id(&pool, "skill-1").await.unwrap().unwrap();
        assert_eq!(retrieved.name, "Updated Name");
    }

    #[tokio::test]
    async fn test_upsert_skill_noncentral_scan_does_not_overwrite_central_metadata() {
        let pool = setup_test_db().await;
        let central = make_skill("shared-skill", "Central Name", true);
        upsert_skill(&pool, &central).await.unwrap();

        let mut platform = make_skill("shared-skill", "Platform Name", false);
        platform.description = Some("Platform description".to_string());
        platform.file_path = "/tmp/.hermes/skills/category/shared-skill/SKILL.md".to_string();
        platform.source = Some("copy".to_string());
        platform.scanned_at = "2026-04-28T00:00:00Z".to_string();
        upsert_skill(&pool, &platform).await.unwrap();

        let retrieved = get_skill_by_id(&pool, "shared-skill")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(retrieved.name, "Central Name");
        assert_eq!(retrieved.description, central.description);
        assert_eq!(retrieved.file_path, central.file_path);
        assert_eq!(retrieved.canonical_path, central.canonical_path);
        assert!(retrieved.is_central);
        assert_eq!(retrieved.scanned_at, "2026-04-28T00:00:00Z");
    }

    #[tokio::test]
    async fn test_get_skill_by_id_not_found() {
        let pool = setup_test_db().await;
        let result = get_skill_by_id(&pool, "nonexistent").await.unwrap();
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_get_central_skills() {
        let pool = setup_test_db().await;
        upsert_skill(&pool, &make_skill("central-1", "Central One", true))
            .await
            .unwrap();
        upsert_skill(&pool, &make_skill("non-central", "Not Central", false))
            .await
            .unwrap();

        let central = get_central_skills(&pool).await.unwrap();
        assert_eq!(central.len(), 1);
        assert_eq!(central[0].id, "central-1");
    }

    // ── Skill Installations ───────────────────────────────────────────────────

    fn make_installation(skill_id: &str, agent_id: &str, link_type: &str) -> SkillInstallation {
        SkillInstallation {
            skill_id: skill_id.to_string(),
            agent_id: agent_id.to_string(),
            installed_path: format!("/tmp/{}/{}", agent_id, skill_id),
            link_type: link_type.to_string(),
            symlink_target: if link_type == "symlink" {
                Some(format!("/tmp/.agents/skills/{}", skill_id))
            } else {
                None
            },
            created_at: Utc::now().to_rfc3339(),
        }
    }

    #[tokio::test]
    async fn test_upsert_and_get_skill_installation() {
        let pool = setup_test_db().await;
        let skill = make_skill("my-skill", "My Skill", false);
        upsert_skill(&pool, &skill).await.unwrap();

        let inst = make_installation("my-skill", "claude-code", "symlink");
        upsert_skill_installation(&pool, &inst).await.unwrap();

        let installations = get_skill_installations(&pool, "my-skill").await.unwrap();
        assert_eq!(installations.len(), 1);
        assert_eq!(installations[0].agent_id, "claude-code");
        assert_eq!(installations[0].link_type, "symlink");
    }

    #[tokio::test]
    async fn test_delete_skill_installation() {
        let pool = setup_test_db().await;
        let skill = make_skill("del-skill", "Del Skill", false);
        upsert_skill(&pool, &skill).await.unwrap();
        upsert_skill_installation(&pool, &make_installation("del-skill", "cursor", "copy"))
            .await
            .unwrap();

        delete_skill_installation(&pool, "del-skill", "cursor")
            .await
            .unwrap();

        let installations = get_skill_installations(&pool, "del-skill").await.unwrap();
        assert!(installations.is_empty());
    }

    #[tokio::test]
    async fn test_get_skills_by_agent() {
        let pool = setup_test_db().await;
        let skill_a = make_skill("skill-a", "Skill A", false);
        let skill_b = make_skill("skill-b", "Skill B", false);
        upsert_skill(&pool, &skill_a).await.unwrap();
        upsert_skill(&pool, &skill_b).await.unwrap();

        upsert_skill_installation(
            &pool,
            &make_installation("skill-a", "claude-code", "symlink"),
        )
        .await
        .unwrap();
        upsert_skill_installation(&pool, &make_installation("skill-b", "cursor", "copy"))
            .await
            .unwrap();

        let claude_skills = get_skills_by_agent(&pool, "claude-code").await.unwrap();
        assert_eq!(claude_skills.len(), 1);
        assert_eq!(claude_skills[0].id, "skill-a");

        let cursor_skills = get_skills_by_agent(&pool, "cursor").await.unwrap();
        assert_eq!(cursor_skills.len(), 1);
        assert_eq!(cursor_skills[0].id, "skill-b");

        let empty = get_skills_by_agent(&pool, "codex").await.unwrap();
        assert!(empty.is_empty());
    }

    // ── Agents ────────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_get_agent_by_id() {
        let pool = setup_test_db().await;
        let agent = get_agent_by_id(&pool, "claude-code").await.unwrap();
        assert!(agent.is_some());
        let a = agent.unwrap();
        assert_eq!(a.display_name, "Claude Code");
        assert_eq!(a.category, "coding");
        assert!(a.is_builtin);
    }

    #[tokio::test]
    async fn test_get_agent_by_id_not_found() {
        let pool = setup_test_db().await;
        let agent = get_agent_by_id(&pool, "nonexistent-agent").await.unwrap();
        assert!(agent.is_none());
    }

    #[tokio::test]
    async fn test_update_agent_detected() {
        let pool = setup_test_db().await;
        update_agent_detected(&pool, "cursor", true).await.unwrap();
        let agent = get_agent_by_id(&pool, "cursor").await.unwrap().unwrap();
        assert!(agent.is_detected);

        update_agent_detected(&pool, "cursor", false).await.unwrap();
        let agent = get_agent_by_id(&pool, "cursor").await.unwrap().unwrap();
        assert!(!agent.is_detected);
    }

    #[tokio::test]
    async fn test_insert_custom_agent() {
        let pool = setup_test_db().await;
        let custom = Agent {
            id: "my-custom-agent".to_string(),
            display_name: "My Custom Agent".to_string(),
            category: "other".to_string(),
            global_skills_dir: "/tmp/custom/skills".to_string(),
            project_skills_dir: None,
            icon_name: None,
            is_detected: false,
            is_builtin: false,
            is_enabled: true,
        };
        insert_custom_agent(&pool, &custom).await.unwrap();

        let all = get_all_agents(&pool).await.unwrap();
        assert_eq!(
            all.len(),
            builtin_agents().len() + 1,
            "Should have builtins + 1 custom"
        );

        let retrieved = get_agent_by_id(&pool, "my-custom-agent")
            .await
            .unwrap()
            .unwrap();
        assert!(!retrieved.is_builtin);
        assert_eq!(retrieved.display_name, "My Custom Agent");
    }

    #[tokio::test]
    async fn test_delete_custom_agent() {
        let pool = setup_test_db().await;
        let custom = Agent {
            id: "deletable-agent".to_string(),
            display_name: "Deletable".to_string(),
            category: "other".to_string(),
            global_skills_dir: "/tmp/deletable/skills".to_string(),
            project_skills_dir: None,
            icon_name: None,
            is_detected: false,
            is_builtin: false,
            is_enabled: true,
        };
        insert_custom_agent(&pool, &custom).await.unwrap();
        delete_custom_agent(&pool, "deletable-agent").await.unwrap();

        let retrieved = get_agent_by_id(&pool, "deletable-agent").await.unwrap();
        assert!(retrieved.is_none());
    }

    #[tokio::test]
    async fn test_cannot_delete_builtin_agent() {
        let pool = setup_test_db().await;
        let result = delete_custom_agent(&pool, "claude-code").await;
        assert!(
            result.is_err(),
            "Should not be able to delete built-in agent"
        );
    }

    #[tokio::test]
    async fn test_workbuddy_scans_correct_directory() {
        let pool = setup_test_db().await;
        let wb = get_agent_by_id(&pool, "workbuddy")
            .await
            .unwrap()
            .expect("WorkBuddy agent should exist");
        assert_eq!(wb.display_name, "WorkBuddy");
        assert!(
            wb.global_skills_dir
                .contains(".workbuddy/skills-marketplace/skills"),
            "WorkBuddy should scan ~/.workbuddy/skills-marketplace/skills, got: {}",
            wb.global_skills_dir
        );
    }

    #[tokio::test]
    async fn test_autoclaw_is_separate_from_workbuddy() {
        let pool = setup_test_db().await;
        let ac = get_agent_by_id(&pool, "autoclaw")
            .await
            .unwrap()
            .expect("AutoClaw agent should exist");
        assert_eq!(ac.display_name, "AutoClaw");
        assert_eq!(ac.category, "lobster");
        assert!(
            ac.global_skills_dir.contains(".openclaw-autoclaw/skills"),
            "AutoClaw should scan ~/.openclaw-autoclaw/skills, got: {}",
            ac.global_skills_dir
        );
        // Verify AutoClaw and WorkBuddy are distinct entries
        assert_ne!(ac.id, "workbuddy");
        assert_ne!(
            ac.global_skills_dir,
            get_agent_by_id(&pool, "workbuddy")
                .await
                .unwrap()
                .unwrap()
                .global_skills_dir
        );
    }

    // ── Collections ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_create_collection() {
        let pool = setup_test_db().await;
        let col = create_collection(&pool, "My Collection", Some("A test collection"))
            .await
            .unwrap();
        assert!(!col.id.is_empty());
        assert_eq!(col.name, "My Collection");
        assert_eq!(col.description.as_deref(), Some("A test collection"));
    }

    #[tokio::test]
    async fn test_get_all_collections() {
        let pool = setup_test_db().await;
        create_collection(&pool, "Collection A", None)
            .await
            .unwrap();
        create_collection(&pool, "Collection B", Some("Desc"))
            .await
            .unwrap();

        let all = get_all_collections(&pool).await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn test_update_collection() {
        let pool = setup_test_db().await;
        let col = create_collection(&pool, "Old Name", None).await.unwrap();
        update_collection(&pool, &col.id, "New Name", Some("New desc"))
            .await
            .unwrap();

        let updated = get_collection_by_id(&pool, &col.id).await.unwrap().unwrap();
        assert_eq!(updated.name, "New Name");
        assert_eq!(updated.description.as_deref(), Some("New desc"));
    }

    #[tokio::test]
    async fn test_delete_collection() {
        let pool = setup_test_db().await;
        let col = create_collection(&pool, "To Delete", None).await.unwrap();
        delete_collection(&pool, &col.id).await.unwrap();

        let retrieved = get_collection_by_id(&pool, &col.id).await.unwrap();
        assert!(retrieved.is_none());
    }

    #[tokio::test]
    async fn test_add_and_remove_skill_from_collection() {
        let pool = setup_test_db().await;
        let skill = make_skill("collection-skill", "Collection Skill", false);
        upsert_skill(&pool, &skill).await.unwrap();
        let col = create_collection(&pool, "Test Col", None).await.unwrap();

        add_skill_to_collection(&pool, &col.id, "collection-skill")
            .await
            .unwrap();

        let skills = get_collection_skills(&pool, &col.id).await.unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "collection-skill");

        remove_skill_from_collection(&pool, &col.id, "collection-skill")
            .await
            .unwrap();

        let skills_after = get_collection_skills(&pool, &col.id).await.unwrap();
        assert!(skills_after.is_empty());
    }

    #[tokio::test]
    async fn test_add_skill_to_collection_is_idempotent() {
        let pool = setup_test_db().await;
        let skill = make_skill("idem-skill", "Idem Skill", false);
        upsert_skill(&pool, &skill).await.unwrap();
        let col = create_collection(&pool, "Idem Col", None).await.unwrap();

        add_skill_to_collection(&pool, &col.id, "idem-skill")
            .await
            .unwrap();
        add_skill_to_collection(&pool, &col.id, "idem-skill")
            .await
            .unwrap();

        let skills = get_collection_skills(&pool, &col.id).await.unwrap();
        assert_eq!(skills.len(), 1, "Duplicate add should be a no-op");
    }

    #[tokio::test]
    async fn test_delete_collection_also_removes_skill_memberships() {
        let pool = setup_test_db().await;
        let skill = make_skill("cascade-skill", "Cascade Skill", false);
        upsert_skill(&pool, &skill).await.unwrap();
        let col = create_collection(&pool, "Cascade Col", None).await.unwrap();
        add_skill_to_collection(&pool, &col.id, "cascade-skill")
            .await
            .unwrap();

        delete_collection(&pool, &col.id).await.unwrap();

        // The collection_skills row should also be gone
        let rows: Vec<_> = sqlx::query("SELECT * FROM collection_skills WHERE collection_id = ?")
            .bind(&col.id)
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(rows.is_empty(), "Memberships should be cascade-deleted");
    }

    // ── Scan Directories ──────────────────────────────────────────────────────

    /// Returns the number of *unique* global_skills_dir paths across all
    /// built-in agents.  This is the number of rows that seed_builtin_scan_directories
    /// inserts.
    fn expected_builtin_scan_dir_count() -> usize {
        let mut paths = std::collections::HashSet::new();
        for agent in builtin_agents() {
            paths.insert(agent.global_skills_dir);
        }
        paths.len()
    }

    #[tokio::test]
    async fn test_builtin_scan_dirs_seeded() {
        let pool = setup_test_db().await;
        let dirs = get_scan_directories(&pool).await.unwrap();
        let builtin_count = expected_builtin_scan_dir_count();

        // Expect exactly one row per unique global_skills_dir across built-in agents.
        assert_eq!(
            dirs.len(),
            builtin_count,
            "Should have {} built-in scan directories after init (got {})",
            builtin_count,
            dirs.len()
        );

        // Every seeded row must be marked as built-in and active.
        for dir in &dirs {
            assert!(
                dir.is_builtin,
                "Seeded scan directory '{}' must have is_builtin=true",
                dir.path
            );
            assert!(
                dir.is_active,
                "Seeded scan directory '{}' must be active by default",
                dir.path
            );
        }

        // The paths must match the unique global_skills_dir values.
        let seeded_paths: std::collections::HashSet<&str> =
            dirs.iter().map(|d| d.path.as_str()).collect();
        for agent in builtin_agents() {
            assert!(
                seeded_paths.contains(agent.global_skills_dir.as_str()),
                "Built-in agent '{}' global_skills_dir '{}' must be in scan_directories",
                agent.id,
                agent.global_skills_dir
            );
        }
    }

    #[tokio::test]
    async fn test_builtin_scan_dirs_seeded_is_idempotent() {
        let pool = setup_test_db().await;
        // Second call to init_database must not create duplicate rows.
        init_database(&pool).await.unwrap();
        let dirs = get_scan_directories(&pool).await.unwrap();
        let builtin_count = expected_builtin_scan_dir_count();
        assert_eq!(
            dirs.len(),
            builtin_count,
            "Repeated init must not create duplicate scan directory rows"
        );
    }

    #[tokio::test]
    async fn test_add_scan_directory() {
        let pool = setup_test_db().await;
        let dir = add_scan_directory(&pool, "/tmp/my-project", Some("My Project"))
            .await
            .unwrap();
        assert_eq!(dir.path, "/tmp/my-project");
        assert_eq!(dir.label.as_deref(), Some("My Project"));
        assert!(dir.is_active);
        assert!(!dir.is_builtin);
    }

    #[tokio::test]
    async fn test_get_scan_directories() {
        let pool = setup_test_db().await;
        add_scan_directory(&pool, "/tmp/dir-a", None).await.unwrap();
        add_scan_directory(&pool, "/tmp/dir-b", Some("Dir B"))
            .await
            .unwrap();

        let dirs = get_scan_directories(&pool).await.unwrap();
        // There are N built-in dirs (seeded on init) plus the 2 we just added.
        let builtin_count = expected_builtin_scan_dir_count();
        assert_eq!(dirs.len(), builtin_count + 2);

        // Verify the custom ones are present.
        let paths: Vec<&str> = dirs.iter().map(|d| d.path.as_str()).collect();
        assert!(paths.contains(&"/tmp/dir-a"));
        assert!(paths.contains(&"/tmp/dir-b"));
    }

    #[tokio::test]
    async fn test_remove_scan_directory() {
        let pool = setup_test_db().await;
        add_scan_directory(&pool, "/tmp/removable", None)
            .await
            .unwrap();
        remove_scan_directory(&pool, "/tmp/removable")
            .await
            .unwrap();

        let dirs = get_scan_directories(&pool).await.unwrap();
        // Built-in dirs remain; only the custom one is removed.
        let builtin_count = expected_builtin_scan_dir_count();
        assert_eq!(dirs.len(), builtin_count);
        assert!(!dirs.iter().any(|d| d.path == "/tmp/removable"));
    }

    #[tokio::test]
    async fn test_cannot_remove_builtin_scan_directory() {
        let pool = setup_test_db().await;
        // Manually insert a builtin directory
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO scan_directories (path, is_active, is_builtin, added_at)
             VALUES ('/builtin/path', 1, 1, ?)",
        )
        .bind(&now)
        .execute(&pool)
        .await
        .unwrap();

        let result = remove_scan_directory(&pool, "/builtin/path").await;
        assert!(
            result.is_err(),
            "Should not remove a builtin scan directory"
        );
    }

    #[tokio::test]
    async fn test_remove_nonexistent_scan_directory_returns_error() {
        let pool = setup_test_db().await;
        let result = remove_scan_directory(&pool, "/nonexistent/path").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_toggle_scan_directory() {
        let pool = setup_test_db().await;
        add_scan_directory(&pool, "/tmp/toggle-dir", None)
            .await
            .unwrap();
        toggle_scan_directory(&pool, "/tmp/toggle-dir", false)
            .await
            .unwrap();

        let dirs = get_scan_directories(&pool).await.unwrap();
        let dir = dirs.iter().find(|d| d.path == "/tmp/toggle-dir").unwrap();
        assert!(!dir.is_active);
    }

    // ── Settings ──────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn test_set_and_get_setting() {
        let pool = setup_test_db().await;
        set_setting(&pool, "theme", "dark").await.unwrap();
        let value = get_setting(&pool, "theme").await.unwrap();
        assert_eq!(value.as_deref(), Some("dark"));
    }

    #[tokio::test]
    async fn test_get_missing_setting_returns_none() {
        let pool = setup_test_db().await;
        let value = get_setting(&pool, "nonexistent_key").await.unwrap();
        assert!(value.is_none());
    }

    #[tokio::test]
    async fn test_set_setting_upserts() {
        let pool = setup_test_db().await;
        set_setting(&pool, "lang", "en").await.unwrap();
        set_setting(&pool, "lang", "zh").await.unwrap();
        let value = get_setting(&pool, "lang").await.unwrap();
        assert_eq!(value.as_deref(), Some("zh"));
    }

    #[tokio::test]
    async fn test_multiple_settings() {
        let pool = setup_test_db().await;
        set_setting(&pool, "key1", "val1").await.unwrap();
        set_setting(&pool, "key2", "val2").await.unwrap();
        set_setting(&pool, "key3", "val3").await.unwrap();

        assert_eq!(
            get_setting(&pool, "key1").await.unwrap().as_deref(),
            Some("val1")
        );
        assert_eq!(
            get_setting(&pool, "key2").await.unwrap().as_deref(),
            Some("val2")
        );
        assert_eq!(
            get_setting(&pool, "key3").await.unwrap().as_deref(),
            Some("val3")
        );
    }

    // ── Migration: created_at ─────────────────────────────────────────────────

    #[tokio::test]
    async fn test_migration_adds_commands_to_agent_skill_observations() {
        let pool = SqlitePool::connect(":memory:")
            .await
            .expect("create in-memory SQLite pool");
        sqlx::query(
            "CREATE TABLE agent_skill_observations (
                row_id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                skill_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                file_path TEXT NOT NULL,
                dir_path TEXT NOT NULL,
                source_kind TEXT NOT NULL,
                source_root TEXT NOT NULL,
                link_type TEXT NOT NULL,
                symlink_target TEXT,
                is_read_only BOOLEAN NOT NULL DEFAULT 0,
                scanned_at TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("create legacy observations table");

        init_database(&pool)
            .await
            .expect("migrate observations table");

        let observation = AgentSkillObservation {
            row_id: "row-1".into(),
            agent_id: "claude-code".into(),
            skill_id: "skill-1".into(),
            name: "Skill One".into(),
            description: None,
            file_path: "/tmp/skill-1/SKILL.md".into(),
            dir_path: "/tmp/skill-1".into(),
            source_kind: "user".into(),
            source_root: "/tmp".into(),
            link_type: "copy".into(),
            symlink_target: None,
            is_read_only: false,
            scanned_at: Utc::now().to_rfc3339(),
            commands: Some("[\"run\"]".into()),
        };
        upsert_agent_skill_observation(&pool, &observation)
            .await
            .expect("persist migrated observation");

        let rows = get_agent_skill_observations(&pool, "claude-code")
            .await
            .expect("read migrated observation");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].commands.as_deref(), Some("[\"run\"]"));
    }

    /// Verifies that `init_database` adds the `created_at` column to an existing
    /// `skill_installations` table that was created with the old schema (before
    /// the column was introduced), and that existing rows are backfilled.
    #[tokio::test]
    async fn test_migration_adds_created_at_to_skill_installations() {
        // Create a fresh in-memory pool WITHOUT calling init_database first.
        let pool = SqlitePool::connect(":memory:")
            .await
            .expect("Failed to create in-memory SQLite pool");

        // Build the OLD skill_installations schema — no created_at column.
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS skill_installations (
                skill_id       TEXT NOT NULL,
                agent_id       TEXT NOT NULL,
                installed_path TEXT NOT NULL,
                link_type      TEXT NOT NULL,
                symlink_target TEXT,
                PRIMARY KEY (skill_id, agent_id)
            )",
        )
        .execute(&pool)
        .await
        .expect("Failed to create old skill_installations table");

        // Create the skills table so the FK-style relationship is consistent.
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS skills (
                id             TEXT PRIMARY KEY,
                name           TEXT NOT NULL,
                description    TEXT,
                file_path      TEXT NOT NULL,
                canonical_path TEXT,
                is_central     BOOLEAN NOT NULL DEFAULT 0,
                source         TEXT,
                content        TEXT,
                scanned_at     TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("Failed to create skills table");

        // Insert a skill row (needed before the installation row references it).
        sqlx::query(
            "INSERT INTO skills (id, name, file_path, is_central, scanned_at)
             VALUES ('legacy-skill', 'Legacy Skill', '/tmp/legacy-skill/SKILL.md', 0, '2024-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .expect("Failed to insert legacy skill");

        // Insert an installation row using the OLD schema (no created_at column).
        sqlx::query(
            "INSERT INTO skill_installations (skill_id, agent_id, installed_path, link_type)
             VALUES ('legacy-skill', 'claude-code', '/tmp/claude/legacy-skill', 'symlink')",
        )
        .execute(&pool)
        .await
        .expect("Failed to insert legacy skill_installations row");

        // Run init_database — should detect the missing created_at column and add it.
        init_database(&pool)
            .await
            .expect("init_database should succeed and apply the created_at migration");

        // Confirm the column now exists in PRAGMA table_info.
        let columns = sqlx::query("PRAGMA table_info(skill_installations)")
            .fetch_all(&pool)
            .await
            .expect("PRAGMA table_info should succeed");

        let has_created_at = columns.iter().any(|row| {
            row.try_get::<String, _>("name")
                .map(|name| name == "created_at")
                .unwrap_or(false)
        });
        assert!(
            has_created_at,
            "created_at column must exist in skill_installations after migration"
        );

        // Confirm that the pre-existing row has a non-empty created_at value
        // (backfilled by the DEFAULT (datetime('now')) expression).
        let row = sqlx::query(
            "SELECT created_at FROM skill_installations \
             WHERE skill_id = 'legacy-skill' AND agent_id = 'claude-code'",
        )
        .fetch_one(&pool)
        .await
        .expect("Pre-existing installation row should still be queryable after migration");

        let created_at: String = row
            .try_get("created_at")
            .expect("created_at should be readable from the pre-existing row");
        assert!(
            !created_at.is_empty(),
            "Pre-existing rows must have a non-empty created_at value after migration (got: '{}')",
            created_at
        );
    }

    /// Verifies that calling `init_database` on a fresh database (one that already
    /// includes created_at in the CREATE TABLE) does NOT trigger the ALTER TABLE
    /// migration path — i.e., the second `init_database` call is fully idempotent
    /// and does not fail.
    #[tokio::test]
    async fn test_migration_skipped_when_created_at_already_exists() {
        // setup_test_db calls init_database, which creates the table WITH created_at.
        let pool = setup_test_db().await;

        // A second call to init_database must succeed without error (idempotent).
        let result = init_database(&pool).await;
        assert!(
            result.is_ok(),
            "Second init_database should be idempotent when created_at already exists"
        );

        // Confirm created_at is still present and there's exactly one occurrence.
        let columns = sqlx::query("PRAGMA table_info(skill_installations)")
            .fetch_all(&pool)
            .await
            .unwrap();
        let created_at_count = columns
            .iter()
            .filter(|row| {
                row.try_get::<String, _>("name")
                    .map(|name| name == "created_at")
                    .unwrap_or(false)
            })
            .count();
        assert_eq!(
            created_at_count, 1,
            "created_at column should appear exactly once after repeated init"
        );
    }
}
