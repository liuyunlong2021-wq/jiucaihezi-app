# Web 端优化方案 v2 — 诚实修订版

> **分支**：`webyouhua`
> **日期**：2026-06-19
> **上一版**：`optimization-plan.md`（已归档，参见末尾"v1 评审意见"）
>
> **v2 改动**：按"彻底修而不是应付"标准重写。承认哪些只能前端缓解、哪些必须服务端配合、哪些是 v1 没覆盖的盲区。

---

## 先坦白：这份方案的能力边界

| 能做的（前端代码） | 做不到的（需要服务端/基础设施） |
|---|---|
| 修 `invoke` 崩溃 → Web 端图片不落地，直接展示远程 URL | 建永久存储桶，让 URL 不过期 |
| 修 `jc-media://` CSP → 渲染时 fallback 到 `sourceUrl` | 改 Nginx/Cloudflare 的 CORS 配置 |
| 加重试 + 缓存 → 缓解 `/v1/models` 连接关闭 | 给 `/v1/models` 加 `Cache-Control` 头 |
| 修 boot 重复调用 → 防重入 + 降级时导出数据 | 查 IndexedDB 真实的失败原因（磁盘满？Safari 限制？） |
| 写数据迁移脚本 → 回填历史的 `sourceUrl` | 账号登录后同步 `media_assets` 到云端 |
| 覆盖视频/音频/文档的渲染 fallback | 存储视频/音频的永久 URL |

**我会把能力边界写清楚**：每条问题标注「前端能做」还是「需要服务端」，不混在一起制造"已解决"的假象。

---

## 修订后的优先级（按用户损失排，不是按控制台报错次数）

```
真正 P0（用户算力白费 / 数据丢失）：
  A. 生成图片 7-30 天后 404 → 永久存储缺失
  B. boot 降级 → 长会话静默丢数据

真正 P1（功能残缺，用户困惑）：
  C. 创作结果 invoke 崩溃 → 图生成了但看不见
  D. jc-media:// CSP 阻 → 历史图片全黑

真正 P2（可用性下降，但能绕过）：
  E. /v1/models 连接关闭 → 模型列表过期
  F. CORS 双头 → 创作模型列表降级到本地 catalog
```

---

## A. 🔴 P0：永久存储缺失（生成图过期 404）

### 现在是什么情况

`z-image-turbo` 生成的图返回的是 RunningHub 腾讯云 COS 临时 URL：
```
https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/1ff5c51...
```
这类 URL 有时效（7-30 天）。过期后画廊图片全部 404。

### v1 方案的应付之处

v1 说"短期接受，UI 标注'远程资源可能过期'"。这笔账是：
- 用户花了算力 Token → 生成了一张满意的图 → 一个月后回来找 → 没了。
- UI 标注"可能过期"是让用户自己承担后果，不是解决问题。

### 前端能做什么（治标）

**能做的**：
1. 把远程 URL 写进 `media_assets.sourceUrl`（保持字段契约：`sourceUrl` = 原始远程 URL，`assetUri` = 本地引用留空）
2. IndexedDB 持久化这个引用，刷新不丢
3. 「复制 URL」按钮走 `sourceUrl`（已有契约）
4. 如果检测到 `sourceUrl` 指向已知 COS 域名，UI 提示"此资源来自第三方，可能 30 天后失效"

**不能做的（必须服务端）**：
- 延长 COS URL 的过期时间 ← 这是腾讯云侧配置
- 把 COS 文件转储到永久桶 ← 需要服务端 Worker
- 返回永久 URL 替代 COS URL ← NewAPI 响应改造

### 服务端需要做什么（治本）

```
用户生成图片
  → NewAPI / rh-adapter 拿到 COS 临时 URL
  → 服务端 Worker 把文件转储到自建 R2/COS 永久桶
  → NewAPI 响应里的 URL 已经是永久 URL
  → 前端不感知 COS，只存永久 URL
```

**这是唯一正确解法**。而且桌面端也要用——用户换电脑后画廊不同步，根因也是文件只存在本地 `output/` 目录。永久存储桶是双端共同需求。

### 本次能做到什么程度

