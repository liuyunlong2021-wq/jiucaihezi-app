/Users/by3/Documents/jiucaihezi-opencode
以下是完整链路的深度源码分析：

---

## 1. 启动时加载会话列表

### 前端入口

**关键文件：** home.tsx (L104–L330)

HomePage 通过 `@tanstack/solid-query` 的 `useQuery` 触发加载：

```ts
// L304-308 —— queryKey 含 server + projectDirectories，切换时自动 refetch
const sessionLoad = useQuery(() => ({
  queryKey: ["home", "sessions", selection().server, ...projectDirectories()],
  queryFn: async () => {
    await Promise.all(
      projectDirectories().map((directory) =>
        focusedSync().project.loadSessions(directory, { limit: HOME_SESSION_LIMIT }),
      ),
    )
    return null
  },
}))
```

`HOME_SESSION_LIMIT = 64` (L93)。

### loadSessions — 核心调用

**关键文件：** server-sync.tsx (L251–L305)

```ts
async function loadSessions(directory: string, options?: { limit?: number }) {
  // ...
  const limit = Math.max(retainedLimit + SESSION_RECENT_LIMIT, SESSION_RECENT_LIMIT)
  const promise = queryClient
    .fetchQuery({
      ...queryOptionsApi.sessions(key),
      // 👇 实际调用
      queryFn: () => loadRootSessionsWithFallback({
        directory,
        limit,
        list: (query) => serverSDK.client.session.list(query),
      }),
    })
}
```

### loadRootSessionsWithFallback

**关键文件：** session-load.ts (L3–L20)

```ts
export async function loadRootSessionsWithFallback(input: RootLoadArgs) {
  try {
    const result = await input.list({ directory: input.directory, roots: true, limit: input.limit })
    return { data: result.data, limit: input.limit, limited: true }
  } catch {
    // fallback: 无 limit 重试（兼容旧 server）
    const result = await input.list({ directory: input.directory, roots: true })
    return { data: result.data, limit: input.limit, limited: false }
  }
}
```

### HTTP API

**关键文件：** session.ts (L67–L87)

```
GET /session?directory=xxx&roots=true&limit=64
```

路由解析出 `ListQuery`，传给 handler。

### 后端 Session.list

**关键文件：** session.ts (L545–L550)

```ts
const list = Effect.fn("Session.list")(function* (input?: ListInput) {
  const ctx = yield* InstanceState.context
  return yield* listByProject(db, {
    projectID: ctx.project.id,
    ...input,
  })
})
```

### SQL 查询

**关键文件：** session.ts (L957–L1010)

```ts
function listByProject(db, input) {
  const conditions = [eq(SessionTable.project_id, input.projectID)]  // ← 始终按 project 过滤

  if (input.directory) conditions.push(eq(SessionTable.directory, input.directory))
  if (input.workspaceID) conditions.push(eq(SessionTable.workspace_id, input.workspaceID))
  if (input.roots) conditions.push(isNull(SessionTable.parent_id))   // ← roots=true 只查根会话
  if (input.search) conditions.push(like(SessionTable.title, `%${input.search}%`))

  return db.select().from(SessionTable)
    .where(and(...conditions))
    .orderBy(desc(SessionTable.time_updated))  // ← 按最近更新降序
    .limit(input.limit ?? 100)
    .all()
    .pipe(Effect.map((rows) => rows.map(fromRow)))
}
```

**最终 SQL 大致为：**
```sql
SELECT * FROM session
WHERE project_id = ? AND directory = ? AND parent_id IS NULL
ORDER BY time_updated DESC
LIMIT 64
```

### 返回后组装列表

**关键文件：** home.tsx (L106–L130)

返回的 session 列表经过 `buildHomeSessionRecords` 去重、按 `time_updated` 排序、分组为 today / yesterday / older 三个区段展示。

---

## 2. 点击历史会话 → 加载消息

### URL 路由

当用户点击一个会话时，导航到类似 `/:serverKey/:sessionID` 的 URL。路由组件是 `TargetSessionRouteContent`。

**关键文件：** session.tsx (L200–L260)

