use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::time::SystemTime;

/// 一条从 Harness 会话缓存中恢复出来的对话目录项。
///
/// 会话正文在 `deepseek-harness/workspaces/*/sessions/*/session.v4.jsonl.zstd`；
/// 这里只恢复前端目录需要的身份、标题和时间，不读取正文。
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredConversation {
    pub conversation_id: String,
    pub session_id: String,
    pub workspace_key: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

fn normalize_workspace(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_string()
}

fn same_workspace(left: &str, right: &str) -> bool {
    let left = normalize_workspace(left);
    let right = normalize_workspace(right);
    #[cfg(windows)]
    {
        left.eq_ignore_ascii_case(&right)
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn iso_from_system_time(time: SystemTime) -> String {
    DateTime::<Utc>::from(time).to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn title_from(value: &serde_json::Value) -> String {
    let raw = value
        .pointer("/record/rows/title/val")
        .and_then(|item| item.as_str())
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            value
                .pointer("/record/rows/titleInput/val/first/text")
                .and_then(|item| item.as_str())
        })
        .unwrap_or("");
    let first_line = raw.lines().next().unwrap_or("").trim();
    if first_line.is_empty() {
        "未命名对话".to_string()
    } else {
        first_line.chars().take(80).collect()
    }
}

fn scan_workspace_catalog(root: &Path, owner: &str) -> Vec<RecoveredConversation> {
    let mut entries = Vec::new();
    let Ok(workspaces) = fs::read_dir(root) else {
        return entries;
    };
    for workspace in workspaces.flatten() {
        let sessions = workspace
            .path()
            .join("storages")
            .join("session_projcache")
            .join("sessions");
        let Ok(files) = fs::read_dir(sessions) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
                continue;
            }
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
                continue;
            };
            let Some(cwd) = value
                .pointer("/record/identity/cwd")
                .and_then(|item| item.as_str())
            else {
                continue;
            };
            if !same_workspace(cwd, owner) {
                continue;
            }
            let Some(session_id) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            let conversation_id = session_id.strip_prefix("jc-v1-").unwrap_or(session_id);
            let created_at = value
                .pointer("/record/identity/createdAt")
                .and_then(|item| item.as_u64())
                .and_then(|millis| DateTime::<Utc>::from_timestamp_millis(millis as i64))
                .map(|time| time.to_rfc3339_opts(SecondsFormat::Millis, true))
                .unwrap_or_else(|| {
                    fs::metadata(&path)
                        .and_then(|metadata| metadata.modified())
                        .map(iso_from_system_time)
                        .unwrap_or_else(|_| Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true))
                });
            let updated_at = fs::metadata(&path)
                .and_then(|metadata| metadata.modified())
                .map(iso_from_system_time)
                .unwrap_or_else(|_| created_at.clone());
            entries.push(RecoveredConversation {
                conversation_id: conversation_id.to_string(),
                session_id: session_id.to_string(),
                workspace_key: owner.to_string(),
                title: title_from(&value),
                created_at,
                updated_at,
            });
        }
    }
    let mut seen = HashSet::new();
    entries.retain(|entry| seen.insert(entry.conversation_id.clone()));
    entries.sort_by(|left, right| left.updated_at.cmp(&right.updated_at));
    entries
}

/// 从 Harness 会话缓存重建某个项目的对话目录。
///
/// 目录原本只存在 WebView2 的 localStorage；清缓存、重置 WebView2 配置或升级异常时
/// 列表会消失，但会话正文和这份 `session_projcache` 元数据仍在。前端在目录为空时调用。
#[tauri::command]
pub fn recover_harness_conversation_catalog(
    app: tauri::AppHandle,
    owner: String,
) -> Result<Vec<RecoveredConversation>, String> {
    use tauri::Manager;
    if owner.trim().is_empty() {
        return Ok(Vec::new());
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法读取应用数据目录: {error}"))?
        .join("deepseek-harness")
        .join("workspaces");
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    Ok(scan_workspace_catalog(&root, &owner))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_session(root: &Path, session_id: &str, cwd: &str, title: &str) {
        let sessions = root
            .join("workspace-a")
            .join("storages")
            .join("session_projcache")
            .join("sessions");
        fs::create_dir_all(&sessions).unwrap();
        let value = serde_json::json!({
            "record": {
                "identity": { "cwd": cwd, "createdAt": 1792320888702u64 },
                "rows": { "title": { "val": title } }
            }
        });
        fs::write(sessions.join(format!("{session_id}.json")), value.to_string()).unwrap();
    }

    #[test]
    fn recovers_sessions_for_matching_workspace_with_forward_or_back_slashes() {
        let dir = tempfile::tempdir().unwrap();
        write_session(dir.path(), "jc-v1-conversation-a", "D:\\1018笔记", "查看史记");
        let entries = scan_workspace_catalog(dir.path(), "D:/1018笔记");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].conversation_id, "conversation-a");
        assert_eq!(entries[0].session_id, "jc-v1-conversation-a");
        assert_eq!(entries[0].workspace_key, "D:/1018笔记");
        assert_eq!(entries[0].title, "查看史记");
    }

    #[test]
    fn ignores_other_workspaces_and_duplicate_session_files() {
        let dir = tempfile::tempdir().unwrap();
        write_session(dir.path(), "jc-v1-conversation-a", "D:\\1018笔记", "A");
        write_session(dir.path(), "jc-v1-conversation-b", "D:\\other", "B");
        let entries = scan_workspace_catalog(dir.path(), "D:\\1018笔记");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].conversation_id, "conversation-a");
    }

    #[test]
    fn title_falls_back_to_first_input_line_then_unnamed() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = dir
            .path()
            .join("workspace-a")
            .join("storages")
            .join("session_projcache")
            .join("sessions");
        fs::create_dir_all(&sessions).unwrap();
        fs::write(
            sessions.join("jc-v1-conversation-input.json"),
            serde_json::json!({
                "record": {
                    "identity": { "cwd": "D:\\p" },
                    "rows": { "titleInput": { "val": { "first": { "text": "第一行\n第二行" } } } }
                }
            })
            .to_string(),
        )
        .unwrap();
        let entries = scan_workspace_catalog(dir.path(), "D:\\p");
        assert_eq!(entries[0].title, "第一行");

        fs::write(
            sessions.join("jc-v1-conversation-empty.json"),
            serde_json::json!({
                "record": { "identity": { "cwd": "D:\\p" }, "rows": {} }
            })
            .to_string(),
        )
        .unwrap();
        let entries = scan_workspace_catalog(dir.path(), "D:\\p");
        assert!(entries.iter().any(|entry| entry.conversation_id == "conversation-empty" && entry.title == "未命名对话"));
    }
}
