/**
 * useCreation.ts — 创作面板状态管理
 * 适配精简后的 6 模型结构
 */
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
  /** Suno: tags */
  tags: string
  /** Suno: title */
  title: string
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

export const cpState = reactive<CpState>({
  task: (saved.task as CreationTask) || 'text-image',
  modelKey: saved.modelKey || 'gpt-image-2',
  prompt: saved.prompt || '',
  tags: saved.tags || '',
  title: saved.title || '',
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
    const { task, modelKey, prompt, tags, title, ar, size, res, dur, results } = cpState
    // BUG-4 修复: 限制保存的结果数量，避免 URL 累积超过 localStorage 5MB 限制
    const trimmedResults = sanitizeCreationResults<CreationResult>(results, { forStorage: true })
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ task, modelKey, prompt, tags, title, ar, size, res, dur, results: trimmedResults }))
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

// 是否是图片模型
export const isImageModel = computed(() => currentModel.value?.provider === 'newapi-image')
// 是否是音乐模型
export const isMusicModel = computed(() => currentModel.value?.provider === 'newapi-suno')

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
  if (m.dur && m.dur.length >= 2) {
    if (cpState.dur < m.dur[0]) cpState.dur = m.defDur || m.dur[0]
    if (cpState.dur > m.dur[m.dur.length - 1]) cpState.dur = m.defDur || m.dur[0]
  }
}

export function setAspect(ar: string) { cpState.ar = ar; saveCpState() }
export function setSize(size: string) { cpState.size = size; saveCpState() }
export function setResolution(res: string) { cpState.res = res; saveCpState() }
export function setDuration(dur: number) { cpState.dur = dur; saveCpState() }

// ─── 文件处理 ───
export function addFiles(fileList: FileList | File[]) {
  const max = currentModel.value?.maxFiles || 1
  Array.from(fileList).forEach(f => {
    if (cpState.files.length < max) {
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
  if (isMusicModel.value) return '描述你想创作的音乐风格和主题\n如：一首关于夏天回忆的流行歌曲'
  if (cpState.task === 'image-image') return '描述你想对图片进行的修改...'
  return '描述你想生成的内容...'
})

export const showTagsInput = computed(() => isMusicModel.value)
export const showTitleInput = computed(() => isMusicModel.value)
