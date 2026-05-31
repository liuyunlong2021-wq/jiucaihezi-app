import { reactive, computed } from 'vue'
import {
  type CreationTask,
  type CreationModel,
  RH_CREATION_MODELS,
  getModelsForTask,
  getAspectOptions,
  getDefaultAspect,
  getSizeOptions,
  getDefaultSize,
  getResolutionOptions,
  getDefaultResolution,
} from '@/data/creationModels'
import { getMediaField, isMediaModelEnabled, mediaFieldOptions } from '@/data/mediaModelCapabilities'
import { sanitizeCreationResults } from '@/utils/creationResults'

// ─── 结果项 ───
export interface CreationResult {
  url: string
  type: 'image' | 'video' | 'audio' | 'text' | 'unknown'
  content?: string
  model: string
  task: string
  ts: number
}

// ─── 状态 ───
export interface CpState {
  task: CreationTask
  modelKey: string
  prompt: string
  tags: string
  title: string
  negativeTags: string
  text: string
  refText: string
  voicePrompt: string
  language: string
  startTime: string
  endTime: string
  width: number
  height: number
  value: number
  mv: string
  ar: string
  size: string
  res: string
  dur: number
  files: File[]
  generating: boolean
  runningTasks: number
  progress: number
  progressText: string
  results: CreationResult[]
}

const STORAGE_KEY = 'jc_cp_state_v3'
const MAX_CREATION_FILE_BYTES = 50 * 1024 * 1024

function loadSaved(): Partial<CpState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return {
      ...parsed,
      results: sanitizeCreationResults<CreationResult>(parsed.results),
    }
  } catch { return {} }
}

const saved = loadSaved()

function normalizeSavedTask(task: unknown): CreationTask {
  if (task === 'text-video' || task === 'image-video') return 'video'
  if (task === 'text-music') return 'audio'
  if (task === 'text-image' || task === 'image-image') return 'image'
  if (task === 'image' || task === 'video' || task === 'digital-human' || task === 'audio') return task
  return 'image'
}

function normalizeSavedModel(modelKey: unknown, task: CreationTask): string {
  const key = String(modelKey || '')
  if (RH_CREATION_MODELS[key]?.tasks.includes(task) && isMediaModelEnabled(key)) return key
  return getModelsForTask(task)[0] || 'gpt-image-2'
}

const initialTask = normalizeSavedTask(saved.task)

export const cpState = reactive<CpState>({
  task: initialTask,
  modelKey: normalizeSavedModel(saved.modelKey, initialTask),
  prompt: saved.prompt || '',
  tags: saved.tags || '',
  title: saved.title || '',
  negativeTags: (saved as any).negativeTags || '',
  text: (saved as any).text || '',
  refText: (saved as any).refText || '',
  voicePrompt: (saved as any).voicePrompt || '',
  language: (saved as any).language || '中文',
  startTime: (saved as any).startTime || '0:00',
  endTime: (saved as any).endTime || '0:11',
  width: Number((saved as any).width || 540),
  height: Number((saved as any).height || 960),
  value: Number((saved as any).value || 832),
  mv: (saved as any).mv || 'chirp-fenix',
  ar: saved.ar || '16:9',
  size: saved.size || 'auto',
  res: saved.res || '720P',
  dur: saved.dur || 5,
  files: [],
  generating: false,
  runningTasks: 0,
  progress: 0,
  progressText: '',
  results: saved.results || [],
})

// ─── 持久化 ───
export function saveCpState() {
  try {
    const {
      task, modelKey, prompt, tags, title, negativeTags, text, refText, voicePrompt,
      language, startTime, endTime, width, height, value, mv, ar, size, res, dur, results,
    } = cpState
    // BUG-4 修复: 限制保存的结果数量，避免 URL 累积超过 localStorage 5MB 限制
    const trimmedResults = sanitizeCreationResults<CreationResult>(results, { forStorage: true })
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      task, modelKey, prompt, tags, title, negativeTags, text, refText, voicePrompt,
      language, startTime, endTime, width, height, value, mv, ar, size, res, dur,
      results: trimmedResults,
    }))
  } catch (e) {
    // 存储失败时至少保存非结果部分
    try {
      const { task, modelKey, prompt, tags, title, ar, size, res, dur } = cpState
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ task, modelKey, prompt, tags, title, ar, size, res, dur, results: [] }))
    } catch { /* noop */ }
  }
}

