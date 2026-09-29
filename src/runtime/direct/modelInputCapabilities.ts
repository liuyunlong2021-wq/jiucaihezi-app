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
  if (model.inputModalities?.length) {
    const modalities = Array.from(new Set(model.inputModalities))
    return modalities.includes('image') ? modalities : ['image', ...modalities]
  }
  const providerId = String(model.providerId || 'jiucaihezi')
  const verified = VERIFIED_MODALITIES.get(`${providerId}:${model.id}`)
  if (verified) return [...verified]
  // 当前产品端点统一支持图片；其它模态仍只在显式声明或已验证时开放。
  return supportsVision(model.id, providerId) ? ['text', 'image'] : ['text']
}
