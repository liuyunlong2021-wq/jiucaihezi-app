import { supportsVision } from '@/utils/providerConfig'

export type ModelInputModality = 'text' | 'image' | 'video' | 'audio' | 'file'

export interface InputCapableModel {
  id: string
  providerId?: string
  inputModalities?: readonly ModelInputModality[]
}

const VERIFIED_MODALITIES = new Map<string, readonly ModelInputModality[]>([
  ['jiucaihezi:gemini-3.5-flash', ['text', 'image', 'video', 'audio', 'file']],
])

export function resolveModelInputModalities(model: InputCapableModel): ModelInputModality[] {
  if (model.inputModalities?.length) return Array.from(new Set(model.inputModalities))
  const providerId = String(model.providerId || 'jiucaihezi')
  const verified = VERIFIED_MODALITIES.get(`${providerId}:${model.id}`)
  if (verified) return [...verified]
  // supportsVision 已按 provider 分类：Gateway 走黑名单，本地/自定义 provider 乐观放行。
  return supportsVision(model.id, providerId) ? ['text', 'image'] : ['text']
}
