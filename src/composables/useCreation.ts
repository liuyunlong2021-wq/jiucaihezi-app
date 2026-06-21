import { reactive, computed } from 'vue'
import {
  type CreationTask,
  type CreationModel,
  getAspectOptions,
  getDefaultAspect,
  getSizeOptions,
  getDefaultSize,
  getResolutionOptions,
  getDefaultResolution,
} from '@/data/creationModels'
import { MEDIA_TASK_LABELS } from '@/data/mediaModelCapabilities'
import {
  clearMediaModelAvailability,
  getMediaModelAvailability,
  setMediaModelAvailability,
  type MediaModelCapability,
  type MediaModelField,
} from '@/data/mediaModelCapabilities'
import {
  CREATION_MODEL_REGISTRY,
  getCreationModelSpec,
  listCreationModels,
} from '@/runtime/creation/creationModelRegistry'
import {
  buildCreationRunPlan,
  sizeFromRatioResolution,
} from '@/runtime/creation/creationMediaPlan'
import type { CreationFieldSpec, CreationModelSpec, CreationRunPlan } from '@/runtime/creation/creationMediaTypes'
import { fetchCreationModelAvailability } from '@/services/creationModelAvailability'
import { normalizeCreationTextField, sanitizeCreationResults } from '@/utils/creationResults'

// ─── 结果项 ───
export interface CreationResult {
  url: string
  type: 'image' | 'video' | 'audio' | 'text' | 'failed' | 'unknown'
  content?: string
  model: string
  task: string
  ts: number
  taskId?: string
  errorMsg?: string
  originalUrl?: string
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
  fieldValues: Record<string, string | number | boolean>
  files: File[]
  generating: boolean
  runningTasks: number
  progress: number
  progressText: string
  results: CreationResult[]
}

const STORAGE_KEY = 'jc_cp_state_v3'
const DELETED_KEY = 'jc_cp_deleted_v1'
const MAX_CREATION_FILE_BYTES = 50 * 1024 * 1024
const MAX_DELETED_MARKERS = 200

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

export const RH_TASK_LABELS = MEDIA_TASK_LABELS

function creationFieldToMediaField(field: CreationFieldSpec): MediaModelField {
  return {
    key: field.key,
    label: field.label,
    kind: field.kind,
    required: field.required,
    defaultValue: field.defaultValue,
    options: field.options,
    min: field.min,
    max: field.max,
    step: field.step,
  }
}

function acceptedFilesFor(spec: CreationModelSpec): Array<'image' | 'video' | 'audio'> {
  const accepted = new Set<'image' | 'video' | 'audio'>()
  if (spec.files?.images || spec.capabilities.inputModalities.includes('image')) accepted.add('image')
  if (spec.files?.videos || spec.capabilities.inputModalities.includes('video')) accepted.add('video')
  if (spec.files?.audios || spec.capabilities.inputModalities.includes('audio')) accepted.add('audio')
  return [...accepted]
}

function maxFilesFor(spec: CreationModelSpec): number | undefined {
  const values = [
    spec.files?.images?.max,
    spec.files?.videos?.max,
    spec.files?.audios?.max,
  ].filter((value): value is number => typeof value === 'number')
  if (values.length) return values.reduce((sum, value) => sum + value, 0)
  return acceptedFilesFor(spec).length ? 8 : undefined
}

function specToCreationModel(spec: CreationModelSpec): CreationModel {
  const fields = spec.fields.map(creationFieldToMediaField)
  const capability: MediaModelCapability = {
    id: spec.id,
    label: spec.label,
    task: spec.task,
    model: spec.model,
    provider: spec.source === 'runninghub'
      ? spec.task === 'audio' ? 'gateway-audio' : spec.task === 'image' ? 'gateway-image' : 'gateway-video'
      : spec.task === 'audio' ? 'gateway-audio' : spec.task === 'image' ? 'gateway-image' : 'gateway-video',
    endpoint: spec.endpoint,
    webappId: spec.route === 'runninghub-adapter' ? spec.id : undefined,
    maxFiles: maxFilesFor(spec),
    acceptedFiles: acceptedFilesFor(spec),
    fields,
  }
  const ratios = spec.capabilities.ratios || fieldOptions(fields, ['aspect_ratio', 'ratio', 'aspectRatio'])
  const resolutions = spec.capabilities.resolutions || fieldOptions(fields, ['resolution'])
  const sizes = fieldOptions(fields, ['size'])
  const duration = durationValuesFor(spec)
  return {
    label: spec.label,
    tasks: [spec.task],
    provider: spec.source === 'runninghub'
      ? spec.task === 'audio' ? 'gateway-suno' : spec.task === 'image' ? 'runninghub-image' : 'runninghub-video'
      : spec.task === 'audio' ? 'gateway-suno' : spec.task === 'image' ? 'gateway-image' : 'gateway-video',
    modelName: spec.model,
    capability,
    sizes,
    defSize: defaultFieldValue(fields, 'size') || sizes[0],
    ar: ratios,
    defAr: defaultFieldValue(fields, 'aspect_ratio') || defaultFieldValue(fields, 'ratio') || defaultFieldValue(fields, 'aspectRatio') || ratios[0],
    res: resolutions,
    defRes: defaultFieldValue(fields, 'resolution') || resolutions[0],
    dur: duration,
    defDur: Number(defaultFieldValue(fields, 'duration')) || duration[0],
    maxFiles: capability.maxFiles,
    acceptedFiles: capability.acceptedFiles,
    sunoMv: defaultFieldValue(fields, 'mv'),
  }
}

