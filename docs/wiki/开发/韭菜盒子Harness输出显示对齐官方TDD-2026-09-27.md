# 韭菜盒子 Harness 输出显示对齐官方 TDD

> 状态：第一档已实施（含归属修正），真实 Desktop 验收待跑
> 日期：2026-09-27
> 范围：`MemoryWorkbench` 中 Harness（@DH）对话的输出显示
> 前提：只补投影与显示，**运行时 0 处改动**

## 1. 决策

对照官方 GUI 后，第一档只做 4 项，且全部落在"消费已有事件"上：

1. Session 事件投影不再丢 `reasoning` / `tool-call` / `tool/result` / `usage`。
2. Think 折叠行（推理默认折叠，可展开）。
3. 工具行升级：中文标签 + 参数摘要 + 状态 + 时长 + 展开结果。
4. 过程在定稿后继续可见，且刷新后仍在。

第 4 项在审计后**不需要新的持久化格式**。Harness 对话本来就以 Session 为唯一真源：打开对话时 `readDeepSeekHarnessSession()` 重建 `mergedHarnessTurns()`，Harness 成功轮次只写 Session、不双写 Raw（见 [[开发/韭菜盒子Harness会话与可选建库统一合同-2026-09-24]] §6）。所以第 4 项是第 1 项的直接结果，不是独立工作量，`ConversationTurn` 与旧 Raw 序列化格式都不动。

本 TDD 明确不做（第二档另立 TDD）：流式增量 Markdown、turn 级过程折叠分组、turn 尾行用量与耗时、Trajectory 表格、StatsPills、审批交互。

## 2. 当前根因

### 2.1 数据早就到了，是投影层把过程丢掉了

| 位置 | 现状 | 官方同一份数据的用途 |
| --- | --- | --- |
| `deepSeekAssistantText()`（`src/services/deepSeekHarness.ts:150`） | 只取 `content` 里 `type === 'text'` 的块 | `reasoning` 是同一 content 里的普通块，官方投影成 Think 行 |
| `applyDeepSeekAssistantStream()`（同文件 `:194`） | 只认 `text-delta`，其余类型只推进 index 后丢弃 | `reasoning-delta` / `tool-call-delta` / `usage` / `finish` 都驱动官方实时 UI |
| `deepSeekProgress()`（同文件 `:262`） | 只产出 `{ id, label, state }` | 官方工具节点用 `arguments` 出参数、用 `tool/result` 三阶段定价、用 `time` 算时长 |
| `deepSeekSessionTurns()`（同文件 `:165`） | 只投影 `user/message` + `assistant/message` 文本 | 官方 Chat 由 durable 事件回放复现同一条 stream |
| `updateRunTool()`（`MemoryWorkbench.vue:2126`） | `durationMs` 只由直连路径的 `DirectToolExecutionEvent` 填 | — |
| `onProgress` 处理（同文件 `:1886`） | Harness 步骤从不写 `durationMs` | — |
| 过程渲染（同文件 `:3439`） | 只在 `sending || error` 时渲染，且只取 `visibleRunSteps`（`:659`，最近 5 条） | 官方定稿后过程可折叠、可回看 |

结论：这不是运行时能力不足，是显示层没消费已经在手的数据。**修根因 = 让投影层不再丢事件，而不是加补丁层去轮询或重读文件。**

另外这条口径要显式改写：`log.md` 2026-09-23 记录过"只展示正文增量，不展示 reasoning，持久化仍只采用最终 `assistant/message`"。那是当时的范围裁剪，现在由本 TDD 正式覆盖。

### 2.2 官方事件 schema（本机 0.1.7-alpha.2 源码，非推测）

