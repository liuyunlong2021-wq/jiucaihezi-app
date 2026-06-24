# 画布系统优化 SDD

> 参考来源：`/Users/by3/Documents/huobao-canvas`（火豹画布）
> 状态：草案
> 最后更新：2026-06-05

---

## 一、背景

当前画布系统（V7.x T8 迁入骨架）已积累了若干明确的技术债和体验短板：

1. `canvasSerialization.ts` 节点类型白名单仅 11 种，而 `canvas.ts` 已注册 56 种；T8 迁入的节点被 `sanitize` 静默丢弃，用户保存后重开画布节点消失。
2. 历史管理有两套并行机制（`canvasStore.history` + `useCanvasHistory` composable），状态可能不一致。
3. 执行引擎 `canvasExecutor.ts` 纯串行，独立分支逐节点等待，多分支工作流速度慢。
4. LLM 节点等全量响应才更新，无流式输出。
5. 批量创建节点（工作流模板展开）每个节点单独压栈，生成 5 个节点就产生 5 条 undo 历史。
6. 连线上的图片角色（首帧/尾帧/参考图）需要打开节点面板修改，无法在连线处直接操作。
7. `canvasGeneration.ts`（777 行）含旧 `/api/proxy/*` 路径，画布媒体节点走旧链路，与创作面板状态分叉。

本 SDD 定义各项优化的设计方案与边界，按优先级分五个阶段实施。

---

## 二、目标

| 目标 | 验收标准 |
|------|---------|
| 节点数据不再被 sanitize 静默丢弃 | 重开画布后，所有 56 种节点类型的数据完整还原 |
| 历史管理唯一入口 | 废弃 `useCanvasHistory`，Cmd+Z/Cmd+Y 行为与预期一致 |
| 并行分支执行 | 无上下游依赖的节点并发运行，多分支工作流提速 ≥ 40% |
| LLM 节点流式输出 | 节点在生成过程中实时显示 token，不等全量 |
| 批量历史操作 | 工作流模板展开后只占 1 条 undo 记录 |
| 连线角色直接编辑 | 在 `ImageRoleEdge` 连线中点下拉选择角色，不需要进节点面板 |
| 媒体链路收敛 | 画布媒体节点统一走 `media-generation.ts`，移除旧 proxy 路径 |

## 三、非目标

- 不重写 VueFlow 集成层。
- 不改变节点 UI 视觉设计。
- 不接入 Mem0 或新增 AI 自动节点配置。
- AI 意图工作流推荐（P3）本 SDD 仅定义接口，不含实现。

---

## 四、P0：序列化白名单修复

### 4.1 问题根因

`canvasSerialization.ts:6`：

```ts
const NODE_TYPES: CanvasNodeType[] = [
  'text', 'llm', 'imageGen', 'imageResult', 'audioGen', 'audioResult',
  'videoGen', 'videoResult', 'file', 'tool', 'group'
]
```

`canvas.ts` 的 `CanvasNodeType` 枚举有 56 种，包括所有 T8 迁入节点（`runninghub`、`seedance`、`loop`、`resize`、`cinematic` 等）。`sanitizeCanvasNode` 在第 50 行做了严格过滤：

```ts
if (!NODE_TYPES.includes(node.type as CanvasNodeType)) return null
```

结果：用户保存画布后，T8 节点数据被 `sanitize` 返回 `null`，`filter(Boolean)` 后消失。

### 4.2 修复方案

从 `canvas.ts` 的 `CanvasNodeType` union 类型自动派生白名单，杜绝白名单与类型系统偏移：

