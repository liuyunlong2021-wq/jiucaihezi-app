# 韭菜盒子画布全面抄袭 T8-penguin-canvas 执行方案

> 版本：v1.0 | 日期：2026-05-27 | 对标：T8-penguin-canvas v1.5.3
>
> 原则：不仅抄节点 UI，还要抄内部运转逻辑、Key 流转、数据协议、执行调度

---

## 零、差异分析与总览

### T8 技术栈 vs 韭菜盒子技术栈

| 维度 | T8-penguin-canvas | 韭菜盒子 (jiucaihezi-app) | 搬运难度 |
|------|-------------------|---------------------------|----------|
| 框架 | React 19 | Vue 3 (Composition API) | 中 |
| 画布库 | @xyflow/react (ReactFlow) | @vue-flow/core (VueFlow) | 低（API 高度相似） |
| 状态管理 | Zustand | Pinia | 低 |
| 后端 | Express (端口 18766) | Tauri Rust + NewAPI 直连 | 中（架构不同但协议兼容） |
| 打包 | Electron | Tauri v2 | 无影响（纯前端层搬运） |
| HTTP | fetch | Rust http_request/http_request_stream | 中（需走现有的 httpClient 桥接） |
| Key 存储 | 后端 settings.json（脱敏） | Tauri .session 文件 + idb | 低 |

### 现有差距

| 类别 | 韭菜盒子现有 | T8 目标 | 差距 |
|------|-------------|---------|------|
| 节点类型 | 11 种 | 38 种 | -27 |
| Key 管理 | 单一 sk- Key | 3 通用 + 7 分类 Key | 需完整重建 |
| 端口系统 | 无端口类型校验 | PortType 语义注册表 | 需完整新建 |
| 批量执行 | 基础全量执行 | Kahn 拓扑排序 + 串行 + 进度 | 需升级 |
| 素材拖拽 | 无 | Ctrl+拖缩略图跨节点 | 需完整新建 |
| GroupBox | 无 | 打组+组执行+组拖拽 | 需完整新建 |
| 智能对齐 | 无 | 吸附20px+对齐辅助线 | 需完整新建 |
| 右键菜单 | 基础添加节点 | 框选自动菜单+组执行+打组 | 需升级 |
| 中继节点 | 无 | RelayNode 全字段透传 | 需新建 |
| 循环器 | 无 | LoopNode 串/并联 | 需新建 |
| @提及 | 无 | @素材节点注入 | 需新建 |

---

## 第一阶段：基础功能对齐（预计 8h）

> 目标：画布操作体验对齐 T8，不涉及新增节点类型。

### 1.1 端口类型系统 — `src/config/portTypes.ts`

**抄自 T8：** `src/config/portTypes.ts`

完整搬运端口语义注册表：

```ts
// 新建文件：src/components/canvas/config/portTypes.ts

export type PortType = 'text' | 'image' | 'video' | 'audio' | 'metadata' | 'config' | 'any'

export interface NodePorts {
  inputs: PortType[]
  outputs: PortType[]
}

// 颜色映射
export const PORT_COLOR: Record<PortType, string> = {
  text: '#38bdf8',      // sky-400
  image: '#f59e0b',     // amber-400
  video: '#f43f5e',     // rose-400
  audio: '#8b5cf6',     // violet-400
  metadata: '#a78bfa',
  config: '#06b6d4',
  any: '#94a3b8',
}

export const PORT_LABEL: Record<PortType, string> = {
  text: '文本', image: '图像', video: '视频', audio: '音频',
  metadata: '元数据', config: '配置', any: '任意',
}

// ★ 核心：节点端口注册表
export const NODE_PORTS: Record<string, NodePorts> = {
  // 输入
  upload: { inputs: [], outputs: ['image', 'video', 'audio'] },  // 动态
  'material-set': { inputs: ['text', 'image', 'video', 'audio'], outputs: ['text', 'image', 'video', 'audio'] },
  output: { inputs: ['text', 'image', 'video', 'audio'], outputs: [] },

  // 核心
  text: { inputs: [], outputs: ['text'] },
  image: { inputs: ['text', 'image'], outputs: ['image'] },
  video: { inputs: ['text', 'image'], outputs: ['video'] },
  seedance: { inputs: ['text', 'image', 'video', 'audio'], outputs: ['video'] },
  audio: { inputs: ['text', 'audio'], outputs: ['audio'] },
  llm: { inputs: ['text', 'image'], outputs: ['text'] },

  // RH
  runninghub: { inputs: ['text', 'image', 'video', 'audio', 'config'], outputs: ['image', 'video'] },
  'runninghub-wallet': { inputs: ['text', 'image', 'video', 'audio', 'config'], outputs: ['image', 'video'] },
  'rh-config': { inputs: ['text', 'image', 'video', 'audio'], outputs: ['config'] },
  'rh-tools': { inputs: ['text', 'image', 'video', 'audio'], outputs: ['image', 'video'] },

  // 特殊
  'multi-angle-3d': { inputs: ['text', 'image'], outputs: ['image'] },
  'panorama-720': { inputs: ['text', 'image'], outputs: ['image'] },
  'penguin-portrait': { inputs: ['text', 'image'], outputs: ['image'] },
  'portrait-metadata': { inputs: ['image'], outputs: ['metadata'] },
  'storyboard-grid': { inputs: ['image'], outputs: ['image'] },

  // 工具
  'drawing-board': { inputs: [], outputs: ['image'] },
  browser: { inputs: ['text'], outputs: ['image'] },
  'image-compare': { inputs: ['image'], outputs: ['image'] },
  'frame-extractor': { inputs: ['video'], outputs: ['image'] },
  'frame-pair': { inputs: ['image', 'video'], outputs: ['image'] },
  loop: { inputs: ['text', 'image', 'video', 'audio'], outputs: ['text', 'image', 'video', 'audio'] },
  'pick-from-set': { inputs: ['text', 'image', 'video', 'audio'], outputs: ['text', 'image', 'video', 'audio'] },
  'text-split': { inputs: ['text'], outputs: ['text'] },
  resize: { inputs: ['image'], outputs: ['image'] },
  combine: { inputs: ['image'], outputs: ['image'] },
  'remove-bg': { inputs: ['image'], outputs: ['image'] },
  upscale: { inputs: ['image'], outputs: ['image'] },
  'grid-crop': { inputs: ['image'], outputs: ['image'] },

  // 辅助
  edit: { inputs: ['text', 'image'], outputs: ['image'] },
  idea: { inputs: [], outputs: ['text'] },
  bp: { inputs: [], outputs: ['text', 'image', 'video', 'audio'] },
  relay: { inputs: ['any'], outputs: ['any'] },
  'video-output': { inputs: ['video'], outputs: [] },

  // 工具箱
  cinematic: { inputs: [], outputs: ['text'] },
  'video-motion': { inputs: [], outputs: ['text'] },
  'multi-angle-visual': { inputs: [], outputs: ['text'] },
}

// 连接校验
export function isConnectionValid(
  sourceType: string, targetType: string
): boolean {
  const src = NODE_PORTS[sourceType]
  const tgt = NODE_PORTS[targetType]
  if (!src || !tgt) return false
  return src.outputs.some(o => tgt.inputs.includes(o) || o === 'any' || tgt.inputs.includes('any'))
}

// 动态端口（upload 节点未上传时）
export function getEffectiveOutputs(nodeType: string, data?: any): PortType[] {
  if (nodeType === 'upload' && data?.uploadType) {
    return [data.uploadType]
  }
  return NODE_PORTS[nodeType]?.outputs || []
}
```

### 1.2 节点注册表 — `src/components/canvas/config/nodeRegistry.ts`

**抄自 T8：** `src/config/nodeRegistry.ts`

