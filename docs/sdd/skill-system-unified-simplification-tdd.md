# Skill 系统统一简化 — 技术设计文档 (TDD)

> 状态：草稿，待评审
> 日期：2026-06-30
> 分支：manjucuangzuo

---

## 1. 问题陈述

### 1.1 当前架构：三套并行机制

```
┌─────────────────────────────────────────────────────────────┐
│                    当前 Skill 系统（混乱）                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ① agentStore.ts SKILL_PRESETS 硬编码（~300行）              │
│     ├─ 40+ 个 preset 对象，id/name/desc/triggers/skillContent│
│     ├─ skill:// 协议 → resolveSkillUriContent()              │
│     │   ├─ 优先查内存（loadSkills + getPresetSkills）        │
│     │   └─ fallback: fetch('/skills/{name}/SKILL.md')        │
│     └─ → 模型选择器（SkillPickerBar）                        │
│                                                             │
│  ② ~/.agents/skills/ 文件系统扫描                            │
│     ├─ scan_all_skills → Rust scanner → SQLite               │
│     ├─ 递归扫描（含 jiucaihezi-builtin/ 子目录）              │
│     ├─ seed_preset_skills 启动时软链（不可靠）                │
│     └─ → Skill 仓库 UI（SkillsPanel）                        │
│                                                             │
│  ③ jiucaihezi-builtin/ 子目录（15个Anthropic官方skill）       │
│     ├─ 不在 public/skills/ 中                                │
│     ├─ 只有扫描器递归能摸到                                   │
│     └─ HTTP fallback 加载失败                                 │
│                                                             │
│  + skillCommands.json（200+行，独立维护指令数据）              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 具体症状

| 症状 | 根因 |
|------|------|
| JC-meitichuangzuo 模型选择器能看到，Skill 仓库搜不到 | seed_preset_skills 初始化 timing 问题，①有 ②没有 |
| 新增内置 skill 需改 3 处 | agentStore.ts + skillCommands.json + public/skills/ |
| 15 个 Anthropic skill HTTP fallback 404 | 在 builtin/ 子目录不在 public/skills/ |
| runninghub skill 仓库有但选择器没有 | 文件系统有但 SKILL_PRESETS 漏注册 |
| 软链在 Windows 不工作 | seed_preset_skills fallback copy，但路径解析脆弱 |
| 指令和 SKILL.md 内容重复维护 | skillCommands.json 独立于 SKILL.md |

### 1.3 核心矛盾

**三套数据源，两套 UI，零统一。** 模型选择器和 Skill 仓库读的是不同来源，一致性靠人工维护。

---

## 2. 设计目标（审计修正版）

### 2.1 原则

```
大道至简：
  一个目录    = 唯一真相来源（~/.agents/skills/，扁平）
  一份列表    = 模型选择器 + Skill 仓库共享（scan_all_skills 一次产出）
  一个文件    = SKILL.md 承载全部元数据（含指令）
  一次扫描    = 刷新所有视图

  不做的：
  - 不扫描其他工具的 skill 目录（~/.claude/skills/ 等）
  - 不做跨工具 skill 共享（用户手动复制，后期可加"导入"功能）
  - 不做 skill 版本管理/自动更新
```

### 2.2 修正项（来自 §10 + §11 审计）

| 修正 | 原设计 | 修正后 |
|------|--------|--------|
| source 字段 | 从 SKILL.md frontmatter 读 | **存 DB**，种子/导入时写入，scanner 不覆盖 |
| skill:// 协议 | 直接删除 | **分阶段退役**：Phase 3 改造 5 个消费者后删 |
| 种子策略 | 目标存在→跳过 | **symlink→替换，directory→保留**；**原子 rename** |
| manifest.json | 新增维护 | **删除**，用目录扫描（有 SKILL.md 就播种） |
| Web 端 | /api/skills 端点 | **静态 index.json**（build 生成）+ 按需 fetch SKILL.md |
| 指令格式 | `- 标签：\`cmd\`` | **```commands 代码块**（解析更可靠） |
| frontmatter 失败 | 静默跳过 skill | **降级**用目录名兜底 + 打印 warning |
| 种子扫描竞态 | 未考虑 | scan_all_skills **await seed** 完成后再扫描 |
| builtin/ 去重 | 未考虑 | Phase 4 迁移脚本去重 |

---

## 3. 目标架构（审计修正版）

```
┌─────────────────────────────────────────────────────────────┐
│                    目标 Skill 系统                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  唯一真相来源：~/.agents/skills/（扁平，一份 copy）           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ JC-meitichuangzuo/                                    │  │
│  │   ├── SKILL.md          ← 元数据 + 指令 + 正文         │  │
│  │   └── scripts/          ← jc_media.py                 │  │
│  │ JC-linmoxiaoshuo/                                     │  │
│  │   └── SKILL.md                                        │  │
│  │ brand-guidelines/                                     │  │
│  │   └── SKILL.md                                        │  │
│  │ my-custom-skill/         ← 用户自建                    │  │
│  │   └── SKILL.md                                        │  │
│  └───────────────────────────────────────────────────────┘  │
│         │                                                    │
│         │ scan_all_skills（先 await seed，再扫描）            │
│         ▼                                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              SQLite (skills 表)                        │  │
│  │  id, name, description, triggers[], skillContent,      │  │
│  │  source, commands[], dir_path, ...                     │  │
│  │                                                       │  │
│  │  source 字段由种子/导入时写入，scanner 只更新元数据     │  │
│  └───────────────────────────────────────────────────────┘  │
│         │                                                    │
│         ▼                                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              SkillConfig[]（前端统一接口）              │  │
│  └───────────────────────────────────────────────────────┘  │
│         │                                                    │
│         ├──→ SkillPickerBar（模型选择器，紧凑下拉）          │
│         └──→ CentralSkillsPanel（Skill 仓库，卡片视图）      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 数据流（修正版）

```
桌面端 — 每次 scan_all_skills：
  ① await seed_preset_skills(src_dir, ~/.agents/skills/)
     ├─ 扫描 src_dir 下所有含 SKILL.md 的子目录
     ├─ 目标不存在 → 原子 copy（tmp → rename）
     ├─ 目标是 symlink → 删除 → 原子 copy
     ├─ 目标是 directory → 跳过（用户数据不覆盖）
     └─ 写入 DB：source='builtin'
  ② scan_all_skills_impl()
     ├─ 扫描 ~/.agents/skills/（扁平，递归一层）
     ├─ 解析 SKILL.md YAML frontmatter → name, description, triggers
     ├─ 提取 ```commands 代码块 → commands[]
     ├─ 读取 SKILL.md 全文 → skillContent
     ├─ 不覆盖 DB 中已有的 source 字段
     └─ 返回 SkillConfig[]

