<script setup lang="ts">
import { computed, markRaw, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useVueFlow, VueFlow, type EdgeMouseEvent, type NodeMouseEvent, type ViewportTransform } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

import CanvasToolbar from './CanvasToolbar.vue'
import CanvasNodeLibrary from './CanvasNodeLibrary.vue'
import CanvasWorkflowPanel from './CanvasWorkflowPanel.vue'
import CanvasExecutionLog from './CanvasExecutionLog.vue'
import CanvasModeControls from './CanvasModeControls.vue'

// Phase 0 开发期集成（仅开发环境）
import { isV8CanvasEnabled, enableV8CanvasForThisSession } from './dev/V8DevToggle'
// V8 冻结策略装车（真实画布立即生效，零风险）
import { globalFreeze } from '@/components/canvas/v8'

// Week 1+ V8 node replacements (old Canvas* untouched; registration swapped here)
import V8TextNode from './v8/nodes/V8TextNode.vue'
import SkillNode from './v8/nodes/SkillNode.vue'
import V8ToolsetNode from './v8/nodes/V8ToolsetNode.vue'
import V8LlmNode from './v8/nodes/V8LlmNode.vue'
import V8ImageGenNode from './v8/nodes/V8ImageGenNode.vue'
import V8VideoGenNode from './v8/nodes/V8VideoGenNode.vue'
import V8AudioGenNode from './v8/nodes/V8AudioGenNode.vue'
import V8ImageResultNode from './v8/nodes/V8ImageResultNode.vue'
import V8VideoResultNode from './v8/nodes/V8VideoResultNode.vue'
import V8AudioResultNode from './v8/nodes/V8AudioResultNode.vue'
import V8GroupNode from './v8/nodes/V8GroupNode.vue'
import V8LoopNode from './v8/nodes/V8LoopNode.vue'
import V8TextSplitNode from './v8/nodes/V8TextSplitNode.vue'
import { isValidConnection as v8IsValidConnection, inferEdgeType } from './v8/utils/connectionValidation'
import { run30NodeBenchmark, v8GetBenchmarkReport } from './v8/utils/performanceBenchmark'
import { runFull30NodeAutoDragBenchmark, createDiverse30NodeCanvas } from './v8/utils/simulate30NodeAutoDrag'
import CanvasRunningHubNode from './nodes/CanvasRunningHubNode.vue'
// T8 迁入节点 (legacy, no V8 replacement yet)
import CanvasSeedanceNode from './nodes/CanvasSeedanceNode.vue'
import CanvasRunningHubWalletNode from './nodes/CanvasRunningHubWalletNode.vue'
import CanvasRhToolsNode from './nodes/CanvasRhToolsNode.vue'
import CanvasRhConfigNode from './nodes/CanvasRhConfigNode.vue'
import CanvasUploadNode from './nodes/CanvasUploadNode.vue'
import CanvasMaterialSetNode from './nodes/CanvasMaterialSetNode.vue'
import CanvasOutputNode from './nodes/CanvasOutputNode.vue'
import CanvasPickFromSetNode from './nodes/CanvasPickFromSetNode.vue'
import CanvasFramePairNode from './nodes/CanvasFramePairNode.vue'
import CanvasResizeNode from './nodes/CanvasResizeNode.vue'
import CanvasCombineNode from './nodes/CanvasCombineNode.vue'
import CanvasRemoveBgNode from './nodes/CanvasRemoveBgNode.vue'
import CanvasUpscaleNode from './nodes/CanvasUpscaleNode.vue'
import CanvasGridCropNode from './nodes/CanvasGridCropNode.vue'
import CanvasImageCompareNode from './nodes/CanvasImageCompareNode.vue'
import CanvasDrawingBoardNode from './nodes/CanvasDrawingBoardNode.vue'
import CanvasBrowserNode from './nodes/CanvasBrowserNode.vue'
import CanvasFrameExtractorNode from './nodes/CanvasFrameExtractorNode.vue'
import CanvasStoryboardGridNode from './nodes/CanvasStoryboardGridNode.vue'
import CanvasCinematicNode from './nodes/CanvasCinematicNode.vue'
import CanvasVideoMotionNode from './nodes/CanvasVideoMotionNode.vue'
import CanvasMultiAngleVisualNode from './nodes/CanvasMultiAngleVisualNode.vue'
import CanvasIdeaNode from './nodes/CanvasIdeaNode.vue'
import CanvasBpNode from './nodes/CanvasBpNode.vue'
import CanvasRelayNode from './nodes/CanvasRelayNode.vue'
import CanvasEditNode from './nodes/CanvasEditNode.vue'
import CanvasVideoOutputNode from './nodes/CanvasVideoOutputNode.vue'
import PromptOrderEdge from './edges/PromptOrderEdge.vue'
import ImageRoleEdge from './edges/ImageRoleEdge.vue'
import MediaRoleEdge from './edges/MediaRoleEdge.vue'
import ImageOrderEdge from './edges/ImageOrderEdge.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useFileStore } from '@/composables/useFileStore'
import { consumeLastEvent, emitEvent, onEvent } from '@/utils/eventBus'
import type { CanvasDocumentV1, CanvasNodeType } from '@/types/canvas'
import { runAllCanvasNodes, runCanvasNode } from './runtime/canvasExecutor'
import { confirmAction } from '@/utils/confirmAction'
import { isTauriRuntime } from '@/utils/tauriEnv'

const canvasStore = useCanvasStore()
const fileStore = useFileStore()
let offOpenCanvasDocument: (() => void) | null = null
const showWorkflows = ref(false)
const toastMessage = ref('')

// Phase 3: 底部输入栏两段式
const bottomInput = ref('')
const showRecommendation = ref(false)
const recommendedPlan = ref<string[]>([])

// Phase 3: 迁移向导骨架
const showMigrationWizard = ref(false)
const migrationOldTitle = ref('')
const migrationBackupDone = ref(false)
const migrationUpgradableCount = ref(0)

// Phase 3: Context 栏动态状态 + 视觉层级 (增强 wiring 感知，拖拽连线后自动反映)
const connectedContexts = computed(() => {
  const ctxNodes = canvasStore.nodes.filter(n => ['skill', 'toolset'].includes(n.type || ''))
  const edges = canvasStore.edges || []
  const isWiredToCore = (ctxId: string) => edges.some(e => {
    if (e.source !== ctxId && e.target !== ctxId) return false
    const otherId = e.source === ctxId ? e.target : e.source
    const other = canvasStore.nodes.find(nn => nn.id === otherId)
    return other && ['llm', 'group', 'text'].includes(other.type || '')
  })
  return {
    skill: ctxNodes.some(n => n.type === 'skill' && isWiredToCore(n.id)),
    tools: ctxNodes.some(n => n.type === 'toolset' && isWiredToCore(n.id)),
  }
})

const isExecuting = computed(() => 
  canvasStore.nodes.some(n => n.data?.status === 'running' || n.data?.status === 'generating')
)

const nodeCount = computed(() => canvasStore.nodes.length)
const shouldDegradeVisuals = computed(() => nodeCount.value > 15)

const activeExecutionPath = computed(() => {
  if (!isExecuting.value || shouldDegradeVisuals.value) return new Set<string>()
  const runningIds = canvasStore.nodes
    .filter(n => n.data?.status === 'running' || n.data?.status === 'generating')
    .map(n => n.id)
  const path = new Set(runningIds)
  // collect one-hop prompt predecessors (for visual path highlight)
  canvasStore.edges.forEach((e: any) => {
    if (runningIds.includes(e.target)) {
      const isPromptish = (e.sourceHandle && (e.sourceHandle.includes('text') || e.sourceHandle.includes('out') || e.sourceHandle.includes('right'))) ||
        e.type === 'prompt-flow' || e.type === 'promptOrder'
      if (isPromptish) path.add(e.source)
    }
  })
  return path
})

