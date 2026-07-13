# Desktop OpenCode 官方信息流等价翻译 SDD

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `subagent-driven-development`（推荐）或 `executing-plans`，严格按阶段逐项执行并在每个 commit 后复核。

**Goal:** 把 Desktop 对话链路改成 OpenCode 官方等价的全局事件流和唯一 Sync Store，消除消息消失、会话错位和切模式失联。

**Architecture:** OpenCode SDK `global.event` 是唯一实时入口，官方事件 reducer 写入 Pinia Sync Store，Vue 只读取响应式投影；发送路径只保留 session create、optimistic add、`promptAsync` 和失败回滚。

**Tech Stack:** Tauri v2、Vue 3、Pinia、TypeScript、`@opencode-ai/sdk` 1.17.18、Node test runner。

---

> **状态**: Stage 0-7 自动验证已完成；Stage 7 Intel/Ollama/交互真机矩阵待用户确认
> **日期**: 2026-07-13  
> **适用范围**: 韭菜盒子 Desktop（Tauri + Vue）文本对话链路  
> **事实源**: `/Users/by3/Documents/opencode-official-v1.17.18/`（GitHub `anomalyco/opencode` Release `v1.17.18` 纯净源码）  
> **执行要求**: 其他 AI 必须逐阶段执行；每阶段测试通过并提交后才能进入下一阶段。Commit 必须标注“涉及常识 #N”。

## 0. 一句话决断

本项目不缺五模式、Skill、文件树、模型、媒体生成和画布。当前要做的唯一事情，是把 Desktop 的 OpenCode 消息信息流从“每次发送临时拼装状态”改成官方的“应用生命周期全局事件流 + 统一 Sync Store + Vue 响应式投影”。

这不是新增产品功能，也不是重新开发 Agent。它是修正已经接入的 OpenCode 客户端翻译。

---

## 1. 目标与非目标

### 1.1 目标

完成后必须满足：

1. 每个 OpenCode Server 只有一条应用生命周期 `global.event` 流。
2. OpenCode `session / message / part / status / permission / question / todo / diff` 只有一个权威 Store。
3. Desktop 会话只使用 OpenCode 的 `ses_*` ID，不再创建和映射本地 `sess_*` ID。
4. Vue 聊天界面只投影 Store，不在事件回调中手工拼消息。
5. 发送只负责：创建真实 session、乐观加入用户消息、调用 `promptAsync`、失败回滚。
6. 切换文/武模式、模型、Skill、项目和会话时，已有消息不会消失、串线或停止接收事件。
7. Web 端现有云对话和 IndexedDB 存储行为不变。

### 1.2 明确不做

以下能力已经存在，本 SDD 禁止重做或改产品定义：

- 不新增“创作模式”；保留现有文模式和武模式。
- 不重做或删除 Skill 管理、Skill 选择、Skill 指令加载。
- 不重做项目文件树和本地文件 CRUD。
- 不改 NewAPI、Ollama 和媒体模型接入。
- 不改媒体任务、创作面板和 LeaferJS 画布。
- 不改现有消息视觉设计、Markdown、工具卡片和滚动体验，除非数据源切换要求删除旧状态写入。
- 不翻译与当前消息信息流无关的 LSP、VCS UI、终端 UI 或编程专属页面。
- 不引入新的状态库、SSE 库或事件总线库；Vue、Pinia 和已安装的 OpenCode SDK 足够。
- 不同时保留两套可切换聊天内核，不增加 feature flag。

### 1.3 Web/Desktop 边界

| 运行环境 | 会话真源 | 消息真源 | 本 SDD 是否修改 |
|---|---|---|---|
| Desktop | OpenCode Server | OpenCode Server + 全局事件 Store | 是 |
| Web | 现有云端接口 | 现有云快照 + IndexedDB | 否 |
| 媒体任务 | `mediaTaskStore` | 媒体任务 Store | 否 |

---

## 2. 已确认根因

### 2.1 当前实现有三套并存状态

1. OpenCode Server 内的真实 `session/message/part/status`。
2. `src/composables/useChat.ts` 的模块级 `messages`、`activeRunId`、`activeOpenCodeSessionId` 和单轮临时 Map。
3. `src/stores/sessionStore.ts` 的本地 `sess_*`、IndexedDB 会话记录和 `openCodeSessionId` 映射。

### 2.2 直接证据

- `useChat.ts` 在每次 `sendMessage()` 内调用 `subscribeOpenCodeEvents()`，完成时关闭订阅。
- 事件先经过 `runId === activeRunId` 过滤；切会话或新发送会让旧事件失效。
- `ChatPanel.vue` 发送前先调用 `sessionStore.startNewSession()` 创建 `sess_*`。
- `ChatPanel.vue` 发送前写 `saveSessionPreview()`，发送后再调用 `linkOpenCodeSession()`。
- Desktop 会话列表来自 OpenCode `session.list()`，但发送过程又会临时向同一个列表塞本地会话。
- 完成时 `useChat.ts` 再全量请求消息并调用 `replaceMessagesPreservingPrompt()`，事件状态和拉取状态互相覆盖。

这套结构可以解释用户已复现的症状：会话记录不出现、用户消息消失或变形、切模式后收不到回复、重启后历史恢复不一致。

### 2.3 旧交接结论作废

`OpenCode差异修复记录.md` 中“H-1 每消息新建事件流是可接受设计取舍”“Tauri/JS 做不到全局单例”的判断不成立。官方全局流依赖的是 SDK、AbortController 和应用生命周期，不依赖 SolidJS Effect 才能存在。Vue/Tauri 可以等价翻译。

---

## 3. 官方事实源与翻译边界

| 官方文件 | 官方职责 | 韭菜盒子目标文件 |
|---|---|---|
| `packages/app/src/context/server-sdk.tsx` | `global.event`、队列、合并、心跳、重连、按目录分发 | `src/opencodeClient/eventBridge.ts` |
| `packages/app/src/context/server-sync.tsx` | 启动全局流、bootstrap、事件进入 Store | `src/stores/openCodeSyncStore.ts` |
| `packages/app/src/context/server-session.ts` | session/message/part/status 缓存、乐观消息、事件归并 | `src/stores/openCodeSyncStore.ts` + `src/opencodeClient/eventReducer.ts` |
| `packages/app/src/context/global-sync/event-reducer.ts` | session 列表及目录事件归并 | `src/opencodeClient/eventReducer.ts` |
| `packages/app/src/context/directory-sync.ts` | 当前目录响应式投影 | `src/stores/openCodeSyncStore.ts` getters |
| `packages/app/src/components/prompt-input/submit.ts` | session 创建、optimistic、`promptAsync`、失败回滚 | `src/composables/useChat.ts` Desktop 分支 |
| `packages/app/src/pages/session/timeline/model.ts` | Store 到消息时间线投影 | 复用 `src/opencodeClient/messageMapper.ts` |

翻译原则：

