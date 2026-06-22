import {
  getCreationModelSpec,
} from './creationModelRegistry'
import type {
  CreationApiStyle,
  CreationAssetFlow,
  CreationMode,
  CreationModelSpec,
  CreationPollKind,
  CreationRunPlan,
  CreationRunPlanInput,
} from './creationMediaTypes'

const SOURCE_LABELS = {
  'newapi-direct': '直连',
  runninghub: 'RunningHub',
} as const

const UPSTREAM_LABELS = {
  t8: 'T8',
  volcengine: '火山',
  worldrouter: 'WorldRouter',
  trump: '特朗普',
  runninghub: 'RH 官方 API',
  'openai-compatible': 'OpenAI-compatible',
  unknown: '未知上游',
} as const

export function validateCreationModelSpec(spec: CreationModelSpec): void {
  if (spec.contractStatus === 'broken') {
    const reason = spec.contractIssues?.[0] || '上游渠道不可用'
    throw new Error(`模型 ${spec.label} 当前不可用：${reason}`)
  }
  if (spec.route === 'runninghub-adapter' && spec.source !== 'runninghub') {
    throw new Error('runninghub-adapter route requires source runninghub')
  }
  if (spec.route === 'runninghub-adapter' && spec.upstreamFamily !== 'runninghub') {
    throw new Error('runninghub-adapter route requires upstreamFamily runninghub')
  }
  if (spec.route === 'runninghub-adapter' && !['rh-standard', 'rh-aiapp'].includes(spec.apiStyle)) {
    throw new Error('runninghub-adapter route requires RH apiStyle')
  }
  if (spec.route === 'newapi-direct' && spec.source !== 'newapi-direct') {
    throw new Error('newapi-direct route requires source newapi-direct')
  }
  if (spec.route === 'newapi-direct' && ['rh-standard', 'rh-aiapp'].includes(spec.apiStyle)) {
    throw new Error('newapi-direct route does not allow RH apiStyle')
  }
  if (!spec.endpoint.startsWith('/')) {
    throw new Error(`Creation endpoint must be a NewAPI path: ${spec.endpoint}`)
  }
  if (/runninghub\.ai|www\.runninghub/i.test(spec.endpoint)) {
    throw new Error(`Creation endpoint must not be an official RunningHub domain: ${spec.endpoint}`)
  }
}

export function buildCreationRunPlan(input: CreationRunPlanInput): CreationRunPlan {
  const spec = getCreationModelSpec(input.modelId)
  if (!spec) throw new Error(`Unknown creation model: ${input.modelId}`)
  validateCreationModelSpec(spec)

  const params = input.params || {}
  validatePlanInputs(spec, params)
  const warnings = buildWarnings(spec)
  const referenceImageCount = countReferences(params, ['images', 'image', 'imageUrl', 'imageUrls'])
  const referenceVideoCount = countReferences(params, ['videos', 'video', 'videoUrl', 'videoUrls'])
  const referenceAudioCount = countReferences(params, ['audios', 'audio', 'audioUrl', 'audioUrls'])
  const effective = resolveEffectiveContract(spec, referenceImageCount)
  const normalizedParams = normalizeParams(spec, params, effective.apiStyle)
  assertParamShape(effective.apiStyle, normalizedParams)

  const usesRhAdapter = spec.route === 'runninghub-adapter'

  const plan: CreationRunPlan = {
    modelId: spec.id,
    model: spec.model,
    label: spec.label,
    task: spec.task,
    source: spec.source,
    route: spec.route,
    upstreamFamily: spec.upstreamFamily,
    apiStyle: effective.apiStyle,
    mode: effective.mode,
    contractStatus: spec.contractStatus,
    endpoint: effective.endpoint,
    usesRhAdapter,
    pollKind: effective.pollKind,
    assetFlow: effective.assetFlow,
    submitSummary: '',
    price: spec.price,
    warnings: warnings.length ? warnings : undefined,
    debug: {
      referenceImageCount,
      referenceVideoCount,
      referenceAudioCount,
      normalizedParams,
    },
  }

  if (spec.source !== 'runninghub' && plan.usesRhAdapter) {
    throw new Error('NewAPI direct model must not use rh-adapter')
  }

  plan.submitSummary = buildSubmitSummary(plan)
  return plan
}

