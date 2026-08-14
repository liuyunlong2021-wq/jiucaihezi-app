import { buildCreationRunPlan } from '@/runtime/creation/creationMediaPlan'
import {
  displayModelLabel,
  displayModelPrice,
  getCreationModelSpec,
  listCreationModels,
} from '@/runtime/creation/creationModelRegistry'
import type { CreationModelSpec } from '@/runtime/creation/creationMediaTypes'
import { getMediaModelAvailability } from '@/data/mediaModelCapabilities'
import type { MediaReference } from './mediaReference'
/** The only model-authored media payload the app accepts. */
export interface MediaPlan {
  kind: 'image' | 'video' | 'audio' | 'model3d'
  title: string
  prompt: string
  modelId: string
  /** App-owned marker: references may refine an omitted model after they resolve. */
  usesProductDefaultModel?: true
  ratio?: string
  resolution?: string
  duration?: string | number
  referenceIds?: string[]
  /** App-owned resolved values. Model-authored plans cannot provide these fields. */
  referenceImages?: string[]
  referenceVideos?: string[]
  mediaReferences?: MediaReference[]
  mediaOwner?: string
}

export interface MediaPlanParameterPatch {
  prompt?: string
  modelId?: string
  ratio?: string
  resolution?: string
  duration?: string | number
}

export interface MediaPlanEditorOption {
  value: string
  label: string
}

export interface MediaPlanEditorControls {
  models: MediaPlanEditorOption[]
  ratios: MediaPlanEditorOption[]
  resolutions: MediaPlanEditorOption[]
  durations: MediaPlanEditorOption[]
  durationRange?: { min?: number; max?: number; step: number }
}

export const MEDIA_PLAN_POLICY = [
  '媒体执行规则：当用户明确要求生成图片、视频、音频或 3D 模型时，从应用提供的模型目录中选择真实模型和参数，再在最终回复中输出一个 jc-media-plan JSON 代码块。',
  '媒体计划字段：kind(image|video|audio|model3d)、title、prompt；modelId 由应用决定，可按任务补充 ratio、resolution、duration、referenceIds。',
  '用户明确给出媒体提示词或动作描述时，prompt 必须原样使用，不得擅自扩写、润色或替换；只有用户明确要求优化，或没有给出可执行描述时，才可以补全。',
  '不要自行选择默认模型：应用会默认使用当前注册表中的 GPT Image 2 生图；视频按无参考、一张参考图、多素材分别使用标准 Seedance 2.0 文生、图生、多模态。用户可在确认卡手动调整模型。',
  '只能使用应用提供的素材 referenceId；不要输出 referenceImages、referenceVideos、URL、data URL 或文件路径。',
  '不要直接运行媒体 API、轮询或下载；用户确认后由应用的公共媒体任务引擎执行。没有媒体生成意图时不要输出媒体计划。',
].join('\n')

export function buildMediaPlanPolicy(referencePolicy = ''): string {
  const models = listCreationModels()
    .filter(model => model.task === 'image' || model.task === 'video' || model.task === 'audio' || model.task === 'model3d')
    .filter(model => getCreationModelSpec(model.id)?.capabilities.outputModalities.includes(model.task as 'image' | 'video' | 'audio' | 'model3d'))
    .filter(model => isCreationModelAvailable(model.id))
    .map(model => {
      const spec = getCreationModelSpec(model.id)!
      const imageLimit = spec.files?.images
      const duration = spec.capabilities.duration
      return [
        model.id,
        model.task,
        model.label,
        model.mode,
        imageLimit ? `参考图 ${imageLimit.min || 0}-${imageLimit.max ?? '不限'}` : '不支持参考图',
        duration
          ? `时长 ${duration.allowedValues?.join('/') || `${duration.min ?? 0}-${duration.max ?? '不限'}`}s`
          : '',
        `费用 ${displayModelPrice(spec)}`,
      ]
        .filter(Boolean)
        .join(' | ')
    })
  return [MEDIA_PLAN_POLICY, `应用当前可执行媒体模型：\n${models.join('\n')}`, referencePolicy]
    .filter(Boolean)
    .join('\n\n')
}

