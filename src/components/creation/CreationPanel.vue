<script setup lang="ts">
/**
 * CreationPanel — 创作面板
 * 用户显式选择模型，前端展示该模型参数；NewAPI 分组只在后台维护。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  RH_TASK_LABELS,
  type CreationTask,
} from '@/data/creationModels'
import {
  CREATION_PANEL_MODELS,
  cpState,
  type CreationResult,
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
  markResultDeleted,
  isResultDeleted,
  getVisibleCreationTasks,
  buildCurrentCreationParams,
} from '@/composables/useCreation'
import { displayModelLabel, getCreationModelSpec } from '@/runtime/creation/creationModelRegistry'
import { buildCreationRunPlan } from '@/runtime/creation/creationMediaPlan'

import { onEvent, emitEvent } from '@/utils/eventBus'
import { openExternal } from '@/utils/httpClient'
import { isAllowedCreationResultUrl, isAllowedDownloadUrl, isAllowedMediaAttachmentUrl } from '@/utils/urlSafety'
import { cacheCreationMediaResult, resolveCreationMediaUrl } from '@/utils/creationMediaCache'
import { CREATION_GALLERY_SOURCE, visibleCreationGalleryFiles } from '@/utils/fileEntryFilters'
import { resolveMediaDisplayUrl, type MediaDisplayResolveStatus } from '@/utils/mediaDisplayResolver'
import { extractVideoFirstFrameThumbnail } from '@/utils/mediaThumbnail'
import {
  dedupeMediaDisplayAssets,
  mediaDisplayAssetFromFileEntry,
  mediaDisplayAssetFromCreationResult,
  type MediaAssetKind,
  type MediaDisplayAsset,
} from '@/utils/mediaDisplayAsset'
import { useFileStore } from '@/composables/useFileStore'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import { useMediaAssetStore } from '@/stores/mediaAssetStore'
import type { MediaTask } from '@/stores/mediaTaskStore'
import type { MediaAssetRow } from '@/utils/idb'
import { confirmAction } from '@/utils/confirmAction'
import type { SendMediaAssetToCanvasPayload } from '@/types/mediaAsset'

// --- 新增 UI 组件 ---
import MediaViewer from '@/components/media/MediaViewer.vue'
import MediaAssetCard from '@/components/media/MediaAssetCard.vue'

const mediaTaskStore = useMediaTaskStore()
const fileStore = useFileStore()

/** P1：media_assets 行 → 画廊卡片（零 base64，displayUrl 走 jc-media:// 懒解析） */
function mediaDisplayAssetFromMediaRow(row: MediaAssetRow): MediaDisplayAsset | null {
  const kind = row.mime.startsWith('image/') ? 'image' : row.mime.startsWith('video/') ? 'video' : row.mime.startsWith('audio/') ? 'audio' : row.mime.startsWith('text/') ? 'text' : null
  if (!kind) return null
  return {
    id: row.id,
    kind,
    name: row.logicalPath.split('/').pop()?.replace(/\.[^.]+$/, '') || kind,
    mimeType: row.mime,
    displayUrl: kind === 'text' ? '' : `jc-media://${row.id}`,
    originalUrl: row.sourceUrl ?? undefined,
    fileId: row.id,
    prompt: undefined,
    model: undefined,
    taskId: row.sourceId ?? undefined,
    createdAt: row.createdAt,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    status: 'ready',
  }
}

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

type GalleryFilter = 'all' | 'image' | 'video' | 'audio' | 'text' | 'failed'

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

function channelLabelForModel(model?: string): string {
  if (!model) return rhChannelLabel.value
  try {
    const spec = getCreationModelSpec(model)
    if (!spec) return rhChannelLabel.value
    if (spec.source === 'newapi-direct') return 'NewAPI 直连'
    return spec.apiStyle === 'rh-aiapp' ? 'RH 工作流' : 'RH 官方 API'
  } catch {
    if (model.startsWith('rh-')) return 'RH 官方 API'
    return rhChannelLabel.value
  }
}

function resultMetaLine(model?: string, kind?: string): string {
  const modelLabel = displayModelLabel(model || currentModel.value?.label || '创作结果')
  const channel = channelLabelForModel(model)
  const aspect = cpState.ar || 'auto'
  const resolution = cpState.res || cpState.size || 'auto'
  return `${modelLabel} · ${channel} · ${kind || cpState.task} · ${aspect} · ${resolution}`
}

onMounted(async () => {
  await mediaTaskStore.init().catch(() => {})
  await refreshMediaLibraryAssets().catch(() => {})
  refreshCreationModelAvailability().catch(() => {})
  reconcileCreationTasksToGallery()
  // ★ 启动后触发所有已有结果的懒解析（resolvedGalleryAssets 不持久化）
  for (let i = 0; i < cpState.results.length; i++) {
    ensureGalleryResultResolved(i, cpState.results[i]).catch(() => {})
  }
  // ★ 调试：暴露画廊状态到全局
  ;(window as any).__jc_gallery = {
    get results() { return cpState.results.map((r, i) => ({ i, url: r.url?.slice(0,50), originalUrl: r.originalUrl?.slice(0,60), type: r.type, taskId: r.taskId })) },
    get resolved() { return { ...resolvedGalleryAssets.value } },
    get displayUrls() { return cpState.results.map((r, i) => displayUrl(i, r.url)?.slice(0,60)) },
  }
})

function addFailureCard(params: {
  message: string
  model?: string
  task?: string
  content?: string
  taskId?: string
}) {
  cpState.results.unshift({
    url: '',
    type: 'failed',
    content: params.content || '',
    errorMsg: params.message || '请重试',
    model: params.model || currentModel.value?.label || currentModel.value?.modelName || 'unknown',
    task: params.task || currentModel.value?.capability.task || cpState.task || 'unknown',
    ts: Date.now(),
    taskId: params.taskId,
  })
  saveCpState()
}

function hasGalleryRecordForTask(task: MediaTask): boolean {
  return cpState.results.some(result => {
    if (result.taskId === task.id) return true
    if (task.resultUrl && (result.originalUrl === task.resultUrl || result.url === task.resultUrl)) return true
    if (result.model !== task.modelLabel && result.model !== task.model) return false
    if (result.content !== task.prompt && result.errorMsg !== task.errorMsg) return false
    return Math.abs(result.ts - (task.completedAt || task.createdAt)) < 60_000
  })
}

function upsertCreationResultFromTask(task: MediaTask, url: string): CreationResult {
  const existingIndex = cpState.results.findIndex(result => {
    if (result.taskId === task.id) return true
    return Boolean(task.resultUrl && (result.originalUrl === task.resultUrl || result.url === task.resultUrl))
  })
  const next: CreationResult = {
    url,
    type: task.type,
    content: task.prompt || '',
    model: task.modelLabel || task.model || 'unknown',
    task: task.type,
    ts: task.completedAt || Date.now(),
    taskId: task.id,
    originalUrl: task.resultUrl || url,
  }
  if (existingIndex >= 0) {
    cpState.results[existingIndex] = {
      ...cpState.results[existingIndex],
      ...next,
      errorMsg: cpState.results[existingIndex].errorMsg,
    }
    return cpState.results[existingIndex]
  }
  cpState.results.unshift(next)
  return next
}

async function addSettledCreationTaskToGallery(task: MediaTask) {
  if (isResultDeleted(task.id, task.resultUrl)) return
  if (hasGalleryRecordForTask(task)) return
  if (task.status === 'success' && task.type !== 'text' && task.resultUrl && isAllowedCreationResultUrl(task.resultUrl)) {
    const result = upsertCreationResultFromTask(task, task.resultUrl)
    saveCpState()
    try {
      const cached = await cacheCreationMediaResult({
        url: task.resultUrl,
        type: task.type,
        prompt: task.prompt,
        model: task.modelLabel || task.model,
        taskId: task.id,
        metadataKind: 'creation-result',
      })
      if (!cached?.ref) throw new Error('媒体缓存未返回本地引用')
      result.url = cached.ref
      result.originalUrl = task.resultUrl
      result.errorMsg = ''
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e || '本地缓存失败')
      result.errorMsg = `本地缓存失败，已用远程地址临时展示: ${message}`
    }
    saveCpState()
    refreshMediaLibraryAssets().catch(() => {})
    return
  }
  if (task.status === 'success' && task.type === 'text' && task.resultText) {
    cpState.results.unshift({
      url: '',
      type: 'text',
      content: task.resultText,
      model: task.modelLabel || task.model || 'unknown',
      task: task.type,
      ts: task.completedAt || Date.now(),
      taskId: task.id,
    })
    saveCpState()
    return
  }
  if (task.status === 'failed') {
    addFailureCard({
      message: task.errorMsg || '请重试',
      model: task.modelLabel || task.model || 'unknown',
      task: task.type,
      content: task.prompt || '',
      taskId: task.id,
    })
  }
}

