import type { ChatMessage } from '@/composables/useChat'
import { chunkConversationText } from './oversizedInput'
import type { ConversationContextStorage } from './storage'

export interface BackfillRecentConversationMessagesInput {
  storage: ConversationContextStorage
  sessionId: string
  messages: ChatMessage[]
  limit?: number
  now: number
}

export interface BackfillRecentConversationMessagesResult {
  backfilledMessages: number
  chunkCount: number
}

export async function backfillRecentConversationMessages(
  input: BackfillRecentConversationMessagesInput,
): Promise<BackfillRecentConversationMessagesResult> {
  const recent = input.messages.slice(-(input.limit || 30))
  let chunkCount = 0
  for (const message of recent) {
    const chunks = chunkConversationText({
      sessionId: input.sessionId,
      messageId: message.id,
      role: message.role,
      text: message.content || '',
      now: input.now,
    })
    chunkCount += chunks.length
    await input.storage.saveMessageChunks(chunks)
  }
  return {
    backfilledMessages: recent.length,
    chunkCount,
  }
}