const MEDIA_PLAN_BLOCK = /```jc-media-plan\s*\n([\s\S]*?)\n```/
const MEDIA_PLAN_BLOCKS = /```jc-media-plan\s*\n[\s\S]*?\n```/g

export function stripMediaPlanBlocks(text: string): string {
  return String(text || '').replace(MEDIA_PLAN_BLOCKS, '').trim()
}

export function replaceMediaPlanModelId(text: string, modelId: string): string {
  const match = String(text || '').match(MEDIA_PLAN_BLOCK)
  if (!match || match.index === undefined) return text
  try {
    const value = JSON.parse(match[1])
    if (!value || typeof value !== 'object' || Array.isArray(value)) return text
    const normalized = JSON.stringify({ ...value, modelId }, null, 2)
    const start = match.index
    const end = start + match[0].length
    return `${text.slice(0, start)}\`\`\`jc-media-plan\n${normalized}\n\`\`\`${text.slice(end)}`
  } catch {
    return text
  }
}

export function parseMediaPlan(text: string): MediaPlan {
  const values = parseMediaPlanValues(text)
  if (values.length !== 1) throw new Error('媒体计划必须是单个 JSON 对象。')
  return normalizeMediaPlan(values[0])
}

export function parseMediaPlans(text: string): MediaPlan[] {
  return parseMediaPlanValues(text).map(normalizeMediaPlan)
}

function parseMediaPlanValues(text: string): Record<string, unknown>[] {
  const match = String(text || '').match(MEDIA_PLAN_BLOCK)
  if (!match) throw new Error('媒体计划必须放在 ```jc-media-plan JSON 代码块中。')

  let value: unknown
  try {
    value = JSON.parse(match[1])
  } catch {
    throw new Error('媒体计划不是有效 JSON。')
  }

  const values = Array.isArray(value) ? value : [value]
  if (!values.length || values.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('媒体计划必须是 JSON 对象或对象数组。')
  }
  return values as Record<string, unknown>[]
}

function normalizeMediaPlan(plan: Record<string, unknown>): MediaPlan {
  if (!['image', 'video', 'audio', 'model3d'].includes(String(plan.kind))) {
    throw new Error('媒体计划只支持 image、video、audio、model3d。')
  }
  for (const field of ['referenceImages', 'referenceVideos']) {
    if (plan[field] !== undefined) throw new Error(`媒体计划的 ${field} 不能由模型提供。`)
  }

  const title = requiredText(plan.title, 'title')
  const prompt = requiredText(plan.prompt, 'prompt')
  const kind = plan.kind as MediaPlan['kind']
  const resolution = optionalText(plan.resolution, 'resolution')

  return {
    kind,
    title,
    prompt,
    modelId: resolveProductDefaultModelId({ kind, resolution }),
    usesProductDefaultModel: true,
    ...(optionalText(plan.ratio, 'ratio') ? { ratio: optionalText(plan.ratio, 'ratio') } : {}),
    ...(resolution ? { resolution } : {}),
    ...(plan.duration === undefined ? {} : { duration: numberOrText(plan.duration, 'duration') }),
    ...(plan.referenceIds === undefined
      ? {}
      : { referenceIds: stringArray(plan.referenceIds, 'referenceIds') }),
  }
}

/**
 * A plan is only valid when the existing Creation registry can execute it.
 * This deliberately delegates option validation to the same code path used by
 * CreationPanel, so the workbench cannot drift into its own model contract.
 */
