import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createLocalFallbackIndexDriver } from '../localFallbackIndexDriver'
import { searchConversationMemoryIndex } from '../memoryIndex'
import { createConversationContextMemoryStorage } from '../storage'

test('memory index only returns hits with provenance', async () => {
  const storage = createConversationContextMemoryStorage()
  const driver = createLocalFallbackIndexDriver({ storage })
  await storage.saveMemoryItem({
    id: 'mem_1',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    kind: 'decision',
    layer: 'anchor',
    text: '用户决定采用冷静克制的风格。',
    score: 0.9,
    recallReason: 'seed',
    sourceMessageIds: ['u1', 'a1'],
    createdAt: 1000,
    tokenCount: 20,
    updatedAt: 1000,
    indexDriver: 'local',
    idempotencyKey: 'k1',
    syncStatus: 'synced',
    metadata: {},
  })

  const result = await searchConversationMemoryIndex({
    driver,
    query: '继续冷静克制风格',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    limit: 5,
    timeoutMs: 1000,
  })

  assert.equal(result.degradation, undefined)
  assert.equal(result.hits.length, 1)
  assert.deepEqual(result.hits[0].sourceMessageIds, ['u1', 'a1'])
})

test('memory index degrades on timeout instead of throwing', async () => {
  const result = await searchConversationMemoryIndex({
    driver: {
      async search() {
        await new Promise(resolve => setTimeout(resolve, 20))
        return { hits: [] }
      },
      async indexTurn() {
        return { items: [] }
      },
      async deleteSession() {},
    },
    query: 'anything',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    limit: 5,
    timeoutMs: 1,
  })

  assert.equal(result.hits.length, 0)
  assert.equal(result.degradation?.reason, 'memory_index_timeout')
})
