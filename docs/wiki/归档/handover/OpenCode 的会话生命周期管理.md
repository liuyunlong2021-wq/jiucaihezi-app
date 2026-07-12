Optimized tool selection我来系统地探索 OpenCode 的会话生命周期管理。先并行搜索关键文件。
/Users/by3/Documents/jiucaihezi-opencode

以下是 OpenCode 会话生命周期管理的完整分析：

---

## 1. SSE 连接管理

### 前端建立 SSE

**关键文件：** server-sdk.tsx (L1–L300)

核心入口是 `createServerSdkContextBase()` 函数。它使用 `createOpencodeClient`（SDK 封装）调用 `eventSdk.global.event()`：

```ts
// L105-108 创建 SDK 客户端
const eventSdk = createSdkForServer({
  signal: abort.signal,
  fetch: eventFetch,
  server: server.http,
})
```

```ts
// L150-175 —— 发起 SSE 请求
const events = await eventSdk.global.event({
  signal: attempt.signal,
  onSseError: (error) => { /* ... */ },
})
for await (const event of events.stream) {
  // 处理事件...
}
```

### 服务端 SSE 端点

**关键文件：** event.ts (L1–L85)

SSE 端点定义在 `EventApi` 的 `subscribe` handler 中，路由为 `/event`，挂载在 instance 级别。它创建一个 `Queue`，通过 `EventV2Bridge` 监听全局事件，过滤出属于当前 instance 的事件，十秒一次心跳：

```ts
// L31-41 —— 事件队列 + 订阅
const queue = yield* Queue.unbounded<EventV2.Payload>()
const unsubscribe = yield* events.listen((event) =>
  Effect.sync(() => Queue.offerUnsafe(queue, event)))
```

```ts
// L72-73 —— 10 秒心跳
const heartbeat = Stream.tick("10 seconds").pipe(
  Stream.map(() => ({ id: eventID(), type: "server.heartbeat", properties: {} })),
)
```

### 重连策略

**关键文件：** server-sdk.tsx (L106–L221)

重连逻辑是 **固定间隔 250ms + 指数退避风格的心跳超时**：

```ts
// L106
const RECONNECT_DELAY_MS = 250
const HEARTBEAT_TIMEOUT_MS = 15_000  // L117
```

- 断连后等待 **250ms** 固定间隔重试
- 每收到一个事件重置心跳计时器
- 如果 **15 秒无事件**，主动 abort 当前 SSE 连接，触发重连
- `visibilitychange` 事件也从心跳角度触发重连（如果页面从不可见恢复且距最后事件超过 15s）
- `pagehide`/`pageshow` 也管理连接的启停

```ts
// L213-220 —— 重连循环
while (!abort.signal.aborted && started && generation === active) {
  attempt = new AbortController()
  try {
    const events = await eventSdk.global.event({ /* ... */ })
    for await (const event of events.stream) { /* ... */ }
  } catch (error) {
    // 记录错误
  }
  // 重连前等待 250ms
  await wait(RECONNECT_DELAY_MS)
}
```

### 事件合并

**关键文件：** server-sdk.tsx (L54–L100)

同时有智能的**事件合并**机制（`coalesceServerEvents`），把 16ms 窗口内的同类型 delta 事件合并成一次，减少不必要的 re-render：

```ts
const FLUSH_FRAME_MS = 16  // L82
const coalecedKey = (event) => {
  if (event.payload.type === "message.part.updated") {
    return `message.part.updated:${directory}:${part.messageID}:${part.id}`
  }
}
```

---

## 2. 会话持久化

### SQLite 表结构

**关键文件：** sql.ts (L1–L173)

一共有 **6 张表**：

#### `session` 表 — 核心会话元数据

```ts
// L32-65
export const SessionTable = sqliteTable("session", {
  id: text().$type<SessionSchema.ID>().primaryKey(),    // "ses_xxx"
  project_id: text().$type<ProjectV2.ID>().notNull(),   // 绑定 project
  workspace_id: text().$type<WorkspaceV2.ID>(),          // 可选 workspace
  parent_id: text().$type<SessionSchema.ID>(),           // 父会话（fork 来源）
  slug: text().notNull(),
  directory: text().notNull(),                           // 项目目录路径
  path: text(),                                          // 子路径
  title: text().notNull(),                               // 会话标题
  version: text().notNull(),                             // OpenCode 版本
  cost: real().notNull().default(0),                     // token 费用
  tokens_input: integer().notNull().default(0),
  tokens_output: integer().notNull().default(0),
  tokens_reasoning: integer().notNull().default(0),
  tokens_cache_read: integer().notNull().default(0),
  tokens_cache_write: integer().notNull().default(0),
  revert: text({mode:"json"}).$type<Revert.State>(),     // 回滚状态
  agent: text(),                                          // agent ID
  model: text({mode:"json"}),                             // { id, providerID, variant }
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
  time_archived: integer(),
  // ... 还有 share_url, summary 字段等
})
```