let toastTimer: ReturnType<typeof setTimeout> | null = null
const editingTitle = ref(false)
const titleInput = ref('')
const contextMenu = ref<{ 
  show: boolean; 
  x: number; y: number; 
  flowX: number; flowY: number;
  mode: 'blank' | 'node' | 'handle' | 'multi';
  targetId?: string;
  targetHandle?: string;
}>({ show: false, x: 0, y: 0, flowX: 0, flowY: 0, mode: 'blank' })
const contextNodeOptions: Array<{ type: CanvasNodeType; icon: string; label: string }> = [
  // 核心
  { type: 'text', icon: 'notes', label: '文本节点' },
  { type: 'llm', icon: 'smart_toy', label: 'LLM 节点' },
  { type: 'imageGen', icon: 'image', label: '图片生成' },
  { type: 'videoGen', icon: 'movie', label: '视频生成' },
  { type: 'audioGen', icon: 'music_note', label: '音频生成' },
  { type: 'runninghub', icon: 'workflow', label: 'RunningHub' },
  { type: 'seedance', icon: 'movie', label: 'Seedance' },
  // 结果
  { type: 'imageResult', icon: 'image', label: '图片结果' },
  { type: 'videoResult', icon: 'movie', label: '视频结果' },
  { type: 'audioResult', icon: 'audio_file', label: '音频结果' },
  // 素材
  { type: 'upload', icon: 'upload_file', label: '上传素材' },
  { type: 'materialSet', icon: 'collections', label: '素材集' },
  { type: 'output', icon: 'preview', label: '输出预览' },
  // 流程
  { type: 'loop', icon: 'repeat', label: '循环器' },
  { type: 'pickFromSet', icon: 'filter_alt', label: '从合集获取' },
  { type: 'textSplit', icon: 'splitscreen', label: '文本分割' },
  { type: 'framePair', icon: 'film_frames', label: '首尾帧' },
  // 图像处理
  { type: 'resize', icon: 'aspect_ratio', label: '尺寸调整' },
  { type: 'combine', icon: 'join', label: '合并' },
  { type: 'gridCrop', icon: 'grid_view', label: '宫格剪裁' },
  { type: 'imageCompare', icon: 'compare', label: '图像对比' },
  // 工具箱
  { type: 'cinematic', icon: 'theaters', label: '电影感' },
  { type: 'videoMotion', icon: 'videocam', label: '视频运镜' },
  { type: 'multiAngleVisual', icon: '360', label: '多角度' },
  // 辅助
  { type: 'idea', icon: 'lightbulb', label: '灵感' },
  { type: 'bp', icon: 'account_tree', label: '蓝图' },
  { type: 'relay', icon: 'swap_horiz', label: '中继' },
  { type: 'tool', icon: 'construction', label: '本地工具' },
  { type: 'file', icon: 'draft', label: '文件' },
  { type: 'group', icon: 'folder_open', label: '分组' },
]

// ===== Mig-001~004: 迁移向导映射 + 纯函数（数据零丢失、连线保留、V8 字段补全） =====
const V8_MIGRATABLE = new Set< string >([
  'text','llm','skill','toolset',
  'imageGen','videoGen','audioGen',
  'imageResult','videoResult','audioResult',
  'group','loop','textSplit'
]);

const LEGACY_TO_V8_MAP: Record<string, CanvasNodeType> = {
  'text': 'text',
  'llm': 'llm',
  'imageGen': 'imageGen',
  'videoGen': 'videoGen',
  'audioGen': 'audioGen',
  'imageResult': 'imageResult',
  'videoResult': 'videoResult',
  'audioResult': 'audioResult',
  'group': 'group',
  'loop': 'loop',
  'textSplit': 'textSplit',
  // T8 迁入示例（Mig-003/004）：runninghub 类 -> videoGen（参数尽力保留）
  'runninghub': 'videoGen',
  'runninghubWallet': 'videoGen',
  'seedance': 'videoGen',
  'rhTools': 'videoGen',
  'rhConfig': 'videoGen',
};

function getV8TypeFor(oldType: string | undefined): CanvasNodeType | null {
  if (!oldType) return null;
  return LEGACY_TO_V8_MAP[oldType] || null;
}

function isV8MigratableType(t: string | undefined): boolean {
  if (!t) return false;
  return V8_MIGRATABLE.has(t) || !!LEGACY_TO_V8_MAP[t];
}

function needsV8Upgrade(t: string | undefined): boolean {
  if (!t) return false;
  const target = getV8TypeFor(t);
  return !!target && target !== t;
}

function remapNodeForV8(node: any): any {
  const n = { ...node, data: { ...(node.data || {}) } };
  const targetType = getV8TypeFor(n.type);
  if (targetType && targetType !== n.type) {
    const oldType = n.type;
    n.type = targetType;
    // 特殊映射示例
    if (['runninghub', 'seedance', 'runninghubWallet', 'rhTools', 'rhConfig'].includes(oldType)) {
      n.data.prompt = n.data.prompt || n.data.webappId || (Array.isArray(n.data.nodeInfoList) ? 'Migrated RH: ' + JSON.stringify(n.data.nodeInfoList).slice(0, 180) : '');
      n.data.modelId = n.data.modelId || 'seedance-2';
      n.data.label = n.data.label || '视频生成(从旧版迁移)';
    }
  }
  // V8 必备字段补全（collapsed 支持手感、status 等），零数据丢失
  if (typeof n.data.collapsed === 'undefined') n.data.collapsed = false;
  if (!n.data.label) n.data.label = (n.data.content ? String(n.data.content).slice(0,30) : n.type);
  if (!n.data.status) n.data.status = 'idle';
  // parentNode / childNodeIds / width/height / 任意自定义全部保留
  return n;
}

function remapNodesForMigration(nodes: any[]): any[] {
  return nodes.map(remapNodeForV8);
}

function countMigratable(nodes: any[]): number {
  return nodes.filter(n => isV8MigratableType(n.type)).length;
}

const nodeCountWarning = computed(() => canvasStore.nodes.length >= 100)
const flowNodes = computed({
  get: () => {
    const base = canvasStore.nodes
    const active = activeExecutionPath.value
    if (!active.size) return base
    // augment for visual path (class on wrapper for extra lift/ring) - no store mutation
    return base.map(n => {
      if (active.has(n.id)) {
        const extra = ' v8-active-path'
        const cls = ( (n as any).class || (n as any).className || '' ) + extra
        return { ...n, class: cls.trim() }
      }
      return n
    })
  },
  set: value => canvasStore.replaceNodes(value as any),
})
const flowEdges = computed({
  get: () => canvasStore.edges,
  set: value => canvasStore.replaceEdges(value as any),
})
const flow = useVueFlow('jiucai-canvas')
const selectedCount = computed(() => canvasStore.selectedNodeIds().length)

const nodeTypes = {
  // V8 replacements only for migrated types (old Canvas* imports removed for these; legacy kept only for unmigrated T8)
  text: markRaw(V8TextNode),
  // V8 Context Providers (Week 1-3) — selectors only, no execution
  skill: markRaw(SkillNode),
  toolset: markRaw(V8ToolsetNode),
  // V8 MediaGen (Week 3) — 3/4 layer + SHA cache + full state machine
  imageGen: markRaw(V8ImageGenNode),
  videoGen: markRaw(V8VideoGenNode),
  audioGen: markRaw(V8AudioGenNode),
  // V8 Result nodes (gallery style)
  imageResult: markRaw(V8ImageResultNode),
  videoResult: markRaw(V8VideoResultNode),
  audioResult: markRaw(V8AudioResultNode),
  // V8 Group (Week 4-6, G-001 highest priority — N independent prompt ports on fold)
  group: markRaw(V8GroupNode),
  loop: markRaw(V8LoopNode),
  textSplit: markRaw(V8TextSplitNode),
  // V8 LLM (Week 2) — 3-way context, 5-tab progressive, permissive tools per useChat + v5.1
  llm: markRaw(V8LlmNode),
  runninghub: markRaw(CanvasRunningHubNode),
  file: markRaw(CanvasUploadNode),
  tool: markRaw(V8ToolsetNode),
  // T8 迁入 (legacy, not yet V8)
  seedance: markRaw(CanvasSeedanceNode),
  runninghubWallet: markRaw(CanvasRunningHubWalletNode),
  rhTools: markRaw(CanvasRhToolsNode),
  rhConfig: markRaw(CanvasRhConfigNode),
  upload: markRaw(CanvasUploadNode),
  materialSet: markRaw(CanvasMaterialSetNode),
  output: markRaw(CanvasOutputNode),
  pickFromSet: markRaw(CanvasPickFromSetNode),
  framePair: markRaw(CanvasFramePairNode),
  resize: markRaw(CanvasResizeNode),
  combine: markRaw(CanvasCombineNode),
  removeBg: markRaw(CanvasRemoveBgNode),
  upscale: markRaw(CanvasUpscaleNode),
  gridCrop: markRaw(CanvasGridCropNode),
  imageCompare: markRaw(CanvasImageCompareNode),
  drawingBoard: markRaw(CanvasDrawingBoardNode),
  browserNode: markRaw(CanvasBrowserNode),
  frameExtractor: markRaw(CanvasFrameExtractorNode),
  storyboardGrid: markRaw(CanvasStoryboardGridNode),
  cinematic: markRaw(CanvasCinematicNode),
  videoMotion: markRaw(CanvasVideoMotionNode),
  multiAngleVisual: markRaw(CanvasMultiAngleVisualNode),
  idea: markRaw(CanvasIdeaNode),
  bp: markRaw(CanvasBpNode),
  relay: markRaw(CanvasRelayNode),
  edit: markRaw(CanvasEditNode),
  videoOutput: markRaw(CanvasVideoOutputNode),
} as any