```ts
// 新建：src/components/canvas/config/nodeRegistry.ts

import type { CanvasNodeType } from '@/types/canvas'

export type NodeCategory = 'input' | 'core' | 'rh' | 'special' | 'utility' | 'auxiliary' | 'toolbox'

export interface NodeMeta {
  type: CanvasNodeType
  label: string
  category: NodeCategory
  description: string
  icon: string        // Material Symbols 图标名
  color: string       // Tailwind 颜色名
  hidden?: boolean
}

export const NODE_REGISTRY: NodeMeta[] = [
  // ===== 素材资源 (3) =====
  { type: 'upload', label: '上传素材', category: 'input', description: '图像/视频/音频三合一上传', icon: 'upload', color: 'emerald' },
  { type: 'material-set', label: '素材集', category: 'input', description: '多个同类型素材打包排序', icon: 'images', color: 'teal' },
  { type: 'output', label: '输出素材', category: 'input', description: '文本/图像/视频/音频预览', icon: 'monitor_play', color: 'teal' },

  // ===== 核心 (6) =====
  { type: 'text', label: '文本', category: 'core', description: '提示词文本节点', icon: 'text_fields', color: 'sky' },
  { type: 'image', label: '图像', category: 'core', description: 'GPT Image 2 / Nano Banana / MJ', icon: 'image', color: 'amber' },
  { type: 'video', label: '视频', category: 'core', description: 'Veo 3.1 / Grok Video', icon: 'movie', color: 'rose' },
  { type: 'seedance', label: 'SD2.0', category: 'core', description: 'Seedance 2.0 视频分镜', icon: 'film', color: 'fuchsia' },
  { type: 'audio', label: '音频', category: 'core', description: 'Suno V5.5 全模式', icon: 'music_note', color: 'violet' },
  { type: 'llm', label: 'LLM', category: 'core', description: 'GPT-5 / Claude 4.5 / Gemini 2.5', icon: 'smart_toy', color: 'emerald' },

  // ===== RH (4) =====
  { type: 'runninghub', label: 'RunningHub', category: 'rh', description: 'RH 工作流主节点', icon: 'account_tree', color: 'cyan' },
  { type: 'runninghub-wallet', label: 'RH 钱包', category: 'rh', description: '钱包应用(统一 NewAPI 鉴权)', icon: 'wallet', color: 'cyan' },
  { type: 'rh-config', label: 'RH 配置', category: 'rh', description: '参数注入节点', icon: 'settings', color: 'cyan', hidden: true },
  { type: 'rh-tools', label: 'RH 超市', category: 'rh', description: 'RH 应用浏览器', icon: 'storefront', color: 'cyan' },

  // ===== 特殊 (5, 隐藏) =====
  { type: 'multi-angle-3d', label: '多角度3D', category: 'special', description: '3D多视角生成', icon: 'view_in_ar', color: 'indigo', hidden: true },
  { type: 'panorama-720', label: '720全景', category: 'special', description: '720°全景图', icon: '360', color: 'indigo', hidden: true },
  { type: 'penguin-portrait', label: '企鹅肖像', category: 'special', description: '肖像专用', icon: 'person', color: 'indigo', hidden: true },
  { type: 'portrait-metadata', label: '肖像元数据', category: 'special', description: '肖像参数管理', icon: 'description', color: 'indigo', hidden: true },
  { type: 'storyboard-grid', label: '分镜网格', category: 'special', description: '分镜九宫格', icon: 'grid_view', color: 'indigo', hidden: true },

  // ===== 工具 (13) =====
  { type: 'drawing-board', label: '画板', category: 'utility', description: '手绘/涂抹', icon: 'draw', color: 'orange', hidden: true },
  { type: 'browser', label: '浏览器', category: 'utility', description: '网页内嵌', icon: 'language', color: 'orange', hidden: true },
  { type: 'image-compare', label: '图像对比', category: 'utility', description: '滑块对比/差异叠加', icon: 'compare', color: 'orange' },
  { type: 'frame-extractor', label: '抽帧', category: 'utility', description: '视频抽帧', icon: 'frame_person', color: 'orange' },
  { type: 'frame-pair', label: '首尾帧', category: 'utility', description: '首帧+尾帧合成', icon: 'flip', color: 'orange' },
  { type: 'loop', label: '循环器', category: 'utility', description: '串联/并联循环', icon: 'loop', color: 'orange' },
  { type: 'pick-from-set', label: '从合集取', category: 'utility', description: '索引取元素', icon: 'playlist_play', color: 'orange' },
  { type: 'text-split', label: '文本分割', category: 'utility', description: '分割文本为多段', icon: 'content_cut', color: 'orange' },
  { type: 'resize', label: '缩放', category: 'utility', description: '图像缩放', icon: 'photo_size_select_large', color: 'orange' },
  { type: 'combine', label: '拼接', category: 'utility', description: '图像拼接', icon: 'join', color: 'orange' },
  { type: 'remove-bg', label: '去背景', category: 'utility', description: '移除背景', icon: 'blur_off', color: 'orange' },
  { type: 'upscale', label: '放大', category: 'utility', description: 'AI超分放大', icon: 'zoom_in', color: 'orange' },
  { type: 'grid-crop', label: '宫格裁剪', category: 'utility', description: '宫格切片', icon: 'grid_on', color: 'orange' },

  // ===== 辅助 (5) =====
  { type: 'edit', label: '编辑', category: 'auxiliary', description: '图像编辑', icon: 'edit', color: 'slate', hidden: true },
  { type: 'idea', label: '灵感', category: 'auxiliary', description: '创意生成', icon: 'lightbulb', color: 'slate' },
  { type: 'bp', label: 'BP蓝图', category: 'auxiliary', description: 'Blueprint蓝图', icon: 'map', color: 'slate' },
  { type: 'relay', label: '中继', category: 'auxiliary', description: '数据中转(全字段透传)', icon: 'swap_horiz', color: 'slate' },
  { type: 'video-output', label: '视频输出', category: 'auxiliary', description: '视频结果展示', icon: 'monitor_play', color: 'slate', hidden: true },

  // ===== 工具箱 (3) =====
  { type: 'cinematic', label: '电影感', category: 'toolbox', description: '风格/镜头/光影/调色/质感各50项', icon: 'theaters', color: 'pink' },
  { type: 'video-motion', label: '运镜', category: 'toolbox', description: '场景/动作/路径/节奏/稳定/主体', icon: 'videocam', color: 'pink' },
  { type: 'multi-angle-visual', label: '多角度', category: 'toolbox', description: '可视化多角度(方位/俯仰/远近)', icon: '3d_rotation', color: 'pink' },
]
```

### 1.3 智能对齐 + 网格吸附

**抄自 T8：** `Canvas.tsx` 中的 `SNAP_GRID` + `onNodeDrag` 对齐辅助线逻辑

在 `CanvasWorkspace.vue` 中新增：

```ts
// 加到 CanvasWorkspace.vue <script setup>

const SNAP_GRID = [20, 20] as const
const ALIGN_THRESHOLD = 6

const guides = ref<{ vertical: number[]; horizontal: number[] }>({
  vertical: [],
  horizontal: [],
})

function onNodeDrag(event: any, node: any) {
  const { nodes } = flow
  const allNodes = nodes.value

  // 1. 网格吸附
  const snappedX = Math.round(node.position.x / SNAP_GRID[0]) * SNAP_GRID[0]
  const snappedY = Math.round(node.position.y / SNAP_GRID[1]) * SNAP_GRID[1]

  // 2. 对齐辅助线
  const vertical: number[] = []
  const horizontal: number[] = []

  for (const other of allNodes) {
    if (other.id === node.id) continue

    // 水平对齐
    if (Math.abs(snappedX - other.position.x) < ALIGN_THRESHOLD) {
      vertical.push(other.position.x)
    }
    // 垂直对齐
    if (Math.abs(snappedY - other.position.y) < ALIGN_THRESHOLD) {
      horizontal.push(other.position.y)
    }
  }

  guides.value = { vertical, horizontal }
}
```

### 1.4 框选自动菜单

**抄自 T8：** `Canvas.tsx` 中框选 ≥2 节点弹出操作面板

在 `CanvasWorkspace.vue` 的 `onSelectionChange` 中：

```ts
const selectionMenu = ref<{ show: boolean; x: number; y: number }>({ show: false, x: 0, y: 0 })

function onSelectionChange({ nodes: selectedNodes }: { nodes: CanvasNode[] }) {
  if (selectedNodes.length >= 2) {
    // 框选了 ≥2 个节点：弹出操作面板
    // 位置取最后一个选中节点的右下角
    const last = selectedNodes[selectedNodes.length - 1]
    selectionMenu.value = {
      show: true,
      x: last.position.x + 200,
      y: last.position.y - 40,
    }
  } else {
    selectionMenu.value.show = false
  }
}
```

### 1.5 快捷键升级

```ts
// 追加到 CanvasWorkspace.vue onKeydown：

// Ctrl+G: 打组
if (meta && key === 'g') {
  event.preventDefault()
  canvasStore.groupSelectedNodes()
}

// Ctrl+D: 复制选中
if (meta && key === 'd') {
  event.preventDefault()
  if (canvasStore.selectedNodeId) canvasStore.duplicateNode(canvasStore.selectedNodeId)
}

// R: 打开/关闭资源库（未选中节点时）
if (key === 'r' && canvasStore.selectedNodeIds().length === 0) {
  event.preventDefault()
  showWorkflows.value = !showWorkflows.value
}
```

### 1.6 右侧画布右键菜单升级

**抄自 T8：** `Canvas.tsx` 中 `contextMenu`

将现有右键菜单从"添加节点"升级为"添加节点 + 从剪贴板粘贴 + 导入工作流"：

```ts
const contextMenuItems = [
  // 快速添加（仅 7 个高频节点）
  { type: 'upload', icon: 'upload', label: '上传素材' },
  { type: 'text', icon: 'text_fields', label: '文本' },
  { type: 'image', icon: 'image', label: '图像' },
  { type: 'video', icon: 'movie', label: '视频' },
  { type: 'seedance', icon: 'film', label: 'SD2.0' },
  { type: 'audio', icon: 'music_note', label: '音频' },
  { type: 'llm', icon: 'smart_toy', label: 'LLM' },
  // 分隔
  null,
  { action: 'paste', icon: 'content_paste', label: '粘贴', disabled: clipboardCount === 0 },
  { action: 'import', icon: 'file_open', label: '导入工作流' },
]
```

### 1.7 批量执行升级（Kahn 拓扑排序）

**抄自 T8：** `src/utils/topologicalSort.ts` + `Canvas.tsx` `runNodesByOrder`

新建 `src/components/canvas/utils/canvasTopologicalSort.ts`：

