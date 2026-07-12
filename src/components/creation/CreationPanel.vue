<script setup lang="ts">
/**
 * CreationPanel — 创作面板
 * 中间区域嵌入 LeaferJS 画布，替代原任务列表。
 * 参数区 / cp-composer 保持不变。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { App, Ellipse, Group, Image, Pen, Platform, Rect, DragEvent as LeaferDragEvent, Text as LeaferText, PointerEvent, UI } from 'leafer-ui'
import { Arrow } from '@leafer-in/arrow'
import '@leafer-in/editor'
import '@leafer-in/viewport'
import '@leafer-in/resize'
import '@leafer-in/arrow'
import '@leafer-in/text-editor'
import '@leafer-in/export'
import '@leafer-in/scroll'
import '@leafer-in/state'
import '@leafer-in/find'
import '@leafer-in/animate'
import '@leafer-in/flow'
import '@leafer-in/html'
import '@leafer-in/motion-path'
import '@leafer-in/filter'
import '@leafer-in/color'
import '@leafer-in/bright'
import '@leafer-in/scale-fixed'
import '@leafer-in/box'
import '@leafer-in/corner'
import '@leafer-in/view'

Platform.image.crossOrigin = 'anonymous'
import {
  RH_TASK_LABELS,
  type CreationTask,
} from '@/data/creationModels'
import {
  CREATION_PANEL_MODELS,
  cpState,
  currentModel,
  currentCreationSpec,
  currentRunPlan,
  currentRunPlanError,
  currentSubmitSummary,
  currentModelAvailability,
  availableModels,
  aspectOptions,
  sizeOptions,
  resolutionOptions,
  durationOptions,
  durationRange,
  hasDuration,
  promptPlaceholder,
  showTagsInput,
  showTitleInput,
  showNegativeTagsInput,
  showMvSelect,
  mvOptions,
  languageOptions,
  showTextInput,
  showRefTextInput,
  showVoicePromptInput,
  showStartEndTimeInput,
  showWidthHeightInput,
  showValueInput,
  showLanguageSelect,
  showPromptInput,
  genericModelFields,
  switchTask,
  switchModel,
  setAspect,
  setSize,
  setResolution,
  setDuration,
  setMv,
  setLanguage,
  getModelFieldValue,
  setModelFieldValue,
  refreshCreationModelAvailability,
  saveCpState,
  getVisibleCreationTasks,
  buildCurrentCreationParams,
} from '@/composables/useCreation'
import { displayModelLabel, RH_ONLY_MODE } from '@/runtime/creation/creationModelRegistry'
import { buildCreationRunPlan } from '@/runtime/creation/creationMediaPlan'

import { emitEvent, onEvent, consumeLastEvent } from '@/utils/eventBus'
import { openExternal } from '@/utils/httpClient'
import { getMediaAssetById } from '@/utils/idb'
import { assetRowToRealPath, parseMediaRef } from '@/utils/mediaFileReader'
import { extractVideoFirstFrameThumbnail } from '@/utils/mediaThumbnail'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import type { MediaTask } from '@/stores/mediaTaskStore'
import { useCanvasStore } from '@/components/canvas/canvasStore'
import { createCanvasFile, listCanvasFiles, restoreCanvasAtPath, saveCanvas } from '@/components/canvas/canvasPersistence'
import type { CanvasDocumentV2, CanvasSceneNode, CanvasTaskTarget } from '@/types/canvas'

const mediaTaskStore = useMediaTaskStore()
const canvasStore = useCanvasStore()

// ─── 任务状态 ───

const creationActiveTasks = computed(() =>
  mediaTaskStore.tasks.filter(task =>
    task.source === 'creation' && (task.status === 'pending' || task.status === 'running')
  )
)
const creationRunningCount = computed(() => creationActiveTasks.value.length)
const creationProgressText = computed(() => {
  const firstTask = creationActiveTasks.value[0]
  if (creationRunningCount.value > 1) return `${creationRunningCount.value}个任务生成中...`
  return firstTask?.progressText || cpState.progressText || '生成中...'
})
const creationProgress = computed(() => {
  const firstTask = creationActiveTasks.value[0]
  return firstTask?.progress || cpState.progress
})

// ─── 任务列表（分页） ───

const creationTasks = computed(() =>
  mediaTaskStore.tasks
    .filter(t => t.source === 'creation')
    .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt))
)
const creationTasksTotal = computed(() => creationTasks.value.length)

const taskPageSize = ref(20)
const taskPage = ref(1)
const totalTaskPages = computed(() => Math.max(1, Math.ceil(creationTasksTotal.value / taskPageSize.value)))

watch(creationTasksTotal, () => {
  if (taskPage.value > totalTaskPages.value) taskPage.value = totalTaskPages.value
})

const pagedCreationTasks = computed(() => {
  const start = (taskPage.value - 1) * taskPageSize.value
  return creationTasks.value.slice(start, start + taskPageSize.value)
})

function pad(n: number): string { return String(n).padStart(2, '0') }

function formatTaskTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function statusIcon(status: string): string {
  switch (status) {
    case 'pending':
    case 'running': return '\u23F3'
    case 'success': return '\u2705'
    case 'failed': return '\u274C'
    case 'cancelled': return '\u2298'
    default: return '\u23F3'
  }
}

function taskPromptLine(task: MediaTask): string {
  const prompt = (task.prompt || '无提示词').slice(0, 80)
  return `${prompt} · ${task.modelLabel || task.model}`
}

function taskPath(task: MediaTask): string {
  return task.assetUri || task.resultUrl || ''
}

function isLocalFilePath(path: string): boolean {
  return Boolean(path) && !path.startsWith('http') && !path.startsWith('blob:') && !path.startsWith('jc-media:')
}

async function resolveTaskFilePath(task: MediaTask): Promise<string> {
  if (!task.assetUri) return ''
  const assetId = parseMediaRef(task.assetUri)
  if (!assetId) return task.assetUri
  const row = await getMediaAssetById(assetId)
  return row ? assetRowToRealPath(row) : ''
}

async function previewTask(task: MediaTask) {
  const target = task.assetUri || task.resultUrl
  if (!target) return
  try {
    if (isTauriRuntime()) {
      const filePath = await resolveTaskFilePath(task)
      if (filePath && isLocalFilePath(filePath)) {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('open_in_shell', { path: filePath })
        return
      }
    }
    if (task.resultUrl) await openExternal(task.resultUrl)
  } catch {
    if (task.resultUrl) window.open(task.resultUrl, '_blank')
  }
}

async function openTaskFolder(task: MediaTask) {
  if (!task.assetUri) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('dev_reveal_in_finder', { path: task.assetUri })
  } catch { /* ignore */ }
}

// ─── 模型/渠道/模式标签 ───

const rhChannelLabel = computed(() => {
  const spec = currentCreationSpec.value
  if (!spec) return '未选择模型'
  if (spec.source === 'newapi-direct') return 'NewAPI 直连'
  return spec.apiStyle === 'rh-aiapp' ? 'RH 工作流' : 'RH 官方 API'
})

function modeLabel(mode?: string): string {
  switch (mode) {
    case 'text-to-image': return '文生图'
    case 'image-to-image': return '图生图'
    case 'text-to-video': return '文生视频'
    case 'image-to-video': return '图生视频'
    case 'video-edit': return '视频编辑'
    case 'text-to-audio': return '文生音频'
    case 'lyrics': return '歌词'
    case 'digital-human': return '数字人'
    case 'voice-clone': return '声音克隆'
    case 'voice-design': return '声音设计'
    case 'workflow': return '工作流'
    default: return '参数待确认'
  }
}

const rhModeLabel = computed(() => {
  const planMode = currentRunPlan.value?.mode
  const specMode = currentCreationSpec.value?.mode
  return modeLabel(planMode || specMode)
})

// ─── 挂载 ───

onMounted(async () => {
  await mediaTaskStore.init().catch(() => {})
  refreshCreationModelAvailability().catch(() => {})
})

// ─── 生成入口 ───
async function runCreationViaTaskStore() {
  try {
  console.log('[Creation] runCreationViaTaskStore called')
  const m = currentModel.value
  if (!m) { cpState.progressText = '请先选择模型'; return }
  if (currentModelAvailability.value?.status === 'disabled') {
    cpState.progressText = currentModelAvailability.value.reason || '该模型暂时不可用'
    return
  }
  const task = m.capability.task
  const mediaType = m.modelName === 'rh-suno-lyrics' ? 'text' as const
    : task === 'image' ? 'image' as const
      : task === 'audio' ? 'audio' as const : 'video' as const

  const refImages: string[] = []
  const refVideos: string[] = []
  const selected = (app?.editor?.list || []) as any[]
  let canvasTarget: CanvasTaskTarget | undefined
  if (selected.length && canvasStore.canvasPath) {
    const { useProjectStore } = await import('@/stores/projectStore')
    const projectDir = useProjectStore().projectDir.value
    if (!projectDir) { cpState.progressText = '请先选择项目文件夹'; return }
    const assets = selected
      .map(node => ({ node, asset: canvasStore.assets[String(node.id)] }))
      .filter((entry): entry is { node: any; asset: NonNullable<typeof entry.asset> } => Boolean(entry.asset))
      .sort((a, b) => Number(a.node.y || 0) - Number(b.node.y || 0) || Number(a.node.x || 0) - Number(b.node.x || 0))
    const fileLimits = currentCreationSpec.value?.files
    const selectedImageCount = assets.filter(({ asset }) => asset.kind === 'image').length
    const selectedVideoCount = assets.filter(({ asset }) => asset.kind === 'video').length
    if (fileLimits?.images?.max !== undefined && selectedImageCount > fileLimits.images.max) {
      cpState.progressText = `当前模型最多支持 ${fileLimits.images.max} 张图片`
      return
    }
    if (fileLimits?.videos?.max !== undefined && selectedVideoCount > fileLimits.videos.max) {
      cpState.progressText = `当前模型最多支持 ${fileLimits.videos.max} 个视频，请只选一个`
      return
    }
    const modalities = currentCreationSpec.value?.capabilities.inputModalities || []
    for (const { asset } of assets) {
      if (!modalities.includes(asset.kind)) continue
      const url = await getMediaSubmissionUrl(`${projectDir}/${asset.path}`)
      if (asset.kind === 'video') refVideos.push(url)
      else refImages.push(url)
    }
    if (!refImages.length && !refVideos.length) {
      cpState.progressText = '当前模型不支持已选素材类型'
      return
    }
    const bounds = selected.reduce((result, node) => {
      const x = Number(node.x || 0), y = Number(node.y || 0)
      const width = Number(node.width || 0), height = Number(node.height || 0)
      return {
        left: Math.min(result.left, x), top: Math.min(result.top, y),
        right: Math.max(result.right, x + width), bottom: Math.max(result.bottom, y + height),
      }
    }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity })
    canvasTarget = {
      canvasId: canvasStore.canvasId, canvasPath: canvasStore.canvasPath,
      operation: 'append', referenceNodeIds: assets.map(entry => String(entry.node.id)),
      referenceBounds: { x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top },
    }
  }

  const submitPlan = buildCreationRunPlan({
    modelId: currentCreationSpec.value?.id || cpState.modelKey,
    params: buildCurrentCreationParams({ images: refImages, videos: refVideos, audios: [] }),
  })

  cpState.generating = true
  cpState.progressText = '提交中...'

  try {
    await mediaTaskStore.submitTask({
      type: mediaType, model: m.modelName, modelLabel: m.label,
      prompt: cpState.prompt, referenceImages: refImages, referenceVideos: refVideos,
      videoParams: refVideos.length ? { videoUrl: refVideos[0] } : undefined,
      source: 'creation', plan: submitPlan, canvasTarget,
    })
  } catch (e: any) {
    cpState.generating = creationRunningCount.value > 0
    cpState.progressText = `提交失败: ${(e.message || e).toString().slice(0, 100)}`
  }
  } catch (outerErr: any) {
    console.error('[Creation] FATAL:', outerErr)
    cpState.progressText = `\u274C 错误: ${(outerErr.message || String(outerErr)).slice(0, 100)}`
  }
}