前端 — refreshSkills()：
  → invoke('scan_all_skills') → SkillConfig[]
  → 模型选择器和 Skill 仓库消费同一份列表

Web 端：
  加载时 fetch('/skills/index.json') → 元数据列表
  选择具体 skill 时 fetch('/skills/{name}/SKILL.md') → 全文
  （index.json 由 build 脚本生成，无需后端）
```

### 3.2 SKILL.md 格式约定（修正版）

```markdown
---
name: 媒体创作引擎
description: 统一图片/视频/音频生成执行层
triggers:
  - 生成图片
  - 生成视频
  - jc_media
  - 媒体生成
---
# 注意：不包含 source 和 version 字段
# source 由 DB 管理（种子/导入时写入）
# version 不做（无自动更新机制）

# JC-meitichuangzuo — 媒体创作引擎

...正文...

## 指令

```commands
查询可用模型：jc_media.py list --type [image/video/audio]
生成图片：jc_media.py run --model [模型名] --prompt "[描述]"
图生图：jc_media.py run --model [模型名] --prompt "[描述]" --input-image "[图片路径]"
```
```

**关键约定**：
- YAML frontmatter：`name`（必填）、`description`（可选）、`triggers`（可选）
- `source` 和 `version` **不在** SKILL.md 中，由 DB 管理
- `## 指令` + ````commands` 代码块承载命令列表
- 每行格式：`标签：模板`（`：` 前是显示标签，后是粘贴到输入框的文本）
- frontmatter 解析失败 → 降级用目录名 + warning 日志，不跳过

---

## 4. 关键改动（审计修正版）

### 4.1 删除项

| 文件/代码 | 说明 |
|-----------|------|
| `agentStore.ts` 中的 `SKILL_PRESETS` 数组（~300行） | Phase 3 删除 |
| `agentStore.ts` 中的 `getPresetSkills()` | Phase 3 删除 |
| `agentStore.ts` 中的 `resolveSkillUriContent()` 的 `skill://` 分支 | Phase 3 改造 5 个消费者后删 |
| `src/data/skillCommands.json` | Phase 3 删除，指令从 SKILL.md 解析 |
| `~/.agents/skills/jiucaihezi-builtin/` | Phase 4 迁移脚本去重后删除 |
| `public/skills/claude-obsidian/` | Phase 1 删除（空壳，无 SKILL.md） |
| `public/skills/manifest.json` | **不做**——用目录扫描代替 |

### 4.2 修改项

| 文件 | 改动 |
|------|------|
| `src-tauri/src/skills/db.rs` — `seed_preset_skills` | 重写：目录扫描 + symlink→替换 + 原子 rename + 写 DB source |
| `src-tauri/src/skills/scanner.rs` — `parse_skill_md` | 扩展：读 triggers；返回降级值而非 None |
| `src-tauri/src/skills/scanner.rs` — 新增 `parse_commands` | 提取 ````commands` 代码块 |
| `src-tauri/src/skills/scanner.rs` — `scan_all_skills` | 入口 await seed 完成后再扫描 |
| `src-tauri/src/skills/db.rs` — Skill struct | 新增 `commands: Vec<String>`；`source` 不覆盖 |
| `src-tauri/src/skills/db.rs` — migration | ALTER TABLE 加 commands 列 |
| `src/stores/agentStore.ts` | Phase 3：删 SKILL_PRESETS + getPresetSkills；resolveSkillUriContent 简化 |
| `src/stores/skillsManageStore.ts` | 指令从 skill.commands 取 |
| `src/components/skills/shared/SkillCard.vue` | 指令按钮数据源改为 skill.commands |
| `src/components/chat/SkillPickerBar.vue` | 数据源从 getPresetSkills → loadSkills |
| `src/composables/useChat.ts` | 删 skill:// resolve 分支（已有 skillContent） |
| `src/composables/chatCloud.ts` | 同上 |
| `src/components/chat/ChatPanel.vue` | 同上 |
| `src/runtime/connection/skillConnectionAdapter.ts` | isSkillUri → 改检查 skillContent |
| `src/utils/agentRuntime.ts` | isSkillContentResolved 简化 |
| 所有 SKILL.md | Phase 1：加 YAML frontmatter + ````commands` 块 |
| 15 个 Anthropic skill | Phase 1：从 builtin/ 复制到 public/skills/ |
| `scripts/build-skills-index.mjs` | **新增**：build 时生成 public/skills/index.json |

### 4.3 Rust 侧改动详情

#### 4.3.1 `seed_preset_skills` 重写（原子 + 去 symlink）

```rust
/// 每次 scan 前调用。将 public/skills/ 下的内置 skill 同步到 ~/.agents/skills/
/// - 目标不存在 → 原子 copy（tmp dir → rename）
/// - 目标是 symlink → 删除 → 原子 copy
/// - 目标是 directory → 跳过（用户可能改过，保留用户版本）
/// - 写入 DB：source = 'builtin'（仅新创建的 skill）
pub async fn seed_preset_skills(pool: &DbPool, src_dir: &Path) -> Result<(), String> {
    let target_dir = resolve_home_dir().join(".agents").join("skills");
    std::fs::create_dir_all(&target_dir)?;

    // 扫描源目录下所有含 SKILL.md 的子目录（不需要 manifest.json）
    for entry in std::fs::read_dir(src_dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() { continue; }
        let src = entry.path();
        if !src.join("SKILL.md").exists() { continue; }

        let name = src.file_name().unwrap();
        let dst = target_dir.join(name);

        if dst.exists() {
            let meta = std::fs::symlink_metadata(&dst)?;
            if meta.file_type().is_symlink() {
                std::fs::remove_file(&dst)?; // 旧软链 → 删除
            } else {
                continue; // 实体目录 → 保留用户版本
            }
        }

        // 原子写入：先写临时目录，再 rename
        let tmp = target_dir.join(format!(".tmp_{}", name.to_string_lossy()));
        if tmp.exists() { std::fs::remove_dir_all(&tmp)?; }
        copy_dir_recursive(&src, &tmp)?;
        std::fs::rename(&tmp, &dst)?;

        // 写入 DB（source='builtin'）
        insert_builtin_skill(pool, &dst).await?;
    }
    Ok(())
}
```

#### 4.3.2 `parse_skill_md` 扩展（降级 + triggers）

