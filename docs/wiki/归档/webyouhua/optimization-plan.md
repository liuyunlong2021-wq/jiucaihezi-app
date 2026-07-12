# Web 端控制台问题修复方案

> **分支**：`webyouhua`（从 `desktop` 切出）
> **日期**：2026-06-19
> **基线**：`v1.0.1` / CLAUDE.md §12 启动架构
> **诊断来源**：`jiucaihezi.studio` 线上 Web 端 Console 日志
>
> **架构对齐**：CLAUDE.md 顶部"双端同等重要，平台专属能力必须显式隔离"——本次修复的核心目标就是补齐 Web 端缺失的平台隔离。

---

## 诊断摘要（5 条 Console 错误）

```
1. api.jiucaihezi.studio/v1/models         ERR_CONNECTION_CLOSED ×2
2. jc-media:file_xxx                       CSP 阻止（img-src 不含 jc-media:）
3. /api/creation/models                    CORS 双 Access-Control-Allow-Origin 头
4. TypeError: Cannot read properties of undefined (reading 'invoke')  ← 创作结果落地崩
5. [JC-boot] boot()/initDB() 超时          降级到 localStorage
```

---

## 🔴 P0-1：CORS 头重复

### 根因

服务端 `https://api.jiucaihezi.studio` 响应 `/api/creation/models` 时返回了 **两个相同的** `Access-Control-Allow-Origin: https://jiucaihezi.studio`。浏览器规范要求该头只能有单值，多值直接 block。

常见叠加来源（任选其一即可定位）：

- Nginx `add_header Access-Control-Allow-Origin` + 上游应用（NewAPI / Worker / FastAPI）也设置了一次
- Cloudflare Worker 中间件叠加一次，应用层又加一次
- `rh-adapter` 的 CORS 中间件 + 反代层重复加

### 修复方案

1. **先定位是哪一层叠加**：
   ```bash
   curl -I -H "Origin: https://jiucaihezi.studio" \
     https://api.jiucaihezi.studio/api/creation/models
   ```
   看响应头里 `Access-Control-Allow-Origin` 是否真的出现两次。

2. **统一到单一来源**：建议保留**最外层（Nginx 或 Cloudflare Worker）**的 CORS 头，应用层（NewAPI / rh-adapter）全部移除。Nginx 示例：
   ```nginx
   location /api/creation/ {
       proxy_hide_header Access-Control-Allow-Origin;
       add_header Access-Control-Allow-Origin $http_origin always;
       # ...其余 proxy 配置
   }
   ```

3. **白名单方案**：CORS 头不要写死 `*`，按请求 `Origin` 动态回填：
   - `https://jiucaihezi.studio`（生产 Web）
   - `https://www.jiucaihezi.studio`（如有）
   - `http://localhost:5173`（本地开发）
   - Tauri 桌面端 `tauri://localhost` / `http://tauri.localhost`

### 验收

- `curl -I` 响应只有一行 `Access-Control-Allow-Origin`
- Web 端 `/api/creation/models` 返回 200，不再走 `[Creation] model availability fallback to local catalog`
- 控制台不再有 CORS 多值 block 日志

---

## 🔴 P0-2：Web 端创作结果调 Tauri `invoke` 失败

### 根因

**违反 CLAUDE.md 平台隔离原则**：本地文件系统是桌面专属能力，Web 端必须有独立路径。

调用链：

```
mediaTaskStore.downloadAndPersistMediaAsset()
  → import('@tauri-apps/api/core')
  → invoke('http_download_base64', ...)     ← Web 端 window.__TAURI__ 不存在
  → TypeError: Cannot read properties of undefined (reading 'invoke')
```

影响文件：

| 文件 | 行号 | 问题 |
|------|------|------|
| `src/stores/mediaTaskStore.ts` | 335-340 | 无条件 `import('@tauri-apps/api/core')` |
| `src/utils/mediaFileWriter.ts` | 140-160 | `writeFile` / `mkdir` 全部依赖 Tauri FS 插件 |