索引：`session_project_idx`、`session_workspace_idx`、`session_parent_idx`

#### `message` 表 — 会话消息

```ts
// L70-77
export const MessageTable = sqliteTable("message", {
  id: text().$type<MessageID>().primaryKey(),             // "msg_xxx"
  session_id: text().$type<SessionSchema.ID>().notNull(),
  time_created: integer().notNull(),
  time_updated: integer().notNull(),
  data: text({mode:"json"}).notNull(),                    // 完整消息体 JSON
})
```

#### `part` 表 — 消息片段（text/file/tool_use 等）

```ts
// L82-92
export const PartTable = sqliteTable("part", {
  id: text().$type<PartID>().primaryKey(),                // "prt_xxx"
  message_id: text().$type<MessageID>().notNull(),
  session_id: text().$type<SessionSchema.ID>().notNull(),
  data: text({mode:"json"}).notNull(),
})
```

#### V2 额外表

- `session_message` — V2 会话消息（带 seq 排序）
- `session_input` — V2 待处理输入队列（带 delivery/admitted_seq/promoted_seq）
- `session_context_epoch` — 上下文快照
- `todo` — 待办事项

### SessionInfo 数据模型（V2）

**关键文件：** session.ts (L19–L56)

```ts
export const Info = Schema.Struct({
  id: ID,
  parentID: ID.pipe(optional),
  projectID: Project.ID,
  agent: Agent.ID.pipe(optional),
  model: Model.Ref.pipe(optional),
  cost: Schema.Finite,
  tokens: Schema.Struct({ input, output, reasoning, cache: { read, write } }),
  time: Schema.Struct({ created: DateTimeUtcFromMillis, updated, archived }),
  title: Schema.String,
  location: Location.Ref,           // { directory, workspaceID? }
  subpath: RelativePath.pipe(optional),
  revert: Revert.State.pipe(optional),
})
```

### 存储层

**关键文件：** store.ts (L1–L60)

`SessionStore.Service` 提供四个方法，通过 Drizzle ORM 操作 SQLite：

```ts
get: (sessionID) => db.select().from(SessionTable).where(eq(id, sessionID)).get()
context: (sessionID) => SessionHistory.load(db, sessionID)
runnerContext: (sessionID, baselineSeq) => SessionHistory.loadForRunner(db, sessionID, baselineSeq)
message: (messageID) => db.select().from(SessionMessageTable).where(eq(id, messageID)).get()
```

---

## 3. 启动时恢复

### 桌面端 Sidecar 进程管理

**关键文件：** index.ts (L250–L330)

桌面端使用 **Electron `utilityProcess.fork`** 启动侧边进程作为 server：

```ts
// packages/desktop/src/main/server.ts L66-70
const child = utilityProcess.fork(sidecar, [], {
  serviceName: "opencode server",
  stdio: "pipe",
})
```

#### 端口发现

**关键文件：** index.ts (L250–L300)

没有 pid file，而是用 **临时端口 + health check**：

```ts
// 先创建临时 TCP 服务器获取一个随机空闲端口
const server = createServer()
server.listen(0, "127.0.0.1", () => {
  const port = address.port
  server.close()
})
```

然后在 `spawnLocalServer` 中 fork sidecar 进程，传入 `hostname` 和 `port`，sidecar 启动后：

1. postMessage `{ type: "ready" }` 通知主进程
2. 主进程不断轮询 `/global/health` 直到返回 healthy

```ts
// packages/desktop/src/main/server.ts L108-116
const ready = async () => {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (await checkHealth(url, password)) { healthy = true; return }
  }
}
await Promise.race([ready(), gone])
```

#### 如何检测已有 OpenCode 进程

没有端口扫描或 pid file。每次启动**总是 fork 新进程**。但是：

- 如果已有进程占用了配置端口，`spawnLocalServer` 会失败
- 桌面端存储上次的 server URL 在 Electron Store 中（`DEFAULT_SERVER_URL_KEY`）
- 通过 IPC 传递 URL 给渲染进程

```ts
// packages/desktop/src/main/server.ts L44-48
export function getDefaultServerUrl(): string | null {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}
```

#### 前端初始化流程

**关键文件：** index.tsx (L340–L400)

```
1. window.api.awaitInitialization()  →  等待 sidecar 就绪，拿到 { url, username, password }
2. platform.getDefaultServer()       →  从 Electron Store 读最后一次 server URL
3. availableStartupServer()           →  合并 sidecar + WSL + 默认地址，决定用哪个
4. 组装 ServerConnection[] 列表，传给 AppInterface
5. AppInterface → ConnectionGate     →  循环 health check（最多 10 秒）
6. 健康检查通过后，渲染主界面
```

