import type { CreationModelSpec } from '@/runtime/creation/creationMediaTypes'
import type { CreationCapability } from '@/runtime/creation/creationProtocolClient'

/**
 * 按模型登记的字段名和约束组装提交参数：各线路比例字段叫 ratio / aspect_ratio 不一，
 * 时长有的只允许固定档位（如 5/10/15/30），参考图有上限。
 * 本地登记（CreationModelSpec）与远程动态目录（CreationCapability）先统一成同一份档案。
 */
export interface MediaParamProfile {
  keys: string[]
  imageKey: string
  maxImages?: number
  duration?: { min?: number; max?: number; allowedValues?: number[] }
}

export function profileFromSpec(spec: Pick<CreationModelSpec, 'fields' | 'capabilities' | 'files'>): MediaParamProfile {
  return { keys: spec.fields.map(field => field.key), imageKey: 'images', maxImages: spec.files?.images?.max, duration: spec.capabilities.duration }
}

export function profileFromCapability(capability: Pick<CreationCapability, 'parameter_schema' | 'asset_slots'>): MediaParamProfile {
  const properties = (capability.parameter_schema.properties || {}) as Record<string, { enum?: unknown[]; minimum?: number; maximum?: number }>
  const slot = capability.asset_slots.find(item => item.modalities.includes('image'))
  const duration = properties.duration
  const allowed = duration?.enum?.map(Number).filter(Number.isFinite)
  return {
    keys: Object.keys(properties),
    imageKey: slot?.name || 'images',
    maxImages: slot?.max,
    duration: duration && { min: duration.minimum, max: duration.maximum, allowedValues: allowed?.length ? allowed : undefined },
  }
}

export function buildMediaParams(
  profile: MediaParamProfile | undefined,
  input: { prompt: string; ratio: string; images?: string[]; durationSeconds?: number },
): Record<string, unknown> {
  const keys = new Set(profile?.keys || [])
  const ratioKey = ['ratio', 'aspect_ratio', 'aspectRatio'].find(key => keys.has(key)) || 'aspect_ratio'
  const params: Record<string, unknown> = { prompt: input.prompt, [ratioKey]: input.ratio }
  if (input.images?.length) {
    const max = profile?.maxImages
    if (max !== undefined && input.images.length > max) throw new Error(`参考图 ${input.images.length} 张超过该模型上限 ${max} 张`)
    params[profile?.imageKey || 'images'] = input.images
  }
  if (input.durationSeconds !== undefined) {
    const limit = profile?.duration
    const allowed = limit?.allowedValues?.slice().sort((a, b) => a - b)
    let duration = input.durationSeconds
    if (allowed?.length) {
      const fit = allowed.find(value => value >= duration)
      if (fit === undefined) throw new Error(`片段 ${duration} 秒超过该模型最长 ${allowed.at(-1)} 秒`)
      duration = fit
    } else {
      if (limit?.max !== undefined && duration > limit.max) throw new Error(`片段 ${duration} 秒超过该模型最长 ${limit.max} 秒`)
      if (limit?.min !== undefined) duration = Math.max(duration, limit.min)
    }
    params.duration = duration
  }
  return params
}
