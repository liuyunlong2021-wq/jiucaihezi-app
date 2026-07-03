# Web 端优化方案 v3 — 彻底版

> **分支**：`webyouhua`
> **日期**：2026-06-19
> **演进**：`optimization-plan.md`（v1，应付式）→ `optimization-plan-v2.md`（v2，结构诚实但仍有 3 处二次应付）→ **v3**（按"彻底解决"标准重写）
>
> **v3 核心改动**：把 v2 推给"另开 issue"的 3 件事——**永久存储、boot 降级抢救、boot 根因定位**——拉回本次范围。前端 + 服务端**并行 2-3 周**完成所有 P0/P1/P2。任一未达标都有明确的回退方案，绝不让用户带着"7-30 天失效"或"静默丢数据"的隐患上线。

---

## 0. 与 v2 的核心差异

| 项 | v2 处理 | v3 处理 |
|---|---|---|
| 永久存储桶 | "另开 issue"（无时间表） | **本次范围**（Week 1-2，R2 + 转储 Worker） |
| boot 降级抢救 | JSON 下载（用户拿到不知用） | **云端紧急同步 + 未登录强制登录拦截** |
| boot 根因 | 加 trace 等抓数据 | **本次内 48h 观察期 → 定位 → 修** |
| CORS 优先级 | P2（误判，影响模型列表） | **P2 但本次必做**（服务端 0.5 天能修） |
| `/v1/models` 缓存 | 前端 24h TTL（数字凭空） | **服务端 SWR + 前端 stale-while-revalidate** |
| 灰度 | 假灰度（localStorage） | **远程 config 端点 + 用户 ID 哈希百分比** |
| 视频/音频 CORS | 提了但没验证 | **本次先 curl 验证，结果决定 R2 桶 CORS 配置** |
| 验证清单 | 提了但没列内容 | **13 条手动回归 + 4 个指标 + Vitest/Playwright 雏形** |
| 不达标回退 | 没提 | **3 条明确回退策略**（A 未完成 → alpha；B 未完成 → 拒绝服务；F 无结论 → 卡灰度） |

---

## 1. 真正的优先级（按"必须本次完成"重排）

```
P0（核心痛点，决定 Web 端能否正式上线）：
  A. 永久存储桶 + 转储链路              ← 双端共同需求
  B. boot 降级 → 云端紧急同步 + 强制登录   ← 数据安全前提
  C. 创作落地分叉（修 invoke 崩溃）

P1（影响日常使用，本次必修）：
  D. jc-media:// 渲染 fallback（含视频/音频 CORS 实测）
  E. 历史脏数据迁移脚本（启动时分批跑）
  F. boot 根因定位（trace + 48h 观察 + 闭环修复）

P2（质量保证，本次必修）：
  G. CORS 服务端去重 + preflight 治理 + CI 回归
  H. /v1/models 服务端 Cache-Control + 前端 SWR + 抓 reset 根因

P3（工程保证，本次必修）：
  I. 真灰度（远程 config + 百分比 + 错误率自动暂停）
  J. 验证清单（指标 + 13 条回归 + Sentry/Cloudflare Analytics 接入）
  K. Vitest 单测 + Playwright e2e 雏形
```

**这 11 项全部本次完成**。不存在"P0 这次做、P3 下次做"——P3 是 P0 的安全网，必须同时上。

---

## 2. 各项的彻底解

---

### A. 🔴 P0：永久存储桶 + 转储链路

#### 问题

`z-image-turbo` 等模型返回 RunningHub 腾讯云 COS 临时 URL（7-30 天失效）。Web 端如果只把 URL 写进 IndexedDB，一个月后用户画廊全部 404。

且这是**双端共同问题**：桌面端虽然下载到 `output/`，但用户换电脑后画廊也丢。**永久存储桶是双端共需基础设施。**

#### 彻底方案：服务端转储 + 双端共用

**存储选型**：**Cloudflare R2**
- 与现有 Cloudflare Worker 链路天然集成
- 免出口流量费（相比 AWS S3 / 腾讯云 COS）
- 全球 CDN 加速，Web 端 + 桌面端访问延迟一致
- 估算成本：1000 用户/日 × 10 图/用户 × 2MB = 20GB/天 → 600GB/月 ≈ $9/月存储费

**转储链路**：

