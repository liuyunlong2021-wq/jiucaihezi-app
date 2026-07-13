# 韭菜盒子 Desktop — OpenCode 差异修复记录

> 对照 OpenCode Desktop，逐项修复 韭菜盒子 的消息链路差异。

> **写给下一个 AI 的**: 这是韭菜盒子 Desktop 与 OpenCode Desktop 的差异清单。
> 上半部分是「已止血的伤」，下半部分是「还没缝的」。每个问题都标注了库方案、官方参考、怎么修。
> **读完这个文件你就能直接开工，不需要翻聊天记录。**

> [!WARNING]
> 本文是历史排障记录，不再作为信息流架构决策依据。H-1/H-2 等旧评估存在错误；当前唯一执行方案见 [[OpenCode官方信息流翻译SDD]]，事实以同版本 OpenCode 官方源码为准。

---

## 快速参考

| 项目 | 值 |
|------|-----|
| 源码 | `/Users/by3/Documents/jiucaihezi-app/` |
| 事实源(OpenCode) | `/Users/by3/Documents/jiucaihezi-opencode/packages/desktop/src/` |
| 对照表 | `docs/sdd/opencode-desktop-mapping.md` |
| 技术栈 | Tauri v2 / Rust \| Vue 3 / Pinia / TypeScript / Vite |
| 聊天核心 | `src/composables/useChat.ts` (2000+ 行，一切从这里开始) |
| SSE 事件 | `src/opencodeClient/eventBridge.ts` / `@microsoft/fetch-event-source` |
| 进程管理 | `src-tauri/src/commands/opencode.rs` / `src/opencodeClient/daemon.ts` |
| 会话存储 | `src/stores/sessionStore.ts` / OpenCode SQLite |
| 登录 | `src/services/newApiClient.ts` / CLI 文件 `~/.jiucaihezi/.jc_api_key` |

---

## 一、已修复 ✅（别动这些）

### 核心链路止血（9 项）

| 日期 | 问题 | 怎么修的 | 文件 |
|------|------|---------|------|
| 0711 | SSE 手写→库 | `eventBridge.ts` 换 `@microsoft/fetch-event-source`，指数退避+Last-Event-ID | `eventBridge.ts` |
| 0711 | Cancel 重建 config | `stopStream` 缓存 `lastActiveClient`，不重建 | `useChat.ts` |
| 0711 | Cancel 不清 session | `stopStream` 后清 `activeOpenCodeSessionId` | `useChat.ts` |
| 0711 | 关 APP 会话消失 | 去 `loadAllSessions` 桌面端空操作；`jc_active_session:{projectDir}` 按项目隔离 | `sessionStore.ts` |
| 0710 | 会话跨项目泄漏 | 桌面端不读 IndexedDB 回退；切项目 `sessions.value=[]` | `sessionStore.ts` |
| 0710 | "0条消息" 误导 | 移除 `messageCount`；显示时间替代 | `sessionStore.ts` + `FileTreePanel.vue` |
| 0711 | 登录反复修反复坏 | CLI 文件为唯一持久化源，砍 Keychain 超时+verifyApiKey+三层回退(-60行) | `newApiClient.ts` |
| 0711 | Part 不传 ID | `buildOpenCodePromptParts` 加 `id: part_N` | `session.ts` |
| 0712 | 4 层完成检测冗余 | statusPoll 去硬超时，250ms→1s，砍 `lastEventTime`(-20行) | `useChat.ts` |
| 0712 | Part ID 前缀错误 | `part_`→`prt_`（OpenCode server 校验前缀，`part_` 返回 400）(-1行) | `session.ts` |
| 0712 | session.error 过早 finalize | `session.error` handler 不再调 `finalizeOpenCodeRun`，只标记 error part。OpenCode 源码：`prompt_async` fork 中 catch→publish Error 但不终止 session | `useChat.ts` |
| 0712 | updateOpenCodeSessionModel 400 | **删除**手动 model update。`PUT /session/:id` 只接受 title/metadata/permission/time.archived，塞 model→400→session 损坏→全 404。Server `prompt.ts:660` 自动检测 model 变化并 `setAgentModel()`，prompt payload 已带 model。 | `useChat.ts` |
| 0712 | `session.idle` 后 session 404 | 根因不是 SSE/server 删除：sidecar 替换时未等待旧进程退出，还误删共享 SQLite 的 WAL/SHM，丢失已提交但未 checkpoint 的 session。统一停止路径等待子进程退出，并删除手工 WAL/SHM 清理。 | `opencode.rs` |
| 0712 | 新会话不出现在左侧历史 | `refresh-file-list` 在桌面端无 client 时是空操作，启动时远程列表还可能覆盖本地预览；发送完成后绑定本地 session 与 OpenCode session，并在列表中补回。 | `sessionStore.ts` + `ChatPanel.vue` |
| 0712 | 内部 system-reminder 直接显示 | OpenCode 工具/上下文结果可能带 `<system-reminder>`，显示层按官方“工具结果折叠、正文不泄漏”原则剥离该标记；原始数据仍保留。 | `messageDisplay.ts` + `MessageBubble.vue` |
| 0712 | 简单问候也很慢 | sidecar 错设 `OPENCODE_EXPERIMENTAL=true`，一次性开启实验事件系统、实验文/武模式、后台子 Agent、LSP 等非官方 Desktop 路径。删除总开关，只保留官方 `ICON_DISCOVERY`、`FILEWATCHER` 和 `OPENCODE_CLIENT=desktop`。 | `opencode.rs` |

### 进程 & UI 修复（3 项）