// 任务完成/失败 → 更新进度
const offTaskSettled = onEvent('media-task-settled', (payload: any) => {
  if (payload.source === 'creation') {
    const runningCount = creationRunningCount.value
    cpState.runningTasks = runningCount
    cpState.generating = runningCount > 0
    if (!cpState.generating) {
      const errMsg = payload.status === 'failed' ? `\u274C 生成失败: ${payload.errorMsg || '请重试'}` : ''
      cpState.progressText = errMsg
      cpState.progress = 0
      if (errMsg) setTimeout(() => { if (cpState.progressText === errMsg) cpState.progressText = '' }, 10000)
    } else if (payload.status === 'failed') {
      cpState.progressText = `\u274C 生成失败: ${payload.errorMsg || '请重试'}`
    } else {
      cpState.progressText = creationProgressText.value
    }
    if (payload.status === 'success') taskPage.value = 1
  }
})
onBeforeUnmount(offTaskSettled)

// ─── 🆕 画布集成 ───

/** 图片/视频→dataURL */
function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(f)
  })
}

const canvasContainer = ref<HTMLDivElement>()
const canvasImportInput = ref<HTMLInputElement>()
const canvasDragOver = ref(false)
const showCanvasMore = ref(false)
const videoPreview = ref<{ src: string; name: string } | null>(null)
const showTaskHistory = ref(false)
const drawMode = ref(false)
const drawType = ref<'arrow' | 'text' | 'pen' | 'number'>('arrow')
// ponytail: 跟踪当前激活的工具类型，解决切换工具时的 toggle 竞态
const activeDrawType = ref<'arrow' | 'text' | 'pen' | 'number' | null>(null)
// 右键菜单
const ctxMenu = ref({ show: false, x: 0, y: 0 })
let app: App | null = null
// 剪贴板（存储克隆源元素，避免原元素删除后粘贴失效）
const clipboard: any[] = []
// ponytail: 官方 Editor 不提供 history，保留有限快照覆盖画布工具的撤销/重做
const canvasHistory: any[][] = []
let canvasHistoryIndex = -1
let nextMarkerNumber = 1

function saveCanvasHistory() {
  if (!app) return
  const snapshot = app.tree.children.map((child: any) => child.toJSON())
  if (JSON.stringify(canvasHistory[canvasHistoryIndex]) === JSON.stringify(snapshot)) return
  canvasHistory.splice(canvasHistoryIndex + 1)
  canvasHistory.push(snapshot)
  if (canvasHistory.length > 50) canvasHistory.shift()
  canvasHistoryIndex = canvasHistory.length - 1
  scheduleCanvasSave()
}

function restoreCanvasHistory(index: number) {
  if (!app || index < 0 || index >= canvasHistory.length) return
  app.editor?.cancel()
  app.tree.clear()
  canvasHistory[index].forEach(data => app!.tree.add(UI.one(data)))
  canvasHistoryIndex = index
  nextMarkerNumber = Math.max(0, ...app.tree.children
    .filter((child: any) => child.name === 'number-marker')
    .map((marker: any) => Number(marker.children?.[1]?.text) || 0)) + 1
}

function mediaPathForStorage(filePath: string, projectDir: string): string {
  return filePath.startsWith(`${projectDir}/`) ? filePath.slice(projectDir.length + 1) : filePath
}

async function getMediaRuntimeUrl(filePath: string): Promise<string> {
  if (!isTauriRuntime() || filePath.startsWith('http') || filePath.startsWith('data:') || filePath.startsWith('blob:')) return filePath
  try {
    const { useProjectStore } = await import('@/stores/projectStore')
    const projectDir = useProjectStore().projectDir.value
    if (!projectDir) return filePath
    const relativePath = mediaPathForStorage(filePath, projectDir)
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<{ base64: string; size: number; truncated: boolean }>('dev_read_file', {
      input: { root: projectDir, relativePath, maxBytes: 20_000_000 },
    })
    if (!result?.base64 || result.truncated) return filePath
    const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
    const mime = ext === 'mp4' ? 'video/mp4'
      : ext === 'webm' ? 'video/webm'
      : ext === 'mov' ? 'video/quicktime'
      : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
      : ext === 'webp' ? 'image/webp'
      : ext === 'gif' ? 'image/gif'
      : 'image/png'
    return `data:${mime};base64,${result.base64}`
  } catch {
    return filePath
  }
}

async function getMediaSubmissionUrl(filePath: string): Promise<string> {
  if (!isTauriRuntime() || filePath.startsWith('http') || filePath.startsWith('data:') || filePath.startsWith('blob:')) return filePath
  return getMediaDisplayUrl(filePath)
}

type CanvasMediaKind = 'image' | 'video'
type CanvasMediaRequest = [filePath: string, kind: CanvasMediaKind, source: 'creation' | 'drop' | 'paste' | 'import', prompt: string, model: string]
let canvasRestoring = false
const queuedCanvasMedia: CanvasMediaRequest[] = []

/** 将项目媒体加入画布，并保留可持久化的媒体路径。 */
async function addMediaToCanvas(filePath: string, kind: CanvasMediaKind, source: 'creation' | 'drop' | 'paste' | 'import' = 'drop', prompt = '', model = '') {
  if (canvasRestoring) {
    queuedCanvasMedia.push([filePath, kind, source, prompt, model])
    return
  }
  if (!app) return
  const { useProjectStore } = await import('@/stores/projectStore')
  const projectDir = useProjectStore().projectDir.value
  const path = projectDir ? mediaPathForStorage(filePath, projectDir) : filePath
  const layer = canvasStore.addLayer({
    path,
    kind,
    x: 100 + Math.random() * 200,
    y: 100 + Math.random() * 200,
    width: 0,
    height: 0,
    label: prompt.slice(0, 30),
    source,
    model,
    prompt,
    locked: false,
  })
  if (kind === 'video') {
    const card = createVideoReferenceNode(layer.id, layer.x, layer.y, prompt || filePath.split('/').pop() || '视频')
    app.tree.add(card)
    void hydrateVideoReferenceNode(card, filePath, layer.id)
  } else {
    const url = await getMediaRuntimeUrl(filePath)
    const img = new Image({ id: layer.id, url, editable: true, x: layer.x, y: layer.y, stroke: getCanvasFrame(), strokeWidth: 1, cornerRadius: 6 })
    img.once('error', () => { console.warn('[canvas] image load failed:', url.slice(0, 60)); img.remove() })
    app.tree.add(img)
  }
  saveCanvasHistory()
}

async function flushQueuedCanvasMedia() {
  while (queuedCanvasMedia.length) {
    await addMediaToCanvas(...queuedCanvasMedia.shift()!)
  }
}

/** 生成完成 → 自动入画布 */
const offCanvasSync = onEvent('media-task-settled', (payload: any) => {
  console.log('🔵 canvas: settled', payload.source, payload.status, payload.taskId); if (payload.source !== 'creation' || payload.status !== 'success') return
  void nextTick(async () => {
    const task = mediaTaskStore.tasks.find((t: any) => t.id === payload.taskId)
    if (!task?.assetUri || (task.type !== 'image' && task.type !== 'video')) return
    if (task.canvasTarget) return
    const filePath = await resolveTaskFilePath(task)
    if (filePath) await addMediaToCanvas(filePath, task.type, 'creation', task.prompt || '', task.modelLabel || '')
  })
})

/** 文件树 → 画布联动 */
const offFileTreeMedia = onEvent('canvas:add-media', (payload: any) => {
  console.log('[canvas] filetree add:', payload.url?.slice(-40))
  if (payload.url && payload.kind) void addMediaToCanvas(payload.url, payload.kind, 'import', payload.label || '')
})

async function addCanvasFiles(files: Iterable<File>) {
  for (const file of files) {
    const kind: CanvasMediaKind | null = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : null
    if (!kind) continue
    // Web 端：用 blob URL；桌面端：走 Tauri 复制到 jc-media/
    if (!isTauriRuntime()) {
      const url = URL.createObjectURL(file)
      await addMediaToCanvas(url, kind, 'drop', file.name)
      continue
    }
    try {
      const base64 = await fileToDataUrl(file)
      const projectDir = (await import('@/stores/projectStore')).useProjectStore().projectDir.value
      if (projectDir) {
        const { writeProjectMedia } = await import('@/utils/projectMediaWriter')
        const { filePath } = await writeProjectMedia({
          dataBase64: base64.split(',')[1],
          mime: file.type,
          projectDir,
          kind,
          prompt: file.name,
        })
        await addMediaToCanvas(filePath, kind, 'drop', file.name)
      } else {
        await addMediaToCanvas(base64, kind, 'drop', file.name)
      }
    } catch {
      await addMediaToCanvas(URL.createObjectURL(file), kind, 'drop', file.name)
    }
  }
}

function onCanvasImport(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) void addCanvasFiles(input.files)
  input.value = ''
}

/** 画布拖入处理（模板直接绑定 @drop） */
async function onCanvasDrop(e: DragEvent) {
  if (e.dataTransfer?.files) await addCanvasFiles(e.dataTransfer.files)
}

function onCanvasPaste(e: ClipboardEvent) {
  const files = Array.from(e.clipboardData?.files || []).filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'))
  if (!files.length) return
  e.preventDefault()
  e.stopPropagation()
  void addCanvasFiles(files)
}

function focusCanvasForPaste() {
  canvasContainer.value?.focus()
}

const canvasCleanups: (() => void)[] = []
let saveTimer: ReturnType<typeof setTimeout> | undefined
let canvasReady = false

function getCanvasScene(): CanvasSceneNode[] {
  return app ? app.tree.children.map(child => stripRuntimeVideoPoster(child.toJSON() as CanvasSceneNode)) : []
}

