# 编辑区 & 变更审查全线对齐 — bianji 支线 SDD

> **日期**: 2026-06-26
> **分支**: `bianji`（从 `main` 分出）
> **目标**: 
>   1. 编辑区 100% 复刻 Tiptap 官方全部能力
>   2. 变更审查 100% 对齐 OpenCode 官方（后端事件+前端UI）
>   3. 打通编辑区和变更审查：点击 diff 行 → 编辑区精准定位
> **参考**: `CLAUDE.md`、`AGENTS.md`、`ueberdosis/tiptap`、`opencode-ai/opencode`

---

## 0. 执行摘要

当前韭菜盒子 Studio 编辑区基于 Tiptap v3（已安装 30+ 扩展），变更审查基于 OpenCode SDK v1.17.9 的 `session.diff` / `vcs.diff` 端点。两者已具备基础能力，但与上游官方形态仍有差距。本支线目标是在不破坏现有架构的前提下，分三个 Phase 补齐差距，最终实现编辑区=官方 Tiptap 全能力、变更审查=官方 OpenCode 全体验、两者无缝联动。

**可行性结论：三个目标全部可行。** 理由：
1. Tiptap 已是 v3.23+，上游 API 稳定，缺失的 7 个扩展/能力都是官方已有 package
2. OpenCode `SnapshotFileDiff` / `VcsFileDiff` 类型定义完整，`session.diff` 事件链路已通
3. 编辑区已有 `open-in-editor` 事件总线，变更审查已有 `openDiffInEditor` 按钮——打通只需替换连接方式

---

## 1. 现状基线

### 1.1 Tiptap 编辑区现状

**已安装扩展（30 个）**：
```
@tiptap/core@3.23.4, starter-kit@3.23.2, vue-3@3.23.2, pm@3.23.4
extension-bubble-menu@3.24.0, extension-floating-menu@3.24.0
extension-character-count@3.23.2, extension-placeholder@3.23.2
extension-highlight@3.23.4, extension-typography@3.23.4
extension-underline@3.23.2, extension-text-align@3.24.0
extension-text-style@3.23.4, extension-color@3.23.4
extension-task-list@3.23.4, extension-task-item@3.23.4
extension-link@3.23.2, extension-image@3.23.2
extension-code-block-lowlight@3.24.0, extension-details@3.24.0
extension-table-of-contents@3.24.0, extension-unique-id@3.24.0
extension-file-handler@3.24.0, extension-drag-handle@3.24.0
extension-drag-handle-vue-3@3.24.0, extension-node-range@3.24.0
extension-mention@3.23.4, extension-suggestion@3.23.4
markdown@3.24.0, static-renderer@3.24.0
```

**已启用扩展（EditorPanel.vue 中）**：
StarterKit, Underline, Link, Image(resize), Placeholder, CharacterCount, Highlight(multicolor), Typography, TaskList, TaskItem(nested), TextStyle, Color, NodeRange, TextAlign, Details+Summary+Content, TableOfContents, CodeBlockLowlight, FileHandler, UniqueID, DragHandle(vue-3), 自定义 EditorTable/Cell/Header/Row, WikiLinkExtension, SlashCommands, Markdown

### 1.2 变更审查现状

**后端链路**：
- `sessionCommands.ts`: `listOpenCodeSessionDiff(client, {sessionID, messageID})` → `client.session.diff()` → `SnapshotFileDiff[]`
- `sessionCommands.ts`: `fetchOpenCodeVcsDiff(client, {directory, workspace, mode})` → `client.vcs.diff()` → `VcsFileDiff[]`
- `useChat.ts`: `turnDiffs` (per-message summary.diffs) + `sessionDiffs` (session-level) + `vcsDiffs` (git VCS)

**前端 UI**：
- `DiffReviewDock.vue`: 聊天区底部折叠 diff 摘要（文件数/+/-统计）
- `ReviewPanel.vue`: 右侧面板完整变更审查（本轮变更/Git变更双 Tab、文件列表+diff预览、状态色条、在编辑区打开按钮）
- `diffReview.ts`: 纯函数 patch 解析器（hunk/line 结构化）