function reconcileCreationTasksToGallery() {
  const settled = mediaTaskStore.tasks
    .filter(task => task.source === 'creation' && (task.status === 'success' || task.status === 'failed'))
    .filter(task => !isResultDeleted(task.id, task.resultUrl))
    .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt))
  for (const task of settled) {
    void addSettledCreationTaskToGallery(task)
  }
}

watch(creationRunningCount, count => {
  cpState.runningTasks = count
  cpState.generating = count > 0
  if (count > 0) cpState.progressText = creationProgressText.value
}, { immediate: true })

// ─── 新版生成入口：走 mediaTaskStore 统一调度 ───
async function runCreationViaTaskStore() {
  try {
  console.log('[Creation] runCreationViaTaskStore called')
  const m = currentModel.value
  if (!m) {
    cpState.progressText = '请先选择模型'
    addFailureCard({ message: '请先选择模型', task: cpState.task })
    console.log('[Creation] no model')
    return
  }
  if (currentModelAvailability.value?.status === 'disabled') {
    const message = currentModelAvailability.value.reason || '该模型暂时不可用，请重新选择模型'
    cpState.progressText = message
    addFailureCard({
      message,
      model: m.label || m.modelName,
      task: m.capability.task,
      content: cpState.prompt || cpState.text || message,
    })
    return
  }
  const task = m.capability.task

  const modelDef = m
  const runPlanError = currentRunPlanError.value
  if (runPlanError || !currentRunPlan.value) {
    const message = runPlanError || '请补充生成参数'
    cpState.progressText = message
    addFailureCard({
      message,
      model: modelDef.label || modelDef.modelName,
      task: task,
      content: cpState.prompt || cpState.text || cpState.voicePrompt || message,
    })
    return
  }
  const mediaType = modelDef.modelName === 'rh-suno-lyrics' ? 'text' as const
    : task === 'image' ? 'image' as const
      : task === 'audio' ? 'audio' as const : 'video' as const

  // 快照参数
  const refImages: string[] = []
  const refVideos: string[] = []
  const refAudios: string[] = []
  let firstImage = ''
  let firstVideo = ''
  let firstAudio = ''
  for (const f of cpState.files) {
    const dataUrl = await fileToDataUrl(f)
    if (f.type.startsWith('image/')) {
      refImages.push(dataUrl)
      if (!firstImage) firstImage = dataUrl
    } else if (f.type.startsWith('video/')) {
      refVideos.push(dataUrl)
      if (!firstVideo) firstVideo = dataUrl
    } else if (f.type.startsWith('audio/')) {
      refAudios.push(dataUrl)
      if (!firstAudio) firstAudio = dataUrl
    }
  }

  const submitPlan = buildCreationRunPlan({
    modelId: currentCreationSpec.value?.id || cpState.modelKey,
    params: buildCurrentCreationParams({
      images: refImages,
      videos: refVideos,
      audios: refAudios,
    }),
  })

  cpState.generating = true
  cpState.progressText = '提交中...'
  console.log('[Creation] submitting to mediaTaskStore, model=', modelDef.modelName)

  try {
    await mediaTaskStore.submitTask({
      type: mediaType,
      model: modelDef.modelName,
      modelLabel: modelDef.label,
      prompt: cpState.prompt,
      referenceImages: refImages,
      source: 'creation',
      imageParams: mediaType === 'image' ? {
        model: modelDef.modelName,
        prompt: cpState.prompt,
        size: cpState.size !== 'auto' ? cpState.size : undefined,
        aspectRatio: cpState.ar || '1:1',
        resolution: cpState.res || '1k',
        image: refImages.length > 1 ? refImages : refImages[0],
        responseFormat: 'url',
      } : undefined,
      videoParams: mediaType === 'video' ? {
        model: modelDef.modelName,
        prompt: cpState.prompt,
        aspectRatio: cpState.ar || '16:9',
        resolution: cpState.res,
        duration: cpState.dur,
        imageUrl: firstImage || refImages[0],
        imageUrls: refImages.length > 1 ? refImages : undefined,
        videoUrl: firstVideo,
        audioUrl: firstAudio,
        text: cpState.text,
        width: cpState.width,
        height: cpState.height,
        value: cpState.value,
      } : undefined,
      audioParams: mediaType === 'audio' ? {
        title: cpState.title,
        tags: cpState.tags,
        negativeTags: cpState.negativeTags,
        mv: cpState.mv,
        audioUrl: firstAudio,
        startTime: cpState.startTime,
        endTime: cpState.endTime,
        refText: cpState.refText,
        text: cpState.text,
        language: cpState.language,
        voicePrompt: cpState.voicePrompt,
      } : undefined,
      plan: submitPlan,
    })
    console.log('[Creation] submitTask returned OK')
  } catch (e: any) {
    cpState.generating = creationRunningCount.value > 0
    const message = `提交失败: ${(e.message || e).toString().slice(0, 100)}`
    cpState.progressText = message
    addFailureCard({
      message,
      model: modelDef.label || modelDef.modelName,
      task: mediaType,
      content: cpState.prompt || cpState.text || cpState.voicePrompt || message,
    })
  }
  } catch (outerErr: any) {
    console.error('[Creation] FATAL:', outerErr)
    const message = `❌ 错误: ${(outerErr.message || String(outerErr)).slice(0, 100)}`
    cpState.progressText = message
    addFailureCard({ message, task: cpState.task })
  }
}

// 监听任务完成/失败事件，同步到旧版画廊和任务计数
const offTaskSettled = onEvent('media-task-settled', async (payload: any) => {
  if (payload.source === 'creation') {
    const task = mediaTaskStore.getTask(payload.taskId)
    if (task) {
      await addSettledCreationTaskToGallery(task)
    }
    const runningCount = creationRunningCount.value
    cpState.runningTasks = runningCount
    cpState.generating = runningCount > 0
    if (!cpState.generating) {
      const errMsg = payload.status === 'failed' ? `❌ 生成失败: ${payload.errorMsg || '请重试'}` : ''
      cpState.progressText = errMsg
      cpState.progress = 0
      // 失败消息保持 10 秒后自动消失
      if (errMsg) {
        setTimeout(() => {
          if (cpState.progressText === errMsg) cpState.progressText = ''
        }, 10000)
      }
    } else if (payload.status === 'failed') {
      cpState.progressText = `❌ 生成失败: ${payload.errorMsg || '请重试'}`
    } else {
      cpState.progressText = creationProgressText.value
    }
  }
})
onBeforeUnmount(offTaskSettled)

/** 图片/视频→dataURL：直接 FileReader（可靠不卡顿） */
function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(f)
  })
}

// 任务/模型 popover (原有逻辑不变)
const openPop = ref<string>('')
function togglePop(key: string) {
  openPop.value = openPop.value === key ? '' : key
}

function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files) { addFiles(input.files); input.value = '' }
}

function onFileDrop(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer?.files) addFiles(e.dataTransfer.files)
}

const fileObjectUrls = ref(new Map<File, string>())

function cleanupFileObjectUrls(activeFiles: File[] = []) {
  const active = new Set(activeFiles)
  for (const [file, url] of fileObjectUrls.value.entries()) {
    if (!active.has(file)) {
      URL.revokeObjectURL(url)
      fileObjectUrls.value.delete(file)
    }
  }
}

watch(() => [...cpState.files], files => cleanupFileObjectUrls(files), { deep: false })
onBeforeUnmount(() => cleanupFileObjectUrls())

