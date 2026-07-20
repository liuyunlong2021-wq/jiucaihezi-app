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
      ...(plan.referenceVideos?.length ? { videos: plan.referenceVideos } : {}),
      ...(plan.duration !== undefined ? { duration: plan.duration } : {}),
    },
  })

  return {
    type: plan.kind,
    model: spec.model,
    modelLabel: spec.label,
    prompt: plan.prompt,
    referenceImages: plan.referenceImages || [],
    referenceVideos: plan.referenceVideos || [],
    ...(plan.kind === 'video'
      ? { videoParams: { prompt: plan.prompt, videoUrl: plan.referenceVideos?.[0], imageUrl: plan.referenceImages?.[0], imageUrls: plan.referenceImages, duration: plan.duration } }
      : {}),
    ...(plan.kind === 'image'
      ? { imageParams: { prompt: plan.prompt, image: plan.referenceImages?.length ? plan.referenceImages : undefined } }
      : {}),
    source: 'creation' as const,
    plan: runPlan,
  }
}