```ts
// 新建文件：src/components/canvas/utils/canvasTopologicalSort.ts

/**
 * Kahn 拓扑排序（仅含可执行节点）
 * 抄自 T8 src/utils/topologicalSort.ts
 */
export function topologicalSort(
  nodes: { id: string; type?: string }[],
  edges: { source: string; target: string }[],
  executableTypes: Set<string>,
): string[] {
  const nodeIds = new Set(nodes.filter(n => executableTypes.has(n.type || '')).map(n => n.id))

  // 只保留内部边
  const internalEdges = edges.filter(
    e => nodeIds.has(e.source) && nodeIds.has(e.target)
  )

  // 入度统计
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  for (const id of nodeIds) {
    inDegree.set(id, 0)
    adjacency.set(id, [])
  }
  for (const e of internalEdges) {
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1)
    adjacency.get(e.source)?.push(e.target)
  }

  // BFS
  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const result: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    result.push(id)
    for (const target of adjacency.get(id) || []) {
      const newDeg = (inDegree.get(target) || 0) - 1
      inDegree.set(target, newDeg)
      if (newDeg === 0) queue.push(target)
    }
  }

  return result
}
```

改造 `canvasExecutor.ts` 中的 `runAllCanvasNodes`：

```ts
// 改为 Kahn 拓扑排序 + 串行触发 + 进度

const EXECUTABLE_NODE_TYPES = new Set([
  'image', 'edit',
  'multi-angle-3d', 'panorama-720', 'penguin-portrait',
  'video', 'seedance', 'audio', 'llm', 'runninghub', 'runninghub-wallet',
  'rh-tools',
  'resize', 'upscale', 'grid-crop', 'remove-bg', 'combine', 'image-compare',
  'frame-extractor', 'frame-pair',
  'upload',
  'loop', 'pick-from-set',
  'cinematic', 'video-motion', 'multi-angle-visual',
])

async function runAllCanvasNodes() {
  const canvasStore = useCanvasStore()
  const order = topologicalSort(
    canvasStore.nodes,
    canvasStore.edges,
    EXECUTABLE_NODE_TYPES,
  )

  if (order.length === 0) return

  canvasStore.stopRequested = false
  const total = order.length
  let done = 0

  for (const nodeId of order) {
    if (canvasStore.stopRequested) break
    await runCanvasNode(nodeId)
    done++
    // 进度回调
    canvasStore.executionLogs.push({
      id: `progress_${Date.now()}`,
      message: `[${done}/${total}] ${done === total ? '全部完成' : '继续下一个...'}`,
      level: done === total ? 'success' : 'info',
      createdAt: Date.now(),
    })
  }
}
```

### 1.8 落点防重叠

**抄自 T8：** `src/utils/nodePlacement.ts` 阿基米德螺线

新建 `src/components/canvas/utils/canvasPlacement.ts`：

```ts
// 新建文件：src/components/canvas/utils/canvasPlacement.ts

/**
 * 阿基米德螺线落点放置
 * 抄自 T8 src/utils/nodePlacement.ts
 */
export function spiralPlacement(
  baseX: number,
  baseY: number,
  occupiedRects: Array<{ x: number; y: number; w: number; h: number }>,
  nodeW = 320,
  nodeH = 200,
  stepR = 50,
): { x: number; y: number } {
  let angle = 0
  let r = 0
  const maxIter = 200

  for (let i = 0; i < maxIter; i++) {
    r = stepR * Math.sqrt(i)
    angle = i * 0.8 // 黄金角近似
    const x = baseX + r * Math.cos(angle)
    const y = baseY + r * Math.sin(angle)

    const overlaps = occupiedRects.some(
      rect => !(x + nodeW < rect.x || x > rect.x + rect.w ||
                 y + nodeH < rect.y || y > rect.y + rect.h)
    )
    if (!overlaps) return { x, y }
  }

  // 兜底：随机偏移
  return {
    x: baseX + (Math.random() - 0.5) * 400,
    y: baseY + (Math.random() - 0.5) * 400,
  }
}
```

### 1.9 GroupBox 打组系统

**抄自 T8：** `Canvas.tsx` + `stores/groupBus.ts` + `GroupBoxNode`

#### 1.9.1 新建 `src/stores/canvasGroupBus.ts`

```ts
// 新建文件：src/stores/canvasGroupBus.ts

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const GROUP_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
]

export const DEFAULT_GROUP_NAME = '节点组'

export const useCanvasGroupBusStore = defineStore('canvasGroupBus', () => {
  const groups = ref<Map<string, { name: string; color: string; memberIds: string[] }>>(new Map())

  function createGroup(name: string, memberIds: string[], color?: string): string {
    const id = `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    groups.value.set(id, {
      name: name || DEFAULT_GROUP_NAME,
      color: color || GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)],
      memberIds,
    })
    return id
  }

  function deleteGroup(id: string) {
    groups.value.delete(id)
  }

  function renameGroup(id: string, name: string) {
    const g = groups.value.get(id)
    if (g) g.name = name
  }

  return { groups, createGroup, deleteGroup, renameGroup }
})
```

#### 1.9.2 升级 `CanvasGroupNode.vue`

```ts
// 抄自 T8 GroupBoxNode:
// - 计算 bounding box + 30px padding + 40px 标题栏
// - zIndex=-1（在成员节点下方）
// - 拖动 GroupBox → 同步偏移 memberIds 所有子节点
// - 标题栏右键菜单：重命名/取消打组/组执行/改颜色

// 核心逻辑片段：
function onGroupDrag(event: any, groupNode: any) {
  const dx = groupNode.position.x - lastGroupPos.value.x
  const dy = groupNode.position.y - lastGroupPos.value.y
  lastGroupPos.value = { x: groupNode.position.x, y: groupNode.position.y }

  // 同步移动成员节点
  const memberIds = groupNode.data.memberIds || []
  for (const n of nodes.value) {
    if (memberIds.includes(n.id)) {
      n.position = {
        x: n.position.x + dx,
        y: n.position.y + dy,
      }
    }
  }
}
```

---

## 第二阶段：LLM 节点与工具箱全面搬运（预计 12h）

> 目标：T8 的 LLM 节点、工具箱 3 节点、所有辅助节点完整搬运

### 2.1 LLM 节点全面重写 — `CanvasLlmNode.vue`

**抄自 T8：** `src/components/nodes/LLMNode.tsx`（~800 行）

#### 2.1.1 核心能力对齐

| T8 功能 | 搬运方案 |
|---------|---------|
| 5 模型切换 (gemini-3.1-flash / gpt-4o / gemini-3.1-pro / gpt-5 / gpt-image-2-all) | 下拉选择器，模型列表从 `providers/models.ts` 取 |
| 独立 LLM Key | 从 `apiKeyRouter.pickApiKey(keys, 'llm')` 取 |
| 系统提示词 + 预设保存/加载 | localStorage `t8-llm-sys-presets` → idb `jc_llm_presets` |
| 温度 0~2 + maxTokens 100~128000 | 滑块 + 输入框 |
| 流式 SSE | 复用 `http_request_stream` Rust Command |
| image_output 模型检测 | `isImageOutputLlm(model)` → 非流式 + 出图 |
| 多模态 (vision) | 图片 URL/DataURL → `content: [{type:'image_url',...}, {type:'text',...}]` |
| 多轮会话历史 | `data.history: ChatTurn[]`，可清空/新建会话 |
| 上游自动消费 | `useUpstreamMaterials` 收集上游 text/image |
| @提及素材 | `MentionPromptInput` → 解析 @image1/@video1 等 |
| 素材拖入 | `useMaterialDropTarget` 接收 Ctrl+拖 image |
| 已消费文本标记 | `consumedTexts` 防止下游双重聚合 |

#### 2.1.2 内部运转逻辑（重点）

```ts
// LLM 节点执行流程（抄 T8 LLMNode handleRun）：

async function handleRun() {
  // 1. 收集上游素材
  const materials = collectUpstreamMaterials(nodeId) // text/image/video/audio
  
  // 2. 解析 @提及 → 替换为实际 URL
  const resolvedPrompt = resolveMediaMentions(userPrompt, userPromptMentions)
  
  // 3. 组装消息
  const messages: LlmMessage[] = []
  
  // 系统提示词
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  
  // 多轮历史
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.text })
  }
  
  // 当前用户消息（含多模态图片）
  const userContent: LlmContentPart[] = []
  for (const img of pickedImages) {
    userContent.push({ type: 'image_url', image_url: { url: img } })
  }
  userContent.push({ type: 'text', text: resolvedPrompt })
  messages.push({ role: 'user', content: userContent })
  
  // 4. 选 Key
  const keys = await loadApiKeys()
  const apiKey = pickApiKey(keys, 'llm')
  
  // 5. 调 API
  if (useStream && !isImageOutputLlm(model)) {
    // 流式 SSE → http_request_stream Rust Command
    const stream = await rustFetchStream({
      url: `${llmBaseUrl}/v1/chat/completions`,
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: { model, messages, temperature, max_tokens: maxTokens, stream: true },
    })
    // 逐块累积 appendStreamingText()
  } else {
    // 非流式（image_output 模型）
    const resp = await rustFetch({ ... })
    const replyText = resp.choices[0].message.content
    // 检测 generate_image 指令
    if (isImageOutputLlm(model)) {
      // 解析 markdown 中的图片链接
      extractGeneratedImages(replyText)
    }
  }
  
  // 6. 更新历史
  update({
    status: 'success',
    history: [...history, { role: 'assistant', text: replyText }],
    prompt: replyText, // 下游可消费
    consumedTexts: orderedTexts.map(t => t.url).filter(Boolean),
  })
}
```

#### 2.1.3 Key 流转链路

```
用户配置 → ApiSettings 弹窗 → 保存到 idb jc_api_keys
  ↓