### 修复方案

**核心思路**：Web 端不落地到文件系统，直接把远程 CDN URL 写入 `media_assets.sourceUrl`，UI 渲染时直接用远程 URL 显示，跳过 `jc-media://` 协议层。

具体分叉：

#### 1. `mediaTaskStore.ts` — 入口分叉（改动量最小，优先做）

```ts
// downloadAndPersistMediaAsset() 函数体内，try 之前插入：
import { isTauriRuntime } from '@/utils/tauriEnv'

// ...
if (!isTauriRuntime()) {
  task.assetStatus = 'remote-only'
  task.assetUri = url  // 直接存远程 URL（CDN）
  console.log('[JC] Web 端跳过本地下载，assetStatus=remote-only')
  void persistTasksSafely('asset-remote-only')
  return
}
```

#### 2. `mediaFileWriter.ts` — 写入分叉（桌面端保持现状）

入口加 `isTauriRuntime()` 判断：
- **桌面端**：现有逻辑不变（下载 → `output/{source}/...` → `insertMediaAsset` → `jc-media://{assetId}`）
- **Web 端**：新增 `writeMediaAssetWeb()` → 直接 `insertMediaAsset`（`logicalPath` 留空，`sourceUrl` 填远程 URL）

#### 3. `mediaFileReader.ts` — 渲染分叉

```ts
// resolveJcMediaUrl() 中：
if (!isTauriRuntime()) {
  // Web 端：从 media_assets 取 sourceUrl
  const row = await getMediaAssetById(assetId)
  return row?.sourceUrl || url  // 回退到原始 URL（可能已是远程 URL）
}
// 桌面端：现有 convertFileSrc 逻辑不变
```

#### 4. `MediaDisplayAsset` 工厂函数兼容

```ts
// mediaDisplayAssetFromMediaRow 检测 logicalPath 为空时
displayUrl = row.sourceUrl || row.logicalPath  // Web 端优先 sourceUrl
```

### 风险/边界

| 风险 | 缓解 |
|------|------|
| CDN URL 有时效（COS 7-30天） | 短期接受，UI 标注"远程资源可能过期" |
| IndexedDB 存远程 URL 不是永久方案 | 中期：服务端起永久存储桶 + 转储 Worker |
| "下载"按钮在 Web 端无意义 | Web 端改为 `<a download>` 浏览器下载 |

### 验收

- Web 端 `z-image-turbo` 生成图片 → 画廊正常显示
- 控制台无 `Cannot read properties of undefined (reading 'invoke')`
- 刷新页面后图片仍在（IndexedDB `media_assets` 持久化生效）
- "复制 URL" 复制 CDN URL，非 `jc-media://`

---

## 🟡 P1-3：Web 端 CSP 阻 `jc-media:` + 渲染层不该用此协议

### 根因

两层问题：

1. **底层**：Web 端 CSP `img-src 'self' data: blob: https:` 不含 `jc-media:`——这是**正确的**，Web 端就不该有这个协议（`jc-media://` 依赖 Tauri `convertFileSrc`）。
2. **上层**：历史数据（桌面端同步的会话、或 P0-2 修好前写入的旧记录）里有 `<img src="jc-media://...">`，渲染层没有 fallback。

**CLAUDE.md §0.3 推论 1 已有警告**："任何直接塞 `jc-media://` 给 `<img>/<video>/<audio>` 的代码都是 bug。"——这个 bug 在 Web 端表现特别严重，因为连 `convertFileSrc` resolver 都不存在。

### 修复方案

**双管齐下**：

#### 1. 渲染层加 fallback（主要修复）

`MediaDisplayAsset` 工厂函数 + `resolveJcMediaUrl`：

