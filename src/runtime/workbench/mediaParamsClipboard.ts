/**
 * 创作参数剪贴板：把面板当前选择写成一段「人可读、机器可解析」的文字，
 * 让用户粘进 @影音 的输入框，直接接着写提示词。
 *
 * 格式固定为一行参数 + 提示词占位：
 *   [创作参数] 图片 | Midjourney Relax Imagine | 文生图 | 比例 9:16 | 价格 0.2/张
 *
 *   提示词：
 *
 * 带前缀的理由：只在用户确实粘了面板产出的文本时才覆盖模型，普通对话不受影响。
 */
import {
  displayModelLabel,
  displayModelPrice,
  getCreationModelSpec,
  listCreationModels,
} from '@/runtime/creation/creationModelRegistry'
import type { MediaPlan } from './mediaPlan'

export const MEDIA_PARAMS_PREFIX = '[创作参数]'

const KIND_LABELS: Record<MediaPlan['kind'], string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
  model3d: '3D',
}

const MODE_LABELS: Record<string, string> = {
  'text-to-image': '文生图',
  'image-to-image': '图生图',
  'text-to-video': '文生视频',
  'image-to-video': '图生视频',
  'video-edit': '视频编辑',
  'text-to-audio': '文生音频',
  'text-to-3d': '文生 3D',
  'image-to-3d': '图生 3D',
}

export interface MediaParamsSnapshot {
  kindLabel: string
  modelLabel: string
  modeLabel: string
  ratio?: string
  resolution?: string
  duration?: number
  price?: string
}

/** 面板状态 → 可粘贴文本。没选模型时返回空串，按钮据此禁用。 */
export function buildMediaParamsText(input: {
  kind: MediaPlan['kind']
  modelLabel: string
  mode?: string
  ratio?: string
  resolution?: string
  duration?: number
  price?: string
}): string {
  const parts = [
    KIND_LABELS[input.kind],
    input.modelLabel.trim(),
    input.mode ? MODE_LABELS[input.mode] || input.mode : '',
  ]
  if (input.ratio) parts.push(`比例 ${input.ratio}`)
  if (input.resolution) parts.push(`分辨率 ${input.resolution}`)
  if (input.duration !== undefined && Number.isFinite(Number(input.duration))) {
    parts.push(`时长 ${Number(input.duration)}s`)
  }
  if (input.price) parts.push(`价格 ${input.price}`)
  return `${MEDIA_PARAMS_PREFIX} ${parts.filter(Boolean).join(' | ')}\n\n提示词：`
}

/** 反向解析。没有前缀、或参数行不成立时返回 null（当作普通聊天）。 */
export function parseMediaParamsText(text: string): MediaParamsSnapshot | null {
  const source = String(text || '')
  const start = source.indexOf(MEDIA_PARAMS_PREFIX)
  if (start < 0) return null
  const line = source.slice(start + MEDIA_PARAMS_PREFIX.length).split('\n')[0] || ''
  const parts = line.split('|').map(part => part.trim()).filter(Boolean)
  if (parts.length < 2) return null
  const [kindLabel, modelLabel, modeLabel = ''] = parts
  const snapshot: MediaParamsSnapshot = { kindLabel, modelLabel, modeLabel }
  for (const part of parts.slice(3)) {
    const [key, ...rest] = part.split(/\s+/)
    const value = rest.join(' ').trim()
    if (!value) continue
    if (key === '比例') snapshot.ratio = value
    else if (key === '分辨率') snapshot.resolution = value
    else if (key === '时长') {
      const seconds = Number(value.replace(/s$/i, ''))
      if (Number.isFinite(seconds)) snapshot.duration = seconds
    } else if (key === '价格') snapshot.price = value
  }
  return snapshot
}

export function kindFromLabel(label: string): MediaPlan['kind'] | undefined {
  const entry = Object.entries(KIND_LABELS).find(([, value]) => value === label.trim())
  return entry?.[0] as MediaPlan['kind'] | undefined
}

/** 显示名 → 可见模型 id。隐藏型号不参与，保证粘贴的参数一定能在面板里选到。 */
export function matchCreationModelByLabel(label: string, kind?: MediaPlan['kind']): string {
  const wanted = String(label || '').trim().toLocaleLowerCase()
  if (!wanted) return ''
  const models = listCreationModels(kind ? { task: kind } : {})
  const hit = models.find(model => {
    const spec = getCreationModelSpec(model.id)
    if (!spec) return false
    return displayModelLabel(spec.label).toLocaleLowerCase() === wanted
      || spec.label.toLocaleLowerCase() === wanted
  })
  return hit?.id || ''
}

/**
 * 把粘贴来的参数钉到计划上：用户显式贴了什么就用什么，模型无权改。
 * 类型对不上（例如贴的是视频参数、计划却是图片）时不改类型，只忽略。
 */
export function applyMediaParamsToPlan(plan: MediaPlan, snapshot: MediaParamsSnapshot | null): MediaPlan {
  if (!snapshot) return plan
  const kind = kindFromLabel(snapshot.kindLabel)
  if (kind && kind !== plan.kind) return plan
  const modelId = matchCreationModelByLabel(snapshot.modelLabel, plan.kind)
  const next: MediaPlan = { ...plan }
  if (modelId) {
    next.modelId = modelId
    delete next.usesProductDefaultModel
  }
  if (snapshot.ratio) next.ratio = snapshot.ratio
  if (snapshot.resolution) next.resolution = snapshot.resolution
  if (snapshot.duration !== undefined) next.duration = snapshot.duration
  return next
}

/** 面板用：当前模型的售价文案。 */
export function mediaParamsPrice(modelId: string): string {
  const spec = getCreationModelSpec(modelId)
  return spec ? displayModelPrice(spec) : ''
}