function stripRuntimeVideoPoster(node: CanvasSceneNode): CanvasSceneNode {
  const clean = { ...node }
  if (Array.isArray(node.children)) {
    clean.children = node.children
      .filter(child => child.name !== 'video-poster')
      .map(stripRuntimeVideoPoster)
  }
  return clean
}

function scheduleCanvasSave() {
  if (!app || !canvasReady) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    void saveCanvas(canvasStore.getCanvasDocument(getCanvasScene()), canvasStore.canvasPath || undefined).catch(error => {
      console.warn('[canvas] save failed:', error)
    })
  }, 500)
}

async function flushCanvasSave() {
  if (!app || !canvasReady) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = undefined
  }
  await saveCanvas(canvasStore.getCanvasDocument(getCanvasScene()), canvasStore.canvasPath || undefined)
}

async function restoreCanvasScene(document: CanvasDocumentV2, path = canvasStore.canvasPath) {
  if (!app) return
  canvasStore.loadCanvasDocument(document, path)
  app.tree.clear()
  const { useProjectStore } = await import('@/stores/projectStore')
  const projectDir = useProjectStore().projectDir.value
  for (const node of document.scene) {
    const restored = UI.one(node as any)
    const asset = document.assets[String((node as any).id)]
    if (asset?.kind === 'video') {
      const card = createVideoReferenceNode(asset.id, Number((node as any).x || 0), Number((node as any).y || 0), asset.prompt || asset.path.split('/').pop() || '视频', node)
      app.tree.add(card)
      if (projectDir) void hydrateVideoReferenceNode(card, `${projectDir}/${asset.path}`, asset.id)
      continue
    }
    if (asset && projectDir) (restored as any).url = await getMediaRuntimeUrl(`${projectDir}/${asset.path}`)
    app.tree.add(restored)
  }
  canvasHistory.length = 0
  canvasHistoryIndex = -1
  saveCanvasHistory()
}

async function openCanvas(path: string) {
  if (!app || path === canvasStore.canvasPath) return
  if (canvasReady) await flushCanvasSave()
  const result = await restoreCanvasAtPath(path)
  if (result.status !== 'ready') throw new Error('画布无法打开')
  canvasReady = false
  await restoreCanvasScene(result.document, path)
  canvasReady = true
  localStorage.setItem('jc_canvas_last_path', path)
}

async function createAndOpenCanvas() {
  const { file, document } = await createCanvasFile()
  if (canvasReady) await flushCanvasSave()
  canvasReady = false
  await restoreCanvasScene(document, file.path)
  canvasReady = true
  localStorage.setItem('jc_canvas_last_path', file.path)
  emitEvent('refresh-file-list')
}

const offCanvasOpen = onEvent('canvas:open', (payload: any) => {
  if (payload?.path) void openCanvas(payload.path).catch(error => { cpState.progressText = `打开画布失败: ${String(error.message || error)}` })
})
const offCanvasRenamed = onEvent('canvas:renamed', (payload: any) => {
  if (payload?.oldPath === canvasStore.canvasPath) canvasStore.canvasPath = payload.newPath
})
const offCanvasDeleted = onEvent('canvas:deleted', (payload: any) => {
  if (payload?.path !== canvasStore.canvasPath) return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined }
  canvasReady = false
  void listCanvasFiles()
    .then(files => files[0] ? openCanvas(files[0].path) : createAndOpenCanvas())
    .catch(error => { cpState.progressText = `切换画布失败: ${String(error.message || error)}` })
})
const offCanvasLocate = onEvent('canvas:locate', () => emitEvent('project-filetree:locate', { path: canvasStore.canvasPath }))
const offCanvasTaskResult = onEvent('canvas:task-result', (payload: any) => {
  if (payload?.target?.canvasPath !== canvasStore.canvasPath || !payload.document) return
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined }
  void restoreCanvasScene(payload.document, canvasStore.canvasPath)
})

/** 读取 CSS 变量获取当前主题背景色 */
function getCanvasFill(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fafaf8'
}

function getCanvasFrame(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#d8d8d2'
}

function getCanvasText(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--ink1').trim() || '#333'
}

function refreshCanvasTheme() {
  if (!app) return
  ;(app as any).config.fill = getCanvasFill()
  Object.assign((app.editor as any)?.config || {}, {
    stroke: getComputedStyle(document.documentElement).getPropertyValue('--olive').trim() || '#6b8e23',
    pointFill: getCanvasFill(),
  })
  for (const child of app.tree.children as any[]) {
    if (child.name === 'canvas-video-reference') {
      for (const item of child.children || []) {
        if (item.name === 'video-frame') item.set({ fill: getCanvasFill(), stroke: getCanvasFrame() })
        else if (item.name !== 'video-poster') item.set({ fill: getCanvasText() })
      }
    } else if (child.tag === 'Image') child.set({ stroke: getCanvasFrame() })
  }
  app.editor?.update()
}

function formatVideoDuration(seconds?: number): string {
  if (!seconds) return ''
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
}

function createVideoReferenceNode(id: string, x: number, y: number, label: string, saved?: CanvasSceneNode) {
  const card = new Group({
    id, editable: true, hitChildren: false, x, y, width: 320, height: 180, name: 'canvas-video-reference',
    scaleX: Number(saved?.scaleX || 1), scaleY: Number(saved?.scaleY || 1),
    rotation: Number(saved?.rotation || 0), skewX: Number(saved?.skewX || 0), skewY: Number(saved?.skewY || 0),
  })
  card.addMany(
    new Rect({ name: 'video-frame', width: 320, height: 180, fill: getCanvasFill(), stroke: getCanvasFrame(), strokeWidth: 1, cornerRadius: 6 }),
    new LeaferText({ name: 'video-play', x: 144, y: 68, text: '▶', fill: getCanvasText(), fontSize: 32 }),
    new LeaferText({ name: 'video-label', x: 12, y: 148, width: 296, text: label, fill: getCanvasText(), fontSize: 12, textOverflow: 'ellipsis' }),
  )
  return card
}

async function getMediaDisplayUrl(filePath: string): Promise<string> {
  if (!isTauriRuntime() || filePath.startsWith('http') || filePath.startsWith('data:') || filePath.startsWith('blob:')) return filePath
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  return convertFileSrc(filePath)
}

async function hydrateVideoReferenceNode(card: Group, filePath: string, assetId: string) {
  card.on_(PointerEvent.DOUBLE_TAP, () => { void openVideoPreview(filePath, canvasStore.assets[assetId]?.prompt || filePath.split('/').pop() || '视频') })
  try {
    const preview = await extractVideoFirstFrameThumbnail(await getMediaDisplayUrl(filePath))
    if (card.destroyed) return
    const poster = new Image({ name: 'video-poster', url: preview.thumbnailUrl, width: 320, height: 180, cornerRadius: 6 })
    card.addAt(poster, 1)
    const asset = canvasStore.assets[assetId]
    if (asset) {
      asset.duration = preview.duration
      asset.width = preview.width
      asset.height = preview.height
      const label = card.children.find(child => child.name === 'video-label') as any
      if (label) label.text = `${asset.prompt || filePath.split('/').pop() || '视频'}${formatVideoDuration(preview.duration) ? `  ${formatVideoDuration(preview.duration)}` : ''}`
    }
    scheduleCanvasSave()
  } catch {
    const label = card.children.find(child => child.name === 'video-label') as any
    if (label) label.text = `${label.text}（预览不可用）`
  }
}

async function openVideoPreview(filePath: string, name: string) {
  videoPreview.value = { src: await getMediaDisplayUrl(filePath), name }
}

function closeVideoPreview() {
  videoPreview.value = null
}

function runCanvasMore(action: string) {
  canvasTool(action)
  showCanvasMore.value = false
}

/** 工具栏操作 */
function cancelCanvasSelection() {
  if (app?.editor) app.editor.cancel()
}

function moveLayer(direction: 1 | -1) {
  const selected = (app?.editor?.list || []) as any[]
  const byParent = new Map<any, any[]>()
  for (const node of selected) {
    if (!node.parent) continue
    const nodes = byParent.get(node.parent) || []
    nodes.push(node)
    byParent.set(node.parent, nodes)
  }
  for (const [parent, nodes] of byParent) {
    const selectedSet = new Set(nodes)
    nodes.sort((a, b) => parent.children.indexOf(a) - parent.children.indexOf(b))
    if (direction > 0) nodes.reverse()
    for (const node of nodes) {
      const index = parent.children.indexOf(node)
      const neighbor = parent.children[index + direction]
      if (neighbor && !selectedSet.has(neighbor)) (node as any).dropTo(parent, index + direction)
    }
  }
  if (selected.length) saveCanvasHistory()
}