```ts
// canvasSerialization.ts

// 从类型系统提取，而不是手动维护字符串数组
import type { CanvasNodeType } from '@/types/canvas'

// 运行时枚举，与 CanvasNodeType union 保持同步
// 每次在 canvas.ts 新增 type 时，只需在这里补一行
const ALLOWED_NODE_TYPES = new Set<CanvasNodeType>([
  // V8 核心
  'text', 'llm',
  'imageGen', 'imageResult',
  'audioGen', 'audioResult',
  'videoGen', 'videoResult',
  'file', 'tool', 'group',
  // T8 迁入 — 生成
  'runninghub', 'runninghubWallet', 'seedance', 'rhTools',
  'upload', 'output',
  // T8 迁入 — 流程控制
  'loop', 'pickFromSet', 'textSplit', 'framePair',
  // T8 迁入 — 图像处理
  'resize', 'combine', 'removeBg', 'upscale', 'gridCrop',
  'imageCompare', 'drawingBoard',
  // T8 迁入 — 工具箱
  'cinematic', 'videoMotion', 'multiAngleVisual',
  // T8 迁入 — 辅助
  'idea', 'bp', 'relay', 'edit', 'videoOutput',
  // 结果
  'imageResult', 'videoResult', 'audioResult',
  // 其他
  'materialSet', 'frameExtractor', 'browserNode',
  // V8 上下文提供者
  'v8Vault', 'v8Skill', 'v8Toolset',
])

export function sanitizeCanvasNode(node: Partial<CanvasNode> | null | undefined): CanvasNode | null {
  if (!node?.id || !node?.type) return null
  if (!ALLOWED_NODE_TYPES.has(node.type as CanvasNodeType)) return null
  // 其余逻辑不变 ...
}
```

**同时**，`sanitizeResultNodeData` 仅对 result 类节点做 URL 校验，非 result 节点跳过，避免误删普通字段：

```ts
const RESULT_NODE_TYPES = new Set<CanvasNodeType>(['imageResult', 'videoResult', 'audioResult'])

// sanitizeCanvasNode 内：
if (RESULT_NODE_TYPES.has(type)) {
  data = sanitizeResultNodeData(data)
}
```

### 4.3 影响范围

- 修改文件：`src/components/canvas/utils/canvasSerialization.ts`（~10 行变更）
- 不改类型定义、不改存储、不改执行引擎
- 需要测试：保存含 T8 节点的画布 → 重新加载 → 节点类型和数据完整

---

## 五、P0：历史管理统一

### 5.1 问题根因

存在两套并行历史机制：

| 机制 | 位置 | 实现 |
|------|------|------|
| A | `src/stores/canvasStore.ts` `history` / `redoStack` | Pinia store，`pushHistory()` 在 `addNode/updateNodeData` 等操作时自动调用 |
| B | `src/canvas/composables/useCanvasHistory.ts` | 独立 composable，维护 `past` / `future` 数组，暴露 `undo/redo` |

两套机制的快照时机不同，Cmd+Z 的行为依赖调用方用的是哪套，用户感知混乱。

### 5.2 修复方案

废弃 `useCanvasHistory`，全部走 `canvasStore`。

**步骤：**

1. 在 `canvasStore.ts` 中确认以下方法存在且正确（当前实现已有）：
   - `pushHistory()` — 存快照到 `history` 数组
   - `undo()` — 弹出到 `redoStack`，恢复 nodes/edges
   - `redo()` — 弹回到 `history`
   - `canUndo` / `canRedo` — computed boolean

2. 检查 `useCanvasHistory` 的所有调用方，替换为 `canvasStore.undo()` / `canvasStore.redo()`。

3. 删除 `src/canvas/composables/useCanvasHistory.ts`。

4. 快捷键统一在 `CanvasWorkspace.vue` 绑定：
   ```ts
   // CanvasWorkspace.vue
   useEventListener(document, 'keydown', (e: KeyboardEvent) => {
     if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
       e.preventDefault()
       canvasStore.undo()
     }
     if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
       e.preventDefault()
       canvasStore.redo()
     }
   })
   ```

### 5.3 影响范围

- 修改文件：`src/canvas/composables/useCanvasHistory.ts`（删除）、`CanvasWorkspace.vue`（键盘绑定）
- 调用方搜索：`grep -r "useCanvasHistory" src/`

---

## 六、P1：并行分支执行引擎

### 6.1 问题根因

`runAllCanvasNodes`（`canvasExecutor.ts:275`）：

```ts
for (const id of executableIds) {   // ← 纯串行 for loop
  // ...
  const ok = await runCanvasNode(id)
  if (!ok) failed.add(id)
}
```

拓扑排序后同一"层级"（入度为 0 的节点集合）的节点逐个等待，哪怕它们之间没有任何依赖关系。

### 6.2 设计：按层级并发

拓扑排序已经在 `canvasGraph.ts` 里用 Kahn 算法实现。改进点：在 `runAllCanvasNodes` 中不再逐节点串行，而是按层（wave）并发：

```
Layer 0 (独立节点，全部并发)
  ├── Node A  ──→ Layer 1
  ├── Node B  ──→ Layer 2
  └── Node C  (无后继)

Layer 1 (等 A 完成)
  └── Node D  ──→ Layer 2

Layer 2 (等 B + D 完成)
  └── Node E
```