const edgeTypes = {
  promptOrder: markRaw(PromptOrderEdge),
  imageRole: markRaw(ImageRoleEdge),
  imageOrder: markRaw(ImageOrderEdge),
  mediaRole: markRaw(MediaRoleEdge),
} as any

// Phase 2 enhanced 14x14 validation (prefers V8 matrix for new nodes, falls back gracefully)
function isGroupFolded(nodeId: string): boolean {
  const node = canvasStore.nodes.find(n => n.id === nodeId)
  return node?.type === 'group' && !!node.data?.isFolded
}

function enhancedIsValidConnection(params: any) {
  const sourceNode = canvasStore.nodes.find(n => n.id === params.source)
  const targetNode = canvasStore.nodes.find(n => n.id === params.target)
  if (!sourceNode || !targetNode) return true

  const sourceType = sourceNode.type as any
  const targetType = targetNode.type as any

  const groupFolded = isGroupFolded(params.source) || isGroupFolded(params.target)

  const v8Result = v8IsValidConnection(sourceType, targetType, params.sourceHandle, params.targetHandle, groupFolded)
  if (v8Result !== null) return v8Result

  return canvasStore.isValidConnection(params)
}

// Phase 2: Wrapped connect with validation toast (Chinese, per assignment)
function handleConnect(params: any) {
  const sourceNode = canvasStore.nodes.find(n => n.id === params.source)
  const targetNode = canvasStore.nodes.find(n => n.id === params.target)

  if (sourceNode && targetNode) {
    const sourceType = sourceNode.type as any
    const targetType = targetNode.type as any
    const groupFolded = isGroupFolded(params.source) || isGroupFolded(params.target)
    const allowed = v8IsValidConnection(sourceType, targetType, params.sourceHandle, params.targetHandle, groupFolded)

    if (allowed === null) {
      // Show Chinese toast for illegal connection
      showToast(`非法连线：${sourceType} → ${targetType} 不允许（请参考 14×14 矩阵）`)
      return // Block the connection
    }
  }

  // Set edge type for visual hierarchy (prompt-flow breathing etc during exec)
  try {
    const srcType = sourceNode?.type as any
    const tgtType = targetNode?.type as any
    const eType = inferEdgeType(srcType, tgtType, params.sourceHandle, params.targetHandle)
    if (eType) {
      params.type = eType
    }
  } catch {}

  // Proceed with original store connect
  canvasStore.connect(params)
}

function onRunNodeEvent(event: Event) {
  const nodeId = String((event as CustomEvent).detail || '')
  if (nodeId) void runCanvasNode(nodeId)
}

function onRunAllEvent() {
  void runAllCanvasNodes()
}

// 完整右键 Group 动作处理器（G-003）：子图执行 + 模板导出（占位符）
function handleV8GroupAction(event: Event) {
  const detail = (event as CustomEvent).detail || {}
  const groupId = detail.groupId
  const action = detail.action
  if (!groupId) return
  const groupNode = canvasStore.nodes.find(n => n.id === groupId)
  if (!groupNode) return

  if (action === 'execute') {
    // 收集子节点：优先 parentNode，其次 group 的 childNodeIds 数据
    const children = canvasStore.nodes.filter(n =>
      (n as any).parentNode === groupId ||
      (groupNode.data?.childNodeIds || []).includes(n.id)
    )
    if (!children.length) {
      showToast('Group 内无子节点（可展开后拖入节点，或使用 parentNode 嵌套）')
      return
    }
    let ran = 0
    children.forEach(ch => {
      const t = ch.type
      if (t && ['skill','toolset'].includes(t)) return
      void runCanvasNode(ch.id)
      ran++
    })
    showToast(`已请求执行 Group 子图（${ran} 个节点）`)
  } else if (action === 'export-template') {
    // G-003：导出占位符模板（不含具体数据，仅结构 + 端口声明）
    const children = canvasStore.nodes.filter(n =>
      (n as any).parentNode === groupId ||
      (groupNode.data?.childNodeIds || []).includes(n.id)
    )
    const childIds = new Set(children.map(c => c.id))
    const internalEdges = canvasStore.edges.filter(e => childIds.has(e.source) && childIds.has(e.target))
    const template = {
      kind: 'v8-group-template',
      version: '1.0',
      groupLabel: groupNode.data?.label || 'Group',
      nodes: children.map(c => ({
        type: c.type,
        // 使用占位符 label，不复制用户内容
        data: { label: c.data?.label || c.type, isTemplatePlaceholder: true }
      })),
      edges: internalEdges.map(e => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle })),
      promptPorts: groupNode.data?.promptPortCount || 1,
      exportedAt: Date.now()
    }
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `group-template-${groupId.slice(0,6)}.json`
    a.click()
    URL.revokeObjectURL(url)
    showToast('Group 模板已导出（占位符 + 结构，G-003）')
  }
}

function openCanvasDocument(payload: any) {
  try {
    const doc = JSON.parse(String(payload?.content || '')) as CanvasDocumentV1
    canvasStore.importDocument(doc, { fileId: String(payload?.fileId || ''), title: String(payload?.name || doc.title || '我的画布') })
    showToast(`已打开画布：${canvasStore.currentTitle}`)

    // Phase 3: 自动触发迁移向导（检测旧版画布） - 更鲁棒
    const hasNewV8Markers = doc.nodes?.some((n: any) => n.type && ['skill','toolset','group'].includes(n.type))
    const hasCollapsed = doc.nodes?.length > 0 && doc.nodes.some((n: any) => n.data && n.data.hasOwnProperty?.('collapsed'))
    const hasLegacyCandidate = doc.nodes?.some((n: any) => isV8MigratableType(n.type) && !V8_MIGRATABLE.has(n.type)) // e.g. runninghub etc that can remap
    const looksOld = !hasNewV8Markers || !hasCollapsed || hasLegacyCandidate
    if (looksOld && !localStorage.getItem('v8_migration_shown_' + (payload?.fileId || ''))) {
      setTimeout(() => {
        // @ts-ignore - function defined later in file
        if (typeof triggerMigrationWizard === 'function') {
          triggerMigrationWizard(canvasStore.currentTitle || '旧画布')
          localStorage.setItem('v8_migration_shown_' + (payload?.fileId || ''), 'true')
        }
      }, 600)
    }
  } catch {
    window.alert('画布文件无法打开，内容格式不正确。')
  }
}

onMounted(async () => {
  console.warn(
    '%c[Canvas V8] 用户已手动开启画布入口进行测试。' +
    '当前仍存在检查项未完全闭环（见 PHASE0_CURRENT_PROGRESS.md）。' +
    '请勿用于生产数据。',
    'color:#f59e0b; font-weight:bold; font-size:13px'
  )

  // 暴露 30 节点性能基准命令（用户手动测试用）
  console.log('%c[Canvas V8] 性能测试命令已就绪：', 'color:#3b82f6')
  console.log('  runV8_30NodeBenchmark()  → 开始 8 秒 Jank 测量（请拖拽缩放）')
  console.log('  v8GetBenchmarkReport()   → 输出报告')
  console.log('  v8LoadHeavyTestCanvas()  → 快速加载 30 节点重负载测试画布')
  console.log('  v8RunFullAuto30NodeDragBenchmark() → 【推荐】完整自动 30 节点拖拽基准（推荐使用）')

  // 快速加载重负载测试画布（30节点混杂 V8 节点，使用多样化 14 V8 类型）
  ;(window as any).v8LoadHeavyTestCanvas = () => {
    createDiverse30NodeCanvas()
    console.log('%c[Canvas V8] 30节点重负载测试画布已加载（完整14 V8类型 + 连线），请使用 runV8_30NodeBenchmark() 或 v8RunFullAuto30NodeDragBenchmark() 进行测量', 'color:#10b981')
  }

  // 直接暴露 auto benchmark (in case module side-effect not sufficient)
  ;(window as any).v8RunFullAuto30NodeDragBenchmark = runFull30NodeAutoDragBenchmark

  await canvasStore.load()
  if (canvasStore.nodes.length === 0) canvasStore.resetToStarter()
  await nextTick()
  await flow.setViewport(canvasStore.viewport).catch(() => false)
  window.addEventListener('jc-canvas-run-node', onRunNodeEvent)
  window.addEventListener('jc-canvas-run-all', onRunAllEvent)
  window.addEventListener('v8-group-action', handleV8GroupAction)
  window.addEventListener('keydown', onKeydown)
  offOpenCanvasDocument = onEvent('open-canvas-document', openCanvasDocument)
  const pendingOpen = consumeLastEvent('open-canvas-document')
  if (pendingOpen) openCanvasDocument(pendingOpen[0])

  // Phase 0 开发期：如果开关打开则激活 V8 手感系统
  if (isV8CanvasEnabled()) {
    // 动态激活（避免生产打包）
    import('./dev/V8DevToggle').then(({ enableV8CanvasForThisSession }) => {
      enableV8CanvasForThisSession()
    })
  }
})

