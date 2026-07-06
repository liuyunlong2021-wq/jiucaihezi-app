# SDD: 创作面板 — 画廊替换为分页任务列表

> **状态**: 待实施 | **日期**: 2026-07-03 | **分支**: pingguo-inter

---

## 1. 动机

### 问题
- 画廊维护三套索引（`cpState.results` + `mediaTaskStore.tasks` + `media_assets`），复杂且重复写入
- 画廊与项目文件夹脱节：切项目画廊不刷新，全局 `localStorage` 不隔离
- 自定义预览器（MediaViewer）维护成本高

### 目标
- 画廊 → **分页任务列表**，数据源单一：`mediaTaskStore.tasks`
- 预览直接用系统默认程序（`shell.open`）
- `.cp-params` + `.cp-composer` 完全不动

---

## 2. 设计

### 2.1 布局

```
┌─ .cp ────────────────────────────────────────────────────┐
│  .cp-toolbar         创作面板          [提示词参考]       │
│  .cp-expiry-banner   (v-if)                              │
├─ .cp-gallery-zone ───────────────────────────────────────┤
│  .cp-generation-status  (v-if 有进行中任务)               │
│                                                          │
│  .cp-task-list                                           │
│    .cp-task-item   (v-for creationTasks, 分页切片)        │
│      ✅ 2026-07-03 15:22:24                               │
│         一只猫在窗台上晒太阳 · FLUX.1-pro                  │
│         jc-media/images/xxx.png                           │
│         [预览] [打开文件夹]                                │
│    ...                                                   │
│                                                          │
│  .cp-task-pagination    20条/页  [<] 1/12 [>]  共221条   │
├─ .cp-params ─────────────────────────────────────────────┤  ← 不动
├─ .cp-composer ───────────────────────────────────────────┤  ← 不动（textarea 自适应）
└──────────────────────────────────────────────────────────┘
```

### 2.2 任务列表数据源

```typescript
const creationTasks = computed(() =>
  mediaTaskStore.tasks
    .filter(t => t.source === 'creation')
    .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt))
)
```

按完成时间倒序，全部显示（无上限）。

### 2.3 分页

```
[每页 20▼] [<] [1 / 12] [>] 共 221 条
```

- 可选每页条数：10 / 20 / 50 / 100
- 默认 20
- 上一页 / 当前页-总页数 / 下一页
- 总条数

### 2.4 每条任务显示

| 元素 | 数据来源 |
|------|---------|
| 状态图标 | `status: 'running'→⏳ 'success'→✅ 'failed'→❌ 'cancelled'→⊘` |
| 时间 | `formatTime(task.completedAt \|\| task.createdAt)` → `YYYY-MM-DD HH:mm:ss` |
| 提示词 | `task.prompt` 截断 80 字符 |
| 模型名 | `task.modelLabel` |
| 文件路径 | `task.assetUri`（已落地）或 `task.resultUrl`（远程） |
| [预览] | `shell.open(task.assetUri)` — 系统默认程序 |
| [打开文件夹] | `shell.open(dirname(task.assetUri))` — Finder |

按钮纯文字，**无图标**。

### 2.5 预览逻辑

```
[预览] 点击:
  desktop → shell.open(assetUri) → macOS Preview.app / Windows 照片
  web     → window.open(resultUrl)

[打开文件夹] 点击:
  desktop → shell.open(dirname(assetUri)) → Finder
  web     → 不显示
```

---

## 3. 改动清单

### 3.1 模板改动（`CreationPanel.vue`）

| 区域 | 行号 | 操作 |
|------|------|------|
| `.cp-gallery-zone` 内 `.cp-media-library` | 1552-1616 | **替换**为 `.cp-task-list` + `.cp-task-pagination` |
| `.cp-generation-status` | 1542-1551 | **保留** |
| `.cp-context-menu` | 1619-1630 | **删除**（画廊右键菜单） |
| `MediaViewer` × 2 | 1633-1689 | **删除**（不再需要自定义预览器） |
| `.cp-params` | 1692-1835 | **不动** |
| `.cp-progress-bar` + `.cp-progress-text` | 1838-1842 | **不动** |
| `.cp-composer` | 1845-1907 | **不动** |

