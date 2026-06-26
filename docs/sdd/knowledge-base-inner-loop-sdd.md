# 知识库内循环 — gongju 支线 SDD

> **日期**：2026-06-26
> **分支**：`gongju`（从 `main` 分出）
> **目标**：让写小说 / 剧本 / 律师案件等用户，不依赖 Obsidian.app，在韭菜盒子内完成"建库 → AI 写库 → 看/改库"的内循环，核心价值是**让大模型续写时不失忆**。
> **关联**：
>   - `docs/handover/bianji-editor-disk-file-bridge-handoff.md`（编辑区读盘，交接 bianji）
>   - `知识库备份/src/data/vaultTemplates.ts`（可复用模板）
>   - `public/skills/claude-obsidian/`（已装的 wiki skill 集）

---

## 0. 执行摘要

### 0.1 产品判断

韭菜盒子的知识库生态 = **claude-obsidian（AI 大脑/方法论） + 建库模板（精细目录骨架） + 编辑区（取代 Obsidian 看改文档） + 变更审查（看 AI 改了什么）**，四者闭合成内循环，**不需要安装 Obsidian.app**。

### 0.2 为什么是 Wiki 架构而不是按章节切

核心目标：**让大模型续写小说/剧本时不失忆**。

- 纯按章节存（654 个章节 md）= 大模型短期记忆，查"某角色都做过什么"要翻 654 个文件碰运气。
- 按实体（人物/道具/势力/时间线）交叉索引 + `CLAUDE.md` 架构说明 + `hot.md` 热缓存 = 大模型长期记忆。问"萧炎的性格/外貌/各章行为"→ 一个 `entities/萧炎.md` 全拿到 → 续写时性格、说话方式、穿着都能延续。

**结论：目录越精细，检索越准，续写越不崩。** 精细度由建库模板写死保证（确定性），不靠模型即兴发挥。

### 0.3 本支线范围（先小而透）

✅ 本期做：
1. 建库模板恢复 + 一键建库（APP 确定性创建精细目录 + `CLAUDE.md`）
2. 知识库指令库（输入框旁入口，一键填入 wiki 工作流指令）

⬜ 本期不做（依赖项 / 留后）：
- 编辑区读写磁盘 md → **交接 bianji 支线**（见交接文档）
- 磁盘 vault 完整文件树 → bianji 可选任务 C；本期用变更审查兜底
- "目录架构师"skill（为非标职业现场生成目录）→ v2

---

## 1. 现状基线

### 1.1 已具备

| 能力 | 位置 | 状态 |
|------|------|------|
| claude-obsidian wiki skill 集（14 子 skill） | `public/skills/claude-obsidian/skills/` | ✅ 已装，含 wiki/wiki-ingest/wiki-query/save 等 |
| novel-writing / manhua-script-agent skill | `public/skills/` | ✅ 已装 |
| 自动选 skill（不用 @） | OpenCode 引擎 | ✅ 实测有效 |
| vault 设为 project directory | 对话框上方文件夹选择器 | ✅ 用户点选即接通 OpenCode |
| 精细目录模板（律师/小说/漫剧） | `知识库备份/src/data/vaultTemplates.ts` | ⚠️ 备份中，未接入主程序 |
| 建库骨架生成纯函数 | `知识库备份/src/utils/vaultScaffold.ts` | ⚠️ 备份中，可复用 |
| hot.md 热缓存逻辑 | `知识库备份/src/utils/vaultHotCache.ts` | ⚠️ 备份中，可参考 |

### 1.2 关键约束（来自 CLAUDE.md）

- 旧知识库主产品面（VaultPickerBar/VaultWizard/BrainPanel/vaultStore/useBrain）**禁止复活**。
- 但 `vaultTemplates.ts` / `vaultScaffold.ts` 等**纯逻辑工具**可挑出复用（不带旧 UI，不算复活主产品面）。
- 媒体字节禁止进 SQLite；本支线只建磁盘文件夹 + md，天然合规。

---

## 2. 设计