```tsx
function ResolvedTargetSessionRoute() {
  const params = useParams<{ serverKey: string; id: string }>()
  const current = createSessionLineage(
    () => params.id,
    () => sync().session.lineage,
  )
  const directory = createMemo(() => current()?.session.directory)
  // ...
  return <TargetServerScopedProviders directory={directory} sessionID={() => params.id}>
    <SDKProvider directory={targetDirectory}>
      <TargetSessionPage />
    </SDKProvider>
  </TargetServerScopedProviders>
}
```

### createSessionLineage — 按需 resolve

**关键文件：** session-lineage.ts (L39–L86)

```ts
export function createSessionLineage<T>(sessionID, lineage) {
  createEffect(on([sessionID, lineage], ([id, store]) => {
    if (cached()) { setStatus({ id, store, state: "settled" }); return }
    setStatus({ id, store, state: "pending" })
    store.resolve(id).then(() => { /* settle */ })
  }))
}
```

resolve 最终调用 `serverSync.session.sync(id)`。

### session.sync — 加载 session 元数据 + 消息

**关键文件：** server-session.ts (L685–L694)

```ts
const sync = (sessionID: string, options?) => {
  return runInflight(inflight, sessionID, async () => {
    const cached = data.message[sessionID] !== undefined && meta.limit[sessionID] !== undefined
    if (cached && data.info[sessionID] && !options?.force) return
    await Promise.all([
      resolve(sessionID, options),                    // ← GET /session/:id
      cached && !options?.force
        ? Promise.resolve()
        : loadMessages(sessionID, options?.messageLimit ?? initialMessagePageSize),  // ← GET /session/:id/message
    ])
  })
}
```

- `initialMessagePageSize = 2` — 首次只加载 **最近 2 条消息**（L70）
- `resolve()` 调用 `client.session.get({ sessionID })` → `GET /session/:sessionID`
- `loadMessages()` 调用 `client.session.messages({ sessionID, limit, before })` → `GET /session/:sessionID/message`

### fetchMessages — HTTP API 调用

**关键文件：** server-session.ts (L495–L509)

```ts
const fetchMessages = async (sessionID: string, limit: number, before?: string) => {
  const response = await (options?.retry ?? retry)(() => {
    return client.session.messages({ sessionID, limit, before })
  })
  return {
    session: items.map((item) => cleanMessage(item.info)).sort((a, b) => cmp(a.id, b.id)),
    part: items.map((item) => ({
      id: item.info.id,
      part: item.parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id)),
    })),
    cursor: response.response.headers.get("x-next-cursor"),
    complete: !response.response.headers.get("x-next-cursor"),
  }
}
```

### 后端 message 分页

**关键文件：** session.ts (L120–L155)

```ts
const messages = Effect.fn("SessionHttpApi.messages")(function* (ctx) {
  yield* requireSession(ctx.params.sessionID)
  if (ctx.query.limit === undefined || ctx.query.limit === 0) {
    // 无 limit → 返回全部
    return yield* session.messages({ sessionID: ctx.params.sessionID })
  }
  const page = yield* MessageV2.page({
    sessionID: ctx.params.sessionID,
    limit: ctx.query.limit,
    before: ctx.query.before,
  })
  // 通过 X-Next-Cursor / Link header 支持分页
})
```

### Timeline 渲染

**关键文件：** model.ts (L1–L90)

```ts
export function createTimelineModel(input) {
  const [resource] = createResource(
    () => input.sessionID(),
    (id) => sync().session.sync(id),  // ← 触发加载
  )
  const messages = createMemo(() => {
    const id = input.sessionID()
    return id ? (sync().data.message[id] ?? []) : []
  })
  const loadOlder = async () => {
    // 加载更早的消息 → client.session.messages({ sessionID, limit: 200, before: cursor })
    await sync().session.history.loadMore(sessionID)
  }
}
```

`historyMessagePageSize = 200` — 滚动加载更多时一次拉 200 条（L71）。

消息最终在 `MessageTimeline` 组件中渲染（message-timeline.tsx）。

---

## 3. 继续聊天

### 续写 vs 新会话的决定

**关键文件：** submit.ts (L55–L175)

当用户输入文字并发送时，调用 `sendFollowupDraft`：