```rust
struct SkillFrontmatter {
    name: String,           // 必填，解析失败降级为目录名
    description: Option<String>,
    triggers: Vec<String>,
}

fn parse_skill_md(path: &Path, fallback_name: &str) -> SkillFrontmatter {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return SkillFrontmatter {
            name: fallback_name.to_string(),
            description: None,
            triggers: vec![],
        },
    };

    // YAML frontmatter 解析
    let yaml = extract_frontmatter(&content);
    match yaml {
        Some(y) => SkillFrontmatter {
            name: y.get("name").and_then(|v| v.as_str()).map(String::from)
                .unwrap_or_else(|| fallback_name.to_string()),
            description: y.get("description").and_then(|v| v.as_str()).map(String::from),
            triggers: y.get("triggers")
                .and_then(|v| v.as_sequence())
                .map(|seq| seq.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
        },
        None => {
            eprintln!("[JC] warning: {} YAML frontmatter 解析失败，降级使用目录名", path.display());
            SkillFrontmatter {
                name: fallback_name.to_string(),
                description: None,
                triggers: vec![],
            }
        }
    }
}
```

#### 4.3.3 `parse_commands` 新增

```rust
/// 从 SKILL.md 提取 ```commands 代码块中的指令列表
/// 格式：每行 "标签：模板"
fn parse_commands(content: &str) -> Vec<String> {
    // 查找 "## 指令" 或 "## 命令" section
    // 在其后查找 ```commands 代码块
    // 提取每行内容（跳过空行和注释行）
    let section_start = content.find("## 指令")
        .or_else(|| content.find("## 命令"))?;

    let after_section = &content[section_start..];
    let fence_start = after_section.find("```commands")?;
    let after_fence = &after_section[fence_start + "```commands".len()..];
    let fence_end = after_fence.find("\n```")?;

    let commands_block = &after_fence[..fence_end];
    commands_block.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#') && !l.starts_with("//"))
        .map(String::from)
        .collect()
}
```

#### 4.3.4 `scan_all_skills` 串行化

```rust
#[tauri::command]
pub async fn scan_all_skills(state: State<'_, SkillsAppState>) -> Result<ScanResult, String> {
    // ① 先播种（确保内置 skill 已就位）
    if let Some(ref src) = state.preset_skills_src {
        db::seed_preset_skills(&state.db, src).await?;
    }
    // ② 再扫描
    scan_all_skills_impl(&state.db).await
}
```

### 4.4 前端改动详情

#### 4.4.1 `agentStore.ts`（Phase 3）

```typescript
// 删除：
// - SKILL_PRESETS 数组（~300 行）
// - getPresetSkills()
// - resolveSkillUriContent() 中的 skill:// 前缀检测和 HTTP fallback

// 改为：
function getBuiltInSkills(): SkillConfig[] {
  return loadSkills().filter(s => s.source === 'builtin')
}

// resolveSkillUriContent 简化：skillContent 已是全文，直接返回
async function resolveSkillUriContent(rawContent: string): Promise<string> {
  return String(rawContent || '').trim()
}
```

#### 4.4.2 指令按钮

```typescript
// SkillCard.vue — 数据源从 skill.commands 取
const commands = computed(() => skill.value.commands ?? [])

// 指令格式（从 scanner 解析结果）：
// ["查询可用模型：jc_media.py list --type [image/video/audio]", ...]
// 前端按 "：" 分割为 [标签, 模板]
```

#### 4.4.3 `skill://` 消费者改造

```typescript
// agentRuntime.ts
export function isSkillContentResolved(skill: SkillConfig | null | undefined): boolean {
  return !!skill?.skillContent?.trim()  // 不再检查 startsWith('skill://')
}

// skillConnectionAdapter.ts
export function isSkillUri(value: string): boolean {
  return false  // 新架构不再有 skill:// URI
}

// useChat.ts / chatCloud.ts / ChatPanel.vue
// 删除 if (content.startsWith('skill://')) { content = await resolve... } 分支
```

### 4.5 Web 端

```typescript
// build 时生成 public/skills/index.json
// 内容：从 public/skills/*/SKILL.md 提取 frontmatter 元数据
[
  {
    "id": "JC-meitichuangzuo",
    "name": "媒体创作引擎",
    "description": "统一图片/视频/音频生成执行层",
    "triggers": ["生成图片", "生成视频", "jc_media"],
    "commands": ["查询可用模型：jc_media.py list --type [image/video/audio]", ...]
  },
  ...
]

// Web 端 agentStore.ts
async function refreshSkills() {
  if (!isTauriRuntime()) {
    const res = await fetch('/skills/index.json')
    const list = await res.json()
    // 列表不含 skillContent；选择 skill 时再 fetch SKILL.md 全文
    centralSkillCache.value = list
    return list
  }
  // 桌面端走 Rust
}

// 加载单个 skill 全文（已有逻辑，保留）
async function loadSkillContent(name: string): Promise<string> {
  const res = await fetch(`/skills/${name}/SKILL.md`)
  return res.ok ? res.text() : ''
}
```

---

## 5. 迁移计划（审计修正版）

### 5.1 Phase 1：数据准备（不改逻辑，只加数据）

1. **脚本**：`node scripts/add-skill-frontmatter.mjs`
   - 扫描 `public/skills/*/SKILL.md`
   - 检查是否已有 frontmatter
   - 没有则从 `agentStore.ts` preset + `skillCommands.json` 提取元数据
   - 生成 frontmatter 插入文件头部
   - dry-run 模式先预览
2. 为所有 SKILL.md 加 `## 指令` + ````commands` 块
3. 把 15 个 Anthropic skill 从 `jiucaihezi-builtin/` 复制到 `public/skills/`
4. 删除 `public/skills/claude-obsidian/`（空壳）
5. 新增 `scripts/build-skills-index.mjs`，加入 build pipeline

**验证**：`vue-tsc -b` + `cargo check` 零错误；现有功能不受影响。

### 5.2 Phase 2：后端改造（Rust + DB + 系统级扫描）

1. scanner：`parse_skill_md` 扩展读 triggers + 降级逻辑
2. scanner：新增 `parse_commands` 函数
3. `seed_preset_skills` 重写（原子 rename + symlink 检测）
4. `scan_all_skills` 串行化（await seed 完成）
5. Skill struct 加 `commands` + `tool` 字段，DB migration
6. `scan_all_skills_impl`：读全文 → skillContent（不再需要后续 HTTP fallback）
7. **注册外部 agent**：codex (`~/.codex/skills/`)、openclaw (`~/.openclaw/skills/`) 为只读扫描根
8. claude-code agent 已有，确认其扫描配置正确

**验证**：`cargo test`；扫描结果含 commands + skillContent + tool 标签；外部 skill 只读展示。

### 5.3 Phase 3：前端切换（删 preset + 统一数据源）

1. `agentStore.ts`：删 `SKILL_PRESETS` + `getPresetSkills`
2. `SkillPickerBar`：数据源从 getPresetSkills → loadSkills
3. `SkillCard`：指令按钮用 skill.commands
4. 删 `skillCommands.json`
5. 改造 5 个 `skill://` 消费者（§4.4.3）
6. 删 `resolveSkillUriContent` 的 HTTP fallback（桌面端不再需要）

