# 韭菜盒子画布 — 软件设计文档 (SDD)

> **版本**: v1.0
> **日期**: 2026-07-11
> **分支**: `0711-canvas`
> **依赖**: LeaferJS v2.2.0, `@leafer-in/editor`, `@leafer-in/viewport`

---

## 目录

1. [产品形态](#1-产品形态)
2. [画布引擎：LeaferJS](#2-画布引擎leaferjs)
3. [布局集成](#3-布局集成)
4. [组件树与数据流](#4-组件树与数据流)
5. [核心类型设计](#5-核心类型设计)
6. [CanvasPanel 详细设计](#6-canvaspanel-详细设计)
7. [编辑工具设计](#7-编辑工具设计)
8. [Skill 模板面板设计](#8-skill-模板面板设计)
9. [Bridge 桥梁设计](#9-bridge-桥梁设计)
10. [画布持久化](#10-画布持久化)
11. [实施阶段](#11-实施阶段)
12. [非功能需求](#12-非功能需求)
13. [验证标准](#13-验证标准)

---

## 1. 产品形态

### 1.1 画布模式的布局

```
┌────────┬──────────┬────────────────────────┬──────────────────────────┐
│  Rail  │ FileTree │     ChatPanel          │  画布（第四列）           │
│        │          │                        │  ┌────────────────────┐  │
│  🎨 ←─ │          │  ★ 始终显示            │  │ CanvasToolbar      │  │
│  新增  │          │  对话不中断             │  │ [标注][去背景][扩图]│  │
│        │          │                        │  │ [文字][图层][模板]  │  │
│        │          │                        │  ├────────────────────┤  │
│        │          │                        │  │                    │  │
│        │          │                        │  │  LeaferJS 无限画布  │  │
│        │          │                        │  │  · 图片拖入/粘贴   │  │
│        │          │                        │  │  · 多选/框选/吸附  │  │
│        │          │                        │  │  · 滚轮缩放/平移   │  │
│        │          │                        │  │                    │  │
│        │          │                        │  └────────────────────┘  │
└────────┴──────────┴────────────────────────┴──────────────────────────┘
```

**关键决策**：
- 画布打开时，ChatPanel **不隐藏**。用户在画布上操作时，可以同时看到对话内容。
- 画布是**第四列面板**，与 Skills/Tools/Editor/Creation/Settings 平级，通过 Rail 按钮切换。
- 点击 Rail 其他按钮 → 画布隐藏，回到对应面板。再点画布按钮 → 画布恢复，**状态保留**。

### 1.2 与创作面板的关系

```
创作面板（CreationPanel）          画布（CanvasPanel）
┌─────────────────────┐           ┌─────────────────────┐
│ 选模型 → 写prompt   │  产出    │ 图片编辑/标注/去背景 │
│ → 生成图片/视频      │ ──────→ │ 图层管理/文字改写    │
│                     │  自动    │ Skill模板一键生成     │
│                     │  入画布  │                     │
└─────────────────────┘           └─────────────────────┘
```

创作面板是「工厂」，画布是「工作台」。创作面板的产出自动出现在画布上。

### 1.3 适用范围

| 场景 | 画布角色 |
|------|---------|
| 图片生成后编辑 | 标注修图、去背景、扩图、文字改写 |
| 营销物料制作 | 小红书封面、电商组图、Logo、宣传册 |
| 剧本/小说创作 | 贴角色卡片、情节节点、关系图谱 |
| Wiki 知识库 | [[双链]] 关系可视化 |
| 多图对比 | 排列多张生成结果，横向对比选最佳 |

---

## 2. 画布引擎：LeaferJS

### 2.1 选型理由

LeaferJS 是目前唯一满足全部约束的 Canvas 引擎：

| 约束 | LeaferJS | tldraw | Fabric.js | Konva.js |
|------|----------|--------|-----------|----------|
| 框架无关（Vue 3 友好） | ✅ 纯 JS | ❌ React | ✅ | ✅ (vue-konva) |
| TypeScript 100% | ✅ | ✅ | ❌ (d.ts) | ✅ |
| 零依赖 / 轻量 | ✅ 70KB | ❌ ~500KB | ❌ ~200KB | ❌ ~160KB |
| 内置 Editor（旋转/缩放/多选/吸附） | ✅ @leafer-in/editor | 需自定义 | 需自定义 | ✅ react-konva |
| 无限画布视窗（滚轮缩放+平移） | ✅ @leafer-in/viewport | ✅ 内置 | ❌ | ❌ |
| 官方 AI/MCP 支持 | ✅ | ❌ | ❌ | ❌ |
| 中文文档 | ✅ | ❌ | ❌ | ❌ |
| MIT 许可证 | ✅ | ✅ | ✅ | ✅ |

### 2.2 使用的 LeaferJS 包

```json
{
  "leafer-ui": "^2.2.0",
  "@leafer-in/editor": "^2.2.0",
  "@leafer-in/viewport": "^2.2.0"
}
```

| 包 | 作用 |
|---|------|
| `leafer-ui` | 核心引擎：图形渲染、事件系统、场景树 |
| `@leafer-in/editor` | 编辑能力：旋转/缩放/多选/框选/吸附/标尺 |
| `@leafer-in/viewport` | 无限画布：滚轮缩放、拖拽平移、视窗控制 |

---

## 3. 布局集成

### 3.1 ActivityRail 变更

```diff
// src/components/rail/ActivityRail.vue

const allTabs = [
+ { key: 'canvas',   icon: 'palette',         labelKey: 'rail.canvas' },
  { key: 'skills',   icon: 'paid',             labelKey: 'rail.skillsManage' },
  { key: 'tools',    icon: 'construction',     labelKey: 'rail.tools' },
  { key: 'editor',   icon: 'edit_note',        labelKey: 'rail.editor' },
  { key: 'creation', icon: 'photo_camera',     labelKey: 'rail.creation' },
  { key: 'review',   icon: 'rate_review',      labelKey: 'rail.review' },
  { key: 'files',    icon: 'folder_open',      labelKey: 'rail.files' },
]
```

画布按钮插入到 **skills 之前**（最高频操作）。`canvas` 不加入 `webHiddenTabs`——Web 端也可用（LeaferJS 纯浏览器能力）。

### 3.2 WorkspaceLayout 变更

```diff
// src/layouts/WorkspaceLayout.vue

+ import CanvasPanel from '@/components/canvas/CanvasPanel.vue'

- const canvasEnabled = ref(false)
+ const canvasEnabled = ref(true)

  function onRailSwitch(mode: string) {
    ...
+   if (mode === 'canvas') {
+     toggleRightPanel('canvas')
+     return
+   }
  }
```

模板新增（在 `v-if/else-if` 链中的 `CreationPanel` 之后）：

```html
<CanvasPanel
  v-else-if="rightPanel === 'canvas' && canvasEnabled"
  :is-visible="rightPanel === 'canvas'"
/>
```

**关键**：`CanvasPanel` 接收 `isVisible` prop——隐藏时 `v-show="false"`（保留 LeaferJS 实例和画布状态），而不是 `v-if`（销毁重建）。

### 3.3 画布状态的组件生命周期

```
用户点画布按钮
  → toggleRightPanel('canvas')
  → CanvasPanel mounted（首次）: new Leafer() + new Editor() + new Viewport()
  → CanvasPanel :isVisible = true

用户点其他按钮
  → rightPanel = 'skills'
  → CanvasPanel :isVisible = false  ← v-show，LeaferJS 实例保留

用户再点画布按钮
  → rightPanel = 'canvas'
  → CanvasPanel :isVisible = true   ← 画布瞬间恢复，不重建

用户关闭APP
  → CanvasPanel onBeforeUnmount: leafer.destroy()
```

### 3.4 i18n 新增

```ts
// src/i18n/index.ts
'rail.canvas': { zh: '画布', en: 'Canvas' },
'canvas.empty': { zh: '拖拽图片到此处，或从创作面板/聊天中导入', en: 'Drop images here...' },
'canvas.toolbar.quickEdit': { zh: '标注修图', en: 'Quick Edit' },
'canvas.toolbar.removeBg': { zh: '去背景', en: 'Remove BG' },
'canvas.toolbar.expand': { zh: '扩图', en: 'Expand' },
'canvas.toolbar.editText': { zh: '文字改写', en: 'Edit Text' },
'canvas.toolbar.editElements': { zh: '图层分离', en: 'Edit Elements' },
'canvas.toolbar.skills': { zh: '模板', en: 'Skills' },
```

---

## 4. 组件树与数据流

### 4.1 组件树

```
WorkspaceLayout
├── ActivityRail          ← 新增画布按钮
├── FileTreePanel
├── ChatPanel
└── CanvasPanel           ← 新增
    ├── CanvasToolbar     ← 顶部工具栏
    │   ├── [标注修图] 按钮
    │   ├── [去背景]   按钮
    │   ├── [扩图]     按钮
    │   ├── [文字改写] 按钮
    │   ├── [图层分离] 按钮
    │   └── [模板]     按钮 → 展开 SkillPanel
    ├── <div ref="canvasContainer" />  ← LeaferJS 挂载点
    └── SkillPanel (v-if)             ← 模板面板浮层
        ├── XiaohongshuCover
        ├── ProductMarketing
        ├── LogoBrand
        └── CrossPlatform
```

### 4.2 数据流

```
                    ┌─────────────┐
                    │ canvasStore │  Pinia — 单一状态源
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │CanvasPanel│    │ Toolbar  │    │SkillPanel│
    │LeaferJS  │    │ 按钮状态 │    │ 表单参数 │
    └────┬─────┘    └──────────┘    └────┬─────┘
         │                               │
         │  canvasStore.layers[]         │  canvasStore.activeSkill
         │  canvasStore.selection        │
         │                               │
         ▼                               ▼
┌─────────────────────────────────────────────────┐
│                  Bridge 层                       │
│  ┌───────────────┐ ┌──────────┐ ┌────────────┐ │
│  │creationBridge │ │chatBridge│ │agentBridge │ │
│  │ 创作→画布      │ │画布→聊天  │ │画布↔Agent  │ │
│  └───────┬───────┘ └────┬─────┘ └─────┬──────┘ │
└──────────┼──────────────┼─────────────┼────────┘
           ▼              ▼             ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │useCreation│   │ useChat  │   │ OpenCode │
    │媒体生成   │   │ 对话系统  │   │ Agent    │
    └──────────┘   └──────────┘   └──────────┘
```

### 4.3 数据流向总结

| 方向 | 触发 | 数据 | 实现 |
|------|------|------|------|
| 创作面板 → 画布 | 图片生成完成 | `{ url, model, prompt }` | eventBus `'canvas:add-image'` |
| 画布 → 聊天 | 右键「发送到聊天」 | `@file` 引用 + 图片 | eventBus `'chat:insert-image'` |
| 画布 → 编辑区 | 右键「导入编辑区」 | 选中图片的 base64 | eventBus `'editor:insert-image'` |
| 画布 → Agent | 标注完成点「提交」 | `{ image, annotations[] }` | MCP tool `canvas_edit_image` |
| Agent → 画布 | 生成完成 | `{ imageUrl, taskId }` | eventBus `'canvas:update-result'` |

---

## 5. 核心类型设计

```ts
// src/types/canvas.ts

/** 画布上的一个图层（图片） */
export interface CanvasLayer {
  id: string
  /** 图片 blob URL 或远程 URL */
  url: string
  /** LeaferJS Image 元素的内部 ID */
  leaferId: number
  /** 原始文件名（如有） */
  filename?: string
  /** 来源 */
  source: 'creation' | 'chat' | 'paste' | 'drop' | 'agent'
  /** 来源的创作任务 ID（creation 来源时） */
  sourceTaskId?: string
  /** 生成该图的模型 */
  sourceModel?: string
  /** 生成该图的 prompt */
  sourcePrompt?: string
  /** 在画布上的位置和大小 */
  bounds: { x: number; y: number; width: number; height: number }
  /** 图层是否锁定 */
  locked: boolean
  /** 图层面板中的名称 */
  label: string
  createdAt: number
}

/** 标注工具产生的标注数据 */
export interface CanvasAnnotation {
  id: string
  type: 'arrow' | 'brush' | 'text' | 'rect' | 'ellipse'
  /** 关联的目标图层 ID */
  targetLayerId: string
  /** 标注的文本内容（箭头指向的文字说明） */
  text?: string
  /** 标注的几何数据 */
  points: { x: number; y: number }[]
  color: string
  strokeWidth: number
}

/** 编辑操作请求（发给 Agent） */
export interface CanvasEditRequest {
  type: 'quick-edit' | 'remove-bg' | 'expand' | 'edit-text' | 'edit-elements'
  /** 操作的目标图层 */
  layerId: string
  /** 标注数据（quick-edit 时） */
  annotations?: CanvasAnnotation[]
  /** 目标比例（expand 时） */
  targetRatio?: string
  /** 文字修改列表（edit-text 时） */
  textChanges?: { oldText: string; newText: string }[]
}

/** Skill 提交参数 */
export interface CanvasSkillRequest {
  skillType: 'xiaohongshu-cover' | 'product-marketing' | 'logo-brand' | 'brochure' | 'cross-platform'
  /** 选中的图层 ID（参考图） */
  layerId: string
  /** 表单参数 */
  params: Record<string, string>
}

/** Pinia store 的状态 */
export interface CanvasState {
  /** 当前画布 ID（按 project 隔离） */
  canvasId: string
  layers: CanvasLayer[]
  annotations: CanvasAnnotation[]
  /** 当前选中的图层 ID 列表 */
  selectedLayerIds: string[]
  /** 当前激活的工具 */
  activeTool: 'select' | 'quick-edit' | 'remove-bg' | 'expand' | 'edit-text' | 'edit-elements' | null
  /** 当前打开的 Skill 面板 */
  activeSkill: string | null
  /** 任务队列（生成中的编辑请求） */
  pendingTasks: Map<string, { layerId: string; status: 'pending' | 'running' | 'done' | 'error' }>
}
```

---

## 6. CanvasPanel 详细设计

### 6.1 组件结构

```vue
<!-- src/components/canvas/CanvasPanel.vue -->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { Leafer, Image as LeaferImage } from 'leafer-ui'
import { Editor } from '@leafer-in/editor'
import { Viewport } from '@leafer-in/viewport'
import { useCanvasStore } from './store/canvasStore'
import { onEvent } from '@/utils/eventBus'
import CanvasToolbar from './CanvasToolbar.vue'
import SkillPanel from './skills/SkillPanel.vue'

const props = defineProps<{ isVisible: boolean }>()
const store = useCanvasStore()

// ─── LeaferJS 实例 ───
const containerRef = ref<HTMLDivElement>()
let leafer: Leafer | null = null

onMounted(() => {
  if (!containerRef.value) return
  
  // 1. 创建画布
  leafer = new Leafer({
    view: containerRef.value,
    type: 'design',       // 设计模式（支持高 DPI）
    fill: '#f5f5f5',      // 画布底色（跟随主题）
  })
  
  // 2. 启用编辑器（旋转/缩放/多选/框选/吸附/标尺）
  new Editor({ target: leafer })
  
  // 3. 启用无限视窗（滚轮缩放 + 拖拽平移）
  new Viewport({ target: leafer })
  
  // 4. 监听图片拖入
  containerRef.value.addEventListener('drop', onDrop)
  containerRef.value.addEventListener('dragover', (e) => e.preventDefault())
  
  // 5. 监听粘贴图片
  document.addEventListener('paste', onPaste)
  
  // 6. 恢复之前保存的画布状态
  store.restoreLayers(leafer)
})

onBeforeUnmount(() => {
  document.removeEventListener('paste', onPaste)
  store.saveLayers(leafer!)
  leafer?.destroy()
  leafer = null
})

// ─── 图片拖入 ───
function onDrop(e: DragEvent) {
  e.preventDefault()
  const files = e.dataTransfer?.files
  if (!files) return
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    const url = URL.createObjectURL(file)
    addImageToCanvas(url, { filename: file.name, source: 'drop' })
  }
}

// ─── 粘贴图片 ───
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (!item.type.startsWith('image/')) continue
    const blob = item.getAsFile()
    if (!blob) continue
    const url = URL.createObjectURL(blob)
    addImageToCanvas(url, { source: 'paste' })
  }
}

// ─── 添加图片到画布 ───
function addImageToCanvas(url: string, meta: Partial<CanvasLayer>) {
  if (!leafer) return
  
  const img = new LeaferImage({
    url,
    draggable: true,
    editable: true,
    // 居中放置，缩放到合适大小
    x: 100 + Math.random() * 200,
    y: 100 + Math.random() * 200,
  })
  
  leafer.add(img)
  
  store.addLayer({
    id: crypto.randomUUID(),
    url,
    leaferId: img.innerId,
    source: meta.source || 'drop',
    filename: meta.filename,
    bounds: { x: img.x || 0, y: img.y || 0, width: img.width || 0, height: img.height || 0 },
    locked: false,
    label: meta.filename || `图片 ${store.layers.length + 1}`,
    createdAt: Date.now(),
  })
}

// ─── 从创作面板/聊天接收图片 ───
const offAddImage = onEvent('canvas:add-image', (payload: unknown) => {
  const { url, source, model, prompt, taskId } = payload as {
    url: string; source: string; model?: string; prompt?: string; taskId?: string
  }
  addImageToCanvas(url, { source: source as any, sourceModel: model, sourcePrompt: prompt, sourceTaskId: taskId })
})

// ─── 可见性切换 ───
watch(() => props.isVisible, (visible) => {
  if (!leafer) return
  if (visible) {
    leafer.start()  // 恢复渲染
  } else {
    store.saveLayers(leafer)
    leafer.stop()   // 暂停渲染，节省资源
  }
})

defineExpose({ leafer, addImageToCanvas })
</script>

<template>
  <div class="canvas-panel" :class="{ hidden: !isVisible }">
    <CanvasToolbar
      :active-tool="store.activeTool"
      :selected-count="store.selectedLayerIds.length"
      @select-tool="store.activeTool = $event"
      @open-skills="store.activeSkill = 'browser'"
    />
    
    <div
      ref="containerRef"
      class="canvas-container"
    />
    
    <SkillPanel
      v-if="store.activeSkill"
      @close="store.activeSkill = null"
    />
  </div>
</template>

<style scoped>
.canvas-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface);
}
.canvas-panel.hidden {
  display: none; /* ponytail: v-show 级别隐藏，保留 LeaferJS 实例 */
}
.canvas-container {
  flex: 1;
  overflow: hidden;
}
</style>
```

### 6.2 关键设计决策

| 决策 | 理由 |
|------|------|
| CanvasPanel 用 `v-show` 而非 `v-if` | LeaferJS 实例重建成本高（Canvas 元素创建+事件绑定），切换面板不应销毁 |
| LeaferJS 实例存组件局部变量，不存 Pinia | LeaferJS 是 DOM 绑定对象，不可序列化，放 Pinia 会导致 SSR/持久化问题 |
| canvasStore 只存纯数据（layers, annotations） | Pinia 可序列化，方便持久化到 IndexedDB/文件系统 |
| 图片用 `URL.createObjectURL` 而非 base64 | 避免内存膨胀，画布关闭时 `revokeObjectURL` |

---

## 7. 编辑工具设计

### 7.1 工具栏按钮 → 工具激活流程

```
用户点 [标注修图]
  → store.activeTool = 'quick-edit'
  → CanvasPanel watch: leafer 切换到标注模式
  → 用户在图片上画箭头、写文字
  → 点「提交修图」
  → 收集 annotations[] + 原图 URL
  → agentBridge.submitEdit({ type: 'quick-edit', layerId, annotations })
  → OpenCode Agent 构造 GPT-image-2 prompt
  → 生成结果回写 store → leafer 更新图层
```

### 7.2 Quick Edit（标注修图）

**输入**：选中图片 + 箭头/画笔/文字标注
**输出**：修改后的图片

**实现**（`src/components/canvas/tools/QuickEditTool.ts`）：

```ts
// 复用 LeaferJS 原生绘制能力：
// - Arrow 元素：绘制箭头
// - Pen（路径）：自由画笔
// - Text 元素：标注文字
// - Editor 插件：选中元素后可拖拽/删除

export function activateQuickEdit(leafer: Leafer) {
  // 在目标图层上方创建一个标注层 Group
  const annotationGroup = new Group({ name: 'annotations' })
  leafer.add(annotationGroup)
  // 切换编辑器到「仅编辑标注层」模式
  // ...
}

export function collectAnnotations(annotationGroup: Group): CanvasAnnotation[] {
  return annotationGroup.children.map(child => ({
    id: crypto.randomUUID(),
    type: child.tag === 'Arrow' ? 'arrow'
      : child.tag === 'Pen' ? 'brush'
      : child.tag === 'Text' ? 'text'
      : child.tag === 'Rect' ? 'rect'
      : 'ellipse',
    targetLayerId: annotationGroup.parent!.innerId.toString(),
    text: (child as any).text,
    points: [], // 从 child 的 path/position 提取
    color: (child as any).stroke || '#ff0000',
    strokeWidth: (child as any).strokeWidth || 2,
  }))
}
```

### 7.3 Remove BG（去背景）

**输入**：选中图片
**输出**：透明背景图片

**流程**：
```
选中图层 → 点[去背景]
  → 调 NewAPI: POST /v1/images/edits
    { model: 'gpt-image-2', prompt: 'remove background, make it transparent',
      image: base64, extra_fields: { task: 'remove-bg' } }
  → 轮询 /rh/tasks/:id
  → 拿到透明背景图 URL
  → 替换原图层
```

如果后续接入专用的去背景模型（如 rembg），替换 API 调用即可。

### 7.4 Expand（扩图/Outpaint）

**输入**：选中图片 + 目标比例（1:1, 3:4, 16:9, 9:16）
**输出**：补全边缘后的图片

**实现**：
- 选中图片后，在图片外围显示可拖拽的扩图框（LeaferJS Rect + Editor 拖拽手柄）
- 扩图框内 = 保留原图位置，扩图框外 = 需要 AI 补全的区域
- 提交时：原图 URL + 目标比例 + 原图在画框中的位置 → Agent 生成

### 7.5 Edit Text（文字改写）

**输入**：选中图片
**输出**：文字被替换但风格保持不变的新图片

**实现**：
- 调 GPT-4V / Gemini 做 OCR：识别图片中所有文字及其位置
- 在 LeaerJS 上叠加可编辑的 Text 元素
- 用户逐行修改文字 → 点「应用」
- 提交：原图 + 文字位置 + 新文字 → Agent 用 GPT-image-2 编辑模式生成

### 7.6 Edit Elements（图层分离）

**输入**：选中图片
**输出**：拆分为多个图层（背景/主体/文字/装饰）

**实现**：
- 调 GPT-image-2 / Gemini 分割：`segment this image into layers: background, main subject, text overlays`
- 将分割结果作为独立 LeaferJS Image 元素添加到画布
- 每个元素可独立拖拽、缩放、删除
- 支持导出为 PSD（可选，Phase 2+）

---

## 8. Skill 模板面板设计

### 8.1 框架结构

```
SkillPanel.vue（壳）
├── 分类 Tab：[社媒] [电商] [品牌] [营销] [工作室]
├── Skill 卡片列表（每个分类下 1-2 个 Skill）
└── 参数表单（选中 Skill 后展开）
    ├── 预览当前图层
    ├── 表单字段（下拉/输入/选择）
    ├── [提交生成] 按钮
    └── 生成结果列表
```

### 8.2 每个 Skill 的数据结构

```ts
interface SkillTemplate {
  id: string
  category: 'social-media' | 'e-commerce' | 'branding' | 'marketing' | 'studio'
  name: string                          // 如「小红书封面」
  description: string
  targetRatio: string                   // 如 '3:4'
  params: SkillParam[]
  /** 构造生成 prompt 的函数 */
  buildPrompt: (imageUrl: string, values: Record<string, string>) => string
}

interface SkillParam {
  key: string
  label: string
  type: 'text' | 'select' | 'textarea'
  options?: string[]                    // select 的选项
  required: boolean
  default?: string
}
```

### 8.3 示例：小红书封面 Skill

```ts
{
  id: 'xiaohongshu-cover',
  category: 'social-media',
  name: '小红书封面',
  description: '笔记首图、种草封面、个人 IP 内容',
  targetRatio: '3:4',
  params: [
    { key: 'contentType', label: '内容类型', type: 'select',
      options: ['好物推荐', '教程干货', '个人IP', 'Vlog', '其他'], required: true },
    { key: 'mainTitle', label: '主标题', type: 'text', required: true },
    { key: 'titleStyle', label: '标题风格', type: 'select',
      options: ['醒目大字', '小清新', '简约体', '手写风'], required: true },
    { key: 'titlePosition', label: '标题位置', type: 'select',
      options: ['顶部', '中间', '底部', '左侧', '右侧'], required: true },
    { key: 'keepElements', label: '必须保留的元素', type: 'textarea', required: false },
    { key: 'extra', label: '补充要求', type: 'textarea', required: false },
  ],
  buildPrompt(imageUrl, values) {
    return `Create a Xiaohongshu cover image (3:4 ratio) based on the reference image.
Content type: ${values.contentType}
Main title: "${values.mainTitle}" in ${values.titleStyle} style, positioned at ${values.titlePosition}
Elements to preserve: ${values.keepElements || 'none'}
Additional requirements: ${values.extra || 'none'}
Keep the visual style and color palette from the reference image. Make it eye-catching and suitable for social media.`
  }
}
```

### 8.4 Skill 执行流程

```
用户选图片 → 开 SkillPanel → 选「小红书封面」→ 填参数 → 点[提交生成]
  → canvasStore.addPendingTask()
  → 调 media-generation.ts: submitImageGen({
      model: 'gpt-image-2',  // 或 rh-gpt-image-2-official
      prompt: skill.buildPrompt(imageUrl, formValues),
      image: base64,
      aspectRatio: skill.targetRatio,
      onSubmitted: (payload) => {
        canvasStore.updateTaskStatus(skillId, 'running', payload.taskId)
      }
    })
  → 轮询完成
  → 结果图片 URL → addImageToCanvas()
  → canvasStore.updateTaskStatus(skillId, 'done')
```

---

## 9. Bridge 桥梁设计

### 9.1 creationBridge：创作面板 → 画布

**改动点**：`src/composables/useCreation.ts` 或 `mediaTaskStore` 的生成完成回调。

```ts
// 在图片生成完成时：
import { emitEvent } from '@/utils/eventBus'

// 生成成功：
emitEvent('canvas:add-image', {
  url: result.url,
  source: 'creation',
  model: currentModel.value?.id,
  prompt: cpState.prompt,
  taskId: result.taskId,
})
```

无需修改创作面板核心逻辑，只在生成完成回调中 emit 一个事件。

### 9.2 chatBridge：画布 → 聊天

**功能**：画布选中图片 → 右键「复制 @file 引用」或「发送到聊天」

```ts
// src/components/canvas/bridge/chatBridge.ts

/** 复制选中图片的 @file 引用到剪贴板 */
export async function copyImageRef(imageUrl: string) {
  // 1. 确保图片在项目目录下
  const localPath = await ensureImageInProject(imageUrl)
  // 2. 构造 @file 引用
  const ref = `@${localPath}`
  // 3. 写入剪贴板
  await navigator.clipboard.writeText(ref)
}

/** 发送选中图片到当前聊天输入框 */
export function sendToChat(imageUrl: string, label: string) {
  emitEvent('chat:insert-image', { url: imageUrl, label })
}
```

### 9.3 agentBridge：画布 ↔ OpenCode Agent

**设计**：画布的编辑请求通过 MCP tools 暴露给 OpenCode Agent。

```ts
// src/components/canvas/bridge/agentBridge.ts

/** 提交编辑请求到 Agent */
export async function submitEdit(request: CanvasEditRequest): Promise<string> {
  // 1. 下载原图 → base64
  const imageBase64 = await urlToBase64(request.layerUrl)
  
  // 2. 构造 Agent skill prompt（利用现有 JC-瞬间创作 Skill）
  const prompt = buildEditPrompt(request.type, request, imageBase64)
  
  // 3. 发送到 OpenCode Agent（复用 useChat 的 sendMessage）
  emitEvent('chat:send-message', {
    content: prompt,
    images: [imageBase64],
    metadata: { canvasEditRequest: request },
  })
  
  // 4. 返回任务 ID（用于后续轮询）
  return request.layerId
}
```

**MCP Tools 定义**（后续 Phase 3 完善，初始版本直接用 chat:send-message）：

| Tool | 用途 |
|------|------|
| `canvas.edit_image` | 标注修图 |
| `canvas.remove_bg` | 去背景 |
| `canvas.expand_image` | 扩图 |
| `canvas.edit_text` | 文字改写 |
| `canvas.separate_layers` | 图层分离 |
| `canvas.skill_generate` | Skill 模板生成 |

---

## 10. 画布持久化

### 10.1 存储策略

```
项目文件夹/
├── .jiucaihezi/
│   └── canvas/
│       ├── {canvasId}.json     ← LeaferJS 序列化数据（图层树+位置+缩放）
│       └── images/              ← 画布上的图片缓存
│           ├── {uuid}.png
│           └── {uuid}.jpg
```

**为什么不放 IndexedDB/SQLite**：
- 画布数据可能很大（图片多时几十MB）
- 已有 `mediaAssetStore` 用文件系统存图片，画布复用同一模式
- 桌面端 Tauri 读写项目文件夹更快

### 10.2 序列化格式

```json
{
  "version": 1,
  "canvasId": "...",
  "updatedAt": 1710700000000,
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "layers": [
    {
      "id": "...",
      "filename": "generated_001.png",
      "source": "creation",
      "sourceModel": "gpt-image-2",
      "sourcePrompt": "一只猫",
      "bounds": { "x": 100, "y": 200, "width": 1024, "height": 1024 },
      "locked": false,
      "label": "图片 1",
      "createdAt": 1710700000000
    }
  ]
}
```

**不序列化的**：
- LeaferJS 内部对象（innerId, Image 实例）→ 从 JSON 重建
- 图片二进制 → 存 `images/` 目录，JSON 只存文件名

### 10.3 持久化时机

```
- 画布隐藏时（切换面板）：saveLayers()
- 每 30s 自动保存（debounce）
- APP 关闭前（onBeforeUnmount）：saveLayers()
```

### 10.4 恢复流程

```
CanvasPanel mounted
  → 读取 {projectDir}/.jiucaihezi/canvas/{canvasId}.json
  → 遍历 layers[]
  → 对每个 layer: new LeaferImage({ url: `images/{filename}` })
  → 恢复 viewport 位置
```

---

## 11. 实施阶段

### Phase 0：基建（1-2 天）✅ 最优先

| 步骤 | 内容 | 验证 |
|------|------|------|
| 0.1 | `pnpm add leafer-ui @leafer-in/editor @leafer-in/viewport` | `pnpm exec vue-tsc -b` 通过 |
| 0.2 | `ActivityRail.vue` 加画布按钮 | 按钮显示，点击可切换 |
| 0.3 | `WorkspaceLayout.vue` 加 `CanvasPanel` 壳 | 第四列显示空白画布面板 |
| 0.4 | `CanvasPanel.vue` 初始化 LeaferJS | 能看到无限画布，滚轮缩放+拖拽 |
| 0.5 | 图片拖入/粘贴到画布 | 图片出现在画布上，可拖拽/缩放 |
| 0.6 | `canvasStore.ts` 基础版 | layers 状态管理，选中/取消选中 |

### Phase 1：编辑工具（3-5 天）

| 步骤 | 内容 |
|------|------|
| 1.1 | `CanvasToolbar.vue` + 工具切换框架 |
| 1.2 | `QuickEditTool.ts`：箭头+画笔+文字标注 |
| 1.3 | `RemoveBgTool.ts`：选中图片 → 去背景 API → 替换 |
| 1.4 | `ExpandTool.ts`：扩图框 + 比例预设 + outpainting |
| 1.5 | `EditTextTool.ts`：OCR + 文字覆盖层 + 回写 |
| 1.6 | `EditElementsTool.ts`：GPT 分割 → 多图层 |

### Phase 2：Skill 面板（2-3 天）

| 步骤 | 内容 |
|------|------|
| 2.1 | `SkillPanel.vue`：分类导航 + 表单框架 |
| 2.2 | 小红书封面、电商组图、Logo、宣传册、跨平台 |
| 2.3 | 生成结果自动回写画布 |

### Phase 3：Bridge 联动（2-3 天）

| 步骤 | 内容 |
|------|------|
| 3.1 | `creationBridge`：创作面板产出自动入画布 |
| 3.2 | `chatBridge`：画布图片发送到聊天 / Copy @file |
| 3.3 | `agentBridge`：编辑请求 → Agent（MCP tools） |

### Phase 4：持久化 + 打磨（1-2 天）

| 步骤 | 内容 |
|------|------|
| 4.1 | 画布 JSON 序列化/反序列化 + 图片文件管理 |
| 4.2 | 拖入/粘贴/创作产出 的图片落地到 `images/` |
| 4.3 | 右键菜单 + Delete 键删除 + Ctrl+Z 撤销 |
| 4.4 | 暗色模式 CSS 适配 |

---

## 12. 非功能需求

### 12.1 性能

| 指标 | 目标 | LeaferJS 能力 |
|------|------|--------------|
| 画布初始化 | <500ms | ✅ |
| 100 张图片拖拽 | 60fps | ✅ 100万元素 60fps |
| 画布隐藏/显示 | <100ms | ✅ v-show，不重建 |
| 内存占用（50张图） | <500MB | ✅ 320MB@100万元素 |

### 12.2 跨平台

| 平台 | 支持 |
|------|------|
| macOS (Tauri) | ✅ 主要目标 |
| Windows (Tauri) | ✅ LeaferJS 纯 Web |
| Web (Cloudflare Pages) | ✅ 浏览器原生 Canvas |
| 手机端 (≤768px) | ❌ 画布不显示（`isMobile` 时隐藏按钮） |

### 12.3 安全

- 拖入/粘贴的图片用 `URL.createObjectURL`（blob://），不暴露本地路径
- 图片落地到 `{projectDir}/.jiucaihezi/canvas/images/`（已在 Tauri fs scope 内）
- 不监听全局键盘事件（只在画布 focused 时响应）

---

## 13. 验证标准

| # | 验证项 | 标准 |
|---|--------|------|
| 1 | TypeScript | `pnpm exec vue-tsc -b` 0 错 |
| 2 | 构建 | `pnpm build` 通过（新增 leafer-ui 后 bundle size <15% 增长） |
| 3 | 画布显示 | 点 Rail 画布按钮 → 第四列出现无限画布 |
| 4 | 图片拖入 | 从 Finder 拖图片到画布 → 图片出现，可拖拽/缩放 |
| 5 | 图片粘贴 | Cmd+V 粘贴截图 → 图片出现在画布 |
| 6 | 面板切换 | 画布 → 切到 Skills → 切回画布 → 图片仍在，位置不变 |
| 7 | 滚轮交互 | 滚轮缩放、拖拽平移 → 流畅无卡顿 |
| 8 | 去背景 | 选中图片 → 去背景 → 新图替换原图层 |
| 9 | Skill 生成 | 选图片 → 小红书封面 Skill → 填参数 → 生成 → 结果入画布 |
| 10 | 创作联动 | 创作面板生成图片 → 自动出现在画布 |
| 11 | 持久化 | 画布有图 → 关闭APP → 重启 → 图片和位置恢复 |

---

## 附录A：依赖清单

```json
{
  "dependencies": {
    "leafer-ui": "^2.2.0"
  },
  "devDependencies": {
    "@leafer-in/editor": "^2.2.0",
    "@leafer-in/viewport": "^2.2.0"
  }
}
```

> `@leafer-in/*` 是 LeaferJS 官方插件，放在 devDependencies 即可（Vite 会 tree-shake 未用部分）。

## 附录B：与旧 VueFlow 画布的区别

旧画布（`2cab8bc` 移除，VueFlow 节点工作流）和本方案是**完全不同的产品**：

| | 旧画布（VueFlow） | 新画布（LeaferJS） |
|---|---|---|
| 定位 | 节点式 AI 工作流编排 | 无限画布图片编辑+模板 |
| 引擎 | @vue-flow/core | leafer-ui |
| 核心操作 | 连线节点 → 执行工作流 | 拖拽/标注/编辑图片 |
| 用户群 | 开发者/AI 工程师 | 创作者/营销/编剧 |
| 复用 | 无（类型和 store 不兼容） | 从头设计 |
