# OpenCode V2 Session 架构 —— 完整复刻手册

> 目标：另一份 AI 读到这份文档后，能完整复刻 OpenCode V2 Session 架构的所有关键机制，包括**对话上下文保持**、**模型/Agent 中途切换**、**事件溯源持久化**、**投影读取模型**。代码可以直接照搬。

---

## 目录

1. [核心概念](#1-核心概念)
2. [数据流总览](#2-数据流总览)
3. [Schema 层](#3-schema-层)
4. [事件系统（Event Sourcing）](#4-事件系统event-sourcing)
5. [Session 门面（Core 层）](#5-session-门面core-层)
6. [Runner 层：LLM 执行循环](#6-runner-层llm-执行循环)
7. [模型解析](#7-模型解析)
8. [消息转换（to-llm-message）](#8-消息转换to-llm-message)
9. [投影器（Projector）：事件 → DB](#9-投影器projector事件--db)
10. [协议层（HTTP API）](#10-协议层http-api)
11. [服务端 Handler](#11-服务端-handler)
12. [依赖图](#12-依赖图)
13. [完整复刻步骤](#13-完整复刻步骤)

---

## 1. 核心概念

### 设计哲学

OpenCode V2 Session 基于 **Event Sourcing（事件溯源）**：

- **不直接修改状态**。所有变更（用户发了消息、模型切换了、工具调用了）都发布为不可变事件。
- **投影器（Projector）** 监听事件流，把事件**投影**到关系型数据库表（`SessionTable`、`SessionMessageTable`），供读取查询。
- **Runner 每次执行时从投影后的数据读取**，而不是持有内存状态。

### 关键术语

| 术语 | 含义 |
|------|------|
| `Session` | 一次对话。包含 ID、元信息（agent、model、location）、消息列表 |
| `SessionMessage` | 一条对话消息（user、assistant、model-switched、system 等） |
| `DurableEvent` | 持久化事件。所有变更都先发布为事件，再投影到消息表 |
| `RunCoordinator` | 每个 Session ID 的执行序列化器，确保同一时间只有一个 drain 在运行 |
| `Runner` | 实际执行 LLM 调用的模块。每轮 `runTurn` 从 DB 重新读取最新状态 |
| `Location` | 运行上下文（目录 + workspaceID）。不同位置可以有不同的 runner 层 |

### 为什么模型切换不丢上下文

```
Session 的"状态" = 所有已发布事件的投影结果

切换模型 = 仅发布一个 ModelSwitched 事件
         → 投影器更新 SessionTable.model 字段
         → 插入一条 type="model-switched" 的消息

下一次 LLM 调用：
  1. 从 DB 读取 Session → 拿到新的 model
  2. 从 DB 读取所有消息 → 包含切换前的全部内容
  3. model-switched 消息在转 LLM 消息时被过滤掉（return []）
  4. 用新模型、旧上下文，发起调用
```

---

## 2. 数据流总览

```
┌─────────────────────────────────────────────────────────────────┐
│                       HTTP API (Protocol)                       │
│  POST /api/session/:id/prompt                                   │
│  POST /api/session/:id/model   ← 模型切换                       │
│  POST /api/session/:id/agent   ← Agent 切换                     │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Server Handler (server/)                     │
│  调用 SessionV2.Service 方法，映射领域错误到 HTTP 错误           │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Session 门面 (core/session.ts)                  │
│  switchModel → EventV2.publish(ModelSwitched)                   │
│  prompt      → SessionInput.admit() + execution.wake()          │
└──────────┬──────────────────────────────────┬───────────────────┘
           │                                  │
           ▼                                  ▼
┌──────────────────────┐    ┌────────────────────────────────────┐
│    EventV2 (core/)   │    │  SessionExecution (core/session/   │
│  publish → DB 持久化  │    │           execution/)              │
│  project → 投影器     │    │  wake → RunCoordinator            │
└──────────────────────┘    │         → drain → SessionRunner     │
                            └────────────────────────────────────┘
                                               │
                                               ▼
                              ┌────────────────────────────────────┐
                              │    SessionRunner (core/session/    │
                              │          runner/)                  │
                              │  1. getSession() → 读取最新状态    │
                              │  2. models.resolve(session) → 模型  │
                              │  3. load history → toLLMMessages  │
                              │  4. llm.stream(request)           │
                              │  5. 工具循环 → 下一个 turn        │
                              └────────────────────────────────────┘
```

---

## 3. Schema 层

### 3.1 Session.Info

**文件**: `packages/schema/src/session.ts`（假设路径，实际可以自建）

```typescript
// Session 的核心数据结构。投影器写入 DB，Runner 从中读取。
Session.Info = {
  id:          SessionID,           // 字符串 ID
  parentID?:   SessionID,           // 父 Session（fork 时）
  projectID:   ProjectID,           // 所属项目
  agent?:      AgentID,             // 当前使用的 agent
  model?:      Model.Ref,           // 当前使用的模型 ← 切换模型就改这个
  cost:        number,              // 累计费用
  tokens: {
    input:     number,
    output:    number,
    reasoning: number,
    cache:     { read: number, write: number }
  },
  time: {
    created:   number,              // 毫秒时间戳
    updated:   number,
    archived?: number
  },
  title:       string,
  location:    Location.Ref,        // { directory: string, workspaceID?: string }
  subpath?:    RelativePath,
  revert?:     Revert.State
}
```

### 3.2 Model.Ref

```typescript
Model.Ref = {
  id:          string,    // 模型 ID，如 "gpt-4o"
  providerID:  string,    // 提供商 ID，如 "openai"
  variant?:    string     // 变体，如 "fast"、"default"
}
```

### 3.3 SessionMessage 类型联合体

**文件**: `packages/schema/src/session-message.ts`

```typescript
// 所有对话消息的联合体。用 type 字段做 tagged union。
SessionMessage.Message =
  | AgentSwitched    // { type: "agent-switched",  agent: string }
  | ModelSwitched    // { type: "model-switched",  model: Model.Ref }
  | User             // { type: "user",            text: string, files?, agents? }
  | Synthetic        // { type: "synthetic",       text: string }
  | System           // { type: "system",          text: string }
  | Shell            // { type: "shell",           command, output }
  | Assistant        // { type: "assistant",       agent, model, content[], finish?, cost?, tokens?, error? }
  | Compaction       // { type: "compaction",      reason, summary, recent }

// 关键：ModelSwitched 和 AgentSwitched 也是"消息"
// 它们被写入消息表，但在转 LLM 消息时被过滤掉
```

### 3.4 SessionMessage.ModelSwitched

```typescript
ModelSwitched = {
  id:        string,
  type:      "model-switched",
  model:     Model.Ref,        // { id, providerID, variant? }
  metadata?: Record<string, unknown>,
  time:      { created: number }
}
```

### 3.5 SessionMessage.Assistant

```typescript
Assistant = {
  id:        string,
  type:      "assistant",
  agent:     string,
  model:     Model.Ref,        // ← 生成此消息的模型（用于后续对比）
  content:   (AssistantText | AssistantReasoning | AssistantTool)[],
  snapshot?: { start?, end?, files? },
  finish?:   string,
  cost?:     number,
  tokens?:   { input, output, reasoning, cache_read, cache_write },
  error?:    { type, message },
  time:      { created, completed? }
}
```

---

## 4. 事件系统（Event Sourcing）

### 4.1 事件类型

**文件**: `packages/schema/src/session-event.ts`

关键事件：

```typescript
// ── 系统事件 ──
AgentSwitched = {
  type: "session.next.agent.switched",
  sessionID, timestamp, messageID,
  agent: string
}

ModelSwitched = {
  type: "session.next.model.switched",
  sessionID, timestamp, messageID,
  model: Model.Ref
}

// ── 输入事件 ──
PromptAdmitted = {
  type: "session.next.prompt.admitted",
  sessionID, timestamp, messageID,
  prompt, delivery
}

Prompted = {
  type: "session.next.prompted",
  sessionID, timestamp, messageID,
  prompt, delivery
}

// ── 步骤事件 ──
StepStarted = {
  type: "session.next.step.started",
  sessionID, timestamp, assistantMessageID,
  agent, model, snapshot?
}

StepEnded = {
  type: "session.next.step.ended",
  sessionID, timestamp, assistantMessageID,
  finish, cost, tokens, snapshot?, files?
}

// ── 工具事件 ──
ToolCalled = {
  type: "session.next.tool.called",
  sessionID, timestamp, assistantMessageID,
  tool, input, provider: { executed, metadata? }
}

ToolSuccess = { type: "session.next.tool.success", ... }
ToolFailed  = { type: "session.next.tool.failed",  ... }

// ── 文本/推理流（仅实时，不持久化） ──
TextStarted  = { type: "session.next.text.started", ... }
TextDelta    = { type: "session.next.text.delta",   ... }  // 仅实时
TextEnded    = { type: "session.next.text.ended",   ... }
```

### 4.2 事件持久化

EventV2 服务负责两件事：

1. **持久化**：写入 `EventTable` + `EventSequenceTable`
2. **投影**：事件发布后，同步调用已注册的 projector 回调

关键接口：

```typescript
interface EventV2.Service {
  publish: <E extends DurableEvent>(
    eventType: EventDef<E>,
    data: E["data"]
  ) => Effect.Effect<E & { durable: { seq: number } }>

  project: <E extends DurableEvent>(
    eventType: EventDef<E>,
    handler: (event: E & { durable: { seq: number } }) => Effect.Effect<void>
  ) => void   // 在启动时注册投影器

  latestSequence: (db, sessionID) => Effect.Effect<number>
}
```

---

## 5. Session 门面（Core 层）

**文件**: `packages/core/src/session.ts`

### 5.1 完整接口

```typescript
interface SessionV2.Interface {
  // 会话管理
  list(input?: { workspaceID?, search?, limit?, order?, anchor? }): Session.Info[]
  create(input: { id?, agent?, model?, location?, ... }): Session.Info
  get(sessionID): Session.Info

  // 消息
  messages(sessionID, limit?, order?, cursor?): SessionMessage.Message[]
  message(sessionID, messageID): Message | undefined
  context(sessionID): SessionMessage.Message[]  // 活跃上下文（最近压缩后）

  // 事件流（SSE）
  events(sessionID, after?): Stream<DurableEvent>
  history(sessionID, after?, limit): { events, hasMore }

  // ★ 核心操作 ★
  switchAgent(sessionID, agent: string): void
  switchModel(sessionID, model: Model.Ref): void    // ← 切模型
  prompt(sessionID, id?, prompt, delivery?, resume?): Admitted  // ← 发消息
  interrupt(sessionID): void

  // 执行控制
  resume(sessionID): void
  active(): Set<SessionID>

  // 回滚
  revert: { stage, clear, commit }
}
```

### 5.2 switchModel 实现

```typescript
switchModel = Effect.fn("V2Session.switchModel")(function* (input) {
  const session = yield* result.get(input.sessionID)

  // 如果模型没变 → 跳过，不发布事件
  if (
    session.model?.providerID === input.model.providerID &&
    session.model.id === input.model.id &&
    (session.model.variant ?? "default") === (input.model.variant ?? "default")
  )
    return

  // 发布 ModelSwitched 事件
  yield* events.publish(SessionEvent.ModelSwitched, {
    sessionID: input.sessionID,
    messageID: SessionMessage.ID.create(),
    timestamp: yield* DateTime.now,
    model: input.model,
  })
})
```

### 5.3 switchAgent 实现

```typescript
switchAgent = Effect.fn("V2Session.switchAgent")(function* (input) {
  yield* result.get(input.sessionID)
  yield* events.publish(SessionEvent.AgentSwitched, {
    sessionID: input.sessionID,
    messageID: SessionMessage.ID.create(),
    timestamp: yield* DateTime.now,
    agent: input.agent,
  })
})
```

### 5.4 prompt 实现

```typescript
prompt = (input) =>
  Effect.uninterruptible(Effect.gen(function* () {
    yield* result.get(input.sessionID)       // 验证 Session 存在
    const messageID = input.id ?? SessionMessage.ID.create()
    const delivery = input.delivery ?? "steer"

    // 持久化接收（写入事件）
    const admitted = yield* SessionInput.admit(db, events, {
      sessionID: input.sessionID,
      messageID,
      prompt: input.prompt,
      delivery,
      timestamp: yield* DateTime.now,
    })

    // 调度执行（除非 resume: false）
    if (input.resume !== false) yield* execution.wake(admitted.sessionID)
    return admitted
  }))
```

---

## 6. Runner 层：LLM 执行循环

**文件**: `packages/core/src/session/runner/llm.ts`

### 6.1 核心循环：run

```typescript
run = Effect.fn("SessionRunner.run")(function* (input: {
  sessionID: SessionSchema.ID,
  force: boolean
}) {
  // 1. 检查是否有待处理的 steer/queue 输入
  const hasSteer = yield* SessionInput.hasPending(db, input.sessionID, "steer")
  const hasQueue = hasSteer ? false : yield* SessionInput.hasPending(db, input.sessionID, "queue")
  if (!input.force && !hasSteer && !hasQueue) return

  // 2. 标记中断的工具为失败
  yield* failInterruptedTools(input.sessionID)

  let promotion = hasSteer ? "steer" : hasQueue ? "queue" : undefined
  let shouldRun = input.force || hasSteer || hasQueue

  // 3. 外层循环：处理所有 queue
  while (shouldRun) {
    let needsContinuation = true
    let step = 1

    // 4. 内层循环：处理工具调用链
    while (needsContinuation) {
      const result = yield* runTurn(input.sessionID, promotion, step)
      needsContinuation = result.needsContinuation
      step = result.step + 1
      promotion = "steer"

      // 如果当前 turn 结束，检查是否有新的 steer
      if (!needsContinuation)
        needsContinuation = yield* SessionInput.hasPending(db, input.sessionID, "steer")
    }

    // 5. 检查是否有 queue 需要处理
    shouldRun = yield* SessionInput.hasPending(db, input.sessionID, "queue")
    promotion = shouldRun ? "queue" : undefined
  }
})
```

### 6.2 单次 Provider Turn：runTurnAttempt

```typescript
runTurnAttempt = Effect.fn("SessionRunner.runTurn")(function* (
  sessionID, promotion, step, recoverOverflow?
) {
  // 1. 读取 Session（包含最新的 model）
  const session = yield* getSession(sessionID)

  // 2. Location 防护 — 如果 workspace 变了就中断
  if (session.location.directory !== location.directory || ...)
    return yield* Effect.interrupt

  // 3. 选择 Agent
  const agent = yield* agents.select(session.agent)

  // 4. 初始化/准备上下文纪元（系统提示词 + 快照）
  const system = yield* SessionContextEpoch.prepare(db, events, loadSystemContext(agent), session.id)

  // 5. ★ 解析模型 ★
  const model = yield* models.resolve(session)

  // 6. 加载对话历史
  const entries = yield* SessionHistory.entriesForRunner(db, session.id, system.baselineSeq)
  const context = entries.map((entry) => entry.message)

  // 7. Agent 步骤限制
  const isLastStep = agent.info?.steps !== undefined && currentStep >= agent.info.steps
  const toolMaterialization = isLastStep ? undefined : yield* tools.materialize(...)

  // 8. ★ 构建 LLM 请求 ★
  const request = LLM.request({
    model,                                    // ← 当前模型（可能是刚切换的）
    system: [agent.info?.system, system.baseline].filter(Boolean).map(SystemPart.make),
    messages: [
      ...toLLMMessages(context, model),        // ← 转换消息（过滤 model-switched）
      ...(isLastStep ? [Message.assistant(MAX_STEPS_PROMPT)] : [])
    ],
    tools: toolMaterialization?.definitions ?? [],
    toolChoice: isLastStep ? "none" : undefined,
  })

  // 9. 检查是否需要压缩
  if (yield* compaction.compactIfNeeded({ sessionID, entries, model, request }))
    return yield* Effect.die(continueAfterCompaction(currentStep))

  // 10. 流式调用 provider
  const publisher = createLLMEventPublisher(events, { sessionID, agent, model, snapshot })
  yield* llm.stream(request).pipe(
    Stream.runForEach((event) => {
      // LLMEvent → SessionEvent 映射
      // 例如: LLM.Text → SessionEvent.TextStarted/TextDelta/TextEnded
      //       LLM.ToolCall → SessionEvent.ToolCalled
      // 通过 publisher 发布
    })
  )

  // 11. 工具执行循环
  // ... 调用工具 → 发布 ToolSuccess/ToolFailed → 再次调用 runTurn

  return { needsContinuation, step: currentStep }
})
```

### 6.3 runTurn 与压缩的配合

```typescript
// 通过 Effect.die + catchDefect 实现非局部跳转
const runTurn: RunTurn = Effect.fnUntraced(function* (sessionID, promotion, step) {
  return yield* runTurnAttempt(sessionID, promotion, step, compaction.compactAfterOverflow).pipe(
    Effect.catchDefect((defect) => {
      if (defect instanceof TurnTransitionError) {
        if (defect.transition._tag === "ContinueAfterCompaction")
          return yield* runAfterCompaction(sessionID, undefined, defect.transition.step)
        if (defect.transition._tag === "ContinueAfterOverflowCompaction")
          return yield* runAfterOverflowCompaction(sessionID, undefined, defect.transition.step)
      }
      return yield* Effect.die(defect)
    }),
  )
})
```

---

## 7. 模型解析

**文件**: `packages/core/src/session/runner/model.ts`

### 7.1 接口

```typescript
interface SessionRunnerModel.Interface {
  resolve: (session: SessionSchema.Info) => Effect.Effect<LLM.Model, Error>
}
```

### 7.2 resolve 实现

```typescript
resolve = Effect.fn("SessionRunnerModel.resolve")(function* (session) {
  // 1. Session 选择了模型 → 在目录中查找
  const selected = session.model
    ? yield* catalog.model.available().find(
        m => m.providerID === session.model!.providerID && m.id === session.model!.id
      )
    // 2. 未选择 → 用默认模型或第一个支持的模型
    : (yield* catalog.model.default()) || (yield* catalog.model.available()).find(supported)

  if (!selected && session.model)
    return yield* new ModelUnavailableError({ providerID, modelID })
  if (!selected)
    return yield* new ModelNotSelectedError({ sessionID: session.id })

  // 3. 解析集成凭据
  const provider = yield* catalog.provider.get(selected.providerID)
  const connection = yield* integrations.connection.active(
    provider?.integrationID ?? Integration.ID.make(selected.providerID)
  )

  // 4. 合并变体覆盖 + 凭据 → LLM Model 对象
  return yield* resolve(session, selected, connection ? ... : undefined)
})
```

### 7.3 支持的 API 类型

目前支持的 API：

```typescript
supported = (model) =>
  model.api.type === "aisdk" && (
    model.api.package === "@ai-sdk/openai" ||
    model.api.package === "@ai-sdk/anthropic" ||
    (model.api.package === "@ai-sdk/openai-compatible" && model.api.url !== undefined)
  )
```

---

## 8. 消息转换（to-llm-message）

**文件**: `packages/core/src/session/runner/to-llm-message.ts`

### 8.1 核心函数

```typescript
// 入口：批量转换
toLLMMessages = (messages: SessionMessage.Message[], model: LLM.Model) =>
  messages.flatMap((message) => toLLMMessage(message, model))

// 单条转换
toLLMMessage = (message: SessionMessage.Message, model: LLM.Model): LLM.Message[] => {
  switch (message.type) {
    case "agent-switched":
    case "model-switched":
      return []   // ← ★ 关键：过滤掉，不传给 LLM

    case "user":
      return [{
        role: "user",
        content: [{ type: "text", text: message.text }, ...(message.files ?? []).map(media)],
        metadata: { ...(message.agents?.length ? { agents: message.agents } : {}) }
      }]

    case "synthetic":
      return [{ role: "user", content: message.text }]

    case "system":
      return [{ role: "system", content: message.text }]

    case "shell":
      return [{ role: "user", content: `Shell command: ${message.command}\n\n${message.output}` }]

    case "assistant":
      return convertAssistant(message, model)   // ← 见下方

    case "compaction":
      return [{ role: "user", content: `<conversation-checkpoint>${message.summary}</conversation-checkpoint>` }]
  }
}
```

### 8.2 Assistant 消息的特殊处理

```typescript
convertAssistant = (message: SessionMessage.Assistant, model: LLM.Model) => {
  const sameModel =
    String(message.model.providerID) === String(model.provider) &&
    String(message.model.id) === String(model.id)

  const content = message.content.flatMap((item) => {
    if (item.type === "reasoning") {
      // ★ 模型切换后的关键行为 ★
      if (sameModel)
        return [{ type: "reasoning", text: item.text, providerMetadata: ... }]
      else
        // 旧模型的推理 token → 降级为纯文本
        return item.text.length > 0 ? [{ type: "text", text: item.text }] : []
    }

    if (item.type === "tool") {
      // provider 元数据仅在模型相同时复用
      return toolCall(item, sameModel ? item.provider?.metadata : undefined)
    }

    return [item]  // AssistantText 原样传递
  })

  return [
    { role: "assistant", content, metadata: message.metadata },
    ...toolResults   // 附带的 tool_result
  ]
}
```

---

## 9. 投影器（Projector）：事件 → DB

**文件**: `packages/core/src/session/projector.ts`

投影器在服务启动时注册，监听事件，把事件同步投影到数据库。

### 9.1 ModelSwitched 投影

```typescript
events.project(SessionEvent.ModelSwitched, (event) =>
  Effect.gen(function* () {
    // 1. 更新 SessionTable.model 字段
    yield* db
      .update(SessionTable)
      .set({
        model: event.data.model,
        time_updated: DateTime.toEpochMillis(event.data.timestamp)
      })
      .where(eq(SessionTable.id, event.data.sessionID))
      .run()
      .pipe(Effect.orDie)

    // 2. 写入一条 type="model-switched" 的消息
    yield* run(db, event)
  })
)
```

### 9.2 AgentSwitched 投影

```typescript
events.project(SessionEvent.AgentSwitched, (event) =>
  db
    .update(SessionTable)
    .set({
      agent: event.data.agent,
      time_updated: DateTime.toEpochMillis(event.data.timestamp)
    })
    .where(eq(SessionTable.id, event.data.sessionID))
    .run()
    .pipe(Effect.orDie, Effect.andThen(run(db, event)))
)
```

### 9.3 run(db, event) — 写入消息表

```typescript
// 通用函数：把事件投影为一条 SessionMessage
const run = (db, event) => {
  switch (event.type) {
    case "session.next.model.switched":
      return adapter.appendMessage(
        SessionMessage.ModelSwitched.make({
          id: event.data.messageID,
          type: "model-switched",
          model: event.data.model,
          time: { created: event.data.timestamp },
        })
      )
    case "session.next.agent.switched":
      return adapter.appendMessage(
        SessionMessage.AgentSwitched.make({
          id: event.data.messageID,
          type: "agent-switched",
          agent: event.data.agent,
          time: { created: event.data.timestamp },
        })
      )
    // ... 其他事件类型
  }
}
```

---

## 10. 协议层（HTTP API）

**文件**: `packages/protocol/src/groups/session.ts`

### 10.1 端点定义

```typescript
// Switch Model
HttpApiEndpoint
  .post("session.switchModel", "/api/session/:sessionID/model", {
    params: { sessionID: Session.ID },
    payload: Schema.Struct({ model: Model.Ref }),
    success: HttpApiSchema.NoContent,
    error: SessionNotFoundError,
  })
  .middleware(sessionLocationMiddleware)
  .annotate(OpenApi.annotations({
    identifier: "v2.session.switchModel",
    summary: "Switch session model",
    description: "Switch the model used by subsequent provider turns.",
  }))

// Switch Agent
HttpApiEndpoint
  .post("session.switchAgent", "/api/session/:sessionID/agent", {
    params: { sessionID: Session.ID },
    payload: Schema.Struct({ agent: Schema.String }),
    success: HttpApiSchema.NoContent,
    error: SessionNotFoundError,
  })
  .middleware(sessionLocationMiddleware)

// Prompt (send message)
HttpApiEndpoint
  .post("session.prompt", "/api/session/:sessionID/prompt", {
    params: { sessionID: Session.ID },
    payload: Schema.Struct({
      id: SessionMessage.ID.pipe(Schema.optional),
      prompt: PromptInput.Prompt,
      delivery: SessionInput.Delivery.pipe(Schema.optional),
      resume: Schema.Boolean.pipe(Schema.optional),
    }),
    success: Schema.Struct({ data: SessionInput.Admitted }),
    error: [ConflictError, SessionNotFoundError],
  })
  .middleware(sessionLocationMiddleware)
```

### 10.2 完整端点列表

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/session` | 列表 |
| POST | `/api/session` | 创建 |
| GET | `/api/session/active` | 活跃会话 |
| GET | `/api/session/:sessionID` | 详情 |
| POST | `/api/session/:sessionID/agent` | **切换 Agent** |
| POST | `/api/session/:sessionID/model` | **切换模型** |
| POST | `/api/session/:sessionID/prompt` | **发送消息** |
| POST | `/api/session/:sessionID/compact` | 压缩 |
| POST | `/api/session/:sessionID/wait` | 等待 |
| POST | `/api/session/:sessionID/interrupt` | 中断 |
| GET | `/api/session/:sessionID/context` | 上下文消息 |
| GET | `/api/session/:sessionID/history` | 事件历史 |
| GET | `/api/session/:sessionID/event` | SSE 实时流 |
| GET | `/api/session/:sessionID/message/:messageID` | 单条消息 |
| POST | `/api/session/:sessionID/revert/stage` | 回滚暂存 |
| POST | `/api/session/:sessionID/revert/clear` | 回滚清除 |
| POST | `/api/session/:sessionID/revert/commit` | 回滚提交 |

---

## 11. 服务端 Handler

**文件**: `packages/server/src/handlers/session.ts`

```typescript
export const SessionHandler = HttpApiBuilder.group(Api, "server.session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service

    return handlers
      .handle("session.switchModel", Effect.fn(function* (ctx) {
        yield* session.switchModel({
          sessionID: ctx.params.sessionID,
          model: ctx.payload.model,
        }).pipe(
          Effect.catchTag("Session.NotFoundError", (error) =>
            Effect.fail(new SessionNotFoundError({ sessionID: error.sessionID, message: `Session not found: ${error.sessionID}` }))
          ),
        )
        return HttpApiSchema.NoContent.make()
      }))

      .handle("session.switchAgent", Effect.fn(function* (ctx) {
        yield* session.switchAgent({
          sessionID: ctx.params.sessionID,
          agent: ctx.payload.agent,
        }).pipe(
          Effect.catchTag("Session.NotFoundError", (error) => /* ... */),
        )
        return HttpApiSchema.NoContent.make()
      }))

      .handle("session.prompt", Effect.fn(function* (ctx) {
        return {
          data: yield* session.prompt({
            sessionID: ctx.params.sessionID,
            id: ctx.payload.id,
            prompt: ctx.payload.prompt,
            delivery: ctx.payload.delivery,
            resume: ctx.payload.resume,
          }).pipe(
            Effect.catchTag("Session.NotFoundError", /* ... */),
            Effect.catchTag("Session.PromptConflictError", /* ... */),
          )
        }
      }))
  })
)
```

---

## 12. 依赖图

```
SessionV2.Service
  ├── SessionStore.Service          — 从 DB 读取 Session.Info
  ├── SessionExecution.Service      — 运行协调
  │     ├── SessionRunCoordinator   — 每个 SessionID 的序列化器
  │     └── SessionRunner.Service   — 实际的 LLM 循环
  │           ├── SessionRunnerModel.Service  — 模型解析（基于 session.model）
  │           ├── AgentV2.Service             — Agent 选择
  │           ├── ToolRegistry.Service         — 工具物化
  │           ├── SessionCompaction            — 压缩检查
  │           ├── SessionContextEpoch          — 系统上下文
  │           └── createLLMEventPublisher      — LLM 事件 → Session 事件
  ├── EventV2.Service               — 事件持久化 + 投影
  ├── SessionProjector.Service      — 事件 → DB 表投影
  ├── SessionInput                  — prompt 接收/steer/queue 管理
  ├── SessionHistory                — 历史加载
  ├── LocationServiceMap.Service    — Location → 服务
  └── Database.Service              — SQLite（Drizzle ORM）
```

---

## 13. 完整复刻步骤

### 第一步：定义 Schema

```
文件清单：
  schema/session.ts         — Session.Info, Model.Ref
  schema/session-event.ts   — 所有事件类型定义
  schema/session-message.ts — 所有消息类型定义
  schema/session-input.ts   — PromptInput, Delivery, Admitted
```

### 第二步：实现事件系统

```
文件清单：
  core/event.ts             — EventV2.Service（publish + project + latestSequence）
  core/event/sql.ts         — EventTable, EventSequenceTable（Drizzle schema）
```

### 第三步：实现投影器

```
文件清单：
  core/session/projector.ts — 注册所有事件投影器
  core/session/message-updater.ts — appendMessage 等辅助函数
  core/session/sql.ts       — SessionTable, SessionMessageTable
```

### 第四步：实现 Session 门面

```
文件清单：
  core/session.ts           — SessionV2.Service（含 switchModel, switchAgent, prompt 等）
  core/session/store.ts     — SessionStore（get, context, message）
  core/session/schema.ts    — 重新导出 schema 类型
```

### 第五步：实现 Runner

```
文件清单：
  core/session/runner/index.ts           — SessionRunner.Interface
  core/session/runner/llm.ts             — run + runTurn 循环
  core/session/runner/model.ts           — 模型解析器
  core/session/runner/to-llm-message.ts  — 消息转换（含 model-switched 过滤）
  core/session/runner/publish-llm-event.ts — LLM 事件映射
```

### 第六步：实现执行协调

```
文件清单：
  core/session/execution.ts      — SessionExecution.Interface
  core/session/execution/local.ts — 本地执行（RunCoordinator + drain）
  core/session/run-coordinator.ts — 每个 SessionID 的序列化器
```

### 第七步：实现 HTTP API

```
文件清单：
  protocol/src/groups/session.ts  — 端点定义
  server/src/handlers/session.ts  — 处理函数
```

### 第八步：数据库表（Drizzle ORM）

```typescript
// SessionTable
SessionTable = sqliteTable("session", {
  id:            text().primaryKey(),
  project_id:    text().notNull(),
  workspace_id:  text(),
  parent_id:     text(),
  slug:          text().notNull(),
  directory:     text().notNull(),
  path:          text(),
  title:         text().notNull(),
  agent:         text(),
  model:         text({ mode: "json" }),     // ← Model.Ref 存为 JSON
  version:       integer().notNull(),
  cost:          real().notNull().default(0),
  tokens_input:  integer().notNull().default(0),
  tokens_output: integer().notNull().default(0),
  // ...更多 token 字段
  time_created:  integer().notNull(),
  time_updated:  integer().notNull(),
  // ...
})

// SessionMessageTable（可选的投影表，用于加速读取）
SessionMessageTable = sqliteTable("session_message", {
  id:          text().primaryKey(),
  session_id:  text().notNull(),
  seq:         integer().notNull(),   // 事件序列号
  type:        text().notNull(),       // "user", "assistant", "model-switched", 等
  data:        text({ mode: "json" }).notNull(),
  time_created: integer().notNull(),
})

// EventTable（事件溯源主表）
EventTable = sqliteTable("event", {
  id:          text().primaryKey(),
  session_id:  text().notNull(),
  seq:         integer().notNull(),
  type:        text().notNull(),
  data:        text({ mode: "json" }).notNull(),
  time_created: integer().notNull(),
})
```

---

## 附录 A：本地源码位置对照

| 组件 | 本地路径 |
|------|----------|
| Schema 定义 | `packages/schema/src/session-event.ts`、`session-message.ts`、`session.ts` |
| Core Session 门面 | `packages/core/src/session.ts` |
| Session Schema 导出 | `packages/core/src/session/schema.ts` |
| Session Store | `packages/core/src/session/store.ts` |
| Session 投影器 | `packages/core/src/session/projector.ts` |
| 消息更新器 | `packages/core/src/session/message-updater.ts` |
| Runner 入口 | `packages/core/src/session/runner/index.ts` |
| Runner 循环 | `packages/core/src/session/runner/llm.ts` |
| 模型解析 | `packages/core/src/session/runner/model.ts` |
| 消息转换 | `packages/core/src/session/runner/to-llm-message.ts` |
| LLM 事件发布 | `packages/core/src/session/runner/publish-llm-event.ts` |
| 执行接口 | `packages/core/src/session/execution.ts` |
| 本地执行 | `packages/core/src/session/execution/local.ts` |
| 运行协调器 | `packages/core/src/session/run-coordinator.ts` |
| 上下文纪元 | `packages/core/src/session/context-epoch.ts` |
| 会话输入管理 | `packages/core/src/session/input.ts` |
| 会话历史加载 | `packages/core/src/session/history.ts` |
| 会话压缩 | `packages/core/src/session/compaction.ts` |
| DB Schema (Drizzle) | `packages/core/src/session/sql.ts` |
| 协议定义 | `packages/protocol/src/groups/session.ts` |
| Server Handler | `packages/server/src/handlers/session.ts` |
| 模型类型 | `packages/core/src/model.ts` |
| Provider 类型 | `packages/core/src/provider.ts` |
| Catalog | `packages/core/src/catalog.ts` |
| Integration | `packages/core/src/integration.ts` |

## 附录 B：最小复刻范围

如果只想复刻"切模型不丢上下文"这个核心功能，最少需要：

1. **Schema**：`Model.Ref`、`SessionMessage.ModelSwitched`、`SessionEvent.ModelSwitched`
2. **事件系统**：`EventV2.publish` + `EventV2.project`
3. **Session 门面**：`SessionV2.switchModel`（发布事件）
4. **投影器**：`ModelSwitched` → 更新 `session.model` + 插入消息
5. **Runner**：`models.resolve(session)` + `toLLMMessages` 过滤 `model-switched`
6. **HTTP**：`POST /api/session/:id/model` → 调用 `switchModel`
