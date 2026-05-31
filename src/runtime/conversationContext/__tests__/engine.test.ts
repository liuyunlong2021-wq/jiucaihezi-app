import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ConversationContextEngine } from '../engine'
import { createConversationContextMemoryStorage } from '../storage'

test('ConversationContextEngine.build returns segment load evidence and trace', async () => {
  const storage = createConversationContextMemoryStorage()
  const engine = new ConversationContextEngine({ storage })
  const result = await engine.build({
    userId: 'local',
    sessionId: 'sess_1',
    userInput: '继续上次的项目设定',
    currentMessages: [
      { id: 'u1', role: 'user', content: '我们定了冷静克制的风格', timestamp: 1000 },
      { id: 'a1', role: 'assistant', content: '已记录这个方向', timestamp: 1001 },
    ],
    selectedSkillId: 'skill_writer',
    primaryVaultId: 'vault_1',
    enabledToolNames: ['browser_open'],
    modelId: 'claude-sonnet-4-6',
    contextBudget: 128000,
    contextMode: 'balanced',
    now: 2000,
  })

  assert.match(result.runtimeSegmentId, /^seg_/)
  assert.equal(result.loadLevel, 'standard')
  assert.match(result.evidencePrompt, /\[最近原始消息开始\]/)
  assert.equal(result.trace.sessionId, 'sess_1')
  assert.equal(result.trace.runtimeSegmentId, result.runtimeSegmentId)
})

test('ConversationContextEngine.build chunks oversized input and records trace counts', async () => {
  const storage = createConversationContextMemoryStorage()
  const engine = new ConversationContextEngine({ storage })
  const userInput = Array.from({ length: 520 }, (_, index) => `## 段落 ${index}\n这里是很长的输入，包含关键设定和约束。`).join('\n\n')
  const result = await engine.build({
    userId: 'local',
    sessionId: 'sess_long',
    userInput,
    currentMessages: [{ id: 'u_long', role: 'user', content: userInput, timestamp: 1000 }],
    selectedSkillId: 'skill_writer',
    primaryVaultId: null,
    enabledToolNames: [],
    modelId: 'small-model',
    contextBudget: 8000,
    contextMode: 'balanced',
    now: 2000,
  })

  assert.equal(result.loadLevel, 'heavy')
  assert.ok(result.oversizedInput?.enabled)
  assert.ok(result.trace.chunkRetrieval.mandatoryChunkCount > 0)
  assert.match(result.evidencePrompt, /当前超长输入 - 三层 Brief/)
})

test('ConversationContextEngine.afterAssistantMessage enqueues idempotent memory job', async () => {
  const storage = createConversationContextMemoryStorage()
  const engine = new ConversationContextEngine({ storage })
  await engine.afterAssistantMessage({
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    runId: 'run_1',
    sourceMessageIds: ['u1', 'a1'],
    now: 3000,
  })
  await engine.afterAssistantMessage({
    sessionId: 'sess_1',
    runtimeSegmentId: 'seg_1',
    runId: 'run_1',
    sourceMessageIds: ['u1', 'a1'],
    now: 3001,
  })

  const jobs = await storage.listMemoryJobsByStatus('pending', 4000)
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].idempotencyKey.includes('sess_1'), true)
})

test('ConversationContextEngine.afterAssistantMessage saves run snapshot with prompt plan', async () => {
  const storage = createConversationContextMemoryStorage()
  const engine = new ConversationContextEngine({ storage })
  const context = await engine.build({
    userId: 'local',
    sessionId: 'sess_snapshot',
    userInput: '写一段话',
    currentMessages: [{ id: 'u1', role: 'user', content: '写一段话', timestamp: 1000 }],
    selectedSkillId: 'skill_writer',
    primaryVaultId: 'vault_1',
    enabledToolNames: ['browser_open'],
    modelId: 'claude-sonnet-4-6',
    providerId: 'newapi',
    contextBudget: 128000,
    contextMode: 'balanced',
    now: 2000,
  })

  await engine.afterAssistantMessage({
    sessionId: 'sess_snapshot',
    runtimeSegmentId: context.runtimeSegmentId,
    runId: 'run_snapshot',
    sourceMessageIds: ['u1', 'a1'],
    assistantMessageId: 'a1',
    userMessageId: 'u1',
    selectedSkillId: 'skill_writer',
    primaryVaultId: 'vault_1',
    enabledToolNames: ['browser_open'],
    modelId: 'claude-sonnet-4-6',
    providerId: 'newapi',
    contextMode: 'balanced',
    loadLevel: context.loadLevel,
    promptPlan: context.trace,
    now: 3000,
  })

  const snapshots = await storage.listRunSnapshots('sess_snapshot')
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].assistantMessageId, 'a1')
  assert.equal(snapshots[0].promptPlan.runtimeSegmentId, context.runtimeSegmentId)
})