export function validateMediaPlan(plan: MediaPlan): void {
  const spec = getCreationModelSpec(plan.modelId)
  if (!spec) throw new Error(`媒体计划的模型未注册：${plan.modelId}`)
  if (!isCreationModelAvailable(plan.modelId)) {
    throw new Error(`媒体计划的模型当前不可用：${plan.modelId}`)
  }
  if (spec.task !== plan.kind) throw new Error(`媒体计划类型与模型不匹配：${plan.modelId}`)

  buildCreationRunPlan({
    modelId: plan.modelId,
    params: {
      prompt: plan.prompt,
      ...(plan.ratio ? { ratio: plan.ratio } : {}),
      ...(plan.resolution ? { resolution: plan.resolution } : {}),
      ...(plan.referenceImages?.length ? { images: plan.referenceImages } : {}),
      ...(plan.referenceVideos?.length ? { videos: plan.referenceVideos } : {}),
      ...(plan.duration !== undefined ? { duration: plan.duration } : {}),
    },
  })
}

export function getMediaPlanEditorControls(plan: MediaPlan): MediaPlanEditorControls {
  const imageCount = Math.max(
    plan.referenceImages?.length || 0,
    plan.mediaReferences?.filter(reference => reference.kind === 'image').length || 0,
  )
  const videoCount = Math.max(
    plan.referenceVideos?.length || 0,
    plan.mediaReferences?.filter(reference => reference.kind === 'video').length || 0,
  )
  const compatibleModels = listCreationModels({ task: plan.kind })
    .filter(model => isCreationModelAvailable(model.id))
    .filter(model => {
      const spec = getCreationModelSpec(model.id)!
      return acceptsFileCount(spec.files?.images, imageCount)
        && acceptsFileCount(spec.files?.videos, videoCount)
    })
  const labelCounts = new Map<string, number>()
  for (const model of compatibleModels) {
    const label = displayModelLabel(model.label)
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1)
  }
  const models = compatibleModels.map(model => {
    const label = displayModelLabel(model.label)
    return {
      value: model.id,
      label: labelCounts.get(label)! > 1
        ? `${label} · ${model.source === 'runninghub' ? 'RunningHub' : '直连'}`
        : label,
    }
  })
  const spec = getCreationModelSpec(plan.modelId)
  if (!spec) return { models, ratios: [], resolutions: [], durations: [] }
  const duration = spec.capabilities.duration
  return {
    models,
    ratios: fieldOptions(spec, ['ratio', 'aspectRatio', 'aspect_ratio'], spec.capabilities.ratios),
    resolutions: fieldOptions(spec, ['resolution'], spec.capabilities.resolutions),
    durations: fieldOptions(
      spec,
      ['duration'],
      duration?.allowedValues?.map(String)
        || (duration?.min === duration?.max && duration?.min !== undefined ? [String(duration.min)] : undefined),
    ),
    ...(duration && !duration.allowedValues?.length && duration.min !== duration.max
      ? { durationRange: { min: duration.min, max: duration.max, step: 1 } }
      : {}),
  }
}

export function updateMediaPlanParameters(
  plan: MediaPlan,
  patch: MediaPlanParameterPatch,
): MediaPlan {
  const modelId = patch.modelId || plan.modelId
  const spec = getCreationModelSpec(modelId)
  if (!spec) throw new Error(`媒体计划的模型未注册：${modelId}`)
  const next: MediaPlan = {
    ...plan,
    modelId,
    ...(patch.prompt === undefined ? {} : { prompt: patch.prompt.trim() }),
  }
  if (patch.modelId) delete next.usesProductDefaultModel
  const controls = getMediaPlanEditorControls(next)

  assignOption(next, 'ratio', patch.ratio ?? plan.ratio, controls.ratios, fieldDefault(spec, ['ratio', 'aspectRatio', 'aspect_ratio']))
  assignOption(next, 'resolution', patch.resolution ?? plan.resolution, controls.resolutions, fieldDefault(spec, ['resolution']))
  assignDuration(next, patch.duration ?? plan.duration, controls, spec)
  validateMediaPlan(next)
  return next
}