LLM 节点执行 → pickApiKey(keys, 'llm')
  ↓
  ├── keys.llm 有值 → 使用独立 LLM Key
  └── keys.llm 为空 → fallback 到 keys.main（韭菜盒子通用 Key）
  ↓
rustFetchStream({ headers: { Authorization: `Bearer ${apiKey}` } })
  ↓
Tauri Rust http_request_stream → reqwest → NewAPI Gateway
```

### 2.2 工具箱 3 节点 — `CanvasToolboxNode.vue`

**抄自 T8：** `src/components/nodes/ToolboxParamNode.tsx`（~2700 行，T8 最复杂的节点之一）

#### 2.2.1 三种模式

```ts
// 通过 data.kind 区分：
type ToolboxKind = 'cinematic' | 'video-motion' | 'multi-angle-visual'
```

#### 2.2.2 电影感 (cinematic)

```ts
// 抄 T8 CINEMATIC_PRESETS / CINEMATIC_GROUPS
// 5 个维度，每个 50 项预设：

interface CinematicData {
  cinematicPresetId: string    // 成片风格（50项）
  cinematicShotId: string      // 镜头（50项）
  cinematicLightId: string     // 光影（50项）
  cinematicColorId: string     // 调色（50项）
  cinematicTextureId: string   // 质感（50项）
  cinematicStrength: number    // 强度 1-10
  cinematicCustom: string      // 自定义补充
  cinematicLanguage: 'en' | 'zh'
  cinematicFavorites: string[] // 收藏项 ID
}

// prompt 拼接逻辑（抄 T8 buildCinematicPrompt）：
function buildCinematicPrompt(data: CinematicData, patch?: Partial<CinematicData>): string {
  const d = { ...data, ...patch }
  const parts: string[] = []
  
  const preset = CINEMATIC_PRESETS.find(p => p.id === d.cinematicPresetId)
  if (preset) parts.push(`风格：${preset.zhText || preset.text}`)
  
  const shot = findCinematicItem('cinematicShotId', d.cinematicShotId)
  if (shot) parts.push(`镜头：${shot.zhText || shot.text}`)
  
  const light = findCinematicItem('cinematicLightId', d.cinematicLightId)
  if (light) parts.push(`光影：${light.zhText || light.text}`)
  
  const color = findCinematicItem('cinematicColorId', d.cinematicColorId)
  if (color) parts.push(`调色：${color.zhText || color.text}`)
  
  const texture = findCinematicItem('cinematicTextureId', d.cinematicTextureId)
  if (texture) parts.push(`质感：${texture.zhText || texture.text}`)
  
  if (d.cinematicStrength) parts.push(`强度：${d.cinematicStrength}/10`)
  if (d.cinematicCustom) parts.push(d.cinematicCustom)
  
  return parts.join('，')
}

// 收藏夹功能
function toggleFavorite(id: string) {
  const favs = data.cinematicFavorites || []
  const idx = favs.indexOf(id)
  if (idx >= 0) favs.splice(idx, 1)
  else favs.push(id)
  update({ cinematicFavorites: [...favs] })
}

// JSON 导入/导出收藏
function exportFavorites(): string {
  return JSON.stringify({
    cinematicPresetId,
    cinematicShotId,
    cinematicLightId,
    cinematicColorId,
    cinematicTextureId,
    favorites: cinematicFavorites,
    strength: cinematicStrength,
  }, null, 2)
}

function importFavorites(json: string) {
  const parsed = JSON.parse(json)
  update({ ...parsed })
}
```

#### 2.2.3 运镜 (video-motion)

```ts
// 抄 T8 MOTION_SCENE_PRESETS / MOTION_ACTION_PRESETS 等
// 6 个维度：

interface MotionData {
  motionSceneId: string      // 成片场景（50项）
  motionActionId: string     // 运镜动作（50项）
  motionPathId: string       // 运动路径（50项）
  motionRhythmId: string     // 节奏（50项）
  motionStabilityId: string  // 稳定方式（50项）
  motionSubjectId: string    // 主体描述（50项）
  motionCustom: string
  motionLanguage: 'en' | 'zh'
  motionFavorites: string[]
}

// prompt 拼接（抄 T8 buildMotionPrompt）
```

#### 2.2.4 多角度可视化 (multi-angle-visual)

```ts
// 抄 T8 multi-angle-visual 模式
// 3 个维度：方位角 / 俯仰角 / 距离

interface MultiAngleData {
  multiAngleAzimuth: number    // 方位角 0-360
  multiAngleElevation: number  // 俯仰角 -90~90
  multiAngleDistance: number   // 距离 1-10
  multiAngleMode: 'qwen' | 'general' | 'dual'
  multiAngleBatch: 'single' | 'three' | 'four' | 'eight' | 'custom'
  multiAngleCustomAngles: Array<{ a: number; e: number; d: number }>
}

// prompt 拼接（抄 T8 buildMultiAnglePrompt）
// 如果是 batch 模式，生成 N 个角度变体
```

#### 2.2.5 输出逻辑

```ts
// 工具箱节点执行 → 生成 text prompt → 写入 data.prompt
// → 下游节点通过 useUpstreamMaterials 收集到 prompt

async function handleRun() {
  let finalPrompt = ''
  if (kind === 'cinematic') finalPrompt = buildCinematicPrompt(data)
  else if (kind === 'video-motion') finalPrompt = buildMotionPrompt(data)
  else if (kind === 'multi-angle-visual') finalPrompt = buildMultiAnglePrompt(data)

  if (!finalPrompt) {
    setError('请先选择参数')
    return
  }

  update({ prompt: finalPrompt, status: 'success' })

  // 如果有下游 OutputNode，同步更新
  const downstreamOutputs = findDownstreamOutputs(nodeId)
  for (const outId of downstreamOutputs) {
    updateOutputNode(outId, { text: finalPrompt })
  }
}
```

### 2.3 上游素材收集系统 — `useUpstreamMaterials.ts`

**抄自 T8：** `src/components/nodes/useUpstreamMaterials.ts` + `useOrderedMaterials.ts`

```ts
// 新建：src/components/canvas/runtime/useUpstreamMaterials.ts

export interface Material {
  kind: 'text' | 'image' | 'video' | 'audio'
  url: string          // text: 实际文本, media: 资源 URL
  preview?: string     // 缩略图
  sourceNodeId: string
  order?: number       // 边上的 order（多输入排序）
}

/**
 * 收集指定节点的所有上游素材
 * 抄 T8 useUpstreamMaterials + useOrderedMaterials 合并
 */
export function useUpstreamMaterials(nodeId: string): {
  materials: ComputedRef<Material[]>
  orderedTexts: ComputedRef<Material[]>   // 按 order 排序的文本
  orderedImages: ComputedRef<Material[]>
  orderedVideos: ComputedRef<Material[]>
  orderedAudios: ComputedRef<Material[]>
  consumedTexts: ComputedRef<Set<string>> // 已被 LLM 消费的文本
} {
  const canvasStore = useCanvasStore()
  const flow = useVueFlow()

  // 获取上游节点：所有 source → 当前节点的边
  const incomingEdges = computed(() =>
    canvasStore.edges.filter(e => e.target === nodeId)
  )

  // 获取上游节点数据
  const materials = computed(() => {
    const result: Material[] = []
    for (const edge of incomingEdges.value) {
      const sourceNode = canvasStore.nodes.find(n => n.id === edge.source)
      if (!sourceNode) continue

      const data = sourceNode.data as any
      const portTypes = NODE_PORTS[sourceNode.type || '']?.outputs || []

      // 按端口类型收集
      if (portTypes.includes('text') && data.prompt) {
        result.push({
          kind: 'text',
          url: data.prompt,
          sourceNodeId: sourceNode.id,
          order: edge.data?.order ?? 0,
        })
      }
      if (portTypes.includes('image') && data.imageUrl) {
        const urls = Array.isArray(data.imageUrl) ? data.imageUrl : [data.imageUrl]
        for (const url of urls) {
          result.push({
            kind: 'image',
            url,
            sourceNodeId: sourceNode.id,
            order: edge.data?.order ?? 0,
          })
        }
      }
      // ... video/audio 同理
    }
    return result
  })

  // LLM 专属：过滤掉已被消费的文本（避免双重聚合）
  const consumedTexts = computed(() => {
    const llmNode = canvasStore.nodes.find(n => n.id === nodeId)
    return new Set((llmNode?.data as any)?.consumedTexts || [])
  })

  const orderedTexts = computed(() =>
    materials.value
      .filter(m => m.kind === 'text' && !consumedTexts.value.has(m.url))
      .sort((a, b) => (a.order || 0) - (b.order || 0))
  )

  // ... 同理 orderedImages/orderedVideos/orderedAudios

  return { materials, orderedTexts, orderedImages, orderedVideos, orderedAudios, consumedTexts }
}
```

### 2.4 @提及系统 — `MentionPromptInput`

**抄自 T8：** `src/components/nodes/MentionPromptInput.tsx` + `mediaMentions.ts`

```ts
// 新建：src/components/canvas/runtime/canvasMentions.ts

export interface MediaMention {
  kind: 'image' | 'video' | 'audio'
  index: number        // 第几个（从 1 开始）
  sourceNodeId?: string
}

/**
 * 解析 prompt 中的 @提及 → 替换为实际 URL
 * 抄 T8 resolveMediaMentions
 */