- 事件协议、状态字段、排序、乐观确认、重连时序照官方。
- SolidJS `createStore/batch/reconcile` 翻译成 Pinia `reactive/computed` 和一次同步 mutation。
- Electron/页面生命周期翻译成 Vue `onMounted/onBeforeUnmount` 与 Tauri 应用生命周期。
- 现有 `ChatMessage` 仅作为 UI 投影类型，不再作为 Desktop 权威存储类型。

---

## 4. 版本硬门槛

### 4.1 阶段 0 执行前版本（历史快照）

| 项目 | 当前版本 |
|---|---|
| `@opencode-ai/sdk` | `1.17.9` |
| ARM Desktop 二进制 | `1.17.9` |
| Intel Desktop 二进制 | `1.17.4`，且不是 baseline 构建 |
| `opencode-runtime.json` | `1.17.9` |
| `src/data/opencodeRuntimeInfo.ts` | 错写为 `1.17.13` |
| 本地官方源码 | `1.17.13` |

### 4.2 本 SDD 的版本决策

按用户 2026-07-13 决策，本次直接对齐 GitHub 官方最新正式 Release `v1.17.18`，不再以旧内核版本为目标：

1. SDK 固定为 `@opencode-ai/sdk@1.17.18`。
2. ARM 内核使用官方 `opencode-darwin-arm64.zip`。
3. Intel 内核使用官方 `opencode-darwin-x64-baseline.zip`。
4. Linux/Windows x64 更新器也只选择官方 baseline 资产。
5. 信息流翻译只对照 `/Users/by3/Documents/opencode-official-v1.17.18/`，不使用带韭菜盒子定制改动的 OpenCode fork 作为事实源。
6. SDK、内核、manifest、前端展示和官方源码版本必须一致。

当前复验事实：SDK、ARM runtime、Intel baseline runtime、manifest 和前端元数据均为 `1.17.18`；本机 ARM 二进制 `--version` 已实测通过。

版本门槛只保证协议同源，不允许借此升级模型、工具或 UI 功能。

---

## 5. 目标架构

```text
Tauri 启动 OpenCode Server
          ↓
OpenCode SDK client.global.event()       每个 Server 一条，应用生命周期
          ↓
eventBridge                              16ms 批处理、delta 合并、心跳、重连
          ↓ { directory, payload }
eventReducer                             纯状态归并，不操作 UI
          ↓
openCodeSyncStore                        唯一 Desktop 真源
  session / message / part / status
  permission / question / todo / diff
          ↓
Pinia computed projection
          ↓
messageMapper                            原始 SDK 数据 → 现有 ChatMessage
          ↓
ChatPanel / FileTree / Dock               只读 Store，保留现有界面
```

发送链路：

```text
用户点击发送
  ↓
没有 session → OpenCode session.create() → 得到 ses_*
  ↓
optimistic.add(user message + parts)
  ↓
session.promptAsync()
  ├─ 提交失败 → optimistic.remove() + 恢复输入 + 显示错误
  └─ 提交成功 → 立即返回，之后只由全局事件更新 Store
```

禁止重新出现以下路径：

```text
sendMessage → 新建 SSE → 手工拼 assistant → idle 后全量覆盖 → 关闭 SSE
sess_* → 映射 openCodeSessionId → 再替换成 ses_*
```

---

## 6. 状态模型与不变量

### 6.1 Store 最小状态

```ts
type OpenCodeSyncState = {
  connected: boolean
  ready: boolean
  error: string
  serverKey: string
  activeDirectory: string
  activeSessionId: string
  sessionsByDirectory: Record<string, Session[]>
  sessionInfo: Record<string, Session | undefined>
  sessionStatus: Record<string, SessionStatus | undefined>
  sessionDiff: Record<string, SnapshotFileDiff[] | undefined>
  todos: Record<string, Todo[] | undefined>
  permissions: Record<string, PermissionRequest[] | undefined>
  questions: Record<string, QuestionRequest[] | undefined>
  messages: Record<string, Message[] | undefined>
  parts: Record<string, Part[] | undefined>
}
```

只有实现当前 UI 已使用的信息域。Provider、LSP、MCP、文件树和媒体任务继续使用现有 Store，不复制进本 Store。

### 6.2 必须长期成立的不变量

1. Desktop `activeSessionId` 为空或以 `ses_` 开头，绝不以 `sess_` 开头。
2. `messages[sessionID]` 按 message ID 稳定排序；`parts[messageID]` 按 part ID 稳定排序。
3. `message.part.delta` 只修改已经存在的 part；父消息/part 尚未到达时不得制造可见孤儿。
4. 非当前会话事件也必须写入 Store；切回会话时直接显示最新状态。
5. bootstrap 请求与同时到达的事件合并，事件更新不得被较晚返回的旧快照覆盖。
6. 乐观用户消息使用提交给 `promptAsync` 的同一个 `messageID` 和 part ID；官方确认后原位合并，不生成第二条。
7. `session.status` 是运行状态真源；UI 的 `isStreaming` 是 getter，不再独立写入。
8. `session.idle` 不关闭全局事件流、不杀进程、不触发全量消息覆盖。
9. SSE 重连不清 Store；重连成功后只补 bootstrap/缺失数据。
10. 切文/武、模型或 Skill 只改变下一条 prompt 的 metadata，不更换 session、不清消息。
11. 切项目只改变目录投影，不删除其他目录 Store；项目间消息按事件 envelope 的 directory 隔离。
12. Desktop 文本消息不写 IndexedDB；Web 行为维持原样。

---

## 7. 文件职责锁定

### 7.1 新建文件

| 文件 | 唯一职责 |
|---|---|
| `src/opencodeClient/eventReducer.ts` | 把一个官方 Event 纯粹归并到 Store 状态 |
| `src/opencodeClient/__tests__/eventReducer.test.ts` | 官方事件序列的 reducer 合同测试 |
| `src/stores/openCodeSyncStore.ts` | 全局流生命周期、bootstrap、唯一状态、乐观消息和投影 getter |
| `src/stores/__tests__/openCodeSyncStore.test.ts` | bootstrap/事件竞态、session 身份、发送回滚测试 |

### 7.2 修改文件

| 文件 | 修改内容 |
|---|---|
| `src/opencodeClient/eventBridge.ts` | 改用 SDK `client.global.event()`；翻译官方队列、合并、心跳和重连 |
| `src/opencodeClient/__tests__/eventBridge.test.ts` | 改成 global event envelope、单例、合并、停止测试 |
| `src/opencodeClient/client.ts` | 提供无 directory 的 server client 和按 directory 的 client；不再依赖一个可变全局 client |
| `src/opencodeClient/messageMapper.ts` | 只补 Store 原始 message+parts 到现有 `ChatMessage` 的纯投影入口 |
| `src/opencodeClient/session.ts` | 保留 API payload/command helper；删除被 Sync Store 取代的消息缓存和 status polling helper |
| `src/composables/useChat.ts` | 保留 Web 分支和公共 UI contract；Desktop 改为调用 Sync Store，删除单轮 SSE 内核 |
| `src/components/chat/ChatPanel.vue` | Desktop 直接使用真实 `ses_*`；删除本地预览、ID 映射和切会话二次拉取 |
| `src/stores/sessionStore.ts` | 保留 Web/IndexedDB；Desktop 会话列表投影 Sync Store，不再创建本地 session |
| `src/components/filetree/FileTreePanel.vue` | 历史列表刷新读取 Sync Store 投影，不再无 client 调 `loadAllSessions()` |
| `src/App.vue` | Desktop 挂载时启动 Sync Store，卸载时停止；Web 不启动 |
| `scripts/run-focused-tests.mjs` | 注册新增 reducer/store 测试 |
| `package.json` / `pnpm-lock.yaml` | `eventBridge` 完成后删除不再使用的 `@microsoft/fetch-event-source` |
| `scripts/update-opencode-runtime.mjs` | Intel 使用 baseline 资产并保证版本元数据对应实际二进制 |
| `src/data/opencodeRuntimeInfo.ts` | 由更新脚本生成真实版本，不手填 |