### 2.1 模块一：一键建库

**入口**：建库能力放哪，需用户确认（见 §5 待定项）。候选：工具仓库新增「知识库模板」区，或对话区空白页加「建知识库」卡。

**数据**：从 `知识库备份/src/data/vaultTemplates.ts` 迁出 3 个模板到主程序 `src/data/vaultTemplates.ts`（律师/小说/漫剧），结构不变（`claudeMd` + `rawFolders` + `wikiFolders`）。

**创建方式（确定性，关键决策）**：
APP 用 Rust 文件命令直接在用户选定的 vault 目录创建，**不发指令让模型建**。理由：建固定目录 + 写固定 CLAUDE.md 是机械操作，APP 直接干 100% 无失误、瞬间完成、不耗 token。模型即兴建可能漏文件夹。

```
用户选模板（如"小说库"）
  → APP 读取该 vault 已选的磁盘路径（project directory）
  → Rust 命令批量创建：
       vault/CLAUDE.md            （模板的 claudeMd，写架构规则）
       vault/.raw/{rawFolders}    （草稿/对话记录/灵感）
       vault/wiki/{wikiFolders}   （角色/主角, 世界观/地理, 时间线 ...）
       vault/wiki/hot.md          （空热缓存占位）
       vault/wiki/index.md        （空总目录占位）
  → 完成提示："已建好『小说库』骨架，现在可以让 AI 往里写了"
```

**新增 Rust 命令**（`src-tauri/src/lib.rs`）：
```rust
#[tauri::command]
fn scaffold_vault(vault_root: String, folders: Vec<String>, files: Vec<(String, String)>) -> Result<(), String>
// 校验 vault_root 在合法 scope 内，mkdir -p 各 folder，写各 file
```

### 2.2 模块二：知识库指令库

**入口**：输入框旁一个「💡 知识库怎么用」小按钮（`src/components/chat/ChatPanel.vue` 输入区附近）。

**交互**：点开 → 弹出按场景分类的指令卡 → 点「填入」→ 指令文本（含 `[占位符]`）写进输入框 → 用户改占位符 → 发送。**不带 @**（实测自动选 skill 更优）。

**指令卡数据**（新建 `src/data/kbCommandPresets.ts`）：每条 = `{ icon, title, oneLineWhatItDoes, template }`。

**第一版指令（小说/剧本，措辞是核心资产，决定模型走不走 wiki 架构）**：

| icon | title | template（填入输入框的文本） |
|------|-------|------|
| 🏗️ | 完本小说 → Wiki 记忆体 | `把 [小说路径] 导入当前 vault：原文存进 .raw/，用 wiki 架构整理 —— 在 wiki/entities/ 给每个主要角色建一份档案（记录他在各章的出场、行为、性格、说话风格、外貌、关系变化），在 wiki/concepts/ 整理世界观和设定体系，建时间线，所有笔记用 [[双链]] 关联，最后生成 hot.md 热缓存。不要只按章节拆。` |
| ✍️ | 续写（不失忆） | `我要续写当前 vault 里的小说。先读 wiki/hot.md 和相关角色的 entities 档案，严格延续他们的性格、说话方式、外貌和已发生的事，从 [第几章/某情节] 接着写。写完更新对应角色档案和 hot.md。` |
| 🆕 | 从 0 开新书 | `我要写一本 [题材] 新小说。先用 wiki 架构建好骨架，从灵感和核心设定开始，每确定一个角色就在 entities/ 建档案，边写正文边同步更新知识库，保证后续不失忆。` |
| 🔍 | 从记忆体查询 | `从当前 vault 查：[某角色] 都做过什么、性格怎样、和谁有关系。只根据笔记回答，不要编。` |
| ⚖️ | 一致性体检 | `检查当前 vault 小说有没有前后矛盾：同一角色的外貌、性格、能力、关系在不同章节是否一致，列出所有冲突点。` |
| 🎬 | 写短剧/剧本 | `我要写 [题材] 短剧。用 wiki 架构建库：先定世界观和核心角色档案（动机、压力值、关系网），再生成分集大纲，每集写完更新角色状态。` |