| 层次 | 内容 | 谁做 |
|------|------|------|
| 前端 | `sourceUrl` 正确写入 IndexedDB，刷新不丢 | ✅ 本次 |
| 前端 | 检测 COS 域名时 UI 提示时效 | ✅ 本次 |
| 服务端 | 建永久存储桶 + 转储 Worker | ❌ 另开 issue |
| 服务端 | `/v1/images/generations` 响应改造返回永久 URL | ❌ 另开 issue |

> **诚实结论**：本次前端修好后，图片能显示、刷新不丢、复制 URL 正确。但 30 天后 COS URL 过期仍是事实——这个问题必须服务端解决，前端修不了。

---

## B. 🔴 P0：boot 降级 → 数据丢失

### 现在是什么情况

日志矛盾：`initDB() 完成 (29ms)` ↔ `initDB() 超时（10s）`。同一份日志同时出现——这意味着初始化被跑了两次。第二次超时后走 `localStorage` 降级，容量从 IndexedDB 的几百 MB 降到 ~5MB。长会话会被截断，**静默丢数据**。

### v1 方案的应付之处

v1 说"先让用户单 tab 复现"，然后"加防重入锁"、"banner 提示关 tab"。但：
- 如果 IndexedDB 真坏了（磁盘满、Safari 隐身模式、浏览器配额耗尽），关 tab 救不了
- 降级模式下用户的会话已经在 `localStorage` 里写了，刷新就丢
- "24ms 完成"和"10s 超时"同时出现——这个矛盾本身就是 bug 信号，不应该"等复现"

### 前端能做什么（治标 + 防丢）

1. **抓调用栈**：`initDB()` 入口加 `console.trace('initDB called')`，确认是谁调了第二次
2. **防重入**：用 Promise 缓存而非 boolean 锁（boolean 锁崩了就永远无法重试）：

   ```ts
   let backendInitPromise: Promise<void> | null = null

   async function initBackend() {
     if (backendInitPromise) return backendInitPromise
     backendInitPromise = doInit().catch((e) => {
       backendInitPromise = null  // 出错清空，允许重试
       throw e
     })
     return backendInitPromise
   }
   ```

3. **降级瞬间数据抢救**：进入降级模式时，自动把当前内存里的会话/消息导出为 JSON 文件触发浏览器下载（`Blob` + `<a download>`），让用户至少能保存一次。**不是提示"请关 tab"，而是直接给用户一份可下载的备份**。
4. **多 tab 检测**：IndexedDB `onblocked` 事件触发时，提示用户"检测到多个标签页，可能影响数据保存"。

### 服务端需要什么（治本）

如果 IndexedDB 本身坏了（不是代码问题，是浏览器环境问题），唯一治本方案是把会话存云端。这需要 Cloudflare D1 或类似的云端存储——不在本次范围。

### 本次能做到什么程度

| 层次 | 内容 | 谁做 |
|------|------|------|
| 前端 | `console.trace` 抓二次调用栈 | ✅ 本次 |
| 前端 | Promise 缓存防重入 | ✅ 本次 |
| 前端 | 降级瞬间自动导出 JSON 下载 | ✅ 本次 |
| 前端 | `onblocked` 多 tab 提示 | ✅ 本次 |
| 前端 | 降级 banner 文案分平台（"关标签页"而非"重启 APP"） | ✅ 本次 |
| 服务端 | 会话云端存储（D1/云数据库） | ❌ 另开 issue |

---

## C. 🔴 P0（原 P0-2 重评）：创作结果 invoke 崩溃

### 现在是什么情况

```
mediaTaskStore.downloadAndPersistMediaAsset()
  → import('@tauri-apps/api/core')
  → invoke('http_download_base64', ...)
  → TypeError: Cannot read properties of undefined (reading 'invoke')
```

图生成了（RH 返回 200），但保存那步崩了，图丢了。

### v1 方案的问题（除了"CDN 过期"那个根本缺陷外）

v1 方案里写 `task.assetUri = url`（把远程 URL 直接塞 `assetUri`），这违反了 CLAUDE.md §0.3.1 的字段契约：

> `assetUri` 含义：**本地引用 `jc-media://{assetId}`**
> `sourceUrl` 含义：原始远程 CDN URL

把 HTTP URL 塞进 `assetUri`，所有下游以"`assetUri` 是 `jc-media://`"为前提的代码都会出错。

