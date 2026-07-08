# OpenCode 信息隔离架构 —— 完整复刻手册

> 目标：另一份 AI 读完后，能完整复刻 OpenCode 的**多项目/多会话/多工作空间信息隔离机制**。代码可以直接照搬。

---

## 目录

1. [隔离层次总览](#1-隔离层次总览)
2. [第一层：项目隔离（Project）](#2-第一层项目隔离project)
3. [第二层：位置隔离（Location）](#3-第二层位置隔离location)
4. [第三层：会话隔离（Session）](#4-第三层会话隔离session)
5. [第四层：上下文隔离（Context/Messages）](#5-第四层上下文隔离contextmessages)
6. [第五层：执行隔离（RunCoordinator）](#6-第五层执行隔离runcoordinator)
7. [数据库表设计](#7-数据库表设计)
8. [用户操作流程的隔离链路](#8-用户操作流程的隔离链路)
9. [完整复刻步骤](#9-完整复刻步骤)
10. [附录：本地源码路径对照](#10-附录本地源码路径对照)

---

## 1. 隔离层次总览

OpenCode 的信息隔离是**五层嵌套**的：

```
┌─────────────────────────────────────────────────────────┐
│  ⑤ 执行隔离 (RunCoordinator)                             │
│  每个 SessionID 同时只能有一个 drain 在运行               │
├─────────────────────────────────────────────────────────┤
│  ④ 上下文隔离 (SessionHistory / toLLMMessages)          │
│  WHERE session_id = ? 确保消息绝对不跨会话                │
├─────────────────────────────────────────────────────────┤
│  ③ 会话隔离 (Session → SessionMessage)                  │
│  session 表有 project_id 外键，按项目归属                 │
├─────────────────────────────────────────────────────────┤
│  ② 位置隔离 (Location → DI Scope)                       │
│  每个目录/workspace 获得独立的服务实例                    │
│  (Agent, Catalog, ToolRegistry, FileSystem 等)           │
├─────────────────────────────────────────────────────────┤
│  ① 项目隔离 (Project.ID)                                 │
│  从 Git 远程/根提交哈希 计算稳定 ID                      │
│  session.session.project_id = project.id                 │
└─────────────────────────────────────────────────────────┘
```

### 一句话总结

| 隔离什么 | 机制 | 代码位置 |
|----------|------|----------|
| 项目 A 的会话看不到项目 B 的会话 | SQL `WHERE project_id = ?` | `session.ts list()` |
| 项目 A 的 Provider/Agent 配置不影响项目 B | DI 容器按 Location 实例化 | `LocationServiceMap` |
| 同一个项目内，会话 1 看不到会话 2 的消息 | SQL `WHERE session_id = ?` | `history.ts`, `input.ts` |
| 项目 A 的 Runner 不会误跑项目 B 的会话 | 运行时 Location guard | `runner/llm.ts runTurnAttempt` |
| 同一个会话的两个并发执行不会打架 | 按 Key 的 FiberMap 序列化 | `run-coordinator.ts` |

---

## 2. 第一层：项目隔离（Project）

### 2.1 Project.ID 的计算

**目的**：同一个 Git 仓库不论克隆到哪个目录，都算出相同的 Project.ID。

**文件**: `packages/core/src/project.ts`

有三种策略，优先级从高到低：

```typescript
// 策略 1 — Git 远程 URL（最稳定）
// 如果两个工作树的 origin 远程地址相同 → 拿到相同 ID
const resolveFromRemote = function* (repo: Git.Repository) {
  const origin = yield* git.remote.get(repo)
  if (!origin) return undefined
  const normalized = normalizeGitURL(origin)  // git@github.com:a/b → https://github.com/a/b
  if (!normalized) return undefined
  return ID.make(hash.fast(`git-remote:${normalized}`))
}

// 策略 2 — 本地缓存文件
// .git/opencode 文件中存了一个持久化的 ID
const resolveFromCache = function* (dir: string) {
  return yield* fs.readFileString(path.join(dir, "opencode")).pipe(
    Effect.map((value) => value.trim()),
    Effect.map((value) => (value ? ID.make(value) : undefined)),
    Effect.catch(() => Effect.succeed(undefined)),
  )
}

// 策略 3 — Git 根提交哈希（回退方案）
const resolveFromRootCommit = function* (repo: Git.Repository) {
  const root = (yield* git.history.rootCommits(repo))[0]
  return root ? ID.make(root) : undefined
}

// 最终回退：临时路径用全局 ID
ID.global  // 用于无 Git 仓库的临时目录
```

### 2.2 Session 表通过 project_id 外键关联

**文件**: `packages/core/src/session/sql.ts`

```typescript
export const SessionTable = sqliteTable("session", {
  id: text().$type<SessionSchema.ID>().primaryKey(),
  project_id: text()
    .$type<ProjectV2.ID>()
    .notNull()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  // ...其他字段
}, (table) => [
  index("session_project_idx").on(table.project_id),       // ← 按项目快速过滤
  index("session_workspace_idx").on(table.workspace_id),
  index("session_parent_idx").on(table.parent_id),
])
```

### 2.3 列表查询时按 project_id 过滤

**文件**: `packages/core/src/session.ts`（`list()` 方法）

```typescript
list: Effect.fn("V2Session.list")(function* (input = {}) {
  const conditions: SQL[] = []
  if ("directory" in input) conditions.push(eq(SessionTable.directory, input.directory))
  if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
  if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))  // ← 项目隔离
  if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
  // ...所有条件 AND 连接
})
```

### 2.4 ListInput 的三种变体

```typescript
const ListProjectInput = Schema.Struct({
  ...ListInputBase,
  project: ProjectV2.ID,           // ← 强制按项目过滤
  subpath: RelativePath.pipe(Schema.optional),
})
const ListDirectoryInput = Schema.Struct({
  ...ListInputBase,
  directory: AbsolutePath,         // ← 按目录过滤
})
const ListAllInput = Schema.Struct(ListInputBase)  // ← 无过滤（管理员视图）
```

### 2.5 创建 Session 时绑定项目

**文件**: `packages/core/src/session.ts`（`create()` 方法）

```typescript
create: Effect.fn("V2Session.create")(function* (input) {
  // 先解析项目（从目录路径计算 Project.ID）
  const project = yield* projects.resolve(input.location.directory)

  // 确保 project 行存在
  yield* db
    .insert(ProjectTable)
    .values({ id: project.id, worktree: project.directory, vcs: project.vcs?.type, sandboxes: [] })
    .onConflictDoNothing()
    .run()

  // session 记录存入 projectID
  // ... 后续 publish Created 事件，投影器写入 project_id
})
```

---

## 3. 第二层：位置隔离（Location）

这是最关键的隔离机制。OpenCode 使用 **DI 作用域（Dependency Injection Scoping）** 来实现位置的完全隔离。

### 3.1 Location.Ref

**文件**: `packages/core/src/location.ts`

```typescript
// Location 只是 { directory: string, workspaceID?: string }
// 但每个不同的 Location.Ref 会实例化一套独立的服务

export interface Interface extends Info {
  readonly vcs?: Project.Vcs
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Location") {}

// 全局（未绑定）节点
export const node = LayerNode.unbound(Service, tags.values.location)

// 绑定到具体 ref 的节点 — 每个 ref 实例化独立的 Location Service
export const boundNode = (ref: Ref) =>
  makeLocationNode({
    service: Service,
    layer: layer(ref),       // ← 每个 ref 自己的 layer
    deps: [Project.node],
  })
```

### 3.2 LocationServiceMap — 按 Ref 路由

**文件**: `packages/core/src/location-service-map.ts`

```typescript
export class Service extends Context.Service<
  Service,
  LayerMap.LayerMap<Location.Ref, LocationServices, LocationError>
>()("@opencode/example/LocationServiceMap") {
  // 获取某个 Location 对应的完整服务层
  static get(ref: Location.Ref) {
    return Layer.unwrap(Effect.map(Service, (locations) => locations.get(ref)))
  }
}
```

### 3.3 LocationServices — 每个位置独立实例化的服务

**文件**: `packages/core/src/location-services.ts`

```typescript
export const locationServices = LayerNode.group([
  Location.node,
  Policy.node,
  Config.node,
  AgentV2.node,              // ← Agent 配置是位置隔离的
  CommandV2.node,
  Reference.node,
  Integration.node,
  Catalog.node,              // ← Provider/Model 目录是位置隔离的
  AISDK.node,
  PluginV2.node,
  SystemContextRegistry.node,
  LocationMutation.node,
  FileMutation.node,
  PermissionV2.node,
  ToolOutputStore.node,
  ToolRegistry.node,         // ← 工具注册表是位置隔离的
  SkillGuidance.node,
  SessionRunnerModel.node,   // ← 模型解析器是位置隔离的
  Snapshot.node,
  SessionRunnerLLM.node,     // ← Runner 本身也是位置隔离的
  // ...更多
])
```

**效果**：项目 A 的 Agent 配置、Provider 列表、工具集、文件系统权限，完全不影响项目 B。每一个 `Location.Ref` 得到自己独立的内存状态。

### 3.4 执行时通过 Location guard 防止跨位置执行

**文件**: `packages/core/src/session/runner/llm.ts`（`runTurnAttempt` 开头）

```typescript
const runTurnAttempt = Effect.fn("SessionRunner.runTurn")(function* (sessionID, promotion, step) {
  const session = yield* getSession(sessionID)

  // ★ Location 守卫 ★
  // 如果这个 Session 属于另一个目录或 workspace，立即中断
  if (
    session.location.directory !== location.directory ||
    session.location.workspaceID !== location.workspaceID
  )
    return yield* Effect.interrupt
  // ...
})
```

### 3.5 Execution 路由时注入位置服务

**文件**: `packages/core/src/session/execution/local.ts`

```typescript
const layer = Layer.effect(SessionExecution.Service, Effect.gen(function* () {
  const locations = yield* LocationServiceMap.Service
  const coordinator = yield* SessionRunCoordinator.make({
    drain: Effect.fnUntraced(function* (sessionID, force) {
      const session = yield* store.get(sessionID)
      // ★ 关键：注入 Session 所在位置的 Runner ★
      return yield* SessionRunner.Service.use((runner) => runner.run({ sessionID, force }))
        .pipe(Effect.provide(locations.get(session.location)))
    }),
  })
}))
```

---

## 4. 第三层：会话隔离（Session）

### 4.1 Session 自身的唯一性

每个 Session 有唯一 ID（`SessionSchema.ID`），所有关联表通过外键引用它：

```
SessionTable.id
  ← SessionMessageTable.session_id (CASCADE DELETE)
  ← SessionInputTable.session_id   (CASCADE DELETE)
  ← SessionContextEpochTable.session_id (CASCADE DELETE)
  ← TodoTable.session_id           (CASCADE DELETE)
```

### 4.2 消息表按 session_id 查询

**文件**: `packages/core/src/session/history.ts`

```typescript
export const entriesForRunner = Effect.fn("SessionHistory.entriesForRunner")(function* (
  db, sessionID, baselineSeq
) {
  const rows = yield* messageRows(db, sessionID, yield* latestCompaction(db, sessionID), baselineSeq)
  // 解码并返回仅属于该 session 的消息
})

const messageRows = function* (db, sessionID, compaction, baselineSeq?) {
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(
      and(
        eq(SessionMessageTable.session_id, sessionID),  // ← 唯一过滤条件
        compaction ? or(gte(SessionMessageTable.seq, compaction.seq), ...) : undefined,
        // ...
      ),
    )
    .orderBy(asc(SessionMessageTable.seq))
    .all()
  // ...
}
```

**隔离保证**：这是纯粹的 SQL 级别隔离——`WHERE session_id = ?`。不同类型的查询（history、context、input）都通过这个条件保证不会读到其他会话的数据。

### 4.3 SessionInput 队列按 session_id 隔离

**文件**: `packages/core/src/session/input.ts`

```typescript
export const hasPending = function* (db, sessionID, delivery) {
  const row = yield* db
    .select()
    .from(SessionInputTable)
    .where(and(
      eq(SessionInputTable.session_id, sessionID),      // ← 按会话过滤
      isNull(SessionInputTable.promoted_seq),
      eq(SessionInputTable.delivery, delivery),
    ))
    .limit(1)
    .get()
}

export const admit = Effect.fn("SessionInput.admit")(function* (
  db, events, input
) {
  // 写入时也带 sessionID
  return yield* events.publish(SessionEvent.PromptAdmitted, {
    messageID: input.id,
    sessionID: input.sessionID,   // ← 隔离点
    // ...
  })
})
```

---

## 5. 第四层：上下文隔离（Context/Messages）

### 5.1 toLLMMessages 是纯函数

**文件**: `packages/core/src/session/runner/to-llm-message.ts`

```typescript
// 入口：批量转换 — 纯函数，不查 DB
export const toLLMMessages = (messages: readonly SessionMessage.Message[], model: Model) =>
  messages.flatMap((message) => toLLMMessage(message, model))
```

关键点：这个函数**不查询数据库**，不访问外部状态。它只处理传入的消息数组。每个 Session 的消息由上层（`SessionHistory.entriesForRunner()`）单独提取，所以这一层不可能泄露。

### 5.2 Context Epoch 按 Session 存储

**文件**: `packages/core/src/session/context-epoch.ts`

```typescript
// 表结构：每个 Session 一条记录
const SessionContextEpochTable = sqliteTable("session_context_epoch", {
  session_id: text().$type<SessionSchema.ID>().primaryKey(),  // ← 主键就是 session_id
  baseline: text().notNull(),
  snapshot: text({ mode: "json" }).notNull(),
  baseline_seq: integer().notNull(),
})

// 所有操作都按 session_id 过滤
const find = (db, sessionID) =>
  db.select().from(SessionContextEpochTable).where(eq(SessionContextEpochTable.session_id, sessionID)).get()

const insert = (db, sessionID, generation) =>
  db.insert(SessionContextEpochTable).values({ session_id: sessionID, ... }).run()
```

### 5.3 投影器确保事件归属正确

**文件**: `packages/core/src/session/projector.ts`

所有事件投影写入 `SessionMessageTable` 时都带 `session_id`：

```typescript
events.project(SessionEvent.ModelSwitched, (event) =>
  Effect.gen(function* () {
    yield* db
      .update(SessionTable)
      .set({ model: event.data.model, ... })
      .where(eq(SessionTable.id, event.data.sessionID))   // ← 只更新本 Session
      .run()
    yield* run(db, event)   // ← run() 中写入的消息也带 session_id
  })
)
```

---

## 6. 第五层：执行隔离（RunCoordinator）

### 6.1 SessionRunCoordinator — 按 Key 序列化

**文件**: `packages/core/src/session/run-coordinator.ts`

```typescript
export interface Coordinator<Key, E> {
  readonly active: Effect.Effect<ReadonlySet<Key>>
  readonly run: (key: Key) => Effect.Effect<void, E>      // 启动或加入
  readonly wake: (key: Key) => Effect.Effect<void>          // 有工作后唤醒
  readonly interrupt: (key: Key) => Effect.Effect<void>      // 中断
}

type Entry<E> = {
  readonly done: Deferred.Deferred<void, E>
  owner?: Fiber.Fiber<void, never>
  pendingWake: boolean
  stopping: boolean
}

export const make = <Key, E>(options: {
  readonly drain: (key: Key, force: boolean) => Effect.Effect<void, E>
}): Effect.Effect<Coordinator<Key, E>> =>
  Effect.gen(function* () {
    const active = new Map<Key, Entry<E>>()  // ← 按 Key 隔离的 FiberMap

    const start = (key: Key, entry: Entry<E>, force: boolean, successor = false) => {
      // 为 key 启动一个 Fiber
      const owner = fork(
        options.drain(key, force).pipe(
          Effect.onExit((exit) => Effect.sync(() => settle(key, entry, exit))),
          Effect.exit,
        ),
      )
      entry.owner = owner
    }

    const settle = (key: Key, entry: Entry<E>, exit: Exit.Exit<void, E>) => {
      // 执行结束 → 如果有 pendingWake 就启动下一个
      if (Exit.isSuccess(exit) && !entry.stopping && entry.pendingWake) {
        entry.pendingWake = false
        start(key, entry, false, true)  // 后续 drain
        return
      }
      // 没有 pending → 从 Map 移除
      active.delete(key)
    }
  })
```

**效果**：
- 同一个 `SessionID` 同时最多只有一个 `drain` 在运行
- 不同 `SessionID` 可以**并发运行**
- `wake()` 在当前的 drain 结束后立即调度下一个

---

## 7. 数据库表设计

### 7.1 project 表

```typescript
const ProjectTable = sqliteTable("project", {
  id: text().$type<ProjectID>().primaryKey(),
  worktree: text().notNull(),    // 绝对路径，如 /Users/me/my-project
  vcs: text(),                   // "git"
  sandboxes: text({ mode: "json" }).$type<string[]>(),
})
```

### 7.2 session 表

```typescript
const SessionTable = sqliteTable("session", {
  id:            text().$type<SessionID>().primaryKey(),
  project_id:    text().$type<ProjectID>().notNull()
                   .references(() => ProjectTable.id, { onDelete: "cascade" }),
  workspace_id:  text().$type<WorkspaceID>(),
  parent_id:     text().$type<SessionID>(),
  slug:          text().notNull(),
  directory:     text().notNull(),
  path:          text(),
  title:         text().notNull(),
  agent:         text(),
  model:         text({ mode: "json" }).$type<{ id, providerID, variant? }>(),
  cost:          real().notNull().default(0),
  tokens_input:  integer().notNull().default(0),
  tokens_output: integer().notNull().default(0),
  time_created:  integer().notNull(),
  time_updated:  integer().notNull(),
  // ...
}, (table) => [
  index("session_project_idx").on(table.project_id),
  index("session_workspace_idx").on(table.workspace_id),
  index("session_parent_idx").on(table.parent_id),
])
```

### 7.3 session_message 表

```typescript
const SessionMessageTable = sqliteTable("session_message", {
  id:          text().$type<MessageID>().primaryKey(),
  session_id:  text().$type<SessionID>().notNull()
                 .references(() => SessionTable.id, { onDelete: "cascade" }),
  type:        text().$type<string>().notNull(),   // "user", "assistant", "model-switched"
  seq:         integer().notNull(),                 // 事件序列号
  time_created: integer().notNull(),
  data:        text({ mode: "json" }).notNull(),    // 消息体 JSON
}, (table) => [
  uniqueIndex("session_message_session_seq_idx").on(table.session_id, table.seq),
  index("session_message_session_type_seq_idx").on(table.session_id, table.type, table.seq),
  index("session_message_session_time_created_id_idx").on(table.session_id, table.time_created, table.id),
])
```

### 7.4 session_input 表

```typescript
const SessionInputTable = sqliteTable("session_input", {
  id:           text().$type<MessageID>().primaryKey(),
  session_id:   text().$type<SessionID>().notNull()
                   .references(() => SessionTable.id, { onDelete: "cascade" }),
  prompt:       text({ mode: "json" }).notNull(),
  delivery:     text().notNull(),           // "steer" | "queue"
  admitted_seq: integer().notNull(),
  promoted_seq: integer(),
  time_created: integer().notNull(),
}, (table) => [
  index("session_input_session_pending_delivery_seq_idx").on(
    table.session_id, table.promoted_seq, table.delivery, table.admitted_seq,
  ),
  uniqueIndex("session_input_session_admitted_seq_idx").on(table.session_id, table.admitted_seq),
])
```

### 7.5 session_context_epoch 表

```typescript
const SessionContextEpochTable = sqliteTable("session_context_epoch", {
  session_id:   text().$type<SessionID>().primaryKey()
                   .references(() => SessionTable.id, { onDelete: "cascade" }),
  baseline:     text().notNull(),       // 系统提示词基线文本
  snapshot:     text({ mode: "json" }).notNull(),
  baseline_seq: integer().notNull(),
})
```

### 7.6 索引策略

| 索引 | 用途 |
|------|------|
| `session_project_idx` | 按项目列出 Session |
| `session_workspace_idx` | 按工作空间列出 Session |
| `session_parent_idx` | 查找子 Session（fork） |
| `session_message_session_seq_idx` | 按 Session + 序列号定位消息 |
| `session_message_session_type_seq_idx` | 按 Session + 类型过滤（如只查 user 消息） |
| `session_input_session_pending_delivery_seq_idx` | 查找待处理的 steer/queue |

---

## 8. 用户操作流程的隔离链路

### 场景 1：选择项目 A → 新建会话 → 发消息

```
用户点击项目 A
  → navigateToProject("/path/to/project-a")
     → server.projects.touch("/path/to/project-a")
     → 查找 ProjectA 的最新会话
     → 导航到 /directory/session/:id

新建会话
  → POST /api/session
     → projects.resolve("/path/to/project-a")
        → 从 Git 远程 URL 计算 ProjectA.ID
     → 写入 SessionTable: { id, project_id: ProjectA.ID, directory: "/path/to/project-a" }

发消息
  → POST /api/session/:id/prompt
     → SessionV2.prompt({ sessionID, prompt })
        → SessionInput.admit(db, events, { sessionID, ... })
           → 写入 SessionInputTable: { session_id, admitted_seq }
           → 发布 PromptAdmitted 事件
        → execution.wake(sessionID)
           → RunCoordinator.wake(sessionID)
              → 启动 drain
                 → 注入 Location/{directory: "/path/to/project-a"} 的服务层
                 → SessionRunner.run()
                    → models.resolve(session)
                       → 从位置隔离的 Catalog 中找模型
                    → SessionHistory.entriesForRunner(db, sessionID)
                       → WHERE session_id = ? 只读本会话消息
                    → toLLMMessages(context, model)
                       → 纯函数转换
                    → llm.stream(request)
```

### 场景 2：切换会话（同一项目内）

```
用户点击侧边栏另一个会话
  → navigateToSession(targetSession)
     → 导航到 /directory/session/:otherId

发消息
  → POST /api/session/:otherId/prompt
     → 流程同上，但 sessionID 不同
     → SessionHistory.entriesForRunner() 的 WHERE session_id = :otherId
     → 完全看不到之前会话的任何消息
```

### 场景 3：切换到项目 B

```
用户点击项目 B 的图标
  → navigateToProject("/path/to/project-b")
     → server.projects.touch("/path/to/project-b")
     → 从 ProjectB 的 Git 远程算出 ProjectB.ID（和 A 不同）
     → 查找 ProjectB 的最新会话
     → 导航到 /directory/:projectB-dir/session/:id

发消息
  → POST /api/session/:id/prompt
     → 同样的代码路径
     → 但 session.project_id = ProjectB.ID （不同项目）
     → 且 session.location.directory 指向 project-b
     → LocationServiceMap.get({ directory: "/path/to/project-b" })
        → 注入项目 B 独立的一套 Catalog/Agent/ToolRegistry
     → 项目 A 和 B 的服务实例完全独立
```

### 完整数据流图

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│  用户操作     │     │  App UI           │     │  Server (HTTP API)   │
│              │     │                   │     │                      │
│ 选项目 A →   │────▶│ navigateToProject │────▶│ sessions.create()    │
│ 新建会话     │     │ → touch project   │     │ → resolve Project.ID │
│              │     │ → openSession     │     │ → INSERT session     │
│              │     │                   │     │   (project_id = A)   │
├──────────────┤     ├──────────────────┤     ├──────────────────────┤
│              │     │                   │     │                      │
│ 发消息       │────▶│ prompt-input      │────▶│ sessions.prompt()   │
│              │     │ → POST /prompt    │     │ → SessionInput.admit │
│              │     │                   │     │ → execution.wake()  │
└──────────────┘     └──────────────────┘     └──────────┬───────────┘
                                                          │
                                                          ▼
                                              ┌──────────────────────┐
                                              │  SessionExecution    │
                                              │  (RunCoordinator)    │
                                              │  Map<SessionID,     │
                                              │    Fiber>            │
                                              │  → 同 ID 串行        │
                                              │  → 不同 ID 并发      │
                                              └──────────┬───────────┘
                                                          │
                                                          ▼
                                              ┌──────────────────────┐
                                              │  SessionRunner       │
                                              │  (位置作用域)         │
                                              │                      │
                                              │  1. Location Guard   │
                                              │     directory === ?  │
                                              │                      │
                                              │  2. models.resolve() │
                                              │     → 本位置的 Catalog│
                                              │                      │
                                              │  3. load history     │
                                              │     WHERE session_id │
                                              │                      │
                                              │  4. toLLMMessages()  │
                                              │     → 纯函数          │
                                              │                      │
                                              │  5. llm.stream()     │
                                              └──────────────────────┘
```

---

## 9. 完整复刻步骤

### 第一步：数据库表

```
文件清单：
  db/schema/project.ts           — ProjectTable
  db/schema/session.ts           — SessionTable + 索引
  db/schema/session_message.ts   — SessionMessageTable + 索引
  db/schema/session_input.ts     — SessionInputTable + 索引
  db/schema/session_context_epoch.ts — SessionContextEpochTable
```

### 第二步：Project 层

```
文件清单：
  core/project.ts                — Project.ID 计算（Git 远程/缓存/根提交）
  core/project/sql.ts            — ProjectTable Drizzle 定义
```

### 第三步：Location 层

```
文件清单：
  core/location.ts               — Location.Ref + boundNode
  core/location-service-map.ts   — LayerMap<Location.Ref, LocationServices>
  core/location-services.ts      — 每个位置的服务列表
  core/effect/app-node.ts        — makeLocationNode（DI 作用域实现）
```

### 第四步：Session 基础

```
文件清单：
  core/session/schema.ts         — Session.Info 重新导出
  core/session/sql.ts            — 所有表定义
  core/session/store.ts          — SessionStore（get, context, message）
```

### 第五步：Session 门面

```
文件清单：
  core/session.ts                — SessionV2.Interface（含 list/create/get/switchModel/switchAgent/prompt）
```

关键隔离代码：

```typescript
// list() — 按 project_id / directory / workspace_id 过滤
const conditions: SQL[] = []
if ("directory" in input) conditions.push(eq(SessionTable.directory, input.directory))
if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))

// create() — 绑定 project_id
const project = yield* projects.resolve(input.location.directory)
// 写入 project 行 + session 行
```

### 第六步：Session 内部模块

```
文件清单：
  core/session/history.ts        — 按 session_id 加载消息
  core/session/input.ts          — 按 session_id 管理输入队列
  core/session/context-epoch.ts  — 按 session_id 存储系统上下文
  core/session/event.ts          — 事件类型重新导出
```

### 第七步：Runner

```
文件清单：
  core/session/runner/index.ts             — SessionRunner.Interface
  core/session/runner/llm.ts               — run + runTurn（含 Location Guard）
  core/session/runner/model.ts             — 位置作用域的模型解析
  core/session/runner/to-llm-message.ts    — 纯函数消息转换
```

Location Guard 关键代码：

```typescript
// runner/llm.ts  — runTurnAttempt 开头
const session = yield* getSession(sessionID)
if (
  session.location.directory !== location.directory ||
  session.location.workspaceID !== location.workspaceID
)
  return yield* Effect.interrupt
```

### 第八步：执行协调

```
文件清单：
  core/session/execution.ts       — SessionExecution.Interface
  core/session/execution/local.ts — 按 Location 注入 Runner
  core/session/run-coordinator.ts — 按 Key 序列化的 FiberMap
```

Executor 路由关键代码：

```typescript
// execution/local.ts
yield* SessionRunner.Service.use((runner) => runner.run({ sessionID, force }))
  .pipe(Effect.provide(locations.get(session.location)))
  // ↑ 每个 Session 获取其 Location 的 Runner 实例
```

### 第九步：HTTP API

```
文件清单：
  protocol/src/groups/session.ts  — 端点定义（list/create/prompt/switchModel/switchAgent）
  server/src/handlers/session.ts  — 处理函数
```

### 第十步：投影器

```
文件清单：
  core/session/projector.ts       — 事件 → DB 投影（确保 session_id 正确）
  core/session/message-updater.ts — 消息追加辅助
```

---

## 10. 附录：本地源码路径对照

| 组件 | 本地路径 |
|------|----------|
| Project.ID 计算 | `packages/core/src/project.ts` |
| Project SQL | `packages/core/src/project/sql.ts` |
| Location 定义 | `packages/core/src/location.ts` |
| LocationServiceMap | `packages/core/src/location-service-map.ts` |
| LocationServices | `packages/core/src/location-services.ts` |
| DI 作用域实现 | `packages/core/src/effect/app-node.ts` |
| Session 门面（Core） | `packages/core/src/session.ts` |
| Session Schema | `packages/core/src/session/schema.ts` |
| Session SQL（所有表定义） | `packages/core/src/session/sql.ts` |
| Session Store | `packages/core/src/session/store.ts` |
| Session History | `packages/core/src/session/history.ts` |
| Session Input | `packages/core/src/session/input.ts` |
| Context Epoch | `packages/core/src/session/context-epoch.ts` |
| 投影器 | `packages/core/src/session/projector.ts` |
| 消息更新器 | `packages/core/src/session/message-updater.ts` |
| Runner 入口 | `packages/core/src/session/runner/index.ts` |
| Runner LLM 循环 | `packages/core/src/session/runner/llm.ts` |
| 模型解析 | `packages/core/src/session/runner/model.ts` |
| 消息转换 | `packages/core/src/session/runner/to-llm-message.ts` |
| 执行接口 | `packages/core/src/session/execution.ts` |
| 本地执行 | `packages/core/src/session/execution/local.ts` |
| 运行协调器 | `packages/core/src/session/run-coordinator.ts` |
| 协议定义 | `packages/protocol/src/groups/session.ts` |
| Server Handler | `packages/server/src/handlers/session.ts` |
| App 项目切换 | `packages/app/src/pages/layout.tsx` |
| 工作空间 | `packages/core/src/workspace.ts` |
| Agent | `packages/core/src/agent.ts` |
| Catalog | `packages/core/src/catalog.ts` |
| 集成层 | `packages/core/src/integration.ts` |

---

## 附录 B：最小复刻范围

如果只想复刻"多项目/多会话信息隔离"，最少需要：

1. **数据库**：`project` 表 + `session` 表（带 `project_id` 外键）+ `session_message` 表（带 `session_id`）
2. **Project**：从 Git 远程/根提交计算稳定 `Project.ID`
3. **Session 门面**：`list()` 支持按 `project_id`/`directory` 过滤，`create()` 绑定 `project_id`
4. **消息历史**：`WHERE session_id = ?` 保证绝不跨会话读取
5. **Location 守卫**：Runner 每次执行前检查 `session.location.directory === currentLocation.directory`

**不需要** DI 作用域（LocationServiceMap）也能工作——代价是一个全局的 Runner 需要自己根据 `session.location.directory` 切换工作目录。但如果要完全一致，DI 作用域是最优雅的方案。