const fileThumbs = computed(() =>
  cpState.files.map((f, i) => {
    const kind = f.type.startsWith('video/') ? 'video'
      : f.type.startsWith('audio/') ? 'audio' : 'image'
    let url = ''
    if (f.type.startsWith('image/')) {
      url = fileObjectUrls.value.get(f) || ''
      if (!url) {
        url = URL.createObjectURL(f)
        fileObjectUrls.value.set(f, url)
      }
    }
    return {
      index: i,
      name: f.name,
      kind,
      url,
      isVideo: f.type.startsWith('video/'),
      isAudio: f.type.startsWith('audio/'),
    }
  })
)

type MediaSlotKind = 'image' | 'images' | 'video' | 'audio'
type ConcreteMediaKind = 'image' | 'video' | 'audio'

const mediaSlots = computed(() => {
  const fields = currentModel.value?.capability.fields || []
  return fields
    .filter(field => ['image', 'images', 'video', 'audio'].includes(field.kind))
    .map(field => {
      const kind = field.kind as MediaSlotKind
      const concreteKind = kind === 'images' ? 'image' : kind
      const files = fileThumbs.value.filter(file => file.kind === concreteKind)
      return {
        key: field.key,
        label: field.label,
        required: Boolean(field.required),
        kind,
        concreteKind,
        files: kind === 'images' ? files : files.slice(0, 1),
      }
    })
})

const activeSlotKind = ref<MediaSlotKind>('images')
const slotFileInput = ref<HTMLInputElement | null>(null)
const activeSlotAccept = computed(() => {
  const kind = activeSlotKind.value === 'images' ? 'image' : activeSlotKind.value
  return `${kind}/*`
})
const activeSlotMultiple = computed(() => activeSlotKind.value === 'images')

function openMediaSlot(kind: MediaSlotKind) {
  activeSlotKind.value = kind
  nextTick(() => slotFileInput.value?.click())
}

function onSlotFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files?.length) return
  if (activeSlotKind.value === 'images') {
    addFiles(files)
  } else {
    replaceFilesForMediaKind(activeSlotKind.value as ConcreteMediaKind, files)
  }
  input.value = ''
}

const tasks = computed(() =>
  getVisibleCreationTasks().map(key => ({ key, label: RH_TASK_LABELS[key] }))
)

const modelList = computed(() =>
  availableModels.value.map(key => ({ key, label: CREATION_PANEL_MODELS[key]?.label || key }))
)

// --- 新增：画廊尺寸切换 ---
const gallerySize = ref(localStorage.getItem('jc_gallery_size') || 'medium')
function onSizeChange(size: string) {
  gallerySize.value = size
  localStorage.setItem('jc_gallery_size', size)
}