**OpenCode 官方类型（已有 SDK 1.17.9）**：
```ts
// v1 (gen/types.gen.d.ts)
type FileDiff = { file: string; before: string; after: string; additions: number; deletions: number }
// UserMessage.summary.diffs: FileDiff[]
// Session.summary.diffs?: FileDiff[]
// session.diff event → { diff: FileDiff[] }

// v2 (v2/gen/types.gen.d.ts)  
type SnapshotFileDiff = { file?: string; patch?: string; additions: number; deletions: number; status?: "added"|"deleted"|"modified" }
// UserMessage.summary.diffs: SnapshotFileDiff[]
// session.diff event → { diff: SnapshotFileDiff[] }
type VcsFileDiff = { file: string; patch?: string; additions: number; deletions: number; status?: string; ... }
```

### 1.3 编辑区↔变更审查 当前桥接

```
ReviewPanel.openDiffInEditor(diff)
  → emitEvent('import-to-editor', { content: markdown, mode: 'replace' })
  → EditorPanel 监听 'import-to-editor'
  → 把 diff 内容作为新文档导入编辑区（markdown 格式）
```

**问题**：这是"把 diff 当文档导入"，不是"在编辑区打开被修改的真实文件"。用户看到的是 diff 文本，不是源文件内容。

---

## 2. 差距分析

### 2.1 Tiptap 差距（目标：100% 复刻官方全部能力）

对照 `ueberdosis/tiptap` 官方 demos 和 extension 列表：

| 能力 | 当前状态 | 差距 | 优先级 |
|------|---------|------|:--:|
| **BubbleMenu**（选中文字悬浮工具条） | 已安装 dep，未启用 | 需在 EditorPanel 中配置 BubbleMenu 插件，显示粗体/斜体/链接/AI 按钮 | P0 |
| **FloatingMenu**（空白行悬浮菜单） | 已安装 dep，未启用 | 需启用，对标官方 demo 的 slash menu 体验 | P0 |
| **FontFamily** 扩展 | ❌ 未安装 | 安装 `@tiptap/extension-font-family` + TextStyle 联动 | P1 |
| **Superscript / Subscript** | ❌ 未安装 | 安装 `@tiptap/extension-superscript` + `@tiptap/extension-subscript` | P1 |
| **Mathematics (KaTeX 编辑)** | ❌ 未安装 | 安装 `@tiptap/extension-mathematics`，编辑区内嵌公式渲染 | P1 |
| **Youtube 嵌入** | ❌ 未安装 | 安装 `@tiptap/extension-youtube` | P2 |
| **Audio 扩展** | ❌ 未安装 | 安装 `@tiptap/extension-audio` | P2 |
| **Dropcursor / Gapcursor** | ❌ 未显式启用 | StarterKit 已含，但官方 demo 通常显式配置。DragHandle 覆盖了部分场景 | P2 |
| **TrailingNode** | ❌ 未启用 | `@tiptap/extensions` 中的 TrailingNode 未导入 | P2 |
| **TableKit (统一表格)** | ❌ 使用自定义表格 | 官方推荐 `@tiptap/extension-table` 家族（TableKit），当前用 EditorTable 自定义实现 | P1 |
| **协作编辑 (Y.js)** | ❌ 未安装 | 仅多用户实时协作场景需要，非本支线目标 | P3（skip） |
| **工具栏 UX 对标官方** | 当前工具栏只有基础按钮 | 需对标官方 Demo 的 MenuBar：所有格式按钮可见、active 状态高亮、分隔线分组 | P0 |
| **Command menu (/ 命令)** | 已有 SlashCommands | 需对标官方 SlashCommand 的 UI 交互（搜索过滤、分类、键盘导航） | P0 |
| **@ 提及** | 已安装 mention dep | 需对标官方 mention 的 UI（头像、高亮、键盘选择） | P1 |
| **图片 resize 拖拽手柄** | 已启用 Image.resize | 官方 demo 有可视化拖拽角标，当前可能缺少 CSS | P2 |

**P0 合计**：BubbleMenu、FloatingMenu、工具栏 UX 对标、SlashCommand 交互
**P1 合计**：FontFamily、Superscript/Subscript、Mathematics、TableKit 迁移、@mention UI
**P2 合计**：Youtube、Audio、Dropcursor/Gapcursor、TrailingNode、图片 resize UI

### 2.2 变更审查差距（目标：100% 对齐 OpenCode 官方）

对照 `opencode-ai/opencode` 官方 SDK 类型和 `packages/app` UI：