function transformSelection(action: 'rotateLeft' | 'rotateRight' | 'flipHorizontal' | 'flipVertical' | 'skewLeft' | 'skewRight') {
  const selected = (app?.editor?.list || []) as any[]
  for (const node of selected) {
    if (action === 'rotateLeft') node.rotation -= 90
    else if (action === 'rotateRight') node.rotation += 90
    else if (action === 'flipHorizontal') node.scaleX *= -1
    else if (action === 'flipVertical') node.scaleY *= -1
    else if (action === 'skewLeft') node.skewX -= 10
    else node.skewX += 10
  }
  if (selected.length) saveCanvasHistory()
}
function activateDrawTool(type: 'arrow' | 'text' | 'pen' | 'number') {
  if (drawMode.value && activeDrawType.value === type) return
  drawType.value = type
  canvasTool('draw')
}
function canvasTool(action: string) {
  if (!app) return
  const w = app.width || canvasContainer.value?.clientWidth || 800
  const h = app.height || canvasContainer.value?.clientHeight || 600
  switch (action) {
    case 'select':
      if (drawMode.value) {
        const ids = (app as any).__drawCleanups as any[]
        if (ids) { ids.forEach((id: any) => app!.off_(id)); (app as any).__drawCleanups = null }
      }
      app.mode = 'normal'
      drawMode.value = false
      activeDrawType.value = null
      break
    case 'delete':
      if (app.editor?.list?.length) {
        app.editor.list.forEach((el: any) => el.remove())
        app.editor.cancel()
        saveCanvasHistory()
      }
      break
    case 'fit': {
      const children = app.tree.children
      if (!children.length) break
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const child of children) {
        const b = (child as any).getBounds?.('box') || (child as any).worldBoxBounds
        if (!b) continue
        minX = Math.min(minX, b.x)
        minY = Math.min(minY, b.y)
        maxX = Math.max(maxX, b.x + b.width)
        maxY = Math.max(maxY, b.y + b.height)
      }
      if (!isFinite(minX)) break
      const cw = maxX - minX + 120
      const ch = maxY - minY + 120
      const s = Math.min(w / cw, h / ch, 1)
      app.zoomLayer.scale = s
      app.zoomLayer.x = -minX * s + (w - cw * s) / 2 + 60 * s
      app.zoomLayer.y = -minY * s + (h - ch * s) / 2 + 60 * s
      break
    }
    case 'draw': {
      if (!app) break
      // 清理旧模式（无论切换还是关闭）
      if (drawMode.value) {
        const ids = (app as any).__drawCleanups as any[]
        if (ids) { ids.forEach((id: any) => app!.off_(id)); (app as any).__drawCleanups = null }
        app.mode = 'normal'
      }
      // 同工具 → 关闭；不同工具 → 切换（保持激活）
      const sameTool = drawMode.value && activeDrawType.value === drawType.value
      drawMode.value = sameTool ? false : true
      activeDrawType.value = drawMode.value ? drawType.value : null
      if (!drawMode.value) break

      // 文字用 PointerEvent.DOWN：拖动事件会等待移动阈值，不能用于即时输入。
      app.mode = 'draw'
      const isText = drawType.value === 'text'
      const isPen = drawType.value === 'pen'
      const isNumber = drawType.value === 'number'
      let drawing: any = null
      let pen: Pen | null = null

      const onStart = (e: any) => {
        if (isPen) {
          const point = e.getPagePoint()
          pen = new Pen({ id: crypto.randomUUID(), editable: true }).setStyle({ stroke: '#333', strokeWidth: 3, strokeCap: 'round', strokeJoin: 'round' })
          pen.moveTo(point.x, point.y)
          app!.tree.add(pen)
        } else {
          drawing = new Arrow({
            id: crypto.randomUUID(),
            editable: true, stroke: '#e74c3c', strokeWidth: 3,
            endArrow: 'arrow', strokeCap: 'round'
          })
          app!.tree.add(drawing)
        }
      }
      const onDrag = (e: any) => {
        if (isPen && pen) {
          const point = e.getPagePoint()
          pen.lineTo(point.x, point.y)
          pen.paint()
          return
        }
        if (!drawing) return
        const start = e.getPagePoint()
        const total = e.getPageTotal()
        drawing.set({ x: start.x - total.x, y: start.y - total.y })
        drawing.toPoint = { x: total.x, y: total.y }
      }
      const onEnd = () => {
        if (drawing || pen) saveCanvasHistory()
        drawing = null
        pen = null
      }
      const onTextDown = (e: any) => {
        const text = new LeaferText({
          id: crypto.randomUUID(),
          x: e.x, y: e.y,
          editable: true, fill: '#333', fontSize: 18,
          text: '', padding: [4, 8],
        })
        app!.tree.add(text)
        saveCanvasHistory()
        app!.mode = 'normal'
        drawMode.value = false
        activeDrawType.value = null
        const ids = (app as any).__drawCleanups as any[]
        if (ids) { ids.forEach((id: any) => app!.off_(id)); (app as any).__drawCleanups = null }
        requestAnimationFrame(() => {
          app?.editor?.openInnerEditor(text, true)
          app?.editor?.innerEditor?.editDom?.focus()
        })
      }
      const onNumberDown = (e: any) => {
        const marker = new Group({
          id: crypto.randomUUID(),
          x: e.x - 14, y: e.y - 14, editable: true, hitChildren: false, name: 'number-marker',
        })
        marker.addMany(
          new Ellipse({ width: 28, height: 28, fill: '#fff', stroke: '#e74c3c', strokeWidth: 2 }),
          new LeaferText({
            width: 28, height: 28, text: String(nextMarkerNumber++), fill: '#e74c3c',
            fontSize: 15, fontWeight: 'bold', textAlign: 'center', verticalAlign: 'middle',
          }),
        )
        app!.tree.add(marker)
        saveCanvasHistory()
      }
      const ids = [
        ...(isText ? [app.on_(PointerEvent.DOWN, onTextDown)] : isNumber ? [app.on_(PointerEvent.DOWN, onNumberDown)] : [
          app.on_(LeaferDragEvent.START, onStart),
          app.on_(LeaferDragEvent.DRAG, onDrag),
          app.on_(LeaferDragEvent.END, onEnd),
        ]),
      ]
      ;(app as any).__drawCleanups = ids
      break
    }
    case 'zoomIn': app.zoomLayer.scale = Number(app.zoomLayer.scale || 1) * 1.3; break
    case 'zoomOut': app.zoomLayer.scale = Number(app.zoomLayer.scale || 1) / 1.3; break
    case 'group':
      if (app.editor?.list?.length && app.editor.list.length > 1) { app.editor.group(); saveCanvasHistory() }
      break
    case 'ungroup':
      if (app.editor?.list?.length) { app.editor.ungroup(); saveCanvasHistory() }
      break
    case 'lock':
      if (app.editor?.list?.length) { app.editor.lock(); saveCanvasHistory() }
      break
    case 'unlock':
      if (app.editor?.list?.length) { app.editor.unlock(); saveCanvasHistory() }
      break
    case 'toFront':
      if (app.editor?.list?.length) { app.editor.toTop(); saveCanvasHistory() }
      break
    case 'toBack':
      if (app.editor?.list?.length) { app.editor.toBottom(); saveCanvasHistory() }
      break
    case 'layerUp': moveLayer(1); break
    case 'layerDown': moveLayer(-1); break
    case 'rotateLeft': case 'rotateRight': case 'flipHorizontal': case 'flipVertical': case 'skewLeft': case 'skewRight':
      transformSelection(action)
      break
    case 'copy': {
      if (!app.editor?.list?.length) break
      clipboard.length = 0
      for (const el of app.editor.list) {
        try { clipboard.push((el as any).clone()) } catch { /* 某些元素可能不支持 clone */ }
      }
      break
    }
    case 'paste': {
      for (const src of clipboard) {
        try {
          const clone = (src as any).clone()
          clone.x += 20; clone.y += 20
          clone.editable = true
          app.tree.add(clone)
        } catch { /* 某些元素可能不支持 clone */ }
      }
      saveCanvasHistory()
      break
    }
    case 'undo':
      if (canvasHistoryIndex > 0) {
        canvasHistory[canvasHistoryIndex] = app.tree.children.map((child: any) => child.toJSON())
        restoreCanvasHistory(canvasHistoryIndex - 1)
      }
      break
    case 'redo':
      if (canvasHistoryIndex < canvasHistory.length - 1) restoreCanvasHistory(canvasHistoryIndex + 1)
      break
  }
}