#### 6.2.1 修改 `canvasGraph.ts`：返回层级数组

```ts
/**
 * 返回按层级分组的节点 ID 数组。
 * 同一层内的节点没有互相依赖，可以并发执行。
 */
export function topologicalNodeLayers(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  selectedIds?: string[]
): string[][] {
  const allowed = new Set(selectedIds?.length ? selectedIds : nodes.map(n => n.id))
  const indegree = new Map<string, number>()
  const next = new Map<string, string[]>()

  for (const node of nodes) {
    if (!allowed.has(node.id)) continue
    indegree.set(node.id, 0)
    next.set(node.id, [])
  }

  for (const edge of edges) {
    if (!allowed.has(edge.source) || !allowed.has(edge.target)) continue
    next.get(edge.source)?.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1)
  }

  const layers: string[][] = []
  let currentLayer = Array.from(indegree.entries())
    .filter(([, count]) => count === 0)
    .map(([id]) => id)

  const visited = new Set<string>()
  while (currentLayer.length) {
    layers.push(currentLayer)
    currentLayer.forEach(id => visited.add(id))

    const nextLayer: string[] = []
    for (const id of currentLayer) {
      for (const target of next.get(id) || []) {
        if (visited.has(target)) continue
        const count = (indegree.get(target) || 0) - 1
        indegree.set(target, count)
        if (count === 0) nextLayer.push(target)
      }
    }
    currentLayer = nextLayer
  }

  // 处理环（理论上不应出现，作为兜底追加）
  for (const id of allowed) {
    if (!visited.has(id)) {
      if (!layers.length) layers.push([])
      layers[layers.length - 1].push(id)
    }
  }

  return layers
}
```

旧的 `topologicalNodeOrder` 函数**保留**（通过 `layers.flat()` 实现）以兼容 `runCanvasNode` 单节点执行路径。

#### 6.2.2 修改 `canvasExecutor.ts`：按层并发

```ts
export async function runAllCanvasNodes() {
  const canvasStore = useCanvasStore()
  const layers = topologicalNodeLayers(canvasStore.nodes, canvasStore.edges)
  const executableLayers = layers.map(ids =>
    ids.filter(id => isExecutable(canvasStore.nodes.find(n => n.id === id)))
  ).filter(layer => layer.length > 0)

  const failed = new Set<string>()
  canvasStore.resetStopRequest()
  canvasStore.addExecutionLog('开始执行画布队列')

  // 预设所有节点为 queued
  for (const ids of executableLayers) {
    for (const id of ids) {
      canvasStore.setNodeStatus(id, { status: 'queued', progress: 0, error: '', detail: '等待执行' } as any)
    }
  }

  // 按层并发
  for (const layerIds of executableLayers) {
    if (canvasStore.stopRequested) {
      canvasStore.addExecutionLog('队列已停止', 'error')
      break
    }

    // 同层内所有节点并发，任一失败不阻塞同层其他节点
    const results = await Promise.allSettled(
      layerIds.map(async (id) => {
        const node = canvasStore.nodes.find(n => n.id === id)
        if (!node) return
        if (hasFailedDependency(node, failed)) {
          canvasStore.setNodeStatus(id, {
            status: 'cancelled', progress: 0,
            error: '上游节点失败，已跳过。', detail: '已跳过',
          } as any)
          failed.add(id)
          return
        }
        const ok = await runCanvasNode(id)
        if (!ok) failed.add(id)
      })
    )

    // 检查是否被用户停止
    if (canvasStore.stopRequested) break
  }

  canvasStore.addExecutionLog('画布队列结束', failed.size ? 'error' : 'success')
}
```

### 6.3 并发限制

媒体生成任务（`imageGen`, `videoGen`, `audioGen`）会向外部 API 提交，并发过多可能超出速率限制。引入软性并发上限：

```ts
const MAX_MEDIA_CONCURRENT = 3   // 可通过设置调整

// 在 layerIds 中，先跑非媒体节点，再以并发上限跑媒体节点
const MEDIA_TYPES = new Set(['imageGen', 'videoGen', 'audioGen', 'runninghub', 'seedance'])

async function runLayerWithConcurrencyLimit(layerIds: string[], limit: number) {
  const queue = [...layerIds]
  const running: Promise<void>[] = []
  while (queue.length || running.length) {
    while (running.length < limit && queue.length) {
      const id = queue.shift()!
      const p = runCanvasNode(id).then(() => { running.splice(running.indexOf(p), 1) })
      running.push(p)
    }
    await Promise.race(running)
  }
}
```