| 能力 | 当前状态 | 差距 | 优先级 |
|------|---------|------|:--:|
| **session.diff 事件监听** | ✅ 已实现 | 事件链路完整（`runEvents.ts` 的 SKIP_PARTS 不含 diff） | — |
| **SnapshotFileDiff 类型使用** | 🟡 使用自定义 `OpenCodeDiffFileLike` | 应直接使用 SDK 导出的 `SnapshotFileDiff` 类型，消除自定义映射层 | P0 |
| **VcsFileDiff 类型使用** | 🟡 返回自定义类型 | 同上，使用 SDK `VcsFileDiff` | P0 |
| **FileDiff (v1) 兼容** | ❌ 未处理 | SDK 有两套类型（gen/v2.gen），需兼容 v1 `FileDiff.before/after` 无 patch 字段的情况 | P1 |
| **diff 双栏视图 (side-by-side)** | ❌ 仅统一视图 | 官方 `packages/app` 支持 unified/split 切换 | P1 |
| **hunk 级操作（accept/reject）** | ❌ 未实现 | 官方支持逐 hunk 接受/拒绝变更（调用 `session.revert` 或文件系统写入） | P1 |
| **文件树 + diff 联动** | ❌ 未实现 | 官方左侧文件树、右侧 diff 详情，点击文件树节点切换 diff 视图 | P1 |
| **diff 语法高亮** | ❌ 仅纯文本 | 官方使用 code highlighting，增加/删除行有背景色+行号 | P0 |
| **实时 diff 流式更新** | 🟡 仅在消息完成时获取 | 官方通过 `session.diff` 事件实时推送，每次文件编辑后自动更新 diff | P1 |
| **session.revert 对接** | ❌ 已安装但未接入 UI | `revertOpenCodeSessionMessage` 已封装但无 UI 触发点 | P2 |
| **VCS 分支信息展示** | 🟡 仅显示分支名 | 官方显示分支名+commit hash+变更统计 | P2 |
| **inline diff-summary 按钮** | ✅ 已有 | ChatPanel 底部 inline diff-summary 按钮已实现 | — |

**P0 合计**：统一使用 SDK 官方类型、diff 语法高亮
**P1 合计**：双栏视图、hunk accept/reject、文件树联动、实时 diff 更新、v1 FileDiff 兼容
**P2 合计**：session.revert UI、VCS 信息增强

### 2.3 编辑区↔变更审查打通（目标：点击 diff 行 → 编辑区定位）

| 能力 | 当前状态 | 差距 | 优先级 |
|------|---------|------|:--:|
| **diff 文件 → 编辑区打开真实文件** | ❌ 导入 diff 文本 | 需改为：读取文件系统真实内容 → 导入编辑区 | P0 |
| **diff 行 → 编辑区光标跳转** | ❌ 无 | 点击 diff 的某一行 → 编辑器滚动到对应行并高亮 | P0 |
| **编辑区高亮变更行** | ❌ 无 | 编辑区中显示哪些行是 AI 新增/删除/修改的（类似 VS Code diff editor 的 gutter 标记） | P1 |
| **编辑区 ↔ diff 双向同步** | ❌ 无 | 在编辑区修改后，diff 视图中对应行状态实时更新 | P2 |
| **多文件 Tab 切换** | ❌ 编辑区单文件 | diff 点击不同文件 → 编辑区 Tab 切换（保留未保存内容） | P1 |

**P0 合计**：点击 diff 文件→打开真实文件、点击 diff 行→光标跳转
**P1 合计**：编辑区变更行高亮、多文件 Tab
**P2 合计**：双向同步

---

## 3. Phase 拆解

### Phase 1 (P0): 基础对齐 — 预计 3-4 天

#### 3.1.1 Tiptap: 工具栏 + BubbleMenu + SlashCommand 对标

**入口文件**: `src/components/editor/EditorPanel.vue`

**改动**：
1. 启用 `BubbleMenu` — 选中文字时显示悬浮格式条（粗体/斜体/删除线/代码/链接/高亮/AI 操作）
2. 启用 `FloatingMenu` — 空白段落显示 "点击 / 打开命令菜单" 提示
3. 重构工具栏：对标官方 Demo MenuBar，所有格式按钮可见、active 状态明确、视觉分组
4. SlashCommands 交互优化：搜索过滤、键盘 ↑↓ 选择、Enter 确认、分类标签

**新增依赖**：无（BubbleMenu/FloatingMenu 已安装）