**验证**：`vue-tsc -b` + `vite build`；模型选择器 = Skill 仓库列表一致。

### 5.4 Phase 4：清理（去重 + 打扫）

1. 迁移脚本：`builtin/` 中的 skill 如已在扁平层存在 → 删除旧副本
2. 删除空的 `jiucaihezi-builtin/` 目录
3. 删除旧软链（seed 已自动替换为 copy）
4. 更新 AGENTS.md（记录新架构）

**验证**：桌面端完整启动；`~/.agents/skills/` 扁平无子目录；无重复 skill。

---

## 6. 风险与回退

| 风险 | 缓解 |
|------|------|
| YAML frontmatter 解析失败 | fallback 到默认值；旧 SKILL.md 不影响扫描 |
| manifest.json 与实际目录不一致 | seed 时检查目录是否存在，不存在跳过并 warn |
| copy 大目录耗时长（如含 scripts/） | seed 异步执行不阻塞 UI；内置 skill scripts/ 都很小 |
| Web 端 `/api/skills` 需要后端支持 | Phase 1 不 blocker；Web 端可先用现有 HTTP fallback 过渡 |
| 已有用户的 `jiucaihezi-builtin/` 旧数据 | 扫描器先扫 `~/.agents/skills/` 扁平层，builtin/ 子目录里的旧数据会被标记为 stale 但不清除 |
| `skill://` 协议被其他代码引用 | grep 全量引用，逐个替换为直接读 skillContent 字段 |

**回退方案**：Phase 1 只加不删，随时可以停。Phase 3 删 SKILL_PRESETS 前打 tag。

---

## 7. 不做的

- ❌ 不引入 Skill 版本管理（manifest version 只是数据格式版本）
- ❌ 不做 Skill 依赖图（skill A 依赖 skill B）
- ❌ 不做在线 Skill 市场（当前 GitHub 导入够用）
- ❌ 不改 Skill 目录结构（保持 Anthropic 兼容：SKILL.md + scripts/ + references/ + assets/）
- ❌ 不自动更新内置 skill（用户文件系统里的 skill 归用户管）

---

## 8. 成功标准（修正版）

1. 模型选择器和 Skill 仓库搜到的 skill 列表**完全一致**（同一份 scan 结果）
2. 新增内置 skill **只需一步**：放 `public/skills/`（有 SKILL.md 即可，无需改任何代码）
3. 新增指令**只改 SKILL.md 的 ````commands` 块**，不需要改任何 JSON/TS 文件
4. 桌面端和 Web 端 skill 列表一致
5. **系统级管理**：Skill 仓库同时展示 Claude Code、Codex、OpenClaw 的 skill（只读 + 可导入）
6. 删除代码量 > 新增代码量（目标：净删 300+ 行）

---

## 9. 附录：当前 Skill 盘点

### 9.1 public/skills/（33 个，有 SKILL.md）

```
JC-jiyiyasuo, JC-linmoduanju, JC-linmoxiaoshuo, JC-manjuxiezuo,
JC-meitichuangzuo, JC-yizhixing,
banana-character-prompt, banana-grid-shot-prompt, banana-prop-prompt,
banana-scene-prompt, banana-storyboard-edit-prompt,
film-character-asset, film-engineering-book, film-prop-asset,
film-scene-asset, film-shot-design, film-type-analysis,
gpt-image-2-prompts, grok-video-prompt, ltx-video-action,
manhua-script-agent, mcp-builder, narrato-docu, narrato-short,
novel-writing, qwen-tts-voice-design, runninghub,
skill-builder, skill-creator, vault-architect,
veo-video-prompt, video-composer, voice-bound-shot-video
```

### 9.2 jiucaihezi-builtin/（15 个 Anthropic 官方，需迁移到 public/skills/）

```
algorithmic-art, brand-guidelines, canvas-design, claude-api,
doc-coauthoring, docx-office, frontend-design, internal-comms,
pdf-office, pptx-office, slack-gif-creator, theme-factory,
web-artifacts-builder, webapp-testing, xlsx-office
```

### 9.3 废弃/待清理

```
claude-obsidian — 无 SKILL.md，空壳目录
```

---

> **评审邀请**：请在看完后给出反馈——方向对不对、哪里需要改、哪些你没想清楚。先不写代码。

---

## 10. 审计发现（2026-06-30，manjucuangzuo 分支评审）

> 以下是对 §1-9 方案的逐条审计。每个发现标注严重度：🔴阻塞 / 🟡需修 / 🟢已覆盖。

---

### 10.1 🔴 `source` 字段：不能让用户 SKILL.md 决定自己是内置还是用户

**问题**：TDD §3.2 提议 source 从 YAML frontmatter 读取。但 SKILL.md 是用户可编辑的文件。用户（或 bug）可以把 `source: builtin` 改成 `source: user`，绕过内置 skill 的编辑保护。

**事实**：当前 scanner 已经解析 YAML frontmatter（`parse_skill_md`，只读 `name` + `description`），但不读 `source`。

**正确做法**：`source` 不从前端或 SKILL.md 推导，而是**数据库层面的属性**：
- 种子时写入 `source = 'builtin'`（记录在 SQLite skill 行）
- GitHub 导入时写 `source = 'github'`
- 用户手动创建时写 `source = 'user'`
- scanner 更新 name/description/commands 等元数据，但**不覆盖 source 字段**

---

### 10.2 🔴 `skill://` 协议：有 6 处消费者，不能直接删

**问题**：TDD §4.1 提议删 `skill://` 协议，但协议不仅是 preset 在用：

| 文件 | 用途 |
|------|------|
| `agentRuntime.ts:isSkillContentResolved()` | 判断 skill 是否已加载内容 |
| `skillConnectionAdapter.ts:isSkillUri()` | 判断值是否是 skill URI |
| `ChatPanel.vue:592` | 编辑 skill 前先 resolve `skill://` |
| `useChat.ts:460` | 同上 |
| `chatCloud.ts:134` | 同上 |

**正确做法**：不能直接删。Phase 3 需要同步改造这些调用点：
- `isSkillContentResolved`：如果所有 skill 扫描后直接有内容，简化为 `return !!skill?.skillContent`
- `isSkillUri`：不再需要，改为检查 `skillContent` 是否为空
- ChatPanel/useChat/chatCloud 中的 resolve 分支：不再需要

**时序依赖**：`scan_all_skills` 必须在用户选择 skill **之前**完成，否则 `skillContent` 为空。扫描是异步后台任务，需确保 UI 有降级状态（loading skeleton）。