// ─── 计算属性 ───
export const currentModel = computed<CreationModel | undefined>(
  () => RH_CREATION_MODELS[cpState.modelKey]
)

export const availableModels = computed(() => getModelsForTask(cpState.task))

export const aspectOptions = computed(() =>
  currentModel.value ? getAspectOptions(currentModel.value, cpState.task) : []
)

export const sizeOptions = computed(() =>
  currentModel.value ? getSizeOptions(currentModel.value) : []
)

export const resolutionOptions = computed(() =>
  currentModel.value ? getResolutionOptions(currentModel.value) : []
)

export const durationRange = computed(() => {
  const m = currentModel.value
  if (!m?.dur || m.dur.length < 1) return null
  if (m.dur.length === 1) return { min: m.dur[0], max: m.dur[0], step: 1, fixed: true }
  return { min: m.dur[0], max: m.dur[m.dur.length - 1], step: 1, fixed: false }
})

export const hasDuration = computed(() => !!durationRange.value && !durationRange.value.fixed)
export const durationOptions = computed(() => currentModel.value?.dur || [])

// 是否是图片模型（gateway-image 或 runninghub-image）
export const isImageModel = computed(() =>
  currentModel.value?.provider === 'gateway-image' || currentModel.value?.provider === 'runninghub-image'
)
// 是否是音乐模型
export const isMusicModel = computed(() => cpState.task === 'audio')
export const acceptsFiles = computed(() => Boolean(currentModel.value?.acceptedFiles?.length))
export const acceptAttr = computed(() => {
  const accepted = currentModel.value?.acceptedFiles || []
  const values = accepted.map(type => type === 'image' ? 'image/*' : type === 'video' ? 'video/*' : 'audio/*')
  return values.join(',')
})
export const modelFields = computed(() => currentModel.value?.capability.fields || [])
export const showNegativeTagsInput = computed(() => Boolean(getMediaField(currentModel.value?.capability, 'negative_tags')))
export const showMvSelect = computed(() => Boolean(getMediaField(currentModel.value?.capability, 'mv')))
export const mvOptions = computed(() => mediaFieldOptions(currentModel.value?.capability, 'mv').map(option => String(option.value)))
export const languageOptions = computed(() => mediaFieldOptions(currentModel.value?.capability, 'language').map(option => String(option.value)))
export const showTextInput = computed(() => Boolean(getMediaField(currentModel.value?.capability, 'text')))
export const showRefTextInput = computed(() => Boolean(getMediaField(currentModel.value?.capability, 'ref_text')))
export const showVoicePromptInput = computed(() => Boolean(getMediaField(currentModel.value?.capability, 'voice_prompt')))
export const showStartEndTimeInput = computed(() => Boolean(getMediaField(currentModel.value?.capability, 'start_time') || getMediaField(currentModel.value?.capability, 'end_time')))
export const showWidthHeightInput = computed(() => Boolean(getMediaField(currentModel.value?.capability, 'width') || getMediaField(currentModel.value?.capability, 'height')))
export const showValueInput = computed(() => Boolean(getMediaField(currentModel.value?.capability, 'value')))
export const showLanguageSelect = computed(() => Boolean(getMediaField(currentModel.value?.capability, 'language')))

// ─── 操作 ───
export function switchTask(task: CreationTask) {
  cpState.task = task
  const models = getModelsForTask(task)
  if (!models.includes(cpState.modelKey)) {
    cpState.modelKey = models[0] || 'gpt-image-2'
  }
  syncParams()
  saveCpState()
}

export function switchModel(key: string) {
  cpState.modelKey = key
  syncParams()
  saveCpState()
}

