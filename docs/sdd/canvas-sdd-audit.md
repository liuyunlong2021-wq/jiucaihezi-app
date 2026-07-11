# 画布 SDD v2 — 代码审计

> **日期**: 2026-07-11
> **审计范围**: SDD v2 方案 + 现有 `CreationPanel.vue` + `mediaTaskStore.ts`

---

## 一、总体评价：✅ 可行

SDD 核心思路（只替换 `cp-gallery-zone` 一个 div）与现有代码完全兼容。现有 flex 布局天然支持此改动。以下按风险等级列出发现。

---

## 二、🔴 必须修复（阻塞实施）

### 2.1 生成完成回调拿不到本地路径

**SDD 说**：`media-task-complete` 事件 → `canvasStore.addLayer({ path })`

**实际**：`media-task-complete` payload 只有 `{ taskId, type, url, source, model, prompt }`——`url` 是**远程 URL**（如 `https://xxx.cos.xxx/xxx.png`），不是 `jc-media/images/xxx.png` 本地路径。

```ts
// mediaTaskStore.ts:549
emitEvent('media-task-complete', {
  taskId: task.id, type: task.type, url: safeMediaUrl,  // ← 远程 URL
  source: task.source, chatMessageId: task.chatMessageId,
  model: task.modelLabel, prompt: task.prompt,
})
```

**修复**：监听 `media-task-settled`（成功后 `task.assetUri` 已设置），从 `mediaTaskStore.tasks` 按 `taskId` 找到 task，读 `task.assetUri`：

```ts
// 正确做法：
const offTaskComplete = onEvent('media-task-settled', (payload: any) => {
  if (payload.source !== 'creation' || payload.status !== 'success') return
  const task = mediaTaskStore.tasks.find(t => t.id === payload.taskId)
  if (!task?.assetUri || task.type !== 'image') return  // 只处理图片
  canvasStore.addLayer({ path: task.assetUri, ... })
})
```

**影响**：SDD 步骤 3（生成→画布）的实现需要调整，但逻辑不变，估时不变。

### 2.2 拖放事件冲突

**SDD 说**：画布容器内 `@drop` → 复制到 jc-media/

**实际**：`.cp` 根元素已有 `@drop.prevent.stop="onFileDrop"`——**会吃掉所有子元素的 drop 事件**。

```html
<div class="cp" @drop.prevent.stop="onFileDrop">  ← 拦截所有 drop
  <div class="cp-canvas-zone">
    <div ref="canvasContainer" />  ← 画布的 drop 事件被父元素拦截
  </div>
</div>
```

**修复**：将画布容器的 drop 处理放到父级 `.cp` 的 `onFileDrop` 中，判断 drop 目标是否在画布区域内：

```ts
function onFileDrop(e: DragEvent) {
  // 如果 drop 在画布区域内 → 走画布逻辑
  if (canvasContainer.value?.contains(e.target as Node)) {
    handleCanvasDrop(e)
    return
  }
  // 否则走原有逻辑（添加到参考文件）
  if (!e.dataTransfer?.files.length) return
  addFiles(e.dataTransfer.files)
}
```

**影响**：需要在 `onFileDrop` 中加判断分支，不改原有行为。

---

## 三、🟡 建议改进（不阻塞，但应处理）

### 3.1 画布容器 overflow 冲突

`.cp-gallery-zone` 当前是 `overflow: hidden`。如果画布容器也设 `overflow: hidden`，没问题。但如果残留了 `overflow-y: auto`（任务列表的滚动），LeaferJS 的滚轮缩放会失效。

**建议**：画布容器显式设置 `overflow: hidden`，不要继承 `cp-gallery-zone` 的任何 overflow 样式。

### 3.2 进度条位置

SDD 把进度浮层画在画布左下角。但现有的 `.cp-progress-bar` 和 `.cp-progress-text` 在 `cp-params` 下面、`cp-composer` 上面——不在 `cp-gallery-zone` 里。所以它们**不受影响**，也不需要挪。SDD 画布左下角的进度浮层是**额外的**。

**建议**：Phase 0 先不写画布内进度浮层，用现有的 `.cp-progress-bar`（在 params 下方）。它仍然工作，因为 `creationRunningCount` 和 `creationProgress` 不受 cp-gallery-zone 替换影响。

### 3.3 历史 Modal 内容重复

SDD 说「历史 Modal 里搬原任务列表代码」。这意味着同一套代码在 Modal 里再写一遍。**更干净的做法**：把任务列表抽取为独立组件 `<TaskHistoryList>`，在 Modal 里复用，而不是复制粘贴。