onMounted(() => {
  if (!canvasContainer.value) return

  canvasReady = false
  app = new App({
    view: canvasContainer.value,
    editor: {
      stroke: getComputedStyle(document.documentElement).getPropertyValue('--olive').trim() || '#6b8e23',
      strokeWidth: 1,
      pointFill: getCanvasFill(),
      pointSize: 8,
      pointRadius: 8,
      lockRatio: true,
      hideResizeLines: true,
      rect: { cornerRadius: 6 },
    },
    fill: getCanvasFill(),
  })
  saveCanvasHistory()

  // 右键菜单
  const onContextMenu = (e: any) => {
    e.origin?.preventDefault?.()
    const origin = e.origin as MouseEvent | undefined
    ctxMenu.value = {
      show: true,
      x: origin?.clientX ?? e.x,
      y: origin?.clientY ?? e.y,
    }
  }
  const ctxMenuId = app.on_(PointerEvent.MENU, onContextMenu)
  canvasCleanups.push(() => { if (app) app.off_(ctxMenuId) })

  // 点击其他地方关闭右键菜单
  const closeCtxMenu = () => { ctxMenu.value.show = false }
  document.addEventListener('click', closeCtxMenu)
  canvasCleanups.push(() => document.removeEventListener('click', closeCtxMenu))

  // 全局键盘快捷键（画布可见时生效）
  const onKeyDown = (e: KeyboardEvent) => {
    if (!app) return
    const el = document.activeElement
    // 只在画布区域或没有输入框聚焦时处理
    const inCanvas = canvasContainer.value?.contains(el)
    const inInput = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || (el as HTMLElement)?.isContentEditable
    if (inInput && !inCanvas) return

    const ctrl = e.ctrlKey || e.metaKey
    if (e.key === 'Escape' && drawMode.value) {
      e.preventDefault(); canvasTool('select')
    } else if (!ctrl && !e.altKey && !e.shiftKey && !app.editor?.innerEditing && ['v', 'a', 't', 'b', 'n'].includes(e.key.toLowerCase())) {
      const toolKeys: Record<string, 'arrow' | 'text' | 'pen' | 'number'> = {
        a: 'arrow', t: 'text', b: 'pen', n: 'number',
      }
      if (e.key.toLowerCase() === 'v') {
        e.preventDefault(); canvasTool('select')
      } else if (toolKeys[e.key.toLowerCase()]) {
        e.preventDefault(); activateDrawTool(toolKeys[e.key.toLowerCase()])
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (app.editor?.list?.length) {
        e.preventDefault()
        canvasTool('delete')
      }
    } else if (ctrl && e.key === 'z' && !e.shiftKey) {
      e.preventDefault(); canvasTool('undo')
    } else if (ctrl && e.key === 'z' && e.shiftKey) {
      e.preventDefault(); canvasTool('redo')
    } else if (ctrl && e.key === 'g' && !e.shiftKey) {
      e.preventDefault(); canvasTool('group')
    } else if (ctrl && e.key === 'g' && e.shiftKey) {
      e.preventDefault(); canvasTool('ungroup')
    } else if (ctrl && e.key === 'l' && !e.shiftKey) {
      e.preventDefault(); canvasTool('lock')
    } else if (ctrl && e.key === 'l' && e.shiftKey) {
      e.preventDefault(); canvasTool('unlock')
    } else if (ctrl && e.key === ']') {
      e.preventDefault(); canvasTool('toFront')
    } else if (ctrl && e.key === '[') {
      e.preventDefault(); canvasTool('toBack')
    } else if (ctrl && e.key === 'c') {
      e.preventDefault(); canvasTool('copy')
    } else if (ctrl && e.key === 'v') {
      e.preventDefault(); canvasTool('paste')
    }
  }
  document.addEventListener('keydown', onKeyDown)
  canvasCleanups.push(() => document.removeEventListener('keydown', onKeyDown))

  // 监听主题变化 → 同步画布背景
  const observer = new MutationObserver(() => {
    refreshCanvasTheme()
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  canvasCleanups.push(() => observer.disconnect())

  canvasRestoring = true
  void (async () => {
    const initialPath = localStorage.getItem('jc_canvas_last_path')
    let path = ''
    let document: CanvasDocumentV2
    if (initialPath) {
      const result = await restoreCanvasAtPath(initialPath)
      if (result.status === 'error') {
        cpState.progressText = '画布无法打开，原文件未被覆盖'
        return
      }
      if (result.status === 'ready') {
        path = initialPath
        document = result.document
      }
    }
    if (!path) {
      const created = await createCanvasFile()
      path = created.file.path
      document = created.document
    }
    await restoreCanvasScene(document!, path)

    canvasRestoring = false
    await flushQueuedCanvasMedia()
    if (app) {
      canvasReady = true
      localStorage.setItem('jc_canvas_last_path', path)
    }
  })().catch(error => {
    canvasRestoring = false
    cpState.progressText = '画布无法打开，原文件未被覆盖'
    console.warn('[canvas] restore failed:', error)
  })

  // 🆕 消费挂载前投递的画布图片
  const pendingMedia = consumeLastEvent('canvas:add-media')
  if (pendingMedia) {
    const payload = pendingMedia[0] as any
    if (payload?.url && payload?.kind) void addMediaToCanvas(payload.url, payload.kind, 'import', payload.label || '')
  }

  const dragEndId = app.on_(LeaferDragEvent.END, scheduleCanvasSave)
  canvasCleanups.push(() => app?.off_(dragEndId))
  canvasCleanups.push(() => { if (saveTimer) clearTimeout(saveTimer) })
})

onBeforeUnmount(() => {
  offCanvasSync()
  offFileTreeMedia()
  offCanvasOpen()
  offCanvasRenamed()
  offCanvasDeleted()
  offCanvasLocate()
  offCanvasTaskResult()
  canvasCleanups.forEach(fn => fn())
  if (app) {
    void flushCanvasSave().catch(error => console.warn('[canvas] final save failed:', error))
    app.destroy()
    app = null
  }
})

// 任务/模型 popover
const openPop = ref<string>('')
function togglePop(key: string) { openPop.value = openPop.value === key ? '' : key }

const tasks = computed(() => getVisibleCreationTasks().map(key => ({ key, label: RH_TASK_LABELS[key] })))
const modelList = computed(() => availableModels.value.map(key => ({ key, label: displayModelLabel(CREATION_PANEL_MODELS[key]?.label || key) })))

function autoGrow(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}
// 画布引用在发送时才读取；不能用附件为空的旧计划禁用发送按钮。
const canSend = computed(() => Boolean(currentCreationSpec.value) && currentModelAvailability.value?.status !== 'disabled' && Boolean(cpState.prompt?.trim()))
</script>

<template>
  <div class="cp" data-panel="creation">
    <div class="cp-toolbar">
      <span class="cp-title"><JcIcon name="movie_filter" /><span class="cp-title-text">创作面板 · {{ canvasStore.canvasName }}</span></span>
      <span class="cp-toolbar-spacer" />
      <button class="cp-toolbar-link" title="定位当前画布" @click="emitEvent('canvas:locate')"><JcIcon name="folder-open" /></button>
      <button class="cp-toolbar-link" title="新建画布" @click="createAndOpenCanvas"><JcIcon name="add" /></button>
      <button class="cp-toolbar-link" @click="showTaskHistory = true" title="查看生成历史">
        <JcIcon name="history" />
        <span class="cp-toolbar-link-text">历史</span>
      </button>
      <button class="cp-toolbar-link" @click="openExternal('https://dazi.studio/')" title="打开提示词参考">
        <JcIcon name="tips_and_updates" />
        <span class="cp-toolbar-link-text">提示词参考</span>
      </button>
    </div>

    <!-- 🆕 画布区域（替代原 cp-gallery-zone） -->
    <div
      class="cp-canvas-zone"
      :class="{ 'cp-canvas-dragover': canvasDragOver }"
    >
      <div ref="canvasContainer" class="cp-canvas-container" tabindex="0"
        @pointerdown="focusCanvasForPaste"
        @paste="onCanvasPaste"
        @dragover.prevent="canvasDragOver = true"
        @dragleave.prevent="canvasDragOver = false"
        @drop.prevent.stop="onCanvasDrop"
      />
      <!-- 进度浮层（生成时叠在画布左下角） -->
      <div v-if="creationRunningCount > 0 || cpState.progressText" class="cp-canvas-progress">
        <JcIcon :name="cpState.progressText?.startsWith('❌') ? 'error' : 'sync'" />
        <span>{{ creationRunningCount > 0 ? creationProgressText : cpState.progressText }}</span>
        <div v-if="creationRunningCount > 0 && creationProgress > 0" class="cp-generation-progress">
          <i :style="{ width: Math.min(100, Math.max(0, creationProgress)) + '%' }" />
        </div>
      </div>
      <!-- 🆕 右上角工具栏 -->
      <div class="cp-canvas-toolbar">
        <button title="导入素材" @click="canvasImportInput?.click()"><JcIcon name="upload_file" /></button>
        <input ref="canvasImportInput" class="cp-canvas-import" type="file" multiple accept="image/*,video/*" @change="onCanvasImport" />
        <button title="选择工具 V" :class="{ active: !drawMode }" @click="canvasTool('select')"><JcIcon name="select" /></button>
        <span class="cp-toolbar-sep" />
        <button title="画箭头 A" :class="{ active: drawMode && drawType === 'arrow' }" @click="activateDrawTool('arrow')"><JcIcon name="arrow_forward" /></button>
        <button title="写文字 T" :class="{ active: drawMode && drawType === 'text' }" @click="activateDrawTool('text')"><JcIcon name="title" /></button>
        <button title="画笔 B" :class="{ active: drawMode && drawType === 'pen' }" @click="activateDrawTool('pen')"><JcIcon name="draw" /></button>
        <button title="编号标注 N" :class="{ active: drawMode && drawType === 'number' }" @click="activateDrawTool('number')"><JcIcon name="format_list_numbered" /></button>
        <span class="cp-toolbar-sep" />
        <button title="撤销 Ctrl+Z" @click="canvasTool('undo')"><JcIcon name="undo" /></button>
        <button title="重做 Ctrl+Shift+Z" @click="canvasTool('redo')"><JcIcon name="redo" /></button>
        <button title="删除 Delete" @click="canvasTool('delete')"><JcIcon name="delete" /></button>
        <span class="cp-toolbar-sep" />
        <button title="更多对象操作" :class="{ active: showCanvasMore }" @click="showCanvasMore = !showCanvasMore"><JcIcon name="more_horiz" /></button>
        <div v-if="showCanvasMore" class="cp-canvas-more" @click.stop>
          <span>图层</span>
          <button title="上移一层" @click="runCanvasMore('layerUp')"><JcIcon name="arrow_upward" /></button>
          <button title="下移一层" @click="runCanvasMore('layerDown')"><JcIcon name="arrow_downward" /></button>
          <button title="置顶" @click="runCanvasMore('toFront')"><JcIcon name="vertical_align_top" /></button>
          <button title="置底" @click="runCanvasMore('toBack')"><JcIcon name="vertical_align_bottom" /></button>
          <span>对象</span>
          <button title="编组" @click="runCanvasMore('group')"><JcIcon name="group_add" /></button>
          <button title="解组" @click="runCanvasMore('ungroup')"><JcIcon name="call_split" /></button>
          <button title="锁定" @click="runCanvasMore('lock')"><JcIcon name="lock" /></button>
          <button title="解锁" @click="runCanvasMore('unlock')"><JcIcon name="toggle_off" /></button>
          <span>变换</span>
          <button title="左转 90 度" @click="runCanvasMore('rotateLeft')"><JcIcon name="rotate_left" /></button>
          <button title="右转 90 度" @click="runCanvasMore('rotateRight')"><JcIcon name="rotate_right" /></button>
          <button title="水平翻转" @click="runCanvasMore('flipHorizontal')"><JcIcon name="flip" /></button>
          <button title="垂直翻转" @click="runCanvasMore('flipVertical')"><JcIcon name="flip" class="cp-flip-vertical" /></button>
          <button title="向左倾斜" @click="runCanvasMore('skewLeft')"><JcIcon name="transform" /></button>
          <button title="向右倾斜" @click="runCanvasMore('skewRight')"><JcIcon name="transform" class="cp-flip-horizontal" /></button>
        </div>
        <span class="cp-toolbar-sep" />
        <button title="适应窗口" @click="canvasTool('fit')"><JcIcon name="fit_screen" /></button>
        <button title="放大" @click="canvasTool('zoomIn')"><JcIcon name="zoom_in" /></button>
        <button title="缩小" @click="canvasTool('zoomOut')"><JcIcon name="zoom_out" /></button>
      </div>
      <!-- 右键菜单 -->
      <Teleport to="body">
        <div v-if="ctxMenu.show" class="cp-ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @click.stop>
          <button @click="drawType='arrow'; canvasTool('draw'); ctxMenu.show = false"><JcIcon name="arrow_forward" />画箭头</button>
          <button @click="drawType='text'; canvasTool('draw'); ctxMenu.show = false"><JcIcon name="title" />写文字</button>
          <button @click="drawType='pen'; canvasTool('draw'); ctxMenu.show = false"><JcIcon name="draw" />画笔</button>
          <button @click="drawType='number'; canvasTool('draw'); ctxMenu.show = false"><JcIcon name="format_list_numbered" />编号标注</button>
          <button @click="canvasTool('select'); ctxMenu.show = false"><JcIcon name="select" />选择工具 V</button>
          <hr />
          <button @click="canvasTool('copy'); ctxMenu.show = false">📋 复制 Ctrl+C</button>
          <button @click="canvasTool('paste'); ctxMenu.show = false">📄 粘贴 Ctrl+V</button>
          <button @click="canvasTool('delete'); ctxMenu.show = false">🗑 删除 Delete</button>
          <hr />
          <button @click="canvasTool('group'); ctxMenu.show = false">🔗 编组 Ctrl+G</button>
          <button @click="canvasTool('ungroup'); ctxMenu.show = false">🔓 解组 Ctrl+Shift+G</button>
          <button @click="canvasTool('lock'); ctxMenu.show = false">🔒 锁定 Ctrl+L</button>
          <button @click="canvasTool('unlock'); ctxMenu.show = false">🔐 解锁 Ctrl+Shift+L</button>
          <hr />
          <button @click="canvasTool('toFront'); ctxMenu.show = false">⬆ 置顶 Ctrl+]</button>
          <button @click="canvasTool('toBack'); ctxMenu.show = false">⬇ 置底 Ctrl+[</button>
          <button @click="canvasTool('layerUp'); ctxMenu.show = false">上移一层</button>
          <button @click="canvasTool('layerDown'); ctxMenu.show = false">下移一层</button>
          <button @click="canvasTool('rotateLeft'); ctxMenu.show = false">左转 90 度</button>
          <button @click="canvasTool('rotateRight'); ctxMenu.show = false">右转 90 度</button>
          <button @click="canvasTool('flipHorizontal'); ctxMenu.show = false">水平翻转</button>
          <button @click="canvasTool('flipVertical'); ctxMenu.show = false">垂直翻转</button>
          <button @click="canvasTool('skewLeft'); ctxMenu.show = false">向左倾斜</button>
          <button @click="canvasTool('skewRight'); ctxMenu.show = false">向右倾斜</button>
          <hr />
          <button @click="cancelCanvasSelection(); ctxMenu.show = false">✖ 取消选中</button>
          <button @click="canvasTool('fit'); ctxMenu.show = false">🔲 适应窗口</button>
        </div>
      </Teleport>
    </div>
    <Teleport to="body">
      <div v-if="videoPreview" class="cp-video-preview" @click.self="closeVideoPreview">
        <div class="cp-video-preview-dialog">
          <div><span>{{ videoPreview.name }}</span><button title="关闭" @click="closeVideoPreview"><JcIcon name="close" /></button></div>
          <video :src="videoPreview.src" controls autoplay playsinline />
        </div>
      </div>
    </Teleport>
    <!-- 🆕 历史 Modal -->
    <Teleport to="body">
      <div v-if="showTaskHistory" class="cp-history-overlay" @click.self="showTaskHistory = false">
        <div class="cp-history-modal">
          <div class="cp-history-head">
            <h3>任务历史</h3>
            <button class="cp-history-close" @click="showTaskHistory = false"><JcIcon name="close" /></button>
          </div>
          <div v-if="creationTasksTotal === 0" class="cp-task-empty">
            <JcIcon name="movie_filter" />
            <span>暂无生成记录</span>
          </div>
          <div v-else class="cp-task-list">
            <div v-for="task in pagedCreationTasks" :key="task.id" class="cp-task-item" :class="task.status">
              <div class="cp-task-head">
                <span class="cp-task-status">{{ statusIcon(task.status) }}</span>
                <span class="cp-task-time">{{ formatTaskTime(task.completedAt || task.createdAt) }}</span>
              </div>
              <div class="cp-task-prompt">{{ taskPromptLine(task) }}</div>
              <div v-if="task.status === 'running'" class="cp-task-progress">
                <span>{{ task.progressText || '生成中...' }}</span>
                <div class="cp-task-progress-bar"><i :style="{ width: Math.min(100, Math.max(0, task.progress)) + '%' }" /></div>
              </div>
              <div v-if="task.status === 'failed'" class="cp-task-error">{{ task.errorMsg }}</div>
              <div v-if="taskPath(task) && task.status === 'success'" class="cp-task-path" :class="{ remote: !task.assetUri }">{{ taskPath(task) }}</div>
              <div v-if="task.status === 'success'" class="cp-task-actions">
                <button v-if="task.assetUri || task.resultUrl" @click="previewTask(task)">预览</button>
                <button v-if="isLocalFilePath(task.assetUri || '')" @click="openTaskFolder(task)">打开文件夹</button>
              </div>
            </div>
          </div>
          <div v-if="creationTasksTotal > 0" class="cp-task-pagination">
            <select v-model.number="taskPageSize" class="cp-page-size">
              <option v-for="s in [10,20,50,100]" :key="s" :value="s">{{ s }}条/页</option>
            </select>
            <button :disabled="taskPage <= 1" @click="taskPage--">&lt;</button>
            <span class="cp-page-info">{{ taskPage }} / {{ totalTaskPages }}</span>
            <button :disabled="taskPage >= totalTaskPages" @click="taskPage++">&gt;</button>
            <span class="cp-page-total">共 {{ creationTasksTotal }} 条</span>
          </div>
        </div>
      </div>
    </Teleport>

<!-- 参数条 -->
    <div class="cp-params">
      <!-- 任务 -->
      <div class="cp-island" @click="togglePop('task')">
        <div class="cp-island-label">任务</div>
        <div class="cp-island-val">{{ RH_TASK_LABELS[cpState.task] }}</div>
        <div v-if="openPop === 'task'" class="cp-popover" @click.stop>
          <button v-for="t in tasks" :key="t.key" class="cp-pop-item"
                  :class="{ active: cpState.task === t.key }"
                  @click="switchTask(t.key); openPop = ''">
            {{ t.label }}
          </button>
        </div>
      </div>
      <!-- 模型 -->
      <div class="cp-island" @click="togglePop('model')">
        <div class="cp-island-label">模型</div>
        <div class="cp-island-val">{{ displayModelLabel(currentModel?.label || cpState.modelKey) }}</div>
        <div v-if="openPop === 'model'" class="cp-popover" @click.stop>
          <button v-for="m in modelList" :key="m.key" class="cp-pop-item"
                  :class="{ active: cpState.modelKey === m.key }"
                  @click="switchModel(m.key); openPop = ''">
            {{ m.label }}
          </button>
        </div>
      </div>
      <!-- RH 渠道 (RH_ONLY_MODE 下隐藏) -->
      <div v-if="!RH_ONLY_MODE" class="cp-island cp-rh-island">
        <div class="cp-island-label">渠道</div>
        <div class="cp-island-val">{{ rhChannelLabel }}</div>
      </div>
      <!-- RH 模式 (RH_ONLY_MODE 下隐藏) -->
      <div v-if="!RH_ONLY_MODE" class="cp-island cp-rh-island">
        <div class="cp-island-label">模式</div>
        <div class="cp-island-val">{{ rhModeLabel }}</div>
      </div>
      <!-- 尺寸 (gpt-image-2) -->
      <div v-if="sizeOptions.length" class="cp-island" @click="togglePop('size')">
        <div class="cp-island-label">尺寸</div>
        <div class="cp-island-val">{{ cpState.size }}</div>
        <div v-if="openPop === 'size'" class="cp-popover" @click.stop>
          <button v-for="s in sizeOptions" :key="s" class="cp-pop-item"
                  :class="{ active: cpState.size === s }"
                  @click="setSize(s); openPop = ''">
            {{ s }}
          </button>
        </div>
      </div>
      <!-- 比例 (视频) -->
      <div v-if="aspectOptions.length" class="cp-island" @click="togglePop('ar')">
        <div class="cp-island-label">比例</div>
        <div class="cp-island-val">{{ cpState.ar }}</div>
        <div v-if="openPop === 'ar'" class="cp-popover" @click.stop>
          <button v-for="a in aspectOptions" :key="a" class="cp-pop-item"
                  :class="{ active: cpState.ar === a }"
                  @click="setAspect(a); openPop = ''">
            {{ a }}
          </button>
        </div>
      </div>
      <!-- 分辨率 (grok) -->
      <div v-if="resolutionOptions.length" class="cp-island">
        <div class="cp-island-label">分辨率</div>
        <div class="cp-btn-group">
          <button v-for="r in resolutionOptions" :key="r" class="cp-param-btn"
                  :class="{ active: cpState.res === r }" @click="setResolution(r)">{{ r }}</button>
        </div>
      </div>
      <!-- 时长 (视频) -->
      <div v-if="hasDuration && durationRange" class="cp-island cp-island-grow">
        <div class="cp-island-label">时长</div>
        <div v-if="durationOptions.length <= 3" class="cp-btn-group">
          <button v-for="d in durationOptions" :key="d" class="cp-param-btn"
                  :class="{ active: cpState.dur === d }" @click="setDuration(d)">{{ d }}s</button>
        </div>
        <div v-else class="cp-dur-row">
          <input type="range" class="cp-dur-slider" :min="durationRange.min" :max="durationRange.max"
                 :step="durationRange.step" :value="cpState.dur" @input="setDuration(+($event.target as HTMLInputElement).value)" />
          <span class="cp-dur-val">{{ cpState.dur }}s</span>
        </div>
      </div>
      <div v-if="showMvSelect" class="cp-island" @click="togglePop('mv')">
        <div class="cp-island-label">版本</div>
        <div class="cp-island-val">{{ cpState.mv }}</div>
        <div v-if="openPop === 'mv'" class="cp-popover" @click.stop>
          <button v-for="mv in mvOptions" :key="mv" class="cp-pop-item"
                  :class="{ active: cpState.mv === mv }"
                  @click="setMv(mv); openPop = ''">
            {{ mv }}
          </button>
        </div>
      </div>
      <div v-if="showLanguageSelect" class="cp-island" @click="togglePop('language')">
        <div class="cp-island-label">语言</div>
        <div class="cp-island-val">{{ cpState.language }}</div>
        <div v-if="openPop === 'language'" class="cp-popover" @click.stop>
          <button v-for="lang in languageOptions" :key="lang" class="cp-pop-item"
                  :class="{ active: cpState.language === lang }"
                  @click="setLanguage(lang); openPop = ''">
            {{ lang }}
          </button>
        </div>
      </div>
      <div v-if="showWidthHeightInput" class="cp-island cp-number-island">
        <div class="cp-island-label">宽高</div>
        <div class="cp-number-row">
          <input v-model.number="cpState.width" type="number" class="cp-mini-input" min="16" step="16" @blur="saveCpState()" />
          <span class="cp-number-sep">×</span>
          <input v-model.number="cpState.height" type="number" class="cp-mini-input" min="16" step="16" @blur="saveCpState()" />
        </div>
      </div>
      <div v-if="showValueInput" class="cp-island cp-number-island">
        <div class="cp-island-label">画面值</div>
        <input v-model.number="cpState.value" type="number" class="cp-mini-input wide" min="16" step="16" @blur="saveCpState()" />
      </div>
      <div v-for="field in genericModelFields" :key="field.key" class="cp-island cp-generic-field">
        <div class="cp-island-label">{{ field.label }}</div>
        <div v-if="field.kind === 'select'" class="cp-btn-group">
          <button
            v-for="option in field.options || []"
            :key="String(option.value)"
            class="cp-param-btn"
            :class="{ active: getModelFieldValue(field) === option.value }"
            @click="setModelFieldValue(field, option.value)"
          >
            {{ option.label }}
          </button>
        </div>
        <input
          v-else-if="field.kind === 'number'"
          class="cp-mini-input wide"
          type="number"
          :min="field.min"
          :max="field.max"
          :step="field.step || 1"
          :value="getModelFieldValue(field)"
          @input="setModelFieldValue(field, Number(($event.target as HTMLInputElement).value))"
        />
        <label v-else-if="field.kind === 'boolean'" class="cp-toggle-field">
          <input
            type="checkbox"
            :checked="Boolean(getModelFieldValue(field))"
            @change="setModelFieldValue(field, ($event.target as HTMLInputElement).checked)"
          />
          <span>{{ getModelFieldValue(field) ? '开' : '关' }}</span>
        </label>
        <input
          v-else
          class="cp-suno-input cp-generic-input"
          :value="String(getModelFieldValue(field) || '')"
          @input="setModelFieldValue(field, ($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>

    <!-- 进度条 -->
    <div v-if="creationRunningCount > 0" class="cp-progress-bar">
      <div class="cp-progress-fill" :style="{ width: creationProgress + '%' }" />
    </div>
    <div v-if="creationRunningCount > 0" class="cp-progress-text">{{ creationProgressText }}</div>

    
<!-- ★ 提示词输入区 (增强版) ★ -->
    <div class="cp-composer">
      <div class="cp-composer-row">
        <div class="cp-prompt-wrap">
          <!-- 模型专属参数 -->
          <div v-if="showTitleInput" class="cp-suno-row">
            <input v-model="cpState.title" placeholder="歌曲标题" class="cp-suno-input" @blur="saveCpState()" />
          </div>
          <div v-if="showTagsInput" class="cp-suno-row">
            <input v-model="cpState.tags" placeholder="风格标签 (如: pop, rock, edm)" class="cp-suno-input" @blur="saveCpState()" />
          </div>
          <div v-if="showNegativeTagsInput" class="cp-suno-row">
            <input v-model="cpState.negativeTags" placeholder="排除风格" class="cp-suno-input" @blur="saveCpState()" />
          </div>
          <div v-if="showStartEndTimeInput" class="cp-inline-fields">
            <input v-model="cpState.startTime" placeholder="开始时间 0:00" class="cp-suno-input" @blur="saveCpState()" />
            <input v-model="cpState.endTime" placeholder="结束时间 0:11" class="cp-suno-input" @blur="saveCpState()" />
          </div>
          <div v-if="showRefTextInput" class="cp-suno-row">
            <textarea v-model="cpState.refText" rows="2" placeholder="参考音频文字" class="cp-aux-textarea" @blur="saveCpState()" />
          </div>
          <div v-if="showTextInput" class="cp-suno-row">
            <textarea v-model="cpState.text" rows="2" :placeholder="cpState.modelKey === 'rh-aiapp-digital-human' ? '台词' : cpState.modelKey === 'rh-aiapp-director' ? '简单说下动作是啥' : '输出文字/文稿'" class="cp-aux-textarea" @blur="saveCpState()" />
          </div>
          <div v-if="showVoicePromptInput" class="cp-suno-row">
            <textarea v-model="cpState.voicePrompt" rows="2" placeholder="人设 + 音色特征 + 风格 + 情感 + 节奏" class="cp-aux-textarea" @blur="saveCpState()" />
          </div>
          <textarea v-if="showPromptInput" v-model="cpState.prompt" rows="2" :placeholder="promptPlaceholder"
                    @blur="saveCpState()" @input="autoGrow" class="cp-prompt-input" />
        </div>
        <div class="cp-submit">
          <button class="cp-send-btn" :class="{ ready: canSend, generating: creationRunningCount > 0 }"
                  :disabled="!canSend && creationRunningCount < 1"
                  @click="runCreationViaTaskStore" title="生成">
            <span v-if="creationRunningCount > 0" class="cp-running-badge">{{ creationRunningCount }}</span>
            <JcIcon name="arrow_upward" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cp {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  position: relative;
  background: var(--surface);
}

/* 拖拽高亮 */
/* 拖拽高亮 — 仅高亮底部 composer 区域 */
.cp-drag-over .cp-composer {
  position: relative;
}
.cp-drag-over .cp-composer::after {
  content: '拖放文件到此处';
  position: absolute;
  inset: -4px;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: var(--olive);
  background: color-mix(in srgb, var(--olive) 12%, transparent);
  border: 2px dashed var(--olive);
  border-radius: 8px;
  pointer-events: none;
}

.cp-toolbar {
  height: var(--app-header-height);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.cp-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--ink1);
  font-size: 14px;
  font-weight: 700;
}

.cp-title .mso { font-size: 18px; color: var(--olive-dark); }
.cp-title-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-toolbar-spacer { flex: 1; min-width: 8px; }

.cp-toolbar-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}

.cp-toolbar-link:hover { border-color: var(--olive); color: var(--olive-dark); }
.cp-toolbar-link .mso { font-size: 16px; }

/* ─── 🆕 画布区域 ─── */
.cp-canvas-zone {
  flex: 1 1 0; min-height: 0;
  position: relative; overflow: hidden;
}
.cp-canvas-zone.cp-canvas-dragover {
  outline: 2px dashed var(--olive);
  outline-offset: -2px;
}
.cp-canvas-container {
  width: 100%; height: 100%;
}
.cp-canvas-import { display: none; }

/* ─── 🆕 画布进度浮层 ─── */
.cp-canvas-progress {
  position: absolute; bottom: 8px; left: 8px; right: 8px;
  z-index: 10;
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 90%, var(--olive-pale));
  border: 1px solid var(--olive);
  font-size: 12px; color: var(--olive-dark);
}
.cp-canvas-progress .cp-generation-progress {
  flex: 1; height: 4px;
  background: rgba(0,0,0,.06); border-radius: 2px; overflow: hidden;
}
.cp-canvas-progress .cp-generation-progress i {
  display: block; height: 100%;
  background: var(--olive); border-radius: 2px;
  transition: width .3s;
}