function buildWarnings(spec: CreationModelSpec): string[] {
  const warnings: string[] = []
  if (spec.contractStatus === 'broken') {
    warnings.push('该模型上游渠道已损坏，不应被提交。')
  }
  if (spec.contractStatus === 'degraded') {
    warnings.push('该模型上游渠道不稳定（偶发 522 等），可能需重试。')
  }
  if (spec.contractStatus === 'partial') {
    warnings.push('该模型参数契约为部分核对，未覆盖的官方能力会按当前适配字段提交。')
  }
  if (spec.contractStatus === 'unknown') {
    warnings.push('该模型参数契约待核对，仅进行基础校验。')
  }
  for (const issue of spec.contractIssues || []) warnings.push(issue)
  return warnings
}

function resolveEffectiveContract(spec: CreationModelSpec, referenceImageCount: number): {
  apiStyle: CreationApiStyle
  mode: CreationMode
  endpoint: string
  pollKind: CreationPollKind
  assetFlow: CreationAssetFlow
} {
  if (spec.source === 'newapi-direct' && (spec.apiStyle === 'openai-images' || spec.apiStyle === 'openai-image-edits')) {
    if (referenceImageCount > 0) {
      return {
        apiStyle: 'openai-image-edits',
        mode: 'image-to-image',
        endpoint: '/v1/images/edits',
        pollKind: spec.poll?.kind || 'none',
        assetFlow: 'newapi-upload',
      }
    }
    return {
      apiStyle: 'openai-images',
      mode: 'text-to-image',
      endpoint: '/v1/images/generations',
      pollKind: spec.poll?.kind || 'none',
      assetFlow: 'none',
    }
  }

  // 通用：有参考图时自动切换 mode 为 image-to-image（保持 endpoint 和 apiStyle 不变）
  const effectiveMode: CreationMode = referenceImageCount > 0 && spec.mode === 'text-to-image'
    ? 'image-to-image'
    : spec.mode

  return {
    apiStyle: spec.apiStyle,
    mode: effectiveMode,
    endpoint: spec.endpoint,
    pollKind: spec.poll?.kind || 'none',
    assetFlow: spec.capabilities.assetFlow,
  }
}

function normalizeParams(spec: CreationModelSpec, params: Record<string, unknown>, apiStyle: CreationApiStyle): Record<string, unknown> {
  if (apiStyle === 'openai-images' || apiStyle === 'openai-image-edits') {
    return normalizeOpenAiImageParams(spec, params)
  }
  if (apiStyle === 'rh-standard' || apiStyle === 'rh-aiapp') {
    return normalizeRunningHubParams(spec, params)
  }
  return normalizeGenericTaskParams(spec, params)
}

function normalizeOpenAiImageParams(spec: CreationModelSpec, params: Record<string, unknown>): Record<string, unknown> {
  const size = typeof params.size === 'string' && params.size !== 'auto'
    ? params.size
    : sizeFromRatioResolution(String(firstValue(params, ['ratio', 'aspectRatio', 'aspect_ratio']) || '1:1'), String(params.resolution || '2k'))
  return compact({
    model: spec.model,
    prompt: params.prompt,
    size,
    image: params.image,
    images: params.images,
    imageUrl: params.imageUrl,
    imageUrls: params.imageUrls,
    response_format: params.response_format || 'url',
  })
}

function normalizeRunningHubParams(spec: CreationModelSpec, params: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model: spec.model,
    prompt: params.prompt,
    image: params.image,
    images: params.images,
    imageUrl: params.imageUrl,
    imageUrls: params.imageUrls,
    video: params.video,
    videos: params.videos,
    videoUrl: params.videoUrl,
    videoUrls: params.videoUrls,
    audio: params.audio,
    audios: params.audios,
    audioUrl: params.audioUrl,
    audioUrls: params.audioUrls,
    value: params.value,
    text: params.text,
    width: params.width,
    height: params.height,
    start_time: params.start_time,
    end_time: params.end_time,
    ref_text: params.ref_text,
    language: params.language,
    voice_prompt: params.voice_prompt,
    title: params.title,
    tags: params.tags,
    negative_tags: params.negative_tags,
    make_instrumental: params.make_instrumental,
    lora: params.lora,
    lora_strength: params.lora_strength,
    outputFormat: params.outputFormat || params.output_format,
  }
  if (spec.task === 'image' || spec.task === 'video') {
    base.aspectRatio = firstValue(params, ['aspectRatio', 'ratio', 'aspect_ratio']) || '16:9'
    base.resolution = params.resolution || (spec.task === 'image' ? '1k' : '720p')
  }
  if (spec.task === 'video') base.duration = params.duration

  // ★ Phase 1a: 从 CreationModelSpec.fields 自动透传白名单外的字段
  // 这确保新模型的独有参数（hd, quality, stylize, chaos, variant, customWidth, customHight 等）
  // 不会被白名单丢弃。已有字段不受影响。
  for (const field of spec.fields || []) {
    if (!(field.key in base) && field.key in params && params[field.key] !== undefined) {
      base[field.key] = params[field.key]
    }
  }

  return compact(base)
}

