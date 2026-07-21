import { supportsVision } from '@/utils/providerConfig'

export type ModelInputModality = 'text' | 'image' | 'video' | 'audio' | 'file'

export interface InputCapableModel {
  id: string
  providerId?: string
  inputModalities?: readonly ModelInputModality[]
}

// Production-verified Provider/model contracts; this is not inferred from model names.
const PRODUCT_VERIFIED_MODALITIES = new Map<string, readonly ModelInputModality[]>([
  ['jiucaihezi:gemini-3.5-flash', ['text', 'image', 'video', 'audio', 'file']],
])

export function resolveProductVerifiedModelInputModalities(model: InputCapableModel): ModelInputModality[] | undefined {
  const verified = PRODUCT_VERIFIED_MODALITIES.get(`${String(model.providerId || 'jiucaihezi')}:${model.id}`)
  return verified ? [...verified] : undefined
}

export function resolveKnownModelInputModalities(model: InputCapableModel): ModelInputModality[] | undefined {
  if (model.inputModalities?.length) return Array.from(new Set(model.inputModalities))
  return resolveProductVerifiedModelInputModalities(model)
}

export function resolveModelInputModalities(model: InputCapableModel): ModelInputModality[] {
  if (model.inputModalities?.length) return Array.from(new Set(model.inputModalities))
  const providerId = String(model.providerId || 'jiucaihezi')
  const verified = resolveProductVerifiedModelInputModalities(model)
  if (verified) return verified
  if (providerId === 'jiucaihezi' && supportsVision(model.id, providerId)) return ['text', 'image']
  return ['text']
}