/* ─── 🆕 右上角工具栏 ─── */
.cp-canvas-toolbar {
  position: absolute; top: 12px; right: 0; z-index: 20;
  display: flex; flex-direction: column; gap: 4px;
}
.cp-canvas-toolbar button {
  width: 30px; height: 30px;
  border: 1px solid var(--line); border-radius: 6px;
  background: color-mix(in srgb, var(--surface) 90%, var(--paper));
  color: var(--ink2); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; padding: 0;
}
.cp-canvas-toolbar button:hover {
  border-color: var(--olive); color: var(--olive-dark);
  background: var(--olive-pale);
}
.cp-canvas-toolbar button.active {
  border-color: var(--olive); color: white;
  background: var(--olive);
}
.cp-toolbar-sep {
  width: 20px; height: 1px; background: var(--line); margin: 2px auto;
}
.cp-canvas-more {
  position: absolute; right: 38px; top: 206px; width: 142px; padding: 6px;
  display: grid; grid-template-columns: repeat(4, 28px); gap: 4px;
  background: var(--paper); border: 1px solid var(--line); border-radius: 8px;
  box-shadow: 0 8px 20px rgba(0,0,0,.14);
}
.cp-canvas-more span { grid-column: 1 / -1; color: var(--ink3); font-size: 11px; padding: 2px 3px 0; }
.cp-canvas-toolbar .cp-canvas-more button { width: 28px; height: 28px; }
.cp-flip-vertical { transform: rotate(90deg); }
.cp-flip-horizontal { transform: scaleX(-1); }
.cp-video-preview {
  position: fixed; inset: 0; z-index: 10001; display: grid; place-items: center;
  background: rgba(0,0,0,.48);
}
.cp-video-preview-dialog {
  width: min(880px, calc(100vw - 32px)); max-height: calc(100vh - 32px);
  background: var(--paper); border: 1px solid var(--line); border-radius: 8px; overflow: hidden;
}
.cp-video-preview-dialog > div { height: 40px; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; color: var(--ink1); font-size: 13px; }
.cp-video-preview-dialog button { width: 28px; height: 28px; border: 0; background: transparent; color: var(--ink2); cursor: pointer; }
.cp-video-preview-dialog video { display: block; width: 100%; max-height: calc(100vh - 88px); background: #000; }
/* ─── 右键菜单 ─── */
.cp-ctx-menu {
  position: fixed; z-index: 9999;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.12);
  padding: 4px; min-width: 160px;
  display: flex; flex-direction: column; gap: 2px;
}
.cp-ctx-menu button {
  all: unset; cursor: pointer; padding: 6px 12px;
  border-radius: 6px; font-size: 13px; color: var(--ink1);
  line-height: 1.5; display: flex; align-items: center; gap: 6px;
}
.cp-ctx-menu button:hover {
  background: var(--olive-pale); color: var(--olive-dark);
}
.cp-ctx-menu hr {
  border: none; border-top: 1px solid var(--line); margin: 2px 4px;
}