onUnmounted(() => {
  window.removeEventListener('jc-canvas-run-node', onRunNodeEvent)
  window.removeEventListener('jc-canvas-run-all', onRunAllEvent)
  window.removeEventListener('v8-group-action', handleV8GroupAction)
  window.removeEventListener('keydown', onKeydown)
  if (toastTimer) clearTimeout(toastTimer)
  offOpenCanvasDocument?.()
  offOpenCanvasDocument = null
})

function showToast(message: string) {
  toastMessage.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMessage.value = '' }, 2200)
}

function addNode(type: CanvasNodeType) {
  const wrap = document.querySelector('.cw-flow-wrap') as HTMLElement | null
  const rect = wrap?.getBoundingClientRect()
  if (rect) {
    const point = flow.screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    canvasStore.addNode(type, point)
    return
  }
  canvasStore.addNode(type)
}

function onDragNode(event: DragEvent, type: CanvasNodeType) {
  event.dataTransfer?.setData('application/jiucai-canvas-node', type)
  event.dataTransfer?.setData('text/plain', type)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}

function hideContextMenu() {
  contextMenu.value.show = false
}

// Phase 3: 检测右键目标（支持 4 场景） - 增强 V8 兼容（NodeFrame data attrs + 回退）
function detectRightClickTarget(event: MouseEvent) {
  const target = event.target as HTMLElement
  const handleEl = target.closest('.vue-flow__handle') as HTMLElement | null
  const frameEl = target.closest('.v8-node-frame') as HTMLElement | null
  const nodeEl = target.closest('.vue-flow__node') as HTMLElement | null
  const selectedCount = canvasStore.selectedNodeIds().length

  if (handleEl) {
    // VueFlow handle: prefer data-handleid or id attr (format usually nodeId-sourceHandle or similar)
    const hid = handleEl.getAttribute('data-handleid') || handleEl.getAttribute('data-handle') || handleEl.id || undefined
    return { mode: 'handle' as const, handleId: hid }
  }
  if (frameEl && frameEl.dataset.nodeId) {
    return { mode: 'node' as const, nodeId: frameEl.dataset.nodeId }
  }
  if (nodeEl) {
    // Fallback for V8/legacy: dataset.id or vue internal or data-id attr VueFlow sets
    const nid = (nodeEl as any).dataset?.id || nodeEl.getAttribute('data-id') || (nodeEl as any).__vueParentComponent?.props?.id || undefined
    if (nid) return { mode: 'node' as const, nodeId: nid }
  }
  if (selectedCount > 1) {
    return { mode: 'multi' as const }
  }
  return { mode: 'blank' as const }
}

function openContextMenu(event: MouseEvent) {
  event.preventDefault()
  const point = flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  const detection = detectRightClickTarget(event)

  contextMenu.value = {
    show: true,
    x: event.clientX,
    y: event.clientY,
    flowX: point.x,
    flowY: point.y,
    mode: detection.mode,
    targetId: (detection as any).nodeId,
    targetHandle: (detection as any).handleId,
  }
}

function addNodeFromContext(type: CanvasNodeType) {
  canvasStore.addNode(type, { x: contextMenu.value.flowX, y: contextMenu.value.flowY })
  hideContextMenu()
}

// ===== Phase 3: 4 场景右键菜单辅助函数 =====
function getNodeType(nodeId: string) {
  return canvasStore.nodes.find(n => n.id === nodeId)?.type
}

function duplicateNode(nodeId: string) {
  hideContextMenu()
  canvasStore.duplicateNode(nodeId)
}

function deleteNode(nodeId: string) {
  hideContextMenu()
  canvasStore.deleteNode(nodeId)
}

function executeSubgraph(groupId: string) {
  hideContextMenu()
  // 触发 Group 独立执行（G-003）- 由统一 listener 处理真实动作
  window.dispatchEvent(new CustomEvent('v8-group-action', { detail: { groupId, action: 'execute' } }))
}

function exportGroupAsTemplate(groupId: string) {
  hideContextMenu()
  window.dispatchEvent(new CustomEvent('v8-group-action', { detail: { groupId, action: 'export-template' } }))
}

function downloadResult(nodeId: string) {
  hideContextMenu()
  const node = canvasStore.nodes.find(n => n.id === nodeId)
  const url = node?.data?.url || node?.data?.outputUrl
  if (url) {
    const a = document.createElement('a')
    a.href = url
    a.download = `result-${nodeId}`
    a.click()
  }
}

function setAsReference(nodeId: string) {
  hideContextMenu()
  canvasStore.updateNodeData(nodeId, { isReference: true })
  showToast('已设为参考素材')
}

// 完整多选批量执行（M-005）
function runSelectedNodes() {
  const ids = canvasStore.selectedNodeIds()
  if (!ids.length) return
  hideContextMenu()
  let count = 0
  ids.forEach(id => {
    // 跳过 Context Provider（无执行语义）
    const t = getNodeType(id)
    if (t && ['skill', 'toolset'].includes(t)) return
    if (executeV8Orchestration(id)) {
      count++
      return
    }
    void runCanvasNode(id)
    count++
  })
  if (count) showToast(`已触发 ${count} 个节点执行`)
}

// V8 execution hook for nodes with internal sim (gens + orch) — dispatch to component logic without touching old executor
function executeV8Orchestration(nodeId: string): boolean {
  const t = getNodeType(nodeId)
  const v8SimTypes = ['imageGen','videoGen','audioGen','loop','textSplit']
  if (v8SimTypes.includes(t || '')) {
    window.dispatchEvent(new CustomEvent('v8-execute-node', { detail: { id: nodeId, type: t } }))
    showToast(`已触发 V8 ${t} 执行`)
    return true
  }
  return false
}

// 右键菜单中单节点执行也走这里（支持 group 特殊）
function runSingleNode(nodeId: string) {
  hideContextMenu()
  const t = getNodeType(nodeId)
  if (t === 'group') {
    // Group 的执行语义 = 执行子图
    executeSubgraph(nodeId)
    return
  }
  if (executeV8Orchestration(nodeId)) {
    return
  }
  if (t && ['skill', 'toolset'].includes(t)) {
    showToast('上下文提供者为声明式节点，无执行操作')
    return
  }
  void runCanvasNode(nodeId)
}

function deleteConnectedEdges() {
  hideContextMenu()
  // 完整实现：按右键的特定 Handle 删除关联的边（不影响其他）
  const nodeId = contextMenu.value.targetId
  const handleId = contextMenu.value.targetHandle
  if (!nodeId) {
    canvasStore.deleteSelected()
    return
  }
  const toDelete = canvasStore.edges.filter((e: any) => {
    if (e.source === nodeId && (!handleId || e.sourceHandle === handleId)) return true
    if (e.target === nodeId && (!handleId || e.targetHandle === handleId)) return true
    return false
  })
  if (toDelete.length) {
    toDelete.forEach((e: any) => canvasStore.deleteEdge(e.id))
    showToast(`已删除 ${toDelete.length} 条连接`)
  } else {
    // fallback
    canvasStore.deleteSelected()
  }
}

