import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runConversationMemoryJobBatch } from '../jobWorker'
import { createLocalFallbackIndexDriver } from '../localFallbackIndexDriver'
import { createConversationContextMemoryStorage } from '../storage'

test('job worker indexes pending jobs and keeps retries idempotent', async () => {
  const storage = createConversationContextMemoryStorage()
  const driver = createLocalFallbackIndexDriver({ storage })
  await storage.enqueueMemoryJob({
    id: 'job_1',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    runId: 'run_1',
    sourceMessageIds: ['u1', 'a1'],
    status: 'pending',
    attempts: 0,
    nextRunAt: 1000,
    idempotencyKey: 'idem_1',
    createdAt: 1000,
    updatedAt: 1000,
  })

  const result = await runConversationMemoryJobBatch({
    storage,
    driver,
    now: 2000,
    maxJobs: 5,
  })
  const jobs = await storage.listMemoryJobsByStatus('done', 3000)

  assert.equal(result.done, 1)
  assert.equal(jobs.length, 1)
})
