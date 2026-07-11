<script setup lang="ts">
/**
 * CreationPanel — 创作面板
 * 中间区域嵌入 LeaferJS 画布，替代原任务列表。
 * 参数区 / cp-composer 保持不变。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { App, Image, Platform, DragEvent as LeaferDragEvent } from 'leafer-ui'
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
  acceptsFiles,
  acceptAttr,
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
  addFiles,
  replaceFilesForMediaKind,
  removeFile,
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
import { isTauriRuntime } from '@/utils/tauriEnv'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import type { MediaTask } from '@/stores/mediaTaskStore'
import { useCanvasStore } from '@/components/canvas/canvasStore'
import { saveCanvas, restoreCanvas } from '@/components/canvas/canvasPersistence'

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
  const runPlanError = currentRunPlanError.value
  if (runPlanError || !currentRunPlan.value) {
    cpState.progressText = runPlanError || '请补充生成参数'
    return
  }
  const task = m.capability.task
  const mediaType = m.modelName === 'rh-suno-lyrics' ? 'text' as const
    : task === 'image' ? 'image' as const
      : task === 'audio' ? 'audio' as const : 'video' as const

  const refImages: string[] = []
  const refVideos: string[] = []
  const refAudios: string[] = []
  for (const f of cpState.files) {
    const dataUrl = await fileToDataUrl(f)
    if (f.type.startsWith('image/')) refImages.push(dataUrl)
    else if (f.type.startsWith('video/')) refVideos.push(dataUrl)
    else if (f.type.startsWith('audio/')) refAudios.push(dataUrl)
  }

  const submitPlan = buildCreationRunPlan({
    modelId: currentCreationSpec.value?.id || cpState.modelKey,
    params: buildCurrentCreationParams({ images: refImages, videos: refVideos, audios: refAudios }),
  })

  cpState.generating = true
  cpState.progressText = '提交中...'

  try {
    await mediaTaskStore.submitTask({
      type: mediaType, model: m.modelName, modelLabel: m.label,
      prompt: cpState.prompt, referenceImages: refImages,
      source: 'creation', plan: submitPlan,
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
const canvasDragOver = ref(false)
const showCanvasMore = ref(false)
const showTaskHistory = ref(false)
const drawMode = ref(false)
let app: App | null = null

/** 将图片添加到画布 */
async function addImageToCanvas(filePath: string) {
  if (!app) return
  let url = filePath

  // 桌面端本地绝对路径 → 通过 dev_read_file 读 base64
  if (isTauriRuntime() && !filePath.startsWith('http') && !filePath.startsWith('data:') && !filePath.startsWith('blob:')) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      // 从 projectStore 获取项目根目录，计算相对路径
      const { useProjectStore } = await import('@/stores/projectStore')
      const projectDir = useProjectStore().projectDir.value
      if (projectDir && filePath.startsWith(projectDir)) {
        const relativePath = filePath.slice(projectDir.length).replace(/^\//, '')
        const result = await invoke<{ base64: string; size: number }>('dev_read_file', {
          input: { root: projectDir, relativePath, maxBytes: 20_000_000 },
        })
        if (result?.base64) {
          const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'webp' ? 'image/webp'
            : ext === 'gif' ? 'image/gif'
            : 'image/png'
          url = `data:${mime};base64,${result.base64}`
        }
      } else {
        console.warn('[canvas] file outside project dir:', filePath.slice(-40))
      }
    } catch (e) {
      console.warn('[canvas] dev_read_file failed:', e)
    }
  }

  console.log('[canvas] addImageToCanvas:', url.slice(0, 60) + '...')
  const img = new Image({
    url,
    editable: true,
    x: 100 + Math.random() * 200,
    y: 100 + Math.random() * 200,
  })
  img.once('error', () => {
    console.warn('[canvas] image load failed:', url.slice(0, 60))
    img.remove()
  })
  app.tree.add(img)
}