```
用户提交创作 prompt
  ↓
前端 → NewAPI /v1/images/generations
  ↓
NewAPI → rh-adapter（如果是 RH 模型）
  ↓
rh-adapter → RunningHub → 返回 COS 临时 URL
  ↓
rh-adapter 立即返回前端 COS 临时 URL（用户能马上看到图）
  + 异步触发转储 Worker（不阻塞前端）
  ↓
转储 Worker：
  1. GET COS URL → 拿到二进制
  2. PUT 到 R2: jiucaihezi-media/{userId}/{YYYY-MM}/{assetId}.{ext}
  3. 回写 NewAPI 数据库：media_assets 表的 sourceUrl 更新为永久 R2 URL
  ↓
前端定时拉取 media_assets 列表（或 WebSocket 推送）
  → 检测到 sourceUrl 从 COS 变成 R2 → 更新本地引用
```

**关键设计**：
- **转储是异步的**：用户提交瞬间能看到图（COS URL），转储完成后无感知切换到 R2 URL。
- **写入幂等**：R2 对象键用 `{assetId}` 唯一，重试不重复存。
- **失败降级**：转储失败时记日志 + 重试 3 次，全失败则标记 `media_assets.permanentStorage = 'failed'`，UI 警示用户保存。
- **桌面端复用**：桌面端 `mediaFileWriter.ts` 也走同一接口（写入 R2），用户登录后可在 Web 端看到同一画廊。

#### 服务端工作清单

| # | 任务 | 估时 | 负责 |
|---|------|:--:|---|
| A1 | R2 桶创建 + CORS 配置（允许 `https://jiucaihezi.studio`、`tauri://localhost`） | 0.5 天 | DevOps |
| A2 | 转储 Worker（Cloudflare Workers）+ 重试逻辑 | 2 天 | 服务端 |
| A3 | rh-adapter 集成转储触发（不阻塞响应） | 0.5 天 | 服务端 |
| A4 | NewAPI `media_assets` 表新增 `permanentUrl`、`permanentStorage` 字段 | 0.5 天 | 服务端 |
| A5 | 前端 mediaTaskStore 监听 permanentUrl 更新 | 0.5 天 | 前端 |

**总计**：4 天（服务端为主）。

#### 不达标回退

**如果 A 未完成**：Web 端创作功能挂 **alpha 标**，UI 顶部醒目提示"创作图片 7-30 天可能失效，正式版即将支持永久保存"。**不引流、不推广**，等 A 完成再正式上线。

---

### B. 🔴 P0：boot 降级 → 云端紧急同步 + 强制登录

#### 问题

`initDB()` 偶发挂掉进入 localStorage 降级模式后，会话/消息容量从几百 MB 降到 5MB，**长会话静默丢数据**。v2 的 JSON 下载方案不够——用户拿到 JSON 没有 import 入口、可能点取消、几十 MB 序列化会爆内存。

#### 彻底方案：登录拦截 + 云端同步 + JSON 兜底

```
检测到 IndexedDB 失败（initDB 抛错 / 10s 超时）
  ↓
进入降级路径，但不静默
  ↓
检查登录态：
  ├─ 已登录：
  │   1. 立即 POST /api/sessions/emergency-backup
  │      body = { conversations, messages, timestamp }
  │   2. 等待响应（5s 超时）
  │   3. 成功 → 用户继续使用（写入直走云端，不依赖本地）
  │   4. 失败 → 走 JSON 下载兜底 + Sentry 上报
  │
  └─ 未登录：
      1. 弹模态框，禁用所有写入：
         "本地存储不可用。要保护您的数据，请登录后继续使用。"
         [立即登录] [仅查看历史，不保存]
      2. 用户登录后自动触发 emergency-backup
      3. 用户拒绝登录 → 只读模式，所有创作/对话按钮禁用
```

#### 服务端工作

| # | 任务 | 估时 | 负责 |
|---|------|:--:|---|
| B1 | 新增 `POST /api/sessions/emergency-backup` 端点 | 1 天 | 服务端 |
| B2 | 数据存储到 D1 / Postgres（同账号下的 emergency_backups 表） | 0.5 天 | 服务端 |
| B3 | 新增 `GET /api/sessions/emergency-backup/latest` 用于恢复 | 0.5 天 | 服务端 |

#### 前端工作