function fieldOptions(fields: MediaModelField[], keys: string[]): string[] {
  const field = fields.find(item => keys.includes(item.key))
  return field?.options?.map(option => String(option.value)) || []
}

function defaultFieldValue(fields: MediaModelField[], key: string): string {
  const field = fields.find(item => item.key === key)
  return field?.defaultValue !== undefined ? String(field.defaultValue) : ''
}

function durationValuesFor(spec: CreationModelSpec): number[] {
  const duration = spec.capabilities.duration
  if (duration?.allowedValues?.length) return duration.allowedValues
  if (duration?.min !== undefined && duration.max !== undefined) {
    const values: number[] = []
    for (let value = duration.min; value <= duration.max; value += 1) values.push(value)
    return values
  }
  const field = spec.fields.find(item => item.key === 'duration')
  if (field?.options?.length) return field.options.map(option => Number(option.value)).filter(Number.isFinite)
  if (field?.kind === 'number' && field.min !== undefined && field.max !== undefined) {
    const values: number[] = []
    const step = field.step && field.step > 0 ? field.step : 1
    for (let value = field.min; value <= field.max; value += step) values.push(value)
    return values
  }
  return []
}

export const CREATION_PANEL_MODELS: Record<string, CreationModel> = Object.fromEntries(
  CREATION_MODEL_REGISTRY.map(spec => [spec.id, specToCreationModel(spec)]),
)

export function getVisibleCreationTasks(): CreationTask[] {
  return (Object.keys(MEDIA_TASK_LABELS) as CreationTask[])
    .filter(task => listCreationModels({ task }).length > 0)
}

function getModelsForTask(task: CreationTask): string[] {
  return listCreationModels({ task }).map(model => model.id)
}

function getMediaFieldCompat(model: CreationModel | undefined, key: string): MediaModelField | undefined {
  return model?.capability.fields.find(field => field.key === key)
}

function mediaFieldOptionsCompat(model: CreationModel | undefined, key: string) {
  return getMediaFieldCompat(model, key)?.options || []
}

function loadDeletedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveDeletedSet(set: Set<string>) {
  try {
    const arr = [...set].slice(-MAX_DELETED_MARKERS)
    localStorage.setItem(DELETED_KEY, JSON.stringify(arr))
  } catch {
    /* noop */
  }
}

const deletedSet = loadDeletedSet()

function normalizeSavedTask(task: unknown): CreationTask {
  let normalized: CreationTask = 'image'
  if (task === 'text-video' || task === 'image-video') normalized = 'video'
  else if (task === 'text-music') normalized = 'audio'
  else if (task === 'text-image' || task === 'image-image') normalized = 'image'
  else if (task === 'image' || task === 'video' || task === 'digital-human' || task === 'audio') normalized = task

  const visibleTasks = getVisibleCreationTasks()
  if (visibleTasks.includes(normalized)) return normalized
  return visibleTasks[0] || 'image'
}

function normalizeSavedModel(modelKey: unknown, task: CreationTask): string {
  const key = String(modelKey || '')
  const directSpec = getCreationModelSpec(key)
  if (directSpec?.task === task) return directSpec.id
  const migratedSpec = CREATION_MODEL_REGISTRY.find(spec => spec.model === key || spec.aliases?.includes(key))
  if (migratedSpec?.task === task) return migratedSpec.id
  return getModelsForTask(task)[0] || 'gpt-image-2'
}

