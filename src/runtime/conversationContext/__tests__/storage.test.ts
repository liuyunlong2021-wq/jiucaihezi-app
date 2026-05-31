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

test('storage deletes all conversation context records for a session', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveRuntimeSegment({
    id: 'seg_1',
    sessionId: 'sess_1',
    trigger: 'new_session',
    createdAt: 1000,
    metadata: {},
  })
  await storage.saveRunSnapshot({
    id: 'snap_1',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    userMessageId: 'u1',
    enabledToolNames: [],
    modelId: 'm',
    contextMode: 'balanced',
    loadLevel: 'light',
    promptPlan: {},
    createdAt: 1000,
  })

  await storage.deleteSession('sess_1')

  assert.equal((await storage.listRuntimeSegments('sess_1')).length, 0)
  assert.equal((await storage.listRunSnapshots('sess_1')).length, 0)
})

test('storage invalidates derived context for edited or deleted messages', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveRuntimeSegment({
    id: 'seg_1',
    sessionId: 'sess_1',
    trigger: 'new_session',
    createdAt: 1000,
    metadata: {},
  })
  await storage.saveMessageChunks([
    {
      id: 'u1_chunk',
      sessionId: 'sess_1',
      messageId: 'u1',
      parentMessageId: 'u1',
      role: 'user',
      chunkIndex: 0,
      text: '旧用户消息',
      startOffset: 0,
      endOffset: 5,
      tokenCount: 5,
      semanticTitle: '旧用户消息',
      contentKind: 'plain',
      createdAt: 1000,
      metadata: { runtimeSegmentId: 'seg_1' },
    },
    {
      id: 'a1_chunk',
      sessionId: 'sess_1',
      messageId: 'a1',
      parentMessageId: 'a1',
      role: 'assistant',
      chunkIndex: 0,
      text: '旧助手消息',
      startOffset: 0,
      endOffset: 5,
      tokenCount: 5,
      semanticTitle: '旧助手消息',
      contentKind: 'plain',
      createdAt: 1001,
      metadata: { runtimeSegmentId: 'seg_1' },
    },
  ])
  await storage.saveMemoryItem({
    id: 'mem_1',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    kind: 'fact',
    layer: 'turn',
    text: '旧助手消息',
    score: 0.7,
    recallReason: 'indexed_turn',
    sourceMessageIds: ['u1', 'a1'],
    createdAt: 1002,
    tokenCount: 5,
    updatedAt: 1002,
    indexDriver: 'local',
    idempotencyKey: 'idem_1',
    syncStatus: 'local_only',
    metadata: {},
  })
  await storage.enqueueMemoryJob({
    id: 'job_1',
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    runId: 'run_1',
    sourceMessageIds: ['u1', 'a1'],
    status: 'pending',
    attempts: 0,
    nextRunAt: 1002,
    idempotencyKey: 'job_1',
    createdAt: 1002,
    updatedAt: 1002,
  })

  await storage.invalidateMessages('sess_1', ['a1'], 2000, 'message_changed')

  assert.equal((await storage.listMessageChunksByMessageId('a1')).length, 0)
  assert.equal((await storage.listMessageChunksByMessageId('u1')).length, 1)
  assert.equal((await storage.listMemoryItems('sess_1'))[0].syncStatus, 'delete_pending')
  assert.equal((await storage.listMemoryJobsByStatus('repair_required', 3000)).length, 1)
  const dirty = await storage.listDirtySegments('sess_1')
  assert.equal(dirty.length, 1)
  assert.equal(dirty[0].reason, 'message_changed')
})