export function resolveMediaMentions(
  prompt: string,
  mentions: MediaMention[],
  materials: { kind: string; url: string }[],
): string {
  let resolved = prompt

  // 按 kind 分组计数
  const counters: Record<string, number> = { image: 0, video: 0, audio: 0 }
  const kindMaterials = {
    image: materials.filter(m => m.kind === 'image'),
    video: materials.filter(m => m.kind === 'video'),
    audio: materials.filter(m => m.kind === 'audio'),
  }

  for (const mention of mentions) {
    const list = kindMaterials[mention.kind] || []
    const idx = mention.index - 1 // 1-based → 0-based
    const mat = list[idx]
    if (mat) {
      // 替换 @image1 → 实际 URL
      resolved = resolved.replace(
        new RegExp(`@${mention.kind}${mention.index}`, 'gi'),
        mat.url,
      )
    }
  }

  return resolved
}

/**
 * 从 prompt 文本中解析 @提及
 */
export function parseMentions(prompt: string): MediaMention[] {
  const mentions: MediaMention[] = []
  const regex = /@(image|video|audio)(\d+)/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(prompt)) !== null) {
    mentions.push({
      kind: match[1] as any,
      index: parseInt(match[2], 10),
    })
  }
  return mentions
}

/**
 * MentionPromptInput 组件核心逻辑：
 *
 * 1. textarea 监听 input 事件
 * 2. 检测到 @ 字符 → 弹出素材选择浮层
 * 3. 浮层显示上游素材节点列表（image/video/audio）
 * 4. 点击素材 → 插入 @image1 / @video1 / @audio1
 * 5. 提交时 resolveMediaMentions 替换为 URL
 */
```

---

## 第三阶段：企鹅云 Magic 节点搬运（预计 10h）

> 目标：搬运 T8 的特殊节点（多角度3D、720全景、企鹅肖像、分镜网格）+ RunningHub 生态（4节点）

### 3.1 PresetImageNode — 特殊图像生成

**抄自 T8：** `src/components/nodes/PresetImageNode.tsx`

新建 `src/components/canvas/nodes/CanvasPresetImageNode.vue`：

```ts
// 通过 data.preset 区分模式：
type PresetMode = 'multi-angle-3d' | 'panorama-720' | 'penguin-portrait'

// 多角度 3D：自动循环 4 个视角（正面/背面/左侧/右侧）生成 4 张
async function handleRun() {
  if (data.preset === 'multi-angle-3d') {
    const angles = [
      { azimuth: 0, elevation: 0 },    // 正面
      { azimuth: 180, elevation: 0 },  // 背面
      { azimuth: -90, elevation: 0 },  // 左侧
      { azimuth: 90, elevation: 0 },   // 右侧
    ]
    const results: string[] = []
    for (const angle of angles) {
      const prompt = `3D render, ${data.prompt || ''}, azimuth ${angle.azimuth}°, elevation ${angle.elevation}°`
      const url = await generateImage({ prompt, model: 'gpt-image-2' })
      results.push(url)
    }
    update({ imageUrls: results, status: 'success' })
  }
  
  // 720 全景：16:9 超宽 + 固定 prompt 模板
  if (data.preset === 'panorama-720') {
    const prompt = `360 degree panoramic view, equirectangular projection, ${data.prompt || ''}, seamless`
    const url = await generateImage({ prompt, model: 'gpt-image-2', aspectRatio: '16:9' })
    update({ imageUrl: url, status: 'success' })
  }
  
  // 企鹅肖像：人物肖像专用流程
  if (data.preset === 'penguin-portrait') {
    const prompt = `professional portrait photography, ${data.prompt || ''}, studio lighting, bokeh`
    const url = await generateImage({ prompt, model: 'gpt-image-2' })
    update({ imageUrl: url, status: 'success' })
  }
}
```

### 3.2 StoryboardGridNode — 分镜网格

**抄自 T8：** `src/components/nodes/StoryboardGridNode.tsx`

新建 `src/components/canvas/nodes/CanvasStoryboardGridNode.vue`：

```ts
// 核心逻辑：
// 1. 接收上游图像（或多张图像）
// 2. 排列为 3×3 九宫格分镜布局
// 3. 每格支持独立的 prompt 微调
// 4. 输出拼接后的分镜大图（imageUrl）
// 5. 也可输出 imageUrls 数组给下游逐格处理

// T8 中有独立的 canvasTemplates 预设工作流：
// text → multi-angle-3d → storyboard-grid
// 完整链路：提示词 → 多角度生成 → 分镜排列
```

### 3.3 PortraitMetadataNode — 肖像元数据

**抄自 T8：** `src/components/nodes/PortraitMetadataNode.tsx`

```ts
// 入库肖像元数据，作为 rh-config 的参数注入源
// 输出 portType = 'metadata'

interface PortraitMetadata {
  gender: string
  age: string
  hairColor: string
  eyeColor: string
  skinTone: string
  expression: string
  clothing: string
  pose: string
  lighting: string
}
// 输出 → downstream RunningHub 节点 → nodeInfoList 参数自动填充
```

### 3.4 RunningHub 生态完整搬运

#### 3.4.1 RunningHubNode — RH 工作流主节点

**抄自 T8：** `src/components/nodes/RunningHubNode.tsx`（~850 行）

核心内部运转逻辑：

```ts
// RH 节点执行流程：

async function handleRun() {
  // 1. 获取 webappId 和 apiCallDemo
  const webappId = data.webappId
  if (!webappId) { setError('请输入 webappId'); return }
  
  const nodeInfoList = await fetchRhAppInfo(webappId)
  // → GET https://www.runninghub.cn/api/webapp/apiCallDemo?apiKey=xxx&webappId=yyy
  
  // 2. 解析字段元数据
  const fields = parseRhApiCallDemo(nodeInfoList)
  // fieldType 推断：IMAGE/VIDEO/AUDIO/STRING/NUMBER/LIST/SELECT → text/number/image/video/audio/select
  
  // 3. 从上游节点收集素材
  const upstreamUrls = collectUpstreamUrls() // text/image/video/audio/config
  
  // 4. 媒体字段「从上游自动获取」：勾选后自动从连接的上游节点提取 URL
  //    未勾选 → 用户手动输入/上传
  
  // 5. 上传素材到 RH（媒体字段需要先转成 RH 内部 fileName）
  for (const f of mediaFields) {
    if (f.sourceFromUpstream) {
      const url = upstreamUrls.get(f.fieldName)
      if (url) {
        const fileName = await uploadRhAsset(url) // POST /runninghub/upload-asset
        f.fieldValue = fileName
      }
    }
  }
  
  // 6. 提交任务
  const taskId = await submitRh({
    apiKey: pickApiKey(keys, 'runninghub'), // 或 runninghub-wallet
    webappId,
    nodeInfoList: fields.map(f => ({
      nodeId: f.nodeId,
      fieldName: f.fieldName,
      fieldValue: f.fieldValue,
    })),
    instanceType: data.instanceType || '', // 可选 plus
  })
  
  // 7. 轮询结果（5s 间隔）
  const result = await pollRhTask(taskId)
  // → 下载 outputs → 转存到本地 /output → 更新 data.imageUrl / data.videoUrl
}
```

#### 3.4.2 RhConfigNode — RH 参数配置

**抄自 T8：** `src/components/nodes/RhConfigNode.tsx`

```ts
// RhConfigNode 是 RunningHub 的参数预配置节点
// 输入：任意上游 text/image/video/audio
// 输出：portType = 'config'（注入到 downstream RunningHubNode）

interface NodeInfo {
  nodeId: string
  fieldName: string
  fieldValue: string
  sourceFromUpstream: boolean  // true=从上游自动提取
}

// 核心价值：把常用的 RH 参数打包为一个独立节点，可复用到多个 RH 工作流
```

#### 3.4.3 RHToolsNode — RH 工具超市

**抄自 T8：** `src/components/nodes/RHToolsNode.tsx`（~800 行）

```ts
// 双视图设计：
// 视图 1「启动器」：分类 Tab + 应用按钮网格（2列）+ 搜索 + 增删改导入导出
// 视图 2「运行器」：完全复用 RunningHubNode 的运行链路
//   - 上游素材聚合预览
//   - 拉取 nodeInfoList → 表单展开
//   - 实例类型 select
//   - submit → 轮询 → 输出

// 关键数据结构：
interface RHTool {
  id: string
  webappId: string
  title: string
  description?: string
  categoryId?: string
  icon?: string
}

// 搜索：拼音模糊匹配
import { fuzzyMatch } from '@/utils/pinyinMatch'
```

#### 3.4.4 Key 流转（RH 专用链路）

```
用户配置 → ApiSettings 弹窗 → 保存到 idb
  ↓
RH 节点执行 → pickApiKey(keys, 'runninghub') 或 rhApiKey
  ↓
  ├── keys.rh 有值 → 使用独立 RH Key
  └── keys.rh 为空 → 检查 keys.main
      ├── keys.main 是 RH 格式 → 使用
      └── fallback → 提示「请配置 RunningHub API Key」
  ↓
HTTP 请求 → https://www.runninghub.cn/
  - GET /api/webapp/apiCallDemo
  - POST /runninghub/submit
  - GET /runninghub/query
  - POST /runninghub/upload-asset
