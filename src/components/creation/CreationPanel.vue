<script setup lang="ts">
/**
 * CreationPanel — 创作面板
 * 用户显式选择模型，前端展示该模型参数；NewAPI 分组只在后台维护。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  RH_TASK_LABELS,
  RH_CREATION_MODELS,
  type CreationTask,
} from '@/data/creationModels'
import { validateMediaModelInputs } from '@/data/mediaModelInputValidation'
import {
  cpState,
  type CreationResult,
  currentModel,
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
  switchTask,
  switchModel,
  setAspect,
  setSize,
  setResolution,
  setDuration,
  setMv,
  setLanguage,
  addFiles,
  replaceFilesForMediaKind,
  removeFile,
  refreshCreationModelAvailability,
  saveCpState,
  markResultDeleted,
  isResultDeleted,
} from '@/composables/useCreation'

import { onEvent, emitEvent } from '@/utils/eventBus'
import { isAllowedCreationResultUrl, isAllowedDownloadUrl, isAllowedMediaAttachmentUrl } from '@/utils/urlSafety'
import { cacheCreationMediaResult, resolveCreationMediaUrl } from '@/utils/creationMediaCache'
import { useMediaTaskStore } from '@/stores/mediaTaskStore'
import type { MediaTask } from '@/stores/mediaTaskStore'

// --- 新增 UI 组件 ---
import GalleryCard from './GalleryCard.vue'
import GallerySizeControl from './GallerySizeControl.vue'
import GalleryLightbox from './GalleryLightbox.vue'
import GalleryLoadingCard from './GalleryLoadingCard.vue'

const mediaTaskStore = useMediaTaskStore()
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

type GalleryFilter = 'all' | 'image' | 'video' | 'audio' | 'failed'

onMounted(async () => {
  await mediaTaskStore.init().catch(() => {})
  refreshCreationModelAvailability().catch(() => {})
  reconcileCreationTasksToGallery()
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

async function addSettledCreationTaskToGallery(task: MediaTask) {
  if (isResultDeleted(task.id, task.resultUrl)) return
  if (hasGalleryRecordForTask(task)) return
  if (task.status === 'success' && task.resultUrl && isAllowedCreationResultUrl(task.resultUrl)) {
    try {
      const cached = await cacheCreationMediaResult({
        url: task.resultUrl,
        type: task.type,
        prompt: task.prompt,
        model: task.modelLabel || task.model,
      })
      if (!cached?.ref) throw new Error('媒体缓存未返回本地引用')
      cpState.results.unshift({
        url: cached.ref,
        type: task.type,
        content: task.prompt || '',
        model: task.modelLabel || task.model || 'unknown',
        task: task.type,
        ts: task.completedAt || Date.now(),
        taskId: task.id,
        originalUrl: task.resultUrl,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e || '本地缓存失败')
      addFailureCard({
        message: `生成成功，但保存到本地画廊失败: ${message}`,
        model: task.modelLabel || task.model || 'unknown',
        task: task.type,
        content: task.prompt || '',
        taskId: task.id,
      })
    }
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
  const mediaType = task === 'image' ? 'image' as const
    : task === 'audio' ? 'audio' as const : 'video' as const

  // 快照参数
  const refImages: string[] = []
  let firstImage = ''
  let firstVideo = ''
  let firstAudio = ''
  for (const f of cpState.files) {
    const dataUrl = await fileToDataUrl(f)
    if (f.type.startsWith('image/')) {
      refImages.push(dataUrl)
      if (!firstImage) firstImage = dataUrl
    } else if (f.type.startsWith('video/')) {
      if (!firstVideo) firstVideo = dataUrl
    } else if (f.type.startsWith('audio/')) {
      if (!firstAudio) firstAudio = dataUrl
    }
  }

  try {
    validateMediaModelInputs({
      modelId: cpState.modelKey,
      prompt: cpState.prompt,
      data: {
        title: cpState.title,
        tags: cpState.tags,
        negativeTags: cpState.negativeTags,
        text: cpState.text,
        refText: cpState.refText,
        voicePrompt: cpState.voicePrompt,
        language: cpState.language,
        startTime: cpState.startTime,
        endTime: cpState.endTime,
        width: cpState.width,
        height: cpState.height,
        value: cpState.value,
        ratio: cpState.ar,
        aspectRatio: cpState.ar,
        resolution: cpState.res,
        duration: cpState.dur,
        mv: cpState.mv,
      },
      images: refImages,
      videos: firstVideo ? [firstVideo] : [],
      audios: firstAudio ? [firstAudio] : [],
      emptyMessage: '请补充生成参数',
    })
  } catch (e: any) {
    const message = e?.message || '请补充生成参数'
    cpState.progressText = message
    addFailureCard({
      message,
      model: modelDef.label || modelDef.modelName,
      task: mediaType,
      content: cpState.prompt || cpState.text || cpState.voicePrompt || message,
    })
    return
  }

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
  Object.entries(RH_TASK_LABELS).map(([key, label]) => ({ key: key as CreationTask, label }))
)

const modelList = computed(() =>
  availableModels.value.map(k => ({ key: k, label: RH_CREATION_MODELS[k]?.label || k }))
)

// --- 新增：画廊尺寸切换 ---
const gallerySize = ref(localStorage.getItem('jc_gallery_size') || 'medium')
function onSizeChange(size: string) {
  gallerySize.value = size
  localStorage.setItem('jc_gallery_size', size)
}

const activeFilter = ref<GalleryFilter>('all')
const galleryLimit = ref(30)
const selectMode = ref(false)
const selectedKeys = ref<Set<string>>(new Set())
const ctxMenu = reactive({ show: false, x: 0, y: 0, key: '' })

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
    { key: 'failed' as const, label: '失败', count: count('failed') },
  ]
})

const filteredResults = computed(() =>
  cpState.results
    .map((result, index) => ({ result, index, key: resultKey(result) }))
    .filter(item => activeFilter.value === 'all' || item.result.type === activeFilter.value)
)

const displayResults = computed(() => filteredResults.value.slice(0, galleryLimit.value))

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
  return r || { url: '', type: 'image', content: '' }
})
const lbPosition = computed(() => filteredResults.value.findIndex(item => item.index === lbIndex.value))
const lbTotal = computed(() => filteredResults.value.length)
const resolvedGalleryUrls = ref<Record<string, string>>({})

async function resolveGalleryUrl(index: number, url: string): Promise<string> {
  if (!url) return ''
  if (!url.startsWith('jc-media:')) return url
  const cached = resolvedGalleryUrls.value[url]
  if (cached) return cached
  const resolved = await resolveCreationMediaUrl(url).catch(() => '')
  if (resolved) resolvedGalleryUrls.value = { ...resolvedGalleryUrls.value, [url]: resolved }
  return resolved || url
}

function displayUrl(index: number, url: string): string {
  if (!url) return ''
  if (!url.startsWith('jc-media:')) return url
  void resolveGalleryUrl(index, url)
  return resolvedGalleryUrls.value[url] || ''
}

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
  if (!isAllowedDownloadUrl(resolvedUrl)) {
    cpState.progressText = '下载地址不安全，已阻止'
    return
  }
  const ext = r.type === 'video' ? 'mp4' : r.type === 'audio' ? 'mp3' : 'png'
  const filename = `creation_${r.type}_${Date.now()}.${ext}`
  try {
    // 尝试 fetch blob 下载（可能被 CORS 拦截）
    const res = await fetch(resolvedUrl, { mode: 'cors' })
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
    // 降级：用 a[download] 直接链接（跨域时浏览器可能忽略 download 属性但仍能打开）
    const a = document.createElement('a')
    a.href = resolvedUrl
    a.download = filename
    a.target = '_blank'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
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
  Boolean(
    cpState.prompt?.trim()
    || cpState.text?.trim()
    || cpState.voicePrompt?.trim()
    || cpState.files.length > 0,
  )
)

const offSendToGallery = onEvent('send-to-gallery', async (payload: any) => {
  if (!isAllowedCreationResultUrl(payload?.url || '')) return
  try {
    const cached = await cacheCreationMediaResult({
      url: payload.url,
      type: payload.type || 'image',
      prompt: payload.name,
      model: 'reference',
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
  <div class="cp" :class="'size-' + gallerySize">
    <div class="cp-toolbar">
      <span class="cp-title"><span class="mso">movie_filter</span><span class="cp-title-text">创作面板</span></span>
      <span class="cp-toolbar-spacer" />
      <div v-if="selectMode" class="cp-bulk-bar">
        <span>{{ selectedKeys.size }} 已选</span>
        <button @click="selectAllVisible">全选</button>
        <button :disabled="!selectedKeys.size" @click="batchDownload">下载</button>
        <button :disabled="!selectedKeys.size" class="danger" @click="batchDelete">删除</button>
      </div>
      <button class="cp-select-btn" :class="{ active: selectMode }" @click="toggleSelectMode" title="选择">
        <span class="mso">checklist</span>
      </button>
      <GallerySizeControl :model-value="gallerySize" @update:model-value="onSizeChange" />
    </div>

    <!-- ★ 画廊区 — 全新 UI ★ -->
    <div class="cp-gallery-zone" @scroll="onGalleryScroll">

      <!-- 媒体模型可用性声明 -->
      <div class="cp-availability-notice">
        <span class="mso">info</span>
        <span>图片生成 (GPT Image 2 / Nano Banana / RH 系列) 已可用。视频和音频模型正在持续接入中，部分模型可能不稳定。</span>
      </div>
      <div class="cp-gallery-filter">
        <button
          v-for="f in filterTabs"
          :key="f.key"
          :class="{ active: activeFilter === f.key }"
          @click="activeFilter = f.key"
        >
          {{ f.label }}
          <span class="cp-filter-count">{{ f.count }}</span>
        </button>
      </div>
      <!-- 加载中占位卡 -->
      <GalleryLoadingCard v-if="creationRunningCount > 0" :text="creationProgressText" />

      <!-- 结果卡片 -->
      <template v-if="displayResults.length">
        <GalleryCard
          v-for="item in displayResults"
          :key="(item.result.taskId || item.result.ts) + '-' + item.index"
          :url="displayUrl(item.index, item.result.url)"
          :type="item.result.type"
          :content="item.result.content"
          :model="item.result.model"
          :ts="item.result.ts"
          :index="item.index"
          :result-key="item.key"
          :select-mode="selectMode"
          :selected="isSelected(item.key)"
          :compact-preview="gallerySize === 'small'"
          @preview="openLightbox"
          @reference="referenceResult"
          @retry="retryResult"
          @delete="deleteResult"
          @toggle-select="toggleSelect"
          @contextmenu="onCardContextMenu"
        />
      </template>

      <!-- 空状态 -->
      <div v-if="!displayResults.length && creationRunningCount === 0" class="cp-empty">
        <span class="mso cp-empty-icon">auto_awesome</span>
        <div>{{ cpState.results.length ? '当前筛选下没有作品' : '在下方写下提示词' }}<br/>AI 将在这里呈现你的作品</div>
      </div>
    </div>

    <div
      v-if="ctxMenu.show && ctxMenuResult"
      class="cp-context-menu"
      :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
      @click.stop
    >
      <button @click="openLightbox(ctxMenuIndex)"><span class="mso">visibility</span>查看</button>
      <button v-if="ctxMenuResult?.type !== 'text' && ctxMenuResult?.type !== 'failed'" @click="referenceResult(ctxMenuIndex); hideContextMenu()"><span class="mso">arrow_downward</span>引用到输入框</button>
      <button v-if="ctxMenuResult?.type !== 'text' && ctxMenuResult?.type !== 'failed'" @click="downloadResult(ctxMenuIndex); hideContextMenu()"><span class="mso">download</span>下载</button>
      <button v-if="ctxMenuResult?.type === 'failed'" @click="retryResult(ctxMenuIndex)"><span class="mso">refresh</span>重试</button>
      <button class="danger" @click="deleteResult(ctxMenuIndex)"><span class="mso">delete</span>删除</button>
    </div>

    <!-- ★ 灯箱 ★ -->
    <GalleryLightbox
      :show="lbShow"
      :url="displayUrl(lbIndex, lbResult.url)"
      :type="lbResult.type"
      :content="lbResult.content"
      :model="lbResult.model"
      :ts="lbResult.ts"
      :current-index="Math.max(lbPosition, 0)"
      :total-count="lbTotal"
      @close="closeLightbox"
      @download="lbDownload"
      @prev="lbPrev"
      @next="lbNext"
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
        <div class="cp-island-val">{{ currentModel?.label || cpState.modelKey }}</div>
        <div v-if="openPop === 'model'" class="cp-popover" @click.stop>
          <button v-for="m in modelList" :key="m.key" class="cp-pop-item"
                  :class="{ active: cpState.modelKey === m.key }"
                  @click="switchModel(m.key); openPop = ''">
            {{ m.label }}
          </button>
        </div>
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
        <span class="mso">{{ cpState.files.length > 0 ? 'check' : 'add' }}</span>
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
            <span class="cp-media-slot-icon mso">
              {{ slot.concreteKind === 'image' ? 'image' : slot.concreteKind === 'video' ? 'videocam' : 'audio_file' }}
            </span>
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
            <span v-else-if="f.isVideo" class="mso">videocam</span>
            <span v-else-if="f.isAudio" class="mso">audio_file</span>
            <span v-else class="mso">attach_file</span>
            <span class="cp-file-name">{{ f.name }}</span>
            <button class="cp-file-remove" @click="removeFile(f.index)" title="移除">
              <span class="mso">close</span>
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
          <textarea v-model="cpState.text" rows="2" :placeholder="cpState.modelKey === 'rh-aiapp-digital-human' ? '台词' : cpState.modelKey === 'rh-aiapp-director' ? '动作说明' : '输出文字/文稿'" class="cp-aux-textarea" @blur="saveCpState()" />
        </div>
        <div v-if="showVoicePromptInput" class="cp-suno-row">
          <textarea v-model="cpState.voicePrompt" rows="2" placeholder="人设 + 音色特征 + 风格 + 情感 + 节奏" class="cp-aux-textarea" @blur="saveCpState()" />
        </div>
        <textarea v-model="cpState.prompt" rows="2" :placeholder="promptPlaceholder"
                  @blur="saveCpState()" @input="autoGrow" class="cp-prompt-input" />
      </div>
      <div class="cp-submit">
        <button class="cp-send-btn" :class="{ ready: canSend, generating: creationRunningCount > 0 }"
                @click="runCreationViaTaskStore" title="生成">
          <span v-if="creationRunningCount > 0" class="cp-running-badge">{{ creationRunningCount }}</span>
          <span class="mso">arrow_upward</span>
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

/* ★ 画廊网格 ★ */
.cp-gallery-zone {
  flex: 1; overflow-y: auto; padding: 10px 12px 6px; min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr));
  gap: 8px; align-items: start; align-content: start;
}
.cp-gallery-zone::-webkit-scrollbar { width: 4px; }
.cp-gallery-zone::-webkit-scrollbar-thumb { background: rgba(0,0,0,.08); border-radius: 2px; }

