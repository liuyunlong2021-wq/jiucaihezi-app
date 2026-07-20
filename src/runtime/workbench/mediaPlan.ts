import { buildCreationRunPlan } from '@/runtime/creation/creationMediaPlan'
import { getCreationModelSpec, listCreationModels } from '@/runtime/creation/creationModelRegistry'
import { getMediaModelAvailability } from '@/data/mediaModelCapabilities'
import type { MediaReference } from './mediaReference'
/** The only model-authored media payload the app accepts. */
export interface MediaPlan {
  kind: 'image' | 'video'
  title: string
  prompt: string
  modelId: string
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

export const MEDIA_PLAN_POLICY = [
  '创作模式媒体执行规则：当用户明确要求生成图片或视频时，从应用提供的模型目录中选择真实模型和参数，再在最终回复中输出一个 jc-media-plan JSON 代码块。',
  '媒体计划字段：kind(image|video)、title、prompt、modelId，可按任务补充 ratio、resolution、duration、referenceIds。',
  '只能使用应用提供的素材 referenceId；不要输出 referenceImages、referenceVideos、URL、data URL 或文件路径。',
  '不要在此路径运行 jc_media.py、媒体 API、轮询或下载；用户确认后由应用的现有创作面板执行。没有媒体生成意图时不要输出媒体计划。',
].join('\n')

export function buildMediaPlanPolicy(referencePolicy = ''): string {
  const models = listCreationModels()
    .filter(model => model.task === 'image' || model.task === 'video')
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
        model.price === undefined ? '' : `价格 ${model.price}`,
      ]
        .filter(Boolean)
        .join(' | ')
    })
  return [MEDIA_PLAN_POLICY, `应用当前可执行媒体模型：\n${models.join('\n')}`, referencePolicy]
    .filter(Boolean)
    .join('\n\n')
}

const MEDIA_PLAN_BLOCK = /```jc-media-plan\s*\n([\s\S]*?)\n```/

export function parseMediaPlan(text: string): MediaPlan {
  const match = String(text || '').match(MEDIA_PLAN_BLOCK)
  if (!match) throw new Error('媒体计划必须放在 ```jc-media-plan JSON 代码块中。')

  let value: unknown
  try {
    value = JSON.parse(match[1])
  } catch {
    throw new Error('媒体计划不是有效 JSON。')
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('媒体计划必须是 JSON 对象。')
  }

  const plan = value as Record<string, unknown>
  if (!['image', 'video'].includes(String(plan.kind))) {
    throw new Error('媒体计划暂时只支持 image、video。')
  }
  for (const field of ['referenceImages', 'referenceVideos']) {
    if (plan[field] !== undefined) throw new Error(`媒体计划的 ${field} 不能由模型提供。`)
  }

  const title = requiredText(plan.title, 'title')
  const prompt = requiredText(plan.prompt, 'prompt')
  const modelId = requiredText(plan.modelId, 'modelId')

  return {
    kind: plan.kind as MediaPlan['kind'],
    title,
    prompt,
    modelId,
    ...(optionalText(plan.ratio, 'ratio') ? { ratio: optionalText(plan.ratio, 'ratio') } : {}),
    ...(optionalText(plan.resolution, 'resolution')
      ? { resolution: optionalText(plan.resolution, 'resolution') }
      : {}),
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

function isCreationModelAvailable(modelId: string): boolean {
  const spec = getCreationModelSpec(modelId)
  if (!spec) return false
  const availability = getMediaModelAvailability(spec.id) || getMediaModelAvailability(spec.model)
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
