/// worktree.rs — Git Worktree 管理（沙箱隔离）
///
/// 对齐 OpenCode packages/opencode/src/worktree/index.ts:
///   - candidate(): 生成唯一 worktree 名 + 分支名
///   - setup(): git worktree add --no-checkout -b opencode/<name> <dir>
///   - boot(): git reset --hard 填充内容
///   - list(): git worktree list --porcelain → 解析输出
///   - remove(): git worktree remove --force <dir> + git branch -D <branch>

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

fn home_dir() -> PathBuf {
    dirs_next::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

// ─── 类型 ───

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub directory: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorktreeInput {
    pub name: String,
    /// 项目根目录（包含 .git）
    pub project_path: String,
    /// 是否创建 detached worktree（无分支）
    #[serde(default)]
    pub detached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoveWorktreeInput {
    pub directory: String,
    /// 项目根目录（用于 git worktree remove）
    pub project_path: String,
    /// 是否同时删除分支
    #[serde(default)]
    pub delete_branch: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListWorktreesInput {
    pub project_path: String,
}

// ─── 工具函数 ───

/// 运行 git 命令，返回 (exit_code, stdout, stderr)
fn run_git(args: &[&str], cwd: &Path) -> Result<(i32, String, String), String> {
    let output = Command::new("git")
        .args(&[
            "--no-optional-locks",
            "-c", "core.autocrlf=false",
            "-c", "core.fsmonitor=false",
        ])
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("git 命令执行失败: {e}"))?;

    let code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    Ok((code, stdout, stderr))
}

/// 生成 slug（简单版本：字母数字 + 连字符）
fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// 检测路径是否在 git worktree list 中
fn resolve_worktree_branch(project_path: &Path, directory: &Path) -> Result<Option<String>, String> {
    let (code, stdout, _) = run_git(&["worktree", "list", "--porcelain"], project_path)?;
    if code != 0 {
        return Ok(None);
    }

    let dir_str = directory.to_string_lossy().to_string();
    let mut found_branch: Option<String> = None;
    let mut in_entry = false;

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            in_entry = false;
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            let path = path.trim();
            in_entry = path == dir_str;
            if in_entry {
                found_branch = None; // reset for new entry
            }
            continue;
        }
        if in_entry {
            if let Some(branch) = line.strip_prefix("branch ") {
                found_branch = Some(branch.trim().to_string());
            }
        }
    }

    Ok(found_branch)
}

/// 生成唯一候选名（对齐 OpenCode candidate()）
fn generate_candidate(project_path: &Path, name: &str, detached: bool) -> Result<WorktreeInfo, String> {
    let slug = slugify(name);
    let root = home_dir();

    // ponytail: worktree 缓存目录 ~/.jiucaihezi/worktree/<project_hash>/
    let project_hash = format!("{:x}", md5::compute(project_path.to_string_lossy().as_bytes()));
    let worktree_root = root.join(".jiucaihezi").join("worktree").join(&project_hash);

    // 最多尝试 26 次
    let max_attempts = 26u32;

    for attempt in 0..max_attempts {
        let candidate_name = if attempt == 0 {
            slug.clone()
        } else {
            format!("{}-{}", slug, generate_short_slug())
        };

        let directory = worktree_root.join(&candidate_name);

        // 检查目录是否存在
        if directory.exists() {
            continue;
        }

        let branch = if detached {
            None
        } else {
            let branch_name = format!("opencode/{}", candidate_name);
            let ref_name = format!("refs/heads/{}", branch_name);

            // 检查分支是否已存在
            let (code, _, _) = run_git(
                &["show-ref", "--verify", "--quiet", &ref_name],
                project_path,
            ).unwrap_or((1, String::new(), String::new()));

            if code == 0 {
                continue; // 分支已存在，重试
            }

            Some(branch_name)
        };

        return Ok(WorktreeInfo {
            name: candidate_name,
            branch,
            directory: directory.to_string_lossy().to_string(),
        });
    }

    Err("无法生成唯一的 worktree 名称".into())
}

fn generate_short_slug() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    format!("{:x}", nanos)
}

// ─── 核心操作 ───

/// 创建 git worktree（对齐 OpenCode create()）
///   1. candidate() 生成信息
///   2. setup() → git worktree add --no-checkout -b <branch> <dir>
///   3. boot() → git reset --hard
pub fn create_worktree(input: CreateWorktreeInput) -> Result<WorktreeInfo, String> {
    let project_path = PathBuf::from(&input.project_path);
    if !project_path.join(".git").exists() {
        return Err("项目目录不是 git 仓库（缺少 .git）".into());
    }

    // 确保 worktree 根目录存在
    let root = home_dir();
    let project_hash = format!("{:x}", md5::compute(project_path.to_string_lossy().as_bytes()));
    let worktree_root = root.join(".jiucaihezi").join("worktree").join(&project_hash);
    std::fs::create_dir_all(&worktree_root)
        .map_err(|e| format!("无法创建 worktree 目录: {e}"))?;

    // 1. candidate
    let info = generate_candidate(&project_path, &input.name, input.detached)?;
    let worktree_dir = PathBuf::from(&info.directory);

    // 2. setup: git worktree add --no-checkout -b <branch> <dir>
    let setup_args: Vec<&str> = if let Some(ref branch) = info.branch {
        vec!["worktree", "add", "--no-checkout", "-b", branch, &info.directory]
    } else {
        vec!["worktree", "add", "--no-checkout", "--detach", &info.directory, "HEAD"]
    };

    let (code, _stdout, _stderr) = run_git(&setup_args, &project_path)?;
    if code != 0 {
        return Err(format!("git worktree add 失败: {}", _stderr.trim()));
    }

    // 3. boot: git reset --hard
    let (boot_code, _, boot_stderr) = run_git(&["reset", "--hard"], &worktree_dir)?;
    if boot_code != 0 {
        // 清理失败的 worktree
        let _ = run_git(&["worktree", "remove", "--force", &info.directory], &project_path);
        return Err(format!("git reset --hard 失败: {}", boot_stderr.trim()));
    }

    Ok(info)
}