function normalizeSavedFieldValues(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const output: Record<string, string | number | boolean> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') output[key] = raw
  }
  return output
}

const initialTask = normalizeSavedTask(saved.task)

export const cpState = reactive<CpState>({
  task: initialTask,
  modelKey: normalizeSavedModel(saved.modelKey, initialTask),
  prompt: normalizeCreationTextField(saved.prompt),
  tags: normalizeCreationTextField(saved.tags),
  title: normalizeCreationTextField(saved.title),
  negativeTags: normalizeCreationTextField((saved as any).negativeTags),
  text: normalizeCreationTextField((saved as any).text),
  refText: normalizeCreationTextField((saved as any).refText),
  voicePrompt: normalizeCreationTextField((saved as any).voicePrompt),
  language: normalizeCreationTextField((saved as any).language, '中文'),
  startTime: normalizeCreationTextField((saved as any).startTime, '0:00'),
  endTime: normalizeCreationTextField((saved as any).endTime, '0:11'),
  width: Number((saved as any).width || 540),
  height: Number((saved as any).height || 960),
  value: Number((saved as any).value || 832),
  mv: normalizeCreationTextField((saved as any).mv, 'chirp-fenix'),
  ar: normalizeCreationTextField(saved.ar, '16:9'),
  size: normalizeCreationTextField(saved.size, 'auto'),
  res: normalizeCreationTextField(saved.res, '720P'),
  dur: saved.dur || 5,
  fieldValues: normalizeSavedFieldValues((saved as any).fieldValues),
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
      language, startTime, endTime, width, height, value, mv, ar, size, res, dur, fieldValues, results,
    } = cpState
    // BUG-4 修复: 限制保存的结果数量，避免 URL 累积超过 localStorage 5MB 限制
    const trimmedResults = sanitizeCreationResults<CreationResult>(results, { forStorage: true })
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      task, modelKey, prompt, tags, title, negativeTags, text, refText, voicePrompt,
      language, startTime, endTime, width, height, value, mv, ar, size, res, dur, fieldValues,
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
  () => CREATION_PANEL_MODELS[cpState.modelKey]
)
export const currentCreationSpec = computed(() => getCreationModelSpec(cpState.modelKey))

export const availableModels = computed(() => getModelsForTask(cpState.task))
export const currentModelAvailability = computed(() => {
  const model = currentModel.value
  if (!model) return undefined
  return getMediaModelAvailability(model.capability.id) || getMediaModelAvailability(model.modelName)
})

export interface CreationMaterializedFiles {
  images: unknown[]
  videos: unknown[]
  audios: unknown[]
}

function isFieldValuePresent(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim() !== ''
  return true
}

const MATERIALIZED_MEDIA_FIELD_KINDS = new Set(['image', 'images', 'video', 'audio'])

const FIXED_UI_FIELD_KEYS = new Set([
  'prompt',
  'ratio',
  'aspectRatio',
  'aspect_ratio',
  'resolution',
  'duration',
  'size',
  'response_format',
  'image',
  'images',
  'video',
  'videos',
  'audio',
  'audios',
  'title',
  'tags',
  'negative_tags',
  'make_instrumental',
  'mv',
  'language',
  'start_time',
  'end_time',
  'ref_text',
  'text',
  'voice_prompt',
  'width',
  'height',
  'value',
])

function modelFieldParams(): Record<string, unknown> {
  const spec = currentCreationSpec.value
  if (!spec) return {}
  const output: Record<string, unknown> = {}
  for (const field of spec.fields) {
    if (field.kind === 'prompt' || MATERIALIZED_MEDIA_FIELD_KINDS.has(field.kind)) continue
    const savedValue = cpState.fieldValues[field.key]
    if (isFieldValuePresent(savedValue)) {
      output[field.key] = savedValue
    } else if (isFieldValuePresent(field.defaultValue)) {
      output[field.key] = field.defaultValue
    }
  }
  return output
}

function splitCurrentFiles(): CreationMaterializedFiles {
  const images = cpState.files.filter(file => file.type.startsWith('image/'))
  const videos = cpState.files.filter(file => file.type.startsWith('video/'))
  const audios = cpState.files.filter(file => file.type.startsWith('audio/'))
  return { images, videos, audios }
}