### 前端修法（遵守契约）

```ts
// downloadAndPersistMediaAsset() try 之前：
import { isTauriRuntime } from '@/utils/tauriEnv'

if (!isTauriRuntime()) {
  // Web 端：不下载、不写文件、不伪造 assetUri
  // sourceUrl 已有（task 入参 url），直接标记 remote-only
  task.assetStatus = 'remote-only'
  // assetUri 保持为空 ← 遵守契约：没有本地文件就没有 assetUri
  // 下游渲染全部走 sourceUrl
  console.log('[JC] Web 端 remote-only:', task.id)
  void persistTasksSafely('asset-remote-only-web')
  return
}
```

然后在 `MediaDisplayAsset` 工厂函数里保证：`assetStatus === 'remote-only'` 时 `displayUrl = sourceUrl`，`originalUrl = sourceUrl`。

### 本次能做到什么程度

| 层次 | 内容 | 谁做 |
|------|------|------|
| 前端 | 遵守字段契约：`assetUri` 不伪造，`assetStatus='remote-only'` | ✅ 本次 |
| 前端 | 渲染层全走 `sourceUrl` | ✅ 本次 |
| 前端 | 覆盖图片/视频/音频三种媒体类型 | ✅ 本次 |
| 服务端 | 永久 URL（见 A 条） | ❌ 另开 issue |

---

## D. 🟡 P1（原 P1-3 重评）：jc-media:// CSP 阻挡

### 现在是什么情况

`<img src="jc-media://file_xxx">` → CSP `img-src` 不含 `jc-media:` → 浏览器拒绝。同时 `jc-media://` 只在 Tauri 环境有 resolver（`convertFileSrc`），Web 端本来就不该用。

### v1 方案的缺口

- 只提了 `<img>`，没提 `<video>` 和 `<audio>`（CLAUDE.md §0.3 推论 1 三个都列了）
- 没提 markdown sanitize 的具体文件路径
- 没提历史脏数据（IndexedDB 里已有的 `jc-media://` 记录没有对应 `sourceUrl`）

### 前端修法

1. **渲染层统一 fallback**：`resolveJcMediaUrl()` / `resolveForDisplay()` 在 `!isTauriRuntime()` 时直接从 `media_assets.sourceUrl` 取值，不调 `convertFileSrc`。覆盖 `<img>` / `<video>` / `<audio>`。
2. **Markdown sanitize 管线**：`src/components/chat/display/` 中 markdown 渲染时 `<img src>` 经 DOMPurify 后，检测 `jc-media:` → Web 端替换为 `sourceUrl`。具体文件：`MarkdownContent.vue` / `MessageBubble.vue`。
3. **历史脏数据迁移**：写一次性脚本，扫 IndexedDB `media_assets` 表所有 `logicalPath` 为空或为 `jc-media://` 模式的行，从 `mediaTaskStore.tasks.resultUrl` 反查回填 `sourceUrl`。回填不了的标 `assetStatus='orphaned'`。
4. **CSP 不变**：Web 端刻意不添加 `jc-media:` 到 CSP。

### 本次能做到什么程度

| 层次 | 内容 | 谁做 |
|------|------|------|
| 前端 | img/video/audio 全覆盖 fallback | ✅ 本次 |
| 前端 | Markdown sanitize 管线替换 | ✅ 本次 |
| 前端 | 历史脏数据迁移脚本 | ✅ 本次 |
| 服务端 | 无需 | — |

---

## E. 🟢 P2（原 P1-4 重评）：`/v1/models` 连接关闭

### 现在是什么情况

两次 `ERR_CONNECTION_CLOSED`，只发生在 `/v1/models` 端点。其他接口（`/v1/images/generations`、`/rh/tasks/...`）都正常。

### v1 方案的应付之处

"观察 1 周再决定后端介入"——CLAUDE.md §1.4 说"遇到 CI 失败先找真实日志，不要猜"，线上也一样。

### 前端能做什么（创可贴）

1. **加单次重试**：`fetchModels()` 中 gateway 调用失败后 sleep 2s 重试一次
2. **降级提示**：`modelCatalogSource === 'cache'` 时 UI 显示"模型列表为本地缓存"
3. **加本地 TTL**：缓存写入时记录时间戳，超过 24h 的缓存不直接用