const activeFilter = ref<GalleryFilter>('all')
type MediaLibraryFilter = 'all' | MediaAssetKind
const mediaLibraryFilter = ref<MediaLibraryFilter>('all')
const mediaLibrarySearch = ref('')
const mediaLibraryAssets = ref<MediaDisplayAsset[]>([])
const expiryBannerDismissed = ref(false)
const hasRemoteAssets = computed(() =>
  mediaLibraryAssets.value.some(a => !!(a.originalUrl && /^https?:\/\//.test(a.originalUrl)))
)
const mediaImportInput = ref<HTMLInputElement | null>(null)
const MEDIA_LIBRARY_PAGE_SIZE = 36
const mediaLibraryLimit = ref(MEDIA_LIBRARY_PAGE_SIZE)
const videoThumbnailJobs = new Set<string>()
const galleryLimit = ref(30)
const selectMode = ref(false)
const selectedKeys = ref<Set<string>>(new Set())
const ctxMenu = reactive({ show: false, x: 0, y: 0, key: '' })

interface ResolvedGalleryAsset {
  displayUrl: string
  status: MediaDisplayResolveStatus
  errorMsg?: string
}

const resolvedGalleryAssets = ref<Record<string, ResolvedGalleryAsset>>({})
const resolvingGalleryKeys = new Set<string>()

function resultKey(result: CreationResult): string {
  if (result.taskId) return `task:${result.taskId}`
  if (result.originalUrl) return `url:${result.originalUrl}`
  if (result.url) return `url:${result.url}`
  return `local:${result.ts}:${result.type}:${result.model}:${result.content || result.errorMsg || ''}`
}

function resultIndexByKey(key: string): number {
  return cpState.results.findIndex(result => resultKey(result) === key)
}

const filterTabs = computed(() => {
  const count = (type: GalleryFilter) =>
    type === 'all' ? cpState.results.length : cpState.results.filter(r => r.type === type).length
  return [
    { key: 'all' as const, label: '全部', count: count('all') },
    { key: 'image' as const, label: '图片', count: count('image') },
    { key: 'video' as const, label: '视频', count: count('video') },
    { key: 'audio' as const, label: '音频', count: count('audio') },
    { key: 'text' as const, label: '文本', count: count('text') },
    { key: 'failed' as const, label: '失败', count: count('failed') },
  ]
})

const filteredResults = computed(() =>
  cpState.results
    .map((result, index) => ({ result, index, key: resultKey(result) }))
    .filter(item => activeFilter.value === 'all' || item.result.type === activeFilter.value)
)

const displayResults = computed(() => filteredResults.value.slice(0, galleryLimit.value))

const mediaLibraryTabs = computed(() => {
  const count = (filter: MediaLibraryFilter) =>
    filter === 'all'
      ? combinedMediaLibraryAssets.value.length
      : combinedMediaLibraryAssets.value.filter(asset => asset.kind === filter).length
  return [
    { key: 'all' as const, label: '全部媒体', count: count('all') },
    { key: 'image' as const, label: '图片', count: count('image') },
    { key: 'video' as const, label: '视频', count: count('video') },
    { key: 'audio' as const, label: '音频', count: count('audio') },
    { key: 'text' as const, label: '文本', count: count('text') },
  ]
})

const filteredMediaLibraryAssets = computed(() => {
  const keyword = mediaLibrarySearch.value.trim().toLowerCase()
  return combinedMediaLibraryAssets.value
    .filter(asset => mediaLibraryFilter.value === 'all' || asset.kind === mediaLibraryFilter.value)
    .filter(asset => {
      if (!keyword) return true
      return [
        asset.name,
        asset.prompt,
        asset.model,
        asset.mimeType,
      ].some(value => String(value || '').toLowerCase().includes(keyword))
    })
})

const creationResultMediaAssets = computed(() => {
  return cpState.results
    .map((result, index) => {
      const status = galleryResolveStatus(index)
      const asset = mediaDisplayAssetFromCreationResult({
        result,
        id: `creation:${resultKey(result)}`,
        displayUrl: displayUrl(index, result.url),
        status: status === 'ready' ? 'ready' : status === 'failed' ? 'failed' : 'loading',
        errorMsg: galleryResolveError(index) || result.errorMsg,
      })
      return asset
    })
    .filter((asset): asset is MediaDisplayAsset => Boolean(asset))
})

const creationTaskMediaAssets = computed<MediaDisplayAsset[]>(() => {
  return mediaTaskStore.tasks
    .filter(task =>
      task.source === 'creation'
      && task.status === 'success'
      && Boolean(task.resultUrl || task.resultText)
      && !isResultDeleted(task.id, task.resultUrl || task.resultText || task.id)
      && isAllowedCreationResultUrl(task.resultUrl || task.resultText || task.id)
    )
    .map((task): MediaDisplayAsset => ({
      id: `task:${task.id}`,
      kind: task.type as MediaAssetKind,
      name: task.prompt?.trim().slice(0, 36) || task.modelLabel || task.model || task.type,
      mimeType: undefined,
      displayUrl: task.assetUri || task.resultUrl || '',
      originalUrl: task.resultUrl,
      prompt: task.prompt,
      model: task.modelLabel || task.model,
      taskId: task.id,
      createdAt: task.completedAt || task.createdAt,
      status: 'ready' as const,
      content: task.type === 'text' ? task.resultText : undefined,
    }))
})

const combinedMediaLibraryAssets = computed(() => {
  return dedupeMediaDisplayAssets([
    ...creationResultMediaAssets.value,
    ...creationTaskMediaAssets.value,
    ...mediaLibraryAssets.value,
  ])
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
})

const visibleMediaLibraryAssets = computed(() =>
  filteredMediaLibraryAssets.value.slice(0, mediaLibraryLimit.value)
)

const hasMoreMediaLibraryAssets = computed(() =>
  visibleMediaLibraryAssets.value.length < filteredMediaLibraryAssets.value.length
)

async function refreshMediaLibraryAssets() {
  // P1：优先 media_assets 索引（200B/行），空则降级 documents 表
  try {
    const store = useMediaAssetStore()
    await store.loadCreationAll()
    if (store.assets.length > 0) {
      mediaLibraryAssets.value = store.assets
        .map(row => mediaDisplayAssetFromMediaRow(row))
        .filter((asset): asset is MediaDisplayAsset => Boolean(asset))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      return
    }
  } catch { /* 降级 */ }
  // 降级：media_assets 为空或出错，用 documents 表（兼容旧数据）
  const mediaEntries = (await Promise.all([
    fileStore.loadByCategory('image'),
    fileStore.loadByCategory('video'),
    fileStore.loadByCategory('audio'),
    fileStore.loadByCategory('text'),
  ])).flat()
  mediaLibraryAssets.value = visibleCreationGalleryFiles(mediaEntries)
    .map(mediaDisplayAssetFromFileEntry)
    .filter((asset): asset is MediaDisplayAsset => Boolean(asset))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

watch([mediaLibraryFilter, mediaLibrarySearch], () => {
  mediaLibraryLimit.value = MEDIA_LIBRARY_PAGE_SIZE
})

function loadMoreMediaAssets() {
  mediaLibraryLimit.value = Math.min(
    mediaLibraryLimit.value + MEDIA_LIBRARY_PAGE_SIZE,
    filteredMediaLibraryAssets.value.length,
  )
}

async function ensureVideoThumbnail(asset: MediaDisplayAsset) {
  // TODO: 缩略图未持久化到 media_assets（重启后需重新生成），后续加 thumbnailDataUrl 列
  if (asset.kind !== 'video' || !asset.displayUrl || asset.thumbnailUrl || asset.thumbnailFailedAt) return
  const assetId = asset.id.replace(/^task:/, '')
  if (videoThumbnailJobs.has(assetId)) return
  videoThumbnailJobs.add(assetId)
  try {
    // V1: jc-media:// 必须先 resolve 为 asset:// URL，video 元素才能加载
    const { resolveJcMediaUrl } = await import('@/utils/mediaFileReader')
    const resolvedUrl = await resolveJcMediaUrl(asset.displayUrl)
    if (!resolvedUrl) { videoThumbnailJobs.delete(assetId); return }
    const thumb = await extractVideoFirstFrameThumbnail(resolvedUrl)
    mediaLibraryAssets.value = mediaLibraryAssets.value.map(item =>
      item.id === asset.id
        ? { ...item, thumbnailUrl: thumb.thumbnailUrl, duration: thumb.duration, width: thumb.width, height: thumb.height }
        : item
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '视频首帧生成失败')
    mediaLibraryAssets.value = mediaLibraryAssets.value.map(item =>
      item.id === asset.id
        ? { ...item, thumbnailFailedAt: Date.now(), thumbnailError: message }
        : item
    )
  } finally {
    videoThumbnailJobs.delete(assetId)
  }
}

watch(
  visibleMediaLibraryAssets,
  assets => {
    const candidates = assets
      .filter(asset => asset.kind === 'video' && !asset.thumbnailUrl && !asset.thumbnailFailedAt && !videoThumbnailJobs.has(asset.id.replace(/^task:/, '')))
      .slice(0, 6)
    for (const asset of candidates) {
      void ensureVideoThumbnail(asset)
    }
  },
  { immediate: true },
)

function onGalleryScroll(e: Event) {
  const el = e.target as HTMLElement
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
    galleryLimit.value = Math.min(galleryLimit.value + 30, filteredResults.value.length)
  }
}

watch(activeFilter, () => {
  galleryLimit.value = 30
  selectedKeys.value = new Set()
  selectMode.value = false
})

function isSelected(key: string) {
  return selectedKeys.value.has(key)
}

function toggleSelect(key: string) {
  const next = new Set(selectedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedKeys.value = next
}

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  selectedKeys.value = new Set()
}

function selectAllVisible() {
  selectedKeys.value = new Set(displayResults.value.map(item => item.key))
}

async function batchDownload() {
  for (const key of selectedKeys.value) {
    const index = resultIndexByKey(key)
    if (index >= 0) await downloadResult(index)
  }
  selectedKeys.value = new Set()
  selectMode.value = false
}

function batchDelete() {
  const indices = [...selectedKeys.value]
    .map(resultIndexByKey)
    .filter(index => index >= 0)
    .sort((a, b) => b - a)
  for (const index of indices) deleteResult(index)
  selectedKeys.value = new Set()
  selectMode.value = false
}

function hideContextMenu() {
  ctxMenu.show = false
}

function onCardContextMenu(index: number, e: MouseEvent) {
  const result = cpState.results[index]
  if (!result) return
  ctxMenu.show = true
  ctxMenu.x = Math.min(e.clientX, window.innerWidth - 180)
  ctxMenu.y = Math.min(e.clientY, window.innerHeight - 220)
  ctxMenu.key = resultKey(result)
}

onMounted(() => document.addEventListener('click', hideContextMenu))
onBeforeUnmount(() => document.removeEventListener('click', hideContextMenu))

// --- 新增：灯箱状态 ---
const lbShow = ref(false)
const lbKey = ref('')
const lbIndex = computed(() => resultIndexByKey(lbKey.value))
const lbResult = computed(() => {
  const r = cpState.results[lbIndex.value]
  return r || {
    url: '',
    type: 'image',
    content: '',
    model: '',
    task: 'image',
    ts: 0,
  } satisfies CreationResult
})
const lbPosition = computed(() => filteredResults.value.findIndex(item => item.index === lbIndex.value))
const lbTotal = computed(() => filteredResults.value.length)
const lbMediaAsset = computed<MediaDisplayAsset>(() => ({
  id: resultKey(lbResult.value as CreationResult),
  kind: lbResult.value.type === 'video' ? 'video' : lbResult.value.type === 'audio' ? 'audio' : 'image',
  name: lbResult.value.content || lbResult.value.model || 'creation',
  displayUrl: displayUrl(lbIndex.value, lbResult.value.url),
  originalUrl: lbResult.value.originalUrl,
}))

async function resolveGalleryUrl(index: number, url: string): Promise<string> {
  if (!url) return ''
  const result = cpState.results[index]
  if (!result) return url.startsWith('jc-media:') ? '' : url
  const key = resultKey(result)
  const cached = resolvedGalleryAssets.value[key]
  if (cached?.displayUrl) return cached.displayUrl
  await ensureGalleryResultResolved(index, result)
  const resolved = resolvedGalleryAssets.value[key]?.displayUrl || (url.startsWith('jc-media:') ? '' : url)
  console.log('[resolveGalleryUrl] index=', index, 'rawUrl=', url.slice(0, 40), 'resolved=', resolved.slice(0, 60), 'status=', resolvedGalleryAssets.value[key]?.status, 'error=', resolvedGalleryAssets.value[key]?.errorMsg)
  return resolved
}

async function ensureGalleryResultResolved(index: number, result: CreationResult) {
  const key = resultKey(result)
  if (!result.url) {
    if (result.type === 'failed') return
    resolvedGalleryAssets.value = {
      ...resolvedGalleryAssets.value,
      [key]: { displayUrl: '', status: 'failed', errorMsg: '媒体地址为空' },
    }
    return
  }
  if (resolvingGalleryKeys.has(key)) return
  const current = resolvedGalleryAssets.value[key]
  if (current?.status === 'ready' && current.displayUrl) return

  resolvingGalleryKeys.add(key)
  resolvedGalleryAssets.value = {
    ...resolvedGalleryAssets.value,
    [key]: { displayUrl: current?.displayUrl || '', status: 'loading' },
  }

  const resolved = await resolveMediaDisplayUrl(result.url, resolveCreationMediaUrl)
  resolvingGalleryKeys.delete(key)
  const latestIndex = resultIndexByKey(key)
  if (latestIndex < 0) {
    const next = { ...resolvedGalleryAssets.value }
    delete next[key]
    resolvedGalleryAssets.value = next
    return
  }
  resolvedGalleryAssets.value = {
    ...resolvedGalleryAssets.value,
    [key]: resolved,
  }
}

function displayUrl(index: number, url: string): string {
  if (!url) return ''
  const result = cpState.results[index]
  if (!result) return url.startsWith('jc-media:') ? '' : url
  return resolvedGalleryAssets.value[resultKey(result)]?.displayUrl || (url.startsWith('jc-media:') ? '' : url)
}

function galleryResolveStatus(index: number): MediaDisplayResolveStatus {
  const result = cpState.results[index]
  if (!result || result.type === 'failed') return 'failed'
  return resolvedGalleryAssets.value[resultKey(result)]?.status || (result.url ? 'loading' : 'failed')
}

function galleryResolveError(index: number): string {
  const result = cpState.results[index]
  if (!result) return ''
  return resolvedGalleryAssets.value[resultKey(result)]?.errorMsg || ''
}

watch(
  () => cpState.results.map((result, index) => `${index}:${resultKey(result)}:${result.url}`).join('\n'),
  () => {
    const activeKeys = new Set(cpState.results.map(resultKey))
    const next = { ...resolvedGalleryAssets.value }
    for (const key of Object.keys(next)) {
      if (!activeKeys.has(key)) delete next[key]
    }
    resolvedGalleryAssets.value = next
    cpState.results.forEach((result, index) => {
      if (result.type !== 'failed') void ensureGalleryResultResolved(index, result)
    })
  },
  { immediate: true },
)

function openLightbox(index: number) {
  const result = cpState.results[index]
  if (!result) return
  lbKey.value = resultKey(result)
  lbShow.value = true
  hideContextMenu()
}
function closeLightbox() {
  lbShow.value = false
}

function lbPrev() {
  if (!filteredResults.value.length) return
  const pos = lbPosition.value >= 0 ? lbPosition.value : 0
  const nextPos = pos > 0 ? pos - 1 : filteredResults.value.length - 1
  lbKey.value = filteredResults.value[nextPos].key
}

function lbNext() {
  if (!filteredResults.value.length) return
  const pos = lbPosition.value >= 0 ? lbPosition.value : 0
  const nextPos = pos < filteredResults.value.length - 1 ? pos + 1 : 0
  lbKey.value = filteredResults.value[nextPos].key
}

/** 强制另存为（fetch → blob → objectURL + a.download） */
async function downloadResult(index: number) {
  const r = cpState.results[index]
  if (!r || !r.url) return
  const resolvedUrl = await resolveGalleryUrl(index, r.url)
  if (!isDownloadableDisplayUrl(resolvedUrl)) {
    cpState.progressText = '下载地址不安全，已阻止'
    return
  }
  const kind = r.type === 'video' ? 'video' : r.type === 'audio' ? 'audio' : 'image'
  await downloadDisplayUrl(resolvedUrl, kind, 'creation')
}

/** 引用：将画廊素材添加到输入框参考文件中 */
async function referenceResult(index: number) {
  const r = cpState.results[index]
  if (!r || !r.url) return
  const resolvedUrl = await resolveGalleryUrl(index, r.url)
  if (!isAllowedMediaAttachmentUrl(resolvedUrl)) {
    cpState.progressText = '引用失败: 素材地址不安全'
    return
  }
  try {
    const res = await fetch(resolvedUrl)
    const blob = await res.blob()
    const ext = r.type === 'video' ? 'mp4' : r.type === 'audio' ? 'mp3' : 'png'
    const mime = r.type === 'video' ? 'video/mp4' : r.type === 'audio' ? 'audio/mpeg' : 'image/png'
    const file = new File([blob], `ref_${Date.now()}.${ext}`, { type: mime })
    addFiles([file])
  } catch (e: any) {
    cpState.progressText = '引用失败: ' + (e.message || e)
  }
}

function deleteResult(index: number) {
  const taskId = cpState.results[index]?.taskId
  const result = cpState.results[index]
  if (!result) return
  markResultDeleted(result)
  cpState.results.splice(index, 1)
  if (taskId) mediaTaskStore.deleteTask(taskId)
  const nextSelected = new Set(selectedKeys.value)
  nextSelected.delete(resultKey(result))
  selectedKeys.value = nextSelected
  if (lbIndex.value === index) closeLightbox()
  hideContextMenu()
  saveCpState()
}

function retryResult(index: number) {
  const r = cpState.results[index]
  if (!r) return
  if (r.task === 'image' || r.task === 'video' || r.task === 'audio') {
    switchTask(r.task as CreationTask)
  }
  const prompt = r.type === 'failed' ? (r.content || '') : ''
  if (prompt) cpState.prompt = prompt
  deleteResult(index)
  saveCpState()
}

function lbDownload() {
  downloadResult(lbIndex.value)
}

const assetViewerShow = ref(false)
const assetViewerAsset = ref<MediaDisplayAsset | null>(null)

function openAssetViewer(asset: MediaDisplayAsset) {
  assetViewerAsset.value = asset
  assetViewerShow.value = true
  hideContextMenu()
}

function closeAssetViewer() {
  assetViewerShow.value = false
}

function isDownloadableDisplayUrl(url: string): boolean {
  return /^data:(image|video|audio)\//i.test(url) || isAllowedDownloadUrl(url)
}

function extForAsset(kind: MediaAssetKind): string {
  return kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : kind === 'text' ? 'txt' : 'png'
}

async function downloadDisplayUrl(url: string, kind: MediaAssetKind, filenamePrefix = 'media') {
  if (!isDownloadableDisplayUrl(url)) {
    cpState.progressText = '下载地址不安全，已阻止'
    return
  }
  // 桌面：使用 http_download_base64 → writeMediaAsset → data/media/creation/（与自动落地同通道）
  const { isTauriRuntime: tauri } = await import('@/utils/tauriEnv')
  if (tauri() && /^https?:\/\//i.test(url)) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const dl = await invoke<{ status: number; data_base64: string; headers?: Record<string, string> }>('http_download_base64', {
        request: { url, timeout_secs: 120 },
      })
      if (dl.status >= 200 && dl.status < 300 && dl.data_base64) {
        const contentType = (dl.headers?.['content-type'] || dl.headers?.['Content-Type'] || '').split(';')[0].trim() || 'image/png'
        const { writeMediaAsset } = await import('@/utils/mediaFileWriter')
        await writeMediaAsset({
          source: 'creation',
          data: `data:${contentType};base64,${dl.data_base64}`,
          name: filenamePrefix,
        })
        console.log('[JC] 手动下载已保存到 data/media/creation/')
        return
      }
    } catch (e) { console.warn('[JC] 手动下载落地失败，回退浏览器下载:', e) }
  }
  // Web 端 / 桌面回退：浏览器下载
  const filename = `${filenamePrefix}_${Date.now()}.${extForAsset(kind)}`
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) throw new Error('fetch failed')
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
  } catch {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.target = '_blank'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
}