### 7.3 禁止修改文件

除非测试证明信息流切换必须改调用签名，否则不要修改：

- `src/stores/agentStore.ts` 的模型业务规则。
- `src/stores/skillsManageStore.ts` 和 `src/runtime/connection/skillConnectionAdapter.ts`。
- `src/stores/mediaTaskStore.ts`、`src/runtime/creation/`。
- `src/components/creation/`、`src/components/canvas/`。
- `src-tauri/src/commands/dev.rs` 的文件工具。

---

## 8. 分阶段执行计划

### 阶段 0：冻结协议版本和失败样本

**目标**: 在改信息流前证明实际 SDK/runtime 版本，并把当前错误结构固定成测试。

**文件**:

- 修改 `scripts/update-opencode-runtime.mjs`
- 修改 `src/utils/__tests__/opencodeRuntimePackaging.test.ts`
- 修改 `src/data/opencodeRuntimeInfo.ts`
- 新建 `src/stores/__tests__/openCodeSyncStore.test.ts`

**步骤**:

- [ ] 运行两个内核的 `--version`，记录 ARM、Intel 和 SDK 版本。
- [ ] 增加打包测试：manifest、前端 runtime info、目标二进制版本必须相同。
- [ ] 增加 Intel 资产测试：x64 macOS 必须选择 baseline 发布资产。
- [ ] 增加失败合同测试：Desktop 新会话 ID 不得由 `createSessionId()` 生成 `sess_*`。
- [ ] 运行新增测试，确认在现状下失败。
- [ ] 只修版本清单和 Intel 资产选择，不改聊天逻辑。
- [ ] 运行 `pnpm run test:focused`。
- [ ] 提交：`test: freeze OpenCode 1.17.18 information-flow baseline（涉及常识 #27）`。

**通过标准**:

```text
SDK version == ARM runtime version == Intel runtime version == manifest version == frontend info version
```

官方 `v1.17.18` 已提供 Intel baseline；不得回退到普通 x64 构建或旧版内核。

### 阶段 1：翻译官方全局事件流

**目标**: 事件流脱离 `sendMessage()`，每个 Server 只启动一次。

**文件**:

- 修改 `src/opencodeClient/eventBridge.ts`
- 修改 `src/opencodeClient/client.ts`
- 修改 `src/opencodeClient/__tests__/eventBridge.test.ts`

**官方常量必须等价翻译**:

```ts
const FLUSH_FRAME_MS = 16
const STREAM_YIELD_MS = 8
const RECONNECT_DELAY_MS = 250
const HEARTBEAT_TIMEOUT_MS = 15_000
```

**事件入口合同**:

```ts
type QueuedServerEvent = {
  directory: string
  payload: Event
}

type OpenCodeEventBridge = {
  start(): Promise<void> | void
  stop(): void
  subscribe(handler: (event: QueuedServerEvent) => void): () => void
}
```

**步骤**:

- [ ] 测试：连续调用两次 `start()` 只调用一次 `client.global.event()`。
- [ ] 测试：`{directory, payload}` envelope 原样路由，`sync` 事件跳过。
- [ ] 测试：同一 directory/messageID/partID/field 的相邻 delta 在一帧内合并。
- [ ] 测试：相邻 `message.part.updated` 只保留最后一个，其余事件保持顺序。
- [ ] 测试：15 秒无心跳会 abort 当前 attempt，250ms 后重连，但不会创建第二条并行流。
- [ ] 用 SDK `client.global.event()` 替换手写 `/event?directory=` 请求。
- [ ] 翻译官方 queue/buffer/flush/yield/heartbeat/generation 逻辑。
- [ ] 新 global bridge 先作为未接线基础设施存在；旧 `subscribeOpenCodeEvents()` 保持原行为，直到阶段 5 原子切换。两者不得同时在运行态启动。
- [ ] 运行 `pnpm run test:focused` 和 `pnpm exec vue-tsc -b`。
- [ ] 提交：`feat: translate OpenCode global event stream（涉及常识 #2）`。

**通过标准**:

- 一次应用运行中，同一 Server 日志只出现一次 global stream start。
- 事件流跨 session idle 持续存在。
- 后台/前台恢复后最多一条活动流。

### 阶段 2：建立唯一 Sync Store 和 reducer

**目标**: 所有 session 相关事件先进入 Store，不再直接写 UI。

**文件**:

- 新建 `src/opencodeClient/eventReducer.ts`
- 新建 `src/opencodeClient/__tests__/eventReducer.test.ts`
- 新建 `src/stores/openCodeSyncStore.ts`
- 新建 `src/stores/__tests__/openCodeSyncStore.test.ts`

**reducer 必须覆盖现有 UI 已消费事件**:

```text
session.created / session.updated / session.deleted
session.status / session.diff
message.updated / message.removed
message.part.updated / message.part.delta / message.part.removed
permission.asked / permission.replied
question.asked / question.replied / question.rejected
todo.updated
```

实验 `session.next.*` 事件不得成为消息真源。若 1.17.18 同时发送标准 part 事件和实验事件，只消费标准事件；实验事件仅可用于现有的非权威提示信息，并在最终删除旧内核前证明是否还需要。

**步骤**:

- [ ] 用真实官方事件形状编写 reducer 测试，不复制当前自定义 normalize 形状。
- [ ] 测试完整顺序：optimistic user → `message.updated` → `message.part.updated` → 多个 delta → `session.status: idle`。
- [ ] 测试非当前 session 的事件仍保留，切换 getter 后内容完整。
- [ ] 测试 message/part 删除、permission/question/todo/diff 更新。
- [ ] 测试 part 早于 parent 时不产生可见孤儿，后续 bootstrap 能正确归并。
- [ ] 实现纯 `applyOpenCodeEvent(state, event)`；函数内禁止网络请求、UI emit 和 toast。
- [ ] Store `start()` 先注册 bridge subscriber，再 bootstrap，避免启动窗口漏事件。
- [ ] `start()` 通过现有 provider projection 和 `ensureOpenCodeServer()` 获取 handle，再创建无 directory 的 global client；以 `url + authorization` 作为 server key，重复调用必须幂等。
- [ ] `setActiveDirectory(directory)` 只切换目录 getter并按需 bootstrap；`ChatPanel` 现有项目 watcher 改为调用它，不重启 global stream。
- [ ] 收到 `server.connected` 后保留现有 Store 并重新 bootstrap 已激活目录；Server key 真正变化时停止旧 bridge，再启动新 bridge。
- [ ] bootstrap 加载当前目录 sessions；打开 session 时加载 message page、todo、diff。
- [ ] 用 touched/optimistic 集合解决“事件到达期间 fetch 返回旧快照”的覆盖竞态。
- [ ] 本阶段只通过注入的假 bridge 测试 Store，不在 `App.vue` 启动，不改变当前生产聊天路径。
- [ ] 运行 focused tests 和类型检查。
- [ ] 提交：`feat: add OpenCode session sync store and reducer（涉及常识 #20）`。