| # | 任务 | 估时 |
|---|------|:--:|
| B4 | `main.ts` Promise 缓存防重入（v2 已有，沿用） | 0.5 天 |
| B5 | 降级检测 → 登录态分支 → 云端同步 / 强制登录弹窗 | 1 天 |
| B6 | 只读模式（禁用所有写入按钮 + 视觉警示） | 0.5 天 |
| B7 | `WorkspaceLayout` 顶部 banner 分场景文案 | 0.5 天 |

#### 不达标回退

**如果 B 未完成**：上线时**直接禁用 IndexedDB 降级路径**——`initDB()` 失败时显示"环境不支持，请使用桌面端或更换浏览器"，不让用户进入会丢数据的降级模式。**宁可拒绝服务，也不静默丢数据。**

---

### C. 🔴 P0：创作落地分叉（修 invoke 崩溃）

#### 问题（v2 已说清，这里只列契约）

`mediaTaskStore.downloadAndPersistMediaAsset()` 在 Web 端调 Tauri `invoke` 崩溃。

#### 彻底方案（沿用 v2，遵守字段契约）

```ts
// downloadAndPersistMediaAsset() try 之前：
if (!isTauriRuntime()) {
  task.assetStatus = 'remote-only'
  // assetUri 保持空，不伪造 jc-media://
  // 等 A 完成后，监听 permanentUrl 更新到 task.sourceUrl
  void persistTasksSafely('asset-remote-only-web')
  return
}
```

**`MediaDisplayAsset` 工厂函数**：

```
assetStatus === 'remote-only'
  → displayUrl = permanentUrl || sourceUrl
  → originalUrl = permanentUrl || sourceUrl
```

优先级：**永久 R2 URL > COS 临时 URL > 空（显示占位）**。

#### 工作清单

| # | 任务 | 估时 |
|---|------|:--:|
| C1 | `mediaTaskStore.ts` 加 `isTauriRuntime()` 守卫 | 0.5 天 |
| C2 | `MediaDisplayAsset` 工厂函数 `remote-only` 分支 | 0.5 天 |
| C3 | `mediaTaskStore` 监听 A 链路返回的 `permanentUrl` 更新 | 0.5 天 |

---

### D. 🟡 P1：jc-media:// 渲染 fallback + 视频/音频 CORS 实测

#### v2 缺口

v2 只提了 `<img>`，且**没验证 RH COS 域名对 `<video>` / `<audio>` 是否允许跨域加载**。

#### 必须先做的实测

```bash
# 1. 看 COS URL 的 CORS 头
curl -I -H "Origin: https://jiucaihezi.studio" \
  https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/<sample>.mp4

# 关注响应里：
#   Access-Control-Allow-Origin: ?
#   Access-Control-Allow-Methods: ?
#   Accept-Ranges: bytes  ← <video> seek 需要
```

**结果分两种情况**：

| 情况 | 处理 |
|---|---|
| COS 允许跨域 + Range | 前端 fallback 直接 `<video src="https://...cos...">` 即可 |
| COS 不允许跨域 / 无 Range | **必须等 A 完成**，转储到 R2 + R2 桶 CORS 显式允许 `https://jiucaihezi.studio`、`Range` |

无论哪种情况，**R2 桶的 CORS 配置必须本次完成**（A1 步骤），保证未来所有媒体类型可播。

#### 渲染层修法

```
resolveJcMediaUrl(url, asset):
  if isTauriRuntime():
    return convertFileSrc(...)  // 桌面端不变

  // Web 端
  if asset.permanentUrl: return asset.permanentUrl       // R2 永久 URL
  if asset.sourceUrl: return asset.sourceUrl             // COS 临时 URL
  return PLACEHOLDER_FOR_MEDIA_KIND(asset.kind)          // 占位
```

覆盖三类入口：
- `<img>` → `MediaAssetCard.vue`、`MediaViewer.vue`、`MarkdownContent.vue`
- `<video>` → 同上 + 创作面板视频预览
- `<audio>` → 同上 + 音频播放器

#### 工作清单

| # | 任务 | 估时 |
|---|------|:--:|
| D1 | curl 实测 COS CORS / Range，给出结论文档 | 0.5 天 |
| D2 | `mediaFileReader.ts` 统一 fallback 函数 | 0.5 天 |
| D3 | `MarkdownContent.vue` sanitize 替换 jc-media: | 0.5 天 |
| D4 | `MediaViewer` / `MediaAssetCard` 覆盖三类媒体 | 0.5 天 |

---

### E. 🟡 P1：历史脏数据迁移（执行细节完整版）

#### v2 缺口