export function buildCurrentCreationParams(materializedFiles?: Partial<CreationMaterializedFiles>): Record<string, unknown> {
  const currentFiles = splitCurrentFiles()
  const images = materializedFiles?.images || currentFiles.images
  const videos = materializedFiles?.videos || currentFiles.videos
  const audios = materializedFiles?.audios || currentFiles.audios
  return {
    ...modelFieldParams(),
    prompt: cpState.prompt,
    title: cpState.title,
    tags: cpState.tags,
    negative_tags: cpState.negativeTags,
    text: cpState.text,
    ref_text: cpState.refText,
    voice_prompt: cpState.voicePrompt,
    language: cpState.language,
    start_time: cpState.startTime,
    end_time: cpState.endTime,
    width: cpState.width,
    height: cpState.height,
    value: cpState.value,
    ratio: cpState.ar,
    aspectRatio: cpState.ar,
    aspect_ratio: cpState.ar,
    resolution: cpState.res,
    duration: cpState.dur,
    size: cpState.size,
    response_format: 'url',
    mv: cpState.mv,
    images,
    videos,
    audios,
    image: images,
    video: videos[0],
    audio: audios[0],
  }
}

export const currentRunPlan = computed<CreationRunPlan | null>(() => {
  try {
    if (!currentCreationSpec.value) return null
    return buildCreationRunPlan({
      modelId: currentCreationSpec.value.id,
      params: buildCurrentCreationParams(),
    })
  } catch {
    return null
  }
})

export const currentRunPlanError = computed(() => {
  try {
    if (!currentCreationSpec.value) return '请先选择模型'
    buildCreationRunPlan({
      modelId: currentCreationSpec.value.id,
      params: buildCurrentCreationParams(),
    })
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e || '参数校验失败')
  }
})

export const currentSubmitSummary = computed(() =>
  currentRunPlan.value?.submitSummary || currentRunPlanError.value || '请补充生成参数'
)

export const currentContractWarnings = computed(() =>
  currentRunPlan.value?.warnings || currentCreationSpec.value?.contractIssues || []
)

export const aspectOptions = computed(() =>
  currentModel.value ? (currentCreationSpec.value?.capabilities.ratios || getAspectOptions(currentModel.value, cpState.task)) : []
)

export const sizeOptions = computed(() =>
  currentModel.value ? getSizeOptions(currentModel.value) : []
)