```

---

## 第四阶段：视频 SD2.0 + 视频节点搬运（预计 10h）

> 目标：搬运 Seedance 2.0 节点、完整 Video 节点、音频节点 Suno 全模式

### 4.1 SeedanceNode — Seedance 2.0 视频分镜

**抄自 T8：** `src/components/nodes/SeedanceNode.tsx`（~600 行）

#### 4.1.1 核心能力

```ts
// Seedance 2.0 支持 5 种输入类型：
// - text → prompt（文字描述生成视频）
// - image → reference_image（参考图生成视频）
// - image → first_frame / last_frame（首帧/尾帧）
// - video → reference_video（参考视频）
// - audio → reference_audio（参考音频）

interface SeedanceSubmitRequest {
  model: string              // seedance-2.0 或 seedance-2.0-fast
  prompt: string
  negative_prompt?: string
  reference_image?: string   // base64
  first_frame_image?: string
  last_frame_image?: string
  reference_video?: string
  reference_audio?: string
  duration?: number          // 5/10 秒
  aspect_ratio?: string      // 16:9 / 9:16 / 1:1
  motion_bucket_id?: number  // 运动幅度 1-255
  seed?: number
  cfg_scale?: number         // 提示词遵循度 1-20
}

// 轮询 → 下载 → 存入 output
```

#### 4.1.2 内部运转逻辑

```ts
async function handleRun() {
  // 1. 收集上游素材
  const materials = collectUpstreamMaterials(nodeId)
  // 按端口语义分配：
  //   text → prompt
  //   image[0] → reference_image (或 first_frame)
  //   image[1] → last_frame (如有)
  //   video → reference_video
  //   audio → reference_audio

  // 2. 组装请求
  const req: SeedanceSubmitRequest = {
    model: data.model || 'seedance-2.0',
    prompt: data.prompt || orderedTexts[0]?.url || '',
    ...buildSeedanceFromMaterials(materials),
    duration: data.duration || 5,
    aspect_ratio: data.aspectRatio || '16:9',
    motion_bucket_id: data.motionBucketId || 127,
  }

  // 3. 选 Key
  const keys = await loadApiKeys()
  const apiKey = pickApiKey(keys, 'seedance')

  // 4. 提交 + 轮询
  const taskId = await submitSeedance(req, apiKey)
  // → POST https://api.t8star.org/seedance/v3/submit
  //   或 → POST https://api.t8star.org/seedance/v3/submit (独立 /seedance/v3 路径)
  
  const result = await pollSeedanceTask(taskId, apiKey)
  // → GET /seedance/v3/query/:taskId
  // → 下载 video_url → 存入本地 → 更新 data.videoUrl
}
```

#### 4.1.3 Seedance Key 流转

```
pickApiKey(keys, 'seedance')
  ↓
  ├── keys.seedance 有值 → 独立 Seedance Key → 走 /seedance/v3 路径
  └── keys.seedance 为空 → fallback keys.main
      ↓
      请求: Authorization: Bearer ${key}
      ↓
      POST https://api.t8star.org/seedance/v3/submit
```

### 4.2 VideoNode 完整重写

**抄自 T8：** `src/components/nodes/VideoNode.tsx`

#### 4.2.1 多模型 TAB 切换

```ts
// TAB 1: Veo 3.1 — Google 视频模型
// TAB 2: Grok Video — xAI 视频模型

interface VideoData {
  videoTab: 'veo' | 'grok'
  
  // Veo 参数
  veoModel: string           // veo3.1-fast / veo3.1
  veoPrompt: string
  veoReferenceImages: string[] // 最多 3 张参考图
  veoDuration: number         // 4/6/8 秒
  veoAspectRatio: string      // 16:9 / 9:16
  
  // Grok 参数
  grokPrompt: string
  grokReferenceImages: string[] // 最多 7 张
  grokDuration: number
  
  // 输出
  videoUrl: string
  status: string
}
```

#### 4.2.2 Veo 3.1 调用链路

```ts
async function runVeo() {
  const keys = await loadApiKeys()
  const apiKey = pickApiKey(keys, 'veo')
  
  // POST https://api.t8star.org/v1/videos
  const taskId = await submitVeoVideo({
    model: veoModel,
    prompt: veoPrompt,
    reference_images: veoReferenceImages.slice(0, 3),
    duration: veoDuration,
    aspect_ratio: veoAspectRatio,
  }, apiKey)
  
  // 轮询 GET /v1/videos/:taskId
  const result = await pollVideoTask(taskId, apiKey)
  update({ videoUrl: result.video_url, status: 'success' })
}
```

#### 4.2.3 Grok Video 调用链路

```ts
async function runGrok() {
  const keys = await loadApiKeys()
  const apiKey = pickApiKey(keys, 'grok')
  
  // POST https://api.t8star.org/v1/videos
  const taskId = await submitGrokVideo({
    prompt: grokPrompt,
    reference_images: grokReferenceImages.slice(0, 7),
  }, apiKey)
  
  // 轮询...
}
```

#### 4.2.4 Video 鉴权流转

```
Video 节点 → 根据 TAB 选择模型:
  ├── Veo  → NewAPI /v1/videos
  └── Grok → NewAPI /v1/videos → rh-adapter
       ↓
  统一使用主 NewAPI Token
```

### 4.3 AudioNode 完整重写

**抄自 T8：** `src/components/nodes/AudioNode.tsx`

#### 4.3.1 Suno V5.5 全模式

```ts
type AudioMode = 'generate' | 'cover' | 'continue'

interface AudioData {
  mode: AudioMode
  version: string            // v5.5 / v5
  title: string
  tags: string               // 风格标签
  prompt: string             // 生成模式：歌词/描述
  negativeTags?: string
  seed?: number
  
  // 翻唱模式
  refAudioUrl?: string       // 参考音频 URL
  refText?: string           // 翻唱歌词
  
  // 续写模式
  continueAt?: number        // 从第 N 秒续写
  sourceAudioUrl?: string    // 源音频
  
  // 输出
  audioUrl: string
  status: string
}
```

#### 4.3.2 Audio Key 流转

```ts
// Suno 调用链路：
pickApiKey(keys, 'suno')
  ↓
POST https://api.t8star.org/suno/submit/music
  body: { prompt, title, tags, model: 'V5_5', ... }
  ↓
轮询 GET /suno/fetch/:taskId
  ↓
下载 audio_url → 更新 data.audioUrl
```

### 4.4 FrameExtractorNode — 视频抽帧

**抄自 T8：** `src/components/nodes/FrameExtractorNode.tsx`

```ts
// 输入：video url
// 输出：抽取的帧 image urls
// 参数：抽帧间隔（秒）、最大帧数
// 执行：ffmpeg 本地抽帧

async function handleRun() {
  const videoUrl = data.videoUrl || upstreamVideos[0]?.url
  if (!videoUrl) { setError('无视频输入'); return }
  
  // 调 ffmpeg 抽帧
  const frames = await extractFrames(videoUrl, {
    interval: data.interval || 1,  // 每秒抽 1 帧
    maxFrames: data.maxFrames || 10,
  })
  
  update({ imageUrls: frames, status: 'success' })
}
```

### 4.5 FramePairNode — 首尾帧

**抄自 T8：** `src/components/nodes/FramePairNode.tsx`

```ts
// 输入：2 张图像（首帧 + 尾帧）
// 输出：拼接后的首尾帧合成图
// 用途：作为 Seedance/Video 节点的 first_frame + last_frame 输入
```

### 4.6 LoopNode — 循环器

**抄自 T8：** `src/components/nodes/LoopNode.tsx`

```ts
// 核心：串联循环 / 并联循环
// 
// 串联 (serial)：
//   每轮把第 i 个素材注入自身 → 触发下游子图 → 等完成 → 下一轮
//
// 并联 (parallel)：
//   克隆 (N-1) 份下游子图 + upload 节点 → 并发触发 N 条链 → 等所有完成

async function handleRun() {
  const items = materials.value  // 上游 N 个同类型素材
  const downstreamSubgraph = getDownstreamExecutableSubgraph(nodeId)
  
  if (mode === 'serial') {
    const results = []
    for (const item of items) {
      injectItem(item)  // 注入当前轮素材
      await runSubgraph(downstreamSubgraph)  // 等完成
      results.push(collectOutputs())
    }
    update({ outputs: results, status: 'success' })
  }
  
  if (mode === 'parallel') {
    const clones = cloneSubgraph(downstreamSubgraph, items.length - 1)
    await Promise.all(clones.map(clone => runSubgraph(clone)))
    update({ outputs: collectAllOutputs(), status: 'success' })
  }
}
```

### 4.7 RelayNode — 中继

**抄自 T8：** `src/components/nodes/RelayNode.tsx`

```ts
// 核心：全字段透传
// 输入：any 类型（任意上游）
// 输出：any 类型
// 行为：把上游所有字段原样复制到 data，供下游消费
//
// 透传字段：prompt / imageUrl / videoUrl / audioUrl / imageUrls / urls
//
// 关键逻辑：
// - upstreamSignature useMemo 防 setState 风暴
// - 零上游时主动清空所有字段
// - 节点内指示器图标：📝文本 / 🖼图 / 🎬视频 / 🎵音频