| 事件 / 类型 | 形状 | 出处 |
| --- | --- | --- |
| `step/start`、`step/end` | `{ turn, step }` | `@deepseek-ai/dsh-session/lib/types/types.d.ts:278` |
| `assistant/message` | `{ turn, step, message, stream, usage?, interrupted? }` | 同文件 `:330` |
| `tool/call` | `{ turn, step, callId, name, arguments }`，`arguments` 是模型产出的原始 JSON 字符串（未解析） | 同文件 `:354` |
| `tool/result` | `{ turn, step, message, error?: { name, code, reason? }, meta? }`；`meta` 是工具私有展示载荷（`dsh-tool-fs` 在这里放 diff） | 同文件 `:374` |
| `TokenUsage` | `{ inputTokens, outputTokens, totalTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }`，计数互斥（`inputTokens` 只含未缓存部分） | `@deepseek-ai/dsh-llm/lib/types/types.d.ts:161` |
| `ContentBlock` | `text` / `reasoning` / `image` / `file` / `tool-call` / …，`ReasoningBlock = { type: 'reasoning', text }` | 同文件 `:51` |
| `AssistantStreamFrame`（实时帧） | `start { attemptId, revision, turn, step }` / `chunk { index, time, chunk }` / `end { index, outcome }` | `@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:107` |
| `StreamChunk` | `block-start` / `text-delta` / `reasoning-delta` / `tool-call-delta` / `block-end` / `usage` / `finish` | `@deepseek-ai/dsh-llm/lib/types/types.d.ts:406` |

两条由源码直接推出的结论，是本轮改动的前提：

- **过程不需要新通道**：`reasoning` 与 `tool-call` 是 `assistant/message.data.message.content` 里的普通块，`tool/result` 另有独立事件，`usage` 挂在 `assistant/message.data.usage`。
- **实时也带全**：`scripts/prepare-deepseek-harness.mjs` 的补丁把整个 `frame` 原样转发（不筛 chunk 类型），`reasoning-delta` / `tool-call-delta` / `usage` / `finish` 本来就在客户端。现有测试里那条 `reasoning-delta` 断言（`deepSeekHarness.test.ts` 只推进 index）正是这条的旁证。

### 2.3 真样本核对（2026-09-27 已执行）

用官方 runner 的 `session/list` + `session/read` 读了本机真实会话（工作区 `D:\0925测试`，模型 `gpt-5.6-sol`，一条含 11 次工具调用 / 19 个 step 的会话），确认了五件事：

1. **事件顺序**：`step/start` →〔重试时插入 `assistant/attempt` → `llm/retry` → `llm/retry-started`〕→ `assistant/message` → `tool/call` → `tool/result` → `step/end`。所以 `tool/call` 出现在**同一个 step 的** `assistant/message` **之后**，按 `{ turn, step }` 归并成立（§3.1 的分组规则不需要改成"下一个未结算消息"）。
2. **纯工具步真的存在**：该会话 5 个 `assistant/message` 里 4 个 `blocks=[tool-call]`、无 text。今天 `deepSeekSessionTurns()` 对空正文直接不产出 turn，**那一整轮（10 个工具步、约 1 分钟、11 次工具调用）在产品里完全不可见**——这是本 TDD 的价值锚点。
3. **`usage` 100% 都有**（16/16），实测形状 `{"inputTokens":7128,"outputTokens":131,"totalTokens":7259}`，无 cache 字段（可选，缺就不显示）。
4. **推理实测为 0**：16/16 `assistant/message` 无 `reasoning` 块，嵌入式 `stream` 无 `reasoning-chunks` 记录。根因指向 route patch 未声明 `reasoningEfforts`——`gpt-5.6-sol` 不在已安装目录里，按 `dsh-llm-pi-ai` 的规则"省略该字段时保留已安装目录条目的能力"，自定义模型 id 因此没有推理能力。**这是独立的产品决策**（开推理会改延迟、成本与输出），不在本 TDD 范围。按 §4 的闸门：Think 行落结构，不宣称可用。
5. **`user/message` 的 `source.kind` 实测取值**：`user`、`runtime-context`、`skill-catalog`、`skill-invocation`。现有 `=== 'user'` 的过滤是对的，本轮不改。

同一批样本还校正了下面三处原本靠推测的合同：§3.1 的分组来源、§3.2 的白名单、§3.1 的失败回退。

### 2.4 官方 GUI 的显示语义（本轮对齐目标）

只取要对齐的四条：