function normalizeGenericTaskParams(spec: CreationModelSpec, params: Record<string, unknown>): Record<string, unknown> {
  return compact({
    model: spec.model,
    prompt: params.prompt,
    ratio: params.ratio || params.aspectRatio,
    aspect_ratio: firstValue(params, ['aspect_ratio', 'ratio', 'aspectRatio']),
    resolution: params.resolution,
    duration: params.duration,
    images: params.images,
    image: params.image,
    imageUrl: params.imageUrl,
    imageUrls: params.imageUrls,
    video: params.video,
    videoUrl: params.videoUrl,
    audio: params.audio,
    audioUrl: params.audioUrl,
    title: params.title,
    tags: params.tags,
  })
}

function assertParamShape(apiStyle: CreationApiStyle, normalizedParams: Record<string, unknown>): void {
  if ((apiStyle === 'openai-images' || apiStyle === 'openai-image-edits') && ('aspectRatio' in normalizedParams || 'resolution' in normalizedParams)) {
    throw new Error('OpenAI image plan must not contain RH aspectRatio/resolution payload')
  }
  if ((apiStyle === 'rh-standard' || apiStyle === 'rh-aiapp') && 'size' in normalizedParams) {
    throw new Error('RunningHub plan must not contain GPT Image size payload')
  }
}

export function sizeFromRatioResolution(ratio: string, resolution: string): string {
  const normalizedResolution = resolution.toLowerCase()
  if (normalizedResolution === '4k') {
    if (ratio === '16:9') return '3840x2160'
    if (ratio === '9:16') return '2160x3840'
    if (ratio === '1:1') return '2048x2048'
  }
  if (normalizedResolution === '1k') {
    if (ratio === '16:9') return '1536x1024'
    if (ratio === '9:16') return '1024x1536'
    if (ratio === '1:1') return '1024x1024'
  }
  if (ratio === '16:9') return '2048x1152'
  if (ratio === '9:16') return '1152x2048'
  return '2048x2048'
}

function buildSubmitSummary(plan: CreationRunPlan): string {
  const parts = [
    SOURCE_LABELS[plan.source],
    UPSTREAM_LABELS[plan.upstreamFamily],
    modeLabel(plan.mode),
  ]
  if (plan.debug.referenceImageCount) parts.push(`参考图 ${plan.debug.referenceImageCount} 张`)
  if (plan.debug.referenceVideoCount) parts.push(`视频 ${plan.debug.referenceVideoCount} 段`)
  if (plan.debug.referenceAudioCount) parts.push(`音频 ${plan.debug.referenceAudioCount} 段`)
  for (const key of ['size', 'aspectRatio', 'resolution', 'duration']) {
    if (plan.debug.normalizedParams[key] !== undefined) {
      parts.push(`${key}=${String(plan.debug.normalizedParams[key])}`)
    }
  }
  parts.push(plan.pollKind === 'none' ? '同步返回' : plan.pollKind)
  parts.push(plan.assetFlow)
  return parts.join(' · ')
}

function modeLabel(mode: CreationRunPlan['mode']): string {
  const labels: Record<CreationRunPlan['mode'], string> = {
    'text-to-image': '文生图',
    'image-to-image': '图生图',
    'text-to-video': '文生视频',
    'image-to-video': '图生视频',
    'video-edit': '视频编辑',
    'text-to-audio': '文生音频',
    lyrics: '歌词',
    'digital-human': '数字人',
    'voice-clone': '声音克隆',
    'voice-design': '声音设计',
    workflow: '工作流',
  }
  return labels[mode]
}

function countReferences(params: Record<string, unknown>, keys: string[]): number {
  const seen = new Set<string>()
  for (const key of keys) {
    const value = params[key]
    if (Array.isArray(value)) {
      for (const item of value) {
        const normalized = normalizeReferenceValue(item)
        if (normalized) seen.add(normalized)
      }
    } else {
      const normalized = normalizeReferenceValue(value)
      if (normalized) seen.add(normalized)
    }
  }
  return seen.size
}

function validatePlanInputs(spec: CreationModelSpec, params: Record<string, unknown>): void {
  validateFileCounts(spec, params)
  validateRequiredFields(spec, params)
  for (const field of spec.fields) {
    const value = valueForField(params, field.key)
    validateSelectField(field, value)
    validateNumberField(field, value)
  }
  validateDurationCapability(spec, params)
}

