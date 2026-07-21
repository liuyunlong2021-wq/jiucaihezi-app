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
  if (providerId === 'jiucaihezi' && supportsVision(model.id, providerId)) return ['text', 'image']
  return ['text']
}

export function findMediaSpecialist<T extends InputCapableModel>(
  models: readonly T[],
  providerId: string,
  required: readonly ModelInputModality[],
): T | null {
  return models.find(model => {
    if (model.id !== 'gemini-3.5-flash' || model.providerId !== providerId) return false
    const supported = new Set(resolveModelInputModalities(model))
    return required.every(modality => supported.has(modality))
  }) || null
}