| 日期 | 问题 | 怎么修的 | 文件 |
|------|------|---------|------|
| 0712 | 进程复用 HTTP 健康检查 | 先加后**删除**。健康检查 kill→restart 进程 → JS session ID 指向死 session → 400/404。根因：进程复用只用 `try_wait`，不健康检查。 | `opencode.rs` |
| 0710 | 点会话关闭创作面板 | `openItem()` 移除 `emitEvent('switch-panel','chat')` | `FileTreePanel.vue` |
| 0710 | 聊天面板无法缩窄 | Chat `flex:1`，去 `chatWidth` ref，`RIGHT_MAX`→9999 | `WorkspaceLayout.vue` |
| 0712 | CSS 跨平台 | `-webkit-box`+`display:block` 回退；`@container`+`@media` 回退 | MessageReferences+ChatPanel |

### 核实非问题（别浪费时间）

- **2.1** session ID 模块级变量 → 已有 `lastProjectDir` + `effectiveDir` 自动清理
- **12.5** Vue 响应式 mutate → Vue3 Proxy 追踪一切，`assistantByMessageId` 存 reactive 引用

---

## 二、还没修（按优先级排序）

> 每个问题包含：严重度 🔴🟡🟢 / 根因 / 库方案 / 官方参考 / 评估 / 怎么修 / 预估 S(<1h) M(1-3h) L(>3h)

### 🔴 H-1: 事件流每消息新建（非全局单例）

- **文件**: `src/composables/useChat.ts` ~L2000
- **根因**: 每次 `sendMessage` 新建 SSE 连接+AbortController，非全局单例
- **OpenCode**: App 挂载时启动全局单例 SSE 流，Effect 运行时保证生命周期
- **库方案**: 无。`@microsoft/fetch-event-source` 已用，这是架构设计问题
- **评估（2026-07-13 更正）**: **架构根因，必须修复**。Vue/Tauri 可以用应用生命周期、AbortController 和 Pinia 等价翻译官方全局流，不依赖 SolidJS Effect 才能实现。
- **执行方案**: 见 [[OpenCode官方信息流翻译SDD]]，不再对每消息 SSE 做局部补丁。
- **预估**: L

### 🔴 H-2: 600 行内联 handler

- **文件**: `src/composables/useChat.ts` ~L1450-2100
- **根因**: SSE 事件处理全内联在一个函数，无分层
- **OpenCode**: 三层分离 — `coalesce`(合并) → `event-reducer`(状态机) → SolidJS store
- **库方案**: 不需要库，纯重构
- **评估**: **代码质量缺陷**。功能正常但难维护。
- **怎么修**: 不按事件类型创建一堆 handler 文件；按官方边界翻译为一个纯 `eventReducer.ts` 和一个唯一 `openCodeSyncStore.ts`，见 [[OpenCode官方信息流翻译SDD]]。
- **预估**: M

### 🔴 H-3: 项目切换无架构隔离

- **文件**: `useChat.ts` ~L1194 / `daemon.ts` / `opencode.rs`
- **根因**: OpenCode client 全局单例，切项目靠 `effectiveDir` 比较+手动清 session
- **OpenCode**: `ensureDirSdkContext(directory)` — 每目录独立 SDK context
- **库方案**: 无，架构设计
- **评估**: **已部分缓解**。手动清理覆盖主要场景。极端情况（两 Tab 同时操作不同项目）当前单窗口 UI 不触发。
- **怎么修**: Rust `OpenCodeRuntime` 存 `HashMap<String, OpenCodeSession>` 按 directory key，TS 端 `Map<string, Client>`。切项目时切换 client 而非清 session。
- **预估**: L（Rust+TS 双层改造）

### 🟡 M-1: 会话打开不主动加载历史

- **文件**: `useChat.ts` `syncAfterCommand` ~L757 / `openSession`
- **根因**: 点历史会话不自动从 OpenCode 拉消息
- **OpenCode**: `resolve()` → `client.session.get(sessionID)` 缓存优先
- **库方案**: SDK 已有 `client.session.messages()`
- **评估**: **功能遗漏**。用户点历史会话看不到内容。
- **怎么修**: `openSession()` 中调 `listOpenCodeChatMessages(client, sessionId)` + `replaceMessagesPreservingPrompt()`。
- **预估**: S（~30行）

### 🟡 M-2: session.error 不再触发 finalize ✅ 已修复

- **0712 修复**: `session.error` handler 不再调 `finalizeOpenCodeRun`，只标记 error part。让 session 自然走到 `session.idle`。若 session 真死了，watchdog 120s 兜底。
- **后续结论**: 暴露出的 H-0 根因在 Rust sidecar 重启时误删 SQLite WAL/SHM，与 event handler 无关，现已修复。

### 🟡 M-3: 发送失败消息不回滚

- **文件**: `useChat.ts` sendMessage catch ~L1300
- **根因**: 失败后留一条孤零零的 user 消息在列表里
- **OpenCode**: `removeOptimisticMessage()` + `restoreInput()` + toast
- **库方案**: 不需要库
- **评估**: **UX 缺陷**。
- **怎么修**: catch 中 `messages.value = messages.value.filter(m => m.id !== userMsgId)`。
- **预估**: S（~5行）

### 🟡 M-4: 文件内联 text 而非 file:// URL

- **文件**: `useChat.ts` buildPrompt 相关
- **根因**: 附件内容内联为代码块 text，非 `file://` URL
- **OpenCode**: `file://` URL + source 对象
- **评估**: **设计取舍，非缺陷**。内联对远程模型(NewAPI)友好；`file://` 只对本地模型有效。当前方案更通用。
- **建议**: 🟢 **降级**。当前合理。后续可加 `file://` 作为本地模型优化。
- **预估**: M

### 🟡 M-5: 无乐观更新 / part 去重