v2 提了"写一次性脚本"但没说什么时候触发、怎么防重复、怎么处理 1000+ 条卡 UI。

#### 彻底方案

**触发**：`initDB()` 完成后，在 `WorkspaceLayout` 挂载前调用 `runDataMigrations()`。

**版本管理**：IndexedDB 新增 `_migrations` 表，记录已执行的迁移版本号。

```
_migrations 表：
  { id: 'fill-source-url-from-task-store-v1', completedAt: 1734567890000, totalRows: 1247 }
```

**分批执行**：

```
async function fillSourceUrlMigration() {
  if (await hasMigration('fill-source-url-from-task-store-v1')) return

  const allAssets = await getAllMediaAssets()
  const orphans = allAssets.filter(a => !a.sourceUrl && (!a.logicalPath || a.logicalPath.startsWith('jc-media://')))

  const BATCH = 100
  let progress = 0
  for (let i = 0; i < orphans.length; i += BATCH) {
    const batch = orphans.slice(i, i + BATCH)

    for (const asset of batch) {
      try {
        const sourceUrl = lookupSourceUrlFromTaskStore(asset.id)
        if (sourceUrl) {
          await updateMediaAsset(asset.id, { sourceUrl, assetStatus: 'remote-only' })
        } else {
          await updateMediaAsset(asset.id, { assetStatus: 'orphaned' })
        }
      } catch (e) {
        // 单条失败不阻塞，记日志
        console.warn('[migration] asset failed:', asset.id, e)
      }
    }

    progress += batch.length
    emitProgress(progress / orphans.length)  // 通知 UI 更新进度条

    await new Promise(r => setTimeout(r, 0))  // 让出主线程
  }

  await recordMigration('fill-source-url-from-task-store-v1', { totalRows: orphans.length })
}
```

**UI 进度条**：`WorkspaceLayout` 顶部显示 `迁移历史数据中... 247 / 1247`，迁移期间禁用画廊入口。

**失败断点续传**：迁移过程中崩溃，下次启动会重新跑（因为 `_migrations` 没记录完成），单条失败已记日志不影响重启。

#### 工作清单

| # | 任务 | 估时 |
|---|------|:--:|
| E1 | `idb.ts` 加 `_migrations` 表 + `hasMigration` / `recordMigration` | 0.5 天 |
| E2 | `migrateJcMediaLegacy.ts` 迁移逻辑 | 1 天 |
| E3 | `WorkspaceLayout` 进度条 UI | 0.5 天 |

---

### F. 🟡 P1：boot 根因定位（闭环修复，不是加 trace 就完）

#### v2 应付之处

v2 把"加 console.trace 抓二次调用栈"列为 ✅ 本次。这是 debug 手段，不是修复。**没有定位结论就不算完成。**

#### 彻底方案：48h 观察期 + 必须给出结论

**Step 1（本次 Day 1）**：在 `main.ts` 加全链路 trace：

```ts
async function initBackend(caller: string) {
  console.log(`[JC-boot] initBackend called by ${caller}`)
  console.trace('[JC-boot] initBackend stack')
  // ... 现有逻辑
}
```

调用方都改成传 caller 标识（`'main'` / `'auth-changed'` / `'route-guard'` / ...）。

**Step 2（本次 Day 2）**：部署到生产，开启 48h 观察期。

**Step 3（本次 Day 4）**：收集真实日志：
- 用 Sentry / Cloudflare Analytics 拉所有 `[JC-boot]` 开头的日志
- 至少需要 **5 次降级触发的完整 trace**
- 不够 5 次 → 延长观察 48h

**Step 4（本次 Day 5）**：根据日志定位根因，分类处理：

| 根因 | 修法 |
|---|---|
| 多 tab IDB blocking | 加 `onblocked` 监听 + Promise 缓存 |
| 登录态切换二次触发 initBackend | 修调用方逻辑 |
| `idb.ts` 内部 race（initDB 自身被并发调） | 把 initDB 也用 Promise 缓存 |
| 真 IDB 失败（磁盘满/Safari 隐身） | 走 B 的降级路径 |

**Step 5**：修复后再观察 7 天，降级率 < 0.1% 才算完成。

#### 工作清单