### 恢复 Session 列表

**关键文件：** session.ts (L192–L267)

后端 `SessionV2.list()` 方法从 SQLite 读取：

```ts
list: Effect.fn("V2Session.list")(function* (input = {}) {
  const conditions: SQL[] = []
  if ("directory" in input) conditions.push(eq(SessionTable.directory, input.directory))
  if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
  // 按 time_created 降序排列，支持游标分页
  const query = db.select().from(SessionTable).where(and(...conditions))
    .orderBy(desc(sortColumn), desc(SessionTable.id))
  const rows = yield* query.limit(input.limit).all()
  return rows.map(fromRow)
})
```

前端通过 `focusedSync().project.loadSessions(directory, { limit: 2048 })` 触发请求：

**关键文件：** home.tsx (L300–L320)

```ts
const sessionLoad = useQuery(() => ({
  queryKey: ["home", "sessions", selection().server, ...projectDirectories()],
  queryFn: async () => {
    await Promise.all(projectDirectories().map(directory =>
      focusedSync().project.loadSessions(directory, { limit: HOME_SESSION_LIMIT }),
    ))
  },
}))
```

---

## 4. 会话与 project 的绑定

### Server 进程与 Project 的关系

**关键文件：** instance-store.ts (L1–L200)

每个 **directory** 对应一个 **Instance**。`InstanceStore` 维护一个 `Map<string, Entry>` 缓存：

```ts
const cache = new Map<string, Entry>()
const directory = FSUtil.resolve(input.directory)
const existing = cache.get(directory)
if (existing) return yield* Deferred.await(existing.deferred)
// 否则创建新的 InstanceContext
```

一个 OpenCode server 进程可以管理**多个 project**，每个 project 有独立的 instance（但共享同一个 server 进程）。

### Project 过滤

**关键文件：** session.ts (L226–L253)

`list()` 方法支持三种过滤模式：

```ts
const ListInput = Schema.Union([
  ListDirectoryInput,   // 按 directory 过滤
  ListProjectInput,     // 按 project ID + 可选 subpath 过滤
  ListAllInput,         // 全量 + 可选 workspaceID
])
```

核心 SQL 条件：

```ts
if ("directory" in input) conditions.push(eq(SessionTable.directory, input.directory))
if ("project" in input) conditions.push(eq(SessionTable.project_id, input.project))
if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))
```

### 前端切换 Project

**关键文件：** home.tsx (L280–L400)

用户选择 project 时，`selectedProject()` 改变，导致 `projectDirectories()` 更新，从而 queryKey 变化触发重新 fetch：

```ts
const projectDirectories = createMemo(() => {
  const project = selectedProject()
  if (!project) return projects().flatMap(directories)  // 所有 project
  return directories(project)                            // 指定 project
})
```

### HTTP API 路由

**关键文件：** session.ts (L1–L150)

Session API 定义在 Instance 级别，每个请求通过 `WorkspaceRoutingMiddleware` 注入 `directory` 参数：

```
GET  /session                       → session.list (按 project/directory/workspace 过滤)
GET  /session/:sessionID            → session.get
GET  /session/:sessionID/message    → session.messages
POST /session                       → session.create
POST /session/:sessionID/message    → session.prompt
```

`x-opencode-directory` 请求头或 `directory` 查询参数用于定位 session 所属的 project：

```ts
// packages/sdk/js/src/v2/client.ts L28-57
const rewrite = (request, values) => {
  const name = "x-opencode-directory"
  const value = request.headers.get(name) ?? values.directory
  url.searchParams.set("directory", value)
}
```

---

### 总结架构图

```
┌─ Desktop Renderer ──────────────────────────────┐
│  entry.tsx → AppInterface → ConnectionGate      │
│    ↓ health check (10s timeout)                  │
│  ServerProvider → ServerSDKProvider              │
│    ↓ SSE (global.event) + 250ms auto-reconnect   │
│  HomePage → loadSessions(directory)              │
└──────────────────────┬──────────────────────────┘
                       │ HTTP (REST + SSE)
┌─ Desktop Main ───────┴──────────────────────────┐
│  index.ts (Electron)                             │
│    spawnLocalServer() → utilityProcess.fork      │
│    port: 随机空闲端口（net.createServer）           │
│    health: 100ms 轮询 /global/health              │
└──────────────────────┬──────────────────────────┘
                       │
┌─ Sidecar (server) ──┴───────────────────────────┐
│  server.ts → HttpServer.serve                    │
│    InstanceStore (Map<directory, Instance>)       │
│      SessionV2.Service                           │
│        SessionStore.Service                      │
│          Drizzle ORM → SQLite                    │
│            session, message, part, todo... 表     │
│        EventV2 (SSE 流)                          │
└─────────────────────────────────────────────────┘
```