/* ─── 🆕 历史 Modal ─── */
.cp-history-overlay {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0,0,0,.3);
  display: flex; align-items: center; justify-content: center;
}
.cp-history-modal {
  width: min(640px, 90vw); max-height: 80vh;
  background: var(--surface); border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,.15);
  display: flex; flex-direction: column; overflow: hidden;
}
.cp-history-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.cp-history-head h3 { margin: 0; font-size: 15px; font-weight: 700; }
.cp-history-close {
  width: 32px; height: 32px; border: none; background: none;
  cursor: pointer; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
}
.cp-history-close:hover { background: var(--olive-pale); }
.cp-history-modal .cp-task-list {
  flex: 1; overflow-y: auto; padding: 12px 16px;
  display: flex; flex-direction: column; gap: 6px;
}
.cp-history-modal .cp-task-pagination {
  padding: 10px 16px; border-top: 1px solid var(--line);
  flex-shrink: 0;
  display: flex; align-items: center; gap: 6px; font-size: 12px;
}
.cp-history-modal .cp-task-empty {
  flex: 1; min-height: 120px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; color: var(--ink3); font-size: 13px;
}

/* 删除旧 cp-gallery-zone 样式 */
/* ponytail: 保留 cp-task-* 样式（历史 Modal 复用） */

.cp-task-empty {
  flex: 1; min-height: 86px;
  border: 1px dashed var(--line); border-radius: 8px;
  color: var(--ink3);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; font-size: 12px;
}
.cp-task-empty .mso { font-size: 26px; color: var(--olive); opacity: .75; }

.cp-task-list {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 6px;
}