function syncParams() {
  const m = currentModel.value
  if (!m) return
  // aspect
  const ars = getAspectOptions(m, cpState.task)
  if (ars.length && !ars.includes(cpState.ar)) cpState.ar = getDefaultAspect(m, cpState.task)
  // size (gpt-image-2)
  const szs = getSizeOptions(m)
  if (szs.length && !szs.includes(cpState.size)) cpState.size = getDefaultSize(m)
  // resolution
  const ress = getResolutionOptions(m)
  if (ress.length && !ress.includes(cpState.res)) cpState.res = getDefaultResolution(m)
  // duration
  if (m.dur && m.dur.length >= 1) {
    if (cpState.dur < m.dur[0]) cpState.dur = m.defDur || m.dur[0]
    if (cpState.dur > m.dur[m.dur.length - 1]) cpState.dur = m.defDur || m.dur[0]
  }
  const mv = getMediaField(m.capability, 'mv')
  if (mv?.defaultValue && !mvOptions.value.includes(cpState.mv)) cpState.mv = String(mv.defaultValue)
  const language = getMediaField(m.capability, 'language')
  if (language?.defaultValue && !languageOptions.value.includes(cpState.language)) cpState.language = String(language.defaultValue)
  const width = getMediaField(m.capability, 'width')
  if (width?.defaultValue !== undefined) cpState.width = Number(cpState.width || width.defaultValue)
  const height = getMediaField(m.capability, 'height')
  if (height?.defaultValue !== undefined) cpState.height = Number(cpState.height || height.defaultValue)
  const value = getMediaField(m.capability, 'value')
  if (value?.defaultValue !== undefined) cpState.value = Number(cpState.value || value.defaultValue)
}

export function setAspect(ar: string) { cpState.ar = ar; saveCpState() }
export function setSize(size: string) { cpState.size = size; saveCpState() }
export function setResolution(res: string) { cpState.res = res; saveCpState() }
export function setDuration(dur: number) { cpState.dur = dur; saveCpState() }
export function setMv(mv: string) { cpState.mv = mv; saveCpState() }
export function setLanguage(language: string) { cpState.language = language; saveCpState() }

// ─── 文件处理 ───
const MIME_EXT_MAP: Record<string, string> = {
  image: '.jpg.jpeg.png.gif.webp.bmp.tiff.heic.heif.svg.ico',
  video: '.mp4.mov.webm.m4v.avi.mkv',
  audio: '.mp3.wav.m4a.aac.flac.ogg.opus',
}

function isAcceptedFileForCurrentModel(file: File): boolean {
  const accepted = currentModel.value?.acceptedFiles || []
  if (!accepted.length) return false
  return accepted.some(type => {
    if (file.type.startsWith(`${type}/`)) return true
    // 浏览器未识别 MIME 时，用扩展名兜底
    if (!file.type) {
      const exts = MIME_EXT_MAP[type] || ''
      const lower = file.name.toLowerCase()
      return exts.split('.').some(ext => ext && lower.endsWith(`.${ext}`))
    }
    return false
  })
}

export function addFiles(fileList: FileList | File[]) {
  const max = currentModel.value?.maxFiles || 1
  Array.from(fileList).forEach(f => {
    if (f.size > MAX_CREATION_FILE_BYTES) return
    if (cpState.files.length < max && isAcceptedFileForCurrentModel(f)) {
      cpState.files.push(f)
    }
  })
}
export function removeFile(index: number) { cpState.files.splice(index, 1) }
export function clearFiles() { cpState.files.splice(0) }

// ─── 结果管理 ───
export function addResult(r: CreationResult) { cpState.results.unshift(r); saveCpState() }
export function clearResults() { cpState.results.splice(0); saveCpState() }

// ─── 提示词 placeholder ───
export const promptPlaceholder = computed(() => {
  if (cpState.modelKey === 'suno-custom-song') return '输入歌词或音乐创作提示词'
  if (cpState.modelKey === 'rh-digital-human') return '输入动作提示词'
  if (cpState.modelKey === 'rh-voice-design') return '主要文稿请填写在“文稿”字段'
  return '描述你想生成的内容...'
})

export const showTagsInput = computed(() => Boolean(getMediaField(currentModel.value?.capability, 'tags')))
export const showTitleInput = computed(() => Boolean(getMediaField(currentModel.value?.capability, 'title')))
