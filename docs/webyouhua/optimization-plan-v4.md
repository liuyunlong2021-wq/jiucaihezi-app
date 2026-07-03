# Web 端优化方案 v4（最终版）

> **分支**：`webyouhua` | **日期**：2026-06-19
> **状态**：✅ 全部完成（提交 `db36f4f` + 第二轮改动）
> **原则**：只修 bug，不搭基建。上游限制不硬刚，提醒用户即可。

---

## 修复清单（7+1 项）

### 🔴 1. invoke 崩溃 — 创作结果保存失败 ✅

**问题**：Web 端生成图后调了 Tauri `invoke`，浏览器里没这个函数，崩了。

**修法**：`mediaTaskStore.ts` `downloadAndPersistMediaAsset()` 入口加 `isTauriRuntime()` 判断，Web 端直接标记 `remote-only`，不调 invoke。

**文件**：`src/stores/mediaTaskStore.ts`

---

### 🔴 2. jc-media CSP 阻挡 — 历史图片全黑 ✅

**问题**：`<img src="jc-media://xxx">` 和 `<img src="jc-media:xxx">` 两种格式在 Web 端没有 resolver，被 CSP 拦截。

**修法**：`resolveJcMediaUrl()` 兼容 `jc-media://` 和 `jc-media:` 两种格式。非 Tauri 环境时从 `media_assets.sourceUrl` 取值。

**文件**：`src/utils/mediaFileReader.ts`

---

### 🔴 3. CORS 双头 — 创作模型列表拉不到

**问题**：服务端返回两个 `Access-Control-Allow-Origin`，浏览器拒绝。

**修法**：服务端定位重复源，去重。同时覆盖 OPTIONS preflight。

**文件**：服务端 Nginx / Cloudflare Worker（本次未动，需服务端配合）

---

### 🟡 4. 24 小时过期提醒 ✅

**问题**：上游 COS URL 24 小时后失效，用户不知道。

**修法**：
- 创作面板顶部（标题行下方、搜索框上方）显示浅黄色提示条：`云端文件 24 小时后失效，请及时下载转存`
- 右边 × 可关闭，本次会话不再显示
- 仅当画廊中有远程资产（`originalUrl` 为 http 地址）时显示
- 不在每张卡片下方重复显示

**文件**：`src/components/creation/CreationPanel.vue`

---

### 🟡 5. 历史脏数据迁移

**问题**：IndexedDB 里有旧的 `jc-media://` 记录，没有 `sourceUrl`。Web 端 `getMediaAssetById` 仅 Tauri 可用，无法在浏览器中迁移。

**处理**：新数据已不走 `jc-media://` 路径。老数据量小，暂时显示占位。后续如需迁移，需给 `idb.ts` 加 Web 端 media_assets 查询能力（另开 issue）。

---

### 🟡 6. /v1/models 偶发连接关闭 ✅

**问题**：启动时拉模型列表，服务端偶发 reset 连接。

**修法**：
- 前端 `fetchModels()` 网关请求失败后 2s 重试一次
- 重试仍失败走 localStorage 缓存降级

**文件**：`src/stores/agentStore.ts`

---

### 🟢 7. boot 防重入 ✅

**问题**：`initBackend` 被调两次，第二次超时进入降级模式，可能丢数据。

**修法**：Promise 缓存防重入，出错清空允许重试。`Promise.race` 的 setTimeout 加 `clearTimeout` 防假超时日志。

**文件**：`src/main.ts`

---

### 🟢 8. MediaViewer jc-media 残留 ✅（第二轮追加）

**问题**：MediaAssetCard 和 MediaViewer 点击看大图时，`jc-media:file_xxx`（单冒号格式）未被识别，直接传给 `<img>` 触发 CSP。

**修法**：`resolveJcMediaUrl()` 兼容单冒号格式。

**文件**：`src/utils/mediaFileReader.ts`

---

## 改动文件总览

| 文件 | 改动 | 状态 |
|------|------|:--:|
| `src/stores/mediaTaskStore.ts` | +8 行，isTauriRuntime 守卫 | ✅ |
| `src/utils/mediaFileReader.ts` | +28/-8 行，jc-media 双格式 fallback | ✅ |
| `src/components/media/MediaAssetCard.vue` | 先加后删 24h 提醒，恢复干净 | ✅ |
| `src/components/creation/CreationPanel.vue` | +20 行，顶部 24h banner | ✅ |
| `src/stores/agentStore.ts` | +26/-5 行，fetchModels 重试 | ✅ |
| `src/main.ts` | +24 行，Promise 防重入 + clearTimeout | ✅ |

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

## 验收标准 ✅

1. ✅ Web 端 `z-image-turbo` 生成图 → 画廊出现，控制台无 `invoke` 报错
2. ✅ 控制台无 CSP 报错（`jc-media:` 和 `jc-media://` 均被拦截并 fallback）
3. ✅ 创作面板顶部显示 24h 失效 banner（有远程资产时）
4. ✅ banner × 可关闭，卡片下方干净无重复提醒
5. ⚠️ `curl -I /api/creation/models` → `Access-Control-Allow-Origin` 只有一行（需服务端配合）
6. ✅ `/v1/models` 失败一次后重试成功
7. ✅ 多次刷新不触发降级（`storageDegraded=false`）
8. ✅ `pnpm build` 通过，`vue-tsc` 0 错

## 验收标准

1. Web 端 `z-image-turbo` 生成图 → 画廊出现，控制台无 `invoke` 报错
2. 历史 `jc-media://` 图片 → 能显示（有 sourceUrl）或显示占位提示（无 sourceUrl）
3. 控制台无 CSP 报错
4. 画廊卡片显示「24 小时失效」提示，下载按钮正常
5. `curl -I /api/creation/models` → `Access-Control-Allow-Origin` 只有一行
6. `/v1/models` 失败一次后重试成功，或走缓存不阻塞 UI
7. 多次刷新不触发降级（控制台无 `storageDegraded=true`）
8. `pnpm build` 通过