```ts
// 检测到 jc-media:// 但当前是 Web runtime
if (displayUrl.startsWith('jc-media://') && !isTauriRuntime()) {
  displayUrl = originalUrl || ''  // fallback 到远程 CDN URL
}

// 连 sourceUrl 也没有 → 占位图
if (!displayUrl) {
  displayUrl = PLACEHOLDER_IMAGE  // 显示"此资源仅桌面端可见"
}
```

#### 2. 消息渲染层兜底

Markdown 渲染管线（`src/components/chat/display/`）中 `<img src>` 经过 sanitize 时：
- 遇到 `jc-media:` → Web 端直接替换为 `sourceUrl`，无 `sourceUrl` 则显示占位文案
- **不要**在 CSP 里加 `jc-media:`——加了也没 resolver，反而掩盖问题

#### 3. CSP 不变

Web 端 CSP **刻意保持** `img-src 'self' data: blob: https:`，不添加 `jc-media:`。这是正确的隔离。

### 验收

- 控制台不再有 `Loading the image 'jc-media:...' violates CSP`
- 历史会话里桌面端写入的图片：有 `sourceUrl` → 正常显示；无 `sourceUrl` → 显示占位提示（非报错）
- CSP 头未变更

---

## 🟡 P1-4：`/v1/models` 偶发 `ERR_CONNECTION_CLOSED`

### 根因（待确认）

注意：`/v1/images/generations` 和 `/rh/tasks/...` 都是 200 OK，说明**只是 `/v1/models` 这一个端点的问题**，不是整体服务不通。

可能原因：
- NewAPI 上游 `/v1/models` 路由偶发超时/reset
- Cloudflare 边缘到源站短连接被 reset（冷启动首次建连）
- `/v1/models` 响应体较大（模型列表 JSON），触发了某个 buffer 限制

### 修复方案

**先观察 + 加防御，不急着改后端**：

#### 1. 前端加重试（`agentStore.ts` `fetchModels()`）

```ts
// gateway 调用外包指数退避
async function fetchWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn() }
    catch (e) {
      if (i === maxRetries - 1) throw e
      await new Promise(r => setTimeout(r, 2000 * (i + 1)))
    }
  }
}
```

#### 2. 降级提示增强

当前已有 localStorage 缓存 + `DEFAULT_MODELS` 三级 fallback。增强：UI 标注 `modelCatalogSource` 为 `'cache'` 时显示"模型列表为本地缓存，可能不是最新"。

#### 3. 后端排查（独立 issue）

- 查 Cloudflare 边缘 `/v1/models` 的 5xx 比例
- 查 NewAPI 容器的 `/v1/models` 路由日志
- 抓连接日志确认 server reset vs client timeout

### 验收

- 重试机制生效：允许偶发 `ERR_CONNECTION_CLOSED`，但 UI 不感知
- `modelCatalogSource === 'cache'` 时 UI 有提示
- 持续观察 1 周决定是否后端介入

---

## 🟢 P2-5：第二次 boot/initDB 超时降级

### 根因（待确认）

日志矛盾：boot 24ms 成功 → 10s 后 boot 超时。两种可能：

- **A（多 tab）**：用户刷新或开第二个 tab，第二次 `initDB()` 时 IndexedDB `open` 被前一个 tab 的连接阻塞（Safari/旧 Chrome 已知行为）
- **B（重复调用）**：单 tab 内某段代码二次触发 `initBackend`（登录态切换 / 路由守卫误调用）

### 修复方案

**先排查再修**：

#### 1. 先让用户单 tab 复现

关闭所有 `jiucaihezi.studio` tab，单 tab 打开，看是否还出现"超时"日志。不复现 → 确认为多 tab 问题。

#### 2. 加 boot 幂等保护（建议无脑加）

```ts
// main.ts initBackend() 入口
let backendInitStarted = false

async function initBackend() {
  if (backendInitStarted) return
  backendInitStarted = true
  // ... 现有逻辑
}
```

#### 3. IndexedDB open 加 versionchange 监听