async function downloadMediaAsset(asset: MediaDisplayAsset) {
  let url = asset.displayUrl
  if (!url) return
  // ★ 解析 jc-media:// 引用（MediaAssetCard 内部 resolvedSrc 已解析但未传出）
  if (url.startsWith('jc-media:')) {
    const { resolveJcMediaUrl } = await import('@/utils/mediaFileReader')
    url = await resolveJcMediaUrl(url)
    if (!url) return
  }
  await downloadDisplayUrl(url, asset.kind, 'asset')
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

async function copyMediaAssetUrl(asset: MediaDisplayAsset) {
  const url = asset.originalUrl
  if (!url) {
    cpState.progressText = '该资产没有可分享的源 URL，请使用下载保存到本地'
    return
  }
  try {
    await copyText(url)
    cpState.progressText = '已复制响应URL'
  } catch (e: any) {
    cpState.progressText = '复制URL失败: ' + (e.message || e)
  }
}

async function referenceMediaAsset(asset: MediaDisplayAsset) {
  if (!asset.displayUrl) return
  if (!isAllowedMediaAttachmentUrl(asset.displayUrl)) {
    cpState.progressText = '引用失败: 素材地址不安全'
    return
  }
  try {
    const res = await fetch(asset.displayUrl)
    const blob = await res.blob()
    const file = new File([blob], asset.name || `ref_${Date.now()}.${extForAsset(asset.kind)}`, {
      type: asset.mimeType || `${asset.kind}/${extForAsset(asset.kind)}`,
    })
    addFiles([file])
  } catch (e: any) {
    cpState.progressText = '引用失败: ' + (e.message || e)
  }
}

function taskFromAssetKind(kind: MediaAssetKind): CreationTask {
  return kind === 'audio' ? 'audio' : kind === 'video' ? 'video' : 'image'
}

function regenerateFromPrompt(kind: MediaAssetKind, prompt?: string) {
  switchTask(taskFromAssetKind(kind))
  if (prompt?.trim()) cpState.prompt = prompt.trim()
  saveCpState()
}

function regenerateMediaAsset(asset: MediaDisplayAsset) {
  regenerateFromPrompt(asset.kind, asset.prompt || asset.name)
  closeAssetViewer()
  cpState.progressText = '已带入生成操作台，可调整参数后重新生成'
}

function sendMediaAssetToCanvas(asset: MediaDisplayAsset) {
  const payload: SendMediaAssetToCanvasPayload = {
    id: asset.id,
    fileId: asset.fileId,
    kind: asset.kind,
    name: asset.name,
    url: asset.displayUrl,
    prompt: asset.prompt,
    model: asset.model,
  }
  emitEvent('send-media-asset-to-canvas', payload)
  cpState.progressText = '已发送到画布入口（等待画布接入）'
}

async function deleteMediaAsset(asset: MediaDisplayAsset) {
  if (!asset.fileId) return
  if (!await confirmAction(`确定删除媒体「${asset.name}」吗？此操作不可恢复。`)) return
  await fileStore.deleteFile(asset.fileId)
  if (assetViewerAsset.value?.id === asset.id) closeAssetViewer()
  await refreshMediaLibraryAssets()
}

function openMediaImport() {
  mediaImportInput.value?.click()
}

function kindFromImportedFile(file: File): MediaAssetKind | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return null
}

