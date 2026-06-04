import { getMediaModel, type MediaModelField } from './mediaModelCapabilities'

export interface MediaModelInputValidationParams {
  modelId: string
  prompt: string
  data?: Record<string, unknown>
  images?: string[]
  videos?: string[]
  audios?: string[]
  emptyMessage: string
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim().length === 0
}

function hasText(value: unknown): boolean {
  return !isBlank(value)
}

function hasMedia(values: string[] | undefined): boolean {
  return Boolean(values?.some(value => String(value || '').trim()))
}

function mediaCount(values: string[] | undefined): number {
  return values?.filter(value => String(value || '').trim()).length || 0
}

function isImageField(field: MediaModelField): boolean {
  return field.kind === 'image' || field.kind === 'images' || /image|frame/i.test(field.key)
}

function isVideoField(field: MediaModelField): boolean {
  return field.kind === 'video' || /video/i.test(field.key)
}

function isAudioField(field: MediaModelField): boolean {
  return field.kind === 'audio' || /audio/i.test(field.key)
}

function valueForField(params: MediaModelInputValidationParams, field: MediaModelField): unknown {
  const key = field.key
  const data = params.data || {}
  if (key === 'prompt') return params.prompt
  if (isImageField(field)) return hasMedia(params.images) ? params.images?.[0] : ''
  if (isVideoField(field)) return hasMedia(params.videos) ? params.videos?.[0] : ''
  if (isAudioField(field)) return hasMedia(params.audios) ? params.audios?.[0] : ''
  if (key === 'aspect_ratio' || key === 'ratio' || key === 'aspectRatio') return data[key] ?? data.aspectRatio ?? data.ar
  if (key === 'response_format') return data.responseFormat ?? data.response_format
  if (key === 'ref_text') return data.refText
  if (key === 'voice_prompt') return data.voicePrompt
  if (key === 'start_time') return data.startTime
  if (key === 'end_time') return data.endTime
  if (key === 'negative_tags') return data.negativeTags
  if (key === 'width') return data.outputWidth ?? data.width
  if (key === 'height') return data.outputHeight ?? data.height
  return data[key]
}

function hasRequiredValue(params: MediaModelInputValidationParams, field: MediaModelField): boolean {
  if (isImageField(field)) return hasMedia(params.images)
  if (isVideoField(field)) return hasMedia(params.videos)
  if (isAudioField(field)) return hasMedia(params.audios)
  return hasText(valueForField(params, field))
}

function validateMediaLimits(params: MediaModelInputValidationParams, model: NonNullable<ReturnType<typeof getMediaModel>>): void {
  const imageCount = mediaCount(params.images)
  const videoCount = mediaCount(params.videos)
  const audioCount = mediaCount(params.audios)
  const total = imageCount + videoCount + audioCount

  if (model.maxFiles && total > model.maxFiles) {
    throw new Error(`最多支持 ${model.maxFiles} 个参考文件`)
  }

  if (!model.acceptedFiles?.length) {
    if (total > 0) throw new Error('当前模型不支持参考文件')
    return
  }

  if (imageCount > 0 && !model.acceptedFiles.includes('image')) throw new Error('当前模型不支持图片参考')
  if (videoCount > 0 && !model.acceptedFiles.includes('video')) throw new Error('当前模型不支持视频参考')
  if (audioCount > 0 && !model.acceptedFiles.includes('audio')) throw new Error('当前模型不支持音频参考')
}

function validateSelectField(field: MediaModelField, value: unknown): void {
  if (!field.options?.length || isBlank(value)) return
  const allowed = field.options.some(option => String(option.value) === String(value))
  if (!allowed) throw new Error(`${field.label}超出模型可选范围：${String(value)}`)
}

function validateNumberField(field: MediaModelField, value: unknown): void {
  if (field.kind !== 'number' || isBlank(value)) return
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) throw new Error(`${field.label}必须是数字`)
  if (field.min !== undefined && numeric < field.min) throw new Error(`${field.label}不能小于 ${field.min}`)
  if (field.max !== undefined && numeric > field.max) throw new Error(`${field.label}不能大于 ${field.max}`)
  if (field.step !== undefined && field.step > 0) {
    const base = field.min ?? 0
    const steps = (numeric - base) / field.step
    if (Math.abs(steps - Math.round(steps)) > 1e-8) {
      throw new Error(`${field.label}必须按 ${field.step} 递增`)
    }
  }
}

function validateFieldCapabilities(params: MediaModelInputValidationParams, model: NonNullable<ReturnType<typeof getMediaModel>>): void {
  for (const field of model.fields) {
    const value = valueForField(params, field)
    validateSelectField(field, value)
    validateNumberField(field, value)
  }
}

export function validateMediaModelInputs(params: MediaModelInputValidationParams): void {
  const model = getMediaModel(params.modelId)
  if (model) {
    validateMediaLimits(params, model)
    validateFieldCapabilities(params, model)
  }

  const requiredFields = model?.fields.filter(field => field.required) || []

  if (requiredFields.length) {
    const missing = requiredFields.filter(field => !hasRequiredValue(params, field))
    if (missing.length) {
      throw new Error(`${params.emptyMessage}：${missing.map(field => field.label).join('、')}`)
    }
    return
  }

  const hasDataField = Object.entries(params.data || {}).some(([, value]) => hasText(value))
  const hasAnyMedia = hasMedia(params.images) || hasMedia(params.videos) || hasMedia(params.audios)
  if (!hasText(params.prompt) && !hasDataField && !hasAnyMedia) throw new Error(params.emptyMessage)
}
