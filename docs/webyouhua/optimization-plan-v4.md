# Web 端优化方案 v4（最终版）

> **分支**：`webyouhua` | **日期**：2026-06-19
> **原则**：只修 bug，不搭基建。上游限制不硬刚，提醒用户即可。

---

## 修复清单（7 项）

### 🔴 1. invoke 崩溃 — 创作结果保存失败

**问题**：Web 端生成图后调了 Tauri `invoke`，浏览器里没这个函数，崩了。

**修法**：`mediaTaskStore.ts` `downloadAndPersistMediaAsset()` 入口加一行判断，Web 端直接标记 `remote-only`，不调 invoke。

**文件**：`src/stores/mediaTaskStore.ts`

---

### 🔴 2. jc-media CSP 阻挡 — 历史图片全黑

**问题**：`<img src="jc-media://xxx">` 在 Web 端没有 resolver，被 CSP 拦截。

**修法**：渲染层检测到 `jc-media://` 且非 Tauri 环境时，自动取 `sourceUrl` 显示。覆盖 img / video / audio。

**文件**：`src/utils/mediaFileReader.ts`、`MarkdownContent.vue`、`MediaAssetCard.vue`、`MediaViewer.vue`

---

### 🔴 3. CORS 双头 — 创作模型列表拉不到

**问题**：服务端返回两个 `Access-Control-Allow-Origin`，浏览器拒绝。

**修法**：服务端定位重复源，去重。同时覆盖 OPTIONS preflight。

**文件**：服务端 Nginx / Cloudflare Worker

---

### 🟡 4. 24 小时过期提醒

**问题**：上游 COS URL 24 小时后失效，用户不知道。

**修法**：画廊卡片上已有的信息区加一行灰色提示文字：

> 文件仅在云端保留 24 小时，请及时下载转存。

不改组件结构，不新增按钮（现成下载按钮直接用）。

**文件**：`MediaAssetCard.vue` 或 `CreationPanel.vue`

---

### 🟡 5. 历史脏数据迁移

**问题**：IndexedDB 里有旧的 `jc-media://` 记录，没有 `sourceUrl`，修完 bug 2 后仍是黑图。

**修法**：启动时扫 `media_assets` 表，反查 `mediaTaskStore` 回填 `sourceUrl`。分批跑，不卡 UI。回填不了的标 `orphaned`，显示占位。

**文件**：新增 `src/utils/migrateJcMediaLegacy.ts`

---

### 🟡 6. /v1/models 偶发连接关闭

**问题**：启动时拉模型列表，服务端偶发 reset 连接。

**修法**：
- 服务端加 `Cache-Control: public, max-age=1800, stale-while-revalidate=86400`
- 前端 `fetchModels()` 失败后重试 1 次
- 缓存过期时 UI 标注"模型列表为本地缓存"

**文件**：`src/stores/agentStore.ts` + 服务端配置

---

### 🟢 7. boot 防重入

**问题**：`initBackend` 被调两次，第二次超时进入降级模式，可能丢数据。

**修法**：Promise 缓存防重入，出错清空允许重试。`initDB` 同样保护。

**文件**：`src/main.ts`

---

## 不改的（有明确理由）

| 项目 | 不改的理由 |
|------|-----------|
| 永久存储桶（R2/COS） | 上游 COS 24h 限制我们改不了，提醒用户下载即可 |
| 云端账号同步 | 另开产品需求，不是 bug 修复 |
| 远程灰度系统 | localStorage 开关够用，出问题直接回滚构建 |
| Sentry / Analytics | 已知技术债务（CLAUDE.md §17），不混入本次 |
| Playwright e2e | 另开工程，本次不加 |
| 48h 观察 SLA | 日常监控的事，不写成强制流程 |
| 双端账号同步 | 产品需求，不是 bug |

---

## 验收标准

1. Web 端 `z-image-turbo` 生成图 → 画廊出现，控制台无 `invoke` 报错
2. 历史 `jc-media://` 图片 → 能显示（有 sourceUrl）或显示占位提示（无 sourceUrl）
3. 控制台无 CSP 报错
4. 画廊卡片显示「24 小时失效」提示，下载按钮正常
5. `curl -I /api/creation/models` → `Access-Control-Allow-Origin` 只有一行
6. `/v1/models` 失败一次后重试成功，或走缓存不阻塞 UI
7. 多次刷新不触发降级（控制台无 `storageDegraded=true`）
8. `pnpm build` 通过
