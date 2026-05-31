import assert from 'node:assert/strict'
import { test } from 'node:test'

import { reconcileConversationMemoryIndex } from '../reconcileIndex'
import { createConversationContextMemoryStorage } from '../storage'

test('reconcile marks missing provenance as dirty segment', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveMemoryItem({
    id: 'mem_1',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    kind: 'fact',
    layer: 'turn',
    text: 'orphan',
    score: 0.4,
    recallReason: 'test',
    sourceMessageIds: [],
    createdAt: 1000,
    tokenCount: 10,
    updatedAt: 1000,
    indexDriver: 'mem0',
    externalId: 'ext_1',
    idempotencyKey: 'k',
    syncStatus: 'synced',
    metadata: {},
  })

  const result = await reconcileConversationMemoryIndex({ storage, sessionId: 'sess_1', now: 2000 })
  assert.equal(result.dirtySegments, 1)
})