function groupSelected() {
  hideContextMenu()
  const selectedBefore = [...canvasStore.selectedNodeIds()]
  canvasStore.groupSelectedNodes()

  // Phase 2: For V8 Group, set parentNode on children for proper nesting in VueFlow
  // This makes expanded Group visually contain children
  setTimeout(() => {
    const newGroup = canvasStore.nodes.find(n => n.type === 'group' && !selectedBefore.includes(n.id))
    if (newGroup) {
      selectedBefore.forEach(childId => {
        canvasStore.updateNodeData(childId, { parentNode: newGroup.id }) // or direct parentNode if supported
        // VueFlow nodes support parentNode prop
        const child = canvasStore.nodes.find(n => n.id === childId)
        if (child) (child as any).parentNode = newGroup.id
      })
    }
  }, 50)
}

// ===== Phase 3: 底部输入栏两段式 (UI-001) =====
function onBottomInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && bottomInput.value.trim()) {
    // 第一阶段：显示推荐（不自动创建）
    recommendedPlan.value = ['text', 'llm', 'text', 'imageGen', 'imageResult'] // 画布模板
    showRecommendation.value = true
  }
}

function confirmCreateFromBottom() {
  if (!bottomInput.value.trim()) return

  // 第二阶段：用户显式确认后才创建 (使用 V8 节点，匹配默认画布模板)
  const baseX = 100
  const baseY = 150
  const spacing = 320
  const labels = ['需求', 'AI大脑', '输出（人工复核）', '生成', '结果']

  recommendedPlan.value.forEach((type, i) => {
    const nodeData: any = { 
      x: baseX + i * spacing, 
      y: baseY + (i % 2) * 80 
    }
    if (type === 'text' || type === 'llm') {
      nodeData.label = labels[i]
    }
    canvasStore.addNode(type as any, nodeData)
  })

  showToast('已按推荐链创建画布模板（两段式确认完成）')
  bottomInput.value = ''
  showRecommendation.value = false
  recommendedPlan.value = []
}

function cancelBottomRecommendation() {
  showRecommendation.value = false
  recommendedPlan.value = []
}

// ===== Phase 3: 迁移向导骨架 (Mig-001~004) =====
async function triggerMigrationWizard(oldTitle: string) {
  migrationOldTitle.value = oldTitle
  migrationBackupDone.value = false
  migrationUpgradableCount.value = countMigratable(canvasStore.nodes)
  showMigrationWizard.value = true

  // 自动备份（Mig-001：始终先备份，数据安全第一；即使之前显示过也允许重备份）
  try {
    const currentDoc = canvasStore.exportDocument()
    const backupTitle = `${oldTitle}_backup_${Date.now()}`
    await fileStore.addCanvas(backupTitle, JSON.stringify(currentDoc, null, 2))
    migrationBackupDone.value = true
    showToast('旧画布已自动备份（数据零丢失）')
  } catch (e) {
    console.warn('备份失败', e)
    showToast('备份尝试失败（请手动另存）')
  }
}

function doOneClickUpgrade() {
  showMigrationWizard.value = false
  const beforeCount = canvasStore.nodes.length
  const beforeMigratable = countMigratable(canvasStore.nodes)

  // 真实 remap：类型切换到 V8 + 数据字段补全 + 零丢失（Mig-003/004）
  // 连线（edges）完全不动，只换节点 type/data，id 保持 => 连接零丢失
  const remapped = remapNodesForMigration(canvasStore.nodes)
  canvasStore.replaceNodes(remapped as any)

  const afterMigratable = countMigratable(canvasStore.nodes)
  const upgraded = beforeMigratable - afterMigratable

  // 额外：若有 parentNode 引用，确保子节点数据也同步（group 场景）
  setTimeout(() => {
    canvasStore.nodes.forEach(n => {
      if ((n as any).parentNode) {
        const p = canvasStore.nodes.find(pn => pn.id === (n as any).parentNode)
        if (p && p.type !== 'group') {
          // 父已被改，保持
        }
      }
    })
  }, 0)

  showToast(`一键升级完成：${upgraded} 个节点切换为 V8（共 ${beforeCount} 节点，数据+连线完整保留）`)
  migrationUpgradableCount.value = 0
}

function keepOldVersion() {
  showMigrationWizard.value = false
  // 标记永不强制 + 允许后续手动升级
  try {
    const fid = canvasStore.currentFileId || 'default'
    localStorage.setItem('v8_migration_keep_legacy_' + fid, 'true')
  } catch {}
  showToast('已选择保留旧版（永不强制只读 · 右键仍可单个升级）')
}

// 逐个处理支持：标记模式 + 提供单节点升级入口（右键菜单调用此函数）
function doPerNodeUpgrade() {
  showMigrationWizard.value = false
  const up = countMigratable(canvasStore.nodes)
  showToast(`已进入逐个处理模式（${up} 个可升级）。右键任意旧节点 → “升级到 V8 版本” 即可单个处理。保留旧版选项始终可用。`)
  // 也可暴露全局方便手动测试
  ;(window as any).v8UpgradeAllRemaining = () => {
    const rem = remapNodesForMigration(canvasStore.nodes)
    canvasStore.replaceNodes(rem as any)
    showToast('已一键升级剩余所有可迁移节点')
  }
}

function upgradeNodeToV8(nodeId: string) {
  hideContextMenu()
  const node = canvasStore.nodes.find(n => n.id === nodeId)
  if (!node || !isV8MigratableType(node.type)) {
    showToast('此节点无需或无法升级')
    return
  }
  const beforeType = node.type
  const remappedList = remapNodesForMigration([node])
  const remapped = remappedList[0]
  if (remapped.type !== beforeType) {
    // 应用单个：用 replace 保证一致（小开销）
    const all = canvasStore.nodes.map(n => n.id === nodeId ? remapped : n)
    canvasStore.replaceNodes(all as any)
    showToast(`节点 ${nodeId.slice(0,6)} 已从 ${beforeType} 升级为 ${remapped.type} (V8)`)
  } else {
    // 只是补字段
    canvasStore.updateNodeData(nodeId, { ...remapped.data, __v8upgraded: true })
    showToast('节点数据已补全 V8 字段（类型兼容）')
  }
}

function onDropNode(event: DragEvent) {
  const raw = event.dataTransfer?.getData('application/jiucai-canvas-node') || event.dataTransfer?.getData('text/plain')
  if (!raw) return
  const point = flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  canvasStore.addNode(raw as CanvasNodeType, point)
  hideContextMenu()
}

function onNodeClick(payload: NodeMouseEvent) {
  canvasStore.selectNode(payload.node.id)
}

function onEdgeClick(payload: EdgeMouseEvent) {
  canvasStore.selectEdge(payload.edge.id)
}

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  const tag = element?.tagName?.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(element?.isContentEditable)
}

function onKeydown(event: KeyboardEvent) {
  if (isTypingTarget(event.target)) return
  const key = event.key.toLowerCase()
  const meta = event.metaKey || event.ctrlKey
  if (key === 'escape') {
    hideContextMenu()
    canvasStore.clearSelection()
    return
  }
  if (meta && key === 'a') {
    event.preventDefault()
    canvasStore.selectAllNodes()
    return
  }
  if (meta && key === 'g') {
    event.preventDefault()
    canvasStore.groupSelectedNodes()
    return
  }
  if (meta && key === 'd') {
    event.preventDefault()
    if (canvasStore.selectedNodeId) canvasStore.duplicateNode(canvasStore.selectedNodeId)
    return
  }
  if (meta && key === 'z') {
    event.preventDefault()
    if (event.shiftKey) canvasStore.redo()
    else canvasStore.undo()
    return
  }
  if (meta && key === 'y') {
    event.preventDefault()
    canvasStore.redo()
    return
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    void flow.zoomIn()
    return
  }
  if (event.key === '-' || event.key === '_') {
    event.preventDefault()
    void flow.zoomOut()
    return
  }
  if (event.key === '0') {
    event.preventDefault()
    void flow.fitView({ padding: 0.2 })
    return
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (canvasStore.selectedNodeId || canvasStore.selectedEdgeId) {
      event.preventDefault()
      void deleteSelectedCanvasContent()
    }
  }
}

async function deleteSelectedCanvasContent() {
  const ok = await confirmAction('确定删除选中的画布内容吗？相关连线也会删除。')
  if (ok) canvasStore.deleteSelected()
}


function onViewportChangeEnd(viewport: ViewportTransform) {
  canvasStore.setViewport({ x: viewport.x, y: viewport.y, zoom: viewport.zoom })
}