#### 3.1.2 变更审查: SDK 类型统一 + diff 语法高亮

**入口文件**: `src/opencodeClient/diffReview.ts`, `src/composables/useChat.ts`, `src/components/chat/DiffReviewDock.vue`, `src/components/chat/ReviewPanel.vue`

**改动**：
1. `diffReview.ts` — `OpenCodeDiffFileLike` 替换为 SDK `SnapshotFileDiff`；新增 `VcsFileDiff` 适配
2. `useChat.ts` — `OpenCodeDiffFile` 类型替换为 SDK 导出类型
3. `DiffReviewDock.vue` + `ReviewPanel.vue` — diff 行增加语法高亮（highlight.js diff 语言），添加行背景色（绿色+ / 红色- / 蓝色@@）

#### 3.1.3 打通: diff 文件 → 编辑区打开真实文件

**入口文件**: `src/components/chat/ReviewPanel.vue`, `src/components/editor/EditorPanel.vue`

**改动**：
1. ReviewPanel 的 `openDiffInEditor` 改为：读取文件系统真实路径 → 读文件内容 → emit `open-in-editor` with `{ filePath, content, lineNumber }`
2. EditorPanel 监听 `open-in-editor` 时支持 `lineNumber` 参数：`editor.commands.setTextSelection(lineNumber)` + `scrollIntoView`
3. 新增 `src/utils/editorDiffBridge.ts` — 统一编辑区↔diff 桥接逻辑（文件路径解析、行号映射、光标跳转）

**边界注意**：
- 桌面端走 Tauri FS 读文件；Web 端降级为"只显示 diff 文本"（Web 端无本地文件系统）
- 文件路径必须校验：必须在 OpenCode project directory 内，防止路径穿越

### Phase 2 (P1): 体验深度对齐 — 预计 5-7 天

#### 3.2.1 Tiptap: 扩展补全 + TableKit 迁移

1. 安装新增扩展：`@tiptap/extension-font-family`, `@tiptap/extension-superscript`, `@tiptap/extension-subscript`, `@tiptap/extension-mathematics`, `@tiptap/extension-table`(TableKit)
2. EditorPanel 中启用所有新扩展
3. **TableKit 迁移**：将自定义 `EditorTable` 替换为官方 `@tiptap/extension-table` 系列。需要处理旧文档兼容（旧 table 节点 → 新 table 节点迁移）
4. @mention UI 完善：头像、高亮背景、键盘 ↑↓ 选择

**风险**：TableKit 迁移涉及文档 schema 变更，需要写迁移逻辑处理旧文档中的自定义 table 节点

#### 3.2.2 变更审查: 双栏视图 + hunk 操作 + 实时更新

1. **双栏视图**：ReviewPanel 增加 unified/split 切换按钮，split 模式左右并排显示旧/新代码
2. **hunk accept/reject**：每个 hunk 增加 ✓ accept / ✗ reject 按钮
   - accept: 调用文件系统写入（应用变更）
   - reject: 调用 `session.revert` 或丢弃该 hunk
3. **实时 diff**：监听 `session.diff` 事件流式更新 diff 视图（当前仅在消息完成时一次性获取）
4. **v1 FileDiff 兼容**：当后端返回 v1 格式 `{file, before, after}` 时，前端自动生成 unified diff patch

#### 3.2.3 打通: 编辑区变更行高亮 + 多文件 Tab

1. **编辑区变更行高亮**：
   - 在 EditorPanel 中新增 Decoration 扩展，对 AI 变更的行添加 gutter 标记（绿色+ / 红色- / 蓝色~）
   - 通过 `editorDiffBridge.ts` 解析 diff hunk 行号 → 映射到编辑器文档位置 → 应用 decorations
2. **多文件 Tab**：
   - 编辑区顶部新增 Tab 栏（类似 VS Code）
   - 从 diff 点击不同文件 → 新建/切换到对应 Tab
   - 未保存文件 Tab 显示 ● 圆点

### Phase 3 (P2): 锦上添花 — 预计 2-3 天

1. Tiptap: Youtube/Audio/TrailingNode 扩展安装启用，图片 resize 拖拽 UI 完善
2. 变更审查: session.revert UI、VCS commit 信息增强
3. 打通: 编辑区↔diff 双向同步（编辑区修改实时反映到 diff 视图）

### Phase 4: 验证 & 收口 — 预计 1 天