---

### 10.3 🔴 内置 Skill 更新策略缺失

**问题**：TDD §4.3.2 种子逻辑"目标存在 → 跳过"。四种场景：

| 场景 | 目标状态 | 行为 | 问题 |
|------|----------|------|------|
| A. 首次安装 | 不存在 | copy | ✅ |
| B. 旧版种子创建的软链 | 存在（symlink） | 跳过 | 🔴 软链指向旧路径，APP更新后断裂 |
| C. 用户自建同名 skill | 存在（directory） | 跳过 | ✅ 用户版本保留 |
| D. 内置 skill 出新版 | 存在（旧版 copy） | 跳过 | 🔴 用户拿不到更新 |

**修正方案**（利用已有 `detect_link_type`）：

```rust
if dst.exists() {
    let meta = std::fs::symlink_metadata(&dst)?;
    if meta.file_type().is_symlink() {
        // 旧软链 → 删除 → copy 新版本（场景 B）
        std::fs::remove_file(&dst)?;
        copy_dir_recursive(&src, &dst)?;
    }
    // 实体目录 → 跳过（场景 C、D：用户数据，不覆盖）
    continue;
}
```

**场景 D 的处理**：内置 skill 只是"初始种子"。用户拿到后自己维护。APP 更新时在 release notes 提醒"内置 skill 有更新，删除 `~/.agents/skills/对应目录/` 即可重新获取"。符合大道至简——不做版本管理。

---

### 10.4 🟡 manifest.json：不必要的间接层

**问题**：TDD §4.3.1 提议用 manifest.json 控制播种列表。但当前 `seed_preset_skills` 已有 fallback：遍历源目录，所有含 `SKILL.md` 的子目录都播种。

| | manifest.json | 目录扫描（fallback） |
|---|---|---|
| 新增内置 skill | 放目录 + 更新 manifest | 放目录 |
| 排除某 skill | 从 manifest 删除 | 从 public/skills/ 移走 |
| 维护成本 | 多一个文件 | 零 |

**建议**：删掉 manifest.json，直接用目录扫描。真需要排除时在 SKILL.md frontmatter 加 `seed: false`。更简单。

---

### 10.5 🟡 Web 端：`/api/skills` 改静态 JSON

**问题**：TDD §4.5 提议 `GET /api/skills` 新端点，需 gateway worker 或新服务。

**更简单方案**：build 时生成静态 `public/skills/index.json`：

```
构建流程：
  node scripts/build-skills-index.mjs
    → 扫描 public/skills/*/
    → 读每个 SKILL.md 的 YAML frontmatter
    → 生成 public/skills/index.json
```

Web 端直接 `fetch('/skills/index.json')`。零后端改动。

---

### 10.6 🟡 `## 指令` Markdown 解析健壮性

**问题**：自由文本提取指令列表容易出现边界 case（代码块中的 `## 指令`、不同列表格式、多行命令）。

**建议**：用 fenced code block + language tag，比自由 Markdown 解析可靠：

```markdown
## 指令

```commands
查询可用模型：jc_media.py list --type [image/video/audio]
生成图片：jc_media.py run --model [模型名] --prompt "[描述]"
图生图：jc_media.py run --model [模型名] --prompt "[描述]" --input-image "[图片路径]"
```
```

解析规则：`## 指令` → 下一个 ````commands` 代码块 → 每行一条，`：` 前标签后模板。

---

### 10.7 🟢 scanner 已有 frontmatter 解析

**事实**：`parse_skill_md()` 已实现。扩展到读 `triggers` 只需加几行：

```rust
let triggers: Vec<String> = yaml.get("triggers")
    .and_then(|v| v.as_sequence())
    .map(|seq| seq.iter().filter_map(|v| v.as_str().map(String::from)).collect())
    .unwrap_or_default();
```

Rust 改动量比预估的少。

---

### 10.8 🟢 脚本文件 copy 正常

JC-meitichuangzuo 的 `scripts/jc_media.py` 在 copy 后路径变为 `~/.agents/skills/JC-meitichuangzuo/scripts/jc_media.py`，OpenCode 引用 skill 目录下相对路径不受影响。所有内置 skill scripts/ 总大小 < 100KB。

---

### 10.9 🟡 `claude-obsidian` 空壳

`public/skills/claude-obsidian/` 无 `SKILL.md`，scanner 和种子都会跳过。建议 Phase 1 删除或移到 `_archive/`。

---

### 10.10 🟢 旧软链兼容（已在 10.3 覆盖）

种子时 detect link type：symlink → 替换为 copy；directory → 保留。

---

### 审计总结

| # | 严重度 | 问题 | 修正方向 |
|---|:---:|------|----------|
| 10.1 | 🔴 | source 字段从 SKILL.md 读不安全 | source 存 DB，种子/导入时写入，scanner 不覆盖 |
| 10.2 | 🔴 | skill:// 有 6 处消费者 | Phase 3 同步改造所有调用点；扫描完成前 UI 降级 |
| 10.3 | 🔴 | 内置 skill 更新策略缺失 | 种子：旧软链→替换；旧目录→保留（用户数据不覆盖） |
| 10.4 | 🟡 | manifest.json 增加维护成本 | 删掉，用目录扫描 |
| 10.5 | 🟡 | `/api/skills` 需后端 | 改用 build 时生成静态 index.json |
| 10.6 | 🟡 | `## 指令` markdown 解析脆弱 | 改用 ```commands 代码块约定 |
| 10.7 | 🟢 | scanner 已有 frontmatter 解析 | 扩展读 triggers |
| 10.8 | 🟢 | copy 脚本文件正常 | 无需改动 |
| 10.9 | 🟡 | claude-obsidian 空壳 | Phase 1 删除 |
| 10.10 | 🟢 | 旧软链兼容 | 已合并到 10.3 |

---

## 12. Skill 管理能力边界（最终版 · 系统级管理器）

> 用户原意：系统级 skill 管理器。可以真正删除任何工具的 skill——删了 Claude Code 的 skill，Claude Code 就真的用不了。

### 12.1 来源清单（已验证路径）

| # | 工具 | 路径 | 状态 |
|---|------|------|:--:|
| 1 | 韭菜盒子 | `~/.agents/skills/` | ✅ 主目录，完全管理 |
| 2 | Claude Code | `~/.claude/skills/` | ✅ |
| 3 | Codex | `~/.codex/skills/` | ✅ |
| 4 | OpenClaw | `~/.openclaw/skills/` | ✅ |
| 5 | Gemini | `~/.gemini/skills/` | ✅ |
| 6 | Factory | `~/.factory/skills/` | ✅ |
| 7 | KiloCode | `~/.kilocode/skills/` | ✅ |
| 8 | Cline | `~/.cline/skills/` | ✅ |
| 9 | Kiro | `~/.kiro/skills/` | ✅ |
| 10 | Kode | `~/.kode/skills/` | ✅ |
| 11 | Junie | `~/.junie/skills/` | ✅ |
| 12 | CommandCode | `~/.commandcode/skills/` | ✅ |
| 13 | Grok (用户) | `~/.grok/skills/` | ✅ |
| 14 | Grok (内置) | `~/.grok/bundled/skills/` | ✅ |
| 15 | Hermes | `~/.hermes/skills/` | ⬜ 本机未安装，按标准路径预留 |