/* 画廊网格动态尺寸由 GallerySizeControl v-model 驱动，这里提供 CSS 类 */

/* 媒体模型可用性声明 */
.cp-availability-notice {
  grid-column: 1 / -1;
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  background: var(--jc-account-card-bg, rgba(107,142,35,0.06));
  border: 1px solid rgba(107,142,35,0.25);
  border-radius: 8px;
  font-size: 13px; color: var(--ink2);
}
.cp-availability-notice .mso { font-size: 16px; color: var(--olive); flex-shrink: 0; }
.cp-availability-notice strong { color: var(--ink1); }
.cp-gallery-filter {
  grid-column: 1 / -1;
  display: flex;
  gap: 4px;
  padding: 2px 0 4px;
  overflow-x: auto;
}
.cp-gallery-filter button {
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: none;
  font-size: 11px;
  color: var(--ink2);
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all .15s;
  white-space: nowrap;
}
.cp-gallery-filter button.active {
  background: var(--olive);
  color: #fff;
  border-color: var(--olive);
}
.cp-gallery-filter button:hover:not(.active) { border-color: var(--olive); }
.cp-filter-count { font-size: 10px; opacity: .7; }
.cp.size-small .cp-gallery-zone { grid-template-columns: repeat(auto-fit, minmax(min(96px, 100%), 1fr)); gap: 8px; }
.cp.size-medium .cp-gallery-zone { grid-template-columns: repeat(auto-fit, minmax(min(170px, 100%), 1fr)); gap: 12px; }
.cp.size-large .cp-gallery-zone { grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 16px; }
.cp.size-masonry .cp-gallery-zone {
  display: block;
  columns: 3 170px;
  column-gap: 12px;
}
.cp.size-masonry .cp-availability-notice,
.cp.size-masonry .cp-gallery-filter,
.cp.size-masonry .cp-empty {
  break-inside: avoid;
  margin-bottom: 12px;
}
.cp.size-masonry :deep(.gc-card) {
  break-inside: avoid;
  margin-bottom: 12px;
}
.cp.size-masonry :deep(.gc-card-media) { aspect-ratio: auto; }
.cp.size-masonry :deep(.gc-card img),
.cp.size-masonry :deep(.gc-card video) {
  height: auto;
  object-fit: contain;
}

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
.cp-submit { flex-shrink: 0; }
.cp-send-btn {
  width: 40px; height: 40px; border-radius: 50%; border: none;
  background: var(--line); color: var(--surface); cursor: pointer; display: flex;
  align-items: center; justify-content: center; transition: all .3s;
  position: relative; pointer-events: none;
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
</style>