**建议**：Phase 0 先复制（快），Phase 1 再抽取组件（干净）。

### 3.4 非图片媒体不入画布

视频生成、音频生成的结果不应该出现在画布上。`canvasStore.addLayer()` 需要判断 `task.type === 'image'`。

**实际**：媒体类型判断很简单，SDD 步骤 3 实现时加一行 `if (task.type !== 'image') return`。

### 3.5 jc-media/ 路径 vs Tauri asset protocol

当前图片用 `jc-media://{assetId}` 协议访问（走 Tauri asset resolver）。但 LeaferJS 的 `Image` 元素需要真实文件路径或 HTTP URL。

**检查**：`task.assetUri` 在项目文件夹模式下是真实路径（如 `/Users/xxx/project/jc-media/images/xxx.png`），在无项目模式下是 `jc-media://xxx`。

**修复**：Phase 0 先只支持项目文件夹模式（有真实路径）。无项目模式降级用远程 URL。

---

## 四、🟢 确认无问题

| 项目 | 结论 |
|------|------|
| flex 布局兼容 | `.cp` 是 `flex-direction: column`，中间区域 `flex: 1`，替换为画布完全兼容 |
| LeaferJS Canvas 元素 | LeaferJS 在容器 div 内创建 `<canvas>`，不干扰外部 CSS |
| Editor 插件 | 不影响 CreationPanel 的其他交互（popover、按钮等） |
| Viewport 插件 | 只在 canvas 元素内拦截 wheel 事件，不阻止外部滚动 |
| 面板切换（v-show） | `CreationPanel` 由 `WorkspaceLayout` 的 `v-if/else-if` 控制，切走时 `onBeforeUnmount` 触发保存 |
| 依赖体积 | leafer-ui 70KB + editor/viewport 各 ~15KB ≈ 100KB，远低于 500KB 的 tldraw |
| 现有进度条不受影响 | `.cp-progress-bar` 在 `cp-params` 下方，不在 `cp-gallery-zone` 内 |
| `cp-composer` 不受影响 | 在最底部，与画布容器并列 flex 子元素 |
| 拖放高亮（`.cp-drag-over`） | 仍然作用于 `.cp-composer`，不影响画布 |

---

## 五、SDD 缺失项

| 缺失 | 严重度 | 建议 |
|------|--------|------|
| 项目切换时画布行为 | 🟡 | 切换项目 → 重新加载不同 `canvasId` 的 JSON。SDD §7 提到但没写实现细节。Phase 0 先硬编码一个 canvasId。 |
| 无项目目录的降级 | 🟡 | Web 端或未选项目时，`writeProjectMedia` 走不进项目路径，`assetUri` 是 `jc-media://`。Phase 0 先不支持此场景。 |
| 拖入非图片文件 | 🟢 | 忽略即可，不影响 |
| 大量图片时的内存 | 🟢 | LeaferJS 100万元素 320MB，正常使用几十张图完全没问题 |
| 粘贴非图片内容 | 🟢 | 忽略即可 |

---

## 六、修订后的 SDD 步骤 3 细节

```ts
// CreationPanel.vue onMounted 追加：
import { useCanvasStore } from '@/components/canvas/canvasStore'

const canvasStore = useCanvasStore()

// 监听生成完成 → 入画布
const offTaskSettled2 = onEvent('media-task-settled', (payload: any) => {
  if (payload.source !== 'creation' || payload.status !== 'success') return
  // 延迟一帧，确保 assetUri 已写入
  nextTick(() => {
    const task = mediaTaskStore.tasks.find(t => t.id === payload.taskId)
    if (!task?.assetUri || task.type !== 'image') return
    canvasStore.addLayer({
      path: task.assetUri,
      source: 'creation',
      model: task.modelLabel || '',
      prompt: task.prompt || '',
    })
  })
})
```

---

## 七、结论

**SDD v2 方案可行，有 2 个必须修复的问题，都不影响核心设计。**

| | 问题 | 修复 | 估时影响 |
|---|------|------|---------|
| 🔴 | `media-task-complete` 无本地路径 | 改用 `media-task-settled` + 读 `task.assetUri` | 无 |
| 🔴 | drop 事件被 `.cp` 根元素拦截 | `onFileDrop` 中判断目标区域分流 | +15min |
| 🟡 | 历史 Modal 复制代码 | Phase 0 先复制 | 无 |

SDD 整体从 4-5h 调整为 4.5-5.5h。可以开始实施。