> 注：Gemini 另有 `~/.gemini/config/plugins/*/skills/` 插件 skill，暂不纳入（属于插件内部数据，不是用户管理的 skill）。Grok 有两个 skill 目录：`~/.grok/skills/`（用户安装）+ `~/.grok/bundled/skills/`（内置），分开扫描。

### 12.2 管理权限模型

```
韭菜盒子 (~/.agents/skills/):
  查看 ✅  编辑 ✅  删除 ✅  导入 ✅

外部工具 (~/.claude/skills/ 等):
  查看 ✅  编辑 ❌  删除 ✅  导入 ✅
  （编辑禁用：修改外部 SKILL.md 可能破坏该工具的兼容性）
  （删除允许：用户可以在韭菜盒子统一管理所有 skill，删了就没了）
```

### 12.3 去重策略

多个工具拥有相同 skill（如 cloudflare 同时出现在 Claude Code、Codex、OpenClaw、Gemini、Factory、KiloCode、Cline、Kiro、Kode、Junie、CommandCode — 11 个工具）：

```
列表展示（合并为一条）：
  cloudflare  Cloudflare 平台
  Claude Code, Codex, OpenClaw, Gemini +7 — 11 个工具

  点击展开 → 显示每个工具中的具体路径
  删除操作 → 选择删除哪个工具的副本（或一键全部删除）
```

去重 key：`skill_id`（目录名的小写）。同 id 合并为一条，展开查看各工具副本。

### 12.4 标签设计（纯文本，无 emoji）

```
Skill 卡片上的来源标签（GitHub label 风格，浅灰底 + 文字）：

  韭菜盒子  Claude Code  Codex  OpenClaw  Gemini
  Factory  KiloCode  Cline  Kiro  Kode  Junie
  CommandCode  Grok  Grok(内置)  Hermes
```

### 12.5 实现方案

scanner 已有 `scan_roots_for_agent` 多根架构。每个外部工具注册为一个 Agent（目录不存在则静默跳过）：

```rust
// DB 初始化时注册
register_agent("claude-code",     "~/.claude/skills/");
register_agent("codex",           "~/.codex/skills/");
register_agent("openclaw",        "~/.openclaw/skills/");
register_agent("gemini",          "~/.gemini/skills/");
register_agent("factory",         "~/.factory/skills/");
register_agent("kilocode",        "~/.kilocode/skills/");
register_agent("cline",           "~/.cline/skills/");
register_agent("kiro",            "~/.kiro/skills/");
register_agent("kode",            "~/.kode/skills/");
register_agent("junie",           "~/.junie/skills/");
register_agent("commandcode",     "~/.commandcode/skills/");
register_agent("grok",            "~/.grok/skills/");
register_agent("grok-bundled",    "~/.grok/bundled/skills/");
register_agent("hermes",          "~/.hermes/skills/");
```

核心扫描逻辑零改动。前端 SkillCard 加来源标签 + 删除确认弹窗。

### 12.6 删除操作的安全性

删除外部 skill 时弹确认框：

```
┌──────────────────────────────────────────┐
│  确认删除 Skill                          │
│                                          │
│  cloudflare — Claude Code                │
│  路径: ~/.claude/skills/cloudflare/      │
│                                          │
│  这将从 Claude Code 中永久移除此 Skill，   │
│  Claude Code 将无法再使用它。             │
│                                          │
│  [取消]            [确认删除]             │
└──────────────────────────────────────────┘
```

不搞软删除/回收站——大道至简，删就是删。用户是开发者，知道自己在做什么。

---

## 13. 最终修订清单（含系统级管理）

综合 §10、§11、§12 三轮审计 + 系统级管理扩展，TDD §2-§5 已更新。以下修正已融入设计：

| # | 来源 | 修正内容 |
|---|------|----------|
| 1 | §10.1 | source 存 DB，不从 SKILL.md 读 |
| 2 | §10.2 | skill:// 分阶段退役，Phase 3 改造 5 个消费者 |
| 3 | §10.3 | 种子：symlink→替换，directory→保留；原子 rename |
| 4 | §10.4 | 删 manifest.json，用目录扫描 |
| 5 | §10.5 | Web 用静态 index.json + 按需 fetch |
| 6 | §10.6 | 指令用 ```commands 代码块 |
| 7 | §11.3.1 | scan_all_skills await seed 完成 |
| 8 | §11.3.2 | Phase 4 迁移脚本去重 builtin/ |
| 9 | §11.3.3 | frontmatter 失败降级而非静默跳过 |
| 10 | §11.3.4 | Web index.json 元数据 + fetch SKILL.md 全文 |
| 11 | §11.3.5 | Phase 1 用脚本批量加 frontmatter |
| 12 | §12.4 | 脚本执行权限：种子后 chmod +x .py/.sh |
| 13 | §12 修正 | **系统级管理器**：扫描 15 个 Agent 工具的 skill 目录；外部 tool 可删除（不可编辑）；纯文本标签无 emoji；合并去重 |

---

> **状态**：TDD 审计完成，§2-§5 已重写融入所有修正。可以按 Phase 1 开始执行。

---

## 11. 三轮深度审计（2026-06-30）

### 11.1 Agent 生态互通性

#### 11.1.1 实测发现

本机三个 Agent 工具的 skill 存储：

| 工具 | 路径 | 格式 | 与我们的关系 |
|------|------|------|-------------|
| Claude Code | `~/.claude/skills/` | SKILL.md + YAML frontmatter | 格式 100% 兼容 |
| Codex | `~/.codex/skills/` | SKILL.md + YAML frontmatter | 格式 100% 兼容 |
| OpenClaw | `~/.openclaw/skills/` | SKILL.md + YAML frontmatter | 格式 100% 兼容 |
| **我们** | **`~/.agents/skills/`** | **SKILL.md + YAML frontmatter** | **Anthropic 标准路径** |

**关键发现**：
- 三个工具的 `cloudflare` skill 的 SKILL.md **MD5 完全一致**（`3670a358...`）
- 不是软链，是各自独立 copy（每个工具 ~8.7KB 磁盘占用 ×3）
- 我们用的 `~/.agents/skills/` 是 Anthropic 官方规范路径，比 Claude Code 的 `~/.claude/skills/` 更"标准"

#### 11.1.2 互通性结论

**✅ 我们的 SKILL.md 格式天然与 Claude Code / Codex / OpenClaw 兼容。**

不需要做任何格式转换。用户从 Claude Code 拿来的 skill 目录，直接放到 `~/.agents/skills/` 就能用。

**⚠️ 但当前不共享目录**：每个工具各自维护独立的 skill 副本。如果用户想在 Claude Code 和韭菜盒子用同一个 skill，需要手动复制两份。

**💡 机会**：可以在 Skill 仓库加「导入」功能——从 `~/.claude/skills/`、`~/.codex/skills/`、`~/.openclaw/skills/` 发现并导入 skill。这是 Phase 5+ 的事，不在本次范围。

**🟢 本次 TDD 不影响互通性**：扁平化 `~/.agents/skills/` 后，其他工具的标准 skill 目录可以直接放进去。格式没变。

---

### 11.2 UI 组件冗余审计

#### 11.2.1 当前 Skill 相关 UI 组件全景

```
输入框层：
  SkillPickerBar.vue          — 模型选择器（紧凑下拉）