**通过标准**:

- 给 reducer 重放同一官方事件序列两次，结果不重复消息和 part。
- bootstrap 慢于事件返回时，新事件内容仍保留。
- Store 能同时保存两个 session 的实时状态。

### 阶段 3：完成真实 session 身份和历史 API（未接 UI）

**目标**: 先在 Sync Store 内完成真实 `ses_*` 的创建、打开、列表和缓存合同，不改当前生产 UI。

**文件**:

- 修改 `src/stores/openCodeSyncStore.ts`
- 修改 `src/stores/__tests__/openCodeSyncStore.test.ts`

**步骤**:

- [ ] 测试新草稿没有伪 session ID；首次发送调用 `session.create()`，返回值直接成为 active ID。
- [ ] 测试 `rootSessions(directory)` 的标题、时间和目录全部来自 OpenCode session。
- [ ] 测试 session created/updated 事件立即更新列表，无需二次 `session.list()`。
- [ ] 测试 `openSession(sessionID)` 按需加载 messages/todo/diff，并复用已有缓存。
- [ ] 测试子任务/fork 返回的真实 session ID 可直接打开，不需要 wrapper ID。
- [ ] 实现 `ensureSession()`、`openSession()`、`newDraft()` 和目录 session getters。
- [ ] 本阶段不修改 `sessionStore`、`ChatPanel` 和 `FileTreePanel`，生产路径保持不变。
- [ ] 运行 focused tests 和类型检查。
- [ ] 提交：`feat: prepare official OpenCode session identity APIs（涉及常识 #6）`。

**通过标准**:

- Store 单元测试内所有 Desktop session ID 都是 `ses_*`。
- 同一个 session 的重复 open 不重复请求已缓存页面。
- 新 session 事件可在列表 getter 中立即看到。

### 阶段 4：完成 Store 到现有 UI contract 的纯投影（未接 UI）

**目标**: 先证明原始 Store 数据可以无损投影成现有 `ChatMessage` 和 Dock 数据，不改变运行态数据源。

**文件**:

- 修改 `src/opencodeClient/messageMapper.ts`
- 修改 `src/opencodeClient/__tests__/messageMapper.test.ts`
- 修改 `src/stores/openCodeSyncStore.ts`
- 修改 `src/stores/__tests__/openCodeSyncStore.test.ts`

**步骤**:

- [ ] 测试 mapper 对同一 Store 输入是纯函数且 ID 稳定。
- [ ] 测试用户 message 的 text part 永远投影到用户气泡，工具/系统内容不能覆盖它。
- [ ] 测试切换 active session 只切 computed 投影，不清空其他 session 数据。
- [ ] 测试 `isStreaming` 只由 active session 的 `sessionStatus` 推导。
- [ ] 实现 `chatMessages`、`activePermissions`、`activeQuestions`、`activeTodos`、`activeDiffs` 和 `isStreaming` getters。
- [ ] 本阶段不修改 `useChat` 和 `ChatPanel`，避免新旧流在运行态并存。
- [ ] 运行 focused tests 和类型检查。
- [ ] 提交：`feat: prepare Vue projections from OpenCode sync state（涉及常识 #13）`。

**通过标准**:

- 固定事件序列经过 Store 和 mapper 后，用户原文、助手 part、工具状态均与 API 快照一致。
- 非当前 session 数据保留，切换 getter 后立即得到正确投影。

### 阶段 5：原子切换 Desktop 读写链路

**目标**: 在一个执行批次内同时切换全局流、session 身份、Vue 读取和发送路径；批次结束前不交付 Desktop 构建。

**文件**:

- 修改 `src/composables/useChat.ts`
- 修改 `src/components/chat/ChatPanel.vue`
- 修改 `src/components/filetree/FileTreePanel.vue`
- 修改 `src/stores/sessionStore.ts`
- 修改 `src/App.vue`
- 修改 `src/opencodeClient/session.ts`
- 修改 `src/stores/openCodeSyncStore.ts`
- 修改 `src/stores/__tests__/webSessionHistory.test.ts`
- 修改 `src/stores/__tests__/openCodeSyncStore.test.ts`
- 修改 `src/opencodeClient/__tests__/session.test.ts`
- 修改 `src/composables/__tests__/useChatControls.test.ts`

**发送合同**:

```ts
async function sendDesktopPrompt(input: SendMessageOptions & { text: string }) {
  const sessionID = await sync.ensureSession(input)
  const messageID = createOfficialMessageID()
  const parts = buildOpenCodePromptParts(input)
  sync.optimistic.add({ sessionID, messageID, parts, agent: input.openCodeAgent, model: input.model })
  try {
    await fireOpenCodePrompt(client, { ...input, sessionID, messageID, parts })
  } catch (error) {
    sync.optimistic.remove({ sessionID, messageID })
    throw error
  }
}
```

实际实现必须使用项目现有 OpenCode ID 生成规则或 SDK 官方生成器，不能用 `Date.now()` 伪造不符合 schema 的 ID。

**步骤**:

- [ ] 测试 Web：`startNewSession()`、IndexedDB 保存和恢复行为保持不变。
- [ ] `App.vue` 仅在 Tauri 下启动 global bridge；Web 不启动。
- [ ] `sessionStore` 保留 Web 数据；Desktop getters 原子切换到 Sync Store。
- [ ] 删除 Desktop `saveSessionPreview()`、`linkOpenCodeSession()` 和 `openCodeSessionId` 映射调用。
- [ ] 删除 Desktop 切会话双加载，改为 `syncStore.openSession(sessionID)`；新对话只调用 `newDraft()`。
- [ ] 历史列表、子任务和 fork 直接使用真实 `ses_*`。
- [ ] `useChat` 保留现有返回 API；Desktop 的消息、运行状态、权限、问题、Todo 和 diff 全部读取 Store getter，Web 继续使用原 refs。
- [ ] 测试 prompt 提交前用户消息已可见，且使用与请求相同的 message/part ID。
- [ ] 测试 `promptAsync` 失败会移除乐观消息并恢复可再次发送状态。
- [ ] 测试成功返回 204 不代表完成；Store 保持 busy，直到收到 `session.status: idle`。
- [ ] 测试文→武→文、云模型→本地模型只改变下一条请求 metadata，session ID 不变。
- [ ] 保留现有 Skill system instruction、permission scope、附件 parts、agent/model 选择和插件 before/after hook。
- [ ] 从 `sendMessage()` 删除 `subscribeOpenCodeEvents()`、status poll、finalize timer 和 120 秒 kill-process watchdog。
- [ ] 删除 Desktop 运行态的 `assistantByMessageId`、`roleByMessageId`、`partOwnerByPartId`、`streamingParts`、`streamingTools` 和 `replaceMessagesPreservingPrompt()`。
- [ ] `stopStream()` 只调用当前 client 的 `session.abort()`；不清 session ID，不停止 global stream。
- [ ] 错误由提交失败或 Store 中官方 error/status 投影，不插入第二条伪 assistant 错误消息。
- [ ] 运行 focused tests、类型检查和 Rust 检查。
- [ ] 提交：`refactor: switch Desktop to OpenCode global sync flow（涉及常识 #20）`。