| # | 任务 | 估时 |
|---|------|:--:|
| F1 | `main.ts` 全链路 trace | 0.5 天 |
| F2 | 部署 + 接 Sentry/Analytics | 0.5 天 |
| F3 | 48h 观察 + 日志分析 | 2 天（含等待） |
| F4 | 根据结论修代码 | 0.5-2 天 |
| F5 | 7 天稳定观察 | 监控为主 |

#### 不达标回退

**如果 48h 内日志样本不足或定位不明**：上线时**灰度卡在 10%**，不扩量；继续观察到有结论再扩。

---

### G. 🟡 P2：CORS 服务端去重 + preflight + CI

#### v2 缺口

v2 只提了"保留最外层、应用层移除"，没提 OPTIONS preflight 治理、没提白名单覆盖 Tauri Origin、没提 CI 回归保护。

#### 彻底方案

**Step 1**：定位重复来源

```bash
curl -I -H "Origin: https://jiucaihezi.studio" \
  https://api.jiucaihezi.studio/api/creation/models
# 看 Access-Control-Allow-Origin 出现几次
```

**Step 2**：选一层保留，其他全部移除

推荐保留 **Cloudflare Worker**（最外层），原因：
- Worker 可以按 Origin 动态白名单
- Nginx / 应用层移除后只剩一处真源

**Step 3**：完整 CORS 头（不只是 Allow-Origin）

```js
// Cloudflare Worker
const ALLOWED_ORIGINS = [
  'https://jiucaihezi.studio',
  'https://www.jiucaihezi.studio',
  'http://localhost:5173',
  'tauri://localhost',
  'http://tauri.localhost',
]

const origin = request.headers.get('Origin')
if (ALLOWED_ORIGINS.includes(origin)) {
  response.headers.set('Access-Control-Allow-Origin', origin)
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  response.headers.set('Access-Control-Max-Age', '86400')
}

// OPTIONS preflight 直接返回 204
if (request.method === 'OPTIONS') {
  return new Response(null, { status: 204, headers: ... })
}
```

**Step 4**：CI 回归保护

新增 `.github/workflows/cors-check.yml`：每次部署后跑 `curl -I` 验证：
- `Access-Control-Allow-Origin` 只有 1 行
- OPTIONS 返回 204 + 完整头
- 失败则发 Slack/邮件告警

#### 工作清单

| # | 任务 | 估时 | 负责 |
|---|------|:--:|---|
| G1 | curl 定位重复源 | 0.5 天 | 服务端 |
| G2 | Worker 重写 CORS 逻辑 | 0.5 天 | 服务端 |
| G3 | Nginx/应用层移除冗余 CORS | 0.5 天 | 服务端 |
| G4 | CI 回归 workflow | 0.5 天 | DevOps |

---

### H. 🟡 P2：/v1/models 服务端缓存 + 前端 SWR + 抓 reset

#### v2 应付之处

v2 前端加 24h TTL（数字凭空）+ "观察 1 周再决定"。

#### 彻底方案

**服务端（治本）**：

1. `/v1/models` 响应加 `Cache-Control: public, max-age=1800, stale-while-revalidate=86400`
   - max-age 30 分钟：用户绝大多数情况下走缓存
   - SWR 24 小时：缓存过期后先返回旧值，后台更新
2. **抓 reset 根因**：
   - `curl -v` 反复打 100 次，统计 reset 频率和时机
   - 同时 Cloudflare Edge logs 找对应时间戳的 Edge → Origin reset
   - NewAPI 容器内 `tcpdump` 抓包看是 Server 主动 reset 还是 Client timeout
   - 给出明确结论后修（可能是上游连接池满 / TLS handshake 失败 / 路由 panic）

**前端（SWR 配合）**：

```ts
async function fetchModels() {
  // 1. 立即返回 cache（如果有）
  const cached = await getCachedModels()
  if (cached) emitModels(cached)  // UI 立即可用

  // 2. 后台 revalidate
  try {
    const fresh = await fetchWithRetry(() => apiCall('/v1/models'), 1)
    await setCachedModels(fresh)
    emitModels(fresh)  // 更新 UI
  } catch (e) {
    if (!cached) throw e  // 无 cache 时才报错
    // 有 cache 时静默失败，下次再试
  }
}
```

**注意**：前端**不再凭空设 TTL**——TTL 由服务端 Cache-Control 决定，浏览器和 fetch 自动处理。

#### 工作清单

