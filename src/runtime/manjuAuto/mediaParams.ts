import type { CreationModelSpec } from '@/runtime/creation/creationMediaTypes'

/**
 * 按模型登记的字段名和约束组装提交参数：各线路比例字段叫 ratio / aspect_ratio 不一，
 * 时长有的只允许固定档位（如 5/10/15/30），参考图有上限。
 */
export function buildMediaParams(
  spec: Pick<CreationModelSpec, 'fields' | 'capabilities' | 'files'> | undefined,
  input: { prompt: string; ratio: string; images?: string[]; durationSeconds?: number },
): Record<string, unknown> {
  const keys = new Set(spec?.fields.map(field => field.key) || [])
  const ratioKey = ['ratio', 'aspect_ratio', 'aspectRatio'].find(key => keys.has(key)) || 'aspect_ratio'
  const params: Record<string, unknown> = { prompt: input.prompt, [ratioKey]: input.ratio }
  if (input.images?.length) {
    const max = spec?.files?.images?.max
    if (max !== undefined && input.images.length > max) throw new Error(`参考图 ${input.images.length} 张超过该模型上限 ${max} 张`)
    params.images = input.images
  }
  if (input.durationSeconds !== undefined) {
    const limit = spec?.capabilities.duration
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