.cp-task-item {
  padding: 10px 12px;
  border: 1px solid var(--line); border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 82%, var(--paper));
  font-size: 12px;
}
.cp-task-item.running,
.cp-task-item.pending { border-left: 3px solid var(--olive); }
.cp-task-item.success { border-color: color-mix(in srgb, var(--line) 60%, transparent); }
.cp-task-item.failed { border-left: 3px solid #c62828; background: color-mix(in srgb, #fce4ec 40%, var(--surface)); }

.cp-task-head {
  display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
}
.cp-task-status { font-size: 13px; }
.cp-task-time { color: var(--ink3); font-size: 11px; }

.cp-task-prompt {
  color: var(--ink1); font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cp-task-progress { margin-top: 4px; color: var(--ink2); font-size: 11px; }
.cp-task-progress-bar {
  height: 3px; margin-top: 3px; overflow: hidden; border-radius: 999px;
  background: rgba(0,0,0,.06);
}
.cp-task-progress-bar i {
  display: block; height: 100%; border-radius: inherit; background: var(--olive);
}
.cp-task-error { margin-top: 4px; color: #c62828; font-size: 11px; }
.cp-task-path {
  margin-top: 4px; color: var(--ink3); font-size: 11px;
  font-family: monospace; word-break: break-all;
}
.cp-task-path.remote { color: var(--olive); }

.cp-task-actions {
  margin-top: 6px; display: flex; gap: 8px;
}
.cp-task-actions button {
  padding: 3px 10px;
  border: 1px solid var(--line); border-radius: 6px;
  background: var(--paper); color: var(--ink2);
  font: inherit; font-size: 11px; font-weight: 600; cursor: pointer;
}
.cp-task-actions button:hover { border-color: var(--olive); color: var(--olive-dark); }

.cp-task-pagination {
  display: flex; align-items: center; justify-content: flex-end; gap: 6px;
  padding: 8px 0 4px; border-top: 1px solid var(--line);
  color: var(--ink3); font-size: 12px;
  flex-shrink: 0;
}
.cp-page-size {
  height: 26px; padding: 0 4px;
  border: 1px solid var(--line); border-radius: 6px;
  background: var(--surface); color: var(--ink2);
  font: inherit; font-size: 11px; outline: none; cursor: pointer;
}
.cp-page-info { font-weight: 700; color: var(--ink2); min-width: 50px; text-align: center; }
.cp-page-total { margin-left: 6px; }
.cp-task-pagination button {
  height: 26px; min-width: 26px;
  border: 1px solid var(--line); border-radius: 6px;
  background: var(--paper); color: var(--ink2);
  font: inherit; font-size: 13px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
.cp-task-pagination button:hover:not(:disabled) { border-color: var(--olive); color: var(--olive-dark); }
.cp-task-pagination button:disabled { opacity: .35; cursor: default; }

/* ─── 生成状态（保留） ─── */
.cp-generation-status {
  display: grid; grid-template-columns: auto minmax(0, 1fr);
  gap: 7px 8px; align-items: center;
  min-height: 34px; padding: 8px 12px;
  border: 1px solid var(--line); border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 82%, var(--paper));
  color: var(--ink2); font-size: 12px;
}
.cp-generation-status .mso { color: var(--olive); font-size: 16px; }
.cp-generation-summary {
  grid-column: 2 / -1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--ink3); font-size: 11px;
}
.cp-generation-progress {
  grid-column: 1 / -1; height: 3px; overflow: hidden; border-radius: 999px;
  background: rgba(0,0,0,.08);
}
.cp-generation-progress i {
  display: block; height: 100%; border-radius: inherit; background: var(--olive);
}

.cp-params {
  display: flex; gap: 6px; padding: 8px 12px; border-top: 1px solid var(--line);
  flex-wrap: wrap; align-items: flex-start; flex-shrink: 0;
}
.cp-island {
  position: relative; padding: 6px 10px; border-radius: 8px;
  border: 1px solid var(--line); cursor: pointer; transition: border-color .12s;
}
.cp-island:hover { border-color: var(--olive); }
.cp-rh-island {
  cursor: default;
  background: color-mix(in srgb, var(--olive-pale) 54%, transparent);
}
.cp-rh-island:hover { border-color: var(--line); }
.cp-island-grow { flex: 1; min-width: 120px; }
.cp-island-label { font-size: 10px; color: var(--ink3); margin-bottom: 2px; }
.cp-island-val { font-size: 12px; font-weight: 600; color: var(--ink1); }
.cp-popover {
  position: absolute; bottom: 100%; left: 0; z-index: 20;
  background: var(--paper); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 -4px 16px rgba(0,0,0,.1); padding: 4px; min-width: 140px; max-height: 300px; overflow-y: auto;
  margin-bottom: 4px;
}
.cp-pop-item {
  display: block; width: 100%; padding: 8px 12px; border: none; background: none;
  text-align: left; font-size: 12px; cursor: pointer; border-radius: 6px; color: var(--ink1); font-family: inherit;
}
.cp-pop-item:hover { background: var(--olive-pale); }
.cp-pop-item.active { background: var(--olive-pale); color: var(--olive-dark); font-weight: 700; }

.cp-btn-group { display: flex; gap: 3px; flex-wrap: wrap; }
.cp-param-btn {
  padding: 3px 8px; border: 1px solid var(--line); border-radius: 6px;
  background: none; font-size: 11px; cursor: pointer; color: var(--ink2); font-family: inherit;
}
.cp-param-btn.active { background: var(--olive); color: #fff; border-color: var(--olive); }
.cp-param-btn:hover { border-color: var(--olive); }
.cp-dur-row { display: flex; align-items: center; gap: 6px; }
.cp-dur-slider { flex: 1; accent-color: var(--olive); }
.cp-dur-val { font-size: 12px; font-weight: 700; color: var(--olive-dark); min-width: 28px; }

/* ★ 进度条 (增强) ★ */
.cp-progress-bar {
  height: 2px; background: rgba(107,142,35,.18); border-radius: 1px;
  overflow: hidden; margin: 0 12px; flex-shrink: 0;
}
.cp-progress-fill {
  height: 100%; border-radius: 1px;
  background: linear-gradient(90deg, var(--olive-dark), var(--olive));
  transition: width .5s;
}
.cp-progress-text { text-align: center; font-size: 10px; color: var(--ink3); padding: 2px 12px; flex-shrink: 0; }

/* ★ 提示词输入区 (增强版) ★ */
.cp-composer {
  display: flex; flex-direction: column; gap: 6px; padding: 10px 12px 12px;
  border-top: 1px solid var(--line); flex-shrink: 0; background: var(--surface-alt);
}
.cp-composer-row {
  display: flex; align-items: flex-end; gap: 8px;
}
/* ── 参考素材添加行 ── */
.cp-attach-row {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 2px 0;
}
.cp-attach-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0;
  border: 1px dashed var(--line); border-radius: 6px; cursor: pointer;
  background: transparent; color: var(--ink3); transition: all .15s;
  flex-shrink: 0;
}
.cp-attach-btn:hover { border-color: var(--olive); color: var(--olive); background: var(--olive-pale); }
.cp-attach-btn .mso { font-size: 14px; }
.cp-prompt-wrap {
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;
  min-height: 48px; padding: 8px 12px;
  border: 1px solid var(--line); border-radius: 10px;
  background: var(--paper); transition: border-color .15s, box-shadow .15s;
}
.cp-prompt-wrap:focus-within {
  border-color: var(--olive);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--olive) 16%, transparent);
}

.cp-media-slots {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  gap: 6px;
  margin-bottom: 2px;
}
.cp-media-slot {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 44px;
  padding: 7px 9px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  cursor: pointer;
  text-align: left;
  font: inherit;
}
.cp-media-slot:hover {
  border-color: var(--olive);
  background: var(--olive-pale);
}
.cp-media-slot.filled {
  border-style: solid;
  border-color: rgba(107,142,35,.38);
}
.cp-media-slot-icon {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--surface-alt);
  color: var(--olive);
  font-size: 16px;
}
.cp-media-slot-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.cp-media-slot-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink1);
}
.cp-media-slot-label em {
  color: #c2410c;
  font-style: normal;
  margin-left: 2px;
}
.cp-media-slot-value {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--ink3);
}

/* 文件缩略图方块网格 */
.cp-files { display: flex; flex-wrap: wrap; gap: 8px; max-height: 200px; overflow-y: auto; padding: 2px 0; }
.cp-file-thumb {
  width: 88px; height: 88px; border-radius: 8px; overflow: hidden;
  position: relative; flex-shrink: 0; cursor: default;
  background: var(--paper); border: 1px solid var(--line);
}
.cp-file-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cp-thumb-placeholder {
  width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
  color: var(--ink3); font-size: 28px; gap: 2px;
}
.cp-thumb-placeholder .mso { font-size: 28px; }
.cp-thumb-label {
  font-size: 8px; color: var(--ink3); max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.2;
}
.cp-thumb-remove {
  position: absolute; top: 4px; right: 4px; width: 20px; height: 20px;
  border-radius: 50%; background: rgba(0,0,0,0.55); border: none; cursor: pointer;
  color: #fff; display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity 0.15s; padding: 0;
}
.cp-thumb-remove .mso { font-size: 12px; }
.cp-file-thumb:hover .cp-thumb-remove { opacity: 1; }
.cp-clear-files {
  display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0;
  padding: 4px 8px; font-size: 11px; border: 1px dashed var(--line); border-radius: 6px;
  cursor: pointer; background: transparent; color: var(--ink3); transition: all .15s;
  align-self: flex-start;
}
.cp-clear-files:hover { border-color: var(--error); color: var(--error); }
.cp-clear-files .mso { font-size: 12px; }

.cp-suno-row { margin-bottom: 6px; }
.cp-suno-input {
  width: 100%; padding: 4px 0; border: none; border-bottom: 1px solid var(--line);
  background: none; font-size: 13px; color: var(--ink); outline: none; font-family: inherit;
}
.cp-inline-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 6px; }
.cp-aux-textarea {
  width: 100%; border: 1px solid var(--line); border-radius: 8px; background: var(--paper);
  color: var(--ink); resize: vertical; outline: none; font-family: inherit; font-size: 12px;
  line-height: 1.5; padding: 6px 8px; min-height: 44px; max-height: 120px; box-sizing: border-box;
}
.cp-number-island { cursor: default; }
.cp-number-row { display: flex; align-items: center; gap: 4px; }
.cp-number-sep { color: var(--ink3); font-size: 11px; }
.cp-mini-input {
  width: 54px; height: 24px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--surface); color: var(--ink1); font: inherit; font-size: 11px;
  padding: 0 5px; box-sizing: border-box;
}
.cp-mini-input.wide { width: 74px; }
.cp-prompt-input {
  width: 100%; border: none; background: none; font-size: 13px; color: var(--ink);
  resize: none; outline: none; font-family: inherit; line-height: 1.6;
  min-height: 28px; max-height: 200px; overflow-y: auto;
  field-sizing: content;
}
.cp-submit { flex-shrink: 0; }
.cp-send-btn {
  width: 40px; height: 40px; border-radius: 50%; border: none;
  background: var(--line); color: var(--surface); cursor: pointer; display: flex;
  align-items: center; justify-content: center; transition: all .3s;
  position: relative; pointer-events: none;
}
.cp-send-btn:disabled {
  opacity: .5;
  transform: none;
}
.cp-send-btn.ready {
  background: var(--olive); color: #fff; pointer-events: auto;
  animation: gcGlow 2.2s ease-in-out infinite;
}
.cp-send-btn.generating {
  background: var(--olive-dark); color: #fff; pointer-events: auto; cursor: pointer;
}
@keyframes gcGlow {
  0%, 100% { box-shadow: 0 0 10px rgba(107,142,35,.15); }
  50% { box-shadow: 0 0 22px rgba(107,142,35,.4); }
}
.cp-send-btn:hover { transform: scale(1.08); }
.cp-send-btn .mso { font-size: 18px; }
.cp-running-badge {
  position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px;
  border-radius: 8px; background: #ef4444; color: #fff; font-size: 10px;
  display: flex; align-items: center; justify-content: center; font-weight: 700;
}

/* ═══ 移动端适配 (mobile-web) ═══ */
@media (max-width: 768px) {
  /* P0: 参数栏溢出修复 */
  .cp-params {
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
  }
  .cp-island {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .cp-popover {
    max-width: calc(100vw - 24px);
    left: 50%;
    transform: translateX(-50%);
  }
  .cp-btn-group {
    flex-wrap: wrap;
  }

  .cp-canvas-zone {
    /* mobile: canvas still takes flex space */
  }

  /* P1: 提示词输入区紧凑化 */
  .cp-composer {
    padding: 6px 8px 8px;
    gap: 6px;
  }
  .cp-upload-trigger {
    width: 38px;
    height: 38px;
    min-width: 38px;
  }
  .cp-prompt-input {
    max-height: 80px;
    font-size: 16px; /* 防止 iOS 缩放 */
  }

  /* P1: 工具栏紧凑化 */
  .cp-toolbar {
    padding: 0 8px;
    gap: 4px;
  }
  .cp-toolbar-link-text {
    display: none; /* 只显示图标 */
  }
}

</style>
