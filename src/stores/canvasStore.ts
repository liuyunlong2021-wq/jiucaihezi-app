import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange } from '@vue-flow/core'
import type {
  CanvasDocumentV1,
  CanvasEdge,
  CanvasEdgeData,
  CanvasNode,
  CanvasNodeData,
  CanvasNodeType,
  CanvasViewport,
} from '@/types/canvas'
import { loadCanvasDocument, saveCanvasDocument } from '@/components/canvas/utils/canvasPersistence'
import type { CanvasWorkflowTemplate } from '@/components/canvas/utils/canvasWorkflows'
import { sanitizeCanvasDocument } from '@/components/canvas/utils/canvasSerialization'
import {
  canvasNow,
  createCanvasBaseData,
  createCanvasEdge,
  createCanvasNode,
  defaultCanvasDataForType,
  edgeTypeForKind,
  resolveCanvasEdgeKind,
} from '@/components/canvas/utils/canvasNodeFactory'

interface HistorySnapshot {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: CanvasViewport
}

const SAVE_DEBOUNCE_MS = 500
const MAX_HISTORY = 50

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function toDocument(nodes: CanvasNode[], edges: CanvasEdge[], viewport: CanvasViewport, id = 'default', title = '我的画布'): CanvasDocumentV1 {
  return {
    version: 1,
    id,
    title,
    updatedAt: canvasNow(),
    nodes,
    edges,
    viewport,
  }
}

export function createStarterCanvasDocument(title = '我的画布', id = 'default'): CanvasDocumentV1 {
  const t = canvasNow()
  const idBase = id
  // SDD v5.1 5-node template (V8 types, prompt-flow edges, manual review node)
  // 📝需求 → 🧠AI大脑 → 📝输出（人工复核） → 🖼️生成 → 🖼️结果
  const nodes: CanvasNode[] = [
    { id: `${idBase}_req`, type: 'text', position: { x: 80, y: 120 }, data: { ...createCanvasBaseData('需求'), label: '需求', content: '', collapsed: false } as CanvasNodeData },
    { id: `${idBase}_llm`, type: 'llm', position: { x: 380, y: 100 }, data: { ...createCanvasBaseData('LLM'), label: 'LLM', modelId: 'claude-sonnet-4-6' } as CanvasNodeData },
    { id: `${idBase}_gen`, type: 'imageGen', position: { x: 680, y: 80 }, data: { ...createCanvasBaseData('生图'), label: '生图' } as CanvasNodeData },
    { id: `${idBase}_result`, type: 'imageResult', position: { x: 980, y: 100 }, data: { ...createCanvasBaseData('结果'), label: '结果' } as CanvasNodeData },
  ]
  const edges = [
    { id: `e_${t}_1`, source: `${idBase}_req`, target: `${idBase}_llm`, sourceHandle: 'right', targetHandle: 'left', type: 'promptOrder', data: { kind: 'prompt-order', order: 1, createdAt: t } },
    { id: `e_${t}_2`, source: `${idBase}_llm`, target: `${idBase}_gen`, sourceHandle: 'right', targetHandle: 'left', type: 'promptOrder', data: { kind: 'prompt-order', order: 2, createdAt: t } },
    { id: `e_${t}_3`, source: `${idBase}_gen`, target: `${idBase}_result`, sourceHandle: 'right-result', targetHandle: 'left', type: 'default', data: { kind: 'media-role', createdAt: t } },
  ] as any
  return {
    version: 1,
    id,
    title,
    updatedAt: t,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 0.9 },
  }
}

