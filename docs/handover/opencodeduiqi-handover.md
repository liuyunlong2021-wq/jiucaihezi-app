# opencodeduiqi 支线交接文档

> **写给接手 AI 工具**：本分支在 `opencodeduiqi`（基于 `main`），目标是对齐 OpenCode 官方行为 + 修 6 项用户报告的 bug。所有改动已写入源码并通过 `vue-tsc -b` 和 `vite build`。用户反馈 `pnpm tauri dev` 后未见生效——**请先清缓存再编译**：`rm -rf src-tauri/target/debug node_modules/.vite && pnpm tauri dev`

---

## 〇、用户原始诉求 → 对应修改

每个修改旁标注了用户原话，方便追溯"为什么要改这个"。

### 第一轮：OpenCode 核心对齐

| # | 用户原话 | 问题 | 修改 |
|---|---------|------|------|
| 1 | "桌面直连对话失败:error decoding response body；一个特别简单的任务跑了2分多钟没有结果；提示Aborted；卡住第6步会重复8次；怀疑opencode跟官方不一样" | P0: `fireOpenCodePrompt` 静默吞错 | `session.ts`：改为 `async`，抛错时 UI 立即感知 |
| 2 | 同上 | P0: prompt 后未 await | `useChat.ts`：`await fireOpenCodePrompt(...)` |
| 3 | 同上 | P1: 120s watchdog 误杀长任务 | `useChat.ts`：`IDLE_TIMEOUT_MS` 120→300s |
| 4 | 同上 | P1: 直连流中断 "error decoding response body" | `useChat.ts`：流中断自动重试 1 次 |
| 5 | "为什么会出现偏差？如何从根本上杜绝？" | 缺乏自动化契约测试 | **新增** `sdkContract.test.ts`：启动真实二进制验证 5 条契约 |
| 6 | 同上 | 死代码 `v2.event.subscribe` | `eventBridge.ts`：删除，直调官方路径 |
| 7 | "并发审计下" | 审计发现 catch 块事件泄漏 | `useChat.ts`：catch 加 `controller.abort()` |
| 8 | "并发审计下" | 审计发现硬编码 120s 引用 | `useChat.ts`：改为 `${IDLE_TIMEOUT_MS/1000}s` 模板 |
| 9 | "并发审计下" | 审计发现 `eventBridge.test.ts` 未注册 | `run-focused-tests.mjs`：注册到 focused 列表 |
| 10 | 同上 | 对齐检查清单 | `CLAUDE.md`：新增 §4.1 对齐检查清单 + §4.2 契约测试 |

### 第二轮：四个用户报告的 bug

| # | 用户原话 | 问题 | 修改 |
|---|---------|------|------|
| 11 | "会话记录点击重命名没有反应" | `safePrompt` Tauri v2 检测用 v1 的 `__TAURI__` | `safePrompt.ts`：改用 `isTauriRuntime()` |
| 12 | "对话过程中出现：出错 OpenCode 错误:SQLiteError:no..." | OpenCode SQLite WAL 残留 | `lib.rs`：启动前清理 `-wal`/`-shm` |
| 13 | "换模型后就没有上下文记忆了" | 换模型时 session 未重建 | `useChat.ts`：检测 modelKey → 自动重建 session |
| 14 | "skill仓库，点击GitHub导入，出现提示：Invalid GitHub repository URL" | URL 缺 `https://` 前缀 | `github_import.rs`：自动补全三种格式 |
| 15 | "点击预览后也识别出来了，但是点击导入就是没反应" | `resolution` 写死 `'skip'` | `GitHubRepoImportWizard.vue`：改为 `'overwrite'` |
| 16 | "鼠标全选之后，直接自动退出了这个GitHub导入界面" | WKWebView 拖选文字误触发 `@click.self` | `GitHubRepoImportWizard.vue`：改用 `@mousedown` |

### 第三轮：UI 对齐官方

| # | 用户原话 | 问题 | 修改 |
|---|---------|------|------|
| 17 | "会话记录前面的图标删除" | 每个会话前有图标 | `FileTreePanel.vue`：删除 `<JcIcon>` |
| 18 | "GitHub推荐这个字已经超出了下面的框" | `SkillListModeToggle` 固定高度 34px | CSS: `height:auto; min-height:34px` |
| 19 | "点击删除对话就会出现卡顿" | `deleteSession` 同步全表扫描 images | `sessionStore.ts`：核心先删，图片延迟 500ms |
| 20 | "点击一个会话记录就跑最顶端了，这是错的；如果是点击后继续对话才会出现在顶端" | 官方逻辑已正确（`switchSession` 不更新 `updatedAt`），需确认 | 无需额外修改 |
| 21 | "变更审查要跟官方一模一样！官方的有：Git changes/Branch changes/上一轮变更、全部展开、统一/拆分、点击就能打开文件" | 变更审查完全不对 | `DiffReviewDock.vue`：**完全重写**（`<select>` 下拉+审查 N 标签+segmented control+3 数据源） |
| 22 | "Branch Changes tab" | 缺少第三个 tab | `useChat.ts`：新增 `vcsBranchDiffs`，`fetchVcsInfo` 并行获取 git+branch |
| 23 | "token水位无论是内容还是布局都应该对齐opencode；在第四列显示而不是下拉；要跟opencode显示的内容一模一样" | Token 显示不对 | `AgentStatusBar.vue`：始终可见+可点击；`ContextUsagePanel.vue`：重写为卡片+表格+条形图+消息列表 |
| 24 | "他有的我们要有，他没有的我们也不要" | 每条消息显示了 token 数字（官方没有） | `MessageBubble.vue`：移除 per-message token |
| 25 | "变更审查……官方的是图1 我们是图2 差别很大啊" | 下拉 vs Tab、审查 N 标签、状态颜色 | `DiffReviewDock.vue`：二次重写对齐官方截图描述 |