async function onMediaImportSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  for (const file of files) {
    const kind = kindFromImportedFile(file)
    if (!kind) continue
    const content = await fileToDataUrl(file)
    await fileStore.addMedia(file.name, content, kind, file.type || `${kind}/${extForAsset(kind)}`, {
      source: CREATION_GALLERY_SOURCE,
      kind: 'creation-import',
      originalName: file.name,
    })
  }
  await refreshMediaLibraryAssets()
}

function regenerateResult(index: number) {
  const result = cpState.results[index]
  if (!result) return
  const kind = result.type === 'audio' ? 'audio' : result.type === 'video' ? 'video' : 'image'
  regenerateFromPrompt(kind, result.content)
  closeLightbox()
  cpState.progressText = '已带入生成操作台，可调整参数后重新生成'
}

async function sendResultToCanvas(index: number) {
  const result = cpState.results[index]
  if (!result) return
  const resolvedUrl = await resolveGalleryUrl(index, result.url)
  if (result.type !== 'image' && result.type !== 'video' && result.type !== 'audio') return
  const payload: SendMediaAssetToCanvasPayload = {
    id: resultKey(result),
    taskId: result.taskId,
    kind: result.type,
    name: result.content || result.model || 'creation',
    url: resolvedUrl,
    prompt: result.content,
    model: result.model,
  }
  emitEvent('send-media-asset-to-canvas', payload)
  cpState.progressText = '已发送到画布入口（等待画布接入）'
}

const ctxMenuIndex = computed(() => resultIndexByKey(ctxMenu.key))
const ctxMenuResult = computed(() => cpState.results[ctxMenuIndex.value])

// 提示词输入自适应高度
function autoGrow(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 140) + 'px'
}

// 发送按钮状态
const canSend = computed(() =>
  Boolean(currentRunPlan.value) && !currentRunPlanError.value
)