- `ReasoningRow`：折叠一行；流式时横向跟随最新一行，定稿回滚到首行（`packages/client/ui-chat/src/client/chat/ReasoningRow.tsx`）。
- 一个 `callId` 一个工具节点，`preparing / dispatched / result` 三阶段同属该 callId（`packages/client/ui-chat/README.md`）。
- 定稿 reading 由 durable 事件回放复现同一条 stream，实时累积只是过渡（`.agents/notes/implemented/testing/2026-08-03-opt-in-reasoning-chunk-browser-stress.md`）。
- 用量**缺就不显示**，不用 0 或估算值代替（`dsh-session` 的 `usage?` 与 `.agents/notes/implemented/feature/2026-09-16-performance-usage-preference.md`）。

不对齐的部分：审批（官方 SDK 协议明说 server→client 请求从不发送，`packages/sdk/protocol/README.md`；我们的权限模式在 §12.3 已登记为有意偏离）、Trajectory、StatsPills。

## 3. 合同（要钉住的接口）

### 3.1 投影函数（`src/services/deepSeekHarness.ts`）

- `deepSeekAssistantText(event)`：**签名与行为不变**（只取 `text` 块），防止回归。
- 新增 `deepSeekAssistantReasoning(event)`：按 content 里的块顺序拼接 `reasoning` 块文本。顺序用块顺序，不按 `index` 重排。
- 新增 `deepSeekMessageUsage(event)`：`assistant/message.data.usage` → `TokenUsage | undefined`。缺省一律返回 `undefined`，**不填 0、不估算**。
- `deepSeekProgress(event)`：签名不变，返回类型加可选字段：
  - `tool/call` → `{ id: callId, label, state: 'running', summary, startedAt: time }`
  - `tool/result` → `{ id: message.toolCallId, state: isError ? 'failed' : 'done', endedAt: time, durationMs, errorReason: error?.reason, resultText }`
  - `callId` 为空时不产出条目（保持现有 `progress?.id` 的过滤语义）。
  - **失败原因不能只靠 `error.reason`**：真样本里那次 `read_image` 失败时 `isError: true` 但 `error` 整个是 `undefined`，失败说明只在结果的 text 块里。所以失败行取 `error.reason ?? error.code ?? 结果正文首行`。
- 新增 `deepSeekSessionProcess(snapshot): Map<string, DeepSeekProcessStep[]>`：键是**本轮发起人**（该轮那个 `source.kind === 'user'` 的用户消息 id），值是该轮的工具步骤。
  - **归属不能落在 assistant message 上**（本 TDD 初稿就是那么写的，实施时发现它是错的）：纯工具步（`assistant/message` 只有 `tool-call` 块、无正文）不产出 UI 轮次，挂它就等于过程永远不可见——而那正是 §2.3 第 2 条要修的东西。改成挂在发起该轮的用户消息上之后，§2.3 那个“一整轮 10 个工具步全不可见”的锤点才真正被解决。
  - 没有真人发起人的轮次（goal 续轮这类注入式轮次）退回该轮的 assistant message id 兜底，过程不会连带丢掉。
  - 发起人 id 必须与 `deepSeekSessionTurns()` 完全一致，所以两处共用 `deepSeekUserMessageId(event)`。
  - 工具步骤**只从 `tool/call` + `tool/result` 事件取**，按 `callId` 配对，不解析 `assistant/message.data.message.content` 里的 `tool-call` 块：同一个 callId 在两处都出现，只用事件源可以天然避免同一步渲染两遍。
  - 一个 step 允许多个 call，合并按 `{ turn }` 分组、步骤内部保持事件顺序。
  - 按 UI 轮次 id 侧存，跟随本文件既有的 `mediaPlans` / `programStatuses` / `evalReports` / `skillInstallPlans` 约定，**不改 `ConversationTurn`**。
  - `DeepSeekProcessStep = { id: callId; label: string; summary: string; state: 'running' | 'done' | 'failed'; durationMs?: number; errorReason?: string; resultText?: string; resultTruncated?: boolean }`

### 3.2 参数摘要白名单

`summary` 按固定优先级取第一个命中的键，**白名单按真样本实测键集定**（§2.3）：`command`、`file_path`、`path`、`pattern`、`query`、`url`、`name`、`toolName`。

