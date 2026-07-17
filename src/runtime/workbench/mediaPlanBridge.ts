import { buildCreationRunPlan } from '@/runtime/creation/creationMediaPlan'
import { getCreationModelSpec } from '@/runtime/creation/creationModelRegistry'

import { validateMediaPlan, type MediaPlan } from './mediaPlan'

/**
 * Convert a reviewed workbench plan into the exact existing Creation contract.
 * Submission, polling, files and canvas remain owned by CreationPanel.
 */
export function buildMediaPlanSubmission(plan: MediaPlan) {
  validateMediaPlan(plan)
  const spec = getCreationModelSpec(plan.modelId)
  if (!spec) throw new Error(`媒体计划的模型未注册：${plan.modelId}`)

  const runPlan = buildCreationRunPlan({
    modelId: plan.modelId,
    params: {
      prompt: plan.prompt,
      ...(plan.ratio ? { ratio: plan.ratio } : {}),
      ...(plan.resolution ? { resolution: plan.resolution } : {}),
      ...(plan.referenceImages?.length ? { images: plan.referenceImages } : {}),
    },
  })

  return {
    type: 'image' as const,
    model: spec.model,
    modelLabel: spec.label,
    prompt: plan.prompt,
    referenceImages: plan.referenceImages || [],
    source: 'creation' as const,
    plan: runPlan,
  }
}
