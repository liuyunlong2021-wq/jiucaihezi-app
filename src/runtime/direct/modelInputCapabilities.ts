import { supportsVision } from '@/utils/providerConfig'
import type { ResolvedDirectAttachment } from '@/utils/directMessageBuilder'

export type ModelInputModality = 'text' | 'image' | 'video' | 'audio' | 'file'

export interface InputCapableModel {
  id: string
  providerId?: string
  inputModalities?: readonly ModelInputModality[]
}

const VERIFIED_MODALITIES = new Map<string, readonly ModelInputModality[]>([
  ['jiucaihezi:gemini-3.5-flash', ['text', 'image', 'video', 'audio', 'file']],
])

export function resolveKnownModelInputModalities(model: InputCapableModel): ModelInputModality[] | undefined {
  if (model.inputModalities?.length) return Array.from(new Set(model.inputModalities))
  const verified = VERIFIED_MODALITIES.get(`${String(model.providerId || 'jiucaihezi')}:${model.id}`)
  return verified ? [...verified] : undefined
}

export function resolveModelInputModalities(model: InputCapableModel): ModelInputModality[] {
  if (model.inputModalities?.length) return Array.from(new Set(model.inputModalities))
  const providerId = String(model.providerId || 'jiucaihezi')
  const verified = VERIFIED_MODALITIES.get(`${providerId}:${model.id}`)
  if (verified) return [...verified]
  if (providerId === 'jiucaihezi' && supportsVision(model.id, providerId)) return ['text', 'image']
  return ['text']
}

export function resolveCurrentModelAttachments(
  attachments: readonly ResolvedDirectAttachment[],
  modalities?: readonly ModelInputModality[],
): ResolvedDirectAttachment[] {
  if (!modalities) return [...attachments]
  const supportedModalities = new Set(modalities)
  const unsupported = attachments.filter(attachment => !supportedModalities.has(attachment.kind))
  if (unsupported.length) {
    throw new Error(`当前模型不支持附件：${unsupported.map(attachment => attachment.name).join('、')}`)
  }
  return [...attachments]
}
