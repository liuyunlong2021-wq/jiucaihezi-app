import assert from 'node:assert/strict'
import { test } from 'node:test'

import { rebuildConversationMemoryIndex } from '../rebuildIndex'
import { runConversationMemoryJobBatch } from '../jobWorker'
import { createLocalFallbackIndexDriver } from '../localFallbackIndexDriver'
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

test('rebuild index creates memory jobs from dirty segment chunks', async () => {
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
  await storage.saveMessageChunks([
    {
      id: 'u1_chunk_0',
      sessionId: 'sess_1',
      messageId: 'u1',
      parentMessageId: 'u1',
      role: 'user',
      chunkIndex: 0,
      text: '用户明确决定：冷静克制。',
      startOffset: 0,
      endOffset: 12,
      tokenCount: 12,
      semanticTitle: '用户决策',
      contentKind: 'plain',
      createdAt: 1000,
      metadata: { runtimeSegmentId: 'seg_1' },
    },
    {
      id: 'a1_chunk_0',
      sessionId: 'sess_1',
      messageId: 'a1',
      parentMessageId: 'a1',
      role: 'assistant',
      chunkIndex: 0,
      text: '助手确认执行。',
      startOffset: 0,
      endOffset: 7,
      tokenCount: 7,
      semanticTitle: '助手确认',
      contentKind: 'plain',
      createdAt: 1001,
      metadata: { runtimeSegmentId: 'seg_1' },
    },
  ])

  const result = await rebuildConversationMemoryIndex({
    storage,
    sessionId: 'sess_1',
    dirtyOnly: true,
    priority: 'active',
    now: 2000,
  })
  const jobs = await storage.listMemoryJobsByStatus('pending', 3000)

  assert.equal(result.createdJobs, 1)
  assert.equal(jobs.length, 1)
  assert.deepEqual(jobs[0].sourceMessageIds, ['u1', 'a1'])
  assert.equal(jobs[0].runtimeSegmentId, 'seg_1')
})

test('rebuild recovery clears dirty segment after rebuilt job is indexed', async () => {
  const storage = createConversationContextMemoryStorage()
  const driver = createLocalFallbackIndexDriver({ storage })
  await storage.saveDirtySegment({
    id: 'dirty_1',
    sessionId: 'sess_repair',
    runtimeSegmentId: 'seg_1',
    reason: 'index_failed',
    severity: 'high',
    estimatedTokenImpact: 10000,
    dirtySince: 1000,
    priority: 90,
    status: 'pending',
    metadata: {},
  })
  await storage.saveMessageChunks([
    {
      id: 'u1_chunk_0',
      sessionId: 'sess_repair',
      messageId: 'u1',
      parentMessageId: 'u1',
      role: 'user',
      chunkIndex: 0,
      text: '用户明确决定：修复后可以召回。',
      startOffset: 0,
      endOffset: 15,
      tokenCount: 15,
      semanticTitle: '修复决策',
      contentKind: 'plain',
      createdAt: 1000,
      metadata: { runtimeSegmentId: 'seg_1' },
    },
  ])

  await rebuildConversationMemoryIndex({
    storage,
    sessionId: 'sess_repair',
    dirtyOnly: true,
    priority: 'active',
    now: 2000,
  })
  await runConversationMemoryJobBatch({ storage, driver, now: 3000, maxJobs: 5 })

  const memories = await storage.listMemoryItems('sess_repair')
  const dirty = await storage.listDirtySegments('sess_repair')

  assert.equal(memories.length, 1)
  assert.match(memories[0].text, /修复后可以召回/)
  assert.equal(dirty[0].status, 'done')
})