实测依据：`read` / `read_image` 用 `file_path`（**不是** `path`），`glob` 用 `path` + `pattern`，`pwsh` 用 `command` + `description`，`skill` 用 `name`。

- `write` / `edit` 只显示路径，**不显示写入内容**。
- `arguments` 解析失败 → 空摘要，绝不抛错。
- 值截断到 80 字符，换行折成空格。
- 这条**替换** 2026-09-23 的旧合同（`deepSeekHarness.test.ts` 里的 `exposes durable tool progress without leaking arguments`）。改写测试时必须在测试名/注释里写明替换理由：本地工作台里用户需要知道 agent 在动哪个文件、跑什么命令，而写类工具的内容仍然不显示。

### 3.3 流式帧累积

`applyDeepSeekAssistantStream(state, frame)` 的 state 扩为 `{ attemptId, nextIndex, text, reasoning, turn, step }`，**返回值语义不变**（仍是"新的可见正文增量"）：

- `start` → 重置 `attemptId` / `text` / `reasoning`，记住 `turn` / `step`。
- `reasoning-delta` → 累积到 `reasoning`，**不影响返回值**：正文仍只由 `text-delta` 驱动。
- 其他 chunk（含 `tool-call-delta` / `usage` / `finish`）→ 照旧推进 `index` 后不产出文本。
- 乱序或重复 index → 丢弃（保留现有幂等语义）。
- 定稿后由 `assistant/message` 里的 reasoning 块接管，与正文同一条"committed 权威"规则。

`usage` 的展示属第二档，本轮只在 `deepSeekMessageUsage()` 里备好。

### 3.4 UI（`MemoryWorkbench.vue`）

`MemoryRun` 增加 `reasoning: string`；新增按 UI 轮次 id 侧存的 `harnessProcess` 与 `harnessReasoning`。

- 过程与 Think 都渲染在**发起本轮的那个用户轮次**下（该轮正文之后，即「问 → 它做了什么 → 答」），不渲染在 assistant 轮次上：理由同上，纯工具轮根本没有 assistant 轮次。
- Think 折叠行默认折叠。标题不带时长：算时长需要 `assistant/message.data.stream` 里的 `reasoning-chunks` 时间戳，本轮 fixture 刻意不携带该字段（见 §7 未验收项）。展开后正文复用 `MemoryMarkdown`。
- 工具行：`状态图标 + label + summary + durationMs`；失败时显示 `errorReason`；`<details>` 展开 `resultText`（截断 4000 字符并提示「已截断」），内容只在展开时渲染。
- 单个 turn 默认展示最近 5 条，超出折叠成「另有 N 步」，保留 `visibleRunSteps.slice(-5)` 的原有上限意图。
- **移除** `sending || error` 这个渲染前提，定稿后过程继续可见。
- composer 底部运行状态区保持原样：它是"当前在做什么"，与 turn 内的过程不是同一件事。

## 4. 实施顺序与验收

### P0 抓真样本（✅ 2026-09-27 已完成）

结论见 §2.3。产物：`src/services/__tests__/fixtures/dh-session-tools.json`（30 个事件 / 24.8 KB）。

- 取自本机真实会话，用一条一次性脚本从 `session/read` 的返回里裁剪：只留 `turn/start`、`step/start`、`step/end`、`turn/end`、`user/message`、`assistant/message`、`tool/call`、`tool/result`；turn 1 只取前 3 个 step（glob / read_image 失败 / pwsh），turn 5 取全量（read + 一段正文回答）。
- 脱敏：`D:\0925测试` → `D:\work\demo`，`C:\Users\Administrator` → `C:\Users\tester`（按反斜杠转义层级替换，JSON 里嵌套的 `arguments` 也覆盖）。已校验残留为 0。
- 裁剪时的两处取舍：`assistant/message.data.stream`（紧凑带时间流）本轮不消费且带完整正文分片，直接去掉；`arguments` 不硬截断（那会变成非法 JSON、让测试只钉到降级路径），而是解析后把字符串值截到 160 字符再序列化回去。
- 测试文件沿用已有的 `src/services/__tests__/deepSeekHarness.test.ts`（已在 `scripts/run-focused-tests.mjs` 白名单里），fixture 只放在它旁边，不需要新增白名单条目。