### 6.4 影响范围

- 修改文件：`src/components/canvas/utils/canvasGraph.ts`（新增 `topologicalNodeLayers`）
- 修改文件：`src/components/canvas/runtime/canvasExecutor.ts`（`runAllCanvasNodes` 重写）
- 单节点执行路径 `runCanvasNode` 不变
- 需要测试：含 3 个并行分支的画布，确认三个节点同时进入 `running` 状态

---

## 七、P1：LLM 节点流式输出

### 7.1 问题根因

`canvasLlmRuntime.ts` 调用 `callOpenAiCompatible`，该函数返回完整 response 字符串，节点在生成结束前不更新内容。

### 7.2 设计

复用 `useChat.ts` 已有的 SSE 流解析能力（`httpClient.ts` 的 `safeFetchStream`）。

#### 7.2.1 新增流式回调参数

```ts
// canvasLlmRuntime.ts

interface CanvasLlmRunOptions {
  node: CanvasNode
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  onToken?: (delta: string) => void     // 新增：流式 token 回调
  onProgress?: (value: number, message: string) => void
}

export async function runCanvasLlmNode(opts: CanvasLlmRunOptions): Promise<{ content: string; fileId: string }> {
  const { node, nodes, edges, onToken } = opts
  // ...（输入收集、system prompt 构建，逻辑不变）

  const canvasStore = useCanvasStore()
  let accumulated = ''

  // 流式模式：有 onToken 时走 stream，否则退回原有批量模式
  if (onToken) {
    await callOpenAiCompatibleStream({
      config,
      messages,
      onDelta: (delta) => {
        accumulated += delta
        onToken(delta)
        // 实时写入节点，让 UI 看到流式内容
        canvasStore.updateNodeData(node.id, {
          outputContent: accumulated,
          status: 'running',
        } as any)
      },
    })
  } else {
    const result = await callOpenAiCompatible({ config, messages })
    accumulated = result.content
  }

  // 保存文件、返回
  const fileId = await fileStore.addText(/* ... */)
  return { content: accumulated, fileId }
}
```

#### 7.2.2 `callOpenAiCompatibleStream` 实现

```ts
// canvasLlmRuntime.ts 内部辅助函数

async function callOpenAiCompatibleStream(opts: {
  config: ApiConfig
  messages: ChatMessage[]
  onDelta: (delta: string) => void
}) {
  const { config, messages, onDelta } = opts
  const body = {
    model: config.model,
    messages,
    stream: true,
    max_tokens: 8192,
    temperature: 0.7,
  }

  // 复用 httpClient 的 Rust 桥接，走 SSE
  const response = await safeFetchStream(`${config.apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(body),
  })

  // 解析 SSE：与 useChat.ts 的 readSSEStream 逻辑对齐
  for await (const chunk of response) {
    const line = chunk.trim()
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (data === '[DONE]') break
    try {
      const parsed = JSON.parse(data)
      const delta = parsed?.choices?.[0]?.delta?.content
      if (delta) onDelta(delta)
    } catch { /* 忽略非 JSON 行 */ }
  }
}
```

#### 7.2.3 executor 传入 onToken 回调

```ts
// canvasExecutor.ts，llm 分支

if (node.type === 'llm') {
  const result = await runCanvasLlmNode({
    node,
    nodes: canvasStore.nodes,
    edges: canvasStore.edges,
    onProgress: progress,
    onToken: (_delta) => {
      // 实时进度推进（10% → 90%，基于输出长度估算）
      const len = ((node.data as any).outputContent || '').length
      const est = Math.min(90, 10 + Math.floor(len / 50))
      progress(est, '生成中…')
    },
  })
  // ...结果写入逻辑不变
}
```

### 7.3 影响范围

- 修改文件：`src/components/canvas/runtime/canvasLlmRuntime.ts`
- 不改 `httpClient.ts`、不改 `useChat.ts`
- 节点 UI 需实时响应 `outputContent` 变化（已依赖 Pinia reactive，无需额外改动）

---

## 八、P1：批量历史操作

### 8.1 问题根因

`canvasStore.pushHistory()` 被 `addNode`、`addEdge`、`updateNodeData` 等每个操作自动触发。工作流模板展开（例如创建 5 个节点 + 4 条边）会产生 9 条 undo 历史，用户 Cmd+Z 9 次才能完全还原。

### 8.2 设计

参考 huobao-canvas 的 `startBatchOperation / endBatchOperation` 模式，在 `canvasStore` 中增加批量锁：

```ts
// canvasStore.ts