```ts
export async function sendFollowupDraft(input: FollowupSendInput) {
  // ...
  await input.client.session.promptAsync({
    sessionID: input.draft.sessionID,  // ← 使用已有 sessionID！
    agent: input.draft.agent,
    model: input.draft.model,
    messageID,
    parts: requestParts,
  })
}
```

**关键点：** `sessionID` 直接沿用当前打开的会话 ID。OpenCode 不会判断"新/续"，而是**由调用方决定**：

- **新会话**：发 `POST /session` 创建新 sessionID，再对这个 sessionID 发 `promptAsync`
- **续写**：直接用已有 sessionID 发 `promptAsync`

### promptAsync 后端处理

**关键文件：** session.ts (L266–L281)

```ts
const promptAsync = Effect.fn("SessionHttpApi.promptAsync")(function* (ctx) {
  yield* requireSession(ctx.params.sessionID)
  yield* promptSvc.prompt({ ...ctx.payload, sessionID: ctx.params.sessionID })
    .pipe(Effect.forkIn(scope, { startImmediately: true }))
  return HttpApiSchema.NoContent.make()  // ← 立即返回 204，不等待 LLM 完成
})
```

`promptSvc.prompt()` 将消息写入 `message` + `part` 表，然后触发 LLM 执行。**注意**：写入是在 `Prompt.Service` 中完成的，它调用 `session.touch()` 更新 `time_updated`。

### time_updated 的更新时机

**关键文件：** session.ts (L751–L753)

```ts
const touch = Effect.fn("Session.touch")(function* (sessionID: SessionID) {
  yield* patch(sessionID, { time: { updated: Date.now() } }).pipe(Effect.orDie)
})
```

`touch()` 被以下场景调用：

| 场景 | 调用方 |
|------|--------|
| 发新消息（prompt） | `Prompt.Service` → `session.touch()` |
| 切换 agent/model | `setAgentModel` → `patch` |
| 修改标题 | `setTitle` → `patch` |
| 修改 metadata | `setMetadata` → `patch` |
| 设置权限 | `setPermission` → `patch` |
| summary 更新 | `setSummary` → `patch` |

`patch()` 方法发布 `SessionV1.Event.Updated` 事件 → 通过 SSE 流推送到前端 → 前端 server-session.ts 的 `apply("session.updated")` 更新 store → HomePage 的列表自动反映最新 `time_updated`。

### 消息的实时追加

**关键文件：** server-session.ts (L720–L830)

SSE 事件流推送 `message.updated`、`message.part.updated` 等事件 → `apply()` 方法用 `Binary.search` 在有序消息数组中查找/插入：

```ts
case "message.updated": {
  const messages = data.message[info.sessionID]
  if (!messages) { setData("message", info.sessionID, [info]); return }
  const result = Binary.search(messages, info.id, (message) => message.id)
  if (result.found) setData("message", info.sessionID, result.index, reconcile(info))
  if (!result.found)  // ← 新消息追加到正确位置
    setData("message", info.sessionID, (value = []) => {
      const next = value.slice()
      next.splice(result.index, 0, info)
      return next
    })
}
```

---

## 4. 会话切换（跨 Project）

### 前端切换 Project

**关键文件：** home.tsx (L280–L330)

用户点击不同 project 时，`selectedProject()` 变化：

```ts
const selectedProject = createMemo(() => { /* ... */ })
const projectDirectories = createMemo(() => {
  const project = selectedProject()
  if (!project) return projects().flatMap(directories)  // 所有 project
  return directories(project)                            // 指定 project
})
```

`projectDirectories()` 变化 → `queryKey` 变化 → `useQuery` 自动 refetch → 每个 directory 调用 `loadSessions(directory)`。

### 后端按 directory 过滤

project A 和 project B 映射到不同的 `directory`（本地文件路径）。`listByProject` 的 SQL 条件是：

```ts
conditions.push(eq(SessionTable.project_id, input.projectID))
if (input.directory) conditions.push(eq(SessionTable.directory, input.directory))
```

同一个 project 可能有多个 subpath，`projectDirectories()` 返回该 project 的 `worktree` + 所有 `sandboxes`，每个都作为独立的 directory 查询。

### 侧边栏切换

**关键文件：** sidebar-workspace.tsx (L334, L467)

```ts
// L334 —— 展开 project 时加载
await serverSync().project.loadSessions(props.directory)

// L467 —— 侧边栏显示 project 中的会话
await serverSync().project.loadSessions(props.project.worktree)
```

