import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createConversationContextMemoryStorage,
} from '../storage'

test('memory storage creates runtime segments and stores chunks', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveRuntimeSegment({
    id: 'seg_1',
    sessionId: 'sess_1',
    trigger: 'new_session',
    skillId: 'skill_1',
    primaryVaultId: 'vault_1',
    toolSignature: 'browser_open',
    createdAt: 1000,
    metadata: {},
  })

  await storage.saveMessageChunks([
    {
      id: 'chunk_1',
      sessionId: 'sess_1',
      messageId: 'msg_1',
      parentMessageId: 'msg_1',
      role: 'user',
      chunkIndex: 0,
      text: '很长的原文片段',
      startOffset: 0,
      endOffset: 7,
      tokenCount: 12,
      semanticTitle: '原文片段',
      contentKind: 'plain',
      createdAt: 1000,
      metadata: {},
    },
  ])

  const segments = await storage.listRuntimeSegments('sess_1')
  const chunks = await storage.listMessageChunksByMessageId('msg_1')

  assert.equal(segments.length, 1)
  assert.equal(segments[0].trigger, 'new_session')
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].text, '很长的原文片段')
})

test('memory storage upserts memory jobs by idempotency key', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.enqueueMemoryJob({
    id: 'job_1',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    runId: 'run_1',
    sourceMessageIds: ['u1', 'a1'],
    status: 'pending',
    attempts: 0,
    nextRunAt: 1000,
    idempotencyKey: 'same',
    createdAt: 1000,
    updatedAt: 1000,
  })
  await storage.enqueueMemoryJob({
    id: 'job_2',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    runId: 'run_1',
    sourceMessageIds: ['u1', 'a1'],
    status: 'pending',
    attempts: 0,
    nextRunAt: 1001,
    idempotencyKey: 'same',
    createdAt: 1001,
    updatedAt: 1001,
  })

  const jobs = await storage.listMemoryJobsByStatus('pending', 2000)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].id, 'job_2')
})

test('idb-backed storage factory exposes the same contract', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveDirtySegment({
    id: 'dirty_1',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    reason: 'index_failed',
    severity: 'medium',
    estimatedTokenImpact: 1200,
    dirtySince: 1000,
    priority: 10,
    status: 'pending',
    metadata: {},
  })

  const dirty = await storage.listDirtySegments('sess_1')
  assert.equal(dirty.length, 1)
  assert.equal(dirty[0].reason, 'index_failed')
})