function validateRequiredFields(spec: CreationModelSpec, params: Record<string, unknown>): void {
  const missing = spec.fields.filter(field => field.required && isBlank(valueForField(params, field.key)))
  if (missing.length) {
    throw new Error(`缺少必填字段：${missing.map(field => field.label).join('、')}`)
  }
}

function validateFileCounts(spec: CreationModelSpec, params: Record<string, unknown>): void {
  const checks = [
    { label: '参考图', limit: spec.files?.images, count: countReferences(params, ['images', 'image', 'imageUrl', 'imageUrls']) },
    { label: '视频', limit: spec.files?.videos, count: countReferences(params, ['videos', 'video', 'videoUrl', 'videoUrls']) },
    { label: '音频', limit: spec.files?.audios, count: countReferences(params, ['audios', 'audio', 'audioUrl', 'audioUrls']) },
  ]
  for (const check of checks) {
    if (!check.limit) continue
    if (check.limit.min !== undefined && check.count < check.limit.min) {
      throw new Error(`${check.label}至少需要 ${check.limit.min} 个`)
    }
    if (check.limit.max !== undefined && check.count > check.limit.max) {
      throw new Error(`${check.label}最多支持 ${check.limit.max} 个`)
    }
  }
}

function validateSelectField(field: CreationModelSpec['fields'][number], value: unknown): void {
  if (!field.options?.length || isBlank(value)) return
  const allowed = field.options.some(option => String(option.value) === String(value))
  if (!allowed) throw new Error(`${field.label}不支持：${String(value)}`)
}

function validateNumberField(field: CreationModelSpec['fields'][number], value: unknown): void {
  if (field.kind !== 'number' || isBlank(value)) return
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) throw new Error(`${field.label}必须是数字`)
  if (field.min !== undefined && numeric < field.min) throw new Error(`${field.label}不能小于 ${field.min}`)
  if (field.max !== undefined && numeric > field.max) throw new Error(`${field.label}不能大于 ${field.max}`)
  if (field.step !== undefined && field.step > 0) {
    const base = field.min ?? 0
    const steps = (numeric - base) / field.step
    if (Math.abs(steps - Math.round(steps)) > 1e-8) throw new Error(`${field.label}必须按 ${field.step} 递增`)
  }
}

function validateDurationCapability(spec: CreationModelSpec, params: Record<string, unknown>): void {
  const duration = params.duration
  if (isBlank(duration) || !spec.capabilities.duration) return
  const numeric = Number(duration)
  if (!Number.isFinite(numeric)) throw new Error('时长必须是数字')
  const { min, max, allowedValues } = spec.capabilities.duration
  if (allowedValues?.length && !allowedValues.includes(numeric)) {
    throw new Error(`时长不支持：${duration}`)
  }
  if (min !== undefined && numeric < min) throw new Error(`时长不能小于 ${min}`)
  if (max !== undefined && numeric > max) throw new Error(`时长不能大于 ${max}`)
}

function valueForField(params: Record<string, unknown>, key: string): unknown {
  if (key === 'prompt') return params.prompt
  if (key === 'aspect_ratio' || key === 'ratio' || key === 'aspectRatio') return firstValue(params, ['aspect_ratio', 'ratio', 'aspectRatio'])
  if (key === 'image' || key === 'images') return firstValue(params, ['images', 'image', 'imageUrl', 'imageUrls'])
  if (key === 'video' || key === 'videos') return firstValue(params, ['videos', 'video', 'videoUrl', 'videoUrls'])
  if (key === 'audio' || key === 'audios') return firstValue(params, ['audios', 'audio', 'audioUrl', 'audioUrls'])
  if (key === 'response_format') return params.response_format ?? params.responseFormat
  if (key === 'negative_tags') return params.negative_tags ?? params.negativeTags
  if (key === 'make_instrumental') return params.make_instrumental ?? params.makeInstrumental
  return params[key]
}

function firstValue(params: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = params[key]
    if (Array.isArray(value)) {
      if (value.length) return value
    } else if (!isBlank(value)) {
      return value
    }
  }
  return undefined
}

function isBlank(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0
  return value === undefined || value === null || String(value).trim().length === 0
}

function normalizeReferenceValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof File !== 'undefined' && value instanceof File) {
    return `file:${value.name}:${value.size}:${value.type}:${value.lastModified}`
  }
  const text = String(value).trim()
  return text
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue
    output[key] = value
  }
  return output
}