/** 生成完成 → 自动入画布 */
const offCanvasSync = onEvent('media-task-settled', (payload: any) => {
  console.log('🔵 canvas: settled', payload.source, payload.status, payload.taskId); if (payload.source !== 'creation' || payload.status !== 'success') return
  nextTick(() => {
    const task = mediaTaskStore.tasks.find((t: any) => t.id === payload.taskId)
    if (!task?.assetUri || task.type !== 'image') return
    canvasStore.addLayer({
      path: task.assetUri,
      x: 100 + Math.random() * 200,
      y: 100 + Math.random() * 200,
      width: 0, height: 0,
      label: (task.prompt || task.modelLabel || '未命名').slice(0, 30),
      source: 'creation',
      model: task.modelLabel || '',
      prompt: task.prompt || '',
      locked: false,
    })
    // ponytail: 使用 Tauri asset protocol 加载本地图片
    console.log("🔵 canvas: adding", task.assetUri.slice(-40)); addImageToCanvas(task.assetUri)
  })
})

/** 文件树 → 画布联动 */
const offFileTreeImage = onEvent('canvas:add-image', (payload: any) => {
  console.log('[canvas] filetree add:', payload.url?.slice(-40))
  if (payload.url) addImageToCanvas(payload.url)
})

/** 画布拖入处理（模板直接绑定 @drop） */
async function onCanvasDrop(e: DragEvent) {
  console.log("DROP on canvas:", e.dataTransfer?.types, e.dataTransfer?.files?.length)
  const files = e.dataTransfer?.files
  if (!files) return
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    // Web 端：用 blob URL；桌面端：走 Tauri 复制到 jc-media/
    if (!isTauriRuntime()) {
      const url = URL.createObjectURL(file)
      canvasStore.addLayer({
        path: url, x: 100 + Math.random() * 200, y: 100 + Math.random() * 200,
        width: 0, height: 0, label: file.name, source: 'drop', locked: false,
      })
      addImageToCanvas(url)
      continue
    }
    try {
      const base64 = await fileToDataUrl(file)
      const { invoke } = await import('@tauri-apps/api/core')
      const projectDir = (await import('@/stores/projectStore')).useProjectStore().projectDir.value
      if (projectDir) {
        const kind = 'image' as const
        const { writeProjectMedia } = await import('@/utils/projectMediaWriter')
        const { filePath } = await writeProjectMedia({
          dataBase64: base64.split(',')[1],
          mime: file.type,
          projectDir,
          kind,
          prompt: file.name,
        })
        canvasStore.addLayer({
          path: filePath, x: 100 + Math.random() * 200, y: 100 + Math.random() * 200,
          width: 0, height: 0, label: file.name, source: 'drop', locked: false,
        })
        addImageToCanvas(filePath)
      } else {
        addImageToCanvas(base64)
      }
    } catch {
      addImageToCanvas(URL.createObjectURL(file))
    }
  }
}

const canvasCleanups: (() => void)[] = []

/** 读取 CSS 变量获取当前主题背景色 */
function getCanvasFill(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fafaf8'
}

/** 工具栏操作 */
function canvasTool(action: string) {
  if (!app) return
  const w = app.width || canvasContainer.value?.clientWidth || 800
  const h = app.height || canvasContainer.value?.clientHeight || 600
  switch (action) {
    case 'delete':
      if (app.editor?.list?.length) {
        app.editor.list.forEach((el: any) => el.remove())
        app.editor.cancel()
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
      drawMode.value = !drawMode.value
      if (!app) break
      if (drawMode.value) {
        app.mode = 'draw'
        // 拖拽绘制：按下开始 → 创建元素 → 拖拽中调整大小
        let drawing: any = null
        const onStart = () => {
          drawing = new Arrow({ editable: true, stroke: 'var(--olive)', strokeWidth: 2, fill: 'none' })
          app!.tree.add(drawing)
        }
        const onDrag = (e: any) => {
          if (drawing) drawing.set(e.getPageBounds?.() || e.getBounds?.('page'))
        }
        const onEnd = () => { drawing = null }
        app.on_(LeaferDragEvent.START, onStart)
        app.on_(LeaferDragEvent.DRAG, onDrag)
        app.on_(LeaferDragEvent.END, onEnd)
        ;(app as any).__drawCleanups = [onStart, onDrag, onEnd]
      } else {
        app.mode = 'normal'
        const fns = (app as any).__drawCleanups
        if (fns) { fns.forEach((fn: any) => app!.off_(fn)); (app as any).__drawCleanups = null }
      }
      break
    }
    case 'zoomIn': app.zoomLayer.scale = Number(app.zoomLayer.scale || 1) * 1.3; break
    case 'zoomOut': app.zoomLayer.scale = Number(app.zoomLayer.scale || 1) / 1.3; break
  }
}