1. `pnpm exec vue-tsc -b` 类型检查
2. `pnpm exec vite build` 构建验证
3. 13 个编辑器相关测试 + diffReview 测试全部通过
4. 桌面端 Tauri 构建验证（FS 读文件链路）
5. Web 端降级验证（无本地 FS 时 diff→编辑区不崩溃）

---

## 4. 架构决策记录 (ADR)

### ADR-1: Tiptap 扩展启用策略
**决策**：所有官方扩展默认启用，仅排除不适用场景（Y.js 协作、Twitch 等）。
**理由**：Tiptap 的扩展是 tree-shakable 的，Vite 会自动排除未使用的代码。多安装的扩展不增加 bundle 大小。

### ADR-2: TableKit 迁移 vs 保留自定义表格
**决策**：迁移到官方 TableKit，但保留旧文档兼容层。
**理由**：官方 TableKit 有更好的上下游兼容性（Markdown 导入导出、Word 导出）。旧文档中的自定义 table 节点在加载时自动转换为 TableKit 节点。

### ADR-3: 变更审查类型统一
**决策**：直接使用 SDK 导出的 `SnapshotFileDiff` / `VcsFileDiff` 类型，废弃自定义 `OpenCodeDiffFileLike`。
**理由**：减少类型映射层，OpenCode SDK 升级时自动获得类型更新。

### ADR-4: diff→编辑区 文件读取权限
**决策**：桌面端通过 Tauri FS API 读取 OpenCode project directory 内的文件；Web 端降级为只展示 diff 文本。
**理由**：Web 端无本地文件系统访问权限，不能假设文件存在。这是平台边界，不是功能缺失。

### ADR-5: 双栏 diff 实现方式
**决策**：使用纯 CSS 双栏布局 + highlight.js 语法高亮，不引入额外 diff 库。
**理由**：当前依赖已够用，引入 `diff` 或 `react-diff-viewer` 会增加维护成本。

---

## 5. 文件变更清单

### Phase 1 变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/editor/EditorPanel.vue` | 修改 | 启用 BubbleMenu/FloatingMenu；工具栏对标官方；SlashCommands 交互优化 |
| `src/components/editor/EditorToolbar.vue` | **新建** | 工具栏独立组件（对标官方 MenuBar） |
| `src/components/editor/EditorBubbleMenu.vue` | **新建** | BubbleMenu 悬浮工具条组件 |
| `src/opencodeClient/diffReview.ts` | 修改 | `OpenCodeDiffFileLike` → `SnapshotFileDiff`；新增 VcsFileDiff 解析 |
| `src/composables/useChat.ts` | 修改 | `OpenCodeDiffFile` 类型替换为 SDK 类型 |
| `src/components/chat/DiffReviewDock.vue` | 修改 | diff 语法高亮 |
| `src/components/chat/ReviewPanel.vue` | 修改 | diff 语法高亮；`openDiffInEditor` 改为文件路径模式 |
| `src/utils/editorDiffBridge.ts` | **新建** | 编辑区↔diff 桥接（文件读取、行号映射、光标跳转） |
| `package.json` | 修改 | 新增 highlight.js diff 语言注册（已安装，仅需注册） |

### Phase 2 变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `package.json` | 修改 | 新增 `@tiptap/extension-font-family`, `@tiptap/extension-superscript`, `@tiptap/extension-subscript`, `@tiptap/extension-mathematics`, `@tiptap/extension-table` 等 |
| `src/components/editor/EditorPanel.vue` | 修改 | 注册新扩展；TableKit 替换自定义表格；多文件 Tab |
| `src/components/editor/EditorTabs.vue` | **新建** | 多文件 Tab 栏 |
| `src/utils/editorTableMigration.ts` | **新建** | 旧 table 节点 → TableKit 节点迁移 |
| `src/components/chat/ReviewPanel.vue` | 修改 | 双栏视图；hunk accept/reject 按钮 |
| `src/components/chat/DiffSplitView.vue` | **新建** | 双栏 diff 视图组件 |
| `src/opencodeClient/diffReview.ts` | 修改 | v1 FileDiff 兼容（before/after → patch 生成） |
| `src/utils/editorDiffBridge.ts` | 修改 | 变更行高亮 decoration；行号→编辑器位置映射 |
| `src/opencodeClient/runEvents.ts` | 修改 | `session.diff` 事件处理增强（实时 diff 流式更新） |