// V8 冻结策略 handlers（拖拽/平移时冻结非关键渲染）
function onDragStart() { globalFreeze.startInteraction() }
function onDragStop() { globalFreeze.endInteraction() }

async function createNewCanvas() {
  try {
    const title = `新画布_${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`.replace(/:/g, '-')
    const idBase = `canvas_${Date.now().toString(36)}`
    const now = Date.now()

    const doc: any = {
      id: idBase,
      title,
      nodes: [
        { id: `${idBase}_req`, type: 'text', position: { x: 80, y: 120 }, data: { label: '需求', content: '' } },
        { id: `${idBase}_llm`, type: 'llm', position: { x: 380, y: 100 }, data: { label: 'LLM', modelId: 'claude-sonnet-4-6' } },
        { id: `${idBase}_gen`, type: 'imageGen', position: { x: 680, y: 80 }, data: { label: '生图' } },
        { id: `${idBase}_result`, type: 'imageResult', position: { x: 980, y: 100 }, data: { label: '结果' } },
      ],
      edges: [
        { id: `e_${now}_1`, source: `${idBase}_req`, target: `${idBase}_llm`, type: 'promptOrder', data: { kind: 'prompt-order', order: 1 } },
        { id: `e_${now}_2`, source: `${idBase}_llm`, target: `${idBase}_gen`, type: 'promptOrder', data: { kind: 'prompt-order', order: 2 } },
        { id: `e_${now}_3`, source: `${idBase}_gen`, target: `${idBase}_result`, type: 'default', data: { kind: 'media-role' } },
      ],
      viewport: { x: 0, y: 0, zoom: 0.9 },
    }

    const file = await fileStore.addCanvas(title, JSON.stringify(doc, null, 2))
    canvasStore.importDocument(doc, { fileId: file.id, title: file.name })
    emitEvent('refresh-file-list')
    emitEvent('switch-filetree-tab', 'canvas')
    showToast(`已新建画布：${title}`)

  } catch (err) {
    showToast(`新建失败：${(err as Error)?.message || '请稍后重试'}`)
  }
}

async function saveCanvasToFiles() {
  try {
    const doc = canvasStore.exportDocument()
    if (canvasStore.currentFileId) {
      await canvasStore.saveNow()
      emitEvent('refresh-file-list')
      emitEvent('switch-filetree-tab', 'canvas')
      showToast('画布已保存到第二列')
      return
    }
    const title = canvasStore.currentTitle || `我的画布_${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`.replace(/:/g, '-')
    const file = await fileStore.addCanvas(title, JSON.stringify({ ...doc, title }, null, 2))
    canvasStore.importDocument({ ...doc, id: file.id, title }, { fileId: file.id, title: file.name })
    emitEvent('refresh-file-list')
    emitEvent('switch-filetree-tab', 'canvas')
    showToast('画布已保存到第二列')
  } catch (err) {
    showToast(`保存失败：${(err as Error)?.message || '请稍后重试'}`)
  }
}

async function saveCanvas() {
  await saveCanvasToFiles()
}

function closeCanvas() {
  emitEvent('switch-workspace-mode', 'chat')
}

async function exportCanvas() {
  const json = JSON.stringify(canvasStore.exportDocument(), null, 2)
  if (isTauriRuntime()) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      const path = await save({ defaultPath: '韭菜盒子画布.jccanvas', filters: [{ name: '韭菜盒子画布', extensions: ['jccanvas'] }] })
      if (!path) return
      await writeTextFile(path, json)
      showToast('画布已导出')
    } catch (e: any) {
      showToast(`导出失败：${e?.message || '请稍后重试'}`)
    }
    return
  }
  // Web fallback: download via Blob URL
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${canvasStore.currentTitle || '韭菜盒子画布'}.jccanvas`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  showToast('画布已下载')
}

async function screenshotCanvas() {
  const element = document.querySelector('.cw-flow-wrap') as HTMLElement | null
  if (!element) return
  const { toPng } = await import('html-to-image')
  const dataUrl = await toPng(element, { cacheBust: true, pixelRatio: 2, backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff' })
  if (isTauriRuntime()) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog')
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      const path = await save({ defaultPath: '韭菜盒子画布截图.png', filters: [{ name: 'PNG 图片', extensions: ['png'] }] })
      if (!path) return
      const binary = atob(dataUrl.split(',')[1] || '')
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      await writeFile(path, bytes)
      showToast('截图已保存')
    } catch (e: any) {
      showToast(`截图失败：${e?.message || '请稍后重试'}`)
    }
    return
  }
  // Web fallback: download via Blob URL
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `${canvasStore.currentTitle || '韭菜盒子画布'}_截图.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  showToast('截图已下载')
}

async function importCanvas() {
  if (isTauriRuntime()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const path = await open({ multiple: false, filters: [{ name: '韭菜盒子画布', extensions: ['jccanvas', 'json'] }] })
      if (!path || Array.isArray(path)) return
      const text = await readTextFile(path)
      const doc = JSON.parse(text) as CanvasDocumentV1
      canvasStore.importDocument(doc)
      showToast('画布已导入')
    } catch (e: any) {
      showToast(`导入失败：${e?.message || '请稍后重试'}`)
    }
    return
  }
  // Web fallback: use hidden file input
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.jccanvas,.json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const doc = JSON.parse(text) as CanvasDocumentV1
      canvasStore.importDocument(doc)
      showToast('画布已导入')
    } catch (e: any) {
      showToast(`导入失败：${e?.message || '文件格式不正确'}`)
    }
  }
  input.click()
}

function runSelected() {
  const ids = canvasStore.selectedNodeIds()
  if (ids.length > 1) {
    runSelectedNodes()
    return
  }
  if (canvasStore.selectedNodeId) void runCanvasNode(canvasStore.selectedNodeId)
}

async function runAll() {
  const counts = canvasStore.nodes.reduce((acc, node) => {
    if (node.type === 'llm') acc.llm++
    if (node.type === 'imageGen') acc.image++
    if (node.type === 'videoGen') acc.video++
    if (node.type === 'tool') acc.tool++
    return acc
  }, { llm: 0, image: 0, video: 0, tool: 0 })
  const ok = await confirmAction(
    `即将执行画布节点：AI 文本 ${counts.llm} 个，图片 ${counts.image} 个，视频 ${counts.video} 个，本地工具 ${counts.tool} 个。\n\n云端模型和媒体生成会消耗额度，本地工具不消耗。是否继续？`,
  )
  if (!ok) return
  void runAllCanvasNodes()
}
</script>