onMounted(() => {
  if (!canvasContainer.value) return

  app = new App({
    view: canvasContainer.value,
    editor: {},
    fill: getCanvasFill(),
  })

  // 全局键盘快捷键（画布可见时生效）
  const onKeyDown = (e: KeyboardEvent) => {
    if (!app) return
    const el = document.activeElement
    // 只在画布区域或没有输入框聚焦时处理
    const inCanvas = canvasContainer.value?.contains(el)
    const inInput = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || (el as HTMLElement)?.isContentEditable
    if (inInput && !inCanvas) return

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (app.editor?.list?.length) {
        e.preventDefault()
        app.editor.list.forEach((el: any) => el.remove())
        app.editor.cancel()
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      // ponytail: LeaferJS Editor undo 通过撤销最后的操作实现
      // 不使用 app.editor API，直接调 undo
      ;(app.editor as any)?.undo?.()
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
      e.preventDefault()
      ;(app.editor as any)?.redo?.()
    }
  }
  document.addEventListener('keydown', onKeyDown)
  canvasCleanups.push(() => document.removeEventListener('keydown', onKeyDown))

  // 监听主题变化 → 同步画布背景
  const observer = new MutationObserver(() => {
    if (app) (app as any).config.fill = getCanvasFill()
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  canvasCleanups.push(() => observer.disconnect())

  // 🆕 恢复上次画布状态
  restoreCanvas(canvasStore.canvasId).then(doc => {

  // 🆕 消费挂载前投递的画布图片（来自文件树/聊天等）
    if (!doc || !app) return
    canvasStore.loadCanvasDoc(doc)
    for (const layer of doc.layers) {
      addImageToCanvas(layer.path)
    }
  })

  // 🆕 消费挂载前投递的画布图片
  const pendingImage = consumeLastEvent('canvas:add-image')
  if (pendingImage) {
    const payload = pendingImage[0] as any
    console.log('[canvas] pending image on mount:', payload?.url?.slice(-40))
    if (payload?.url) addImageToCanvas(payload.url)
  }

  // 🆕 自动保存（图层变化 debounce 2s）
  let saveTimer: ReturnType<typeof setTimeout>
  const autoSave = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveCanvas(canvasStore.getCanvasDoc())
    }, 2000)
  }
  watch(() => canvasStore.layers.length, autoSave)
  canvasCleanups.push(() => clearTimeout(saveTimer))
})

onBeforeUnmount(() => {
  offCanvasSync()
  offFileTreeImage()
  canvasCleanups.forEach(fn => fn())
  if (app) {
    saveCanvas(canvasStore.getCanvasDoc())
    app.destroy()
    app = null
  }
})

// 任务/模型 popover
const openPop = ref<string>('')
function togglePop(key: string) { openPop.value = openPop.value === key ? '' : key }

function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) { addFiles(input.files); input.value = '' }
}
function onFileDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false; dragEnterCount = 0
  // 画布区域由 cp-canvas-zone 的 @drop 直接处理，这里只处理参考文件拖放
  if (!e.dataTransfer?.files.length) return
  addFiles(e.dataTransfer.files)
}

// 全局拖拽高亮
const dragOver = ref(false)
let dragEnterCount = 0
function onDragEnter(e: DragEvent) {
  e.preventDefault()
  dragEnterCount++
  if (e.dataTransfer?.types.includes('Files')) dragOver.value = true
}
function onDragLeave(e: DragEvent) {
  e.preventDefault()
  dragEnterCount--
  if (dragEnterCount <= 0) { dragOver.value = false; dragEnterCount = 0 }
}
const fileObjectUrls = ref(new Map<File, string>())
function cleanupFileObjectUrls(activeFiles: File[] = []) {
  const active = new Set(activeFiles)
  for (const [file, url] of fileObjectUrls.value.entries())
    if (!active.has(file)) { URL.revokeObjectURL(url); fileObjectUrls.value.delete(file) }
}
watch(() => [...cpState.files], files => cleanupFileObjectUrls(files), { deep: false })
onBeforeUnmount(() => cleanupFileObjectUrls())