| # | 任务 | 估时 | 负责 |
|---|------|:--:|---|
| H1 | NewAPI `/v1/models` 加 Cache-Control | 0.5 天 | 服务端 |
| H2 | 抓 reset 根因（curl + tcpdump + 日志） | 1-2 天 | 服务端 |
| H3 | 根因修复 | 0.5-2 天 | 服务端 |
| H4 | 前端 SWR 改造 | 0.5 天 | 前端 |

---

### I. 🟢 P3：真灰度方案

#### v2 假灰度

```ts
const FLAG = localStorage.getItem('jc_web_remote_only') !== 'false'
```

无法远程操作、localStorage 降级时也会丢、加载时读一次运行时不可改。

#### 彻底方案：远程 config 端点 + 用户 ID 哈希百分比 + 错误率自动暂停

**Step 1**：服务端新增 `GET /api/config/flags`（不走 NewAPI，独立 Cloudflare Worker）

```json
{
  "web_remote_only": { "enabled": true, "rollout": 100 },
  "permanent_storage": { "enabled": true, "rollout": 30 },
  "emergency_backup": { "enabled": true, "rollout": 50 }
}
```

**Step 2**：前端启动时拉一次 + 30 分钟刷新

```ts
async function loadFeatureFlags() {
  const flags = await fetch('https://api.jiucaihezi.studio/api/config/flags').then(r => r.json())
  const userId = await getCurrentUserId() || 'anonymous'

  for (const [key, cfg] of Object.entries(flags)) {
    const hash = hashUserId(userId, key) % 100  // 0-99
    enabledFlags[key] = cfg.enabled && hash < cfg.rollout
  }
}

setInterval(loadFeatureFlags, 30 * 60 * 1000)
```

**Step 3**：错误率自动暂停

服务端 Cloudflare Analytics 监控：
- 标签 `feature_flag=permanent_storage` 的请求错误率
- 错误率 > 1% 持续 5 分钟 → 自动把 `rollout` 降到 0
- 通过 Cloudflare KV 实时下发

**Step 4**：灰度节奏

```
Day 1（修完代码）: 10% （内部 + 友好用户）
Day 3: 30%
Day 5: 50%
Day 7: 100%
任一阶段错误率 > 1% → 自动回滚到上一阶段
```

#### 工作清单

| # | 任务 | 估时 | 负责 |
|---|------|:--:|---|
| I1 | `/api/config/flags` 端点（Cloudflare Worker） | 1 天 | 服务端 |
| I2 | Cloudflare Analytics + 自动暂停 KV 写入 | 1 天 | 服务端 |
| I3 | 前端 `featureFlagsStore` | 0.5 天 | 前端 |

---

### J. 🟢 P3：验证清单（指标 + 回归 + 监控接入）

#### 4 个核心指标

| 指标 | 目标 | 监控方式 |
|---|:--:|---|
| Web 端图片首次加载成功率 | ≥ 99% | Sentry / Cloudflare Analytics |
| boot 降级触发率 | < 0.1% | 自定义事件上报 |
| `/v1/models` 重试后失败率 | < 1% | API 端点埋点 |
| 创作生成 30 天后仍可显示率 | 100% | 周期性后台 GET 抽样检测 |

#### 13 条手动回归清单（每次发版必跑）

1. ✅ 未登录访问 Web 端 → 首页/登录页正常显示
2. ✅ 登录后选 `z-image-turbo` → 生成 → 画廊出现图片
3. ✅ 刷新页面 → 图片仍在
4. ✅ 点击「复制 URL」→ 无痕窗口打开复制的链接 → 能看到图
5. ✅ 视频生成（如 Veo）→ 能在画廊播放
6. ✅ 音频生成（如 Suno）→ 能在画廊播放
7. ✅ 多 tab 打开 → 不触发降级（控制台无 `storageDegraded=true`）
8. ✅ DevTools → Application → Clear storage 模拟 IDB 失败 → 弹紧急同步/强制登录提示
9. ✅ 历史 `jc-media://` 数据用户登录 → 启动时显示迁移进度 → 完成后图片正常显示
10. ✅ 桌面端 `jc-media://` 仍正常显示（无回归）
11. ✅ 桌面端创作图片 → 写入 `output/{source}/...`（无回归）
12. ✅ 模型列表：第一次访问拉远端，第二次走 SWR 缓存（DevTools Network 验证）
13. ✅ CORS：`curl -I` 单一 `Access-Control-Allow-Origin`，OPTIONS 返回 204

#### Sentry 接入

`src/main.ts` 启动时初始化：