function syncFromUpstream() {
  const upstreamNodes = getUpstreamNodes(nodeId)
  if (upstreamNodes.length === 0) {
    // 零上游 → 清空
    update({ prompt: '', imageUrl: '', videoUrl: '', audioUrl: '' })
    return
  }
  
  // 聚合所有上游字段
  const combined = {}
  for (const up of upstreamNodes) {
    const d = up.data as any
    if (d.prompt && !combined.prompt) combined.prompt = d.prompt
    if (d.imageUrl && !combined.imageUrl) combined.imageUrl = d.imageUrl
    if (d.videoUrl && !combined.videoUrl) combined.videoUrl = d.videoUrl
    if (d.audioUrl && !combined.audioUrl) combined.audioUrl = d.audioUrl
  }
  
  update(combined)
}
```

### 4.8 素材集节点 MaterialSetNode

**抄自 T8：** `src/components/nodes/MaterialSetNode.tsx`

```ts
// 将多个同类型素材打包为可排序的集合
// 支持 text / image / video / audio 四种素材集
// 内部 dnd-kit 拖拽排序 → 输出有序的 urls 数组

interface MaterialSetData {
  materialSetKind: 'text' | 'image' | 'video' | 'audio' | null
  materialSetItems: Array<{
    id: string
    url: string
    preview?: string
    label?: string
    order: number
  }>
}
```

---

## 第五阶段：跨节点素材拖拽（预计 6h）

> 目标：补全 Ctrl+拖素材缩略图的跨节点投递能力

### 5.1 MaterialDragStore

**抄自 T8：** `src/stores/dragMaterial.ts`

```ts
// 新建：src/stores/canvasDragStore.ts

interface MaterialPayload {
  kind: 'image' | 'video' | 'audio' | 'text'
  url: string
  preview?: string
  sourceNodeId: string
}

export const useCanvasDragStore = defineStore('canvasDrag', () => {
  const active = ref(false)
  const payload = ref<MaterialPayload | null>(null)
  const position = ref({ x: 0, y: 0 })
  const acceptTarget = ref<string | null>(null)

  function beginDrag(p: MaterialPayload, pos: { x: number; y: number }) {
    active.value = true
    payload.value = p
    position.value = pos
  }

  function endDrag() {
    active.value = false
    payload.value = null
    acceptTarget.value = null
  }

  return { active, payload, position, acceptTarget, beginDrag, endDrag }
})
```

### 5.2 MaterialDragOverlay — 幽灵缩略图

**抄自 T8：** `src/components/Canvas.tsx` 中的 `MaterialDragOverlay`

```vue
<!-- 新建：src/components/canvas/MaterialDragOverlay.vue -->

<template>
  <Teleport to="body">
    <div
      v-if="dragStore.active && dragStore.payload"
      class="material-drag-overlay"
      :style="{
        left: dragStore.position.x - 20 + 'px',
        top: dragStore.position.y - 20 + 'px',
      }"
    >
      <img
        v-if="dragStore.payload.kind === 'image'"
        :src="dragStore.payload.preview || dragStore.payload.url"
        class="w-10 h-10 object-cover rounded border-2 border-emerald-400"
      />
      <div v-else class="w-10 h-10 rounded border-2 border-emerald-400 flex items-center justify-center bg-emerald-400/10">
        <span class="text-[10px] text-emerald-400">{{ dragStore.payload.kind }}</span>
      </div>
    </div>
  </Teleport>
</template>
```

### 5.3 useMaterialDragSource — 素材源

```ts
// 在结果节点（ImageResult/VideoResult/AudioResult）的缩略图上：
// Ctrl+pointerdown → beginDrag
// data-drag-source / data-drag-kind / data-drag-url / data-drag-preview / data-drag-node-id

function onThumbnailPointerDown(event: PointerEvent, material: MaterialPayload) {
  if (!event.ctrlKey) return // 只有 Ctrl+拖才启动素材拖拽
  event.preventDefault()
  dragStore.beginDrag(material, { x: event.clientX, y: event.clientY })
  
  const onMove = (e: PointerEvent) => {
    dragStore.position = { x: e.clientX, y: e.clientY }
    // 检测鼠标下方的目标节点
    const target = document.elementFromPoint(e.clientX, e.clientY)
    const nodeEl = target?.closest('[data-drop-kinds]')
    if (nodeEl) {
      dragStore.acceptTarget = nodeEl.getAttribute('data-node-id')
    } else {
      dragStore.acceptTarget = null
    }
  }
  
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    dragStore.endDrag()
  }
  
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
```

### 5.4 useMaterialDropTarget — 接收方

```ts
// 在生成节点（ImageGen/VideoGen/AudioGen/LLM/Seedance）上：
// data-drop-kinds 声明接收能力
// isAccepting → 绿色光晕 CSS class

const DROP_MAPPING: Record<string, Record<string, string>> = {
  'image': { image: 'referenceImages', text: 'prompt' },
  'video': { image: 'localRefImages', video: 'localRefVideo', text: 'prompt' },
  'seedance': { image: 'referenceImages', video: 'referenceVideo', audio: 'referenceAudio', text: 'prompt' },
  'audio': { audio: 'localRefAudio', text: 'prompt' },
  'llm': { image: 'pickedFiles', text: 'prompt' },
}

function onMaterialDrop(kind: string, url: string) {
  const mapping = DROP_MAPPING[nodeType]
  if (!mapping) return
  
  const targetField = mapping[kind]
  if (!targetField) return
  
  if (targetField === 'prompt') {
    // 追加入 prompt 文本
    update({ prompt: (data.prompt || '') + `\n[参考${kind}]: ${url}` })
  } else {
    // 追加到数组
    const existing = data[targetField] || []
    update({ [targetField]: [...existing, url] })
  }
}
```

---

## 第六阶段：API Key 管理体系（预计 4h，可并行）

> 目标：多 Key 分类隔离 + 安全存储 + 设置 UI

### 6.1 ApiKeyRouter

```ts
// 新建：src/services/apiKeyRouter.ts

export interface ApiKeySet {
  main: string           // 韭菜盒子通用
  rh?: string            // RunningHub
  llm?: string           // LLM 独立
  gptImage?: string
  nanoBanana?: string
  mj?: string
  veo?: string
  grok?: string
  seedance?: string
  suno?: string
}

const CLASSIFIED_KEY_MAP: Record<string, keyof ApiKeySet> = {
  'gpt-image': 'gptImage', 'gpt-image-2': 'gptImage',
  'nano-banana': 'nanoBanana', 'nano-banana-2k': 'nanoBanana', 'nano-banana-4k': 'nanoBanana',
  'midjourney': 'mj',
  'veo': 'veo', 'veo3.1': 'veo',
  'grok': 'grok', 'grok-video': 'grok',
  'seedance': 'seedance', 'seedance-2.0': 'seedance',
  'suno': 'suno',
  'runninghub': 'rh',
  'llm': 'llm',
}

export function pickApiKey(keys: ApiKeySet, hint: string): string {
  // 1. 分类 Key
  const classified = CLASSIFIED_KEY_MAP[hint]
  if (classified && keys[classified]) return keys[classified]!

  // 2. 渠道专属
  if ((hint === 'runninghub' || hint === 'rh') && keys.rh) return keys.rh
  if (hint === 'llm' && keys.llm) return keys.llm

  // 3. fallback 主 Key
  return keys.main
}

// 存储：idb（IndexedDB），不是 localStorage
export async function loadApiKeys(): Promise<ApiKeySet> {
  const { getItem } = await import('@/utils/idb')
  const raw = await getItem('jcApiKeys')
  if (raw) return JSON.parse(raw)
  const legacy = localStorage.getItem('jcApiKey') || ''
  return { main: legacy }
}

export async function saveApiKeys(keys: ApiKeySet): Promise<void> {
  const { setItem } = await import('@/utils/idb')
  await setItem('jcApiKeys', JSON.stringify(keys))
  // 同步主 Key 到 session token
  if (keys.main) {
    const { setGatewaySessionToken } = await import('@/services/gatewayClient')
    await setGatewaySessionToken(keys.main)
  }
}
```

### 6.2 ApiSettingsModal — 多 Key 设置弹窗

**抄自 T8：** `src/components/ApiSettings.tsx`

```
┌──────────────────────────────────────────┐
│              ⚙️ API Key 设置              │
├──────────────────────────────────────────┤
│  通用 Key（韭菜盒子通行）                  │
│  ┌──────────────────────────────────┐    │
│  │ ● 贞贞工坊 API Key  [********] 👁 │    │
│  │   https://ai.t8star.org（固定）    │    │
│  └──────────────────────────────────┘    │
│                                          │
│  媒体生成统一使用主 NewAPI Token           │
│  不提供渠道 BYOK / 独立 Key 配置           │
│                                          │
│  分类 Key（留空使用通用 Key）              │
│  ┌──────────────────────────────────┐    │
│  │ ● gpt-image 系列   [______] 👁   │    │
│  │ ● Nano Banana      [______] 👁   │    │
│  │ ● Midjourney       [______] 👁   │    │
│  │ ● Veo 系列         [______] 👁   │    │
│  │ ● Grok 系列        [______] 👁   │    │
│  │ ● Seedance 系列    [______] 👁   │    │
│  │ ● Suno 系列        [______] 👁   │    │
│  └──────────────────────────────────┘    │
│                                          │
│  自动保存路径                             │
│  ┌──────────────────────────────────┐    │
│  │ 生成素材保存到：[D:\zhenzhen 📁]  │    │
│  └──────────────────────────────────┘    │
│                                          │
│            [保存]  [取消]                 │
└──────────────────────────────────────────┘
```

#### 安全要点

```
Key 存储安全（抄 T8）：
1. 前端 SETTINGS 接口只返回脱敏值（****xxxx）
2. 明文 Key 仅供后端代理本地使用
3. 韭菜盒子：主 Key 存 Tauri Rust 侧 .session 文件（0600权限）
   子 Key 存 idb（IndexedDB）