const fileThumbs = computed(() =>
  cpState.files.map((f, i) => {
    const kind = f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'audio' : 'image'
    let url = ''
    if (f.type.startsWith('image/')) {
      url = fileObjectUrls.value.get(f) || ''
      if (!url) { url = URL.createObjectURL(f); fileObjectUrls.value.set(f, url) }
    }
    return { index: i, name: f.name, kind, url, isVideo: f.type.startsWith('video/'), isAudio: f.type.startsWith('audio/') }
  })
)

const tasks = computed(() => getVisibleCreationTasks().map(key => ({ key, label: RH_TASK_LABELS[key] })))
const modelList = computed(() => availableModels.value.map(key => ({ key, label: displayModelLabel(CREATION_PANEL_MODELS[key]?.label || key) })))

function autoGrow(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}
const clearAllFiles = () => { cpState.files.splice(0) }
const canSend = computed(() => Boolean(currentRunPlan.value) && !currentRunPlanError.value)
</script>

<template>
  <div class="cp" :class="{ 'cp-drag-over': dragOver }" data-panel="creation"
       @dragover.prevent.stop
       @dragenter.prevent.stop="onDragEnter"
       @dragleave.prevent.stop="onDragLeave"
       @drop.prevent.stop="onFileDrop">
    <div class="cp-toolbar">
      <span class="cp-title"><JcIcon name="movie_filter" /><span class="cp-title-text">创作面板</span></span>
      <span class="cp-toolbar-spacer" />
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
      <div ref="canvasContainer" class="cp-canvas-container"
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
        <button title="画图模式" :class="{ active: drawMode }" @click="canvasTool('draw')"><JcIcon name="draw" /></button>
        <button title="删除选中" @click="canvasTool('delete')"><JcIcon name="delete" /></button>
        <button title="适应窗口" @click="canvasTool('fit')"><JcIcon name="fit_screen" /></button>
        <button title="放大" @click="canvasTool('zoomIn')"><JcIcon name="zoom_in" /></button>
        <button title="缩小" @click="canvasTool('zoomOut')"><JcIcon name="zoom_out" /></button>
      </div>
    </div>
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
      <!-- 参考素材行：紧凑按钮 + 文件缩略图 -->
      <div v-if="acceptsFiles" class="cp-attach-row">
        <button class="cp-attach-btn"
                @click="($refs.fileInput as HTMLInputElement).click()"
                title="添加参考图（也可拖拽到面板）">
          <JcIcon name="attach_file" />
        </button>
        <input ref="fileInput" type="file" multiple :accept="acceptAttr"
               style="display:none" @change="onFileSelect" />
        <!-- 文件缩略图方块网格 -->
        <div v-if="fileThumbs.length" class="cp-files">
          <div v-for="f in fileThumbs" :key="f.index" class="cp-file-thumb" :title="f.name">
            <img v-if="f.url" :src="f.url" alt="" />
            <div v-else class="cp-thumb-placeholder">
              <JcIcon :name="f.isVideo ? 'videocam' : f.isAudio ? 'audio_file' : 'image'" />
              <span class="cp-thumb-label">{{ f.name }}</span>
            </div>
            <button class="cp-thumb-remove" @click="removeFile(f.index)" title="移除">
              <JcIcon name="close" />
            </button>
          </div>
          <button class="cp-clear-files" @click="clearAllFiles" title="清空全部">
            <JcIcon name="close" /> 清空
          </button>
        </div>
      </div>
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
  position: absolute; top: 6px; right: 6px; z-index: 20;
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
.cp-toolbar-more-menu {
  position: absolute; top: 100%; right: 0; margin-top: 4px;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.1);
  padding: 4px; min-width: 120px;
  display: flex; flex-direction: column; gap: 2px;
}
.cp-toolbar-more-menu button {
  width: auto; height: 28px;
  justify-content: flex-start; gap: 6px;
  font-size: 12px; padding: 0 8px; border: none;
  background: none; border-radius: 4px;
}
.cp-toolbar-more-menu button:hover {
  background: var(--olive-pale);
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
.cp-prompt-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }

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
  min-height: 48px; max-height: 200px; overflow-y: auto;
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