/// 列出所有 worktree（对齐 OpenCode list()）
pub fn list_worktrees(input: ListWorktreesInput) -> Result<Vec<WorktreeInfo>, String> {
    let project_path = PathBuf::from(&input.project_path);
    if !project_path.join(".git").exists() {
        return Ok(vec![]);
    }

    let (code, stdout, stderr) = run_git(&["worktree", "list", "--porcelain"], &project_path)?;
    if code != 0 {
        return Err(format!("git worktree list 失败: {}", stderr.trim()));
    }

    // 解析 porcelain 格式
    let items = parse_worktree_list(&stdout);

    // 获取主 worktree 路径，跳过它
    let primary = std::fs::canonicalize(&project_path)
        .ok()
        .map(|p| p.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let result: Vec<WorktreeInfo> = items
        .into_iter()
        .filter_map(|(path, branch)| {
            let canonical = std::fs::canonicalize(&path)
                .ok()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or(path.clone());

            // 跳过主 worktree
            if canonical.to_lowercase() == primary {
                return None;
            }

            let name = Path::new(&canonical)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown".into());

            Some(WorktreeInfo {
                name,
                branch: branch.map(|b| b.replace("refs/heads/", "")),
                directory: canonical,
            })
        })
        .collect();

    Ok(result)
}

/// 解析 git worktree list --porcelain 输出（对齐 OpenCode parseWorktreeList()）
fn parse_worktree_list(text: &str) -> Vec<(String, Option<String>)> {
    let mut items: Vec<(String, Option<String>)> = Vec::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(path) = line.strip_prefix("worktree ") {
            items.push((path.trim().to_string(), None));
        } else if let Some(branch) = line.strip_prefix("branch ") {
            if let Some(last) = items.last_mut() {
                last.1 = Some(branch.trim().to_string());
            }
        }
    }

    items
}

/// 删除 worktree（对齐 OpenCode remove()）
pub fn remove_worktree(input: RemoveWorktreeInput) -> Result<bool, String> {
    let project_path = PathBuf::from(&input.project_path);
    let worktree_dir = PathBuf::from(&input.directory);

    if !project_path.join(".git").exists() {
        return Err("项目目录不是 git 仓库".into());
    }

    // 检查目录是否存在
    if !worktree_dir.exists() {
        // 目录不存在，检查 git worktree list
        let branch = resolve_worktree_branch(&project_path, &worktree_dir)?;
        if let Some(ref b) = branch {
            // prune + 删分支
            let _ = run_git(&["worktree", "prune"], &project_path);
            let _ = run_git(&["branch", "-D", &b.replace("refs/heads/", "")], &project_path);
        }
        return Ok(true);
    }

    // git worktree remove --force
    let (code, _stdout, _stderr) =
        run_git(&["worktree", "remove", "--force", &input.directory], &project_path)?;
    if code != 0 {
        // 可能目录不在 git worktree list 中，手动清理
        if worktree_dir.exists() {
            std::fs::remove_dir_all(&worktree_dir)
                .map_err(|e| format!("清理 worktree 目录失败: {e}"))?;
        }
        // prune
        let _ = run_git(&["worktree", "prune"], &project_path);
    }

    // 删除对应分支
    if input.delete_branch {
        let branch = resolve_worktree_branch(&project_path, &worktree_dir)?;
        if let Some(ref b) = branch {
            let name = b.replace("refs/heads/", "");
            let _ = run_git(&["branch", "-D", &name], &project_path);
        }
    }

    Ok(true)
}


// ─── 测试 ───

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slugify() {
        assert_eq!(slugify("Hello World"), "hello-world");
        assert_eq!(slugify("Feature/ABC 123"), "feature-abc-123");
        assert_eq!(slugify("测试中文"), "-");
    }

    #[test]
    fn test_parse_worktree_list() {
        let porcelain = "\
worktree /path/to/main
HEAD abcd1234
branch refs/heads/main

worktree /path/to/sandbox
HEAD efgh5678
branch refs/heads/opencode/feature-x
";
        let items = parse_worktree_list(porcelain);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].0, "/path/to/main");
        assert_eq!(items[0].1.as_deref(), Some("refs/heads/main"));
        assert_eq!(items[1].0, "/path/to/sandbox");
        assert_eq!(items[1].1.as_deref(), Some("refs/heads/opencode/feature-x"));
    }
}
