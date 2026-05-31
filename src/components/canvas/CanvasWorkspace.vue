<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
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
import CanvasTextNode from './nodes/CanvasTextNode.vue'
import CanvasLlmNode from './nodes/CanvasLlmNode.vue'
import CanvasImageGenNode from './nodes/CanvasImageGenNode.vue'
import CanvasImageResultNode from './nodes/CanvasImageResultNode.vue'
import CanvasAudioGenNode from './nodes/CanvasAudioGenNode.vue'
import CanvasAudioResultNode from './nodes/CanvasAudioResultNode.vue'
import CanvasVideoGenNode from './nodes/CanvasVideoGenNode.vue'
import CanvasVideoResultNode from './nodes/CanvasVideoResultNode.vue'
import CanvasFileNode from './nodes/CanvasFileNode.vue'
import CanvasToolNode from './nodes/CanvasToolNode.vue'
import CanvasGroupNode from './nodes/CanvasGroupNode.vue'
import CanvasRunningHubNode from './nodes/CanvasRunningHubNode.vue'
// T8 迁入节点
import CanvasSeedanceNode from './nodes/CanvasSeedanceNode.vue'
import CanvasRunningHubWalletNode from './nodes/CanvasRunningHubWalletNode.vue'
import CanvasRhToolsNode from './nodes/CanvasRhToolsNode.vue'
import CanvasRhConfigNode from './nodes/CanvasRhConfigNode.vue'
import CanvasUploadNode from './nodes/CanvasUploadNode.vue'
import CanvasMaterialSetNode from './nodes/CanvasMaterialSetNode.vue'
import CanvasOutputNode from './nodes/CanvasOutputNode.vue'
import CanvasLoopNode from './nodes/CanvasLoopNode.vue'
import CanvasPickFromSetNode from './nodes/CanvasPickFromSetNode.vue'
import CanvasTextSplitNode from './nodes/CanvasTextSplitNode.vue'
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
import { createStarterCanvasDocument, useCanvasStore } from '@/stores/canvasStore'
import { useFileStore } from '@/composables/useFileStore'
import { consumeLastEvent, emitEvent, onEvent } from '@/utils/eventBus'
import type { CanvasDocumentV1, CanvasNodeType } from '@/types/canvas'
import { runAllCanvasNodes, runCanvasNode } from './runtime/canvasExecutor'
import { confirmAction } from '@/utils/confirmAction'

const canvasStore = useCanvasStore()
const fileStore = useFileStore()
let offOpenCanvasDocument: (() => void) | null = null
const showWorkflows = ref(false)
const toastMessage = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null
const editingTitle = ref(false)
const titleInput = ref('')
const contextMenu = ref<{ show: boolean; x: number; y: number; flowX: number; flowY: number }>({ show: false, x: 0, y: 0, flowX: 0, flowY: 0 })
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
const nodeCountWarning = computed(() => canvasStore.nodes.length >= 100)
const flowNodes = computed({
  get: () => canvasStore.nodes,
  set: value => canvasStore.replaceNodes(value as any),
})
const flowEdges = computed({
  get: () => canvasStore.edges,
  set: value => canvasStore.replaceEdges(value as any),
})
const flow = useVueFlow('jiucai-canvas')
const selectedCount = computed(() => canvasStore.selectedNodeIds().length)

const nodeTypes = {
  text: CanvasTextNode,
  llm: CanvasLlmNode,
  runninghub: CanvasRunningHubNode,
  imageGen: CanvasImageGenNode,
  imageResult: CanvasImageResultNode,
  audioGen: CanvasAudioGenNode,
  audioResult: CanvasAudioResultNode,
  videoGen: CanvasVideoGenNode,
  videoResult: CanvasVideoResultNode,
  file: CanvasFileNode,
  tool: CanvasToolNode,
  group: CanvasGroupNode,
  // T8 迁入
  seedance: CanvasSeedanceNode,
  runninghubWallet: CanvasRunningHubWalletNode,
  rhTools: CanvasRhToolsNode,
  rhConfig: CanvasRhConfigNode,
  upload: CanvasUploadNode,
  materialSet: CanvasMaterialSetNode,
  output: CanvasOutputNode,
  loop: CanvasLoopNode,
  pickFromSet: CanvasPickFromSetNode,
  textSplit: CanvasTextSplitNode,
  framePair: CanvasFramePairNode,
  resize: CanvasResizeNode,
  combine: CanvasCombineNode,
  removeBg: CanvasRemoveBgNode,
  upscale: CanvasUpscaleNode,
  gridCrop: CanvasGridCropNode,
  imageCompare: CanvasImageCompareNode,
  drawingBoard: CanvasDrawingBoardNode,
  browserNode: CanvasBrowserNode,
  frameExtractor: CanvasFrameExtractorNode,
  storyboardGrid: CanvasStoryboardGridNode,
  cinematic: CanvasCinematicNode,
  videoMotion: CanvasVideoMotionNode,
  multiAngleVisual: CanvasMultiAngleVisualNode,
  idea: CanvasIdeaNode,
  bp: CanvasBpNode,
  relay: CanvasRelayNode,
  edit: CanvasEditNode,
  videoOutput: CanvasVideoOutputNode,
} as any

const edgeTypes = {
  promptOrder: PromptOrderEdge,
  imageRole: ImageRoleEdge,
  mediaRole: MediaRoleEdge,
} as any

function onRunNodeEvent(event: Event) {
  const nodeId = String((event as CustomEvent).detail || '')
  if (nodeId) void runCanvasNode(nodeId)
}