红灯（P1 首条要写的）：把 fixture 喂给 `deepSeekSessionProcess()`，断言 4 个 callId 都挂在**发起对应轮次的用户消息**上（turn 1 三个、turn 5 一个），且 `read_image` 那条是 `failed`。（初稿写的是“挂在 assistant message 上”，已按 §3.1 的根因修正。）

### P1 投影层

- §3.1 / §3.2 / §3.3 逐条先红后绿。
- 现有 3 条流式断言原样保留（它们是本轮之前的合同）。
- 定向命令：`corepack pnpm run test:focused` 会全量跑白名单；改完先跑 `src/services/__tests__/deepSeekHarness.test.ts`。

### P2 UI

- Think 行 → 工具行 → 移除 `sending || error` 前提 → 上限折叠。
- `src/components/memory/__tests__/memoryWorkbench.test.ts` 是源码正则契约测试，按它的写法补断言。

### P3 回归与真实验收

- `corepack pnpm run test:focused` → `vue-tsc -b` → `pnpm run lint` → `git diff --check`。
- PowerShell 下 `pnpm run test:focused` 的 stderr 会让工具报 `Exit Code: 1`，取真实退出码要 `corepack pnpm run test:focused *> log; $LASTEXITCODE`。
- 真实 Desktop 验收两项：① 一轮含 ≥2 次工具调用的对话，Think 行与工具行在**运行中**和**刷新后**都还在；② 上游确实返回推理时才宣称 Think 行可用。
- 未完成 P0 真样本之前，不得把本 TDD 任何一项写成已通过。
- **已知边界**：本档只做“过程挂到本轮发起人上”，没做 turn 级分组——同一轮有多个 assistant step 时，轮内仍会看到多个答案气泡（官方是把它们折进一个过程组）。那属第二档。

## 5. 非目标与风险

- 运行时 0 处改动：不动 `runner.mjs`、route patch、SDK 补丁、`prepare-deepseek-harness.mjs`。
- 不动 `ConversationTurn`、`conversationTranscript.ts`、旧 Raw 序列化格式。
- 不动直连路径（`runMemoryChat`）的工具显示。
- **风险 1 · 结果体量**：`bash` 输出、`read` 正文可能几十万字符。必须截断 + 只在展开时渲染，否则长会话内存与滚动都会退化。
- **风险 2 · 无上限增长**：过程条目必须保留"默认 5 条 + 折叠其余"的上限语义。
- **风险 3 · schema 漂移**：本投影是 [[开发/韭菜盒子Harness会话与可选建库统一合同-2026-09-24]] §12.5 登记的手写投影（官方 `session-projection` 尚未在 SDK client 公开）。事件 schema 变化只表现为投影缺失、不报错，**升 SDK 版本时必须一并核对本节 §2.2 的清单**。
- **风险 4 · 推理内容的误导性**：`reasoning` 是模型内部独白，可能含被推翻的中间结论。默认折叠是对的，且 reasoning **不得**进入任何导出、落盘或复制路径。

## 6. 证据

- 我们这边：`src/services/deepSeekHarness.ts`（`:150` / `:165` / `:194` / `:262`）、`src/services/__tests__/deepSeekHarness.test.ts`、`src/components/memory/MemoryWorkbench.vue`（`:659` / `:1886` / `:2126` / `:3439`）、`src/components/memory/__tests__/memoryWorkbench.test.ts`、`src/components/chat/display/streamingTextRenderer.ts`、`scripts/run-focused-tests.mjs`。
- 官方源码（本机 `src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/`）：`dsh-session/lib/types/types.d.ts`、`dsh-llm/lib/types/types.d.ts`、`dsh-llm/lib/types/assistant-stream.d.ts`、`dsh-agent/lib/types/runtime-types.d.ts`、`dsh-session/README.zh.md`。
- 官方仓库：`packages/client/ui-chat/src/client/chat/ReasoningRow.tsx`、`packages/client/ui-chat/README.md`、`packages/sdk/protocol/README.md`、`docs/persistence-catalog.md`、`.agents/notes/`（reasoning chunk 发布、process folding、performance usage preference）。
- 合同与历史：[[开发/韭菜盒子Harness会话与可选建库统一合同-2026-09-24]] §6、§12.3、§12.5；[[log]] 2026-09-23「@DH 流式正文与执行进度」。