export const useCanvasStore = defineStore('canvas', () => {
  const nodes = shallowRef<CanvasNode[]>([])
  const edges = shallowRef<CanvasEdge[]>([])
  const viewport = ref<CanvasViewport>({ x: 0, y: 0, zoom: 1 })
  const currentFileId = ref('')
  const currentTitle = ref('我的画布')
  const selectedNodeId = ref('')
  const selectedEdgeId = ref('')
  const initialized = ref(false)
  const loading = ref(false)
  const gridVisible = ref(true)
  const stopRequested = ref(false)
  const executionLogs = shallowRef<Array<{ id: string; message: string; level: 'info' | 'error' | 'success'; createdAt: number }>>([])
  const history = shallowRef<HistorySnapshot[]>([])
  const redoStack = shallowRef<HistorySnapshot[]>([])
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  // 批量操作锁：>0 时 pushHistory 静默跳过，由 endBatch 统一压一条
  let _batchDepth = 0
  let _batchStartSnapshot: HistorySnapshot | null = null

  const selectedNode = computed<CanvasNode | null>(() => nodes.value.find(node => node.id === selectedNodeId.value) || null)

  const publicNodes = computed(() => nodes.value.filter(node => Boolean((node.data as any).publicEnabled) && (node.type === 'text' || node.type === 'imageResult')))

  function mentionToken(nodeId: string) {
    const node = nodes.value.find(item => item.id === nodeId)
    if (!node) return ''
    return `@[${node.id}|${(node.data as any).publicName || node.data.label || node.id}]`
  }

  function snapshot(): HistorySnapshot {
    return {
      nodes: clone(nodes.value),
      edges: clone(edges.value),
      viewport: clone(viewport.value),
    }
  }

  function pushHistory() {
    if (_batchDepth > 0) return   // 批量模式：由 endBatch 统一处理
    const next = [...history.value, snapshot()]
    history.value = next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next
    redoStack.value = []
  }

  function startBatch() {
    if (_batchDepth === 0) _batchStartSnapshot = snapshot()
    _batchDepth++
  }

  function endBatch() {
    _batchDepth = Math.max(0, _batchDepth - 1)
    if (_batchDepth === 0 && _batchStartSnapshot) {
      const before = _batchStartSnapshot
      _batchStartSnapshot = null
      // 快速检测：节点/边数量、ID 序列、或节点 updatedAt 变化
      const current = snapshot()
      const changed = before.nodes.length !== current.nodes.length
        || before.edges.length !== current.edges.length
        || before.nodes.some((n, i) => n.id !== current.nodes[i]?.id)
        || before.nodes.some((n, i) => (n.data as any)?.updatedAt !== (current.nodes[i]?.data as any)?.updatedAt)
      if (changed) {
        const next = [...history.value, before]
        history.value = next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next
        redoStack.value = []
      }
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void saveNow()
    }, SAVE_DEBOUNCE_MS)
  }

  async function saveNow() {
    if (!initialized.value) return
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const doc = toDocument(nodes.value, edges.value, viewport.value, currentFileId.value || 'default', currentTitle.value || '我的画布')
    if (currentFileId.value) {
      const { useFileStore } = await import('@/composables/useFileStore')
      await useFileStore().updateFile(currentFileId.value, {
        name: currentTitle.value.endsWith('.jccanvas') ? currentTitle.value : currentTitle.value + '.jccanvas',
        content: JSON.stringify(doc, null, 2),
        mimeType: 'application/x-jiucaihezi-canvas+json',
        size: new TextEncoder().encode(JSON.stringify(doc)).length,
        metadata: { kind: 'canvas-document' },
      })
      return
    }
    await saveCanvasDocument(doc)
  }

  async function load() {
    if (loading.value) return
    loading.value = true
    try {
      const doc = sanitizeCanvasDocument(await loadCanvasDocument())
      nodes.value = doc.nodes
      edges.value = doc.edges
      viewport.value = doc.viewport
      currentFileId.value = ''
      currentTitle.value = doc.title || '我的画布'
      initialized.value = true
    } finally {
      loading.value = false
    }
  }

  function addExecutionLog(message: string, level: 'info' | 'error' | 'success' = 'info') {
    executionLogs.value = [
      { id: `log_${canvasNow().toString(36)}_${Math.random().toString(36).slice(2, 5)}`, message, level, createdAt: canvasNow() },
      ...executionLogs.value,
    ].slice(0, 80)
  }

  function clearExecutionLogs() {
    executionLogs.value = []
  }

  function requestStop() {
    stopRequested.value = true
    addExecutionLog('已请求停止队列，当前节点结束后停止。', 'error')
  }

  function resetStopRequest() {
    stopRequested.value = false
  }

  function toggleGrid() {
    gridVisible.value = !gridVisible.value
  }


  function bringToFront(nodeId: string) {
    pushHistory()
    const maxZ = Math.max(0, ...nodes.value.map(node => Number((node as any).zIndex || 0)))
    nodes.value = nodes.value.map(node => node.id === nodeId ? { ...node, zIndex: maxZ + 1 } : node)
    scheduleSave()
  }

  function resetToStarter() {
    pushHistory()
    const doc = createStarterCanvasDocument(currentTitle.value || '我的画布', currentFileId.value || 'default')
    nodes.value = doc.nodes
    edges.value = doc.edges
    viewport.value = doc.viewport
    selectedNodeId.value = nodes.value[0]?.id || ''
    selectedEdgeId.value = ''
    scheduleSave()
  }

  function addNode(type: CanvasNodeType, position = { x: 120 + nodes.value.length * 36, y: 140 + nodes.value.length * 24 }) {
    pushHistory()
    const node = createCanvasNode(type, defaultCanvasDataForType(type), position)
    nodes.value = [...nodes.value, node]
    selectedNodeId.value = node.id
    scheduleSave()
    return node
  }

  function addNodeWithData(type: CanvasNodeType, data: CanvasNodeData, position = { x: 120 + nodes.value.length * 36, y: 140 + nodes.value.length * 24 }) {
    pushHistory()
    const node = createCanvasNode(type, data, position)
    nodes.value = [...nodes.value, node]
    selectedNodeId.value = node.id
    scheduleSave()
    return node
  }

  function updateNodeData(nodeId: string, patch: Partial<CanvasNodeData>, withHistory = false) {
    if (withHistory) pushHistory()
    nodes.value = nodes.value.map(node => node.id === nodeId
      ? {
          ...node,
          data: {
            ...node.data,
            ...patch,
            updatedAt: canvasNow(),
          } as CanvasNodeData,
        }
      : node)
    scheduleSave()
  }

  function setNodeStatus(nodeId: string, patch: Partial<CanvasNodeData>) {
    updateNodeData(nodeId, patch)
  }

  function selectNode(nodeId: string) {
    selectedNodeId.value = nodeId
    if (nodeId) selectedEdgeId.value = ''
  }

  function selectEdge(edgeId: string) {
    selectedEdgeId.value = edgeId
    if (edgeId) selectedNodeId.value = ''
  }

  function selectedNodeIds() {
    return nodes.value.filter(node => node.selected).map(node => node.id)
  }

  function selectAllNodes() {
    nodes.value = nodes.value.map(node => ({ ...node, selected: true }))
    selectedNodeId.value = nodes.value[0]?.id || ''
    selectedEdgeId.value = ''
    scheduleSave()
  }

  function clearSelection() {
    nodes.value = nodes.value.map(node => node.selected ? { ...node, selected: false } : node)
    edges.value = edges.value.map(edge => (edge as any).selected ? ({ ...edge, selected: false } as unknown as CanvasEdge) : edge)
    selectedNodeId.value = ''
    selectedEdgeId.value = ''
    scheduleSave()
  }

  function deleteSelected(confirmDelete: (message: string) => boolean = () => true) {
    if (selectedEdgeId.value) {
      deleteEdge(selectedEdgeId.value)
      return
    }
    const visualSelected = nodes.value.filter(node => node.selected).map(node => node.id)
    const ids = visualSelected.length ? visualSelected : (selectedNodeId.value ? [selectedNodeId.value] : [])
    if (!ids.length) return
    const label = ids.length === 1
      ? `「${nodes.value.find(item => item.id === ids[0])?.data.label || '这个节点'}」`
      : `选中的 ${ids.length} 个节点`
    if (!confirmDelete(`确定删除${label}吗？相关连线也会删除。`)) return
    pushHistory()
    const idSet = new Set(ids)
    nodes.value = nodes.value.filter(node => !idSet.has(node.id))
    edges.value = edges.value.filter(edge => !idSet.has(edge.source) && !idSet.has(edge.target))
    if (idSet.has(selectedNodeId.value)) selectedNodeId.value = ''
    selectedEdgeId.value = ''
    scheduleSave()
  }

  function deleteEdge(edgeId: string) {
    pushHistory()
    edges.value = edges.value.filter(edge => edge.id !== edgeId)
    if (selectedEdgeId.value === edgeId) selectedEdgeId.value = ''
    scheduleSave()
  }

  function deleteNode(nodeId: string) {
    pushHistory()
    nodes.value = nodes.value.filter(node => node.id !== nodeId)
    edges.value = edges.value.filter(edge => edge.source !== nodeId && edge.target !== nodeId)
    if (selectedNodeId.value === nodeId) selectedNodeId.value = ''
    scheduleSave()
  }

  function duplicateNode(nodeId: string) {
    const original = nodes.value.find(node => node.id === nodeId)
    if (!original) return null
    pushHistory()
    const copy: CanvasNode = {
      ...clone(original),
      id: `node_${canvasNow().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      position: {
        x: original.position.x + 36,
        y: original.position.y + 36,
      },
      selected: false,
      data: {
        ...clone(original.data),
        label: `${original.data.label} 副本`,
        createdAt: canvasNow(),
        updatedAt: canvasNow(),
      } as CanvasNodeData,
    }
    nodes.value = [...nodes.value, copy]
    selectedNodeId.value = copy.id
    scheduleSave()
    return copy
  }

  function replaceNodes(next: CanvasNode[]) {
    nodes.value = next
    scheduleSave()
  }

  function replaceEdges(next: CanvasEdge[]) {
    edges.value = next
    scheduleSave()
  }

  function applyNodesChange(changes: NodeChange[]) {
    nodes.value = applyNodeChanges(changes, nodes.value as any) as CanvasNode[]
    scheduleSave()
  }

  function applyEdgesChange(changes: EdgeChange[]) {
    edges.value = applyEdgeChanges(changes, edges.value as any) as CanvasEdge[]
    scheduleSave()
  }

  function isGeneratedOutputConnection(sourceType?: CanvasNodeType, targetType?: CanvasNodeType) {
    return (sourceType === 'imageGen' && targetType === 'imageResult')
      || (sourceType === 'videoGen' && targetType === 'videoResult')
      || (sourceType === 'audioGen' && targetType === 'audioResult')
  }

  function getAbsoluteNodePosition(nodeId: string): { x: number; y: number } {
    const node = nodes.value.find(item => item.id === nodeId)
    if (!node) return { x: 0, y: 0 }
    const parentId = (node as any).parentNode || (node as any).parentId
    if (!parentId) return { x: node.position.x, y: node.position.y }
    const parent = getAbsoluteNodePosition(parentId)
    return { x: parent.x + node.position.x, y: parent.y + node.position.y }
  }

  function isValidConnection(connection: Connection) {
    if (!connection.source || !connection.target || connection.source === connection.target) return false
    const source = nodes.value.find(node => node.id === connection.source)
    const target = nodes.value.find(node => node.id === connection.target)
    if (!source || !target) return false
    if (source.type === 'group' || target.type === 'group') return false
    if (isGeneratedOutputConnection(source.type, target.type)) return true
    if (target.type === 'imageResult' || target.type === 'audioResult' || target.type === 'videoResult' || target.type === 'file') return false
    if (source.type === 'imageResult') return target.type === 'imageGen' || target.type === 'videoGen'
    if (source.type === 'videoResult') return target.type === 'videoGen'
    if (source.type === 'audioResult') return target.type === 'audioGen' || target.type === 'videoGen'
    if (source.type === 'text' || source.type === 'llm' || source.type === 'file' || source.type === 'tool') return target.type === 'llm' || target.type === 'imageGen' || target.type === 'videoGen' || target.type === 'audioGen'
    return false
  }

  function autoLayout() {
    pushHistory()
    const typeRank: Record<string, number> = { group: 0, text: 0, file: 0, tool: 0, llm: 1, imageGen: 2, videoGen: 2, audioGen: 2, imageResult: 3, videoResult: 3, audioResult: 3 }
    const lanes = new Map<number, number>()
    nodes.value = nodes.value.map(node => {
      const rank = typeRank[node.type] ?? 1
      const index = lanes.get(rank) || 0
      lanes.set(rank, index + 1)
      return { ...node, position: { x: 80 + rank * 340, y: 90 + index * 190 } }
    })
    scheduleSave()
  }

  function exportDocument(): CanvasDocumentV1 {
    return toDocument(nodes.value, edges.value, viewport.value, currentFileId.value || 'default', currentTitle.value || '我的画布')
  }

  function createNewDocument(title = '我的画布', fileId = '') {
    pushHistory()
    const doc = createStarterCanvasDocument(title, fileId || `canvas_${canvasNow().toString(36)}`)
    nodes.value = doc.nodes
    edges.value = doc.edges
    viewport.value = doc.viewport
    selectedNodeId.value = nodes.value[0]?.id || ''
    selectedEdgeId.value = ''
    currentFileId.value = fileId
    currentTitle.value = title
    scheduleSave()
    return doc
  }

  function importDocument(doc: CanvasDocumentV1, source?: { fileId?: string; title?: string }) {
    pushHistory()
    const clean = sanitizeCanvasDocument(doc)
    nodes.value = clean.nodes
    edges.value = clean.edges
    viewport.value = clean.viewport
    selectedNodeId.value = ''
    selectedEdgeId.value = ''
    currentFileId.value = source?.fileId || ''
    currentTitle.value = source?.title || clean.title || '我的画布'
    scheduleSave()
  }

  function normalizeMediaRolePool(nextEdge: CanvasEdge, pool: CanvasEdge[]) {
    const role = nextEdge.data?.role
    if (nextEdge.data?.kind !== 'media-role' || (role !== 'first_frame' && role !== 'last_frame')) return pool
    return pool.map(edge => edge.target === nextEdge.target && edge.id !== nextEdge.id && edge.data?.kind === 'media-role' && edge.data?.role === role
      ? { ...edge, data: { ...edge.data, role: 'reference' } as CanvasEdgeData }
      : edge)
  }

  function nextImageOrder(targetId: string, pool = edges.value) {
    const used = new Set(pool.filter(edge => edge.target === targetId && edge.data?.kind === 'image-role').map(edge => Number(edge.data?.order || 0)).filter(Boolean))
    for (let i = 1; i <= 5; i++) {
      if (!used.has(i)) return i
    }
    return used.size + 1
  }

  function connect(connection: Connection) {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    pushHistory()
    const sourceNode = nodes.value.find(node => node.id === connection.source)
    const targetNode = nodes.value.find(node => node.id === connection.target)
    const edge = createCanvasEdge(connection, sourceNode?.type, targetNode?.type, edges.value)
    if (!edge) return
    const existing = edges.value.filter(item => !(item.source === connection.source && item.target === connection.target))
    const normalizedEdge = edge.data?.kind === 'image-role' && !edge.data.order
      ? { ...edge, data: { ...edge.data, order: nextImageOrder(edge.target, existing) } as CanvasEdgeData }
      : edge
    edges.value = [...normalizeMediaRolePool(normalizedEdge, existing), normalizedEdge]
    scheduleSave()
  }

  function resolveEdgeKind(sourceType?: CanvasNodeType, targetType?: CanvasNodeType): CanvasEdgeData['kind'] {
    return resolveCanvasEdgeKind(sourceType, targetType)
  }

  function addEdge(sourceId: string, targetId: string, patch: Partial<CanvasEdgeData> = {}) {
    const sourceNode = nodes.value.find(node => node.id === sourceId)
    const targetNode = nodes.value.find(node => node.id === targetId)
    const edge = createCanvasEdge({ source: sourceId, target: targetId, sourceHandle: null, targetHandle: null }, sourceNode?.type, targetNode?.type, edges.value, patch)
    if (!edge) return null
    pushHistory()
    const existing = edges.value.filter(item => !(item.source === sourceId && item.target === targetId))
    const normalizedEdge = edge.data?.kind === 'image-role' && !patch.order
      ? { ...edge, data: { ...edge.data, order: nextImageOrder(edge.target, existing) } as CanvasEdgeData }
      : edge
    edges.value = [...normalizeMediaRolePool(normalizedEdge, existing), normalizedEdge]
    scheduleSave()
    return normalizedEdge
  }

  function updateEdgeData(edgeId: string, patch: Partial<CanvasEdgeData>) {
    const current = edges.value.find(edge => edge.id === edgeId)
    const target = current?.target
    edges.value = edges.value.map(edge => {
      if (target && edge.id !== edgeId && patch.kind !== 'image-role' && edge.target === target && edge.data?.kind === 'media-role' && (patch.role === 'first_frame' || patch.role === 'last_frame') && edge.data.role === patch.role) {
        return { ...edge, data: { ...edge.data, role: 'reference' } as CanvasEdgeData }
      }
      return edge.id === edgeId
        ? {
            ...edge,
            type: patch.kind ? edgeTypeForKind(patch.kind) : edge.type,
            data: { ...edge.data, ...patch, createdAt: edge.data?.createdAt || canvasNow() } as CanvasEdgeData,
          }
        : edge
    })
    scheduleSave()
  }

  function setNodeLabel(nodeId: string, label: string) {
    const clean = label.trim()
    if (!clean) return
    updateNodeData(nodeId, { label: clean } as any, true)
  }

  function setCanvasTitle(title: string) {
    const clean = title.trim()
    if (!clean) return
    currentTitle.value = clean
    scheduleSave()
  }

  function createConnectedNode(sourceId: string, targetType: CanvasNodeType, patch: Partial<CanvasNodeData> = {}, options: { dx?: number; dy?: number; edge?: Partial<CanvasEdgeData> } = {}) {
    const source = nodes.value.find(node => node.id === sourceId)
    if (!source) return null
    pushHistory()
    const sourcePosition = getAbsoluteNodePosition(source.id)
    const node = createCanvasNode(targetType, { ...defaultCanvasDataForType(targetType), ...patch } as CanvasNodeData, {
      x: sourcePosition.x + (options.dx ?? 340),
      y: sourcePosition.y + (options.dy ?? 0),
    })
    const edge = createCanvasEdge({ source: source.id, target: node.id, sourceHandle: null, targetHandle: null }, source.type, node.type, edges.value, options.edge || {})
    nodes.value = [...nodes.value, node]
    if (edge) edges.value = [...edges.value, edge]
    selectedNodeId.value = node.id
    scheduleSave()
    return node
  }

  function createTextToImageChain(sourceId: string) {
    return createConnectedNode(sourceId, 'imageGen', { label: '图片生成', prompt: '' } as any)
  }

  function createTextToAudioChain(sourceId: string) {
    return createConnectedNode(sourceId, 'audioGen', { label: '音频生成', prompt: '' } as any)
  }

  function createTextToVideoChain(sourceId: string) {
    return createConnectedNode(sourceId, 'videoGen', { label: '视频生成', prompt: '' } as any)
  }

  function createTextToLlmChain(sourceId: string) {
    return createConnectedNode(sourceId, 'llm', { label: 'AI 文本', prompt: '请基于输入内容继续生成。' } as any)
  }

  function createImageToImageChain(sourceId: string) {
    const image = nodes.value.find(node => node.id === sourceId)
    if (!image) return null
    let gen: CanvasNode
    startBatch()
    try {
      const imagePosition = getAbsoluteNodePosition(image.id)
      const text = createCanvasNode('text', { ...defaultCanvasDataForType('text'), label: '改图要求', content: '基于这张图继续生成，保持主体一致。' } as CanvasNodeData, { x: imagePosition.x + 320, y: imagePosition.y - 120 })
      gen = createCanvasNode('imageGen', { ...defaultCanvasDataForType('imageGen'), label: '图生图', prompt: '' } as CanvasNodeData, { x: imagePosition.x + 680, y: imagePosition.y })
      const textEdge = createCanvasEdge({ source: text.id, target: gen.id, sourceHandle: null, targetHandle: null }, text.type, gen.type, edges.value)
      const imageEdge = createCanvasEdge({ source: image.id, target: gen.id, sourceHandle: null, targetHandle: null }, image.type, gen.type, edges.value, { kind: 'image-role', role: 'reference', order: 1 })
      nodes.value = [...nodes.value, text, gen]
      edges.value = [...edges.value, ...[textEdge, imageEdge].filter(Boolean) as CanvasEdge[]]
      selectedNodeId.value = gen.id
      selectedEdgeId.value = ''
      scheduleSave()
    } finally {
      endBatch()
    }
    return gen
  }

  function createImageToVideoChain(sourceId: string) {
    const image = nodes.value.find(node => node.id === sourceId)
    if (!image) return null
    let gen: CanvasNode
    startBatch()
    try {
      const imagePosition = getAbsoluteNodePosition(image.id)
      const text = createCanvasNode('text', { ...defaultCanvasDataForType('text'), label: '视频要求', content: '让画面自然动起来，保留主体和画面风格。' } as CanvasNodeData, { x: imagePosition.x + 320, y: imagePosition.y - 120 })
      gen = createCanvasNode('videoGen', { ...defaultCanvasDataForType('videoGen'), label: '图生视频', prompt: '' } as CanvasNodeData, { x: imagePosition.x + 680, y: imagePosition.y })
      const textEdge = createCanvasEdge({ source: text.id, target: gen.id, sourceHandle: null, targetHandle: null }, text.type, gen.type, edges.value)
      const imageEdge = createCanvasEdge({ source: image.id, target: gen.id, sourceHandle: null, targetHandle: null }, image.type, gen.type, edges.value, { kind: 'media-role', role: 'first_frame' })
      nodes.value = [...nodes.value, text, gen]
      edges.value = [...edges.value, ...[textEdge, imageEdge].filter(Boolean) as CanvasEdge[]]
      selectedNodeId.value = gen.id
      selectedEdgeId.value = ''
      scheduleSave()
    } finally {
      endBatch()
    }
    return gen
  }

  function createVideoToVideoChain(sourceId: string) {
    const video = nodes.value.find(node => node.id === sourceId)
    if (!video) return null
    return createConnectedNode(sourceId, 'videoGen', { label: '视频续作', prompt: '基于这个视频继续生成，保持主体和风格。' } as any, { dx: 340, dy: 0, edge: { kind: 'media-role', role: 'reference' } })
  }

  function groupSelectedNodes(name?: string) {
    const selected = nodes.value.filter(node => node.selected && node.type !== 'group' && !node.parentNode)
    if (selected.length < 2) {
      window.alert('请先框选或多选至少 2 个节点。')
      return null
    }
    pushHistory()
    const minX = Math.min(...selected.map(node => node.position.x))
    const minY = Math.min(...selected.map(node => node.position.y))
    const maxX = Math.max(...selected.map(node => node.position.x + Number((node.data as any).width || 280)))
    const maxY = Math.max(...selected.map(node => node.position.y + Number((node.data as any).height || 180)))
    const label = name?.trim() || window.prompt('分组名称', '工作流分组')?.trim() || '工作流分组'
    const group = createCanvasNode('group', {
      ...defaultCanvasDataForType('group'),
      label,
      width: Math.max(360, maxX - minX + 80),
      height: Math.max(220, maxY - minY + 80),
    } as CanvasNodeData, { x: minX - 40, y: minY - 50 })
    nodes.value = [{ ...group, selected: true }, ...nodes.value.map(node => {
      if (!selected.some(item => item.id === node.id)) return node
      return {
        ...node,
        selected: false,
        parentNode: group.id,
        extent: 'parent' as const,
        expandParent: true,
        position: {
          x: node.position.x - group.position.x,
          y: node.position.y - group.position.y,
        },
      }
    })]
    selectedNodeId.value = group.id
    scheduleSave()
    return group
  }

  function addWorkflowTemplate(template: CanvasWorkflowTemplate) {
    startBatch()
    try {
      const baseX = 120 + nodes.value.length * 16
      const baseY = 120 + nodes.value.length * 12
      const idMap = new Map<string, string>()
      const newNodes: CanvasNode[] = []
      for (const item of template.nodes) {
        const node = createCanvasNode(item.type, { ...defaultCanvasDataForType(item.type), label: item.label, ...(item.data || {}) } as CanvasNodeData, {
          x: baseX + item.x,
          y: baseY + item.y,
        })
        idMap.set(item.key, node.id)
        newNodes.push(node)
      }
      const newEdges: CanvasEdge[] = []
      for (const item of template.edges) {
        const source = idMap.get(item.source)
        const target = idMap.get(item.target)
        if (!source || !target) continue
        const sourceNode = newNodes.find(node => node.id === source)
        const targetNode = newNodes.find(node => node.id === target)
        const edge = createCanvasEdge({ source, target, sourceHandle: null, targetHandle: null }, sourceNode?.type, targetNode?.type, [...edges.value, ...newEdges], item.data || {})
        if (edge) newEdges.push(edge)
      }
      nodes.value = [...nodes.value, ...newNodes]
      edges.value = [...edges.value, ...newEdges]
      selectedNodeId.value = newNodes[0]?.id || selectedNodeId.value
      scheduleSave()
    } finally {
      endBatch()
    }
  }

  function setViewport(next: Partial<CanvasViewport>) {
    viewport.value = {
      x: Number(next.x ?? viewport.value.x),
      y: Number(next.y ?? viewport.value.y),
      zoom: Number(next.zoom ?? viewport.value.zoom),
    }
    scheduleSave()
  }

  function undo() {
    const prev = history.value.at(-1)
    if (!prev) return
    history.value = history.value.slice(0, -1)
    redoStack.value = [...redoStack.value, snapshot()]
    nodes.value = clone(prev.nodes)
    edges.value = clone(prev.edges)
    viewport.value = clone(prev.viewport)
    scheduleSave()
  }

  function redo() {
    const next = redoStack.value.at(-1)
    if (!next) return
    redoStack.value = redoStack.value.slice(0, -1)
    history.value = [...history.value, snapshot()]
    nodes.value = clone(next.nodes)
    edges.value = clone(next.edges)
    viewport.value = clone(next.viewport)
    scheduleSave()
  }

  return {
    nodes,
    edges,
    viewport,
    currentFileId,
    currentTitle,
    selectedNodeId,
    selectedEdgeId,
    selectedNode,
    publicNodes,
    initialized,
    loading,
    gridVisible,
    stopRequested,
    executionLogs,
    canUndo: computed(() => history.value.length > 0),
    canRedo: computed(() => redoStack.value.length > 0),
    load,
    saveNow,
    resetToStarter,
    addExecutionLog,
    clearExecutionLogs,
    requestStop,
    resetStopRequest,
    toggleGrid,
    bringToFront,
    addNode,
    updateNodeData,
    setNodeStatus,
    selectNode,
    selectEdge,
    selectedNodeIds,
    selectAllNodes,
    clearSelection,
    deleteSelected,
    deleteNode,
    deleteEdge,
    duplicateNode,
    replaceNodes,
    replaceEdges,
    isValidConnection,
    autoLayout,
    groupSelectedNodes,
    exportDocument,
    createNewDocument,
    importDocument,
    applyNodesChange,
    applyEdgesChange,
    connect,
    addNodeWithData,
    addEdge,
    getAbsoluteNodePosition,
    updateEdgeData,
    setNodeLabel,
    setCanvasTitle,
    createConnectedNode,
    createTextToImageChain,
    createTextToAudioChain,
    createTextToVideoChain,
    createTextToLlmChain,
    createImageToImageChain,
    createImageToVideoChain,
    createVideoToVideoChain,
    addWorkflowTemplate,
    mentionToken,
    setViewport,
    undo,
    redo,
    startBatch,
    endBatch,
  }
})
