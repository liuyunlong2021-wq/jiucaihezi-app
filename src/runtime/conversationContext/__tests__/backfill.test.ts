import assert from 'node:assert/strict'
import { test } from 'node:test'

import { backfillRecentConversationMessages } from '../backfill'
import { createConversationContextMemoryStorage } from '../storage'

test('backfill chunks only recent messages and does not modify originals', async () => {
  const storage = createConversationContextMemoryStorage()
  const messages = Array.from({ length: 40 }, (_, index) => ({
    id: `msg_${index}`,
    role: index % 2 ? 'assistant' as const : 'user' as const,
    content: `第 ${index} 条消息，包含一些需要回填的内容。`,
    timestamp: 1000 + index,
  }))

  const result = await backfillRecentConversationMessages({
    storage,
    sessionId: 'sess_1',
    messages,
    limit: 30,
    now: 5000,
  })

  const chunks = await storage.listMessageChunksBySession('sess_1')
  assert.equal(result.backfilledMessages, 30)
  assert.equal(chunks[0].messageId, 'msg_10')
  assert.equal(messages.length, 40)
})