```ts
import * as Sentry from '@sentry/vue'
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // 过滤敏感信息（API Key、用户 prompt）
    return scrubSensitive(event)
  },
})
```

#### 工作清单

| # | 任务 | 估时 |
|---|------|:--:|
| J1 | Sentry 接入 + 敏感信息过滤 | 1 天 |
| J2 | 4 个核心指标埋点 | 0.5 天 |
| J3 | 13 条回归清单文档 + 责任人 | 0.5 天 |

---

### K. 🟢 P3：Vitest 单测 + Playwright e2e 雏形

#### Vitest 单测（本次必加）

```
src/stores/__tests__/mediaTaskStore.test.ts
  ✓ Web runtime: assetStatus = 'remote-only', assetUri 为空
  ✓ Tauri runtime: 走原下载链路
  ✓ permanentUrl 推送时正确更新

src/utils/__tests__/mediaFileReader.test.ts
  ✓ Web + permanentUrl → 返回 permanentUrl
  ✓ Web + 仅 sourceUrl → 返回 sourceUrl
  ✓ Web + 啥都没 → 返回占位
  ✓ Tauri → convertFileSrc

src/__tests__/boot.test.ts
  ✓ Promise 缓存：并发调用只触发一次 doInit
  ✓ doInit 失败 → Promise 清空允许重试

src/utils/__tests__/migrateJcMediaLegacy.test.ts
  ✓ _migrations 表已记录 → 跳过
  ✓ 1000 条数据分 10 批，每批 setTimeout(0)
  ✓ 单条失败不阻塞整批
```

#### Playwright e2e 雏形（本次写 3 个最关键的）

```
e2e/web-creation.spec.ts
  test('未登录 → 强制登录 → 生成图 → 显示 → 刷新仍在', ...)
  test('降级模式触发 → 紧急同步提示', ...)
  test('历史 jc-media:// 数据 → 迁移完成 → 显示', ...)
```

完整覆盖另开 issue，本次先把基础设施搭起来。

#### 工作清单

| # | 任务 | 估时 |
|---|------|:--:|
| K1 | Vitest 单测（4 个文件） | 1 天 |
| K2 | Playwright 配置 + 3 个 e2e | 1 天 |

---

## 3. 完整时间表（前端 + 服务端并行）

```
Week 1：
  服务端：
    Day 1: G（CORS 去重） + H1（Cache-Control）
    Day 2: H2-H3（抓 reset + 修）
    Day 3-4: A1-A4（R2 + 转储 Worker）
    Day 5: B1-B3（emergency-backup 端点）

  前端：
    Day 1: F1（trace 部署）+ C1-C2（创作落地分叉）
    Day 2: D1-D4（jc-media fallback + 实测）
    Day 3: E1-E3（迁移脚本 + UI）
    Day 4: B4-B7（降级抢救前端）
    Day 5: I3（feature flag 客户端）+ K1（Vitest）

Week 2：
  联调：
    Day 1-2: A5（前端监听 permanentUrl）+ C3（端到端）
    Day 3: F3-F4（48h 观察结论 + 修复）
    Day 4: I1-I2（远程灰度 + 监控）+ J1-J3（Sentry + 指标）
    Day 5: K2（Playwright e2e）+ 完整 13 条回归

Week 3：
  灰度：
    Day 1: 灰度 10%
    Day 3: 30%（前提：错误率 < 1%）
    Day 5: 50%
    Day 7: 100%
```

**总计**：3 周（含灰度观察）。

---

## 4. 阻塞关系图

```
     ┌──── A（永久存储） ─── 阻塞 Web 端正式上线
     │
     ├──── B（降级抢救） ─── 阻塞所有正式上线
     │
P0 ──┤
     ├──── C（落地分叉） ─── 阻塞 Week 2 联调
     │
P1 ──┼──── D（jc-media） ─── 与 A1（R2 CORS 配置）耦合
     │
     ├──── E（迁移脚本） ─── 独立
     │
     └──── F（boot 根因） ── 不阻塞上线但阻塞灰度扩量

P2 ──┬──── G（CORS） ──── 阻塞模型列表正常显示
     │
     └──── H（models） ─── 不阻塞功能

P3 ──┬──── I（灰度） ──── 阻塞 Week 3 扩量
     ├──── J（验证） ──── 阻塞 Day 5 上线 Gate
     └──── K（测试） ──── 阻塞每次发版回归
```

---

