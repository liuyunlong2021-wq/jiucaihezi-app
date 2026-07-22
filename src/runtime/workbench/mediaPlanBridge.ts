import { buildCreationRunPlan } from '@/runtime/creation/creationMediaPlan'
import { getCreationModelSpec } from '@/runtime/creation/creationModelRegistry'

import { validateMediaPlan, type MediaPlan } from './mediaPlan'
import {
  refreshMediaPlanReferenceValues,
  type MediaReferenceResolvers,
} from './mediaReference'

export interface PublicMediaPlanRequest {
  plan: MediaPlan
  owner: string
  sessionId?: string
  resolvers?: MediaReferenceResolvers
}

export interface PublicMediaPlanResult {
  plan: MediaPlan
  submission: ReturnType<typeof buildMediaPlanSubmission>
}

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

/**
 * The common paid-media boundary used by all product entry points.
 * UI callers own presentation and provide existing project/task readers only.
 */
export async function preparePublicMediaPlan(
  request: PublicMediaPlanRequest,
): Promise<PublicMediaPlanResult> {
  const { plan, owner, resolvers } = request
  if (plan.mediaOwner && plan.mediaOwner !== owner) {
    throw new Error('参考素材属于其他项目，请回到原项目或重新选择素材。')
  }
  const invalidReference = plan.mediaReferences?.find(reference => reference.invalidReason)
  if (invalidReference) throw new Error(invalidReference.invalidReason)
  if (plan.mediaReferences?.length && !resolvers) {
    throw new Error('参考素材缺少重新读取能力。')
  }

  const refreshedPlan = resolvers
    ? await refreshMediaPlanReferenceValues(plan, resolvers)
    : plan
  return {
    plan: refreshedPlan,
    submission: buildMediaPlanSubmission(refreshedPlan),
  }
}