```ts
// idb.ts
const openReq = indexedDB.open(DB_NAME, DB_VERSION)
openReq.onblocked = () => {
  console.warn('[JC] IndexedDB blocked by another tab, closing...')
  // 提示用户关闭其他 tab
}
```

#### 4. 降级警告 banner 增强

当前 banner（`WorkspaceLayout.vue`）文案：
> ⚠️ 本地存储未就绪，数据可能无法保存。建议重启 APP 或清空 ~/.jiucaihezi/data 后重试。

Web 端应改为：
> ⚠️ 本地存储未就绪。请关闭其他标签页后刷新本页。

### 验收

- 单 tab 启动无超时日志
- 多 tab 场景新 tab 不会让旧 tab 降级
- 真降级时 banner 文案对 Web 端友好（提"标签页"而非"重启 APP"）

---

## 涉及文件总览

| # | 文件 | 改动类型 | 风险 |
|:--:|------|----------|:--:|
| P0-1 | 服务端 Nginx / Cloudflare Worker | 配置：去重 CORS 头 | 🟢 |
| P0-2 | `src/stores/mediaTaskStore.ts` | 入口加 `isTauriRuntime()` 守卫 | 🟢 |
| P0-2 | `src/utils/mediaFileWriter.ts` | 新增 Web 端写入路径 | 🟡 |
| P0-2 | `src/utils/mediaFileReader.ts` | `resolveJcMediaUrl` 加 Web fallback | 🟡 |
| P1-3 | `src/components/chat/display/` 渲染管线 | `<img>` sanitize 加 Web 端替换 | 🟡 |
| P1-4 | `src/stores/agentStore.ts` | `fetchModels` 加重试 | 🟢 |
| P2-5 | `src/main.ts` | `initBackend` 加防重入 | 🟢 |
| P2-5 | `src/utils/idb.ts` | IndexedDB `onblocked` 监听 | 🟢 |
| P2-5 | `src/layouts/WorkspaceLayout.vue` | 降级 banner 文案分平台 | 🟢 |

---

## 建议修复顺序

```
第 1 轮（今天）：
  P0-1 CORS 头去重（服务端，0.5h）
  P0-2 创作落地分叉（前端，1-2天）  ← 最重要的代码改动
      ↳ 顺手做 P1-3 渲染层 fallback（0.5天，依赖 P0-2 的 mediaFileReader 改动）

第 2 轮（明天）：
  P1-4 /v1/models 前端重试（0.5h）
  P2-5 boot 幂等保护（1h）

第 3 轮（观察）：
  观察 1 周，决定是否启动后端永久存储桶方案
```

> **强依赖**：P1-3 依赖 P0-2 的 `resolveJcMediaUrl` 改动，应在 P0-2 后立即做。
> **可并行**：P0-1（服务端）和 P0-2（前端）互不依赖，可同时开工。

---

## 长期规划（不在本次范围）

1. **永久存储桶 + 转储 Worker**：服务端接管 RunningHub COS URL 转储到自建 S3/R2，返回永久 URL。这是 Web 端创作可持久化的唯一正确解法——目前 IndexedDB 存远程 CDN URL 只是过渡。
2. **Web 端「我的文件」**：CLAUDE.md §0.3 决策六明确"Web 端不复刻「我的文件」"，但可以做一个轻量的"远程资产列表"（基于 `media_assets.sourceUrl`），不含本地文件管理。
3. **崩溃上报**：Sentry 等，当前完全缺失。

---

## 相关文档

- `CLAUDE.md` §0 存储架构（`jc-media://` 渲染契约、`output/{source}/` 路径规范）
- `CLAUDE.md` §12 启动架构（boot/initDB 异步初始化）
- `docs/sdd/unified-file-access-design-v2.md` §5（完整 6 条决策，含 Web 端不复刻「我的文件」）
- `docs/sdd/storage-media-asset-migration.md`（P0-P3 存储瘦身）
