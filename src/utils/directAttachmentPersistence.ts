import type { ChatMessage, DirectAttachmentRef } from '@/composables/useChat'

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
    return {
      ...copy,
      images: images.length ? images : undefined,
      attachments: attachments?.length ? attachments : undefined,
    }
  })
}