**通过标准**:

- `sendMessage()` 内不存在事件订阅、轮询和全量消息回读。
- Desktop 运行期间 active session 不出现 `sess_*`，历史列表直接显示真实 session。
- 用户发送的“你好”在完成、切模式、切会话后文字不变。
- MessageBubble、PermissionDock、QuestionDock、TodoDock 和 ReviewPanel 不维护第二份 OpenCode 状态。
- `session.idle` 后继续发送第二、第三条时复用同一真实 session。
- Abort 后仍可在同一 session 继续发送，历史不丢。

### 阶段 6：删除旧内核和无用依赖

**目标**: 旧状态路径彻底消失，避免以后修 Bug 又误接回去。

**文件**:

- 修改 `src/composables/useChat.ts`
- 修改 `src/opencodeClient/session.ts`
- 修改 `src/stores/sessionStore.ts`
- 修改 `src/opencodeClient/eventBridge.ts`
- 修改 `package.json`
- 修改 `pnpm-lock.yaml`
- 修改 `scripts/run-focused-tests.mjs`

**必须删除的旧结构**:

```text
activeRunId 对 Desktop 事件的过滤
lastLocalSessionId
每轮 eventSubscription
statusPollTimer / finalizeTimer / idleTimer
finalizeOpenCodeRun / scheduleFinalizeOpenCodeRun
Desktop final listOpenCodeChatMessages 覆盖
Desktop saveSessionPreview / linkOpenCodeSession
Desktop sess_* → ses_* 映射
只服务旧 SSE 的 @microsoft/fetch-event-source
```

Web 端仍使用的 `activeRunId`、AbortController 或本地 messages 不得误删；删除时按调用方逐项确认。

**步骤**:

- [ ] `rg` 搜索上述符号，区分 Web 与 Desktop 调用方。
- [ ] 删除只服务旧 Desktop 路径的代码和缓存。
- [ ] 删除 `@microsoft/fetch-event-source`，运行 `pnpm install --lockfile-only` 更新锁文件。
- [ ] 增加静态合同测试：`useChat.ts` 不得引用 `subscribeOpenCodeEvents`、Desktop status poll 和 `linkOpenCodeSession`。
- [ ] 运行 `pnpm run test:focused`。
- [ ] 运行 `pnpm exec vue-tsc -b`。
- [ ] 运行 `cargo check --manifest-path src-tauri/Cargo.toml`。
- [ ] 提交：`refactor: remove legacy per-run OpenCode chat state（涉及常识 #11）`。

**通过标准**:

- Desktop 只有 Sync Store 持有 OpenCode 消息状态。
- `useChat.ts` Desktop 部分只剩命令调用和公共 UI facade，不再是事件 reducer。
- 删除代码量应明显大于新增胶水代码量；若不是，先检查是否保留了重复状态。

### 阶段 7：官方事件序列与真机验收

**目标**: 用自动测试证明状态机，用真机证明用户工作流。

**自动验证**:

```bash
pnpm run test:focused
pnpm exec vue-tsc -b
cargo check --manifest-path src-tauri/Cargo.toml
pnpm run build:desktop
```

全部命令必须退出码为 0。

**事件序列对照测试**:

- [ ] 录制官方 OpenCode 1.17.18 的“新会话→你好→idle”事件序列。
- [ ] 录制“同 session 文→武→文连续发送”事件序列。
- [ ] 录制“工具调用→结果→继续生成→idle”事件序列。
- [ ] 录制“permission/question→用户响应→继续生成”事件序列。
- [ ] 录制“abort→同 session 再发送”事件序列。
- [ ] 将序列重放给 reducer，断言最终 Store 与官方 session/messages API 快照一致。

**Desktop 手动验收矩阵**:

| # | 操作 | 必须结果 |
|---|---|---|
| 1 | 武模式新会话发“你好” | 会话立即出现；用户文字不变；有回复 |
| 2 | 同 session 切文模式再发“继续” | 不新建会话；两轮消息都在；有回复 |
| 3 | 同 session 再切武模式调用一个只读工具 | 工具状态完整；完成后继续回复 |
| 4 | 文模式连续发送 3 条 | 每条都回复；无消息消失、替换或串线 |
| 5 | 生成中切到另一个历史会话，再切回 | 后台事件未丢；返回后看到最新输出 |
| 6 | 新建第二会话 | 历史出现两个真实 `ses_*`，标题和时间正确 |
| 7 | 重启 APP | 两个会话及消息从 OpenCode 恢复 |
| 8 | 切换项目 A/B | 两边会话独立；切回后状态保持 |
| 9 | 云模型切本地 Ollama | session 不变；本地模型运行后正常显示结果 |
| 10 | 中途停止，再继续发送 | 不清历史；同 session 可继续 |
| 11 | 触发权限和问题 | Dock 出现一次；回答后消失并继续执行 |
| 12 | Intel Mac 真机重复 1-10 | 使用 1.17.18 baseline；无 AVX 警告和协议差异 |

任何一项失败，都回到首次产生错误状态的 reducer/identity/transport 阶段修根因；禁止在 MessageBubble 或按钮事件上加临时补丁。

---

## 9. 完成定义

只有同时满足以下条件，才能把本 SDD 标记为完成：

- [x] 版本门槛通过，未通过平台仍不宣称已完成真机验收。
- [x] 每个 Server 一条 global event，跨 session 持续运行。
- [x] Desktop 所有会话 ID 都是 OpenCode `ses_*`。
- [x] Desktop UI 只从 Sync Store 投影消息和交互状态。
- [x] 发送路径只有 session create、optimistic、promptAsync、rollback。
- [x] 旧的每轮 SSE、状态轮询、final resync、本地 ID 映射已删除。
- [x] Web 对话、Skill、文件树、模型、媒体任务、创作面板和画布回归测试通过。
- [x] 自动验证全绿。
- [ ] 手动验收矩阵全绿并保存日志。
- [x] 更新 `OpenCode差异修复记录.md`、`AI编程生存手册.md`、`docs/wiki/hot.md` 和本文状态。

### 2026-07-13 执行记录