<template>
  <div class="cw">
    <div v-if="canvasStore.currentFileId" class="cw-title" @dblclick="editingTitle = true; titleInput = canvasStore.currentTitle">
      <template v-if="editingTitle">
        <JcIcon name="account_tree" />
        <input v-model="titleInput" class="cw-title-input" @keyup.enter="canvasStore.setCanvasTitle(titleInput); editingTitle = false" @keyup.escape="editingTitle = false" @blur="canvasStore.setCanvasTitle(titleInput); editingTitle = false" @pointerdown.stop />
      </template>
      <template v-else>
        <JcIcon name="account_tree" />{{ canvasStore.currentTitle }}
      </template>
    </div>

    <!-- Phase 3 Context 栏（Week 7-9） - 动态 + 视觉层级 -->
    <div 
      v-if="canvasStore.currentFileId" 
      class="cw-context-bar"
      :class="{ 
        'executing': isExecuting, 
        'degraded': shouldDegradeVisuals 
      }"
    >
      <span class="cw-ctx-label">显式上下文：</span>
      <span class="cw-ctx-chip" :class="{ active: connectedContexts.skill }">🧩 Skill: {{ connectedContexts.skill ? '已连 LLM' : '未连' }}</span>
      <span class="cw-ctx-chip" :class="{ active: connectedContexts.tools }">🔧 工具: {{ connectedContexts.tools ? '已连 LLM' : '未连' }}</span>
      <span class="cw-ctx-hint">
        {{ shouldDegradeVisuals ? '节点较多，动画已自动降级' : 'Context Provider 连线 LLM 后自动激活（显式 P1）' }}
      </span>
    </div>

    <CanvasToolbar @new-canvas="createNewCanvas" @run-selected="runSelected" @run-all="runAll" @delete-selected="deleteSelectedCanvasContent" @toggle-workflows="showWorkflows = !showWorkflows" @export-canvas="exportCanvas" @import-canvas="importCanvas" @screenshot="screenshotCanvas" @save-canvas="saveCanvas" @save-to-files="saveCanvasToFiles" @close-canvas="closeCanvas" />
    <div class="cw-body">
      <CanvasNodeLibrary @add-node="addNode" @drag-node="onDragNode" />
      <div class="cw-flow-wrap" @dragover.prevent @drop.prevent="onDropNode" @contextmenu="openContextMenu" @click="hideContextMenu">
        <CanvasWorkflowPanel v-if="showWorkflows" @close="showWorkflows = false" />
        <VueFlow
          id="jiucai-canvas"
          class="cw-flow"
          :class="{ 
            'v8-executing': isExecuting && !shouldDegradeVisuals,
            'visuals-degraded': shouldDegradeVisuals 
          }"
          v-model:nodes="flowNodes"
          v-model:edges="flowEdges"
          :node-types="nodeTypes"
          :edge-types="edgeTypes"
          :default-viewport="canvasStore.viewport"
          :nodes-draggable="true"
          :nodes-connectable="true"
          :elements-selectable="true"
          :select-nodes-on-drag="true"
          :selection-key-code="['Meta', 'Control']"
          :multi-selection-key-code="['Meta', 'Control']"
          :pan-on-drag="true"
          :zoom-on-scroll="true"
          :is-valid-connection="enhancedIsValidConnection"
          @connect="handleConnect"
          @node-click="onNodeClick"
          @edge-click="onEdgeClick"
          @pane-click="canvasStore.selectNode(''); canvasStore.selectEdge(''); hideContextMenu()"
          @viewport-change-end="onViewportChangeEnd"
          @node-drag-start="onDragStart"
          @node-drag-stop="onDragStop"
          @move-start="onDragStart"
          @move-end="onDragStop"
        >
          <Background v-if="canvasStore.gridVisible" pattern-color="var(--border)" :gap="18" />
          <MiniMap position="bottom-right" pannable zoomable />
        </VueFlow>
        <CanvasModeControls
          :selected-count="selectedCount"
          @zoom-in="flow.zoomIn()"
          @zoom-out="flow.zoomOut()"
          @fit-view="flow.fitView({ padding: 0.2 })"
          @group-selected="canvasStore.groupSelectedNodes()"
        />
        <!-- Phase 3: 完整 4 场景右键菜单 -->
        <div v-if="contextMenu.show" class="cw-context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @pointerdown.stop @click.stop>
          <!-- 空白画布 -->
          <template v-if="contextMenu.mode === 'blank'">
            <div class="cw-menu-title">添加节点</div>
            <button v-for="item in contextNodeOptions.slice(0, 12)" :key="item.type" @click="addNodeFromContext(item.type)">
              <JcIcon :name="item.icon" /> {{ item.label }}
            </button>
            <div class="cw-menu-divider" />
<<<<<<< HEAD
            <button @click="createNewCanvas"><span class="mso">add_box</span> 新建画布</button>
            <button @click="() => { hideContextMenu(); triggerMigrationWizard(canvasStore.currentTitle || '当前画布') }"><span class="mso">swap_horiz</span> 打开迁移向导</button>
=======
            <button @click="createNewCanvas"><JcIcon name="add_box" /> 新建五节点模板</button>
            <button @click="() => { hideContextMenu(); triggerMigrationWizard(canvasStore.currentTitle || '当前画布') }"><JcIcon name="swap_horiz" /> 打开迁移向导</button>
>>>>>>> media-creation-optimization
          </template>

          <!-- 单节点 -->
          <template v-else-if="contextMenu.mode === 'node' && contextMenu.targetId">
            <div class="cw-menu-title">节点操作</div>
            <!-- 仅非声明式/结果节点显示执行（CP-001 + Result executable=false + P1 显式） -->
            <template v-if="!['skill','toolset','imageResult','videoResult','audioResult'].includes(getNodeType(contextMenu.targetId) || '')">
              <button @click="runSingleNode(contextMenu.targetId)"><JcIcon name="play_arrow" /> 执行</button>
            </template>
            <button @click="duplicateNode(contextMenu.targetId)"><JcIcon name="content_copy" /> 复制</button>
            <button @click="deleteNode(contextMenu.targetId)"><JcIcon name="delete" /> 删除</button>

            <!-- V8 特定：Group -->
            <template v-if="getNodeType(contextMenu.targetId) === 'group'">
              <div class="cw-menu-divider" />
              <button @click="executeSubgraph(contextMenu.targetId)"><JcIcon name="play_for_work" /> 仅执行此子图 (G-003)</button>
              <button @click="exportGroupAsTemplate(contextMenu.targetId)"><JcIcon name="file_download" /> 导出为模板</button>
            </template>

            <!-- V8 特定：Result 节点 -->
            <template v-if="['imageResult','videoResult','audioResult'].includes(getNodeType(contextMenu.targetId) || '')">
              <div class="cw-menu-divider" />
              <button @click="downloadResult(contextMenu.targetId)"><JcIcon name="download" /> 下载</button>
              <button @click="setAsReference(contextMenu.targetId)"><JcIcon name="bookmark" /> 设为参考</button>
            </template>

            <!-- 仅非 Group 时显示“创建 Group” -->
            <template v-if="getNodeType(contextMenu.targetId) !== 'group'">
              <div class="cw-menu-divider" />
              <button @click="groupSelected"><JcIcon name="folder" /> 创建 Group</button>
            </template>

            <!-- 迁移：旧版/可升级节点提供逐个升级入口（Mig-004 使“逐个”真正可用） -->
            <template v-if="needsV8Upgrade(getNodeType(contextMenu.targetId))">
              <div class="cw-menu-divider" />
              <button @click="upgradeNodeToV8(contextMenu.targetId)"><JcIcon name="upgrade" /> 升级到 V8 版本</button>
            </template>
          </template>

          <!-- Handle -->
          <template v-else-if="contextMenu.mode === 'handle'">
            <div class="cw-menu-title">连接操作</div>
            <button @click="deleteConnectedEdges"><JcIcon name="link_off" /> 删除此连接</button>
            <button @click="hideContextMenu">取消</button>
          </template>

          <!-- 多选 -->
          <template v-else-if="contextMenu.mode === 'multi'">
            <div class="cw-menu-title">多选操作</div>
            <button @click="runSelectedNodes"><JcIcon name="play_arrow" /> 执行选中</button>
            <button @click="groupSelected"><JcIcon name="folder" /> 创建 Group</button>
            <button @click="deleteSelectedCanvasContent"><JcIcon name="delete" /> 删除选中</button>
          </template>
        </div>
        <div v-if="nodeCountWarning" class="cw-node-warning">节点超过 100 个，建议拆分画布或收起不需要的节点。</div>
        <CanvasExecutionLog />
        <Transition name="cw-toast">
          <div v-if="toastMessage" class="cw-toast">{{ toastMessage }}</div>
        </Transition>

        <!-- Phase 3: 底部输入栏（两段式 - UI-001） -->
        <div class="cw-bottom-bar">
          <div class="cw-bottom-input-wrap">
            <input 
              v-model="bottomInput" 
              class="cw-bottom-input" 
              placeholder="描述任务，AI 推荐节点链（两段式：先看推荐，再确认创建）"
              @keydown.enter="onBottomInputKeydown"
            />
            <button v-if="!showRecommendation" @click="onBottomInputKeydown({ key: 'Enter' } as any)">推荐</button>
          </div>

          <div v-if="showRecommendation" class="cw-recommend">
            <span>推荐链（画布模板）：</span>
            <span v-for="(t,i) in recommendedPlan" :key="i" class="cw-rec-chip">{{ t }}</span>
            <button class="confirm" @click="confirmCreateFromBottom">确认创建（显式）</button>
            <button @click="cancelBottomRecommendation">取消</button>
            <span class="hint">默认不自动执行</span>
          </div>
        </div>

        <!-- Phase 3: 迁移向导（可用版 Mig-001~004） -->
        <div v-if="showMigrationWizard" class="cw-migration-modal" @click.self="showMigrationWizard = false">
          <div class="cw-migration-content" @click.stop>
            <h3>检测到旧版画布</h3>
            <p>已自动备份：<strong>{{ migrationOldTitle }}</strong></p>
            <p v-if="migrationBackupDone" style="color:#10b981">✓ 备份成功</p>
            <p v-if="migrationUpgradableCount > 0" style="color:#f59e0b">可升级节点：{{ migrationUpgradableCount }} 个（text/llm/Gen/Result/Group/Loop 等 + 部分 T8）</p>

            <div class="cw-mig-options">
              <button @click="doOneClickUpgrade">一键升级为 V8 版本（推荐）</button>
              <button @click="doPerNodeUpgrade">逐个节点处理（右键逐个升级）</button>
              <button @click="keepOldVersion">永久保留旧版（永不强制只读）</button>
            </div>
            <div class="hint">数据零丢失 · 连线完整保留 · 随时可右键升级单个节点</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cw {
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  color: var(--ink1);
}
.cw-title { height:30px; display:flex; align-items:center; gap:6px; padding:0 12px; border-bottom:1px solid var(--border); background:var(--surface); color:var(--ink2); font-size:12px; font-weight:700; }
.cw-title .mso { font-size:15px; color:var(--olive-dark); }
.cw-body {
  min-height: 0;
  flex: 1;
  display: flex;
}
.cw-flow-wrap {
  min-width: 0;
  min-height: 0;
  flex: 1;
  position: relative;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--paper) 64%, transparent), transparent 42%),
    var(--surface);
}
.cw-flow {
  width: 100%;
  height: 100%;
}
:deep(.vue-flow__node) {
  font-family: inherit;
}
:deep(.vue-flow__handle) {
  width: 9px;
  height: 9px;
  border: 2px solid var(--paper);
  background: var(--olive-dark);
}
:deep(.vue-flow__edge-path) {
  stroke: var(--olive-dark);
  stroke-width: 1.8;
  cursor: pointer;
}
:deep(.vue-flow__edge.selected .vue-flow__edge-path) {
  stroke-width: 3;
  stroke: var(--jc-error);
}
:deep(.vue-flow__minimap) {
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.cw-context-menu { position:fixed; z-index:60; min-width:158px; padding:6px; border:1px solid var(--border); border-radius:8px; background:var(--paper); box-shadow:var(--jc-shadow-md); display:grid; gap:3px; }
.cw-context-menu button { height:30px; display:flex; align-items:center; gap:7px; border:0; border-radius:6px; background:transparent; color:var(--ink2); font:inherit; font-size:12px; text-align:left; padding:0 8px; cursor:pointer; }
.cw-context-menu button:hover { background:var(--surface-alt); color:var(--ink1); }
.cw-context-menu .mso { font-size:16px; color:var(--olive-dark); }
.cw-node-warning { position:absolute; left:50%; top:58px; z-index:22; transform:translateX(-50%); padding:7px 10px; border:1px solid var(--border); border-radius:8px; background:var(--paper); color:var(--jc-error); box-shadow:var(--jc-shadow-sm); font-size:12px; }
.cw-toast { position:absolute; left:50%; bottom:18px; z-index:70; transform:translateX(-50%); padding:8px 14px; border-radius:999px; background:rgba(36,34,28,.92); color:#fff; font-size:12px; box-shadow:var(--jc-shadow-md); pointer-events:none; }
.cw-toast-enter-active, .cw-toast-leave-active { transition:opacity .18s ease, transform .18s ease; }
.cw-toast-enter-from, .cw-toast-leave-to { opacity:0; transform:translateX(-50%) translateY(6px); }

/* Phase 3 Context 栏 */
.cw-context-bar {
  height: 28px;
  background: var(--surface-alt);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  font-size: 11px;
  flex-shrink: 0;
}
.cw-ctx-label { font-weight: 600; color: var(--ink2); }
.cw-ctx-chip {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10px;
}
.cw-ctx-hint { font-size: 10px; color: var(--ink3); margin-left: auto; }

.cw-context-bar.executing {
  animation: ctx-breathing 1.2s ease-in-out infinite;
}
@keyframes ctx-breathing {
  0%,100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.2); }
  50% { box-shadow: 0 0 0 6px rgba(16,185,129,0); }
}
.cw-context-bar.degraded .cw-ctx-chip {
  opacity: 0.6;
}
.cw-ctx-chip.active {
  border-color: #10b981;
  background: rgba(16,185,129,0.08);
}