4. 只在 getRawSettings 时返回明文（用于设置弹窗眼睛预览）
```

---

## 七、总执行计划

### 时间线和依赖

```
Phase  Stage 1 (基础)      ████████░░  8h
Phase  Stage 2 (LLM+工具箱) ████████████  12h  ← 依赖 Stage1 端口系统
Phase  Stage 6 (Key管理)   ████░░  4h  ← 可与 Stage1-2 并行
Phase  Stage 3 (Magic节点) ██████████  10h  ← 依赖 Stage1 端口+Key
Phase  Stage 4 (视频节点)   ██████████  10h  ← 依赖 Stage1 端口+Key
Phase  Stage 5 (素材拖拽)  ██████░░  6h  ← 依赖 Stage2+3+4 节点
                                    ────
                                    50h 总计
```

### 文件改动清单（按阶段）

#### Stage 1 — 基础功能对齐（15 个文件）

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `src/components/canvas/config/portTypes.ts` | 端口类型注册表 + 校验 |
| 新建 | `src/components/canvas/config/nodeRegistry.ts` | 38 节点元数据注册表 |
| 新建 | `src/components/canvas/utils/canvasPlacement.ts` | 阿基米德螺线落点 |
| 新建 | `src/components/canvas/utils/canvasTopologicalSort.ts` | Kahn 拓扑排序 |
| 新建 | `src/stores/canvasGroupBus.ts` | GroupBox 总线 |
| 改造 | `src/types/canvas.ts` | 新增 27 个节点类型 |
| 改造 | `src/components/canvas/CanvasWorkspace.vue` | 对齐辅助线+框选菜单+快捷键+右键菜单+拖拽吸附 |
| 改造 | `src/components/canvas/CanvasGroupNode.vue` | GroupBox 拖拽同步成员 |
| 改造 | `src/components/canvas/runtime/canvasExecutor.ts` | Kahn 拓扑串行执行 |
| 改造 | `src/stores/canvasStore.ts` | groupSelectedNodes/duplicateNode/新增 NODE_REGISTRY 集成 |
| 改造 | `src/components/canvas/CanvasToolbar.vue` | 批量执行进度+中断 |
| 改造 | `src/components/canvas/CanvasNodeLibrary.vue` | 按 category 分组+搜索 |
| 新建 | `src/components/canvas/CanvasAlignGuides.vue` | SVG 对齐辅助线渲染 |
| 新建 | `src/components/canvas/CanvasSelectionMenu.vue` | 框选自动菜单 |

#### Stage 2 — LLM + 工具箱（10 个文件）

| 操作 | 文件 | 说明 |
|------|------|------|
| 重写 | `src/components/canvas/nodes/CanvasLlmNode.vue` | 5模型+多模态+流式+历史+@提及 |
| 新建 | `src/components/canvas/nodes/CanvasToolboxNode.vue` | 3模式(cinematic/video-motion/multi-angle-visual) |
| 新建 | `src/components/canvas/runtime/useUpstreamMaterials.ts` | 上游素材收集+排序+消费标记 |
| 新建 | `src/components/canvas/runtime/canvasMentions.ts` | @提及解析+素材选择浮层 |
| 新建 | `src/components/canvas/nodes/CanvasMentionPromptInput.vue` | @素材输入组件 |
| 新建 | `src/components/canvas/nodes/CanvasMaterialPreviewSection.vue` | 素材预览区（可排序缩略图） |
| 新建 | `src/data/llmModels.ts` | LLM 模型定义+能力标记 |
| 新建 | `src/data/toolboxPresets.ts` | 电影感/运镜/多角度预设（50项×3×N） |

#### Stage 3 — Magic 节点（8 个文件）

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `src/components/canvas/nodes/CanvasPresetImageNode.vue` | 多角度3D/720全景/企鹅肖像 |
| 新建 | `src/components/canvas/nodes/CanvasStoryboardGridNode.vue` | 分镜九宫格 |
| 新建 | `src/components/canvas/nodes/CanvasPortraitMetadataNode.vue` | 肖像元数据 |
| 新建 | `src/components/canvas/nodes/CanvasRunningHubNode.vue` | RH 工作流主节点 |
| 新建 | `src/components/canvas/nodes/CanvasRhConfigNode.vue` | RH 参数预配置 |
| 新建 | `src/components/canvas/nodes/CanvasRHToolsNode.vue` | RH 工具超市 |
| 新建 | `src/components/canvas/runtime/canvasRhSmart.ts` | RH apiCallDemo 解析+表单生成 |
| 新建 | `src/api/runninghub.ts` | RH API 调用封装 |

#### Stage 4 — 视频 + 音频（12 个文件）

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `src/components/canvas/nodes/CanvasSeedanceNode.vue` | Seedance 2.0 视频分镜 |
| 重写 | `src/components/canvas/nodes/CanvasVideoGenNode.vue` | Veo/Grok 双TAB |
| 重写 | `src/components/canvas/nodes/CanvasAudioGenNode.vue` | Suno V5.5 全模式 |
| 新建 | `src/components/canvas/nodes/CanvasFrameExtractorNode.vue` | ffmpeg 抽帧 |
| 新建 | `src/components/canvas/nodes/CanvasFramePairNode.vue` | 首尾帧合成 |
| 新建 | `src/components/canvas/nodes/CanvasLoopNode.vue` | 串/并联循环器 |
| 新建 | `src/components/canvas/nodes/CanvasRelayNode.vue` | 全字段透传中继 |
| 新建 | `src/components/canvas/nodes/CanvasPickFromSetNode.vue` | 索引取元素 |
| 新建 | `src/components/canvas/nodes/CanvasMaterialSetNode.vue` | 素材集打包 |
| 新建 | `src/components/canvas/nodes/CanvasOutputNode.vue` | 终端输出预览 |
| 新建 | `src/components/canvas/nodes/CanvasUploadNode.vue` | 三合一上传 |

#### Stage 5 — 素材拖拽（5 个文件）

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `src/stores/canvasDragStore.ts` | 全局拖拽状态 |
| 新建 | `src/composables/useMaterialDragSource.ts` | 素材源标记+Ctrl+拖启动 |
| 新建 | `src/composables/useMaterialDropTarget.ts` | 接收方注册+映射表 |
| 新建 | `src/components/canvas/MaterialDragOverlay.vue` | 幽灵缩略图 |
| 改造 | 所有结果/生成节点 | 加 data-drag-source/data-drop-kinds |

#### Stage 6 — Key 管理（4 个文件）

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `src/services/apiKeyRouter.ts` | pickApiKey 路由+分类映射 |
| 新建 | `src/components/canvas/ApiKeySettingsModal.vue` | 多Key设置弹窗 |
| 改造 | `src/utils/api.ts` | resolveApiConfig 增加 keyHint |
| 改造 | `src/api/media-generation.ts` | ensureConfig 增加 keyHint |

---

## 八、风险与注意事项

### 8.1 架构差异风险

| 风险 | T8 做法 | 韭菜盒子适配 | 影响 |
|------|---------|-------------|------|
| React → Vue3 | React Hooks + Zustand | Vue Composition API + Pinia | 所有 Hooks 需重写为 composables |
| xyflow → VueFlow | @xyflow/react | @vue-flow/core | API 相似但细节不同（如 `useReactFlow()` → `useVueFlow()`） |
| Node Express 后端 | 后端代理所有第三方 API | Tauri Rust 直连 + http_request_stream | 需要前移 proxy 层的 pickApiKey 逻辑 |
| dnd-kit → 自研 | React dnd-kit 拖拽排序 | Vue Draggable 或手写 | 素材预览区排序需另选方案 |

### 8.2 安全注意事项

1. **Key 不泄露到前端日志**：所有 console.log 必须脱敏 Key
2. **子 Key 存 idb**（不是 localStorage，防止 XSS 读取）
3. **主 Key 存 Rust 侧** `.session` 文件（0600 权限，已有）
4. **上传文件路径校验**：防止路径遍历（`../` 攻击）
5. **RH 素材上传 URL 校验**：只允许 `https://` 协议

### 8.3 已有改动的影响

- 改造 `canvasStore.ts` 时注意兼容现有 11 个节点类型的 `data` 结构
- `CanvasNodeType` 新增 27 个类型，确保 `defaultCanvasDataForType` switch-case 完整
- `canvasExecutor.ts` 的 `runCanvasNode` 新增所有新节点类型的 dispatch

### 8.4 优先级建议

如果时间有限，按此顺序实施：

1. **P0（阻塞性）**：Stage 6 Key 管理 + Stage 1 端口系统 → 否则节点无法正确连接
2. **P1（用户感知强）**：Stage 2 LLM 节点重写 + Stage 4 Video/Audio/Seedance → 核心生成链路
3. **P2（增强体验）**：Stage 1 对齐/批量/GroupBox + Stage 3 Magic节点
4. **P3（锦上添花）**：Stage 5 素材拖拽 + 工具箱节点

---

> 文档版本：v1.0 | 最后更新：2026-05-27
> 下一步：确认方案后按 Stage 逐一创建具体实现 issue 并开始编码