// 新增状态
const _batchDepth = ref(0)           // 嵌套计数器，支持嵌套批量
const _batchStartSnapshot = ref<CanvasSnapshot | null>(null)

// 进入批量模式：记录当前快照，后续操作不再自动压栈
function startBatch() {
  if (_batchDepth.value === 0) {
    _batchStartSnapshot.value = takeSnapshot()   // 保存进入前的快照
  }
  _batchDepth.value++
}

// 退出批量模式：只有真正发生变化才压一条历史
function endBatch() {
  _batchDepth.value = Math.max(0, _batchDepth.value - 1)
  if (_batchDepth.value === 0 && _batchStartSnapshot.value) {
    const before = _batchStartSnapshot.value
    _batchStartSnapshot.value = null
    // 只有内容变化才压栈（避免无意义的 undo 条目）
    if (hasSnapshotChanged(before, takeSnapshot())) {
      history.value.push(before)
      redoStack.value = []
      if (history.value.length > MAX_HISTORY) history.value.shift()
    }
  }
}

// pushHistory：在批量模式下 skip（外层 endBatch 会统一处理）
function pushHistory() {
  if (_batchDepth.value > 0) return
  // 原有逻辑不变
  history.value.push(takeSnapshot())
  redoStack.value = []
  if (history.value.length > MAX_HISTORY) history.value.shift()
}
```

`hasSnapshotChanged`：比较节点数组长度、ID 集合、边数组长度，不做深比较（快速判断）：

```ts
function hasSnapshotChanged(a: CanvasSnapshot, b: CanvasSnapshot): boolean {
  if (a.nodes.length !== b.nodes.length) return true
  if (a.edges.length !== b.edges.length) return true
  const aIds = new Set(a.nodes.map(n => n.id))
  return b.nodes.some(n => !aIds.has(n.id))
}
```

### 8.3 使用示例

```ts
// CanvasWorkspace.vue 的工作流模板展开
canvasStore.startBatch()
try {
  for (const nodeSpec of templateNodes) {
    canvasStore.addNode(nodeSpec)     // 内部 pushHistory 被 skip
  }
  for (const edgeSpec of templateEdges) {
    canvasStore.addEdge(edgeSpec)
  }
} finally {
  canvasStore.endBatch()             // 整个模板展开只产生 1 条 undo
}
```

### 8.4 影响范围

- 修改文件：`src/stores/canvasStore.ts`（新增 `startBatch/endBatch` 约 40 行）
- 调用方需要将多节点创建操作包裹在 `startBatch/endBatch` 中
- 现有行为不破坏：`_batchDepth` 默认 0，`pushHistory` 路径不变

---

## 九、P2：连线角色下拉菜单

### 9.1 问题根因

图片输入角色（`首帧` / `尾帧` / `参考图`）当前需要打开目标节点面板修改。用户连线后不直观，需要三步：点节点 → 找输入区 → 改角色下拉。

huobao-canvas 的 `ImageRoleEdge` 做法：在连线中点渲染一个 `<select>`，用 Vue Flow 的 `EdgeLabelRenderer` 在 SVG 层之上覆盖 DOM 元素。

### 9.2 设计

当前产品已有 `ImageRoleEdge` 组件，已注册为自定义 edge type。确认 `EdgeLabelRenderer` 是否已用：
- 若已有：在 label 渲染区加 `<select>` 并 emit `update:role`
- 若无：增加 `EdgeLabelRenderer` 包裹层

```vue
<!-- src/components/canvas/edges/ImageRoleEdge.vue -->
<template>
  <BaseEdge :path="edgePath" />
  <EdgeLabelRenderer>
    <div
      :style="{
        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
        pointerEvents: 'all',
      }"
      class="nodrag nopan edge-role-label"
    >
      <select
        :value="data.role"
        @change="onRoleChange"
        class="edge-role-select"
        @pointerdown.stop
        @mousedown.stop
      >
        <option value="reference">参考图</option>
        <option value="first_frame">首帧</option>
        <option value="last_frame">尾帧</option>
        <option value="voice">声音</option>
        <option value="music">音乐</option>
      </select>
    </div>
  </EdgeLabelRenderer>
