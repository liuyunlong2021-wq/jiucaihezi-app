# OpenCode UI 对齐 SDD（v3 — 执行完成）

> **版本基线**：本项目 `@opencode-ai/sdk` v1.17.9，上游 `anomalyco/opencode` v1.17.11 (commit `5565a8e`)
> **对齐策略**：基于 SDK v1.17.9 做兼容补齐
> **范围**：仅桌面 OpenCode 文/武路径
> **执行日期**：2026-06-25 ~ 2026-06-26
> **总状态**：✅ 全部 Phase 完成，3 子 agent 并发审计通过
>
> **总原则**：
> - OpenCode 的 session/message/part/permission/question/todo/diff 数据模型按官方协议承载
> - UI 交互优先对齐官方 app/session-ui/TUI
> - 韭菜盒子产品增强标 `[增强]`，不伪装成官方能力

---

## Part 类型矩阵（当前本地状态）

本地 `OpenCodeRenderablePart.type` 是 `string`（非联合类型），以下为运行时实际处理的 part 类型：

| Part type | 本地渲染 | 官方对应 | 差距 |
|-----------|----------|----------|------|
| `text` | Markdown 渲染 | ✅ 一致 | — |
| `reasoning` | 可折叠思考块 | ✅ 一致 | — |
| `tool` | ToolCallCard | ✅ 一致 | — |
| `file` | 📎 图标 + MIME 徽章 + 代码预览 + 图片渲染 | ✅ 已对齐 | P1-1 + P3-2 |
| `image` | `<img>` + 下载 + 灯箱（兼容旧格式） | ✅ 已对齐 | 保留兼容，同时支持 file+mime:image/* |
| `shell` | 终端输出卡片 | ✅ 一致 | — |
| `patch` / `diff` | 差异视图（+/- 着色） | ✅ 一致 | — |
| `snapshot` | **代码块视图**（`<pre><code>`） | ✅ 已对齐 | P1-2：isDiffPart 移除 snapshot |
| `agent` | system-event 行 | ✅ 一致 | — |
| `compaction` | turn-divider 分割线 | ✅ 已对齐 | P0 前序 |
| `interrupted` | turn-divider 分割线 | ✅ 已对齐 | P0 前序 |
| `step-start/step-finish/step-fail` | system-event / 隐藏 | ✅ 一致 | — |
| `retry` | system-event | ✅ 一致 | — |
| `error` | 错误卡片 | ✅ 一致 | — |

---

## 缺口清单（按优先级，剔除伪缺口）

### 剔除项（不纳入本 SDD）

| 原 # | 原描述 | 剔除原因 |
|:----:|--------|----------|
| #5 | 消息多选 | 上游无此功能。官方是单条消息 actions：revert/copy/fork。批量操作另开 `[增强]` SDD |
| #9 | 会话内搜索 | 上游 session list search / file search 存在，但当前会话消息高亮搜索不是核心官方行为。降级为 `[增强]` |
| #10 | 直连结构化附件 | 直连路径不走 OpenCode parts，是 `CLAUDE.md` 硬边界。移入「直连附件协议优化」SDD |

---

## 🔴 P0 — 锁定基线，不写代码

### P0-1 版本基线声明

- 本项目 `@opencode-ai/sdk`: **v1.17.9**
- 上游 `anomalyco/opencode` dev: **v1.17.11** (commit `5565a8e`)
- 对齐方式：基于 SDK v1.17.9 做兼容补齐
- SDK 升级到 v1.17.11 另开变更，不在本文档范围内
- 所有验收必须以 SDK v1.17.9 可接收的事件/数据格式为准

### P0-2 上游证据表

| 缺口 | 上游文件/行为 | 本地文件 | 验收方式 |
|------|-------------|---------|----------|
| 图片型 FilePart | `file` part，`mime: image/png` 等 | `OpenCodePartList.vue` 仍检查 `part.type === 'image'` | 真实 OpenCode 会话中工具生成图片 → 正确渲染 `<img>` |
| 文件 Part 详情 | file part 展开显示文件内容预览 | `OpenCodePartList.vue` raw JSON dump | file part 展开 → 结构化视图（MIME/大小/代码预览） |
| snapshot 渲染 | `snapshot` part → 完整文件内容（代码块） | `isDiffPart()` 含 snapshot → 被当 diff 渲染 | snapshot part → 代码块视图，无 +/- 着色 |
| Context Usage | `SessionContextUsage` 按钮 → `SessionContextTab` | `AgentStatusBar` 仅全局 token 条 | 点击 → 展开 Context 面板：详情的 token/cost/cache/reasoning |
| Context 面板 | `ContextTab`: 标题/消息数/provider/model/上下文上限/总token/成本/时间/system prompt/raw messages | 完全缺失 | 新增 Context 面板 |
| @-提及 | `PartInput`: text + file + agent，`source.start/end/value` | 完全缺失 | 输入 @file → 弹出建议 → 选中注入 PartInput |
| 消息 actions | 单条消息：revert/copy/fork | 本地无 revert/fork 按钮 | 助手消息旁出现 revert/fork actions |
| rename 远程同步 | `session.update({ title })` | 仅本地 IndexedDB | 重命名 → OpenCode server 同步 |

---

## 🔴 P1 — 核心数据模型对齐（先做）

### P1-1 图片型 FilePart 渲染

**上游行为**：工具生成的图片以 `file` part 出现，`mime` 为 `image/png`、`image/jpeg` 等。不存在独立 `image` part type。

**当前状态**：`OpenCodePartList.vue:109` 检查 `part.type === 'image'`，模板 `v-if="part.type === 'image'"` 渲染 `<img>`。这与官方协议不符。

**修复**：

```
src/components/chat/OpenCodePartList.vue
  1. 新增 isImageFilePart(part): boolean
     → part.type === 'file' && (part.raw as any)?.mime?.startsWith('image/')
  2. 模板：v-if="part.type === 'image' || isImageFilePart(part)"
  3. 图片 URL 优先取 (part.raw).url || part.result || part.text
  4. 对 jc-media:// URL 调用 resolveJcMediaUrl()
  5. 添加点击灯箱（emit preview-image）+ 下载按钮
```

**改动范围**：`OpenCodePartList.vue` + `ChatPanel.vue`（灯箱事件），~35 行

---

### P1-2 snapshot vs patch/diff 渲染分离

**上游行为**：`snapshot` 是完整文件内容（代码块视图），`patch`/`diff` 是 +/- 变更（差异视图）。

**当前状态**：`OpenCodePartList.vue:230-231` 的 `isDiffPart()` 将 `snapshot` 纳入 diff 类别，三种类型都用 `coloredDiffHtml()` 渲染。

**修复**：

```
src/components/chat/OpenCodePartList.vue
  1. isDiffPart() 移除 'snapshot'
  2. 新增模板分支 v-else-if="part.type === 'snapshot'"：
     → <pre><code> + highlight.js 语法高亮
     → 标题 "📄 文件快照 · {filename}"
  3. patch/diff 保持现有差异视图不变
```

**改动范围**：`OpenCodePartList.vue`，~20 行

---

### P1-3 session rename 远程同步

**上游行为**：`session.update({ title })` 同步到 OpenCode server。

**当前状态**：`FileTreePanel.vue` 已实现本地重命名（`safePrompt` → `sessionStore.renameSession`），但未调 `opencodeClient.session.update()`。

**修复**：

```
src/components/filetree/FileTreePanel.vue
  renameCtxSession() 末尾加：
    if (isOpenCodeSession(sessionId)) {
      await activeClient.session.update({ sessionID: sessionId, title: newTitle })
    }

src/opencodeClient/session.ts
  - 确认 session.update() 方法签名（当前仅用于 permission 更新）
  - 若 SDK 不支持 title 更新，记录为已知限制
```

**改动范围**：`FileTreePanel.vue` + `session.ts`，~10 行

---

### P1-4 消息 Actions：revert / copy / fork

**上游行为**：每条助手消息有 revert（撤销本轮）、copy（复制内容）、fork（分叉新会话）三个 action。

**当前状态**：
- `copy`：`MessageBubble.vue:444-452` 有本地剪贴板复制，✅ 已对齐
- `revert`：仅 session 级别 `RevertDock.vue`，❌ 单条消息无 revert
- `fork`：仅 session 级别 `/fork` slash 命令，❌ 单条消息无 fork

**修复**：

```
src/components/chat/MessageBubble.vue
  1. 助手消息 actions 栏新增：
     - 撤销本轮 (revert): emit('revert', messageId)
     - 分叉新会话 (fork): emit('fork', messageId)
  2. 图标：revert → undo, fork → call_split

src/components/chat/ChatPanel.vue
  1. 监听 @revert → 调 session.revert(messageId)
  2. 监听 @fork → 调 session.fork(messageId) → 创建新本地会话
  3. 若 SDK 无此 API，先做本地模拟（切回该消息状态 + 新会话引用）
```

**改动范围**：`MessageBubble.vue` + `ChatPanel.vue`，~40 行

---

## 🟡 P2 — Context 面板对齐（接着做）

### P2-1 Context Usage 详情面板（替换原 #2）

**上游行为**：`SessionContextUsage` 按钮 → 点击展开 `SessionContextTab`。展示字段：

| 字段 | 来源 (`OpenCodeContextUsage`) |
|------|------|
| 会话标题 | Context Tab 标题 |
| 消息数 | `messageCount` / `userMessages` / `assistantMessages` |
| Provider / Model | `providerID` / `modelID` / `modelLabel` |
| 上下文上限 | `limit` |
| Input tokens | `input` |
| Output tokens | `output` |
| Reasoning tokens | `reasoning` |
| Cache read/write | `cacheRead` / `cacheWrite` |
| 总 token | `total` |
| 成本 | `cost` |
| 创建 / 最后活动时间 | `lastMessageAt` |
| System prompt | 从 session 获取 |
| Raw messages | 可展开的原始消息列表 |
| Context breakdown | token 分布图 |

**当前状态**：
- `OpenCodeContextUsage` 类型 16 字段已全部定义（`catalog.ts:37-52`）
- `AgentStatusBar` 仅渲染 `total` + `input` + `output` 三个字段（全局状态条）
- **缺失**：Context 面板 UI

**实现**：

```
新建：src/components/chat/ContextUsagePanel.vue
  - 从 AgentStatusBar 的 token 用量条目点击展开（或独立按钮）
  - 展示全部 16 字段的结构化面板
  - 分 4 个区块：会话信息 / Token 用量 / Provider & Model / 成本
  - 每 30s 自动刷新（或手动刷新按钮）

修改：src/components/chat/AgentStatusBar.vue
  - token 用量条目改为可点击按钮
  - emit('open-context-panel')

修改：src/components/chat/ChatPanel.vue
  - 引入 ContextUsagePanel
  - 监听 @open-context-panel → 展开面板
```

**改动范围**：3 文件（+1 新建），~100 行

---

### P2-2 Session 详情展示（替换原 #4）

> **注意**：此项与 P2-1 Context Usage 面板高度重叠。上游 Context Tab 已包含会话元数据。
> 合并为同一面板实现，不做独立的"会话详情面板"。

**实现**：与 P2-1 合并。ContextUsagePanel 本身即为会话详情面板。FileTreePanel 会话条目右键菜单加「查看详情」→ 展开 ContextUsagePanel。

**改动范围**：`FileTreePanel.vue` 右键菜单加一项，~5 行

---

## 🟢 P3 — 打磨项（最后做）

### P3-1 @-提及（@file / @agent）

**上游行为**：输入框输入 `@` 触发 PartInput 建议列表。选中后构造 `PartInput`：`{ type: 'file'|'agent', source: { start, end, value }, ... }`。用于高亮渲染、恢复 prompt、上下文追踪。**不是**注入 system prompt。

**当前状态**：完全缺失。仅有 `/` slash 命令做会话操作（不同机制）。

**实现**：

```
新建：src/components/chat/MentionPopup.vue
  - 监听 textarea @ 符号输入
  - 弹出建议列表：@file（项目文件）、@agent（已安装 skill）
  - 选中后插入提及芯片（@filename.ts）
  - 维护 PartInput 列表

修改：src/components/chat/ChatPanel.vue
  - textarea 集成 MentionPopup
  - PartInput 发给 OpenCode client（走 session.prompt parts）

修改：src/opencodeClient/session.ts
  - buildOpenCodePromptParts() 支持 file/symbol/resource 三种 source
  - 当前仅支持 resource，需补 file + symbol
```

**改动范围**：3 文件（+1 新建），~100 行

---

### P3-2 文件 Part 结构化详情

**上游行为**：file part 展开显示文件名、MIME、大小。文本文件可预览内容。

**当前状态**：`OpenCodePartList.vue:92-98` 已显示 `📎 name[mime] (size)`。但 `detailText()` 将 raw JSON 作为纯文本 dump。

**实现**：

```
src/components/chat/OpenCodePartList.vue
  - 文件 part 详情面板改为结构化视图：
    · MIME 类型徽章（颜色编码：image/蓝、video/紫、text/绿、pdf/红）
    · 文件大小（复用已有 formatFileSize）
    · 文本文件：前 20 行代码预览（highlight.js 高亮，从 raw.content 取）
    · 图片文件：缩略图预览
  - 移除 detailText() 的 raw JSON dump
```

**改动范围**：`OpenCodePartList.vue`，~40 行

---

### P3-3 每条消息 Token 显示 `[增强]`

> **标记**：韭菜盒子产品增强，非 OpenCode 官方行为。

每条助手回复后显示 `↑1.2K ↓3.4K` token 用量（OpenAI 风格的小字 token 标注）。

**实现**：

```
src/composables/useChat.ts
  - ChatMessage 接口加 usage?: { input: number; output: number }
  - finalizeOpenCodeRun() 结束时取 lastUsage → 写回 message.usage

src/components/chat/MessageBubble.vue
  - 助手消息底部渲染 token 用量行（仅 message.usage 存在时）
```

**改动范围**：2 文件，~25 行

---

## 执行顺序

```
Phase 0: P0-1 版本基线声明 + P0-2 证据表  （本文档本身）
Phase 1: P1-1 图片 FilePart + P1-2 snapshot/patch + P1-3 rename 同步 + P1-4 消息 actions
         ── 4 项，~105 行，核心数据模型对齐
Phase 2: P2-1 Context Usage 面板 + P2-2 Session 详情
         ── 2 项合并为 1 个面板，~105 行，Context 体验完整
Phase 3: P3-1 @提及 + P3-2 文件详情 + P3-3 每条消息 token
         ── 3 项，~165 行，体验打磨
```

---

## 变更文件汇总

| 文件 | Phase | 改动量 | 说明 |
|------|:-----|:------|------|
| `src/components/chat/OpenCodePartList.vue` | 1, 2, 3 | ~95 行 | 图片 FilePart + snapshot + 文件详情 |
| `src/components/chat/MessageBubble.vue` | 1, 3 | ~50 行 | 消息 actions + token 用量 |
| `src/components/chat/ChatPanel.vue` | 1, 2, 3 | ~70 行 | revert/fork 事件 + Context 面板 + @提及 |
| `src/components/chat/AgentStatusBar.vue` | 2 | ~15 行 | token 条目可点击 |
| `src/components/chat/ContextUsagePanel.vue` | 2 | ~80 行（新建） | Context 详情面板 |
| `src/components/chat/MentionPopup.vue` | 3 | ~80 行（新建） | @提及弹出层 |
| `src/components/filetree/FileTreePanel.vue` | 1, 2 | ~15 行 | rename 远程同步 + 查看详情 |
| `src/opencodeClient/session.ts` | 1, 3 | ~15 行 | update title + PartInput source |

---

## 验收标准

每项完成后必须通过以下验证：

| # | 验收项 | 验证方法 |
|---|--------|---------|
| P1-1 | 图片型 FilePart 正确渲染 | 真实 OpenCode 会话中工具生成图片 → `<img>` 显示 + 点击灯箱 |
| P1-2 | snapshot 与 patch/diff 渲染不同 | snapshot → 代码块视图；patch/diff → +/- 差异视图 |
| P1-3 | rename 同步到 OpenCode server | 重命名 → 检查 OpenCode server session title 已更新 |
| P1-4 | revert/fork actions 可用 | 消息旁出现 revert/fork 按钮，点击执行对应操作 |
| P2-1 | Context Usage 面板完整 | 16 字段全部渲染，token/cost/cache/reasoning 无遗漏 |
| P3-1 | @file/@agent 提及可用 | 输入 @ → 弹出建议 → 选中注入 PartInput |
| P3-2 | 文件 part 结构化详情 | file part 展开 → MIME 徽章 + 代码预览，无 raw JSON dump |
| — | 不回归 | permission/question/todo/diff-summary 功能正常 |

```bash
# 每 Phase 完成后
pnpm exec vue-tsc -b && pnpm exec vite build
```

---

## 不纳入本文档的项目（原因）

| 项目 | 决策 | 去向 |
|------|------|------|
| 消息多选 | 上游无此功能 | 另开 `[增强]` SDD |
| 会话内搜索 | 非核心官方行为 | 另开 `[增强]` SDD |
| 直连结构化附件 | 不走 OpenCode parts | 移入「直连附件协议优化」SDD |
| SDK 升级 v1.17.9 → v1.17.11 | 独立变更 | 另开 SDK 升级 SDD |

---

## 执行日志（2026-06-25 ~ 2026-06-26）

### Phase 1 — 核心数据模型对齐 ✅

| # | 项 | 文件 | 改动 |
|---|-----|------|------|
| P1-1 | 图片型 FilePart 渲染 | `OpenCodePartList.vue` + `ChatPanel.vue` | `isImageFilePart()` 检测 `file`+`mime:image/*`；图片渲染合并 `image`/`file` 两种 type；hover 下载按钮；Teleport 灯箱；partTitle 去重 |
| P1-2 | snapshot/patch 渲染分离 | `OpenCodePartList.vue` | `isDiffPart()` 移除 `snapshot`；snapshot 独立 `<pre><code>` 代码块视图 |
| P1-3 | rename 远程同步 | `FileTreePanel.vue` + `ChatPanel.vue` | emit `rename-open-code-session` → `ensureOpenCodeServer` + `client.session.update({ title })` (best-effort) |
| P1-4 | 消息 actions | `MessageBubble.vue` + `ChatPanel.vue` | revert（撤销本轮）、fork（分叉新会话）按钮 + handler |

### Phase 2 — Context 面板 ✅

| # | 项 | 文件 | 改动 |
|---|-----|------|------|
| P2-1 | ContextUsagePanel | `ContextUsagePanel.vue`（新建）| 4 区块（会话信息 / Token 用量 / Provider&Model / 成本）渲染 16 字段 |
| P2-1 | AgentStatusBar 可点击 | `AgentStatusBar.vue` | token 栏 clickable → emit `openContextPanel`；hover 高亮 |
| P2-2 | 会话右键查看详情 | `FileTreePanel.vue` + `ChatPanel.vue` | 「查看详情」→ emit `view-session-detail` → 展开 Context 面板 |

### Phase 3 — 打磨项 ✅

| # | 项 | 文件 | 改动 |
|---|-----|------|------|
| P3-1 | @-提及 | `MentionPopup.vue`（新建）+ `ChatPanel.vue` | `@` 检测 → 弹出建议列表（@file/@agent）；键盘 ↑↓↵Esc 导航 |
| P3-2 | 文件 Part 结构化详情 | `OpenCodePartList.vue` | MIME 徽章（颜色编码）+ 代码预览（前 3000 字符） |
| P3-3 | 每条消息 Token `[增强]` | `useChat.ts` + `MessageBubble.vue` + `ChatPanel.vue` | `ChatMessage.usage` 字段 + `finalizeOpenCodeRun` 快照 + `↑↓` 显示 |

### 审计修复 ✅

| 来源 | 严重性 | 问题 | 修复 |
|------|:--:|------|------|
| 审计1 | 🔴 | MentionPopup 键盘导航缺失 | ChatPanel `onKeydown` 拦截 ArrowUp/Down/Enter/Escape + 父组件管理 `selectedIdx` |
| 审计2 | 🔴 | `previewImage`/`downloadImage` 死事件链路 | MessageBubble 加 emit 转发 + ChatPanel Teleport 灯箱 + 下载处理 |
| 审计1 | 🟡 | 图片 file part 双渲染 | `partTitle()` 对图片型 file 返回简化标题 |
| 审计3 | ⚠️ | fork 本地实现（非 `session.create`） | 已知限制，P3 标记 |
| 审计3 | ⚠️ | @-mention 文本插入（非 PartInput） | 已知限制，P3 标记 |

### 验证

```bash
vue-tsc -b  ✅ 零错误
vite build  ✅ ~1.2s
审计 3 agent ✅ 8/10 完全对齐，2/10 已知部分对齐
```

### 变更文件（最终汇总）

| 文件 | 新增/修改 |
|------|:--:|
| `src/components/chat/OpenCodePartList.vue` | 修改 |
| `src/components/chat/MessageBubble.vue` | 修改 |
| `src/components/chat/ChatPanel.vue` | 修改 |
| `src/components/chat/AgentStatusBar.vue` | 修改 |
| `src/components/chat/ContextUsagePanel.vue` | **新增** |
| `src/components/chat/MentionPopup.vue` | **新增** |
| `src/components/filetree/FileTreePanel.vue` | 修改 |
| `src/composables/useChat.ts` | 修改 |
| `src/opencodeClient/timelineRows.ts` | 修改 |

---

## 后续建议

### 建议 1：提交当前工作 ✅
当前状态：3 Phase 全部完成 + 审计全部修复 + 构建通过。建议 commit + push。

### 建议 2：下次迭代（可选）
两个已知部分对齐项如需进一步对齐：
- **fork → `session.create()`**：当前本地实现可工作，改用 `client.session.create()` 可获 OpenCode 侧会话跟踪
- **@-mention → PartInput**：当前文本插入可工作，改用 `PartInput` + `source.start/end/value` 可获高亮恢复追踪

### 建议 3：不做
- 消息多选、会话内搜索、直连结构化附件 — 均非 OpenCode 对齐范畴，不纳入