- 已对齐 GitHub 官方 Release `v1.17.18`：SDK、ARM runtime、Intel baseline、manifest、前端元数据一致。
- 已完成全局 `client.global.event()`、16ms 批处理、delta 合并、15s heartbeat、250ms 重连。
- 已完成 reducer、Pinia Sync Store、真实 `ses_*` 身份、bootstrap 竞态保护和 Vue 投影。
- 已完成 Desktop 原子切换：发送使用 optimistic + `promptAsync`；消息、状态、权限、问题、Todo、diff 来自 Sync Store。
- 已删除每轮 SSE、status poll、final resync、120 秒 kill watchdog 与 `@microsoft/fetch-event-source`。
- 已修复用户消息 text part 未投影导致“你好”消失/变形，以及提交失败未恢复编辑器的问题。
- 验证：OpenCode 专项 `52/52`、Desktop 切换合同 `6/6`、`vue-tsc`、`cargo check` 全部通过。
- 未宣称全部发布验收完成：已在 Apple Silicon 覆盖文/武、本地 Ollama、重启、项目切换及云模型工具调用；Intel Mac、停止后继续、权限/问题交互、Ollama 性能与退出进程仍待验证。

## 11. 2026-07-13 并发审计阻塞项

> 本节保留三路只读审计的根因证据，已核对官方 `v1.17.18` 源码并完成修复。自动验证不再阻塞 Stage 7；仍未完成的项目只属于真机验收，不得提前宣称全部发布验收完成。

### P0：已完成修复，保留审计证据

1. **重命名会话会杀掉 sidecar，旧 global event 不会重连**
   - [ChatPanel.vue:703](/Users/by3/Documents/jiucaihezi-app/src/components/chat/ChatPanel.vue:703) 使用空配置调用 `ensureOpenCodeServer()`。
   - [src-tauri/src/commands/opencode.rs:461](/Users/by3/Documents/jiucaihezi-app/src-tauri/src/commands/opencode.rs:461) 按配置签名替换进程。
   - 必须改为复用当前完整配置，或重启后由 Sync Store 重新建立 global client、bridge、directory bootstrap。

2. **切项目的顺序错误且存在双重重启竞态**
   - [ChatPanel.vue:335](/Users/by3/Documents/jiucaihezi-app/src/components/chat/ChatPanel.vue:335) 与 [App.vue:39](/Users/by3/Documents/jiucaihezi-app/src/App.vue:39) 同时触发连接/项目切换。
   - 必须先对旧 session 调用 `session.abort()`，再切 active directory，最后只做一次 bootstrap；不能用杀进程代替 abort。

3. **恢复 busy session 后 Stop 可能无效**
   - [useChat.ts:1115](/Users/by3/Documents/jiucaihezi-app/src/composables/useChat.ts:1115) 依赖只在当前发送时设置的 `lastActiveClient`。
   - 必须从 Sync Store 当前 directory/client 获取 abort client；历史恢复、重连、切会话后也必须可停止。

4. **权限回复失败会永久隐藏权限卡**
   - [useChat.ts:548](/Users/by3/Documents/jiucaihezi-app/src/composables/useChat.ts:548) 在服务端成功前删除 pending request。
   - 必须以 `permission.replied` 事件作为移除条件；网络失败时保留请求并允许重试。

5. **断线重连没有重新 bootstrap/reconcile**
   - [openCodeSyncStore.ts:74](/Users/by3/Documents/jiucaihezi-app/src/stores/openCodeSyncStore.ts:74) 未处理 `server.connected`。
   - 必须在连接恢复后补当前目录 session、active session messages、todo、diff 和交互请求；不能只重开 live stream。

6. **promptAsync 失败会误删已被服务端确认的乐观消息**
   - [openCodeSyncStore.ts:280](/Users/by3/Documents/jiucaihezi-app/src/stores/openCodeSyncStore.ts:280) 无条件删除 optimistic message。
   - 必须区分 confirmed message/parts；HTTP 失败但已收到官方事件时不得回滚已确认内容。

7. **ensureSession 未校验 directory，可能跨项目复用 ses ID**
   - [openCodeSyncStore.ts:200](/Users/by3/Documents/jiucaihezi-app/src/stores/openCodeSyncStore.ts:200)。
   - 必须让 active session 与 active directory 成对切换；目录变化后禁止复用旧目录 session。

### P1：已完成修复，保留审计证据

8. **遗漏官方标准 `question.asked/replied/rejected`**
   - [eventReducer.ts:148](/Users/by3/Documents/jiucaihezi-app/src/opencodeClient/eventReducer.ts:148) 目前只处理 `question.v2.*`。
   - 对照官方 `global-sync/event-reducer.ts` 和 SDK v2 类型，同时支持标准 question 事件。

9. **未处理 `session.error`，可能永久 busy**
   - [eventReducer.ts:89](/Users/by3/Documents/jiucaihezi-app/src/opencodeClient/eventReducer.ts:89)、[openCodeSyncStore.ts:57](/Users/by3/Documents/jiucaihezi-app/src/stores/openCodeSyncStore.ts:57)。
   - 必须定义错误状态投影；`session.error` 不能伪装成 idle，也不能让 UI 无限等待。

10. **openSession 的 session/todo/diff 快照缺少 revision 保护**
    - [openCodeSyncStore.ts:226](/Users/by3/Documents/jiucaihezi-app/src/stores/openCodeSyncStore.ts:226)。
    - 加载期间到达的新事件必须优先于旧 HTTP 快照。

11. **归档 session 未清理 active/cache**
    - [eventReducer.ts:68](/Users/by3/Documents/jiucaihezi-app/src/opencodeClient/eventReducer.ts:68)。
    - 对齐官方 archived session 的 cache eviction；active session 不能继续提交到已归档会话。

12. **桌面会话删除只删 IndexedDB，不删 OpenCode session**
    - [FileTreePanel.vue:149](/Users/by3/Documents/jiucaihezi-app/src/components/filetree/FileTreePanel.vue:149)、[sessionStore.ts:514](/Users/by3/Documents/jiucaihezi-app/src/stores/sessionStore.ts:514)。
    - Desktop 删除必须调用官方 `session.delete`，Web 才保留 IndexedDB 删除路径。

13. **Desktop 媒体模型仍写本地 messages，刷新即丢**
    - [ChatPanel.vue:1012](/Users/by3/Documents/jiucaihezi-app/src/components/chat/ChatPanel.vue:1012)、[sessionStore.ts:463](/Users/by3/Documents/jiucaihezi-app/src/stores/sessionStore.ts:463)。
    - 媒体任务应继续使用现有 `mediaTaskStore`；不得把 Desktop 媒体气泡伪装成 OpenCode 文本消息，也不得写入错误的本地会话层。

### 修复顺序与验证要求

1. 先为每个 P0 问题补一个最小失败测试，再改最小生产代码。
2. P0 全部通过后，再补 P1 的官方事件/reconnect/cache/delete/media 测试。
3. 每批修复必须运行：

   ```bash
   pnpm exec vue-tsc -b
   cargo check --manifest-path src-tauri/Cargo.toml
   pnpm run test:focused:build
   ```

