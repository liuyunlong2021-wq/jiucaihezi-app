# OpenCode 登录与持久化方案 — 完整设计文档

> 目标：另一份 AI 读完后，能完整复刻 OpenCode 的认证、凭据存储和持久化体系。
> 涉及三层：**Server 认证**（客户端↔服务端）、**Provider 凭据**（LLM API Key/OAuth）、**持久化基础设施**。

---

## 目录

1. [体系总览](#1-体系总览)
2. [持久化基础设施（Persist）](#2-持久化基础设施persist)
3. [桌面端安全存储](#3-桌面端安全存储)
4. [Web 端启动流程与 auth_token](#4-web-端启动流程与-auth_token)
5. [服务端连接管理](#5-服务端连接管理)
6. [Server HTTP Basic Auth](#6-server-http-basic-auth)
7. [Provider 凭据体系（SQLite）](#7-provider-凭据体系sqlite)
8. [OpenCode Auth 文件存储](#8-opencode-auth-文件存储)
9. [Integration / OAuth 生命周期](#9-integration--oauth-生命周期)
10. [Provider OAuth 全流程](#10-provider-oauth-全流程)
11. [OpenCode Console 账号认证](#11-opencode-console-账号认证)
12. [数据流与架构图](#12-数据流与架构图)
13. [全部文件清单](#13-全部文件清单)
14. [完整复刻步骤](#14-完整复刻步骤)

---

## 1. 体系总览

OpenCode 的认证与持久化分为**三层**：

```
┌──────────────────────────────────────────────────────────────────────┐
│  ① 持久化基础设施 (Persist)                                           │
│  封装 localStorage / electron-store，提供全局/工作区/会话 三级作用域   │
│  → packages/app/src/utils/persist.ts                                  │
├──────────────────────────────────────────────────────────────────────┤
│  ② Server 认证                                                        │
│  HTTP Basic Auth（username:password），存于 Persist 或 electron-store  │
│  → packages/app/src/context/server.tsx                                │
│  → packages/server/src/middleware/authorization.ts                    │
├──────────────────────────────────────────────────────────────────────┤
│  ③ Provider 凭据                                                      │
│  API Key / OAuth Token → 存于服务端 SQLite + auth.json               │
│  → packages/core/src/credential.ts                                    │
│  → packages/opencode/src/auth/index.ts                                │
│  → packages/core/src/integration.ts                                   │
└──────────────────────────────────────────────────────────────────────┘
```

### 一句话总结

| 存什么 | 存哪里 | 怎么存 | 谁在用 |
|--------|--------|--------|--------|
| Server URL + 账号密码 | `localStorage` / `electron-store` | `Persist.global` JSON | Web 页、桌面端 |
| LLM Provider API Key | 服务端 SQLite (`credential` 表) | `Credential.Service` CRUD | LLM 调用时 |
| OAuth Token (access+refresh) | 服务端 SQLite + `auth.json` | `Integration.connection.resolve` | Provider OAuth 流程 |
| OpenCode Console Token | `auth.json` (0600 权限) | Device OAuth Flow | Console 账号登录 |
| 用户偏好 / 会话历史 | `localStorage` / `electron-store` | `Persist.*` 命名空间 | 各 UI 组件 |
| 启动时临时的 auth_token | URL query string | Base64 一次性 | Web 登录跳转 |

---

## 2. 持久化基础设施（Persist）

**文件**: `packages/app/src/utils/persist.ts`

### 存储后端选择

```
Web 端 (localStorage)
  └── key 前缀化 "opencode.<storageName>:<key>"
  └── 回退: 内存 Map（上限 500 条 / 8MB）

桌面端 (electron-store)
  └── 通过 Platform.storage() → IPC → electron-store JSON 文件
  └── 文件路径: electron.app.getPath("userData") / opencode.settings.dat
```

### Persist 命名空间

```typescript
export const Persist = {
  global(name, legacy?)           → "opencode.global.dat"
  window(name, legacy?)           → "opencode.window.<windowID>.dat"
  draft(draftID, name, legacy?)   → "opencode.draft.<hash>.dat"
  serverGlobal(scope, name, legacy?) → 本地=global, 远程=scope-keyed global
  workspace(dir, name, legacy?)     → "opencode.workspace.<hash>.dat"
  serverWorkspace(scope, dir, ...)   → scope-keyed workspace
  session(dir, session, ...)       → session-scoped
  serverSession(scope, dir, ...)   → scope+session-keyed
}
```

### 使用方式

```typescript
import { Persist, persisted } from "@/utils/persist"

// 持久化一个 store 到 localStorage
const [store, setStore] = persisted(
  Persist.global("server", ["server.v3"]),
  createStore({ list: [], projects: {} }),
)
```

`persisted()` 返回 `[Store, SetStoreFunction, InitType, Ready]`，其中 `Ready` 是一个信号，表示持久化数据已从存储加载完毕。

### 数据迁移

```typescript
type PersistTarget = {
  key: string
  storage?: string
  legacy?: string[]                 // 旧版 key 别名，用于向后兼容
  legacyStorageNames?: string[]     // 旧版存储名
  migrate?: (value: unknown) => unknown  // 数据迁移函数
}
```

---

## 3. 桌面端安全存储

### electron-store 实现

**文件**: `packages/desktop/src/main/store.ts`

```typescript
import Store from "electron-store"

const cache = new Map<string, Store>()

export function getStore(name = SETTINGS_STORE) {
  const next = new Store({
    name,                                    // 默认 "opencode.settings"
    cwd: electron.app.getPath("userData"),   // macOS: ~/Library/Application Support/opencode/
    fileExtension: "",                       // 无扩展名
    // ...
  })
  cache.set(name, next)
  return next
}
```

**Store key 定义** (`packages/desktop/src/main/store-keys.ts`):

```typescript
export const SETTINGS_STORE = "opencode.settings"
export const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
export const WSL_SERVERS_KEY = "wslServers"
export const PINCH_ZOOM_ENABLED_KEY = "pinchZoomEnabled"
export const WINDOW_IDS_KEY = "windowIds"
```

### Renderer 通过 IPC 桥接

**文件**: `packages/desktop/src/renderer/index.tsx`

```typescript
const storage = (name = "default.dat") => {
  const api: AsyncStorage = {
    getItem: (key) => window.api.storeGet(name, key),    // IPC → main process
    setItem: (key, value) => window.api.storeSet(name, key, value),
    removeItem: (key) => window.api.storeDelete(name, key),
  }
  return api
}
```

### Server URL 持久化 (桌面端)

```typescript
// Renderer 端
getDefaultServer: async () => {
  const url = await window.api.getDefaultServerUrl()   // IPC
  if (!url) return null
  return ServerConnection.Key.make(url)
},
setDefaultServer: async (url) => {
  await window.api.setDefaultServerUrl(url)             // IPC
},

// Main 进程
export function getDefaultServerUrl(): string | null {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}
export function setDefaultServerUrl(url: string | null) {
  if (url) getStore().set(DEFAULT_SERVER_URL_KEY, url)
  else getStore().delete(DEFAULT_SERVER_URL_KEY)
}
```

### 安全说明

当前实现使用 `electron-store` 的**默认 JSON 文件存储**，**没有使用操作系统原生安全存储**（macOS Keychain、Windows Credential Manager、Linux Secret Service）。Server 账号密码和 API keys 以明文存储在 JSON 文件中。

---

## 4. Web 端启动流程与 auth_token

**文件**: `packages/app/src/entry.tsx`

### 启动流程

```
1. 读取 localStorage → "opencode.settings.dat:defaultServerUrl"
2. 从 URL query string 提取 auth_token (?auth_token=xxx)
3. authFromToken() 解码 (Base64) → username + password
4. 构建 ServerConnection.Http 对象
5. 渲染 <AppInterface>，传入 servers 列表
6. 从 URL 清除 auth_token (clearAuthToken)
```

```typescript
const auth = authFromToken(new URLSearchParams(location.search).get("auth_token"))
clearAuthToken()

const server: ServerConnection.Http = {
  type: "http",
  authToken: !!auth,
  http: { url: getCurrentUrl(), ...auth },
}

render(() => (
  <PlatformProvider value={platform}>
    <AppBaseProviders>
      <AppInterface
        defaultServer={ServerConnection.Key.make(getDefaultUrl())}
        canonicalLocalServer={ServerConnection.key(server)}
        servers={[server]}
        disableHealthCheck
      />
    </AppBaseProviders>
  </PlatformProvider>
), root)
```

### auth_token 解码

**文件**: `packages/app/src/utils/server.ts`

```typescript
export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}
// auth_token = base64("opencode:mysecret")
```

### startup auth_token 覆盖规则

在 `resolveServerList()` 中，如果 startup 的 auth_token 与持久化 URL 相同，会被合并覆盖：

```typescript
// 持久化: { url: "https://server.example.test" }
// startup: { url: "https://server.example.test", username: "opencode", password: "secret" }
// 结果: { url: "...", username: "opencode", password: "secret" }
```

---

## 5. 服务端连接管理

**文件**: `packages/app/src/context/server.tsx`

### ServerConnection 类型

```typescript
export namespace ServerConnection {
  type HttpBase = { url: string; username?: string; password?: string }

  type Http = {                    // 远程 HTTP 服务器
    type: "http"
    http: HttpBase
    authToken?: boolean            // true = 通过 auth_token 启动
  }
  type Sidecar = {                 // 本地内嵌服务器 (桌面端)
    type: "sidecar"
    http: HttpBase
  } & ({ variant: "base" } | { variant: "wsl"; distro: string })
  type Ssh = {                     // SSH 远程服务器 (仅桌面端)
    type: "ssh"
    host: string
    http: HttpBase
  }
}
```

### 持久化存储结构

```typescript
// 存储于 localStorage key = "opencode.global.dat:server"
const [store, setStore] = persisted(
  Persist.global("server", ["server.v3"]),
  createStore({
    list: StoredServer[],              // [{url, username?, password?}]
    projects: Record<string, Project[]>,
    lastProject: Record<string, string>,
    recentlyClosed: Record<string, string[]>,
  }),
)
```

**关键**: Server 的 `username` 和 `password` 以**明文**存储在 `localStorage` 或 `electron-store` 中。

### resolveServerList — 启动源 + 持久化源合并

```typescript
export function resolveServerList(input: {
  props?: Array<ServerConnection.Any>   // entry.tsx 启动参数
  stored: StoredServer[]                 // 持久化数据
}): Array<ServerConnection.Any> {
  // 用 Map<url, conn> 去重，startup 数据优先覆盖
}
```

### 服务器切换

`ServerProvider` 提供 `setActive(key)` 在不同服务器间切换，`Scope` 由 `ServerScope.fromServerKey()` 决定。

---

## 6. Server HTTP Basic Auth

### 客户端发送

**文件**: `packages/opencode/src/server/auth.ts`

```typescript
export function header(credentials?: Credentials) {
  const password = credentials?.password ?? Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return undefined
  const username = credentials?.username ?? Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}
```

### 服务端验证

**文件**: `packages/server/src/middleware/authorization.ts`

```typescript
// 认证来源（优先级）:
// 1. URL query 参数: ?auth_token=<base64>
// 2. HTTP Header: Authorization: Basic <base64>

// 如果未设置密码 (required=false) → 透传所有请求
// 如果设置了密码 → 验证 credentials 是否匹配
// WebSocket PTY 连接通过 ticket 绕过
```

**文件**: `packages/server/src/auth.ts`

```typescript
export type Info = {
  readonly password: Option.Option<string>
  readonly username: string
}

export class Config extends Context.Service<Config, Info>() {
  // 从环境变量读取:
  //   OPENCODE_SERVER_PASSWORD → Option<string>
  //   OPENCODE_SERVER_USERNAME → 默认 "opencode"
}
```

### 路由层集成

```typescript
const auth = password
  ? ServerAuth.Config.configLayer({ username: "opencode", password: Option.some(password) })
  : ServerAuth.Config.layer

function makeRoutes(auth) {
  return HttpRouter.empty.pipe(
    Layer.provide(authorizationLayer),
    Layer.provide(auth),
    // ...
  )
}
```

---

## 7. Provider 凭据体系（SQLite）

### Credential Service

**文件**: `packages/core/src/credential.ts`

```typescript
export interface Interface {
  readonly all: () => Effect.Effect<Info[]>                  // 全部凭证
  readonly list: (integrationID: Integration.ID) => Effect.Effect<Info[]>  // 某个 integration 的
  readonly get: (id: ID) => Effect.Effect<Info | undefined>  // 按 ID
  readonly create: (input: {
    integrationID: Integration.ID
    value: Value
    label?: string
  }) => Effect.Effect<Info>
  readonly update: (id: ID, updates: Partial<Pick<Info, "label" | "value">>) => Effect.Effect<void>
  readonly remove: (id: ID) => Effect.Effect<void>
}
```

### 凭据值类型

```typescript
// Credential.Value 联合体:
type Value =
  | { type: "key";   key: string }                    // API Key
  | { type: "oauth"; access: string; refresh: string; expires: number;
      accountId?: string; enterpriseUrl?: string }    // OAuth Token
```

### SQLite 表

**文件**: `packages/core/src/credential/sql.ts`

```typescript
const CredentialTable = sqliteTable("credential", {
  id:             text().$type<Credential.ID>().primaryKey(),
  integration_id: text().$type<Integration.ID>(),
  label:          text().notNull(),
  value:          text({ mode: "json" }).$type<Credential.Value>().notNull(),  // JSON 存储
  connector_id:   text(),
  method_id:      text(),
  active:         integer({ mode: "boolean" }),
  ...Timestamps,
})
```

### create 实现（先删旧凭证再插入）

```typescript
create: Effect.fn("Credential.create")(function* (input) {
  // 先删除同 integration 的所有旧凭证
  yield* db.delete(CredentialTable).where(
    eq(CredentialTable.integration_id, input.integrationID)
  ).run()
  // 再插入新凭证
  yield* db.insert(CredentialTable).values({
    id: ID.make(crypto.randomUUID()),
    integration_id: input.integrationID,
    label: input.label ?? "",
    value: input.value,
  }).run()
  // 返回新凭证
})
```

---

## 8. OpenCode Auth 文件存储

**文件**: `packages/opencode/src/auth/index.ts`

### 存储路径

```typescript
const file = path.join(Global.Path.data, "auth.json")
// 文件权限 0o600（仅所有者可读写）
yield* fsys.writeJson(file, data, 0o600)
```

### 支持的凭证类型

```typescript
// OAuth Token（如 ChatGPT / OpenCode Console）
class Oauth extends Schema.Class("OAuth")({
  type: "oauth",
  refresh: string,
  access: string,
  expires: number,
  accountId?: string,
  enterpriseUrl?: string,
})

// API Key
class Api extends Schema.Class("ApiAuth")({
  type: "api",
  key: string,
  metadata?: Record<string, string>,
})

// Well-known（特殊）
class WellKnown extends Schema.Class("WellKnownAuth")({
  type: "wellknown",
  key: string,
  token: string,
})
```

### Service 接口

```typescript
interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}
```

### 环境变量注入

```typescript
// 通过 OPENCODE_AUTH_CONTENT 环境变量注入预配置凭据（CI/CD）
const all = Effect.fn("Auth.all")(function* () {
  if (process.env.OPENCODE_AUTH_CONTENT) {
    return JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
  }
  // 否则从 auth.json 读取
  const data = yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))
  return Record.filterMap(data, ...)
})
```

---

## 9. Integration / OAuth 生命周期

**文件**: `packages/core/src/integration.ts`

### 连接解析优先级

```
connection.resolve(connection) → Credential.Value | undefined

1. 如果 connection.type === "env":
   → 从环境变量读取
2. 否则从 SQLite credential 表读取:
   a. 查找凭证
   b. 如果是 API Key → 直接返回
   c. 如果是 OAuth Token:
      - 检查 expires > now + 5min → 直接返回
      - 否则 → 自动 refresh → 更新凭证 → 返回新 token
```

### 自动刷新逻辑

```typescript
resolve: Effect.fn("Integration.connection.resolve")(function* (connection) {
  if (connection.type === "env") {
    return process.env[connection.name]
      ? { type: "key", key: process.env[connection.name] }
      : undefined
  }
  const credential = yield* credentials.get(connection.id)
  if (!credential) return undefined

  if (credential.value.type === "key") return credential.value

  // OAuth: 检查是否需要 refresh
  const implementation = findImplementation(credential)
  if (!implementation?.refresh) return credential.value

  // 5 分钟内过期 → 自动刷新
  if (credential.value.expires > Date.now() + 5 * 60 * 1000) return credential.value

  const value = yield* authorize(implementation.refresh(credential.value))
  yield* credentials.update(credential.id, { value })
  return value
})
```

### OAuth Attempt 生命周期

```
1. connection.oauth()
   → 创建 PendingAttempt
   → 返回 Attempt { attemptID, url, instructions, mode }

2. attempt.status()
   → 查询当前状态: pending | complete | failed | expired

3. attempt.complete()
   → 完成授权，存储凭证到 SQLite

4. attempt.cancel()
   → 取消并释放资源

5. 自动清理
   → 每 30s 清理过期 attempt（10 分钟过期）
```

### 连接解析优先级

```typescript
const resolveConnections = (entry, saved) => {
  // 优先级:
  // 1. 已保存的凭证 (SQLite) — 按创建时间倒序
  const credentials = saved.map(c => ({ type: "credential", id: c.id, label: c.label })).toReversed()
  // 2. 环境变量
  const env = entry.methods.filter(m => m.type === "env")
    .flatMap(m => m.names.filter(name => process.env[name]))
    .map(name => ({ type: "env", name }))
  return [...credentials, ...env]
}
```

---

## 10. Provider OAuth 全流程

### 前端 UI

**文件**: `packages/app/src/components/dialog-connect-provider.tsx`

```
用户点击"连接 Provider"
  → 读取 provider_auth (ProviderAuthResponse) → 获取可用认证方式
  → 用户选择方法:

  [API Key]:
    输入 key → client.auth.set({ providerID, auth: { type: "api", key } })
    → 存到 auth.json

  [OAuth (auto)]:
    client.provider.oauth.authorize()
    → 服务端开启 loopback HTTP server
    → 打开浏览器 → 用户授权
    → callback → loopback server 接收
    → 服务端完成 token exchange
    → 存到 auth.json + credential 表

  [OAuth (code)]:
    同上但给用户授权码
    用户手动粘贴 code
    client.provider.oauth.callback({ providerID, method, code })
    → 服务端完成 token exchange
```

### OAuth Callback 页面

**文件**: `packages/core/src/oauth/page.ts`

三种内嵌 HTML：

```typescript
// 授权成功页（含自动关闭脚本）
success() → 绿色 ✓ + "Authorization complete!" + setTimeout(window.close, 500)

// 授权失败页
error(detail) → 红色 ✗ + 错误信息

// 隐式授权中间页
bootstrap({ tokenPath }) → 读取 URL fragment → POST 到 loopback server
```

### OpenAI (ChatGPT) OAuth 实现

**文件**: `packages/core/src/plugin/provider/openai.ts`

两种模式：

```typescript
// 1. Browser (ChatGPT Pro/Plus):
//    生成 PKCE challenge
//    开启本地 loopback HTTP server (localhost:1455)
//    重定向到 OpenAI auth 页面
//    callback 接收 authorization code → exchange for tokens
//    返回 Credential.OAuth

// 2. Headless (Device Code / RFC 8628):
//    调用 device auth API 获取 device_code + user_code
//    轮询 token endpoint 直到授权完成
```

---

## 11. OpenCode Console 账号认证

**文件**: `packages/core/src/plugin/provider/opencode.ts`

### Device OAuth Flow

```typescript
const methodID = "device"

// endpoints:
//   code:   https://console.opencode.ai/auth/device/code
//   token:  https://console.opencode.ai/auth/device/token
//   refresh: https://console.opencode.ai/auth/device/token (grant_type=refresh_token)
```

### 登录后的行为

```typescript
const load = Effect.fn("OpencodePlugin.load")(function* () {
  // 1. 检查是否有 opencode integration 的活跃连接
  const connection = yield* ctx.integration.connection.active("opencode")
  const credential = connection
    ? yield* ctx.integration.connection.resolve(connection)
    : undefined
  const connected = connection !== undefined

  // 2. 如果有凭证 → 用 access_token 调用 /api/config 获取远程配置
  providers = credential
    ? yield* fetchProviders(http, credential)
    : undefined

  // 3. 远程配置动态注入到 catalog（providers + models）
  // 4. 监听 ConnectionUpdated 事件自动刷新
})
```

---

## 12. 数据流与架构图

### 认证数据流

```
┌──────────────┐    ┌─────────────────┐    ┌──────────────────┐
│  用户操作     │    │  App UI          │    │  Server/Backend  │
├──────────────┤    ├─────────────────┤    ├──────────────────┤
│              │    │                  │    │                  │
│ 登录 Server  │───▶│ 输入 URL+密码    │───▶│ 验证 Basic Auth  │
│              │    │ → Persist.global │    │ (环境变量密码)   │
│              │    │   存到 localStorage│   │                  │
├──────────────┤    ├─────────────────┤    ├──────────────────┤
│              │    │                  │    │                  │
│ 连接 Provider│───▶│ DialogConnect    │───▶│ OAuth flow       │
│ (API Key)    │    │ → 输入 key       │    │ → 存 auth.json   │
│              │    │ → client.auth.set│    │ → 存 credential 表│
├──────────────┤    ├─────────────────┤    ├──────────────────┤
│              │    │                  │    │                  │
│ Console 登录 │───▶│ Device Code 流程  │───▶│ token exchange   │
│              │    │ 显示 code        │    │ → 存 auth.json   │
│              │    │ 轮询等待         │    │ → 注入 catalog   │
└──────────────┘    └─────────────────┘    └──────────────────┘
```

### 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│  客户端 (packages/app)                                              │
│                                                                     │
│  entry.tsx                                                          │
│  ├─ 读取 localStorage defaultServerUrl                              │
│  ├─ 解析 URL auth_token                                             │
│  └─ 构建 ServerConnection[]                                          │
│                                                                     │
│  context/server.tsx — ServerProvider                                 │
│  ├─ persisted(Persist.global("server")) → 持久化 Server 列表        │
│  ├─ active / setActive / resolveServerList                          │
│  └─ 每个请求附带 HTTP Basic Auth header                             │
│                                                                     │
│  utils/persist.ts — 持久化基础设施                                    │
│  ├─ Persist.global / workspace / session / server*                   │
│  ├─ 存储后端: localStorage / electron-store / 内存回退               │
│  └─ 数据迁移: legacy keys + migrate()                               │
│                                                                     │
│  components/dialog-connect-provider.tsx — Provider 连接 UI           │
│  ├─ API Key 输入                                                    │
│  └─ OAuth 流程（auto / code）                                       │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ HTTP Basic Auth
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  服务端 (packages/server + packages/opencode)                       │
│                                                                     │
│  middleware/authorization.ts                                        │
│  ├─ 验证 auth_token (query) 或 Basic Auth (header)                  │
│  └─ WebSocket PTY 通过 ticket 绕过                                  │
│                                                                     │
│  core/credential.ts — SQLite 凭证存储                                │
│  ├─ credential 表: { id, integration_id, value(JSON) }              │
│  ├─ CRUD: create/list/get/update/remove                             │
│  └─ 先删旧凭证再插入                                                │
│                                                                     │
│  opencode/src/auth/index.ts — auth.json 文件存储                     │
│  ├─ 路径: {dataDir}/auth.json (权限 0600)                           │
│  ├─ 支持: OAuth / API Key / WellKnown                               │
│  ├─ 环境变量注入: OPENCODE_AUTH_CONTENT                              │
│  └─ Service: get / all / set / remove                               │
│                                                                     │
│  core/integration.ts — OAuth 生命周期                                │
│  ├─ connection.resolve → 自动 refresh token                         │
│  ├─ OAuth Attempt: create → callback → complete                     │
│  └─ 30s 自动清理过期 attempt                                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 13. 全部文件清单

### 持久化基础设施

| 文件 | 用途 |
|------|------|
| `packages/app/src/utils/persist.ts` | Persist 命名空间 + persisted() 封装 |
| `packages/desktop/src/main/store.ts` | electron-store 封装 |
| `packages/desktop/src/main/store-keys.ts` | Store key 常量 |
| `packages/desktop/src/renderer/index.tsx` | 桌面端 Platform.storage() 桥接 |

### Server 连接管理

| 文件 | 用途 |
|------|------|
| `packages/app/src/context/server.tsx` | ServerProvider + ServerConnection + 持久化 |
| `packages/app/src/entry.tsx` | Web 端启动 + auth_token 处理 |
| `packages/app/src/utils/server.ts` | authFromToken 解码 |
| `packages/opencode/src/server/auth.ts` | 客户端 Basic Auth header 生成 |

### 服务端认证

| 文件 | 用途 |
|------|------|
| `packages/server/src/auth.ts` | Server Auth Config（环境变量） |
| `packages/server/src/middleware/authorization.ts` | HTTP 请求拦截中间件 |
| `packages/opencode/src/auth/index.ts` | auth.json 文件存储 + Service |

### Provider 凭据

| 文件 | 用途 |
|------|------|
| `packages/core/src/credential.ts` | Credential Service（SQLite CRUD） |
| `packages/core/src/credential/sql.ts` | credential 表定义 |
| `packages/core/src/integration.ts` | Integration Service + OAuth 生命周期 |
| `packages/core/src/integration/connection.ts` | 连接解析 + resolve |
| `packages/core/src/session/runner/model.ts` | 凭据 → LLM API Key 映射 |

### Provider OAuth 实现

| 文件 | 用途 |
|------|------|
| `packages/core/src/plugin/provider/openai.ts` | ChatGPT OAuth（PKCE + Device Code） |
| `packages/core/src/plugin/provider/opencode.ts` | OpenCode Console Device OAuth |
| `packages/core/src/oauth/page.ts` | OAuth Callback 页面 HTML |
| `packages/app/src/components/dialog-connect-provider.tsx` | Provider 连接 UI |

---

## 14. 完整复刻步骤

### 第一步：持久化基础设施

```
文件清单：
  utils/persist.ts           — Persist 命名空间 + persisted() + localStorage 封装
  utils/persist-types.ts     — PersistTarget, PersistedWithReady 类型
```

核心实现：

```typescript
// 核心接口
function persisted<T>(
  target: PersistTarget,
  store: Store<T>,
): [Store<T>, SetStoreFunction<T>, Promise<string>, Accessor<boolean>]

// 命名空间
const Persist = {
  global: (key, legacy?) => ({ storage: "opencode.global.dat", key, legacy }),
  workspace: (dir, key, legacy?) => ({ storage: `opencode.workspace.${hash(dir)}.dat`, key }),
  session: (dir, session, key, legacy?) => ({ storage: `opencode.session.${hash(dir)}.${session}.dat`, key }),
}
```

### 第二步：Server 连接管理

```
文件清单：
  context/server.tsx         — ServerProvider + ServerConnection 类型
  context/server-types.ts    — ServerConnection.Any / Http / Sidecar / Ssh
  utils/server.ts            — authFromToken, normalizeServerUrl
```

关键存储：

```typescript
// 持久化 Server 列表
const [serverStore] = persisted(
  Persist.global("server", ["server.v3"]),
  createStore<{
    list: Array<{ url: string; username?: string; password?: string }>
    projects: Record<string, Project[]>
    lastProject: Record<string, string>
  }>(),
)
```

### 第三步：服务端 HTTP Basic Auth

```
文件清单：
  server/src/auth.ts                — Config（环境变量读取）
  server/src/middleware/authorization.ts — 请求拦截
  opencode/src/server/auth.ts        — 客户端 header 生成
```

### 第四步：Provider 凭据 SQLite 存储

```
文件清单：
  core/credential.ts          — Credential Service CRUD
  core/credential/sql.ts      — credential 表（Drizzle）
```

表结构：

```typescript
const credentialTable = sqliteTable("credential", {
  id:             text().primaryKey(),
  integration_id: text(),
  label:          text().notNull(),
  value:          text({ mode: "json" }).notNull(),  // { type: "key" | "oauth", ... }
  active:         integer({ mode: "boolean" }),
  time_created:   integer().notNull(),
  time_updated:   integer().notNull(),
})
```

### 第五步：auth.json 文件存储

```
文件清单：
  opencode/src/auth/index.ts   — Auth Service（JSON 文件 + 0600 权限）
```

```typescript
const file = path.join(dataDir, "auth.json")

// 文件格式
{
  "openai":     { "type": "oauth", "access": "...", "refresh": "...", "expires": 123 },
  "anthropic":  { "type": "api", "key": "sk-ant-..." },
  "opencode":   { "type": "oauth", "access": "...", "refresh": "...", "expires": 456 }
}
```

### 第六步：Integration / OAuth 生命周期

```
文件清单：
  core/integration.ts              — Integration Service
  core/integration/connection.ts   — 连接解析 + resolve
  core/oauth/page.ts               — OAuth Callback HTML
```

### 第七步：Provider OAuth UI

```
文件清单：
  app/src/components/dialog-connect-provider.tsx — 连接对话框
  app/src/components/settings-providers.tsx      — Provider 设置页
```

### 第八步：桌面端安全存储

```
文件清单：
  desktop/src/main/store.ts        — electron-store 封装
  desktop/src/main/store-keys.ts   — Key 常量
  desktop/src/renderer/index.tsx    — IPC 桥接
```

---

## 附录：本地源码路径对照

| 文件 | 本地路径 |
|------|----------|
| Persist 持久化 | `packages/app/src/utils/persist.ts` |
| Server 连接管理 | `packages/app/src/context/server.tsx` |
| Web 启动入口 | `packages/app/src/entry.tsx` |
| auth_token 解码 | `packages/app/src/utils/server.ts` |
| 桌面端 electron-store | `packages/desktop/src/main/store.ts` |
| Store key 常量 | `packages/desktop/src/main/store-keys.ts` |
| 桌面端 IPC 桥接 | `packages/desktop/src/renderer/index.tsx` |
| 服务端 Auth Config | `packages/server/src/auth.ts` |
| 服务端 Auth 中间件 | `packages/server/src/middleware/authorization.ts` |
| 客户端 Auth header | `packages/opencode/src/server/auth.ts` |
| Auth 文件存储 | `packages/opencode/src/auth/index.ts` |
| Credential Service | `packages/core/src/credential.ts` |
| Credential SQL | `packages/core/src/credential/sql.ts` |
| Integration Service | `packages/core/src/integration.ts` |
| Integration Connection | `packages/core/src/integration/connection.ts` |
| OAuth Callback 页面 | `packages/core/src/oauth/page.ts` |
| OpenAI OAuth | `packages/core/src/plugin/provider/openai.ts` |
| OpenCode Console OAuth | `packages/core/src/plugin/provider/opencode.ts` |
| Provider 连接 UI | `packages/app/src/components/dialog-connect-provider.tsx` |
| 模型凭据解析 | `packages/core/src/session/runner/model.ts` |