## 5. 不达标时的回退方案（必须明确）

| 项 | 未完成时的回退 |
|---|---|
| **A 永久存储** | Web 端创作功能挂 alpha 标，UI 醒目提示"7-30 天可能失效"，不引流不推广 |
| **B 降级抢救** | 直接禁用 IDB 降级路径——IDB 失败时显示"环境不支持，请使用桌面端"，**宁可拒绝服务也不静默丢数据** |
| **C 落地分叉** | 完全无法上线（功能崩） |
| **D jc-media fallback** | Web 端历史画廊全黑（影响存量用户体验，必须修） |
| **E 迁移脚本** | 历史脏数据显示占位（可接受短期，但需在 alpha 期内修完） |
| **F boot 根因** | 上线灰度卡在 10%，不扩量；继续观察到结论再扩 |
| **G CORS** | 创作模型列表降级到本地 catalog（可短期接受，但本次必修） |
| **H models 缓存** | 启动时每次拉远端，体验略差但功能正常 |
| **I 灰度** | 全量上线（高风险，不建议） |
| **J 验证** | 凭经验上线（不建议） |
| **K 测试** | 每次发版凭手动 13 条清单兜底 |

---

## 6. 责任分配

| 角色 | 负责项 |
|---|---|
| 前端 | C / D / E / B4-B7 / I3 / J / K |
| 服务端 | A1-A4 / B1-B3 / G / H / I1-I2 |
| DevOps | A1（R2 桶配置）/ G4（CI workflow） |
| 产品 | 灰度节奏决策 / alpha vs 正式上线 Gate |

---

## 7. 与 v1/v2 的完整对比

| 维度 | v1 | v2 | v3 |
|---|:--:|:--:|:--:|
| 字段契约 | ❌ | ✅ | ✅ |
| 优先级排序 | ⚠️ | ⚠️ | ✅ |
| **永久存储** | ❌ 长期规划 | ⚠️ 另开 issue | ✅ **本次必做（R2 + 转储 Worker）** |
| **降级抢救** | ❌ 关 tab | ⚠️ JSON 下载 | ✅ **云端紧急同步 + 强制登录** |
| **boot 根因** | ❌ 等复现 | ⚠️ 加 trace 等抓数据 | ✅ **48h 观察期 → 定位 → 修复闭环** |
| 视频/音频 | ❌ 没提 | ⚠️ 提了没验证 | ✅ **curl 实测 + R2 桶 CORS 显式配置** |
| 历史脏数据 | ❌ | ⚠️ 提了没细节 | ✅ **`_migrations` 表 + 分批 + 断点续传** |
| 灰度 | ❌ | ⚠️ 假灰度 | ✅ **远程 config + 用户哈希 + 自动暂停** |
| 自动化测试 | ❌ | ⚠️ 提了没具体 | ✅ **Vitest 4 文件 + Playwright 3 e2e** |
| 双端账号同步 | ❌ | ❌ 另开 issue | ⚠️ A 完成后免费送（R2 共用），账号同步层面另开 issue |
| Web 端登录约束 | ❌ | ❌ 另开 issue | ✅ **B 强制登录已实现产品流程** |
| **指标监控** | ❌ | ❌ | ✅ **4 个核心指标 + Sentry + Cloudflare Analytics** |
| **回归清单** | ❌ | ⚠️ 提了没列 | ✅ **13 条具体回归 + 责任人** |
| **不达标回退** | ❌ | ❌ | ✅ **11 项每项明确回退策略** |
| **责任和时间表** | ❌ | ❌ | ✅ **3 周完整时间表 + 责任分配表** |

---

## 8. 一句话总结

v3 = **v2 的结构 + 把 v2 推给"另开 issue"的 3 件事拉回本次 + 11 项完整责任时间表 + 11 项明确回退策略**。

**核心承诺**：
- ✅ 用户在 Web 端生成的图，**永久不会失效**（A）
- ✅ 用户的会话/消息，**永久不会静默丢失**（B）
- ✅ Web 端和桌面端创作画廊，**未来可以账号同步**（A 副产品）
- ✅ 任何回退场景，**都有明确预案不伤用户**（章节 5）

**前提**：服务端必须并行投入 1-2 人 × 2 周。如果服务端资源不到位，A 和 B 必须降级为 alpha + 拒绝服务路径——**绝不能把"7-30 天失效"和"静默丢数据"包装成正式上线**。