function onRunAllEvent() {
  void runAllCanvasNodes()
}

function openCanvasDocument(payload: any) {
  try {
    const doc = JSON.parse(String(payload?.content || '')) as CanvasDocumentV1
    canvasStore.importDocument(doc, { fileId: String(payload?.fileId || ''), title: String(payload?.name || doc.title || '我的画布') })
    showToast(`已打开画布：${canvasStore.currentTitle}`)
  } catch {
    window.alert('画布文件无法打开，内容格式不正确。')
  }
}

onMounted(async () => {
  await canvasStore.load()
  if (canvasStore.nodes.length === 0) canvasStore.resetToStarter()
  await nextTick()
  await flow.setViewport(canvasStore.viewport).catch(() => false)
  window.addEventListener('jc-canvas-run-node', onRunNodeEvent)
  window.addEventListener('jc-canvas-run-all', onRunAllEvent)
  window.addEventListener('keydown', onKeydown)
  offOpenCanvasDocument = onEvent('open-canvas-document', openCanvasDocument)
  const pendingOpen = consumeLastEvent('open-canvas-document')
  if (pendingOpen) openCanvasDocument(pendingOpen[0])
})

onUnmounted(() => {
  window.removeEventListener('jc-canvas-run-node', onRunNodeEvent)
  window.removeEventListener('jc-canvas-run-all', onRunAllEvent)
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

function openContextMenu(event: MouseEvent) {
  event.preventDefault()
  const point = flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  contextMenu.value = { show: true, x: event.clientX, y: event.clientY, flowX: point.x, flowY: point.y }
}

function addNodeFromContext(type: CanvasNodeType) {
  canvasStore.addNode(type, { x: contextMenu.value.flowX, y: contextMenu.value.flowY })
  hideContextMenu()
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

async function createNewCanvas() {
  try {
    const title = `新画布_${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`.replace(/:/g, '-')
    const doc = createStarterCanvasDocument(title, `canvas_${Date.now().toString(36)}`)
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

async function exportCanvas() {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await save({ defaultPath: '韭菜盒子画布.jccanvas', filters: [{ name: '韭菜盒子画布', extensions: ['jccanvas'] }] })
  if (!path) return
  await writeTextFile(path, JSON.stringify(canvasStore.exportDocument(), null, 2))
}

async function screenshotCanvas() {
  const element = document.querySelector('.cw-flow-wrap') as HTMLElement | null
  if (!element) return
  const { toPng } = await import('html-to-image')
  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  const path = await save({ defaultPath: '韭菜盒子画布截图.png', filters: [{ name: 'PNG 图片', extensions: ['png'] }] })
  if (!path) return
  const dataUrl = await toPng(element, { cacheBust: true, pixelRatio: 2, backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff' })
  const binary = atob(dataUrl.split(',')[1] || '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  await writeFile(path, bytes)
}

async function importCanvas() {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  const path = await open({ multiple: false, filters: [{ name: '韭菜盒子画布', extensions: ['jccanvas', 'json'] }] })
  if (!path || Array.isArray(path)) return
  const text = await readTextFile(path)
  const doc = JSON.parse(text) as CanvasDocumentV1
  canvasStore.importDocument(doc)
}

function runSelected() {
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
        <span class="mso">account_tree</span>
        <input v-model="titleInput" class="cw-title-input" @keyup.enter="canvasStore.setCanvasTitle(titleInput); editingTitle = false" @keyup.escape="editingTitle = false" @blur="canvasStore.setCanvasTitle(titleInput); editingTitle = false" @pointerdown.stop />
      </template>
      <template v-else>
        <span class="mso">account_tree</span>{{ canvasStore.currentTitle }}
      </template>
    </div>
    <CanvasToolbar @new-canvas="createNewCanvas" @run-selected="runSelected" @run-all="runAll" @delete-selected="deleteSelectedCanvasContent" @toggle-workflows="showWorkflows = !showWorkflows" @export-canvas="exportCanvas" @import-canvas="importCanvas" @screenshot="screenshotCanvas" @save-canvas="saveCanvas" @save-to-files="saveCanvasToFiles" />
    <div class="cw-body">
      <CanvasNodeLibrary @add-node="addNode" @drag-node="onDragNode" />
      <div class="cw-flow-wrap" @dragover.prevent @drop.prevent="onDropNode" @contextmenu="openContextMenu" @click="hideContextMenu">
        <CanvasWorkflowPanel v-if="showWorkflows" @close="showWorkflows = false" />
        <VueFlow
          id="jiucai-canvas"
          class="cw-flow"
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
          :is-valid-connection="canvasStore.isValidConnection"
          @connect="canvasStore.connect"
          @node-click="onNodeClick"
          @edge-click="onEdgeClick"
          @pane-click="canvasStore.selectNode(''); canvasStore.selectEdge(''); hideContextMenu()"
          @viewport-change-end="onViewportChangeEnd"
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
        <div v-if="contextMenu.show" class="cw-context-menu" :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }" @pointerdown.stop @click.stop>
          <button v-for="item in contextNodeOptions" :key="item.type" @click="addNodeFromContext(item.type)">
            <span class="mso">{{ item.icon }}</span>
            {{ item.label }}
          </button>
        </div>
        <div v-if="nodeCountWarning" class="cw-node-warning">节点超过 100 个，建议拆分画布或收起不需要的节点。</div>
        <CanvasExecutionLog />
        <Transition name="cw-toast">
          <div v-if="toastMessage" class="cw-toast">{{ toastMessage }}</div>
        </Transition>
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
</style>