Skill 仓库层：
  CentralSkillsPanel.vue       — Skill 仓库主面板（右栏）
  SkillsSettingsPanel.vue      — Skill 设置

详情/预览层（4 个弹窗/抽屉，功能高度重叠）：
  SkillPreviewDialog.vue       — Skill 详情预览弹窗
  PlatformSkillDrawer.vue      — 平台 Skill 侧边抽屉
  MarketplaceSkillDetailDrawer.vue — 市场 Skill 详情抽屉
  CentralBundleDetailDialog.vue — 中央 Skill 包详情弹窗

集合/市场层：
  CollectionsPanel.vue         — 集合浏览
  CollectionDetailDrawer.vue   — 集合详情
  CollectionInstallDialog.vue  — 集合安装
  MarketplacePanel.vue         — 市场浏览
  DiscoverPanel.vue            — 发现面板
  PlatformPanel.vue            — 平台面板

导入/安装层：
  GitHubRepoImportWizard.vue   — GitHub 导入向导
  InstallDialog.vue            — 安装确认弹窗
  AddDirectoryDialog.vue       — 添加目录弹窗
  SkillFileTreePanel.vue       — Skill 文件树

共享组件：
  SkillCard.vue                — Skill 卡片（仓库用）
  SkillFolderCard.vue          — Skill 文件夹卡片
  SkillMarkdownPreview.vue     — Markdown 预览
  SkillListModeToggle.vue      — 列表/网格切换
  PlatformIcon.vue / PlatformBadge.vue — 平台标识
```

#### 11.2.2 冗余诊断

| 冗余 | 问题 | 建议 |
|------|------|------|
| 🔴 4 个详情弹窗 | `SkillPreviewDialog`、`PlatformSkillDrawer`、`MarketplaceSkillDetailDrawer`、`CentralBundleDetailDialog` — 都是"展示 skill 详情"，功能 80% 重叠 | 合并为一个 `SkillDetailPanel`，通过 props 区分来源 |
| 🟡 `DiscoverPanel` vs `MarketplacePanel` vs `PlatformPanel` | 三个"发现/浏览"面板，边界模糊 | 合并为统一的 `SkillDiscoverPanel`，Tab 切换来源 |
| 🟡 `InstallDialog` vs `CollectionInstallDialog` | 安装确认逻辑相同，只是触发源不同 | 合并为一个 `SkillInstallDialog` |
| 🟢 `SkillPickerBar` vs `CentralSkillsPanel` | **功能不同**，一个选 skill 一个管理 skill。不算冗余 | 保留，但数据源统一 |
| 🟢 `SkillFileTreePanel` | 查看 skill 文件结构，有独立价值 | 保留 |

#### 11.2.3 精炼目标

```
当前：20 个组件 → 目标：14 个组件（合并 6 个）

SkillDetailPanel      ← SkillPreviewDialog + PlatformSkillDrawer
                         + MarketplaceSkillDetailDrawer + CentralBundleDetailDialog
SkillDiscoverPanel    ← DiscoverPanel + MarketplacePanel + PlatformPanel
SkillInstallDialog    ← InstallDialog + CollectionInstallDialog
```

> 注：组件合并不在本次 TDD 范围，但值得记录为后续优化项。

---

### 11.3 遗漏的 Bug / 边界场景

#### 11.3.1 🔴 种子与扫描的竞态条件

**场景**：APP 启动 → `seed_preset_skills` 异步执行（copy 文件）→ 用户立即打开 Skill 仓库 → `scan_all_skills` → 种子还没跑完 → 内置 skill 全部缺失。

**当前缓解**：TDD 已设计 `scan_all_skills` 入口先调 `seed_preset_skills`。但种子本身是 I/O 操作（copy 目录），可能耗时。如果用户快速打开仓库，扫描可能扫描到"正在复制中"的不完整目录。

**修正**：
1. 种子使用**先写临时目录 → 原子 rename** 的方式（避免扫描到半成品）
2. `scan_all_skills` 入口 await `seed_preset_skills` 完成（串行化）

```
seed_preset_skills:
  for each skill:
    tmp = ~/.agents/skills/.tmp_{name}/
    copy_dir_recursive(src, tmp)
    rename(tmp, dst)  // 原子操作，扫描不会看到半成品

scan_all_skills:
  await seed_preset_skills()  // 确保种子完成
  scan_all_skills_impl()