4. 只有 P0/P1 自动测试通过，才能恢复 Stage 7 的真机矩阵。
5. 审计没有授权删除现有 Skill、文件树、模型、媒体、创作面板或画布能力；这些继续按本 SDD 的非目标保留。

### 2026-07-13 审计修复结果

| 审计项 | 结果 |
|---|---|
| 重命名导致 sidecar 重启 | 已修复：复用 Sync Store 注册 client |
| 切项目 abort/双重连接/旧意图抢回 | 已修复：App 单一生命周期 owner + connection intent generation |
| 恢复 busy session 无法停止 | 已修复：按当前目录注册 client abort |
| 权限/问题回复失败或目录错误 | 已修复：Store 当前目录 client，失败保留请求，事件驱动移除 |
| 断线重连 bootstrap/reconcile | 已修复：server、directory、domain revision 与 fresh snapshot |
| optimistic 已确认内容误回滚 | 已修复：message/part 分层确认与 removed 清理 |
| 标准 question、session.error、归档缓存 | 已修复：官方事件覆盖；`session.error` 保持非终端语义 |
| session/todo/diff/part 快照竞态 | 已修复：域级 revision、导航 generation、旧请求失效 |
| Desktop 删除与重复删除 | 已修复：注册 client 单次删除、in-flight 合并、tombstone 幂等 |
| Desktop 媒体任务 | 已修复：真实 `ses_*` 容器 + `mediaTaskStore` 独立持久化/投影 |
| 媒体并发、失败回滚、旧任务 | 已修复：创建 ownership、持久化队列、Desktop legacy 恢复入口；Web 不受影响 |

自动验证记录：相关测试 `118/118` 通过；全仓 Node focused `747/747`、Rust `371/371` 通过；`vue-tsc -b`、`cargo check --manifest-path src-tauri/Cargo.toml`、`git diff --check` 通过。`cargo fmt --check` 因当前 toolchain 未安装 rustfmt 未执行成功。

Stage 0-7 自动验证已完成。用户侧真机矩阵还剩：同一会话文→武连续发送、停止后继续、权限/问题真实交互、Ollama 性能与退出后进程数、Intel baseline。已完成项目见下节；未完成前不宣称全部发布验收完成。

## 12. 2026-07-13 真机验收结果

用户已实际验证以下项目通过：

- 文模式回复
- 武模式回复
- 本地 Ollama 回复
- 重启后会话恢复
- 项目切换

用户尚未验证以下项目，不能标记为通过：

- 修复后的同一会话文→武连续发送
- 停止后继续发送
- 权限交互
- 问题交互
- Ollama 首 token/CPU 与退出后进程数
- Intel Mac baseline

以上已验证流程运行在 Apple M1 Max。浏览器 `navigator.platform=MacIntel` 是兼容值，不能作为 Intel 硬件证据。

## 13. 体验问题修复（第二轮根因修复完成，部分真机通过）

### UX-1：发送后 UI 反馈有明显延迟

**现象**：点击发送后，发送按钮先变红；随后有一段空白，过一会儿才出现“正在回复”的动态图标，之后才开始显示内容。

**根因证据**：第一轮已经在异步等待前投影用户消息和 `isStreaming`，红色停止键也证明运行状态立即生效；真正遗漏的是 `ChatPanel.vue` 的动态图标条件仍要求“最后一条消息没有内容”。发送后最后一条恰好是有正文的用户消息，所以图标必然隐藏。这是固定显示条件错误，不是竞态。

**2026-07-13 实现结果**：

1. `useChat.ts` 在第一个异步等待前生成官方格式 `messageID/partID`，立即投影用户消息和 `sending` 状态。
2. `openCodeSyncStore.submitPrompt()` 复用同一个预生成 `messageID`；session 创建后 Store 原位接管，不生成第二条用户消息。
3. Desktop 可见运行态改为“本地提交中或 Store busy”，覆盖慢 `session.create` 的空白窗口；提交失败时移除占位并恢复输入。
4. `ChatPanel.vue` 在最后一条为用户消息时立即显示动态图标；增加回归测试锁定该条件。点击后下一帧体验仍需真机确认。

### UX-2：本地 Ollama 比 VS Code 同模型明显更慢且 CPU 持续轰鸣

**现象**：同一个本地模型在韭菜盒子中需要较长时间并让电脑高负载；用户在 VS Code 中调用同一模型时响应更快、几乎不轰鸣。

**根因证据**：数据库显示本地 `qwen3.6:35b-a3b` 的“你好”实际输入 `45,181 tokens`。session、assistant `cwd` 和 sidecar cwd 都是 `/Users/by3/Documents/77777`，没有读取 `jiucaihezi-app` 的工具调用；但 `/Users/by3/Documents/AGENTS.md` 是 `90,884` 字节的旧韭菜盒子手册，非 Git 项目的官方 `worktree=/` 令它被向上发现并注入。审计时还发现 69 个 PPID=1 的孤儿 `opencode serve`，合计约 6.5GB RSS，并共同打开一个 SQLite。另经本机 Ollama 0.31.1 实测，OpenAI 兼容 `/v1/chat/completions` 会忽略 `think:false`，只有 `reasoning_effort:"none"` 能关闭该模型 thinking。

**2026-07-13 实现结果**：

1. 旧父级手册非破坏性改名为 `/Users/by3/Documents/AGENTS.md.disabled-20260713`，让 `77777/CLAUDE.md` 恢复为当前项目指令；不修改 OpenCode 官方向上查找算法。
2. Rust 对非空但失效的项目目录直接报错，不再静默扩大到用户 Home。
3. 本地 Qwen3 模型改为 `reasoning_effort: "none"`；“查看思考过程”仍保留给明确启用 reasoning 的其他模型。
4. 文/武模式只发送官方 `agent: plan/build`；不得再通过已废弃的 `tools` 字段控制模式权限。
5. Tauri 在 `RunEvent::Exit` 前等待 sidecar 退出，并处理 SIGINT/SIGTERM/Windows Ctrl+C；历史 69 个孤儿进程已经清空。
6. 首 token、CPU 声音、退出后进程数和复杂任务能力必须用同模型真机复测后才能标记体验通过。

### UX-3：global event 连接错误在控制台无限重复

**现象**：控制台持续重复：

```text
Fetch API cannot load http://127.0.0.1:53486/global/event due to access control checks.
Failed to load resource: Could not connect to the server. (event)
The network connection was lost. (event)
```

**根因证据**：`createJiucaiOpenCodeGlobalClient()` 没有给 SDK 传平台 fetch，`httpClient.ts` 又明确把非 Ollama loopback 排除在 Rust bridge 外，因此 `/global/event` 必然落到 WebView 原生 fetch，正好对应控制台 CORS/connection error。

**2026-07-13 实现结果**：

