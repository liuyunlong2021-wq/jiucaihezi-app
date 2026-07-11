# 韭菜盒子画布 — 软件设计文档 (SDD) v2

> **版本**: v2.0（画布嵌入创作面板）
> **日期**: 2026-07-11
> **分支**: `0711-canvas`
> **引擎**: LeaferJS v2.2.0 + `@leafer-in/editor` + `@leafer-in/viewport`
> **前置裁决**: `docs/sdd/canvas-engine-verdict.md`

---

## 目录

1. [产品形态](#1-产品形态)
2. [布局集成：只动一个 div](#2-布局集成只动一个-div)
3. [画布 ↔ jc-media 联动](#3-画布--jc-media-联动)
4. [Phase 0：跑通（当前阶段）](#4-phase-0跑通当前阶段)
5. [Phase 1+：自定义工具（后续）](#5-phase-1自定义工具后续)
6. [组件与数据流](#6-组件与数据流)
7. [画布持久化](#7-画布持久化)
8. [文件变更清单](#8-文件变更清单)
9. [验证标准](#9-验证标准)

---

## 1. 产品形态

### 1.1 一句话

**画布嵌入创作面板，替代中间的空任务列表区域。创作面板功能零损失。**

### 1.2 布局（对齐当前 CreationPanel）

```
┌──────────────────────────────────┐
│ 🎬 创作面板          📋历史 💡提示词│  ← cp-toolbar：+📋按钮
├──────────────────────────────────┤
│                                  │
│                                  │
│     LeaferJS 无限画布             │  ← 🆕 替代 cp-gallery-zone
│     · 生成图片自动出现            │    右侧留 48px 空白（工具预留位）
│     · 拖入/粘贴图片              │
│     · 滚轮缩放 + 拖拽平移        │
│     · 选中/移动/缩放图片          │
│                                  │
│                                  │
├──────────────────────────────────┤
│ [任务▼] [模型▼] [渠道] [模式]      │  ← cp-params 完全不动
│ [比例▼] [分辨率] [时长]           │
├──────────────────────────────────┤
│ [📎] 描述你想生成的内容...    [↑]  │  ← cp-composer 完全不动
└──────────────────────────────────┘
```

### 1.3 改动范围

| 区域 | 改什么 |
|------|--------|
| `cp-toolbar` | 加一个「📋 历史」按钮，点击弹出 Modal 显示任务列表 |
| `cp-gallery-zone` | **整个 div 替换**为画布容器 |
| `cp-params` | **不改** |
| `cp-composer` | **不改** |
| 右侧竖排工具栏 | **Phase 0 不写**，只留 48px 空白边距占位 |

### 1.4 历史任务怎么看

「📋 历史」按钮弹出 Modal，里面就是原来 `cp-gallery-zone` 里的任务列表（分页、状态、预览按钮）。代码几乎可以原样搬进去。

---

## 2. 布局集成：只动一个 div

### 2.1 CreationPanel.vue 改动

```diff
// cp-toolbar 加一个按钮：
  <div class="cp-toolbar">
    <span class="cp-title">...</span>
    <span class="cp-toolbar-spacer" />
+   <button class="cp-toolbar-link" @click="showTaskHistory = true">
+     <JcIcon name="history" />
+     <span class="cp-toolbar-link-text">历史</span>
+   </button>
    <button class="cp-toolbar-link" @click="openExternal('...')">
      ...
    </button>
  </div>

// cp-gallery-zone 替换为画布容器：
- <div class="cp-gallery-zone">
-   <!-- 原来整个任务列表/空状态/进度条 -->
- </div>
+ <div class="cp-canvas-zone">
+   <div ref="canvasContainer" class="cp-canvas-container" />
+   <!-- 进度浮层（生成时显示，叠在画布左下角） -->
+   <div v-if="creationRunningCount > 0" class="cp-canvas-progress">
+     <JcIcon name="sync" />
+     <span>{{ creationProgressText }}</span>
+     <div class="cp-canvas-progress-bar">
+       <i :style="{ width: creationProgress + '%' }" />
+     </div>
+   </div>
+ </div>

// 历史 Modal（Teleport 到 body）
+ <Teleport to="body">
+   <div v-if="showTaskHistory" class="cp-history-overlay" @click.self="showTaskHistory = false">
+     <div class="cp-history-modal">
+       <!-- 原来 cp-gallery-zone 的任务列表原样搬进来 -->
+     </div>
+   </div>
+ </Teleport>
```

### 2.2 CSS 关键约束

```css
.cp-canvas-zone {
  flex: 1;
  min-height: 0;
  position: relative;
}

.cp-canvas-container {
  width: 100%;
  height: 100%;
}
```

### 2.3 画布初始化（onMounted 追加）

```ts
import { Leafer, Image as LeaferImage } from 'leafer-ui'
import { Editor } from '@leafer-in/editor'
import { Viewport } from '@leafer-in/viewport'

const canvasContainer = ref<HTMLDivElement>()
let leafer: Leafer | null = null

onMounted(() => {
  if (!canvasContainer.value) return

  leafer = new Leafer({
    view: canvasContainer.value,
    type: 'design',
    fill: '#fafaf8',
  })
  new Editor({ target: leafer })
  new Viewport({ target: leafer })
  
  // 恢复上次画布状态
  restoreCanvasState()
})

onBeforeUnmount(() => {
  saveCanvasState()
  leafer?.destroy()
})
```

---

## 3. 画布 ↔ jc-media 联动

### 3.1 核心原则

```
jc-media/ 是唯一真源（不动）。
画布 JSON 只存元数据（图层位置/缩放），引用 jc-media/ 的文件路径。
```

### 3.2 自动同步流程（方案 A）

```
创作面板点生成
  → media-generation.ts 下载图片
  → 写入 {projectDir}/jc-media/images/{filename}.png   ← 唯一真源
  → mediaTaskStore 任务完成回调
  → canvasStore.addLayer({ path: 'jc-media/images/{filename}.png' })
  → LeaferJS 画布上出现图片（偏移放置）

用户拖图片到画布
  → 读取文件 → 复制到 jc-media/images/{uuid}.png       ← 也进唯一真源
  → canvasStore.addLayer()

用户粘贴截图到画布
  → clipboard blob → 保存到 jc-media/images/{uuid}.png  ← 也进唯一真源
  → canvasStore.addLayer()

下次打开项目
  → 读取 .jiucaihezi/canvas/{canvasId}.json
  → 恢复所有图层
```

### 3.3 画布 JSON 结构

保存位置：`{projectDir}/.jiucaihezi/canvas/{canvasId}.json`

```json
{
  "version": 1,
  "canvasId": "proj_abc",
  "updatedAt": 1710700000000,
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "layers": [
    {
      "id": "uuid-1",
      "path": "jc-media/images/generated_001.png",
      "x": 120, "y": 200,
      "width": 1024, "height": 1024,
      "label": "猫猫图",
      "source": "creation",
      "model": "gpt-image-2",
      "prompt": "一只可爱的猫"
    }
  ],
  "annotations": []
}
```

---

## 4. Phase 0：跑通（当前阶段）

### 目标

```
✅ LeaferJS 画布在创作面板中间正常显示
✅ 生成图片自动出现在画布上
✅ 拖入/粘贴图片到画布
✅ 选中、移动、缩放图片（Editor 插件自带）
✅ 滚轮缩放 + 拖拽平移画布（Viewport 插件自带）
✅ 「📋 历史」按钮弹出原任务列表
✅ 画布状态持久化（切换面板/重启APP不丢失）
```

### 步骤

| # | 步骤 | 估时 |
|---|------|------|
| 1 | `pnpm add leafer-ui @leafer-in/editor @leafer-in/viewport` | 1min |
| 2 | `CreationPanel.vue`：`cp-gallery-zone` → 画布容器 + 初始化 | 30min |
| 3 | 生成完成 → `canvasStore.addLayer()` → 图片入画布 | 1h |
| 4 | 拖入/粘贴 → 复制到 jc-media/ → addLayer | 1h |
| 5 | 「📋 历史」Modal（搬原任务列表代码） | 30min |
| 6 | 持久化：保存/恢复画布 JSON | 1h |
| 7 | 样式微调（背景色、进度浮层） | 30min |

**总计：约 4-5 小时实际编码**

### 新增文件

```
src/components/canvas/
├── CanvasContainer.vue       # 画布 Vue 壳（初始化 + 事件 + 生命周期）
├── canvasStore.ts            # Pinia store（layers + 持久化）
└── canvasPersistence.ts      # JSON 读写 + jc-media 文件操作

src/types/canvas.ts           # CanvasLayer, CanvasAnnotation 类型
```

### 修改文件

```
src/components/creation/CreationPanel.vue  # cp-gallery-zone → 画布 + 历史 Modal
package.json                                # +3 个依赖
```

**不需要**：
- ❌ 不改 Rail
- ❌ 不改 WorkspaceLayout
- ❌ 不改 Rust 端
- ❌ 不改 i18n（Phase 0 用中文硬编码）

---

## 5. Phase 1+：自定义工具（后续）

Phase 0 不写任何自定义工具。右侧 48px 空白是预留位。

| 优先级 | 工具 | 依赖 | 复杂度 |
|--------|------|------|--------|
| P1 | 🖌 标注修图 | LeaferJS Arrow/Pen/Text 元素 | 低 |
| P1 | ✂ 去背景 | NewAPI GPT-image-2 编辑模式 | 中 |
| P2 | ⬛ 扩图 | NewAPI outpainting | 中 |
| P2 | 📝 文字改写 | GPT-4V OCR + GPT-image-2 | 中 |
| P3 | 🧩 图层分离 | GPT-image-2 分割 | 高 |
| P3 | 🎨 模板面板 | Vue 表单组件 + NewAPI | 中 |

---

## 6. 组件与数据流

### 6.1 组件树

```
CreationPanel
├── cp-toolbar            ← +📋历史按钮
├── cp-canvas-zone        ← 🆕 替代 cp-gallery-zone
│   ├── CanvasContainer   ← LeaferJS 挂载点
│   └── 进度浮层          ← 生成时叠在画布左下角
├── cp-params             ← 不动
├── cp-composer           ← 不动
└── 历史 Modal (Teleport) ← 🆕
```

### 6.2 数据流

```
mediaTaskStore 任务完成
  → canvasStore.addLayer({ path: 'jc-media/images/xxx.png' })
  → CanvasContainer.addImageToCanvas()

用户拖入/粘贴
  → 复制到 jc-media/images/
  → canvasStore.addLayer()

切面板/关APP
  → canvasStore.save()  → .jiucaihezi/canvas/{id}.json
下次打开
  → canvasStore.restore() → 恢复所有图层
```

---

## 7. 画布持久化

### 7.1 存储位置

```
{projectDir}/
├── jc-media/images/          ← 唯一真源（不动）
└── .jiucaihezi/canvas/
    └── {canvasId}.json       ← 画布元数据（只存引用路径）
```

### 7.2 保存时机

- 画布隐藏时（onBeforeUnmount）
- 图层增删时（debounce 2s）
- 每 30s 自动保存

### 7.3 恢复

```
CreationPanel onMounted
  → 读取 {projectDir}/.jiucaihezi/canvas/{canvasId}.json
  → 遍历 layers[] → new LeaferImage({ url: filePath })
  → 恢复 viewport
```

| 边缘情况 | 处理 |
|---------|------|
| jc-media/ 图片被外部删除 | 画布上显示「图片已删除」占位 |
| 无项目目录（Web端） | 降级到 `~/.jiucaihezi/canvas/` |
| 项目切换 | 重新加载不同 canvasId 的 JSON |

---

## 8. 验证标准

| # | 验证项 | 标准 |
|---|--------|------|
| 1 | TS | `pnpm exec vue-tsc -b` 0 错 |
| 2 | 构建 | `pnpm build` 通过，bundle < +100KB |
| 3 | 画布显示 | 打开创作面板 → 中间是 LeaferJS 画布 |
| 4 | 滚轮 | 滚轮缩放 + 拖拽平移 |
| 5 | 生成入画布 | 点生成 → 图片出现在画布 |
| 6 | 拖入 | 从 Finder 拖图片到画布 |
| 7 | 粘贴 | Cmd+V 截图 → 出现在画布 |
| 8 | 选中编辑 | 点图片 → 可拖拽/缩放（Editor 自带） |
| 9 | 历史 | 点「📋 历史」→ 弹出原任务列表 |
| 10 | 面板切换 | 切走再切回 → 画布图片仍在 |
| 11 | 重启恢复 | 关APP再开 → 图片和位置恢复 |
| 12 | 布局不动 | cp-params 和 cp-composer 与改前一致 |
