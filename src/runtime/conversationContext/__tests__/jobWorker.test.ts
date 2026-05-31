import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runConversationMemoryJobBatch } from '../jobWorker'
import { createLocalFallbackIndexDriver } from '../localFallbackIndexDriver'
import { createConversationContextMemoryStorage } from '../storage'

test('job worker indexes pending jobs and keeps retries idempotent', async () => {
  const storage = createConversationContextMemoryStorage()
  const driver = createLocalFallbackIndexDriver({ storage })
  await storage.saveMessageChunks([
    {
      id: 'u1_chunk_0',
      sessionId: 'sess_1',
      messageId: 'u1',
      parentMessageId: 'u1',
      role: 'user',
      chunkIndex: 0,
      text: '用户提出任务要求。',
      startOffset: 0,
      endOffset: 8,
      tokenCount: 8,
      semanticTitle: '任务要求',
      contentKind: 'plain',
      createdAt: 1000,
      metadata: {},
    },
    {
      id: 'a1_chunk_0',
      sessionId: 'sess_1',
      messageId: 'a1',
      parentMessageId: 'a1',
      role: 'assistant',
      chunkIndex: 0,
      text: '助手给出执行结果。',
      startOffset: 0,
      endOffset: 8,
      tokenCount: 8,
      semanticTitle: '执行结果',
      contentKind: 'plain',
      createdAt: 1001,
      metadata: {},
    },
  ])
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

test('bootstrap worker processes pending jobs without throwing', async () => {
  const storage = createConversationContextMemoryStorage()
  const driver = createLocalFallbackIndexDriver({ storage })
  await storage.saveMessageChunks([
    {
      id: 'u1_chunk_0',
      sessionId: 'sess_1',
      messageId: 'u1',
      parentMessageId: 'u1',
      role: 'user',
      chunkIndex: 0,
      text: '用户消息正文。',
      startOffset: 0,
      endOffset: 6,
      tokenCount: 6,
      semanticTitle: '用户消息',
      contentKind: 'plain',
      createdAt: 1000,
      metadata: {},
    },
    {
      id: 'a1_chunk_0',
      sessionId: 'sess_1',
      messageId: 'a1',
      parentMessageId: 'a1',
      role: 'assistant',
      chunkIndex: 0,
      text: '助手消息正文。',
      startOffset: 0,
      endOffset: 6,
      tokenCount: 6,
      semanticTitle: '助手消息',
      contentKind: 'plain',
      createdAt: 1001,
      metadata: {},
    },
  ])
  await storage.enqueueMemoryJob({
    id: 'job_boot',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    runId: 'run_boot',
    sourceMessageIds: ['u1', 'a1'],
    status: 'pending',
    attempts: 0,
    nextRunAt: 1000,
    idempotencyKey: 'boot',
    createdAt: 1000,
    updatedAt: 1000,
  })

  const result = await runConversationMemoryJobBatch({ storage, driver, now: 2000, maxJobs: 1 })
  assert.equal(result.done, 1)
})

test('job worker indexes source chunk text instead of message ids', async () => {
  const storage = createConversationContextMemoryStorage()
  const driver = createLocalFallbackIndexDriver({ storage })
  await storage.saveMessageChunks([
    {
      id: 'u1_chunk_0',
      sessionId: 'sess_1',
      messageId: 'u1',
      parentMessageId: 'u1',
      role: 'user',
      chunkIndex: 0,
      text: '用户明确决定：采用冷静克制的写作风格。',
      startOffset: 0,
      endOffset: 20,
      tokenCount: 20,
      semanticTitle: '写作风格决策',
      contentKind: 'plain',
      createdAt: 1000,
      metadata: {},
    },
  ])
  await storage.enqueueMemoryJob({
    id: 'job_text',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    runId: 'run_text',
    sourceMessageIds: ['u1'],
    status: 'pending',
    attempts: 0,
    nextRunAt: 1000,
    idempotencyKey: 'text',
    createdAt: 1000,
    updatedAt: 1000,
  })

  await runConversationMemoryJobBatch({ storage, driver, now: 2000, maxJobs: 1 })
  const memories = await storage.listMemoryItems('sess_1')

  assert.equal(memories.length, 1)
  assert.match(memories[0].text, /冷静克制/)
  assert.equal(memories[0].kind, 'decision')
})

test('job worker marks missing source chunks for repair instead of indexing message ids', async () => {
  const storage = createConversationContextMemoryStorage()
  const driver = createLocalFallbackIndexDriver({ storage })
  await storage.enqueueMemoryJob({
    id: 'job_missing_chunks',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    runId: 'run_missing',
    sourceMessageIds: ['u_missing', 'a_missing'],
    status: 'pending',
    attempts: 0,
    nextRunAt: 1000,
    idempotencyKey: 'missing',
    createdAt: 1000,
    updatedAt: 1000,
  })

  const result = await runConversationMemoryJobBatch({ storage, driver, now: 2000, maxJobs: 1 })
  const repairJobs = await storage.listMemoryJobsByStatus('repair_required', 3000)
  const memories = await storage.listMemoryItems('sess_1')

  assert.equal(result.done, 0)
  assert.equal(result.failed, 1)
  assert.equal(repairJobs.length, 1)
  assert.equal(repairJobs[0].lastError, 'missing source chunks')
  assert.equal(memories.length, 0)
})