export function resolveProductDefaultModelId(plan: Pick<MediaPlan, 'kind' | 'resolution' | 'referenceImages' | 'referenceVideos' | 'mediaReferences'>): string {
  if (plan.kind === 'image') return plan.resolution && plan.resolution !== '1k' ? 'gpt-image-2-低质量' : 'gpt-image-2-1k'
  if (plan.kind === 'audio') return 'runninghub/api/rh-suno-v55-single'

  const imageCount = Math.max(
    plan.referenceImages?.length || 0,
    plan.mediaReferences?.filter(reference => reference.kind === 'image').length || 0,
  )
  const videoCount = Math.max(
    plan.referenceVideos?.length || 0,
    plan.mediaReferences?.filter(reference => reference.kind === 'video').length || 0,
  )
  if (plan.kind === 'model3d') {
    return imageCount > 0 ? 'runninghub/api/rh-3d-image' : 'runninghub/api/rh-3d-text'
  }
  if (videoCount > 0 || imageCount > 1) return 'runninghub/api/rh-seedance2'
  if (imageCount === 1) return 'runninghub/api/rh-seedance2-image'
  return 'runninghub/api/rh-seedance2-text'
}

function acceptsFileCount(
  rule: { min?: number; max?: number } | undefined,
  count: number,
): boolean {
  if (!rule) return count === 0
  return count >= (rule.min || 0) && (rule.max === undefined || count <= rule.max)
}

function fieldOptions(
  spec: CreationModelSpec,
  keys: string[],
  fallback?: string[],
): MediaPlanEditorOption[] {
  const field = spec.fields.find(item => keys.includes(item.key))
  const values = field?.options?.map(option => ({ value: String(option.value), label: option.label }))
  if (values?.length) return values
  return (fallback || []).map(value => ({ value: String(value), label: String(value) }))
}

function fieldDefault(spec: CreationModelSpec, keys: string[]): string | undefined {
  const value = spec.fields.find(field => keys.includes(field.key))?.defaultValue
  return value === undefined ? undefined : String(value)
}

function assignOption(
  plan: MediaPlan,
  key: 'ratio' | 'resolution',
  requested: string | undefined,
  options: MediaPlanEditorOption[],
  preferred?: string,
) {
  if (!options.length) {
    delete plan[key]
    return
  }
  const values = new Set(options.map(option => option.value))
  plan[key] = requested && values.has(requested)
    ? requested
    : preferred && values.has(preferred)
      ? preferred
      : options[0].value
}

function assignDuration(
  plan: MediaPlan,
  requested: string | number | undefined,
  controls: MediaPlanEditorControls,
  spec: CreationModelSpec,
) {
  if (controls.durations.length) {
    const requestedValue = requested === undefined ? '' : String(requested)
    const values = new Set(controls.durations.map(option => option.value))
    const preferred = fieldDefault(spec, ['duration'])
    const value = values.has(requestedValue)
      ? requestedValue
      : preferred && values.has(preferred)
        ? preferred
        : controls.durations[0].value
    plan.duration = Number.isFinite(Number(value)) ? Number(value) : value
    return
  }
  if (controls.durationRange) {
    const value = Number(requested)
    const min = controls.durationRange.min
    const max = controls.durationRange.max
    plan.duration = Number.isFinite(value)
      && (min === undefined || value >= min)
      && (max === undefined || value <= max)
      ? value
      : min ?? max ?? 1
    return
  }
  delete plan.duration
}

function isCreationModelAvailable(modelId: string): boolean {
  const spec = getCreationModelSpec(modelId)
  if (!spec) return false
  const availability =
    getMediaModelAvailability(modelId) ||
    getMediaModelAvailability(spec.id) ||
    getMediaModelAvailability(spec.model)
  return availability?.status !== 'disabled'
}

function requiredText(value: unknown, field: string): string {
  const text = optionalText(value, field)
  if (!text) throw new Error(`媒体计划缺少 ${field}。`)
  return text
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`媒体计划的 ${field} 必须是文本。`)
  return value.trim() || undefined
}

function numberOrText(value: unknown, field: string): string | number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) return value.trim()
  throw new Error(`媒体计划的 ${field} 必须是数字或文本。`)
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`媒体计划的 ${field} 必须是非空文本数组。`)
  }
  return value.map(item => item.trim())
}
