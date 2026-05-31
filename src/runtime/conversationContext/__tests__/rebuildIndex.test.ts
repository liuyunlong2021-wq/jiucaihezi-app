import assert from 'node:assert/strict'
import { test } from 'node:test'

import { rebuildConversationMemoryIndex } from '../rebuildIndex'
import { createConversationContextMemoryStorage } from '../storage'

test('rebuild index only creates dirty segment rebuild jobs by default', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveDirtySegment({
    id: 'dirty_1',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    reason: 'index_failed',
    severity: 'high',
    estimatedTokenImpact: 10000,
    dirtySince: 1000,
    priority: 90,
    status: 'pending',
    metadata: {},
  })

  const result = await rebuildConversationMemoryIndex({
    storage,
    sessionId: 'sess_1',
    dirtyOnly: true,
    priority: 'active',
    now: 2000,
  })

  assert.equal(result.createdJobs, 1)
})