const offSendToGallery = onEvent('send-to-gallery', async (payload: any) => {
  if (!isAllowedCreationResultUrl(payload?.url || '')) return
  try {
    const cached = await cacheCreationMediaResult({
      url: payload.url,
      type: payload.type || 'image',
      prompt: payload.name,
      model: 'reference',
      metadataKind: 'creation-import',
    })
    if (!cached?.ref) throw new Error('媒体缓存未返回本地引用')
    cpState.results.unshift({
      url: cached.ref,
      type: payload.type,
      content: payload.name,
      model: 'reference',
      task: 'import',
      ts: Date.now(),
      originalUrl: payload.url,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e || '本地缓存失败')
    cpState.results.unshift({
      url: '',
      type: 'failed',
      content: `保存到本地画廊失败: ${message}`,
      errorMsg: `保存到本地画廊失败: ${message}`,
      model: 'reference',
      task: 'import',
      ts: Date.now(),
    })
  }
  saveCpState()
})

const offImportToCreation = onEvent('import-to-creation', async (payload: any) => {
  if (!isAllowedMediaAttachmentUrl(payload?.url || '')) return
  try {
    const res = await fetch(payload.url)
    const blob = await res.blob()
    let mime = 'image/png'
    if (payload.type === 'video') mime = 'video/mp4'
    else if (payload.type === 'audio') mime = 'audio/mpeg'
    const file = new File([blob], payload.name, { type: mime })
    addFiles([file])
  } catch (e) {
    console.error('Import failed', e)
  }
})
onBeforeUnmount(() => {
  offImportToCreation()
  offSendToGallery()
})
</script>

<template>
  <div class="cp">
    <div class="cp-toolbar">
      <span class="cp-title"><JcIcon name="movie_filter" /><span class="cp-title-text">创作面板</span></span>
      <span class="cp-toolbar-spacer" />
      <button class="cp-toolbar-link" @click="openExternal('https://tishici.jiucaihezi.studio/')" title="打开提示词参考">
        <JcIcon name="tips_and_updates" />
        <span class="cp-toolbar-link-text">提示词参考</span>
      </button>
    </div>

    <!-- 远程资产到期提醒 -->
    <div v-if="hasRemoteAssets && !expiryBannerDismissed" class="cp-expiry-banner">
      <JcIcon name="schedule" />
      <span>云端文件 24 小时后失效，请及时下载转存</span>
      <button class="cp-expiry-banner-close" @click="expiryBannerDismissed = true" title="关闭">
        <JcIcon name="close" />
      </button>
    </div>

    <!-- 媒体资产区是创作面板唯一主入口，旧生成画廊只保留为后台任务历史。 -->
    <div class="cp-gallery-zone">

      <div v-if="creationRunningCount > 0 || cpState.progressText" class="cp-generation-status">
        <JcIcon :name="cpState.progressText.startsWith('❌') ? 'error' : 'sync'" />
        <span>{{ creationRunningCount > 0 ? creationProgressText : cpState.progressText }}</span>
        <span class="cp-generation-summary">{{ currentSubmitSummary }}</span>
        <div v-if="creationRunningCount > 0 && creationProgress > 0" class="cp-generation-progress">
          <i :style="{ width: Math.min(100, Math.max(0, creationProgress)) + '%' }" />
        </div>
      </div>
      <section class="cp-media-library">
        <div class="cp-media-library-head">
          <div class="cp-media-library-title">
            <JcIcon name="perm_media" />
            <span>媒体资产</span>
          </div>
          <div class="cp-media-library-tools">
            <input
              v-model="mediaLibrarySearch"
              class="cp-media-search"
              type="search"
              placeholder="搜索媒体"
            />
            <button class="cp-media-import" @click="openMediaImport">
              <JcIcon name="upload_file" />
              导入
            </button>
            <input
              ref="mediaImportInput"
              type="file"
              accept="image/*,video/*,audio/*"
              multiple
              hidden
              @change="onMediaImportSelect"
            />
          </div>
        </div>
        <div class="cp-media-tabs">
          <button
            v-for="tab in mediaLibraryTabs"
            :key="tab.key"
            :class="{ active: mediaLibraryFilter === tab.key }"
            @click="mediaLibraryFilter = tab.key"
          >
            {{ tab.label }}
            <span>{{ tab.count }}</span>
          </button>
        </div>
        <div v-if="filteredMediaLibraryAssets.length" class="cp-media-grid">
          <template v-for="asset in visibleMediaLibraryAssets" :key="asset.id">
            <div class="cp-media-card-wrap">
              <MediaAssetCard
                :asset="asset"
                @preview="openAssetViewer"
                @download="downloadMediaAsset"
                @reference="referenceMediaAsset"
                @copy-url="copyMediaAssetUrl"
                @delete="deleteMediaAsset"
              />
              <div class="cp-result-meta-line">
                {{ resultMetaLine(asset.model, asset.kind) }}
              </div>
            </div>
          </template>
          <div v-if="hasMoreMediaLibraryAssets" class="cp-media-load-more">
            <span>{{ visibleMediaLibraryAssets.length }} / {{ filteredMediaLibraryAssets.length }}</span>
            <button @click="loadMoreMediaAssets">加载更多</button>
          </div>
        </div>
        <div v-else class="cp-media-empty">
          <JcIcon name="perm_media" />
          <span>{{ mediaLibraryAssets.length ? '没有匹配的媒体' : '导入或生成媒体后会出现在这里' }}</span>
        </div>
      </section>
    </div>

    <div
      v-if="ctxMenu.show && ctxMenuResult"
      class="cp-context-menu"
      :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      @click.stop
    >
      <button @click="openLightbox(ctxMenuIndex)"><JcIcon name="visibility" />查看</button>
      <button v-if="ctxMenuResult?.type !== 'text' && ctxMenuResult?.type !== 'failed'" @click="referenceResult(ctxMenuIndex); hideContextMenu()"><JcIcon name="arrow_downward" />引用到输入框</button>
      <button v-if="ctxMenuResult?.type !== 'text' && ctxMenuResult?.type !== 'failed'" @click="downloadResult(ctxMenuIndex); hideContextMenu()"><JcIcon name="download" />下载</button>
      <button v-if="ctxMenuResult?.type === 'failed'" @click="retryResult(ctxMenuIndex)"><JcIcon name="refresh" />重试</button>
      <button class="danger" @click="deleteResult(ctxMenuIndex)"><JcIcon name="delete" />删除</button>
    </div>

    <!-- 媒体查看器 -->
    <MediaViewer
      :show="lbShow"
      :url="displayUrl(lbIndex, lbResult.url)"
      :type="lbResult.type"
      :content="lbResult.content"
      :model="lbResult.model"
      :ts="lbResult.ts"
      :source-url="lbResult.originalUrl || displayUrl(lbIndex, lbResult.url)"
      :status="galleryResolveStatus(lbIndex)"
      :error-msg="galleryResolveError(lbIndex)"
      :current-index="Math.max(lbPosition, 0)"
      :total-count="lbTotal"
      @close="closeLightbox"
      @download="lbDownload"
      @reference="referenceResult(lbIndex)"
      @regenerate="regenerateResult(lbIndex)"
      @send-to-canvas="sendResultToCanvas(lbIndex)"
      @copy-url="copyMediaAssetUrl(lbMediaAsset)"
      @prev="lbPrev"
      @next="lbNext"
    />

    <MediaViewer
      :show="assetViewerShow"
      :url="assetViewerAsset?.displayUrl || ''"
      :type="assetViewerAsset?.kind || 'image'"
      :content="assetViewerAsset?.prompt || assetViewerAsset?.name || ''"
      :model="assetViewerAsset?.model || ''"
      :ts="assetViewerAsset?.createdAt"
      :source-url="assetViewerAsset?.originalUrl || assetViewerAsset?.displayUrl || ''"
      :status="assetViewerAsset?.status === 'failed' ? 'failed' : assetViewerAsset?.displayUrl ? 'ready' : 'loading'"
      :error-msg="assetViewerAsset?.errorMsg"
      :current-index="0"
      :total-count="1"
      @close="closeAssetViewer"
      @download="assetViewerAsset && downloadMediaAsset(assetViewerAsset)"
      @reference="assetViewerAsset && referenceMediaAsset(assetViewerAsset)"
      @regenerate="assetViewerAsset && regenerateMediaAsset(assetViewerAsset)"
      @send-to-canvas="assetViewerAsset && sendMediaAssetToCanvas(assetViewerAsset)"
      @copy-url="assetViewerAsset && copyMediaAssetUrl(assetViewerAsset)"
      @prev="() => {}"
      @next="() => {}"
    />

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
      <!-- RH 渠道 -->
      <div class="cp-island cp-rh-island">
        <div class="cp-island-label">渠道</div>
        <div class="cp-island-val">{{ rhChannelLabel }}</div>
      </div>
      <!-- RH 模式 -->
      <div class="cp-island cp-rh-island">
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
        <div v-if="durationOptions.length <= 2" class="cp-btn-group">
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
      <div v-if="acceptsFiles && !mediaSlots.length" class="cp-upload-trigger"
           @click="($refs.fileInput as HTMLInputElement).click()"
           @dragover.prevent @drop="onFileDrop" title="上传参考素材"
           :class="{ 'has-files': cpState.files.length > 0 }">
        <JcIcon :name="cpState.files.length > 0 ? 'check' : 'add'" />
        <span v-if="cpState.files.length" class="cp-file-count">{{ cpState.files.length }}</span>
        <input ref="fileInput" type="file" multiple :accept="acceptAttr"
               style="display:none" @change="onFileSelect" />
      </div>
      <div class="cp-prompt-wrap">
        <input ref="slotFileInput" type="file" :multiple="activeSlotMultiple" :accept="activeSlotAccept"
               style="display:none" @change="onSlotFileSelect" />
        <div v-if="mediaSlots.length" class="cp-media-slots">
          <button v-for="slot in mediaSlots" :key="slot.key" type="button" class="cp-media-slot"
                  :class="{ filled: slot.files.length > 0, required: slot.required }"
                  @click="openMediaSlot(slot.kind)">
            <JcIcon :name="slot.concreteKind === 'image' ? 'image' : slot.concreteKind === 'video' ? 'videocam' : 'audio_file'" class="cp-media-slot-icon" />
            <span class="cp-media-slot-body">
              <span class="cp-media-slot-label">{{ slot.label }}<em v-if="slot.required">*</em></span>
              <span class="cp-media-slot-value">{{ slot.files.length ? slot.files.map(f => f.name).join('、') : '点击上传' }}</span>
            </span>
          </button>
        </div>
        <!-- 文件缩略图 -->
        <div v-if="fileThumbs.length" class="cp-files">
          <div v-for="f in fileThumbs" :key="f.index" class="cp-file-chip" :title="f.name">
            <img v-if="f.url" :src="f.url" alt="" />
            <JcIcon name="videocam" v-else-if="f.isVideo" />
            <JcIcon name="audio_file" v-else-if="f.isAudio" />
            <JcIcon name="attach_file" v-else />
            <span class="cp-file-name">{{ f.name }}</span>
            <button class="cp-file-remove" @click="removeFile(f.index)" title="移除">
              <JcIcon name="close" />
            </button>
          </div>
        </div>
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
        <div class="cp-rh-summary">
          <JcIcon name="fact_check" />
          <span>{{ currentSubmitSummary }}</span>
        </div>
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
</template>

<style scoped>
.cp { display: flex; flex-direction: column; height: 100%; background: var(--surface); }

/* Toolbar */
.cp-toolbar {
  display: flex; align-items: center; padding: 0 16px; gap: 8px; height: var(--app-header-height); box-sizing: border-box;
  border-bottom: 1px solid var(--line); flex-shrink: 0;
}
.cp-title { font-size: 14px; font-weight: 700; color: var(--ink1); display: flex; align-items: center; gap: 4px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cp-title .mso { font-size: 16px; color: var(--olive); }
@container (max-width: 250px) {
  .cp-title-text { display: none; }
}
.cp-toolbar-spacer { flex: 1; }

/* Expiry banner */
.cp-expiry-banner {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px; margin: 0;
  background: #fef7e0; border-bottom: 1px solid #f0d78c;
  color: #8a6d14; font-size: 0.82rem; flex-shrink: 0;
}
.cp-expiry-banner .mso { font-size: 16px; color: #c08a3a; }
.cp-expiry-banner-close {
  margin-left: auto; background: none; border: none; cursor: pointer;
  color: #8a6d14; padding: 2px; border-radius: 4px;
}
.cp-expiry-banner-close:hover { background: #f0d78c; }
.cp-expiry-banner-close .mso { font-size: 16px; }

.cp-toolbar-link {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; height: 28px;
  border: 1px solid var(--line); border-radius: 8px;
  background: var(--paper); color: var(--ink2);
  font-size: 12px; font-weight: 600; font-family: inherit;
  cursor: pointer; transition: all .15s; white-space: nowrap;
}
.cp-toolbar-link:hover { border-color: var(--olive); color: var(--olive-dark); background: var(--olive-pale); }
.cp-toolbar-link .mso { font-size: 14px; }
@container (max-width: 250px) {
  .cp-toolbar-link-text { display: none; }
}
.cp-select-btn {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: var(--paper);
  color: var(--ink2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all .15s;
}
.cp-select-btn.active,
.cp-select-btn:hover {
  border-color: var(--olive);
  color: var(--olive-dark);
  background: var(--olive-pale);
}
.cp-select-btn .mso { font-size: 17px; }
.cp-bulk-bar {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
  color: var(--ink2);
}
.cp-bulk-bar button {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  color: var(--ink2);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}
.cp-bulk-bar button:hover:not(:disabled) { border-color: var(--olive); color: var(--olive-dark); }
.cp-bulk-bar button.danger { color: #c62828; }
.cp-bulk-bar button:disabled { opacity: .45; cursor: default; }

/* 媒体资产主入口 */
.cp-gallery-zone {
  flex: 1; overflow-y: auto; padding: 10px 12px 6px; min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cp-gallery-zone::-webkit-scrollbar { width: 4px; }
.cp-gallery-zone::-webkit-scrollbar-thumb { background: rgba(0,0,0,.08); border-radius: 2px; }

.cp-generation-status {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 7px 8px;
  align-items: center;
  min-height: 34px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 82%, var(--paper));
  color: var(--ink2);
  font-size: 12px;
}
.cp-generation-status .mso {
  color: var(--olive);
  font-size: 16px;
}
.cp-generation-summary {
  grid-column: 2 / -1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink3);
  font-size: 11px;
}
.cp-generation-progress {
  grid-column: 1 / -1;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(0,0,0,.08);
}
.cp-generation-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--olive);
}
.cp-media-library {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: color-mix(in srgb, var(--paper) 92%, var(--surface));
}
.cp-media-library-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.cp-media-library-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ink1);
  font-size: 13px;
  font-weight: 800;
}
.cp-media-library-title .mso { color: var(--olive); font-size: 17px; }
.cp-media-library-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.cp-media-search {
  width: min(180px, 32vw);
  height: 28px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink1);
  padding: 0 9px;
  font: inherit;
  font-size: 12px;
  outline: none;
}
.cp-media-search:focus { border-color: var(--olive); }
.cp-media-import {
  height: 28px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 9px;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.cp-media-import:hover { border-color: var(--olive); color: var(--olive-dark); }
.cp-media-import .mso { font-size: 15px; }
.cp-media-tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 8px;
}
.cp-media-tabs button {
  padding: 4px 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink2);
  display: inline-flex;
  gap: 4px;
  align-items: center;
  font: inherit;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