### 后端 session.list API 的 routing

**关键文件：** session.ts (L55–L62)

```ts
const list = Effect.fn("SessionHttpApi.list")(function* (ctx) {
  const directory = ctx.query.directory ? yield* InstanceState.directory : undefined
  return yield* session.list({
    directory: ctx.query.scope === "project" ? undefined : directory,
    scope: ctx.query.scope,
    path: ctx.query.path,
    roots: ctx.query.roots,
    start: ctx.query.start,
    search: ctx.query.search,
    limit: ctx.query.limit,
  })
})
```

这里的 `directory` 来自 `x-opencode-directory` header 或 `directory` query param。`InstanceState.directory` 通过 middleware 注入，确认该 instance 确实是针对这个 directory 启动的。

---

### 完整数据流总结

```
┌─ 用户打开 app ──────────────────────────────────────────────┐
│                                                             │
│  HomePage.onMount                                            │
│    → selectedProject() → projectDirectories()               │
│    → useQuery(queryKey=["home","sessions",server,dirs])     │
│      → focusedSync().project.loadSessions(dir, {limit:64})  │
│        → queryClient.fetchQuery(queryFn)                    │
│          → loadRootSessionsWithFallback({directory,roots,limit})│
│            → client.session.list({directory,roots:true,limit})│
│              → GET /session?directory=xxx&roots=true&limit=64 │
│                → SessionHttpApi.list()                        │
│                  → Session.list({directory,roots:true})        │
│                    → listByProject(db, {projectID,directory})  │
│                      → SELECT * FROM session                  │
│                        WHERE project_id=? AND directory=?     │
│                        AND parent_id IS NULL                  │
│                        ORDER BY time_updated DESC             │
│                        LIMIT 64                               │
│                        → rows → fromRow() → Session.Info[]   │
│  ← Response → session.remember() + setStore("session", ...)  │
│  → buildHomeSessionRecords() → 分组渲染                       │
│                                                             │
├─ 用户点击会话 ────────────────────────────────────────────────┤
│                                                             │
│  navigate(`/${serverKey}/${sessionID}`)                      │
│  → SessionPage                                               │
│    → createSessionLineage(params.id, sync().session.lineage) │
│      → lineage().resolve(id)                                 │
│        → sync().session.sync(id)                             │
│          → resolve(id): GET /session/:sessionID              │
│          → loadMessages(id, 2):                              │
│            → client.session.messages({sessionID, limit:2})   │
│              → GET /session/:id/message?limit=2              │
│                → MessageV2.page({sessionID, limit:2})        │
│                  → SELECT * FROM session_message             │
│                    WHERE session_id=?                         │
│                    ORDER BY seq DESC LIMIT 2                  │
│                  → JOIN part → SessionV1.WithParts[]         │
│                  → X-Next-Cursor header                      │
│            → applyMessagePage() → setStore("message", ...)   │
│    → createTimelineModel() → messages() 响应式渲染            │
│    → 滚到顶部 → loadOlder(): loadMessages(id, 200, cursor)   │
│                                                             │
├─ 用户发消息（续写）─────────────────────────────────────────────┤
│                                                             │
│  sendFollowupDraft({sessionID: currentId, ...})              │
│    → client.session.promptAsync({sessionID, messageID, ...}) │
│      → POST /session/:sessionID/message (promptAsync)        │
│        → promptSvc.prompt({sessionID, ...})  ← 写入DB         │
│          → session.touch(sessionID)  → patch → time_updated  │
│          → events.publish(Updated)  → SSE 推送               │
│        → 返回 204 NoContent                                   │
│    → SSE 推送 message.updated + message.part.updated         │
│      → apply() → Binary.search → setStore() → 实时渲染        │
│                                                             │
├─ 用户切 project ─────────────────────────────────────────────┘
│                                                             │
│  selectedProject() 变化 → projectDirectories() 变化          │
│  → queryKey 变化 → useQuery 自动 refetch                     │
│  → 对新 directory 调用 loadSessions(directory, {limit:64})   │
│  → 同上流程，但 WHERE directory=? 不同                         │
└─────────────────────────────────────────────────────────────┘
```

