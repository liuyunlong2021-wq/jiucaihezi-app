/**
 * The only model-authored media payload the workbench accepts.  Keeping this
 * small makes the later handoff to CreationPanel explicit and auditable.
 */
export interface MediaPlan {
  kind: 'image'
  title: string
  prompt: string
  modelId: string
  ratio?: string
  resolution?: string
  referenceImages?: string[]
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
  if (plan.kind !== 'image') throw new Error('媒体计划暂时只支持 image。')

  const title = requiredText(plan.title, 'title')
  const prompt = requiredText(plan.prompt, 'prompt')
  const modelId = requiredText(plan.modelId, 'modelId')

  return {
    kind: 'image',
    title,
    prompt,
    modelId,
    ...(optionalText(plan.ratio, 'ratio') ? { ratio: optionalText(plan.ratio, 'ratio') } : {}),
    ...(optionalText(plan.resolution, 'resolution') ? { resolution: optionalText(plan.resolution, 'resolution') } : {}),
    ...(plan.referenceImages === undefined ? {} : { referenceImages: stringArray(plan.referenceImages, 'referenceImages') }),
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
  if (spec.task !== 'image') throw new Error(`媒体计划的模型不是图片模型：${plan.modelId}`)

  buildCreationRunPlan({
    modelId: plan.modelId,
    params: {
      prompt: plan.prompt,
      ...(plan.ratio ? { ratio: plan.ratio } : {}),
      ...(plan.resolution ? { resolution: plan.resolution } : {}),
      ...(plan.referenceImages?.length ? { images: plan.referenceImages } : {}),
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

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`媒体计划的 ${field} 必须是非空文本数组。`)
  }
  return value.map(item => item.trim())
}
import { buildCreationRunPlan } from '@/runtime/creation/creationMediaPlan'
import { getCreationModelSpec } from '@/runtime/creation/creationModelRegistry'
