import type { ChatMessage, DirectAttachmentRef } from '@/composables/useChat'
import type { MediaPlan } from '@/runtime/workbench/mediaPlan'

export function persistableAttachmentUrls(values: readonly string[] | undefined): string[] {
  return (values || []).filter(value => {
    const normalized = String(value || '').trim().toLowerCase()
    return normalized !== '' && !normalized.startsWith('data:') && !normalized.startsWith('blob:')
  })
}

export function sanitizeDirectMessagesForPersistence(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map(message => {
    const unsafe = message as ChatMessage & { modelAttachments?: unknown }
    const { modelAttachments: _transient, ...copy } = unsafe
    const images = persistableAttachmentUrls(message.images)
    const attachments = message.attachments?.map(attachment => {
      const { value: _value, ...reference } = attachment as DirectAttachmentRef & { value?: unknown }
      return reference
    })
    const mediaPlan = sanitizeMediaPlan(message.mediaPlan)
    return {
      ...copy,
      images: images.length ? images : undefined,
      attachments: attachments?.length ? attachments : undefined,
      mediaPlan,
    }
  })
}

function sanitizeMediaPlan(plan: MediaPlan | undefined): MediaPlan | undefined {
  if (!plan) return undefined
  const referenceImages = persistableAttachmentUrls(plan.referenceImages)
  const referenceVideos = persistableAttachmentUrls(plan.referenceVideos)
  const mediaReferences = plan.mediaReferences?.map(reference => {
    const { value: _value, ...persisted } = reference
    return {
      ...persisted,
      ...(reference.locator.type === 'attachment' && !persisted.invalidReason
        ? { invalidReason: '临时上传已失效，请重新选择素材。' }
        : {}),
    }
  })
  return {
    ...plan,
    referenceImages: referenceImages.length ? referenceImages : undefined,
    referenceVideos: referenceVideos.length ? referenceVideos : undefined,
    mediaReferences: mediaReferences as MediaPlan['mediaReferences'],
  }
}