.cp-media-tabs button.active {
  background: var(--olive);
  color: #fff;
  border-color: var(--olive);
}
.cp-media-tabs button span { opacity: .72; font-size: 10px; }
.cp-media-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  grid-auto-rows: max-content;
  align-items: start;
  gap: 10px;
  overflow: auto;
  padding-right: 2px;
}
.cp-media-card-wrap {
  min-width: 0;
}
.cp-result-meta-line {
  min-height: 28px;
  margin-top: 4px;
  padding: 5px 8px;
  border: 1px solid color-mix(in srgb, var(--line) 78%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 82%, var(--paper));
  color: var(--ink3);
  font-size: 10px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cp-media-load-more {
  grid-column: 1 / -1;
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ink3);
  font-size: 12px;
}
.cp-media-load-more button {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink2);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.cp-media-load-more button:hover {
  border-color: var(--olive);
  color: var(--olive-dark);
}
.cp-media-empty {
  flex: 1;
  min-height: 86px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  color: var(--ink3);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
}
.cp-media-empty .mso { font-size: 26px; color: var(--olive); opacity: .75; }

.cp-context-menu {
  position: fixed;
  z-index: 10000;
  width: 168px;
  padding: 5px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  box-shadow: var(--jc-shadow-sm, 0 12px 32px rgba(0,0,0,.18));
}
.cp-context-menu button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: none;
  border-radius: 7px;
  background: none;
  color: var(--ink1);
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-size: 12px;
}
.cp-context-menu button:hover { background: var(--surface-alt); }
.cp-context-menu button.danger { color: #c62828; }
.cp-context-menu .mso { font-size: 16px; }

/* 空状态 */
.cp-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; grid-column: 1 / -1; min-height: 200px;
  color: var(--ink3); text-align: center; font-size: 13px; line-height: 1.7;
}
.cp-empty-icon { font-size: 36px; color: var(--olive); animation: gcFloat 3s ease-in-out infinite; }
@keyframes gcFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }

/* Params (完全保持原有样式) */
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
  display: flex; align-items: flex-end; gap: 8px; padding: 10px 12px 12px;
  border-top: 1px solid var(--line); flex-shrink: 0; background: var(--surface-alt);
}
.cp-upload-trigger {
  position: relative; width: 48px; height: 48px; min-width: 48px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 12px; border: 1.5px dashed var(--line); cursor: pointer; flex-shrink: 0;
  transition: all .15s; color: var(--ink3); overflow: hidden;
}
.cp-upload-trigger:hover { border-color: var(--olive); color: var(--olive); background: var(--olive-pale); }
.cp-upload-trigger.has-files { border-style: solid; border-color: var(--olive); background: var(--olive-pale); }
.cp-upload-trigger .mso { font-size: 22px; pointer-events: none; }
.cp-file-count {
  position: absolute; top: -4px; right: -4px;
  background: var(--olive); color: #fff; font-size: 9px; font-weight: 700;
  width: 16px; height: 16px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
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

/* 文件芯片 (V3 风格) */
.cp-files { display: flex; flex-wrap: wrap; gap: 4px; }
.cp-file-chip {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--paper); border: 1px solid var(--line); border-radius: 8px;
  padding: 2px 4px; font-size: 10px; color: var(--ink2); max-width: 100px; position: relative;
}
.cp-file-chip img { width: 36px; height: 36px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
.cp-file-chip .mso { font-size: 18px; color: var(--olive); flex-shrink: 0; }
.cp-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50px; }
.cp-file-remove {
  background: none; border: none; cursor: pointer; color: var(--ink3);
  font-size: 12px; padding: 0; line-height: 1; display: flex;
}
.cp-file-remove .mso { font-size: 12px; }

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
  min-height: 48px; max-height: 140px;
}
.cp-rh-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 5px 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--paper) 82%, var(--olive-pale));
  color: var(--ink2);
  font-size: 11px;
  line-height: 1.35;
}
.cp-rh-summary .mso {
  flex-shrink: 0;
  color: var(--olive);
  font-size: 15px;
}
.cp-rh-summary span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

  /* P0: 画廊网格适配 */
  .cp-media-grid {
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 6px;
  }
  .cp-gallery-zone {
    padding: 6px 4px 4px;
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

  /* P2: 24h 过期提醒缩短 */
  .cp-expiry-banner {
    font-size: 0.75rem;
    padding: 6px 10px;
  }
}
</style>