1. 所有 OpenCode SDK client 显式使用 Tauri `safeFetch`；loopback HTTP 和 `/global/event` SSE 统一走 Rust HTTP bridge，不再交给 WebView CORS。
2. SDK 传入的 `Request` 会完整保留 method、Authorization、body 和 AbortSignal；`/global/event` 不设置 120 秒请求超时。
3. 事件桥连续传输失败最多尝试 5 次，采用最高 4 秒的指数退避，同一失败周期只上报一次；收到任意官方事件后重置失败计数。
4. 增加 Request 传输、SSE GET、loopback 路由和 sidecar 连续失败测试。控制台不再刷 WebView CORS 的结果仍需真机重启后确认。

### UX-4：云模型只有思考或输出 DSML 假工具

**现象**：`tencent/hy3:free` 在“查看项目”后只有思考；`deepseek-v4-flash` 输出 `<｜｜DSML｜｜tool_calls>` 文本，没有工具结果和最终答复。

**根因证据**：SQLite 中前者只有 `reasoning + step-finish(stop)`，没有 `text/tool`；后者的 DSML 是普通 `text` part，也没有 `tool` part。Reducer、mapper 和 Vue 都原样保留了上游结果。这只能证明当次 NewAPI 响应没有形成 OpenAI 标准 `tool_calls`，不能证明模型不支持工具调用。OpenCode 官方模型目录明确把 `deepseek-v4-flash` 和 `tencent/hy3-preview:free` 标记为 `tool_call:true`；`tencent/hy3:free` 是渠道别名，仍需用实际响应验证协议映射。

**2026-07-13 实现结果**：

1. 已撤销按模型名硬编码 `tool_call:false` 的错误修复；两个模型恢复 `tool_call:true`，与 OpenCode 官方能力目录一致。
2. 保持“不在 Vue 里解析 DSML 私有文本、不伪造工具执行”；若再次复现，应采集 NewAPI 原始流并修复协议适配，不能再关闭模型能力绕过问题。
3. Provider 投影测试锁定两个模型都必须保留工具调用能力。用户已在 Apple Silicon 真机确认 `deepseek-v4-flash` 依次产生 `search`、`read` 工具 part，并返回目标 Skill 原文；UX-4 验收通过。

### UX-5：文模式切回武模式后只输出伪 Bash 文本

**现象**：同一会话先用文模式“查看项目”，再切回武模式后，模型只输出 `<bash>...</bash>` 普通文本，没有真实工具 part 和最终回答；新会话最初又能正常回复。

**根因证据**：失败会话 `ses_0a466be55ffeB1FuJpJef1RQ62` 的事件序列显示，文模式 user message 带 `tools: { "*": false }` 后，OpenCode `1.17.18` 将其持久化为 session permission `deny *`。切回武模式复用同一 session 时，`session.update(permission: [])` 按官方 `Permission.merge` 语义不能删除旧规则，因此工具继续被全部拒绝。数据库中只有 reasoning、普通 text 和 step-finish，没有 tool part，证明不是 Vue 隐藏结果。

**2026-07-13 实现结果**：

1. Desktop prompt 对齐官方 App，只发送 `agent`、`model`、`messageID` 和 `parts`，删除未被任何调用者使用的 `openCodeTools` 入口及自动 `tools: { "*": false }`。
2. 保留 OpenCode `plan/build` Agent 自身的官方权限策略；不自行写“允许全部”规则，不直接修改 SQLite。
3. 已被旧版本污染的 session 不能用空权限数组清除；测试时新建会话，需保留历史时使用官方 fork 创建无污染副本。
4. 回归测试锁定 Desktop 文/武发送路径不得再出现 deprecated tools override。修复后的同一会话文→武连续发送仍需真机复测。

### UX-6：开发环境反复出现 Tauri callback id 警告

**现象**：控制台在 Vite hot update 前后大量重复：

```text
[TAURI] Couldn't find callback id ... This might happen when the app is reloaded while Rust is running an asynchronous operation.
```

**根因判断**：截图同时包含多条 `[vite] hot updated`。Tauri `Channel` 的 callback id 属于当前 WebView JS 运行时；Vite HMR 销毁旧回调表后，Rust 中尚未结束的 `http_request_stream` / `global.event` 仍向旧 id 推送数据，因此同一 id 会反复报警。这不是 UX-5 没有 tool part 的根因，后者已由 OpenCode SQLite 事件序列独立定位。

**处理边界**：

1. 当前只认定为开发环境生命周期噪音，不为它回退 Rust HTTP bridge 或全局事件流。
2. 正式打包 APP 没有 Vite HMR；应在正式包清空控制台后复测。若仍持续出现，才升级为真实 Channel 生命周期泄漏。
3. 若正式包复现，修复点是 WebView/HMR dispose 时先 `openCodeSyncStore.disconnect()`、abort 活跃流并让 Rust 在 Channel send 失败后立即退出；不能过滤警告掩盖旧任务。
4. 同图中的 `/__jc_api/v1/models shouldUseRustHttpBridge=false` 是内部代理走原生 fetch 的预期分支；`deepLink.getCurrent()` 5 秒超时是非致命启动降级。
5. Tiptap `Duplicate extension names: trailingNode` 是独立低风险问题：`StarterKit` 已内置 `TrailingNode`，`EditorPanel.vue` 又重复注册。后续最小修复是删除显式 `TrailingNode`，与聊天信息流无关。

第二轮新增回归覆盖动态图标、退出等待、终止信号、无效目录、Ollama reasoning 参数、云模型工具能力和文/武权限不污染。信息流专项、全仓 Node/Rust、`vue-tsc -b`、`cargo check`、`git diff --check` 均通过；自动化不再阻塞合并。UX-3 已由无重复 CORS 的重启日志确认，UX-4 已由真实 search/read 工具调用确认。UX-1、UX-2、UX-5、正式包 Channel 生命周期以及停止后继续、权限/问题交互、Intel baseline 仍以真机体验为准；不回退全局 Sync Store。

---

## 10. 给执行 AI 的禁止事项

1. 不要相信旧交接文档中的“设计取舍”结论，必须打开同版本官方源码核对。
2. 不要在 `useChat.ts` 再增加一种完成检测或 watchdog。
3. 不要用 IndexedDB 给 Desktop 做 fallback；OpenCode Server 是 Desktop 真源。
4. 不要把 `session.error`、`session.idle` 或 SSE close 猜成删除 session。
5. 不要为修一个症状同时改 MessageBubble、文件树和 Rust 进程；先用事件序列定位首次分叉。
6. 不要改变文/武模式、Skill、模型和媒体能力，只重新接到唯一 Store。
7. 不要一次提交全部阶段；每阶段必须可测试、可回滚。
8. 不要在用户现有脏工作区执行 reset、checkout 或覆盖未提交改动。

## 11. 执行顺序摘要

```text
0. 锁定 1.17.18 协议与失败样本
1. 翻译 global.event 生命周期
2. 翻译 session Sync Store + reducer + bootstrap
3. Desktop 统一使用 ses_* 身份
4. Vue 改为只读 Store 投影
5. 发送缩减为 optimistic + promptAsync
6. 删除旧每轮 SSE/轮询/映射/缓存
7. 官方事件重放 + ARM/Intel 真机验收
```

这七步共同完成一件事：正确翻译官方信息流。它们不是七个新功能。