### 3.2 脚本改动（`CreationPanel.vue`）

**删除**：
- 画廊相关 import：`MediaViewer`, `MediaAssetCard`, `mediaDisplayAsset*`, `creationMediaCache`, `fileEntryFilters`, `mediaDisplayResolver`, `mediaThumbnail`, `mediaDisplayAsset`, `useMediaAssetStore`, `MediaAssetRow`
- 画廊相关变量/函数：`mediaLibrarySearch/filter/tabs/assets`, `combinedMediaLibraryAssets`, `filteredMediaLibraryAssets`, `visibleMediaLibraryAssets`, `hasMoreMediaLibraryAssets`, `loadMoreMediaAssets`, `refreshMediaLibraryAssets`, `openAssetViewer`, `closeAssetViewer`, `assetViewer*`, `downloadMediaAsset`, `referenceMediaAsset`, `copyMediaAssetUrl`, `deleteMediaAsset`, `regenerateMediaAsset`, `sendMediaAssetToCanvas`, `openMediaImport`, `onMediaImportSelect`, `mediaImportInput`
- 旧画廊函数：`addFailureCard`, `hasGalleryRecordForTask`, `upsertCreationResultFromTask`, `addSettledCreationTaskToGallery`, `reconcileCreationTasksToGallery`, `ensureGalleryResultResolved`, `resolvedGalleryAssets`
- 旧 lightbox：`lbShow`, `lbResult`, `lbIndex`, `lbPosition`, `lbTotal`, `openLightbox`, `closeLightbox`, `lbDownload`, `lbPrev`, `lbNext`, `displayUrl`, `galleryResolveStatus`, `galleryResolveError`, `lbMediaAsset`
- 旧 ctxMenu：`ctxMenu` 全部
- `resultMetaLine`, `channelLabelForModel`

**新增**：
- `formattedCreationTasks` computed（过滤 + 排序）
- 分页状态：`taskPageSize`, `taskPage`, `totalTaskPages`, `pagedTasks`
- `formatTaskTime(ts)` 函数
- `previewTask(task)` 函数 → `shell.open(assetUri)`
- `openTaskFolder(task)` 函数 → `shell.open(dirname(assetUri))`

**保留**：
- `creationActiveTasks`, `creationRunningCount`, `creationProgressText`, `creationProgress`
- 模型/参数相关 computed
- `runCreationViaTaskStore`
- `offTaskSettled`（改为只更新 counter，不写画廊）
- `onMounted`（精简，不调画廊相关）

### 3.3 样式改动

**删除**：
- `.cp-media-library*` 全部
- `.cp-media-*` 全部
- `.cp-result-meta-line`
- `.cp-context-menu`

**新增**：
- `.cp-task-list` — 任务列表容器（flex column, overflow-y auto）
- `.cp-task-item` — 单条任务
- `.cp-task-item.running` / `.success` / `.failed` — 状态色
- `.cp-task-time` — 时间戳
- `.cp-task-prompt` — 提示词文字
- `.cp-task-path` — 文件路径
- `.cp-task-actions` — 操作按钮行
- `.cp-task-actions button` — 纯文字按钮（无图标）
- `.cp-task-pagination` — 分页栏
- `.cp-prompt-input` 加 `field-sizing: content` — 自适应高度

### 3.4 `useCreation.ts` 改动

不动。`cpState` 的参数状态保留（模型/比例/分辨率等），只是画廊相关的结果字段不再被 `CreationPanel` 消费。清理可以后续单独做。

---

## 4. 验证

- `vue-tsc -b` 零错误
- 生图后任务列表实时出现
- 分页切换正常
- [预览] 按钮 macOS 调用 Preview.app
- [打开文件夹] 按钮 macOS 打开 Finder
- `.cp-params` 和 `.cp-composer` 完全不受影响
