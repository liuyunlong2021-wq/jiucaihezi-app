# 创作面板音频预览 & 复制 URL — 交接文档

> **写给下一个 AI 协作者**：只差最后两个问题，读完即可动手。
>
> **撰写日期**：2026-06-21
> **撰写者**：GitHub Copilot (DeepSeek V4 Pro)
> **当前分支**：`media-creation-optimization`
> **剩余问题**：① 画廊点击音频卡片无法预览播放 ② 点「复制 URL」显示"该资产没有可分享的源 URL"

---

## 0. 已完成的工作（不要重复做）

| 问题 | 状态 | 修复方式 |
|------|:--:|------|
| RH AI App 参数注入 | ✅ | 前端 `voice` 字段编码 nodeInfoList，rh-adapter `audio.py` 恢复 |
| 语言字段不显示 | ✅ | 重启后正常 |
| 多余 prompt 输入框 | ✅ | `showPromptInput` 控制显隐 |
| 下载按钮拦截 | ✅ | `isAllowedDownloadUrl` 加 `asset://` 正则 + `downloadMediaAsset` 解析 `jc-media://` |
| 服务器 rh-adapter 部署 | ✅ | `audio.py` 已部署到 `47.82.86.196:/opt/rh-adapter/` |

---

## 1. 两个剩余问题

### 问题 ①：点击音频卡片无法预览播放

**卡住点**：`openAssetViewer` 依赖 `asset.displayUrl`，来自 `resolvedGalleryAssets`（内存缓存不持久化，重启清空）。fallback 用 `asset.taskId` 去 `cpState.results` 匹配，但 `cpState.results` 没有新结果条目。

### 问题 ②：复制 URL 显示"该资产没有可分享的源 URL"

**已验证**：`media_assets` 表有正确的 `sourceUrl`：
```json
{
  "id": "jcma_mqnv7bdg_kw779j",
  "sourceId": "mtask_mqnv6dit_7saw",
  "sourceUrl": "https://rh-images.xiaoyaoyou.com/.../ComfyUI_00001_fmacn_1782051074.flac"
}
```
**卡住点**：`asset.originalUrl` 为空，`asset.localRef` 为空，`sourceId` fallback 也因 `cpState.results` 没有数据而无法匹配。

---

## 2. 核心阻塞点：`cpState.results` 没有新结果

```js
// 控制台确认
JSON.stringify(__jc_gallery.results.map(r => ({ taskId: r.taskId, url: r.url?.slice(0,40), type: r.type })))
// → [{"url":"","type":"failed"}]  只一条旧记录！
```

### 预期链路

```
任务完成 → emitEvent('media-task-settled')
  → 监听器 → mediaTaskStore.getTask(taskId) → addSettledCreationTaskToGallery(task)
    → upsertCreationResultFromTask → cpState.results.unshift(newResult)
    → cacheCreationMediaResult → 下载到本地
    → saveCpState()
```

### 已排除

- ❌ `task.type !== 'text'` 检查（audio 通过）
- ❌ `task.resultUrl` 为空（下载成功）
- ❌ `isAllowedCreationResultUrl` 拒绝（域名在白名单）
- ❌ `hasGalleryRecordForTask` 误匹配（旧结果无 taskId）

### 待确认

已加诊断日志 `console.log('[addSettledCreationTaskToGallery] called', ...)`。重启后提交 voice-design，控制台搜 `addSettledCreationTaskToGallery`。

---

## 3. 关键文件

| 文件 | 行号 | 函数 |
|------|------|------|
| `src/components/creation/CreationPanel.vue` | ~263 | `addSettledCreationTaskToGallery` — 结果入库 |
| `src/components/creation/CreationPanel.vue` | ~460 | `offTaskSettled` 事件监听 |
| `src/components/creation/CreationPanel.vue` | ~1122 | `openAssetViewer` — 预览 |
| `src/components/creation/CreationPanel.vue` | ~1230 | `copyMediaAssetUrl` — 复制 URL |
| `src/utils/mediaFileReader.ts` | ~177 | `resolveJcMediaUrl` — jc-media:// 解析 |
| `src/utils/mediaFileReader.ts` | ~85 | `resolveForDisplay` — convertFileSrc |
| `src/utils/creationMediaCache.ts` | ~163 | `resolveCreationMediaUrl` — 已改为走 mediaFileReader |
| `src/utils/urlSafety.ts` | ~56 | `isAllowedDownloadUrl` — 已加 `asset:` 放行 |
| `src/utils/idb.ts` | — | `getMediaAssetById`、`getAll('media_assets')` |

---

## 4. 推荐修复顺序

1. **先跑诊断**：重启 → 提交 voice-design → 看控制台 `addSettledCreationTaskToGallery` 日志
2. **如果函数被调用**：查哪个条件拦住了，修复入库链路
3. **如果函数没被调用**：查 `offTaskSettled` 事件链路
4. **入库修复后**：`openAssetViewer` 和 `copyMediaAssetUrl` 的当前代码应自动工作

### 备选方案（如果入库链路短时间修不好）

预览和复制 URL 绕过 `cpState.results`，直接按 `asset.taskId` 查 `media_assets` 表取 `sourceUrl`。

---

## 5. 不要动的已修复部分

- 参数注入（`voice` 字段编码 / `audio.py` 恢复）
- 下载按钮拦截修复（`isAllowedDownloadUrl`、`downloadMediaAsset`）
- `isLocalMediaRef` 兼容 `jcma_` 格式
- `resolveCreationMediaUrl` 改为走 `mediaFileReader`
- 语言字段、多余 prompt 隐藏