### Phase 3 变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/editor/EditorPanel.vue` | 修改 | Youtube/Audio/TrailingNode 启用 |
| `src/components/chat/ReviewPanel.vue` | 修改 | session.revert 按钮；VCS 信息增强 |
| `src/utils/editorDiffBridge.ts` | 修改 | 双向同步（编辑器变更 → diff 更新） |

---

## 6. 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:--:|:--:|----------|
| TableKit 迁移破坏旧文档 | 中 | 高 | 写迁移函数 + 自动备份旧 JSON；Phase 2 才做 |
| BubbleMenu/FloatingMenu 与 DragHandle 冲突 | 低 | 中 | Tiptap 官方三者可共存，按官方 demo 配置优先级 |
| 桌面端 FS 读文件权限不足 | 低 | 高 | 复用已有 Tauri FS scope（已在 `default.json` 中声明） |
| Web 端降级体验差 | 低 | 低 | Web 端明确为降级模式，UI 标注"仅桌面端支持直接打开文件" |
| v1/v2 FileDiff 格式不一致 | 中 | 中 | 双格式兼容层，优先 v2 `SnapshotFileDiff`，fallback v1 `FileDiff` |
| 双栏 diff CSS 在窄屏溢出 | 低 | 低 | 窄屏自动切回 unified 视图（`@container` query） |

---

## 7. 验证检查清单

- [ ] `pnpm exec vue-tsc -b` 零错误
- [ ] `pnpm exec vite build` 成功
- [ ] 编辑器 BubbleMenu 选中文字出现悬浮工具条
- [ ] 编辑器 FloatingMenu 空白行显示 / 提示
- [ ] 工具栏对标官方 Demo（所有按钮可见、active 高亮）
- [ ] SlashCommands 搜索过滤 + 键盘导航正常
- [ ] diff 行语法高亮正确（+/−/@@ 颜色区分）
- [ ] 点击 diff 文件 → 编辑区打开真实文件内容
- [ ] 点击 diff 具体行 → 编辑区光标跳转到对应行
- [ ] `diffReview.test.ts` 测试通过
- [ ] 桌面端 Tauri build 链路正常
- [ ] Web 端降级不崩溃
- [ ] 双栏 diff 视图切换正常 (Phase 2)
- [ ] hunk accept/reject 功能正常 (Phase 2)
- [ ] 多文件 Tab 切换正常 (Phase 2)

---

## 8. 与现有支线的关系

```
main
  ├── desktop (OpenCode 文/武模式开发)  ← 并行
  ├── web (Web 直连模式开发)            ← 并行
  └── bianji (本支线)                   ← 新建
        ├── 不改 src-tauri/ (无 Rust 变更)
        ├── 不改 src/opencodeClient/ 核心架构 (仅类型统一+事件增强)
        ├── 不改 Web 直连引擎
        └── 主要改动: EditorPanel, ReviewPanel, diffReview, 新增 editorDiffBridge
```

**合并策略**：`bianji` → `main`（独立验证后合并，与 desktop/web 不冲突）

---

## 9. 附录: Tiptap 官方 Demo 对照表

| 官方 Demo | 路径 | 对标状态 |
|-----------|------|:--:|
| Default (MenuBar) | `demos/src/Examples/Default/Vue/` | 🟡 工具栏需对标 |
| MarkdownShortcuts | `demos/src/Examples/MarkdownShortcuts/Vue/` | ✅ 已有(StarterKit 内置) |
| Tasks | `demos/src/Examples/Tasks/Vue/` | ✅ 已有 |
| Images (Resizable) | `demos/src/Examples/ResizableImages/` | ✅ 已有 |
| CustomDocument | `demos/src/Examples/CustomDocument/Vue/` | — 不适用 |
| InteractivityComponent | `demos/src/Examples/InteractivityComponentContent/Vue/` | — 不适用 |
| Collaboration | `demos/src/Extensions/Collaboration/Vue/` | ❌ (P3 skip) |
| Color | `demos/src/Extensions/Color/Vue/` | ✅ 已有 |
| Typography | `demos/src/Extensions/Typography/Vue/` | ✅ 已有 |
| UniqueID | `demos/src/Extensions/UniqueID/Vue/` | ✅ 已有 |
| Placeholder | `demos/src/Extensions/Placeholder/Vue/` | ✅ 已有 |
| Mathematics | — (通过 extension-mathematics) | ❌ Phase 2 |
| Youtube | `demos/src/Nodes/Youtube/` | ❌ Phase 3 |
| Table | — (TableKit) | 🟡 Phase 2 迁移 |
| Details | — (extension-details) | ✅ 已有 |
| Markdown (Full) | `demos/src/Markdown/Full/` | 🟡 需验证 roundtrip |
| StaticRendering | `demos/src/Examples/StaticRendering/` | ✅ 已有 static-renderer |