**精髓**：每条都明写"用 wiki 架构""建 entities 角色档案""先读 hot.md 再写""写完更新档案"——把模型钉在 wiki 工作流，避免退化成按章节傻拆。

### 2.3 闭环依赖图

```
[模块一] 一键建库（本支线）
   → 磁盘 vault 有了精细骨架 + CLAUDE.md
[模块二] 指令库（本支线）
   → 用户一键填指令 → AI 按 wiki 架构写满 entities/时间线
[bianji] 编辑区读盘（交接）
   → 用户在编辑区开磁盘 md 看/改
[已有] 变更审查
   → 看 AI 改了什么，点文件跳编辑区（依赖 bianji 任务 A）
   = 内循环闭合，不需要 Obsidian.app
```

---

## 3. 实施 Phase

### Phase 1：一键建库
1. 迁 `vaultTemplates.ts`（3 模板）从备份到 `src/data/`。
2. 加 Rust `scaffold_vault` 命令 + capability scope。
3. 建库 UI 入口（位置见 §5 待定）+ 调用链。
4. 验证：选小说模板 → 磁盘 vault 出现完整目录树 + CLAUDE.md。

### Phase 2：指令库
1. 新建 `src/data/kbCommandPresets.ts`（6 条小说/剧本指令）。
2. ChatPanel 输入区加「💡 知识库怎么用」入口 + 弹层 + 「填入」逻辑。
3. 验证：点卡片 → 指令进输入框 → 改占位符 → 发送 → AI 按 wiki 架构建出 entities/。

### Phase 3（可选）：APP 端折叠输入框 Skill 选择器
- 实测自动选 skill 更优，桌面端可把 Skill 选择器收进小图标（默认"自动"），保留强制锁定兜底。Web 端不动。

---

## 4. 验收标准

1. 选"小说库"模板 → 用户选定的磁盘 vault 出现精细目录（角色/主角、世界观/地理、时间线...）+ 根目录 CLAUDE.md。
2. 点指令库「完本小说→Wiki」→ 指令填进输入框 → 改路径发送 → AI 真的在 `wiki/entities/` 建出按角色的档案（不是只按章节拆）。
3. 点「续写」指令 → AI 先读 hot.md 和角色档案，续写内容与前文角色设定一致。
4. 不复活旧 Vault 主产品面（不引入 vaultStore/BrainPanel/VaultWizard）。

---

## 5. 待定项（需用户拍板）

| # | 决策点 | 候选 | 倾向 |
|---|--------|------|------|
| 1 | 建库 UI 入口位置 | A. 工具仓库新增「知识库模板」区 / B. 对话空白页加「建知识库」卡 / C. 两者都有 | 待定 |
| 2 | 指令库入口形态 | 输入框旁「💡 知识库怎么用」小按钮 | 倾向此 |
| 3 | 第一版指令是否只做小说/剧本 | 是（律师等 v2 再加） | 倾向是 |

---

## 6. 验证命令

```bash
pnpm exec vue-tsc -b
pnpm exec vite build
pnpm run test:focused:run
cd src-tauri && cargo check   # 改了 scaffold_vault 时
```

---

## 7. 风险 & 边界

- **不复活旧知识库主链路**：只复用 `vaultTemplates.ts` / `vaultScaffold.ts` 纯逻辑，不碰 vaultStore/useBrain/BrainPanel/VaultWizard。
- **磁盘写入安全**：`scaffold_vault` 必须校验 vault_root 在合法 scope，禁止路径穿越。
- **内循环闭合依赖 bianji**：模块一二在本支线可独立完成并验证（建库 + AI 写库），但"在编辑区看/改"依赖 bianji 任务 A。本支线先用变更审查兜底。
- **指令措辞是产品核心资产**：§2.2 的 template 文案直接决定模型走不走 wiki 架构，需在真实小说上反复验证调优，比 UI 重要。