- **文件**: `useChat.ts` + `timelineRows.ts`
- **根因**: 无 optimistic add/remove/confirm
- **OpenCode**: `sync.session.optimistic.add()` + `batch()` + `reconcile`
- **评估**: `upsertOpenCodePart` 已按 `part.id` 去重，重复 part 不显示两次。乐观更新能让 UI 更快但不是 bug。
- **建议**: 🟢 **降级**。
- **预估**: M

### 🟢 L-1 ~ L-15: 低优先级

Steps 1.x, 5.x, 6.x, 9.x, 12.x, 13.x, 16-20（输入格式、Markdown 异步、Provider 配置、斜杠命令、Session Fork 等）。不影响日常使用，属于「对齐 OpenCode 终局目标」。

---

## 三、通用库建议

| 场景 | 库 | npm/crate | 状态 |
|------|-----|-----------|------|
| SSE 事件流 | `@microsoft/fetch-event-source` | npm | ✅ 已用 |
| 代码高亮 | `highlight.js` → 可升级 `shiki`(异步) | npm | 🔧 当前 |
| IndexedDB | `dexie.js` | npm | 💡 可替手写 `idb.ts` |
| Pinia 持久化 | `pinia-plugin-persistedstate` | npm | 💡 可替手写 localStorage |
| Tauri 持久化 | `@tauri-apps/plugin-store` | npm+crate | 💡 可替 Keychain+CLI+localStorage |
| HTTP 客户端 | `reqwest` | crate | ✅ Rust 端已用 |

---

## 四、怎么在这个项目干活

### 铁律