```

#### 11.3.2 🔴 旧 `jiucaihezi-builtin/` 导致重复 skill

**场景**：Phase 4 把 15 个 Anthropic skill 从 `builtin/` 复制到 `public/skills/` → 种子 copy 到 `~/.agents/skills/algorithmic-art/`。但用户机器上 `~/.agents/skills/jiucaihezi-builtin/algorithmic-art/` 还存在。scanner 递归扫描 → 同一个 skill 出现两次。

**修正**：Phase 4 迁移脚本需要：
1. 检查 `~/.agents/skills/jiucaihezi-builtin/` 中的每个 skill 是否已在扁平层存在
2. 如果已存在 → 删除 builtin/ 中的旧副本
3. 如果不存在 → 移到扁平层
4. 最后删除空的 `jiucaihezi-builtin/` 目录

或者更简单：`scan_all_skills` 中跳过 `jiucaihezi-builtin/` 子目录（在种子完成迁移后）。

#### 11.3.3 🟡 frontmatter 解析失败 → 静默跳过

**场景**：用户创建 SKILL.md 时 YAML frontmatter 格式错误（缺 `name` 字段、缩进不对、用了 Tab）。当前 `parse_skill_md` 返回 `None` → scanner 跳过该 skill → 用户在仓库里看不到，但不知道为什么。

**修正**：加降级逻辑——frontmatter 解析失败时，用目录名作为 name，记录 warning 日志：

```rust
let info = match parse_skill_md(&skill_md_path) {
    Some(i) => i,
    None => {
        eprintln!("[JC] warning: {} YAML frontmatter 解析失败，使用目录名作为 skill 名", entry_path.display());
        SkillInfo {
            name: entry_path.file_name().unwrap_or_default().to_string_lossy().into(),
            description: None,
        }
    }
};
```

#### 11.3.4 🟡 Web 端 `index.json` 不含 SKILL.md 全文

**场景**：TDD §10.5 提议 build 时生成 `index.json`（含 frontmatter 元数据）。但 Web 端加载 skill 内容时，还需要 SKILL.md 全文。`index.json` 只解决了"列表"问题，没解决"内容加载"问题。

**修正**：`index.json` 包含 skill 元数据列表。点击具体 skill 时，前端 fetch `/skills/{name}/SKILL.md` 获取全文（这是已有的 fallback 路径，保留它）。

```
index.json: [{ id, name, description, triggers, commands[] }]
详情加载:   fetch('/skills/{name}/SKILL.md') → 全文
```

不需要新后端端点。

#### 11.3.5 🟡 内置 skill 的 SKILL.md 缺少 frontmatter

**场景**：Phase 1 要求所有 SKILL.md 加 YAML frontmatter。但 33+15=48 个 skill，人工逐一加容易遗漏或格式错误。

**修正**：Phase 1 用脚本批量处理：
```bash
node scripts/add-skill-frontmatter.mjs
  → 扫描 public/skills/*/SKILL.md
  → 检查是否已有 frontmatter
  → 没有则从 skillCommands.json + agentStore.ts preset 提取元数据
  → 生成 frontmatter 插入文件头部
  → dry-run 模式先预览
```

#### 11.3.6 🟢 空 `~/.agents/skills/` 首次启动

**场景**：全新安装，`~/.agents/skills/` 为空。种子需要先 copy 内置 skill，扫描才能看到。

**当前设计已覆盖**：`scan_all_skills` 入口先调 `seed_preset_skills`。

#### 11.3.7 🟢 符号链接循环

**场景**：用户在 `~/.agents/skills/` 中创建了循环软链。

**当前设计已覆盖**：`scan_skill_root` 有 `max_depth: 4` 限制，不会无限递归。

#### 11.3.8 🟡 Skill 重名

**场景**：内置 skill `JC-meitichuangzuo` 和用户自建 `JC-meitichuangzuo` 同名。种子跳过（目录已存在）→ 用户版本保留。但如果用户删了自己的版本，下次种子会写入内置版本。

**当前行为合理**：用户版本优先。但如果用户想恢复内置版本，需要先删除再重启 APP（或手动触发重新播种）。

**建议**：Skill 仓库 UI 加「重置为内置版本」按钮（仅对 source=builtin 的 skill 显示）。

---

### 11.4 审计总结

| 类别 | 🔴 阻塞 | 🟡 需修 | 🟢 已覆盖/低风险 |
|------|:--:|:--:|:--:|
| §10 审计 | 3 | 3 | 0 |
| §11.1 生态互通 | 0 | 0 | 1 |
| §11.2 UI 冗余 | 0 | 0 | 0（不在本次范围） |
| §11.3 遗漏 bug | 2 | 4 | 2 |
| **合计** | **5** | **7** | **3** |

需要在 TDD 更新时纳入的修正：
1. 种子用原子 rename（防竞态）
2. `scan_all_skills` await `seed_preset_skills`（串行化）
3. 迁移时处理 `builtin/` 去重
4. frontmatter 解析失败降级
5. Web `index.json` + 按需 fetch SKILL.md
6. 批量脚本加 frontmatter
7. 种子策略：symlink→替换，directory→保留

---

## 14. 实现后并发审计（2026-06-30）

> 三份独立审计报告，详见 `docs/sdd/manjucuangzuo-concurrent-audit-2026-06-30.md`

### 14.1 当前完成度：52%

```
Phase 1 (数据准备):  ✅ 100%
Phase 2 (Rust后端):  ✅ 85%  (3个偏差待修)
Phase 3 (前端切换):  ❌ 15%  (仅删了SKILL_PRESETS，5个消费者未迁移)
Phase 4 (清理):      ⬜ 未验证
```

### 14.2 🔴 P0 阻塞项（3项，必须修）

| # | 问题 | 位置 | 修法 |
|---|------|------|------|
| **P0-1** | seed写`source='builtin'` → scan用`link_type`覆盖 → 内置skill从预设消失 | `db.rs` upsert_skill CASE | 加 `WHEN skills.source='builtin' THEN skills.source` 保护；或 seed 改用 `ON CONFLICT UPDATE source='builtin'` |
| **P0-2** | 5个 `skill://` 消费者全未迁移 | `useChat.ts`, `chatCloud.ts`, `ChatPanel.vue`, `agentRuntime.ts`, `skillConnectionAdapter.ts` | 按 TDD §4.4.3 逐个改造 |
| **P0-3** | SkillCard 仍读 `skillCommands.json` 而非 `skill.commands` | `SkillCard.vue` | 改数据源为 `skill.commands`，删 JSON import |

### 14.3 🟡 P1 重要项（5项，本次修）

| # | 问题 | 修法 |
|---|------|------|
| P1-1 | scan_all_skills 无并发锁 → 双重扫描互相覆盖 | 加 `AtomicBool` 守卫 |
| P1-2 | 种子崩溃后不完整目录永远不修复 | 加 `.seed_complete` 哨兵文件 |
| P1-3 | index.json commands 格式与 TDD 不一致 | 对齐 `标签：模板` 单行格式 |
| P1-4 | ~25 个死亡文件（旧面板、zombie常量） | 批量删除 |
| P1-5 | resolveSkillUriContent 3 处重复 | 提取到共享模块 |

### 14.4 🟢 P2 优化项（后续）

- 4→1 详情弹窗合并
- 旧 Vault 引用清理
- skillContent 加载路径统一

### 14.5 修正后的 Phase 计划

```
Phase 3a (P0 修复):  source保护 + skill://消费者 + SkillCard切换
Phase 3b (P1 修复):  并发锁 + 哨兵 + 格式对齐 + 死代码清理
Phase 4  (清理):     builtin去重 + 文档更新
```

---

> **状态**：TDD 已反映所有审计发现。§14 记录了当前实现差距和待修项。详见 `docs/sdd/manjucuangzuo-concurrent-audit-2026-06-30.md`。