</template>

<script setup lang="ts">
import { EdgeLabelRenderer, BaseEdge, getBezierPath } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'

const props = defineProps<{ id: string; sourceX: number; sourceY: number; targetX: number; targetY: number; data: CanvasEdgeData }>()
const canvasStore = useCanvasStore()

const [edgePath, labelX, labelY] = getBezierPath({ sourceX: props.sourceX, sourceY: props.sourceY, targetX: props.targetX, targetY: props.targetY })

function onRoleChange(e: Event) {
  const role = (e.target as HTMLSelectElement).value as CanvasEdgeData['role']
  canvasStore.updateEdgeData(props.id, { role })
}
</script>
```

**同理**，`MediaRoleEdge` 应用相同模式，支持 `voice` / `music` 等音视频角色。

### 9.3 注意事项

- `pointerdown.stop` / `mousedown.stop` 防止 Vue Flow 把 select 交互误判为连线拖拽
- `class="nodrag nopan"` 是 Vue Flow 的标准阻止拖拽类名
- 当连线数量多时，label 会叠加，考虑仅在连线 hover 或选中时显示 select

### 9.4 影响范围

- 修改文件：`src/components/canvas/edges/ImageRoleEdge.vue`、`MediaRoleEdge.vue`
- 不改类型定义、不改 store 的 `updateEdgeData`（已有）

---

## 十、P2：媒体链路收敛（canvasGeneration → media-generation）

### 10.1 问题根因

画布媒体节点执行链路：

```
canvasMediaRuntime.ts
  → canvasGeneration.ts (775 行)
    → /api/proxy/image/submit          ← 旧路径
    → /api/proxy/video/submit          ← 旧路径
    → /api/proxy/seedance/submit       ← 旧路径
    → /api/image/status/{taskId}
```

创作面板的正确链路：

```
media-generation.ts
  → /v1/images/generations             ← NewAPI 标准端点
  → /v1/videos                         ← NewAPI 标准端点
  → 轮询 /v1/videos/:id
```

两条链路并行，模型可用性（`/api/creation/models`）只拦截创作面板，画布绕过了可用性检查和统一鉴权。

### 10.2 设计方向

分三步收敛，避免一次性大重构破坏现有功能：

#### Step 1：共享可用性检查

在 `canvasMediaRuntime.ts` 的执行前，先调用 `assertMediaModelExecutable`（已在 `media-generation.ts` 中实现）：

```ts
// canvasMediaRuntime.ts
import { assertMediaModelExecutable } from '@/api/media-generation'

export async function runCanvasImageNode(opts: CanvasImageRunOptions) {
  const model = (opts.node.data as any).model
  await assertMediaModelExecutable(model)   // 新增：可用性拦截
  // 其余逻辑不变，仍走 canvasGeneration.ts
}
```

#### Step 2：对齐鉴权（高优先级）

`canvasGeneration.ts` 的 `gatewayFetch` 使用 `getApiKey()`，而创作面板用 `resolveApiConfig()`（手动 Key 优先）。统一改为 `resolveApiConfig()`。

```ts
// canvasGeneration.ts 的 gatewayFetch 改为
async function gatewayFetch(url: string, init: RequestInit) {
  const { apiKey, apiBase } = await resolveApiConfig()   // 与创作面板对齐
  // ...
}
```

#### Step 3（后续迭代）：迁移提交/轮询逻辑

逐模型将 `canvasGeneration.ts` 中的 `submitImageAsync` → `media-generation.ts` 的 `submitCreationTask`，统一走 NewAPI `/v1/*` 端点。此步骤影响大，需要单独迭代和冒烟测试。

### 10.3 影响范围

- Step 1 修改文件：`src/components/canvas/runtime/canvasMediaRuntime.ts`（约 5 行）
- Step 2 修改文件：`src/canvas/services/canvasGeneration.ts`（`gatewayFetch` 函数）
- Step 3：单独 SDD

---

## 十一、P3 接口定义：AI 意图工作流推荐

> 本节仅定义接口和数据结构，不含实现。实现在后续迭代。

### 11.1 接口设计

```ts
// src/canvas/services/canvasWorkflowAdvisor.ts

type WorkflowType =
  | 'text_to_image'
  | 'text_to_video'
  | 'image_to_video'
  | 'image_series'         // 多图分镜
  | 'storyboard'           // 分镜板（角色参考 + 多镜头）
  | 'multi_angle'          // 多角度角色生成
  | 'picture_book'         // 绘本（文字 + 多页插图）
  | 'plain_llm'            // 纯文字生成，不含媒体节点

interface WorkflowAdvice {
  workflowType: WorkflowType
  confidence: number           // 0.0–1.0
  reasoning: string            // LLM 给出的理由
  suggestedNodes: Array<{
    type: CanvasNodeType
    label: string
    data: Partial<CanvasNodeData>
  }>
  suggestedEdges: Array<{
    fromNodeIndex: number
    toNodeIndex: number
    kind: CanvasEdgeKind
    role?: CanvasEdgeData['role']
  }>
}

/**
 * 分析用户描述，返回工作流建议。
 * 调用 LLM，输入用户输入文字，输出结构化 WorkflowAdvice。
 */