export const resolutionOptions = computed(() =>
  currentModel.value ? (currentCreationSpec.value?.capabilities.resolutions || getResolutionOptions(currentModel.value)) : []
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
export const genericModelFields = computed(() =>
  modelFields.value.filter(field =>
    !FIXED_UI_FIELD_KEYS.has(field.key)
    && field.kind !== 'prompt'
    && !MATERIALIZED_MEDIA_FIELD_KINDS.has(field.kind),
  )
)
export const showNegativeTagsInput = computed(() => Boolean(getMediaFieldCompat(currentModel.value, 'negative_tags')))
export const showMvSelect = computed(() => Boolean(getMediaFieldCompat(currentModel.value, 'mv')))
export const mvOptions = computed(() => mediaFieldOptionsCompat(currentModel.value, 'mv').map(option => String(option.value)))
export const languageOptions = computed(() => mediaFieldOptionsCompat(currentModel.value, 'language').map(option => String(option.value)))
export const showTextInput = computed(() => Boolean(getMediaFieldCompat(currentModel.value, 'text')))
export const showRefTextInput = computed(() => Boolean(getMediaFieldCompat(currentModel.value, 'ref_text')))
export const showVoicePromptInput = computed(() => Boolean(getMediaFieldCompat(currentModel.value, 'voice_prompt')))
export const showStartEndTimeInput = computed(() => Boolean(getMediaFieldCompat(currentModel.value, 'start_time') || getMediaFieldCompat(currentModel.value, 'end_time')))
export const showWidthHeightInput = computed(() => Boolean(getMediaFieldCompat(currentModel.value, 'width') || getMediaFieldCompat(currentModel.value, 'height')))
export const showValueInput = computed(() => Boolean(getMediaFieldCompat(currentModel.value, 'value')))
export const showLanguageSelect = computed(() => Boolean(getMediaFieldCompat(currentModel.value, 'language')))

// ─── 操作 ───
export function switchTask(task: CreationTask) {
  cpState.task = normalizeSavedTask(task)
  const models = availableModels.value
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
  const mv = getMediaFieldCompat(m, 'mv')
  if (mv?.defaultValue && !mvOptions.value.includes(cpState.mv)) cpState.mv = String(mv.defaultValue)
  const language = getMediaFieldCompat(m, 'language')
  if (language?.defaultValue && !languageOptions.value.includes(cpState.language)) cpState.language = String(language.defaultValue)
  const width = getMediaFieldCompat(m, 'width')
  if (width?.defaultValue !== undefined) cpState.width = Number(cpState.width || width.defaultValue)
  const height = getMediaFieldCompat(m, 'height')
  if (height?.defaultValue !== undefined) cpState.height = Number(cpState.height || height.defaultValue)
  const value = getMediaFieldCompat(m, 'value')
  if (value?.defaultValue !== undefined) cpState.value = Number(cpState.value || value.defaultValue)
}

export function setAspect(ar: string) { cpState.ar = ar; saveCpState() }
export function setSize(size: string) { cpState.size = size; saveCpState() }
export function setResolution(res: string) { cpState.res = res; saveCpState() }
export function setDuration(dur: number) { cpState.dur = dur; saveCpState() }
export function setMv(mv: string) { cpState.mv = mv; saveCpState() }
export function setLanguage(language: string) { cpState.language = language; saveCpState() }
export function getModelFieldValue(field: CreationFieldSpec): string | number | boolean {
  const value = cpState.fieldValues[field.key]
  if (isFieldValuePresent(value)) return value
  if (isFieldValuePresent(field.defaultValue)) return field.defaultValue as string | number | boolean
  if (field.kind === 'number') return field.min ?? 0
  if (field.kind === 'boolean') return false
  return ''
}

export function setModelFieldValue(field: CreationFieldSpec, value: string | number | boolean) {
  cpState.fieldValues[field.key] = value
  saveCpState()
}

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

export function replaceFilesForMediaKind(kind: 'image' | 'video' | 'audio', fileList: FileList | File[]) {
  const accepted = currentModel.value?.acceptedFiles || []
  if (!accepted.includes(kind)) return
  for (let i = cpState.files.length - 1; i >= 0; i--) {
    if (cpState.files[i].type.startsWith(`${kind}/`)) cpState.files.splice(i, 1)
  }
  addFiles(Array.from(fileList).filter(file => file.type.startsWith(`${kind}/`)).slice(0, 1))
}

export function removeFile(index: number) { cpState.files.splice(index, 1) }
export function clearFiles() { cpState.files.splice(0) }

export async function refreshCreationModelAvailability(): Promise<void> {
  try {
    const availability = await fetchCreationModelAvailability()
    setMediaModelAvailability(availability)
    if (!availableModels.value.includes(cpState.modelKey)) {
      cpState.modelKey = availableModels.value[0] || 'gpt-image-2'
      syncParams()
      saveCpState()
    }
  } catch (e) {
    clearMediaModelAvailability()
    console.warn('[Creation] model availability fallback to local catalog:', e)
  }
}

// ─── 结果管理 ───
export function addResult(r: CreationResult) { cpState.results.unshift(r); saveCpState() }
export function clearResults() {
  cpState.results.splice(0)
  deletedSet.clear()
  saveDeletedSet(deletedSet)
  saveCpState()
}

export function markResultDeleted(result: CreationResult) {
  if (result.taskId) deletedSet.add(`task:${result.taskId}`)
  if (result.originalUrl) deletedSet.add(`url:${result.originalUrl}`)
  if (result.url) deletedSet.add(`url:${result.url}`)
  saveDeletedSet(deletedSet)
}

export function isResultDeleted(taskId?: string, url?: string): boolean {
  if (taskId && deletedSet.has(`task:${taskId}`)) return true
  if (url && deletedSet.has(`url:${url}`)) return true
  return false
}

// ─── 提示词 placeholder ───
export const promptPlaceholder = computed(() => {
  const model = currentCreationSpec.value?.model || cpState.modelKey
  if (model === 'rh-suno-v55-single') return '一句话描述歌曲主题、氛围、乐器、情绪'
  if (model === 'rh-suno-v55-custom') return '填写歌词，建议使用 [Verse] / [Chorus] / [Bridge] 结构'
  if (model === 'rh-suno-lyrics') return '一句话描述歌词主题、情绪和表达方向'
  if (model === 'suno_music') return '输入歌词或音乐创作提示词'
  if (model === 'rh-aiapp-director') return '简单说下动作是啥'
  if (model === 'rh-aiapp-voice-design') return '主要文稿请填写在“文稿”字段'
  return '描述你想生成的内容...'
})

export const showTagsInput = computed(() => Boolean(getMediaFieldCompat(currentModel.value, 'tags')))
export const showTitleInput = computed(() => Boolean(getMediaFieldCompat(currentModel.value, 'title')))