---

## 10. 补充: 磁盘文件桥接 — 「两个世界」统一 (2026-06-26)

> **来源**: `docs/handover/bianji-editor-disk-file-bridge-handoff.md`
> **关联**: gongju 支线（知识库内循环）
> **优先级**: P0（bianji 目标 3 的真正前提）

### 10.1 核心发现

当前编辑区和知识库 (vault) 处于「两个世界」：

```
编辑器 EditorPanel 读/写  →  SQLite documents 表
知识库 vault 文件         →  磁盘 ~/.jiucaihezi/**/*.md
变更审查 ReviewPanel diff →  磁盘文件（OpenCode git/snapshot）
```

**后果**: 
- AI 在磁盘 vault 创建了 `角色/萧炎.md`，用户在编辑区想打开 → **打不开**（编辑区只认 SQLite `fileId`）
- 变更审查 diff 行 emit 的 `open-diff-in-editor` 带 `filePath`，但 handler 只认 `fileId` → **跳转落空**

### 10.2 原因

| 证据 | 位置 |
|------|------|
| `open-in-editor` 只认 `fileId` (SQLite 主键) | `EditorPanel.vue:403-436` |
| 反向链接只在 documents 表搜索 | `EditorPanel.vue refreshBacklinks()` |
| 变更审查 emit 带 `filePath` (磁盘路径) | `ReviewPanel.vue:62 resolveDiffFilePath()` |
| 保存只写 SQLite | `EditorPanel.vue saveToFile()` → `saveExistingEditorFile()` |

### 10.3 解决方案: 三任务

#### 任务 A: open-in-editor / open-diff-in-editor 支持磁盘路径

`EditorPanel.vue` 的 handler 增加分支：
```
if (payload.filePath) {
  // 磁盘文件路径分支（新）
  raw = await readTextFileFromDisk(payload.filePath)
  doc = markdownToTiptapDoc(raw)
  editor.setContent(doc)
  currentFilePath = payload.filePath    // ★ 新增状态
  currentFileId = null                  // 不是 SQLite 文档
} else if (payload.fileId) {
  // 现有 SQLite 分支（保持不变）
}
```

#### 任务 B: 保存时按来源分流

```
if (currentFilePath) {
  // 磁盘来源 → tiptap → markdown → 写回磁盘
  md = getEditorMarkdown()
  await writeTextFileToDisk(currentFilePath, md)
} else if (currentFileId) {
  // SQLite 来源 → 现有逻辑
  await saveExistingEditorFile(currentFileId, snapshot)
}
```

#### 任务 C (可选): 磁盘 vault 文件树

真正的"像 Obsidian 一样浏览磁盘 vault 目录树"。gongju 支线决定先用「变更审查当文件树」兜底——ReviewPanel 显示变更过的文件（`turnDiffs` + `vcsDiffs`），点文件通过任务 A 在编辑区打开。第一版可不做完整目录树。

### 10.4 安全边界
- 磁盘读写必须校验路径，限制在 vault / project directory scope 内，禁止路径穿越
- 不要把磁盘文件内容镜像进 SQLite documents 表（避免回到双世界，也避免 1.34GB OOM 债务复发）
- Tauri FS scope 在 `capabilities/default.json` 中检查 `fs:allow-read-text-file` / `fs:allow-write-text-file`

### 10.5 版本现状

| 任务 | 状态 |
|------|:--:|
| 任务 A: 磁盘路径读取 | 🟡 `editorDiffBridge.ts` 已封装 `readRealFileContent()`，EditorPanel `open-diff-in-editor` handler 已调用但结果未正确写入编辑区 |
| 任务 B: 保存分流写回磁盘 | ❌ 未实现（当前 `saveToFile()` 只写 SQLite） |
| 任务 C: 磁盘文件树 | ❌ 第一期跳过 |