export async function analyzeWorkflowIntent(userInput: string): Promise<WorkflowAdvice>

/**
 * 将 WorkflowAdvice 实例化为画布节点/边，使用 canvasStore.startBatch/endBatch 包裹。
 */
export async function applyWorkflowAdvice(
  advice: WorkflowAdvice,
  insertPosition: { x: number; y: number }
): Promise<void>
```

### 11.2 触发入口（预留）

- 画布空白区右键菜单 → "AI 帮我设计工作流"
- 画布顶部 Toolbar → 魔法棒按钮（与对话面板的 Superpower 概念对齐）
- 从对话面板拖拽到画布时弹出建议

---

## 十二、迁移与测试计划

### 12.1 优先级与预估工时

| 阶段 | 内容 | 预估 | 依赖 |
|------|------|------|------|
| P0-A | 序列化白名单修复 | 0.5h | 无 |
| P0-B | 历史管理统一 | 1h | P0-A |
| P1-A | 并行执行引擎 | 3-4h | P0 完成 |
| P1-B | LLM 流式输出 | 2-3h | 无 |
| P1-C | 批量历史操作 | 2h | P0-B 完成 |
| P2-A | 连线角色下拉 | 2h | 无 |
| P2-B | 媒体链路 Step1/2（可用性+鉴权） | 1-2h | 无 |
| P3 | AI 意图工作流（接口定义） | 4-6h | P1 稳定后 |

### 12.2 测试矩阵

| 用例 | P0-A | P0-B | P1-A | P1-B | P1-C | P2-A | P2-B |
|------|------|------|------|------|------|------|------|
| 含 T8 节点的画布保存/加载 | ✓ | | | | | | |
| 创建 5 节点后 Cmd+Z 一次还原 | | ✓ | | | ✓ | | |
| 3 个并行分支同时 running | | | ✓ | | | | |
| LLM 节点生成时实时显示 token | | | | ✓ | | | |
| 模板展开后 undo 历史只有 1 条 | | | | | ✓ | | |
| 连线中点下拉改角色立即生效 | | | | | | ✓ | |
| 画布提交任务被可用性拦截 | | | | | | | ✓ |
| 画布使用手动 Key 而非旧 Key | | | | | | | ✓ |

### 12.3 不触及范围

- `useChat.ts` — 对话引擎不变
- `canvasStore.ts` 除 `startBatch/endBatch/pushHistory` 外的其余方法不变
- 节点 UI 组件视觉不变
- VueFlow 版本不升级
- 测试套件现有用例应继续通过

---

## 十三、风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 并行执行导致 API 速率限制 | 中 | 批量任务失败 | `MAX_MEDIA_CONCURRENT = 3` 软限制，配置可调 |
| `useCanvasHistory` 的某处调用遗漏替换 | 低 | Undo 行为异常 | `grep -r useCanvasHistory src/` 全量检查 |
| LLM 流式时 `updateNodeData` 频繁触发导致卡顿 | 低-中 | 节点 UI 抖动 | 加 100ms debounce 只控制 UI 更新频率，不影响数据累积 |
| 媒体链路 Step 3 迁移引入回归 | 高 | 图片/视频生成失败 | Step 3 单独在 worktree 分支，充分冒烟后合并 |
| 序列化白名单新增节点后忘记补 | 中 | 新节点被静默丢弃 | CI 可加 lint 规则：`CanvasNodeType` 中的每个类型必须在 `ALLOWED_NODE_TYPES` 中出现 |