## 7. 本地实施结果

### P0 真样本（2026-09-27）

- 用一次性脚本经官方 runner 的 `session/list` + `session/read` 读了本机工作区 `D:\0925测试` 的 3 条会话（未解析 `$DSH_HOME` 物理文件），取其中含 11 次工具调用 / 19 个 step 的一条作为样本。
- 事件顺序、纯工具步不可见、`usage` 覆盖率、推理为 0、`source.kind` 取值共五项结论记在 §2.3；三条合同因此被校正：分组来源（§3.1）、参数白名单（§3.2）、失败原因回退（§3.1）。
- 产物 `src/services/__tests__/fixtures/dh-session-tools.json`（30 个事件 / 24.8 KB，已校验无真实路径残留）。
- 一次性诊断脚本用完已删，未进仓库；本轮**运行时 0 处改动**。

### P1–P3（2026-09-27 已实施）

改动面：4 个文件（`src/services/deepSeekHarness.ts`、`src/components/memory/MemoryWorkbench.vue`、两个测试文件）+ 新 fixture。**运行时 0 处改动**。

已实现：

- `deepSeekAssistantReasoning()`、`deepSeekMessageUsage()`（缺省返回 `undefined`，不填 0）、`deepSeekSessionProcess()`、`deepSeekSessionReasoning()`。
- 两者的归属都是**本轮的真人发起人**（该轮 `source.kind === 'user'` 的消息 id），没有发起人时退回该轮 assistant message id 兜底——这是实施中发现的根因修正，见 §3.1。`deepSeekSessionTurns()` 与它们共用 `deepSeekUserMessageId()`，避免键名漂移。
- `deepSeekProgress()` 带参数摘要（白名单按实测键集）、`startedAt` / `endedAt` / `resultText` / `resultTruncated` / `errorReason`（缺 `error.reason` 时回退到结果正文首行）。
- 流式状态新增 `reasoning` / `turn` / `step`，`reasoning-delta` 单独累积且不影响正文返回值；服务新增 `onReasoning` 回调，只在内容真变化时触发。
- UI：过程与 Think 行挂在本轮发起人（用户轮次）的正文之后，不再只在“正在运行”时可见；composer 底部运行状态区保留，并补了实时推理尾行。

验证：

- 新增 11 条用例（`deepSeekHarness.test.ts` +10、`memoryWorkbench.test.ts` +1，按 `HEAD` 与工作区的 `^test\(` 计数对比）。
- 定向：`deepSeekHarness` + 工作台共 121/121 通过。
- 完整 focused：`1545 tests / 1537 pass / 0 fail / 8 skipped`，Rust `422 passed / 0 failed / 1 ignored`，`exit=0`。（仓库记忆里 2026-09-26 的基线是 `1524/1516/0/8`，差额来自本改动之外的既有提交。）
- `vue-tsc -b`、`pnpm run lint`、`git diff --check` 均通过；lint 在改动文件上只有 `MemoryWorkbench.vue:1541` 那条既有告警。

**验收状态**：

- 真实 Desktop **已验收通过**（2026-09-27，用户本机）：工具过程行在轮次内可见，刷新后仍在。实时推理尾行仍未在真机见过——上游目前不产生推理（下一条），它没有可显示的内容。
- **Think 折叠行当前是休眠的**：本机真样本 16/16 无推理（§2.3 第 4 条），所以它渲染为空。要让它真的出现，得先决定是否给路由 patch 加 `reasoningEfforts`（独立决策，会改延迟与成本）。
- 「思考 N 秒」的时长未实现：需要 `assistant/message.data.stream` 里的 `reasoning-chunks` 时间戳，本轮 fixtures 刻意不携带该字段；等推理真的出现时再补。
- 同一轮有多个 assistant step 时，轮内仍会出现多个答案气泡（官方把 step 折进一个过程组）。turn 级分组属第二档，本档没做。
- `tool/result.meta` 里的文件 diff（官方卡片用它渲染 diff）本档未消费，属第二档。