### 服务端应该做什么（治本）

1. **加 Cache-Control**：模型列表几乎不变，应该 `Cache-Control: public, max-age=1800, stale-while-revalidate=86400`。用户根本不该每次启动都打 `/v1/models`
2. **抓 reset 根因**：`curl -v` 反复打，拿到 TLS 错误码；查 Cloudflare 边缘日志同时间窗口；查 NewAPI 容器日志

### 本次能做到什么程度

| 层次 | 内容 | 谁做 |
|------|------|------|
| 前端 | 重试 + 缓存 TTL + 降级提示 | ✅ 本次 |
| 服务端 | Cache-Control 响应头 | ❌ 另开 issue |
| 服务端 | 抓 reset 根因（curl -v + 日志） | ❌ 另开 issue |

---

## F. 🟢 P2（原 P0-1 重评）：CORS 双头

### 现在是什么情况

`/api/creation/models` 返回两个 `Access-Control-Allow-Origin`，浏览器拒绝。
影响：创作模型列表降级到本地 catalog，但不影响已有功能。

### 为什么降到 P2

用户仍能正常创作（模型在本地 catalog 里有），只是远端模型列表更新不及时。不是阻断性问题。

### 前端能做什么

**什么也做不了**。CORS 是纯服务端问题。前端只能等。

### 服务端需要做什么

1. `curl -I` 确认哪个响应头是重复的
2. Nginx/Worker/rh-adapter 去重，保留最外层
3. 白名单覆盖 `https://jiucaihezi.studio`、`http://localhost:5173`、`tauri://localhost`
4. **OPTIONS preflight 也要修**：`Access-Control-Allow-Methods`、`Access-Control-Allow-Headers`、`Access-Control-Max-Age`
5. 加 CI 检查：每次部署后自动 `curl -I` 验证 CORS 头只有一行

### 本次能做到什么程度

| 层次 | 内容 | 谁做 |
|------|------|------|
| 服务端 | CORS 去重 + preflight 完整治理 + CI 回归 | ❌ 另开 issue |

---

## 补充：v1 方案遗漏的 6 项

### 补充 1：双端账号同步

用户登录后，`media_assets` 元数据应同步到云端。这样：
- 桌面端换电脑 → 画廊不丢
- Web 端清缓存 → 画廊不丢
- Web 端和桌面端看到同一个画廊

**现状**：v1 完全没提。**本次也修不了**——需要云端数据库 + API。另开 issue。

### 补充 2：Web 端登录约束

`feedback_web_login_required.md` 明确"Web 端不登录不准用云端对话"。那创作功能呢？未登录访问 `/api/creation/models` 应该返回 401，而不是现在的 CORS 错。**CORS 错可能掩盖了"应该先要求登录"这个产品流程**。

**现状**：需要产品层面决定。另开 issue。

### 补充 3：非图片资产

创作面板有视频（Veo、可灵、RH 视频）、音频（Suno、ACE-Step）、文档导出。v1 只覆盖了图片。本次前端覆盖全部三类媒体类型的**渲染 fallback**，但**永久存储**对所有类型都一样需要服务端。

### 补充 4：自动化测试

CLAUDE.md §1.3 "验证才算完成"。本次新增：
- **Vitest 单测**：`isTauriRuntime() === false` 分支覆盖 `mediaTaskStore`、`mediaFileReader`
- **手动回归清单**：写进文档，每次发版前跑一遍（直到有 Playwright e2e）

完整 Playwright e2e 测试另开 issue。

### 补充 5：isTauriRuntime() 健壮性

v1 到处用 `isTauriRuntime()`，但没验证这个函数是否可靠。当前实现（`tauriEnv.ts`）：

```ts
export function isTauriRuntime(): boolean {
  return (window as any).isTauri === true
    || typeof (window as any).__TAURI_INTERNALS__ === 'object'
    || '__TAURI__' in (window as any)
}
```

这已经做了多重判定，是 OK 的。但需要加一条：**默认假设是 Web**，错误方向应该是"桌面误判为 Web"（功能降级）而非"Web 误判为桌面"（直接崩）。当前实现已经满足这一点。

### 补充 6：灰度与 rollback

