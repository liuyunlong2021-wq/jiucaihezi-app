import { buildCreationRunPlan } from '@/runtime/creation/creationMediaPlan'
import { getCreationModelSpec } from '@/runtime/creation/creationModelRegistry'
/** The only model-authored media payload the app accepts. */
export interface MediaPlan {
  kind: 'image' | 'video'
  title: string
  prompt: string
  modelId: string
  ratio?: string
  resolution?: string
  duration?: string | number
  referenceImages?: string[]
  referenceVideos?: string[]
}

export const MEDIA_PLAN_POLICY = [
  '创作模式媒体执行规则：当用户明确要求生成图片或视频时，先调用 skill 工具加载 jc-instant-create（以及用户明确选择的相关 Skill），从其能力表选择真实模型和参数，再在最终回复中输出一个 jc-media-plan JSON 代码块。',
  '媒体计划字段：kind(image|video)、title、prompt、modelId，可按任务补充 ratio、resolution、duration、referenceImages、referenceVideos。',
  '本轮对话已附带的图片由应用自动绑定到计划，不要复制 data URL 或编造附件路径。',
  '不要在此路径运行 jc_media.py、媒体 API、轮询或下载；用户确认后由应用的现有创作面板执行。没有媒体生成意图时不要输出媒体计划。',
].join('\n')

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

  const title = requiredText(plan.title, 'title')
  const prompt = requiredText(plan.prompt, 'prompt')
  const modelId = requiredText(plan.modelId, 'modelId')

  return {
    kind: plan.kind as MediaPlan['kind'],
    title,
    prompt,
    modelId,
    ...(optionalText(plan.ratio, 'ratio') ? { ratio: optionalText(plan.ratio, 'ratio') } : {}),
    ...(optionalText(plan.resolution, 'resolution') ? { resolution: optionalText(plan.resolution, 'resolution') } : {}),
    ...(plan.duration === undefined ? {} : { duration: numberOrText(plan.duration, 'duration') }),
    ...(plan.referenceImages === undefined ? {} : { referenceImages: stringArray(plan.referenceImages, 'referenceImages') }),
    ...(plan.referenceVideos === undefined ? {} : { referenceVideos: stringArray(plan.referenceVideos, 'referenceVideos') }),
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
