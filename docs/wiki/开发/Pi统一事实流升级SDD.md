# Pi 统一事实流升级 SDD

> 日期：2026-07-21
> 状态：待实施
> 范围：仅创模式的 Direct 工具循环；不改文/武 OpenCode 信息流
> 上游翻译基线：[earendil-works/pi](https://github.com/earendil-works/pi) `c8c3cd499f4d35c0f9cfebfec5f4e3822411a49f`

## 1. 一句话目标

让创模式的每一次工具调用只从 `runDirectChatCompletion` 发出一条统一事实流：**已开始、可选进度、已结束**。Desktop、Web、聊天 UI、授权与工具结果只消费这些事实，不再分别猜测工具处于什么状态。

本 SDD 直接翻译 Pi Agent Core 的工具事件循环，不复制 Pi 的整套 Agent 框架。

## 2. 根因与边界

### 2.1 当前根因

当前 Direct Runtime 已经能循环调用工具，但工具生命周期被拆在多个位置：

```text
directEngine.ts
  -> 得到一批 tool calls 后只发 onToolCalls
  -> directTools.ts 顺序执行工具并构造给模型的 tool message

creativeChat.ts
  -> 把授权、Desktop 执行、取消和 onToolResult 包在 executeTool 内

chatCloud.ts
  -> 自己创建 toolProgress、自己更新完成状态、自己写 UI tool 消息
```

结果是同一个事实在 Desktop 和 Web 各实现一次：Web 在 `onToolCalls` 时直接标为 `executing`；Desktop 也在 `ChatPanel` 的 `onToolCall` 回调里创建进行中步骤。两端还各自决定失败、取消和结果何时写入 UI。这不是工具能力不同，而是运行事实的来源分叉。

### 2.2 本轮只解决什么

1. Direct Runtime 为每个工具调用发出稳定、顺序确定的事件。
2. Desktop/Web 只提供“是否允许”和“怎么执行”两个适配器；不再负责拼生命周期。
3. 现有聊天消息、折叠工具摘要和创作会话持久化继续消费同一事件，不新增项目内对话账本。
4. 用同一组合同测试证明 Desktop 与 Web 都能得到同样的事件顺序和终态语义。

### 2.3 明确不做

- 不接入 Pi 代码或 npm 包，不新增第二个 Agent Runtime。
- 不改模型请求、Skill 目录、MCP 桥接、媒体计划、项目文件合同或用户授权规则。
- 不新建全局事件总线。事件只是 `runDirectChatCompletion` 的局部回调。
- 不移植 Pi 的并行工具执行。创模式现有 `directTools.ts` 是顺序执行，文件/终端/媒体任务也存在顺序依赖；本轮保持顺序。
- 不移植 Pi Extension、会话树、自动压缩、JSONL 会话或项目 `.raw` 账本。
- 不展示模型隐藏推理，也不把 SSE 文本增量伪装为工具进度。

## 3. Pi 源码直译

Pi 的核心实现在 `packages/agent/src/agent-loop.ts`。它没有让 TUI、授权插件或工具本身自行拼状态，而是由工具循环统一发送事实。

| Pi 源码事实 | Pi 的准确时机 | 创模式翻译 | 本轮是否采用 |
| --- | --- | --- | --- |
| `tool_execution_start` | 每个 call 在参数校验和 `beforeToolCall` 前发出 | `tool_execution_start`：模型已请求此工具，运行时准备处理它 | 是 |
| `beforeToolCall` | 参数已校验后、真实执行前；可阻止调用 | `beforeToolCall`：Desktop 的用户审批在此处；Web 为无交互的允许路径 | 是，作为局部回调，不做 Extension |
| `tool_execution_update` | 工具执行过程中通过 `onUpdate(partialResult)` 多次发出 | `tool_execution_update`：仅当某个现有工具真实产生阶段性结果时发出 | 是，保留合同；本轮不伪造进度 |
| `afterToolCall` | 执行完成后、结束事件与工具结果消息前 | `afterToolCall`：唯一结果规范化点，供运行时补全终态 | 是，先只供运行时使用 |
| `tool_execution_end` | 成功、参数错误、审批拦截、工具异常都会发出 | `tool_execution_end`：每一个开始事件必有且仅有一个结束事件 | 是 |
| `message_start/end` 的 tool result | 结束事件后才把结果写成模型消息 | 先发结束事实，再由 Direct Runtime 写给模型的 `role: tool` 消息 | 是 |
| 并行执行 | 默认并行，结果消息仍按模型原始顺序落位 | 顺序执行 | 否，刻意不移植 |

Pi 有一个重要但容易忽略的顺序：**开始事件早于审批和真实执行**。因此一个被用户拒绝、参数不合法或取消的调用，仍然有“开始 -> 结束”这对完整事实。创模式沿用这条规则，才能让 UI 不留下永远旋转的工具步骤。

## 4. 创模式统一事件合同

在 `src/runtime/direct/directTypes.ts` 增加下列局部事件类型。事件的 `call` 直接复用当前 `DirectToolCall`，不另建工具参数模型。

```ts
export type DirectToolExecutionStatus = 'succeeded' | 'failed' | 'cancelled'

export type DirectToolExecutionEvent =
  | {
      type: 'tool_execution_start'
      call: DirectToolCall
    }
  | {
      type: 'tool_execution_update'
      call: DirectToolCall
      detail: string
    }
  | {
      type: 'tool_execution_end'
      call: DirectToolCall
      result: DirectToolResult
      status: DirectToolExecutionStatus
    }
```

合同只有三种事件，不包含 `queued`、`thinking`、`approval_required` 等 UI 状态。它们不是工具执行事实：

- `tool_execution_start` 后至 `beforeToolCall` 返回前，Desktop UI 可以按现有审批组件显示“等待允许”；这是开始事件的派生显示，不是新事件。
- `tool_execution_update` 只有执行器返回真实中间产物才能发。当前文件、MCP 和终端执行器没有统一的流式进度接口，因此本次没有 update 也完全合法。
- `tool_execution_end` 的 `status` 是创模式已有的 `succeeded | failed | cancelled`，比 Pi 单独的 `isError` 更贴合用户拒绝和取消语义。

### 不变量

1. 每一个进入运行时的工具 call 都先发一个 `tool_execution_start`。
2. 每个 start 最终只对应一个同 `call.id` 的 `tool_execution_end`；中间可以有零到多个 update。
3. 顺序执行时，call A 的 end 必须先于 call B 的 start。工具结果消息也保持该顺序。
4. 结束事件必先于该 call 的 `role: tool` 消息进入下一轮模型上下文。
5. 参数错误、审批拒绝、执行异常、AbortSignal 取消和成功都必须落为 end，不能靠调用方补 UI 状态。
6. `tool_execution_end.result.content` 是给 UI 和模型的真实可见结果；不得包含隐藏推理、API Key、附件真实缓存路径或未经处理的敏感凭据。
7. 运行时不写项目 `.raw`，不自动写 Wiki。创作会话仍由既有 UI 会话存储保存。

## 5. 运行时流程

```text
模型流返回 tool calls
  -> 对每个 call：emit(start)
  -> 解析/校验当前工具参数
  -> beforeToolCall(call)
       -> 拒绝：标准化为 cancelled，emit(end)，写 role: tool
       -> 允许：继续
  -> executeTool(call, onUpdate)
       -> 每个真实进度：emit(update)
       -> 成功/异常/取消：标准化为 succeeded/failed/cancelled
  -> afterToolCall(call, result)
  -> emit(end)
  -> 写 role: tool 消息
  -> 全部工具结束后，才向模型发下一轮请求
```

这里的 `beforeToolCall` 不是授权系统重写：Desktop 继续复用已有“拒绝 / 允许 / 始终允许”决策；它只从 `creativeChat.ts` 内嵌的 `confirmTool` 移到 Direct Runtime 的标准入口。`skill` 是否免审批、相对路径边界、绝对路径任务授权、MCP 连接态和终端策略仍由现有工具合同决定。

### 5.1 `runDirectChatCompletion` 新增的最小入口

```ts
onToolEvent?: (event: DirectToolExecutionEvent) => void
beforeToolCall?: (call: DirectToolCall) =>
  | Promise<DirectToolExecutionStatus | void>
  | DirectToolExecutionStatus
afterToolCall?: (
  call: DirectToolCall,
  result: DirectToolResult,
  status: DirectToolExecutionStatus,
) => Promise<DirectToolResult | void> | DirectToolResult | void
```

约定：`beforeToolCall` 只返回 `cancelled` 时阻止真实执行，运行时构造现有的“用户拒绝了本次工具操作，未执行。请换一种方法继续。”结果；不允许调用方自行绕过 end 事件。`afterToolCall` 不负责 UI，也不修改工具名或 call id；它只可规范化已经得到的结果。

保留旧 `onToolCalls` 仅作一个小版本兼容过渡。所有创模式调用点迁至 `onToolEvent` 后删除该回调；不能长期同时维护两套生命周期。

### 5.2 事件消费者责任

| 消费者 | 只做什么 | 不再做什么 |
| --- | --- | --- |
| `directEngine.ts` / `directTools.ts` | 发事件、执行顺序、组装下一轮模型工具消息 | 不触碰 Vue 消息或审批 UI |
| Desktop `creativeChat.ts` | 提供 `beforeToolCall` 的既有审批适配，提供 Desktop 工具执行器 | 不在 `executeTool` 内调用 `onToolResult` |
| Web `chatCloud.ts` | 提供 Web 工具执行器 | 不在执行器内手写步骤开始/完成和 tool 消息 |
| `ChatPanel.vue` | 订阅事件，更新助手消息的 `toolCalls`、`toolProgress`、`toolStatus` | 不反推执行结果或补偿缺失终态 |
| Web 助手消息更新 | 订阅事件，更新相同字段并写当前 UI 会话 | 不创建另一套工具步骤状态机 |

这不是要求 Desktop 与 Web 共用组件；要求的是两端从同一事件事实推导出相同字段。现有 `ToolProgress` 的 `start | executing | result` 可以保留：start 映射事件 start，update 映射为 executing 的真实详情，end 映射 result。不得在 start 时伪装成“已执行”。

## 6. 目标文件与最小改动面

| 文件 | 改动职责 |
| --- | --- |
| `src/runtime/direct/directTypes.ts` | 定义事件、终态和更新回调类型。 |
| `src/runtime/direct/directEngine.ts` | 在单一工具循环接收/转发事件钩子；保留 64 轮默认值、重复失败保护和最终正文断流续写。 |
| `src/runtime/direct/directTools.ts` | 让每个顺序工具调用遵循 start -> 可选 update -> end -> tool message 的固定顺序。 |
| `src/composables/creativeChat.ts` | 将现有授权适配到 `beforeToolCall`；不再在执行器中手动回调工具结果。 |
| `src/composables/web/chatCloud.ts` | 以同一事件回调更新 Web 工具显示与 tool 消息；删除本地生命周期拼装。 |
| `src/components/chat/ChatPanel.vue` | 用同一事件回调更新 Desktop 创模式助手消息。 |
| `src/runtime/direct/__tests__/directEngine.test.ts` | 添加运行时事件顺序、拒绝、失败、取消和多调用测试。 |
| `src/composables/__tests__/creativeChat.test.ts` | 验证 Desktop 授权走标准前钩子，不再从执行器回调终态。 |
| `src/components/__tests__/chatMessagePresentation.test.ts` | 验证 Web/Desktop 从 `onToolEvent` 映射同一显示字段。 |

不新增 Store、服务、IPC、Rust 命令、数据库、项目文件或依赖。

## 7. 实施顺序与验收

### Task 1：先固定运行时事件合同

1. 在 `directEngine.test.ts` 写失败测试，覆盖一个成功工具调用严格得到 `start -> end(succeeded)`。
2. 写失败测试，覆盖工具返回 `failed`、抛异常、前钩子取消和 AbortSignal 取消时，均有同 call id 的 end，且终态分别正确。
3. 写失败测试，覆盖同一模型响应中的两个工具仍严格 `A start -> A end -> B start -> B end`，并且下一轮 `role: tool` 消息顺序为 A、B。
4. 运行该测试，确认当前仅有批量 `onToolCalls` 的实现不能满足事件断言。

验收：测试只观察 Direct Runtime 公共回调，不读取 Vue 源码字符串。

### Task 2：在 Direct Runtime 实现 Pi 的最小事件循环

1. 在 `directTypes.ts` 增加第 4 节的三个事件及终态类型。
2. 将 `directTools.ts` 的顺序 `for` 循环变成事件唯一发射点：start、真实 update（若有）、标准化 end，再写工具消息。
3. 将参数解析/拒绝/异常/取消收进该循环；每条路径都返回 `DirectToolResult` 和确定 status，而不是把状态留给 Desktop 或 Web 判断。
4. `directEngine.ts` 只把 `onToolEvent` 和前后钩子传入工具循环；不改变模型请求内容、重复失败保护、工具轮数上限或断流续写。
5. 运行 Task 1 测试，确认通过。

验收：一次工具调用没有任何 UI 订阅者时，模型工具循环与改造前的可见结果相同。

### Task 3：迁移 Desktop 与 Web 消费者

1. Desktop：把 `confirmTool` 接到 `beforeToolCall`；用 `onToolEvent` 更新 `reactiveAssistantMessage` 和现有 `ToolProgress`，只在 end 写 tool 消息和最终 `toolStatus`。
2. Web：用同一 `onToolEvent` 更新 `webAssistantMsg` 与 `currentMessages`；删除 `executeTool` 内部对 `toolProgress`、`currentMessages`、`toolStatus` 的手工更新。
3. 保持 Web 无 `terminal`、Desktop 用户授权、MCP 动态工具、Skill 白名单和现有取消语义不变。
4. 更新现有消息展示测试，证明两端都是由 `onToolEvent` 驱动，且审批拒绝显示为 `cancelled` 而不是 `failed`。

验收：同一个模拟 `read` 调用，在 Web/Desktop 的工具摘要中均显示同一个工具名、参数、结果和终态；工具轮次正文不残留在最终助手气泡。

### Task 4：结果级回归

1. 运行 Direct Runtime 单测和创模式调用层测试。
2. 运行 `pnpm run test:focused`、`pnpm exec vue-tsc -b`、`pnpm run build`、`pnpm run build:desktop`、`git diff --check`。
3. Desktop 人工验证：允许一次文件工具、拒绝一次文件工具、取消一次终端工具；每次工具卡片都结束且没有悬挂 spinner。
4. Web 人工验证：执行一次项目 read 和一次断连 MCP 调用；工具卡片终态分别为成功和失败，工具结果会返回模型继续作答。

任何既有门禁失败必须按现行测试审计区分，不得为了让本 SDD 变绿改无关 UI、模型或 OpenCode 代码。

## 8. 成功标准

升级完成只能在以下全部成立时宣称：

1. 创模式每个工具调用都可在 Direct Runtime 观察到成对 start/end，包含拒绝、失败和取消。
2. Desktop 与 Web 不再各自拼工具生命周期；两端都只消费 `onToolEvent`。
3. 工具执行仍是顺序的，模型下一轮仍收到原有 OpenAI 兼容 `assistant tool_calls + role: tool` 消息形状。
4. 用户审批、Skill 资源边界、项目路径边界、MCP 连接态、媒体任务和 UI 会话存储的原有合同不退化。
5. 不产生新的项目对话文件、记忆库、全局事件总线或 Pi 依赖。

## 9. 调研依据

- Pi：`packages/agent/src/agent-loop.ts` 的 `executeToolCallsSequential`、`prepareToolCall`、`executePreparedToolCall`、`finalizeExecutedToolCall`、`emitToolExecutionEnd`；`packages/agent/src/types.ts` 的 `AgentEvent`、`BeforeToolCallContext`、`AfterToolCallContext`。
- 当前实现：`src/runtime/direct/directEngine.ts`、`directTools.ts`、`directTypes.ts`、`src/composables/creativeChat.ts`、`src/composables/web/chatCloud.ts`、`src/components/chat/ChatPanel.vue`。
- 当前产品边界：[创作模式双端统一 SDD](创作模式双端统一SDD.md)、[创模式 Raw 账本与对话 Wiki 移除 SDD](创模式Raw账本与对话Wiki移除SDD.md)、[创模式 MCP 工具接入 SDD](创模式MCP工具接入SDD.md)。
