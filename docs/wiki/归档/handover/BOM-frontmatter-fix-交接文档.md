# BOM 导致 frontmatter 解析失败 — 修复提案

> **状态**: 待修复（代码尚未落地）
> **基线**: `main` 分支 commit 4445796

## 一、问题现象

Windows 用户打开 skill 仓库时，报错：

```
Skill 'JC-manju-daoju' is missing valid frontmatter.
```

## 二、根因分析

### 2.1 错误来源

错误由 `src-tauri/src/skills/github_import.rs:738-746` 触发，流程：

1. 从 GitHub 下载仓库压缩包（tarball）→ 解压为 `GitHubRepoSnapshot`
2. 遍历所有 `SKILL.md` 文件，调用 `parse_frontmatter()` 提取 frontmatter
3. 若返回 `None`，则报错 `"Skill '{}' is missing valid frontmatter."`

### 2.2 根本原因：UTF-8 BOM

Windows 部分编辑器（旧版记事本、某些配置的编辑器）会在 UTF-8 文件开头写入 **BOM**（`\u{FEFF}`，字节序列 `EF BB BF`）。

Rust 的 `str::trim()` **不会去除 BOM**（`char::is_whitespace()` 对 BOM 返回 false）。

原代码 `parse_frontmatter`：

```rust
fn parse_frontmatter(content: &str) -> Option<SkillFrontmatter> {
    let trimmed = content.trim();                  // ← BOM 不会被去除
    if !trimmed.starts_with("---") {               // ← 因 BOM 开头，返回 false
        return None;                               // ← 触发报错
    }
    ...
}
```

当 `SKILL.md` 内容为 `\u{FEFF}---\nname: ...\n---` 时：

- `trim()` → 内容仍是 `\u{FEFF}---\nname: ...\n---`
- `starts_with("---")` → `false`（开头是 `\u{FEFF}` 而非 `-`）
- 返回 `None` → 报错

### 2.3 影响范围

所有需要解析 SKILL.md frontmatter 的路径都会受 BOM 影响：

| 文件 | 函数 | 错误处理方式 |
|---|---|---|
| `github_import.rs:1392` | `parse_frontmatter` | ❌ 硬失败（报错） |
| `skills.rs:196` | `skill_md_frontmatter_name` | ❌ 硬失败（返回 Err） |
| `scanner.rs:124` | `parse_skill_md` | ⚠️ 优雅降级（使用目录名兜底，打印 warning） |

**受影响的场景：**
- 从 GitHub 导入 skill 仓库（`fetch_repo_skill_candidates`）
- 从本地文件系统加载 skill（`load_skill` / `skill_md_frontmatter_name`）
- 本地扫描 skill 目录（`scan_directory` / `parse_skill_md` — 仅 warning）

## 三、修改内容

共修改 3 个文件，均在解析前去除 BOM：

### 文件 1：`src-tauri/src/skills/github_import.rs:1393`

```rust
// 修改前
let trimmed = content.trim();

// 修改后
let trimmed = content.trim_start_matches('\u{FEFF}').trim();
```

### 文件 2：`src-tauri/src/skills/skills.rs:197`

```rust
// 修改前
let after_open = skill_md.strip_prefix("---\n")...

// 修改后
let skill_md = skill_md.trim_start_matches('\u{FEFF}');
let after_open = skill_md.strip_prefix("---\n")...
```

### 文件 3：`src-tauri/src/skills/scanner.rs:135`

```rust
// 修改前（`let content = std::fs::read_to_string(path).ok()?` 之后直接 strip_prefix）

// 修改后
let content = content.trim_start_matches('\u{FEFF}');
```

## 四、验证建议

在开发环境运行：

```bash
cd src-tauri
cargo test --package jiucaihezi-app --lib skills::github_import::tests -- --nocapture
cargo test --package jiucaihezi-app --lib skills::skills::tests -- --nocapture
cargo test --package jiucaihezi-app --lib skills::scanner::tests -- --nocapture
```

建议额外添加 BOM 相关测试用例（测试提议见下方）。

## 五、建议补充的测试用例

在 `github_import.rs` 的测试模块中建议增加：

```rust
#[test]
fn parse_frontmatter_handles_bom() {
    let content = format!("\u{FEFF}---\nname: bom-skill\ndescription: with BOM\n---\n# content\n");
    let parsed = parse_frontmatter(&content).expect("should parse with BOM");
    assert_eq!(parsed.name, "bom-skill");
    assert_eq!(parsed.description.as_deref(), Some("with BOM"));
}

#[test]
fn parse_frontmatter_handles_bom_with_crlf() {
    let content = format!("\u{FEFF}---\r\nname: bom-crlf\r\ndescription: BOM + CRLF\r\n---\r\n");
    let parsed = parse_frontmatter(&content).expect("should parse with BOM and CRLF");
    assert_eq!(parsed.name, "bom-crlf");
}
```

## 六、相关代码位置总览

| 路径 | 行号 | 说明 |
|---|---|---|
| `src-tauri/src/skills/github_import.rs` | 110-114 | `SkillFrontmatter` 结构体定义 |
| `src-tauri/src/skills/github_import.rs` | 718-747 | `build_repo_skill_candidates_from_snapshot`（报错处） |
| `src-tauri/src/skills/github_import.rs` | 1392-1400 | `parse_frontmatter` 函数（已修复） |
| `src-tauri/src/skills/skills.rs` | 196-213 | `skill_md_frontmatter_name` 函数（已修复） |
| `src-tauri/src/skills/scanner.rs` | 124-177 | `parse_skill_md` 函数（已修复） |