/* Phase 3 完整视觉动画细节 (V-001/V-002) - 执行时动态反馈 */
.cw-flow.v8-executing .vue-flow__edge-path {
  stroke: #10b981;
  stroke-width: 2.8;
  transition: stroke 0.15s ease, stroke-width 0.15s ease;
  filter: drop-shadow(0 0 3px rgba(16, 185, 129, 0.4));
}

/* Prompt-flow edges get stronger treatment during execution */
.cw-flow.v8-executing .vue-flow__edge[data-edge-type="prompt-flow"] .vue-flow__edge-path,
.cw-flow.v8-executing .vue-flow__edge-path[data-edge-type="prompt-flow"],
.cw-flow.v8-executing .vue-flow__edge[data-type="prompt-flow"] .vue-flow__edge-path,
.cw-flow.v8-executing .vue-flow__edge-path[data-type="prompt-flow"] {
  stroke: #10b981;
  stroke-width: 3.2;
  animation: prompt-edge-breathing 1.6s ease-in-out infinite;
}

@keyframes prompt-edge-breathing {
  0%, 100% { stroke-width: 2.8; }
  50% { stroke-width: 3.8; }
}

/* Context Providers breathing (stronger when wired to executing LLM) */
.cw-flow.v8-executing .vue-flow__node .v8-node-frame[data-role="context"] {
  animation: ctx-provider-breathing 1.3s ease-in-out infinite;
  box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.3);
}

@keyframes ctx-provider-breathing {
  0%, 100% { box-shadow: 0 0 0 0 rgba(167, 139, 250, 0.4); }
  50% { box-shadow: 0 0 0 10px rgba(167, 139, 250, 0); }
}

/* Active/participating nodes get subtle lift during execution */
.cw-flow.v8-executing .vue-flow__node .v8-node-frame[data-status="running"],
.cw-flow.v8-executing .vue-flow__node .v8-node-frame[data-status="generating"] {
  filter: drop-shadow(0 4px 12px rgba(16, 185, 129, 0.25));
  transition: filter 0.2s ease;
}

/* Specific execution path nodes (from activeExecutionPath) get extra ring */
.cw-flow.v8-executing .vue-flow__node.v8-active-path {
  box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.35);
  transition: box-shadow 0.2s ease;
}

/* Non-participating nodes dim during execution (only when not degraded) */
.cw-flow.v8-executing:not(.visuals-degraded) .vue-flow__node .v8-node-frame:not([data-status="running"]):not([data-status="generating"]) {
  opacity: 0.55;
  transition: opacity 0.3s ease;
}

/* Full degrade when >15 nodes or during freeze interaction */
.cw-flow.visuals-degraded .vue-flow__edge-path,
.cw-flow.visuals-degraded .vue-flow__node,
.cw-flow.v8-interacting .vue-flow__edge-path,
.cw-flow.v8-interacting .vue-flow__node,
.is-interacting .vue-flow__edge-path,
.is-interacting .vue-flow__node {
  transition: none !important;
  animation: none !important;
  filter: none !important;
}

.cw-flow.visuals-degraded .vue-flow__node:not(.selected),
.cw-flow.v8-interacting .vue-flow__node:not(.selected) {
  opacity: 0.6;
}

/* Freeze takes absolute precedence - pause everything */
.cw-flow.v8-interacting .vue-flow__edge-path,
.is-interacting .vue-flow__edge-path {
  stroke: var(--olive-dark) !important;
  stroke-width: 1.8 !important;
}

/* Phase 3 底部输入栏两段式 */
.cw-bottom-bar {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 80;
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 6px 12px;
  box-shadow: var(--jc-shadow-md);
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 420px;
}
.cw-bottom-input-wrap {
  display: flex;
  gap: 8px;
}
.cw-bottom-input {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--ink1);
}
.cw-recommend {
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.cw-rec-chip {
  background: var(--surface-alt);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
}
.cw-recommend .confirm { background: #10b981; color: white; border: none; padding: 2px 10px; border-radius: 4px; cursor: pointer; }
.cw-recommend .hint { font-size: 9px; color: var(--ink3); margin-left: auto; }

/* Phase 3 迁移向导骨架 */
.cw-migration-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cw-migration-content {
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 24px;
  min-width: 420px;
  box-shadow: var(--jc-shadow-lg);
}
.cw-migration-content h3 { margin: 0 0 12px; }
.cw-mig-options { display: flex; flex-direction: column; gap: 8px; margin: 16px 0; }
.cw-mig-options button {
  padding: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
}
.cw-mig-options button:hover { background: var(--surface-alt); }
</style>