`mediaTaskStore.ts`、`mediaFileWriter.ts`、`mediaFileReader.ts` 全在 CLAUDE.md §15 高风险文件清单里。本次改动加 feature flag：

```ts
// 通过 localStorage 控制，默认开启，出问题可远程关闭
const WEB_REMOTE_ONLY_ENABLED = localStorage.getItem('jc_web_remote_only') !== 'false'
```

构建后先在 `localhost:5173` 验证，再推到生产。

---

## 修订后的改动文件清单

| # | 文件 | 改动 | 风险 |
|:--:|------|------|:--:|
| C | `src/stores/mediaTaskStore.ts` | `isTauriRuntime()` 守卫，`assetStatus='remote-only'`，不伪造 `assetUri` | 🟡 |
| C | `src/utils/mediaFileReader.ts` | `resolveJcMediaUrl` / `resolveForDisplay` 加 Web fallback（`sourceUrl` 优先） | 🟡 |
| C+D | `src/components/chat/display/MarkdownContent.vue` | `<img>/<video>/<audio>` sanitize 后 jc-media: → sourceUrl 替换 | 🟡 |
| C+D | `src/components/media/MediaAssetCard.vue` | `displayUrl` 计算加 `remote-only` 分支 | 🟢 |
| C+D | `src/components/media/MediaViewer.vue` | 同上，大图查看器 | 🟢 |
| D | `src/utils/` 新增 `migrateJcMediaLegacy.ts` | 历史脏数据迁移脚本（一次性） | 🟡 |
| E | `src/stores/agentStore.ts` | `fetchModels()` 加重试 + 缓存 TTL 24h | 🟢 |
| B | `src/main.ts` | `initBackend` Promise 缓存防重入 + 降级时导出 JSON | 🟡 |
| B | `src/utils/idb.ts` | IndexedDB `onblocked` 多 tab 监听 | 🟢 |
| B | `src/layouts/WorkspaceLayout.vue` | 降级 banner 文案分平台 | 🟢 |
| — | `src/stores/mediaTaskStore.ts` | feature flag: `jc_web_remote_only` | 🟢 |

---

## 修订后的执行顺序

```
第 1 轮（本次 webyouhua 分支）：
  C. 创作落地分叉（遵守契约版）        ← 最痛，func 不可用
  D. jc-media:// 渲染 fallback         ← 顺手，共享 mediaFileReader
  D. 历史脏数据迁移脚本                  ← 顺手
  B. boot 防重入 + 降级导出              ← 防数据丢失

第 2 轮（本次或下个分支）：
  E. /v1/models 重试 + TTL             ← 创可贴
  F. CORS 去重（服务端）                ← 需要服务器权限

需另开 issue（不阻塞本次前端）：
  A1. 服务端永久存储桶 + 转储 Worker
  A2. NewAPI /v1/images/generations 响应改造
  G1. 双端账号同步 media_assets
  G2. Web 端登录约束
  G3. Playwright e2e 自动化测试
  G4. 服务端 /v1/models Cache-Control
```

---

## 诚实总结

| 维度 | v1 | v2 |
|------|:--:|:--:|
| 字段契约 | ❌ `assetUri` 塞 HTTP URL | ✅ `assetUri` 留空，走 `sourceUrl` |
| 永久存储 | ❌ "长期规划" | ✅ 前端提示时效，服务端另开 issue |
| 数据抢救 | ❌ 提示关 tab | ✅ 降级时自动导出 JSON 下载 |
| 图片/视频/音频 | ❌ 只提图片 | ✅ 三类全覆盖 |
| 历史脏数据 | ❌ 没提 | ✅ 迁移脚本 |
| 自动化测试 | ❌ 全手动 | ✅ Vitest 单测 + 手动回归清单 |
| 灰度 rollback | ❌ 没提 | ✅ feature flag |
| 双端同步 | ❌ 没提 | ✅ 承认做不到，另开 issue |
| 登录约束 | ❌ 没提 | ✅ 承认遗漏，另开 issue |
| CORS 优先级 | ❌ P0（过高） | ✅ P2（不阻塞功能） |

**一句话**：v2 修了前端能修的所有问题，遵守了数据契约，加了数据抢救。但永久存储、账号同步、CORS、服务端缓存这些根因——诚实地说，需要服务端配合，不在本次前端分支范围内。