1. **翻译 OpenCode Desktop** — 韭菜盒子 = OpenCode 的 Tauri + Vue 翻译版。不自创，不简化，不添加。
2. **对照表是唯一入口** — `docs/sdd/opencode-desktop-mapping.md`，找到 OpenCode 对应代码逐行翻译。
3. **画布例外** — 画布先查 [LeaferJS](https://github.com/leaferjs/leafer)，OpenCode 没有画布。
4. **库优先** — 新功能先搜 npm/GitHub 有无成熟库。

### 关键文件（改之前必须读完上下文）

| 文件 | 为什么危险 |
|------|-----------|
| `src/composables/useChat.ts` | 2000+ 行对话核心，改一行可能炸全局 |
| `src-tauri/src/commands/opencode.rs` | Rust 进程管理，try_wait+健康检查+session 生命周期 |
| `src/opencodeClient/eventBridge.ts` | SSE 桥，已换 `@microsoft/fetch-event-source` |
| `src/stores/sessionStore.ts` | 会话持久化，桌面/Web 行为不同 |
| `src/services/newApiClient.ts` | API Key，CLI 文件为唯一持久化源 |
| `src-tauri/tauri.conf.json` | CSP+assetProtocol，错一个全黑 |

```bash
pnpm exec vue-tsc -b          # TS 检查
cargo check --manifest-path src-tauri/Cargo.toml  # Rust 检查
pnpm tauri dev                 # 桌面开发
```

---

## 五、合并前验收清单

> 分支 `0711-canvas` → 合并到 `main` 之前逐项验证。

| # | 测试项 | 操作 | 预期结果 | 状态 |
|---|--------|------|---------|------|
| 1 | 武模式·发送 | 选「武模式」，输入「你好」，发送 | 有回复，不报错 | ⬜ |
| 2 | 文模式·发送 | 切「文模式」，输入「你好」，发送 | 有回复，**消息不消失**，再发第二条也正常 | ⬜ 待桌面验收 |
| 3 | 文模式·连续 | 文模式连续发 3 条不同问题 | 每条都有回复，不丢消息 | ⬜ 待桌面验收 |
| 4 | 历史会话 | 点左侧历史会话列表中的任一会话 | 显示该会话的消息内容 | ⬜ |
| 5 | 新对话 | 点「新对话」，输入「测试」发送 | 新会话创建，有回复 | ⬜ |
| 6 | 切项目 | 换个项目文件夹，发一条消息 | 不串会话，新项目独立 | ⬜ |
| 7 | 类型检查 | `pnpm exec vue-tsc -b` | 零错误 | ✅ |
| 8 | Rust 检查 | `cargo check --manifest-path src-tauri/Cargo.toml` | 零错误 | ✅ |

> **H-0 已修复**: sidecar 替换现在等待旧进程退出，且不再删除 SQLite WAL/SHM。文/武模式连续发送仍需桌面手动验收。

---

## 六、方法论：非程序员×AI 协作

### 你不懂编程，但你懂产品。AI 不懂产品，但它懂代码。

你的工作不是写代码——是**告诉 AI 做什么、检查 AI 做对了没有**。

### 五条铁律

1. **一个文档管一切** — `AGENTS.md` 是 AI 入口。换 AI 工具时把这份文件和项目一起给它。
2. **SDD 是交接棒** — 每个任务结束更新 SDD。标题格式：`{问题}-{状态}.md`。下个 AI 读完就知道。
3. **分支 = 边界** — 一个分支一个任务。完成了就合并。分支名用日期+关键词（`0712-dengluxiufu`）。
4. **Commit 写清楚** — 每条说：改了什么、为什么、怎么验证。别写「fix bug」。
5. **换 AI 前先交棒** — `git diff --stat` → 更新 AGENTS.md + SDD → 告诉下个 AI：「当前分支 X，做了 Y，还剩 Z」。

### 标准任务流程

```
1. 打开 AGENTS.md → 了解项目
2. 打开 docs/sdd/ → 找相关 SDD
3. 告诉 AI：「我要做 X，参考 Y，别动 Z」
4. AI 干活 → 你跑 pnpm exec vue-tsc -b 检查
5. 通过 → commit → 更新 SDD → git push
```

### 编程黑话速查

| 词 | 人话 | 什么时候听到 |
|----|------|-------------|
| 库(library) | 别人写好的代码，npm install 就能用 | AI 说「用 XX 库」 |
| API | 两个程序说话的协议 | 「调 API」「API 挂了」 |
| SSE | 服务器主动推数据，「字一个字蹦出来」就是 SSE | 「SSE 断了」 |
| 竞态(race) | 两个操作同时跑，后完成的覆盖先完成的 | 「有时正常有时不行」 |
| 超时(timeout) | 等太久不等了 | 「加个超时」 |
| 回退(fallback) | A 方案失败用 B | 「加个 fallback」 |
| 持久化(persist) | 存硬盘，关 APP 不丢 | 「登录状态持久化」 |
| 乐观更新 | 先假装成功更新 UI，失败再回滚 | 「消息气泡先显示再标红」 |

---

> **最后更新**: 2026-07-12 · **分支**: `0711-canvas` · **进度**: 21/38 已解决，H-0 已修复待桌面验收

---

## 附录：原始对照差异表（参考用）

以下为最初发现的全部差异，已解决的见上方「已修复」，未解决的在「还没修」中。
保留此附录供深度排障时对照。

---

## Step 1: 输入捕获 → Submit

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 1.1 | 输入格式 | 纯文本字符串 `getPlainText(editor)` | 结构化 `Prompt` (ContentPart[] 含 range/selection) |
| 1.2 | session 创建位置 | `sendMessage()` 内部 | `handleSubmit()` 内，创建后**导航到新 URL** |
| 1.3 | 乐观更新 | 无，直接 `messages.value.push(userMsg)` | `sync.session.optimistic.add()` — 可回滚 |
| 1.4 | 媒体模型 | 有 `isMediaModel()` 拦截分支走创作面板 | 无此分支 |
| 1.5 | 斜线命令 | `/` 走 `runVisibleSlashText()` 单独路径 | 内建在 `sendFollowupDraft` 中，走 `client.session.command()` |

## Step 2: Session 管理

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 2.1 | session 标识 | **模块级变量** `activeOpenCodeSessionId` | **URL params** `params.id` |
| 2.2 | 模型切换 | **更新 session model** (`updateOpenCodeSessionModel`) | 不影响 session（model 是 message 级属性） |
| 2.3 | session 创建后 | 不导航 | 导航到新 URL |
| 2.4 | 元数据 | 写入 `jiucaiheziSessionId` 等自定义 metadata | 无自定义 metadata |

## Step 3: promptAsync 返回后

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 3.1 | busy 设置 | `isStreaming = true`（手动布尔 ref） | `session_status[id] = {type:"busy"}`（reactive store） |
| 3.2 | 失败恢复 | `controller.abort()` + 插入错误 assistant 消息 | 移除乐观消息 + 恢复输入框 + toast |
| 3.3 | 成功后 | 无操作，等事件流 | 无操作，等事件流 |

## Step 4: SSE 事件处理 ← 差异最大

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 4.1 | 事件流生命周期 | 每次 `sendMessage` 新建 SSE 连接，`finalize` 时关闭 | App 挂载时启动**全局单例** SSE 流，永久运行 |
| 4.2 | 事件处理架构 | 内联 **600 行 handler**，手动维护 `streamingParts` Map、`streamingTools` Map | 分层: stream → `coalesce` 合并 → `event-reducer` → SolidJS store |
| 4.3 | 完成检测 | **4 层**防御: event idle + status poll(250ms) + stream close 3x retry + watchdog 120s | **1 层**: `session.status` 事件 → `session_status.type` |
| 4.4 | finalize 行为 | **服务器重同步** `listOpenCodeChatMessages()` + `replaceMessagesPreservingPrompt()` | 无重同步，完全信任事件流 |
| 4.5 | 看门狗 | 120s 无事件 → abort + kill 进程 → finalize | 无（依赖 Effect 结构化并发中断） |
| 4.6 | catch 异常 | `if (runId !== activeRunId) return` **静默吞异常** | 重新抛给调用方，始终显示 toast |

## Step 5: 消息渲染

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 5.1 | Markdown 渲染 | marked + highlight.js（**同步**，大消息阻塞 UI） | Shiki Web Worker（**异步**，不阻塞） |
| 5.2 | 流式文本 | `usePacedValue` 逐字显示 | `markdown-stream` 增量解析 |
| 5.3 | Mermaid | 独有 `renderMermaidBlocks()` | 不支持 |
| 5.4 | TTS | 独有 Web Speech API | 不支持 |

## Step 6: 完成检测

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 6.1 | 触发路径 | 4 条（冗余安全） | 1 条（事件流） |
| 6.2 | 延迟 | `scheduleFinalizeOpenCodeRun` 120ms batch debounce | 即时 react to store |
| 6.3 | 超时兜底 | 120s watchdog → kill 进程 | 无超时 |

## Step 7: Abort / Cancel

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 7.1 | cancel 操作 | **重建 config + ensureServer** 后才 abort | 用已有 client 直接 `session.abort()` |
| 7.2 | session ID | **不清** `activeOpenCodeSessionId` | URL 不变，天然一致 |
| 7.3 | 清理范围 | `cancelCurrentRun()`, phase 状态机 | 仅清 todos |
| 7.4 | 异步执行 | `void (async () => {...})()` 裸奔 Promise | `await abort()` |

## Step 8: 进程管理（Tauri 独有层，OpenCode Desktop 无对应）

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 8.1 | 启动方式 | Tauri sidecar `Command::new("opencode").arg("serve")` | Electron `utilityProcess.fork(sidecar.js)` |
| 8.2 | 配置传递 | `OPENCODE_CONFIG_CONTENT` 环境变量 | IPC `child.postMessage({type:"start",...})` |
| 8.3 | 进程复用 | 只看 `try_wait`（进程存活），**不检查 HTTP 响应性** | 有 `checkHealth()` 健康检查 |
| 8.4 | HTTP 超时 | `timeout: false`（AI SDK 忽略，Node.js fetch 无默认超时） | 不确定 |
| 8.5 | 健康检查 | 仅在首次启动时 `Promise.race([ready(), gone()])` | 每次复用前 `checkHealth()` + health endpoint |

---

## Step 9: SDK Client 创建与连接（第2轮深挖）

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 9.1 | Server 进程 | Tauri sidecar `Command::new` | Electron `utilityProcess.fork(sidecar.js)` |
| 9.2 | SDK 作用域 | 单一全局 client（按 url+auth+dir key 缓存） | **按 directory 创建多个 scoped client** (`ensureDirSdkContext`) |
| 9.3 | Client 重建 | 仅 key 变化时 | SolidJS `createMemo` + `directory()` 响应式重建 |
| 9.4 | Ready 检测 | Tauri IPC 返回 handle（无独立 health check） | IPC `{type:"ready"}` + `checkHealth()` 轮询 |

## Step 10: 会话加载（第2轮深挖）

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 10.1 | 加载粒度 | 全量加载 (limit=500) | 渐进式分页（初始 2 条 + 历史 200 条） |
| 10.2 | 会话打开 | **不主动加载历史消息**，依赖 `messages.value` 当前状态 | `resolve()` → `client.session.get()` 缓存优先拉取 |
| 10.3 | Part 管理 | 消息级 `openCodeParts` 数组 | 独立 `part` store + `part.id` 索引 |
| 10.4 | 并发安全 | `activeRunId` 单 run 保护 | `inflight` Map + generation + `batch()` 批处理 |

## Step 11: Prompt Payload 构建（第2轮深挖）

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 11.1 | Part ID | **不传 `part.id`** | 每个 part 都有 `Identifier.ascending('part')` id |
| 11.2 | 文件传递 | 内联为 text（代码块包裹） | `file://` URL + `source` 对象 |
| 11.3 | Agent part | ❌ 不支持 `type: 'agent'` | 支持，含 `name` + `source` |
| 11.4 | synthetic 标记 | ❌ 无 | `synthetic: true` 标记注释类 part |
| 11.5 | messageID | ❌ 不传，服务端生成 | ✅ 客户端预生成并传入 |
| 11.6 | variant | ❌ 无 | 传入 `variant` 字段 |

## Step 12: 消息显示响应式（第2轮深挖）

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 12.1 | 状态管理 | 单一 `ref<ChatMessage[]>` | 分层 store: message + part + session_status |
| 12.2 | 更新粒度 | 直接 mutate 嵌套对象 + 定期全量替换 | SolidJS `produce` + `reconcile` 细粒度 |
| 12.3 | 乐观更新 | ❌ 无 | ✅ optimistic add/remove/confirm |
| 12.4 | 批量更新 | 无显式 batch | `batch(() => { ... })` 原子更新 |
| 12.5 | Vue 响应式风险 | mutate `targetMsg.openCodeParts` 可能不触发更新 | 不存在此问题 |

## Step 13: 工具调用显示

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 13.1 | 静默工具策略 | 硬编码 Set（可能与未来工具不同步） | 基于 part.state 判断 |

## Step 14: 会话状态 / 思考指示器

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 14.1 | 状态模型 | 6 阶段手动状态机 | busy/idle 二元 + blocked/todo 子状态 |
| 14.2 | 状态源 | 事件驱动 + 手动 `setPhase` | 服务端 `session_status` store 单一真相源 |
| 14.3 | 阻塞检测 | ❌ 无 | permission/question 阻塞发送 |
| 14.4 | 风险 | finalize 后迟到 SSE 事件可能覆盖 phase | 不存在此问题 |

## Step 15: 项目目录隔离（第2轮深挖）

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 15.1 | 隔离方式 | 手动变量跟踪 + 清 session | **架构级隔离**，按 directory 重建整个 provider 子树 |
| 15.2 | Client 作用域 | 全局单 client | `ensureDirSdkContext(directory)` 每目录独立 |
| 15.3 | 切换行为 | 清 session + 手动刷新列表 | `key={scope+directory}` → SolidJS 重挂载 |
| 15.4 | 数据隔离 | 同一 store | `dirSyncContext` 按 directory 创建独立 store |

---

## Step 16: Provider 配置（第3轮深挖）🔴

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 16.1 | npm 包 | **只用 `@ai-sdk/openai-compatible`**（NewAPI/Ollama/自定义全一样） | 25 种原生包（`@ai-sdk/anthropic`, `@ai-sdk/openai` 等） |
| 16.2 | 模型 cost | ❌ 不传 | ✅ input/output/cache_read/cache_write |
| 16.3 | 模型 limit | ❌ 不传 | ✅ context/input/output 限制 |
| 16.4 | headerTimeout | ❌ 不设 | ✅ `OPENAI_HEADER_TIMEOUT_DEFAULT = 10_000` |
| 16.5 | temperature | ❌ 不传 | ✅ 可选 |

## Step 17: 斜杠命令执行

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 17.1 | 图片附件 | ❌ 命令不传图片 | ✅ `parts: images.map(...)` |
| 17.2 | 失败恢复 | 只设 `phase='error'`，**不清 `isStreaming`** | `restoreInput()` 完整恢复 |
| 17.3 | command 验证 | 不做验证 | `sync().data.command.find()` |

## Step 18: Session Fork/Archive/Delete/Compact 🔴

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 18.1 | compact API | `(client as any).v2.session.compact()` **类型不安全** | Effect 内部 `compaction.ts` |
| 18.2 | compact 确认 | 8s 轮询 `waitForOpenCodeCompactionSync` | 同步 Effect 完成即确认 |
| 18.3 | 通信方式 | SDK HTTP → OpenCode 进程 | Effect 直接操作 SQLite |

## Step 19: 错误恢复（第3轮深挖）

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 19.1 | 输入恢复 | ❌ 不恢复 | ✅ `restoreInput()` 完整恢复 |
| 19.2 | watchdog 杀进程后 | `listOpenCodeChatMessages()` 可能失败，`finalSyncError` 被吞 | 不存在此场景 |
| 19.3 | 斜杠命令失败 | 不清 `isStreaming`，UI 可能假死 | `setIdle()` + `removeOptimisticMessage()` |
| 19.4 | 权限响应失败 | 只写 `sessionCommandNotice`，不清 pending | 不存在此场景 |

## Step 20: "新对话" 流程

| # | 差异 | 韭菜盒子 | OpenCode Desktop |
|---|------|----------|-----------------|
| 20.1 | 新对话页面 | ❌ 无 | ✅ `/new-session` 独立页面 |
| 20.2 | session 创建 | 懒创建（第一次 send 时） | 提交前立即 `client.session.create()` |
| 20.3 | URL 导航 | 不变 | 每次都导航到新 URL |

| 严重度 | 编号 | 描述 |
|--------|------|------|
| 🔴 | 11.1 | prompt payload 不传 `part.id`，可能导致 part 更新事件映射失败 |
| 🔴 | 12.5 | 直接 mutate openCodeParts 可能不触发 Vue 响应式 |
| 🔴 | 15.1 | 项目切换无架构级隔离，跨项目 session 泄漏 |
| 🔴 | 4.1 | 事件流按需启动，SSE 断连时事件丢失 |
| 🔴 | 7.1 | cancel 时重建 config + ensureServer，重量级操作 |
| 🔴 | 7.2 | cancel 后 session ID 不清，下次复用旧 session |
| 🔴 | 2.1 | session ID 模块级变量，切换项目不自动清理 |
| 🔴 | 4.2 | 600 行内联 handler，手动状态机 |
| 🔴 | 4.6 | catch 块静默吞异常 |
| 🟡 | 10.2 | 会话打开不主动加载历史消息 |
| 🟡 | 14.1 | 手动 phase 状态机，finalize 后可能被迟到事件覆盖 |
| 🟡 | 11.2 | 文件内联为 text 而非 `file://` URL |
| 🟡 | 8.3 | 进程复用不检查 HTTP 响应性 |
| 🟡 | 4.4 | finalize 服务器重同步（不信任事件流） |
| 🟡 | 3.2 | 发送失败时消息不回滚 |
| 🟡 | 1.3 | 无乐观 part，无法去重 |
| 🟡 | 8.4 | HTTP 请求无超时保护 |
| 🟢 | 剩下的 | 输入格式、Markdown 同步、工具硬编码等 |

---

## Step 26: 成熟库对照 — SSE 事件流

> **发现**: 两个稳定运行的开源 Chat 项目 (WongSaang, Open WebUI) 都使用成熟的 SSE 库，无看门狗/杀进程/状态轮询等复杂度。
> 韭菜盒子的 `eventBridge.ts` (~150 行手写 SSE) 是这一切复杂度的根源。

### 对照表

| 维度 | 韭菜盒子 | WongSaang (Vue/Nuxt) | Open WebUI (Svelte) |
|------|----------|---------------------|---------------------|
| SSE 库 | **手写** `eventBridge.ts` (~150行) | `@microsoft/fetch-event-source` | `eventsource-parser/stream` |
| 重连 | 手动 250ms 固定间隔，无退避 | 库内置指数退避 | async generator，调用方控制 |
| Last-Event-ID | ❌ 无 | ✅ 库自动追踪 | ❌ 无（每次新请求） |
| 断线恢复 | ❌ 无自动续传 | ✅ 自动重连 + 续传 | ✅ generator 重建 |
| AbortController | 手写管理 | 库内置 + 传参 | 调用方传 signal |
| 隐藏 tab 支持 | ❌ 无 | ✅ requestTimeout 区分 | ❌ 无 |
| 看门狗 | ✅ 有 (120s) | ❌ 无 | ❌ 无 |
| 进程管理 | Tauri sidecar kill | ❌ 无（直连 API） | ❌ 无（直连 API） |
| 状态轮询 | 250ms status poll | ❌ 无 | ❌ 无 |
| 完成检测 | 4 层防御 | SSE stream end 即结束 | SSE stream end 即结束 |
| 事件处理 | 600 行内联 handler | ~100 行 `processEvent` | 分层: parser → generator → store |

### 库信息

| 库 | npm | GitHub | Stars | 维护者 |
|----|-----|--------|-------|--------|
| `@microsoft/fetch-event-source` | [npm](https://www.npmjs.com/package/@microsoft/fetch-event-source) | [Azure/fetch-event-source](https://github.com/Azure/fetch-event-source) | 1.8k | Microsoft Azure |
| `eventsource-parser` | [npm](https://www.npmjs.com/package/eventsource-parser) | [rexxars/eventsource-parser](https://github.com/rexxars/eventsource-parser) | 2.4k | rexxars (Sanity.io) |

### `@microsoft/fetch-event-source` 关键能力

```
fetchEventSource(url, {
  onmessage(msg) { /* 处理事件 */ },
  onerror(err) { /* 返回重试间隔(ms) 或 throw 终止 */ },
  signal: abortController.signal,
  openWhenHidden: true,     // 隐藏 tab 也保持连接
  fetch: customFetch,       // 可注入自定义 fetch (如加 auth header)
})
```

- **自动重连**: `onerror` 返回数字 = N ms 后重连（可用指数退避）
- **Last-Event-ID**: 自动发送 `Last-Event-Id` header，支持断线续传
- **隐藏 tab**: `openWhenHidden: true` 避免浏览器节流
- **零依赖**: 单文件 ~300 行，仅依赖 `fetch` API

### 韭菜盒子与成熟项目的本质差异

两个成熟项目都是 **无状态 SSE 消费**:
- 发消息 → 开 SSE → 收事件 → stream end → 结束
- 没有"看门狗"、"进程管理"、"状态轮询"、"finalize 重同步"
- SSE 就是事件源，信任 stream end，不需要额外完成检测

韭菜盒子因为手写 SSE 不可靠，层层加防御:
- SSE 可能断 → 加手动重连
- 重连可能丢事件 → 加 status poll
- poll 可能不准 → 加 watchdog
- watchdog 杀进程后消息可能丢失 → 加 finalize 重同步

**如果换上 `@microsoft/fetch-event-source`，至少可以砍掉:**
- `eventBridge.ts` 手动重连循环 (~50 行)
- watchdog 定时器 (~30 行)
- statusPoll 轮询 (~20 行)
- 部分 finalize 重同步逻辑（如果信任事件流）

---

## 开发原则：优先用成熟库

> **Step 26 的经验推广为通用原则**

### 原则

任何新功能开发前，按以下优先级：

1. **搜索成熟库** — npm / GitHub / awesome-lists，看有没有现成的、有维护的库
2. **能用就用** — 成熟库经过大量用户验证，边界情况比手写覆盖得好
3. **没有才手写** — 只有确定不存在合适的库时，才自己写
4. **手写了就对标** — 手写代码的功能边界对齐成熟库的 API 设计

### 反面教材

| 我们的代码 | 问题 | 成熟替代 |
|-----------|------|---------|
| `eventBridge.ts` (~150行手写SSE) | 无退避重连、无Last-Event-ID、无隐藏tab支持 | `@microsoft/fetch-event-source` |
| 看门狗+状态轮询+finalize重同步 (~80行) | 补偿手写SSE不可靠 | 不需要（成熟SSE库自带可靠性） |

### 正面清单（已验证可行的库）

| 场景 | 推荐库 | 说明 |
|------|--------|------|
| SSE 事件流 | `@microsoft/fetch-event-source` | 零依赖，自动重连+退避+Last-Event-ID |
| SSE 流解析 | `eventsource-parser` | 流式解析，Open WebUI 同款 |
| Vue 状态持久化 | `pinia-plugin-persistedstate` | Pinia store → localStorage/sessionStorage |
| IndexedDB | `dexie.js` | 比原生 IndexedDB 简洁，比我们的 `idb.ts` 成熟 |
| 安全存储 (Tauri) | `@tauri-apps/plugin-store` | Tauri 官方持久化存储 |

---

## Step 27: 会话记录持久化 — 为什么关了 APP 再开会话消失

### 问题

用户打开 APP → 选项目 → 聊天 → 关闭 APP → 重开 → **会话列表空白**，之前的聊天记录不见了。

### 根因链路

```
用户重开 APP
  → main.ts: mountApp()
    → ChatPanel.onMounted()
      → sessionStore.loadAllSessions()
        → if (isTauriRuntime()) return   ← 🔴 桌面端直接跳过！
      
      → listOpenCodeSessions()           ← 依赖 OpenCode Server 返回
        → OpenCode Server 冷启动 8-12s
          → 如果此时还没启动完 → 返回空列表
        
      → sessionStore.mergeOpenCodeSessions(空列表)
        → sessions.value = []            ← 空白
```

### 五个根因

| # | 根因 | 严重度 | 位置 |
|---|------|--------|------|
| **1** | **`loadAllSessions()` 桌面端是空操作** | 🔴 | `sessionStore.ts:347` — `if (isTauriRuntime()) return` |
| **2** | **`activeSessionId` 是全局单值，不按项目隔离** | 🔴 | `jc_active_session` 存在 localStorage，切换项目时清空 |
| **3** | **两次 `mergeOpenCodeSessions` 竞态** | 🟡 | `ChatPanel.onMounted()` 和 `fetchModels()` 各拉一次 |
| **4** | **IndexedDB 有完整记录但桌面端不读** | 🟡 | 消息在 `messages` 表，元数据在 `conversations` 表。但 `loadAllSessions()` 跳过 |
| **5** | **本地会话ID ↔ OpenCode会话ID 映射链断裂** | 🟡 | `sess_xxx → openCodeSessionId` 映射存在 IndexedDB，但桌面端不读 IndexedDB 会话列表 |

### OpenCode Desktop 怎么做

OpenCode Desktop **没有自己的 IndexedDB 会话层**：
- 会话列表：`client.session.list({ directory })` → 直接渲染
- 会话消息：`client.session.messages({ sessionID })` → 直接渲染
- 不维护两套 ID 映射，不存储 `jc_active_session`

韭菜盒子额外加了一层 IndexedDB，引入本地ID↔OpenCodeID映射，而桌面端这个映射断了。

### 成熟库方案

这个问题本质是**架构问题**而非"缺库"。但有两个库可以减少复杂度：

| 库 | 能解决什么 |
|----|-----------|
| `pinia-plugin-persistedstate` | 自动持久化 `sessionStore` 到 localStorage，去掉手写的 `localStorage.setItem('jc_active_session')` |
| `dexie.js` | 替代手写 `idb.ts`，减少 IndexedDB 操作 bug |

### 修复方向（架构层面）

1. **桌面端 `loadAllSessions()` 从 IndexedDB 加载**：去掉 `if (isTauriRuntime()) return`，IndexedDB 作为持久化事实源，OpenCode API 作为增量同步
2. **`activeSessionId` 按项目隔离**：`jc_active_session:{projectDir}`，切换项目时恢复该项目上次活跃会话而非清空
3. **简化映射**：减少「本地会话ID」这一层，直接用 OpenCode sessionID 作为主键

---

## Step 28: 登录持久化 — 为什么「记住我」反复修反复坏

### 问题

用户输入账号密码 → 勾选「保持登录」→ 关闭 APP → 重开 → **又要重新输入**。已修 4-5 次。

### 当前架构（三层存储）

```
macOS Keychain (Tauri secure store)  ← 最安全
  ↕ set_api_key / get_api_key
CLI 文件 (~/.jiucaihezi/cli_config)  ← jc_media.py 用
  ↕ 手动同步
localStorage (jcApiKey)              ← Web 端用
```

### 启动链路

```
main.ts: boot()
  └─ initApiKey().then(() => keyReadyResolve?.())  ← 🔴 不 await！
       │
       ├─ [Tauri] invoke('get_api_key') — Keychain 读取 (超时 8s)
       ├─ 有 Key → verifyApiKey(key) — GET /v1/models (超时 5s)
       │   ├─ 200 → ✅ 有效
       │   ├─ 401/403 → ❌ 清除 Keychain + CLI 文件
       │   └─ 网络错误 → ✅ 保留（断网不判定为无效）
       └─ [Web] localStorage.getItem('jcApiKey')
```

### 六个根因

| # | 根因 | 严重度 | 历史修复 |
|---|------|--------|---------|
| **1** | **`initApiKey()` 不 await** | 🔴 | 0708 加了 `keyReadyResolve` 但 `boot()` 仍不 await |
| **2** | **SettingsPanel watcher 竞态** | 🔴 | `watch(apiKeyReady)` 在 SettingsPanel 挂载后才监听，如果 `initApiKey()` 在此之前完成，watcher 永不触发 |
| **3** | **Keychain 读取是竞态** | 🟡 | 多个调用者并发调 `initApiKey()`，虽然 `apiKeyMemoryCache` 缓存但时序窗口存在 |
| **4** | **三层存储同步是 best-effort** | 🟡 | Keychain 写入成功但 CLI 文件同步失败时 `jc_media.py` 拿不到 Key |
| **5** | **`verifyApiKey` 网络容错逻辑** | 🟡 | 断网时保留 Key，Key 真过期+恰好断网 → 用户被困「看起来已登录但全部 401」 |
| **6** | **清除 Key 太激进** | 🟢 | 401/403 即清 Keychain，临时服务端问题（NewAPI 重启）→ 全员被迫重登 |

### OpenCode Desktop 怎么做

OpenCode Desktop 认证模型极简：
- **API Key 直接存在配置文件** `~/.opencode/config.json`
- **不调用 Keychain**，不维护多份副本
- **不做启动时预验证** (`verifyApiKey`)——直接发请求，401 时提示用户
- **单一事实源**——没有三层同步问题

### 成熟库方案

| 库 | 能解决什么 |
|----|-----------|
| `@tauri-apps/plugin-store` | 替代 Keychain + CLI 文件 + localStorage 三层，统一用 Tauri 官方持久化 store（存 `~/.jiucaihezi/settings.json`） |

Tauri Store 的优势：
- 单文件持久化，自动序列化/反序列化
- 不需要手动管理 Keychain 读写
- 不需要同步 CLI 文件——`jc_media.py` 直接读同一个 JSON 文件
- 比 Keychain 简单，比 localStorage 可靠（不会被浏览器清除）

### 修复方向（架构层面）

1. **`boot()` 中 `await initApiKey()`**：确保 Key 在后续操作前就绪
2. **SettingsPanel 双重检查**：`watch(apiKeyReady)` + `onMounted` 时检查 `apiKeyReady.value`
3. **简化存储层**：Keychain + CLI 文件 → Tauri Store 单一文件（`~/.jiucaihezi/settings.json`）
4. **`verifyApiKey` 区分网络错误 vs 认证错误**：401/403 清除，网络错误标记 `needsRevalidation`，网络恢复后自动重试
5. **去预验证**（激进方案）：学 OpenCode Desktop，不预验证，发请求 401 时再提示用户
## 2026-07-13：官方信息流翻译主线（v1.17.18）

旧结论“H-1 每消息新建事件流是可接受取舍”正式作废。Desktop 已改为官方等价的应用生命周期 `global.event` + reducer + 唯一 Sync Store，发送链路只保留真实 session、乐观消息、`promptAsync` 和失败回滚。

本轮同时删除每轮 SSE、状态轮询、完成后全量覆盖、120 秒杀进程 watchdog 和 `@microsoft/fetch-event-source`。用户消息消失/变形的直接根因是 mapper 没有把官方 user text part 投影到 `ChatMessage.content`，现已由合同测试覆盖。

自动验证已通过。真机文/武连续对话、本地 Ollama、重启恢复、项目隔离和 Intel baseline 后续已验证，结果见下方“收尾更正”；剩余项目未验收前不写“全部完成”。

### 2026-07-13 收尾更正

用户已验证文/武连续对话、本地 Ollama 回复、重启恢复、项目切换；Intel Mac 上 `deepseek-v4-flash` 已真实执行 `search + read` 并返回 Skill 原文，`global.event` CORS 循环未再出现。曾根据单次 DSML/思考响应把两个模型硬编码为 `tool_call:false`，该结论错误且已撤销：模型能力必须以官方目录为依据，异常响应应在 NewAPI/协议适配边界排查。

仍未验收：停止后继续、权限/问题真实交互，以及 Ollama 首 token/CPU/退出后进程数。不得把这些项目写成已通过。