test('ConversationContextEngine.build recalls local memory hits into evidence and trace', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveRuntimeSegment({
    id: 'seg_1',
    sessionId: 'sess_memory',
    trigger: 'new_session',
    createdAt: 1000,
    metadata: {},
  })
  await storage.saveMemoryItem({
    id: 'mem_1',
    sessionId: 'sess_memory',
    runtimeSegmentId: 'seg_1',
    kind: 'decision',
    layer: 'anchor',
    text: '用户明确决定采用冷静克制的写作风格。',
    score: 0.95,
    recallReason: 'seed',
    sourceMessageIds: ['u1'],
    createdAt: 1000,
    tokenCount: 20,
    updatedAt: 1000,
    indexDriver: 'local',
    idempotencyKey: 'mem_1',
    syncStatus: 'synced',
    metadata: {},
  })
  const engine = new ConversationContextEngine({ storage })

  const result = await engine.build({
    userId: 'local',
    sessionId: 'sess_memory',
    userInput: '继续冷静克制风格写下一段',
    currentMessages: [
      { id: 'u2', role: 'user', content: '继续冷静克制风格写下一段', timestamp: 2000 },
    ],
    selectedSkillId: 'skill_writer',
    primaryVaultId: null,
    enabledToolNames: [],
    modelId: 'claude-sonnet-4-6',
    contextBudget: 128000,
    contextMode: 'balanced',
    now: 3000,
  })

  assert.equal(result.memoryHits.length, 1)
  assert.match(result.evidencePrompt, /对话记忆索引证据/)
  assert.match(result.evidencePrompt, /冷静克制/)
  assert.equal(result.trace.anchorHitCount, 1)
  assert.ok(result.trace.selectedSources.some(source => source.section === 'conversation-memory'))
})

test('ConversationContextEngine.build rejects low priority memory over budget', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveRuntimeSegment({
    id: 'seg_1',
    sessionId: 'sess_budget',
    trigger: 'new_session',
    createdAt: 1000,
    metadata: {},
  })
  for (let index = 0; index < 20; index += 1) {
    await storage.saveMemoryItem({
      id: `mem_${index}`,
      sessionId: 'sess_budget',
      runtimeSegmentId: 'seg_1',
      kind: 'fact',
      layer: 'turn',
      text: `冷静克制 风格 事实 ${index} ` + '长内容 '.repeat(200),
      score: index / 100,
      recallReason: 'seed',
      sourceMessageIds: [`u${index}`],
      createdAt: 1000,
      tokenCount: 500,
      updatedAt: 1000,
      indexDriver: 'local',
      idempotencyKey: `mem_${index}`,
      syncStatus: 'synced',
      metadata: {},
    })
  }
  const engine = new ConversationContextEngine({ storage })
  const result = await engine.build({
    userId: 'local',
    sessionId: 'sess_budget',
    userInput: '冷静克制 风格',
    currentMessages: [{ id: 'u_now', role: 'user', content: '冷静克制 风格', timestamp: 2000 }],
    selectedSkillId: 'skill_writer',
    primaryVaultId: null,
    enabledToolNames: [],
    modelId: 'small',
    contextBudget: 16000,
    contextMode: 'balanced',
    now: 3000,
  })

  assert.ok(result.memoryHits.length < 20)
  assert.ok(result.trace.rejectedSources.some(source => source.section === 'conversation-memory' && source.reason === 'over_budget'))
})

test('ConversationContextEngine.build degrades cleanly when memory index fails', async () => {
  const storage = createConversationContextMemoryStorage()
  const engine = new ConversationContextEngine({
    storage,
    memoryIndexDriver: {
      async search() {
        throw new Error('index unavailable')
      },
      async indexTurn() {
        return { items: [] }
      },
      async deleteSession() {},
    },
  })

  const result = await engine.build({
    userId: 'local',
    sessionId: 'sess_degraded',
    userInput: '继续前面的设定',
    currentMessages: [{ id: 'u1', role: 'user', content: '继续前面的设定', timestamp: 2000 }],
    selectedSkillId: 'skill_writer',
    primaryVaultId: null,
    enabledToolNames: [],
    modelId: 'claude-sonnet-4-6',
    contextBudget: 128000,
    contextMode: 'balanced',
    now: 3000,
  })

  assert.equal(result.memoryHits.length, 0)
  assert.equal(result.degradation?.reason, 'memory_index_error')
  assert.equal(result.trace.degradation?.reason, 'memory_index_error')
  assert.doesNotMatch(result.evidencePrompt, /对话记忆索引证据/)
})