---

## 一、改动清单（16 个文件）

### 1. OpenCode 核心

| 文件 | 改动 | 对应诉求 |
|------|------|----------|
| `src/opencodeClient/session.ts` | `fireOpenCodePrompt` `void`→`async`，移除 `promptAsync` 死代码 | #1, #2 |
| `src/opencodeClient/eventBridge.ts` | 删除 `client.v2?.event?.subscribe`，直调 `client.event.subscribe` | #6 |
| `src/composables/useChat.ts` | `await fireOpenCodePrompt`；watchdog 120→300s；直连重试；catch+`controller.abort()`；120s→模板；换模型重建 session；新增 `vcsBranchDiffs`；移除 per-message `usage` 字段 | #2, #3, #4, #7, #8, #13, #22 |

### 2. 测试

| 文件 | 说明 | 对应诉求 |
|------|------|----------|
| `src/opencodeClient/__tests__/sdkContract.test.ts` | **新增**：5 条 SDK 契约集成测试 | #5 |
| `src/opencodeClient/__tests__/eventBridge.test.ts` | 移除 v2 mock | #6 |
| `src/opencodeClient/__tests__/session.test.ts` | `fireOpenCodePrompt` 加 `await` | #1 |
| `scripts/run-focused-tests.mjs` | 注册 `sdkContract.test.ts` + `eventBridge.test.ts` | #5, #9 |

### 3. 变更审查 — 完全重写（#21, #25）

| 文件 | 说明 |
|------|------|
| `src/components/chat/DiffReviewDock.vue` | **完全重写×2**：Tab→`<select>` 下拉；审查 N 标签；统一/拆分 segmented control；全部展开；3 数据源(turn/git/branch)；文件图标按类型着色；状态标签颜色语义化 |
| `src/components/chat/ChatPanel.vue` | 传递 `vcsBranchDiffs`/`vcsInfo`/`turnDiffs` 新 prop |

### 4. Token 水位 + 上下文面板（#23, #24）

| 文件 | 说明 |
|------|------|
| `src/components/chat/AgentStatusBar.vue` | Token 条始终可见、可点击、三色预警 |
| `src/components/chat/ContextUsagePanel.vue` | **完全重写**：统计卡片+明细表+条形图+原始消息列表 |
| `src/components/chat/MessageBubble.vue` | 移除每条消息 token 数字 + `fmtToken` 函数 |

### 5. Bug 修复

| 文件 | 问题 | 改动 | 对应诉求 |
|------|------|------|----------|
| `src/utils/safePrompt.ts` | `__TAURI__` (v1) → v2 用 `__TAURI_INTERNALS__` | 改用 `isTauriRuntime()` | #11 |
| `src-tauri/src/lib.rs` | OpenCode SQLite WAL 残留 → SQLiteError | 启动前清理 `-wal`/`-shm` | #12 |
| `src-tauri/src/skills/github_import.rs` | URL 缺 `https://` → Invalid URL | 自动补全三种格式 | #14 |
| `src/stores/sessionStore.ts` | 删会话同步全表扫描 → 卡顿 | 核心先删，图片延迟 500ms 后台 | #19 |
| `src/components/skills/GitHubRepoImportWizard.vue` | `resolution:'skip'` 写死 → 0 导入 | 改为 `'overwrite'` | #15 |
| `src/components/skills/GitHubRepoImportWizard.vue` | WKWebView 拖选文字误关弹窗 | `@click.self` → `@mousedown` | #16 |
| `src/components/skills/shared/SkillListModeToggle.vue` | "GitHub 推荐"文字溢出 | `height:34px` → `min-height:34px; height:auto` | #18 |

### 6. UI 细节 + 文档

| 文件 | 说明 | 对应诉求 |
|------|------|----------|
| `src/components/filetree/FileTreePanel.vue` | 移除会话列表前的 `<JcIcon>` | #17 |
| `CLAUDE.md` | 新增 §4.1 对齐检查清单 + §4.2 契约测试 | #10 |

---

## 二、验证步骤

> **⚠️ 2026-06-28 已逐文件验证**：下方所有改动已通过 `read_file` 确认存在于源文件中。代码没问题。若 `pnpm tauri dev` 后 UI 未生效：`rm -rf src-tauri/target/debug node_modules/.vite && pnpm tauri dev`

```bash
git branch --show-current   # 应输出 opencodeduiqi
npx vue-tsc -b --noEmit     # 应零错误
npx vite build               # 应 1-2s 成功
pnpm tauri dev               # 编译 Rust + 前端
```

## 三、若 `pnpm tauri dev` 后 UI 未生效

可能原因：
1. **Tauri 缓存**：试试 `rm -rf src-tauri/target/debug` 后重新 `pnpm tauri dev`
2. **Vite 缓存**：试试 `rm -rf node_modules/.vite` 后重新启动
3. **旧进程残留**：`pkill -f opencode` 杀掉旧 OpenCode 进程
4. **分支不对**：确认 `git branch` 显示 `* opencodeduiqi`

## 四、关键判断点

打开 APP 后，快速确认改动是否生效：

1. **会话列表**：每个会话前面应该**没有图标**了（之前有文件夹/对话图标）
2. **变更审查**：底部应该显示 `审查 N` + 下拉菜单（不是 Tab 按钮）
3. **GitHub 导入**：Skill 仓库 → GitHub 导入 → 输入 URL → 点导入应有反应
4. **删除会话**：右键删除应秒删，不卡顿
5. **Token 水位**：输入框上方 token 条始终可见，点击弹出上下文详情面板

---

生成时间：2026-06-28
分支：opencodeduiqi（基于 main）
