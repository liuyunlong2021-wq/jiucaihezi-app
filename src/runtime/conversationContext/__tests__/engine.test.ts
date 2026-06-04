import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ConversationContextEngine } from '../engine'
import { runConversationMemoryJobBatch } from '../jobWorker'
import { createLocalFallbackIndexDriver } from '../localFallbackIndexDriver'
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

test('ConversationContextEngine.build keeps history before runtime config isolation marker', async () => {
  const storage = createConversationContextMemoryStorage()
  const engine = new ConversationContextEngine({ storage })
  const result = await engine.build({
    userId: 'local',
    sessionId: 'sess_runtime_marker',
    userInput: '继续',
    currentMessages: [
      { id: 'u1', role: 'user', content: 'OLD_TASK_CONTEXT_MUST_REMAIN', timestamp: 1000 },
      { id: 'a1', role: 'assistant', content: 'OLD_ASSISTANT_PLAN_MUST_REMAIN', timestamp: 1001 },
      { id: 'marker_runtime', role: 'system', content: '[上下文已清除: 运行配置已变更]', timestamp: 1002 },
      { id: 'u2', role: 'user', content: '继续', timestamp: 1003 },
    ],
    selectedSkillId: 'skill_creator',
    primaryVaultId: null,
    enabledToolNames: [],
    modelId: 'claude-sonnet-4-6',
    contextBudget: 128000,
    contextMode: 'balanced',
    now: 2000,
  })

  assert.match(result.evidencePrompt, /OLD_TASK_CONTEXT_MUST_REMAIN/)
  assert.match(result.evidencePrompt, /OLD_ASSISTANT_PLAN_MUST_REMAIN/)
  assert.match(result.evidencePrompt, /继续/)
  assert.doesNotMatch(result.evidencePrompt, /运行配置已变更/)
})

test('current-turn document export keeps recent raw content while suppressing memory recall', async () => {
  const storage = createConversationContextMemoryStorage()
  const engine = new ConversationContextEngine({ storage })
  const result = await engine.build({
    userId: 'local',
    sessionId: 'sess_export_current_turn',
    userInput: '把上面的内容做成 Word',
    currentMessages: [
      { id: 'u1', role: 'user', content: '这是需要导出的正文：第一段商业计划，第二段执行清单。', timestamp: 1000 },
      { id: 'a1', role: 'assistant', content: '我已经整理好了这段内容。', timestamp: 1001 },
      { id: 'u2', role: 'user', content: '把上面的内容做成 Word', timestamp: 1002 },
    ],
    selectedSkillId: 'preset_docx',
    primaryVaultId: null,
    enabledToolNames: ['create_document'],
    modelId: 'claude-sonnet-4-6',
    contextBudget: 128000,
    contextMode: 'balanced',
    suppressMemoryRecall: true,
    now: 2000,
  })

  assert.equal(result.memoryHits.length, 0)
  assert.equal(result.degradation?.reason, 'disabled')
  assert.match(result.evidencePrompt, /这是需要导出的正文/)
  assert.match(result.evidencePrompt, /把上面的内容做成 Word/)
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

test('ConversationContextEngine.build creates a new segment when Skill Vault or critical tools change', async () => {
  const storage = createConversationContextMemoryStorage()
  const engine = new ConversationContextEngine({ storage })
  const first = await engine.build({
    userId: 'local',
    sessionId: 'sess_segment_change',
    userInput: '第一阶段',
    currentMessages: [{ id: 'u1', role: 'user', content: '第一阶段', timestamp: 1000 }],
    selectedSkillId: 'skill_a',
    primaryVaultId: 'vault_a',
    enabledToolNames: ['browser_open'],
    modelId: 'claude-sonnet-4-6',
    contextBudget: 128000,
    contextMode: 'balanced',
    now: 1000,
  })
  const second = await engine.build({
    userId: 'local',
    sessionId: 'sess_segment_change',
    userInput: '第二阶段',
    currentMessages: [{ id: 'u2', role: 'user', content: '第二阶段', timestamp: 2000 }],
    selectedSkillId: 'skill_b',
    primaryVaultId: 'vault_a',
    enabledToolNames: ['browser_open'],
    modelId: 'claude-sonnet-4-6',
    contextBudget: 128000,
    contextMode: 'balanced',
    now: 2000,
  })
  const third = await engine.build({
    userId: 'local',
    sessionId: 'sess_segment_change',
    userInput: '第三阶段',
    currentMessages: [{ id: 'u3', role: 'user', content: '第三阶段', timestamp: 3000 }],
    selectedSkillId: 'skill_b',
    primaryVaultId: 'vault_b',
    enabledToolNames: ['browser_open', 'dev_write'],
    modelId: 'claude-sonnet-4-6',
    contextBudget: 128000,
    contextMode: 'balanced',
    now: 3000,
  })

  const segments = await storage.listRuntimeSegments('sess_segment_change')
  assert.notEqual(first.runtimeSegmentId, second.runtimeSegmentId)
  assert.notEqual(second.runtimeSegmentId, third.runtimeSegmentId)
  assert.equal(segments.length, 3)
  assert.equal(segments[0].closedAt, 2000)
  assert.equal(segments[1].closedAt, 3000)
  assert.equal(segments[1].trigger, 'skill_changed')
  assert.equal(segments[2].trigger, 'primary_vault_changed')
})

test('ConversationContextEngine.afterAssistantMessage persists standard turn chunks before indexing', async () => {
  const storage = createConversationContextMemoryStorage()
  const engine = new ConversationContextEngine({ storage })
  await engine.afterAssistantMessage({
    sessionId: 'sess_turn_chunks',
    runtimeSegmentId: 'seg_1',
    runId: 'run_1',
    sourceMessageIds: ['u1', 'a1'],
    userMessageId: 'u1',
    assistantMessageId: 'a1',
    userContent: '用户明确决定：后续文章使用冷静克制的语气。',
    assistantContent: '我会延续冷静克制的语气，并保持结构清晰。',
    now: 3000,
  })

  const userChunks = await storage.listMessageChunksByMessageId('u1')
  const assistantChunks = await storage.listMessageChunksByMessageId('a1')

  assert.equal(userChunks.length, 1)
  assert.equal(assistantChunks.length, 1)
  assert.match(userChunks[0].text, /冷静克制/)
  assert.match(assistantChunks[0].text, /结构清晰/)
  assert.equal(userChunks[0].metadata.runtimeSegmentId, 'seg_1')
  assert.equal(assistantChunks[0].metadata.runtimeSegmentId, 'seg_1')
})

test('standard turn chunks flow into local memory and next build recall', async () => {
  const storage = createConversationContextMemoryStorage()
  const engine = new ConversationContextEngine({ storage })
  await storage.saveRuntimeSegment({
    id: 'seg_1',
    sessionId: 'sess_turn_recall',
    trigger: 'new_session',
    skillId: 'skill_writer',
    createdAt: 1000,
    metadata: {},
  })
  await engine.afterAssistantMessage({
    sessionId: 'sess_turn_recall',
    runtimeSegmentId: 'seg_1',
    runId: 'run_1',
    sourceMessageIds: ['u1', 'a1'],
    userMessageId: 'u1',
    assistantMessageId: 'a1',
    userContent: '用户明确决定：后续文章使用冷静克制的语气。',
    assistantContent: '我会延续冷静克制的语气，并保持结构清晰。',
    now: 3000,
  })
  await runConversationMemoryJobBatch({
    storage,
    driver: createLocalFallbackIndexDriver({ storage }),
    now: 4000,
    maxJobs: 5,
  })

  const result = await engine.build({
    userId: 'local',
    sessionId: 'sess_turn_recall',
    userInput: '继续用冷静克制语气写下一段',
    currentMessages: [{ id: 'u2', role: 'user', content: '继续用冷静克制语气写下一段', timestamp: 5000 }],
    selectedSkillId: 'skill_writer',
    primaryVaultId: null,
    enabledToolNames: [],
    modelId: 'claude-sonnet-4-6',
    contextBudget: 128000,
    contextMode: 'balanced',
    now: 5000,
  })

  assert.ok(result.memoryHits.some(hit => /冷静克制/.test(hit.text)))
  assert.match(result.evidencePrompt, /对话记忆索引证据/)
})

test('ConversationContextEngine.build recalls local memory hits into evidence and trace', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveRuntimeSegment({
    id: 'seg_1',
    sessionId: 'sess_memory',
    trigger: 'new_session',
    skillId: 'skill_writer',
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

test('ConversationContextEngine.build can suppress memory recall for current-turn document transformations', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveRuntimeSegment({
    id: 'seg_1',
    sessionId: 'sess_transform',
    trigger: 'new_session',
    createdAt: 1000,
    metadata: {},
  })
  await storage.saveMemoryItem({
    id: 'mem_lawyer',
    sessionId: 'sess_transform',
    runtimeSegmentId: 'seg_1',
    kind: 'fact',
    layer: 'turn',
    text: '律师案件材料：应当生成律师事务所方案。',
    score: 0.95,
    recallReason: 'seed',
    sourceMessageIds: ['u_lawyer'],
    createdAt: 1000,
    tokenCount: 20,
    updatedAt: 1000,
    indexDriver: 'local',
    idempotencyKey: 'mem_lawyer',
    syncStatus: 'synced',
    metadata: {},
  })
  const engine = new ConversationContextEngine({ storage })

  const result = await engine.build({
    userId: 'local',
    sessionId: 'sess_transform',
    userInput: '把上面的内容转成 Word 文档',
    currentMessages: [
      { id: 'u_script', role: 'user', content: '知识库回答：影视剧本核心是人物冲突和分场结构。', timestamp: 2000 },
      { id: 'a_script', role: 'assistant', content: '影视剧本内容摘要。', timestamp: 2001 },
      { id: 'u_now', role: 'user', content: '把上面的内容转成 Word 文档', timestamp: 3000 },
    ],
    selectedSkillId: undefined,
    primaryVaultId: null,
    enabledToolNames: ['create_document'],
    modelId: 'claude-sonnet-4-6',
    contextBudget: 128000,
    contextMode: 'balanced',
    suppressMemoryRecall: true,
    now: 3000,
  })

  assert.equal(result.memoryHits.length, 0)
  assert.doesNotMatch(result.evidencePrompt, /律师案件材料/)
  assert.match(result.evidencePrompt, /影视剧本核心/)
  assert.equal(result.degradation?.reason, 'disabled')
})

test('ConversationContextEngine.build does not recall memory from a different selected Skill', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveRuntimeSegment({
    id: 'seg_old',
    sessionId: 'sess_skill_filter',
    trigger: 'new_session',
    skillId: 'skill_lawyer',
    createdAt: 1000,
    metadata: {},
  })
  await storage.saveMemoryItem({
    id: 'mem_old_skill',
    sessionId: 'sess_skill_filter',
    runtimeSegmentId: 'seg_old',
    kind: 'fact',
    layer: 'turn',
    text: '律师 Skill 身份：你是律师工作台。',
    score: 0.99,
    recallReason: 'seed',
    sourceMessageIds: ['u_old'],
    skillId: 'skill_lawyer',
    createdAt: 1000,
    tokenCount: 20,
    updatedAt: 1000,
    indexDriver: 'local',
    idempotencyKey: 'mem_old_skill',
    syncStatus: 'synced',
    metadata: {},
  })
  const engine = new ConversationContextEngine({ storage })

  const result = await engine.build({
    userId: 'local',
    sessionId: 'sess_skill_filter',
    userInput: '你现在是什么 Skill？',
    currentMessages: [{ id: 'u_now', role: 'user', content: '你现在是什么 Skill？', timestamp: 3000 }],
    selectedSkillId: 'skill_script',
    primaryVaultId: null,
    enabledToolNames: [],
    modelId: 'claude-sonnet-4-6',
    contextBudget: 128000,
    contextMode: 'balanced',
    now: 3000,
  })

  assert.equal(result.memoryHits.length, 0)
  assert.doesNotMatch(result.evidencePrompt, /律师工作台/)
})

test('ConversationContextEngine.build rejects low priority memory over budget', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveRuntimeSegment({
    id: 'seg_1',
    sessionId: 'sess_budget',
    trigger: 'new_session',
    skillId: 'skill_writer',
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

test('ConversationContextEngine.build marks selected memory hits as used', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveRuntimeSegment({
    id: 'seg_1',
    sessionId: 'sess_last_used',
    trigger: 'new_session',
    skillId: 'skill_writer',
    createdAt: 1000,
    metadata: {},
  })
  await storage.saveMemoryItem({
    id: 'mem_used',
    sessionId: 'sess_last_used',
    runtimeSegmentId: 'seg_1',
    kind: 'decision',
    layer: 'anchor',
    text: '用户明确决定采用冷静克制风格。',
    score: 0.95,
    recallReason: 'seed',
    sourceMessageIds: ['u1'],
    createdAt: 1000,
    tokenCount: 20,
    updatedAt: 1000,
    indexDriver: 'local',
    idempotencyKey: 'mem_used',
    syncStatus: 'synced',
    metadata: {},
  })
  const engine = new ConversationContextEngine({ storage })

  await engine.build({
    userId: 'local',
    sessionId: 'sess_last_used',
    userInput: '继续冷静克制风格',
    currentMessages: [{ id: 'u2', role: 'user', content: '继续冷静克制风格', timestamp: 2000 }],
    selectedSkillId: 'skill_writer',
    primaryVaultId: null,
    enabledToolNames: [],
    modelId: 'claude-sonnet-4-6',
    contextBudget: 128000,
    contextMode: 'balanced',
    now: 5000,
  })

  const items = await storage.listMemoryItems('sess_last_used')
  assert.equal(items[0].lastUsedAt, 5000)
})

test('ConversationContextEngine.build triggers compaction in heavy mode when memory hits overflow budget', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveRuntimeSegment({
    id: 'seg_1',
    sessionId: 'sess_compact',
    trigger: 'new_session',
    skillId: 'skill_writer',
    createdAt: 1000,
    metadata: {},
  })
  for (let index = 0; index < 40; index += 1) {
    await storage.saveMemoryItem({
      id: `mem_fact_${index}`,
      sessionId: 'sess_compact',
      runtimeSegmentId: 'seg_1',
      kind: 'fact',
      layer: 'turn',
      text: `长期项目 风格 低价值事实 ${index} ` + '普通细节 '.repeat(120),
      score: 0.1,
      recallReason: 'seed',
      sourceMessageIds: [`u${index}`],
      createdAt: 1000,
      tokenCount: 300,
      updatedAt: 1000,
      indexDriver: 'local',
      idempotencyKey: `fact_${index}`,
      syncStatus: 'synced',
      metadata: { missedCount: 12 },
    })
  }
  await storage.saveMemoryItem({
    id: 'mem_anchor',
    sessionId: 'sess_compact',
    runtimeSegmentId: 'seg_1',
    kind: 'decision',
    layer: 'anchor',
    text: '长期项目 关键风格锚点：冷静克制。',
    score: 0.95,
    recallReason: 'seed',
    sourceMessageIds: ['u_anchor'],
    createdAt: 1000,
    tokenCount: 30,
    updatedAt: 1000,
    indexDriver: 'local',
    idempotencyKey: 'anchor',
    syncStatus: 'synced',
    metadata: {},
  })
  const engine = new ConversationContextEngine({ storage })
  const longHistory = Array.from({ length: 70 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `长期项目 历史消息 ${index} ` + '很多内容 '.repeat(180),
    timestamp: 2000 + index,
  }))

  const result = await engine.build({
    userId: 'local',
    sessionId: 'sess_compact',
    userInput: '继续长期项目的冷静克制风格',
    currentMessages: longHistory,
    selectedSkillId: 'skill_writer',
    primaryVaultId: null,
    enabledToolNames: [],
    modelId: 'small',
    contextBudget: 16000,
    contextMode: 'balanced',
    now: 5000,
  })
  const archived = (await storage.listMemoryItems('sess_compact')).filter(item => item.syncStatus === 'archived')

  assert.equal(result.loadLevel, 'heavy')
  assert.equal(result.trace.compaction.triggered, true)
  assert.equal(result.trace.compaction.reason, 'heavy_memory_hits_over_budget')
  assert.ok(result.trace.compaction.turnLayerCount > 0)
  assert.ok(result.trace.compaction.sessionAnchorCount >= 1)
  assert.ok(archived.length > 0)
})

test('ConversationContextEngine.build recalls historical source chunks for heavy memory hits', async () => {
  const storage = createConversationContextMemoryStorage()
  await storage.saveRuntimeSegment({
    id: 'seg_old',
    sessionId: 'sess_history_chunks',
    trigger: 'new_session',
    skillId: 'skill_writer',
    createdAt: 1000,
    closedAt: 2000,
    metadata: {},
  })
  await storage.saveRuntimeSegment({
    id: 'seg_current',
    sessionId: 'sess_history_chunks',
    trigger: 'skill_changed',
    skillId: 'skill_writer',
    createdAt: 3000,
    metadata: {},
  })
  await storage.saveMessageChunks([
    {
      id: 'u_old_chunk_0',
      sessionId: 'sess_history_chunks',
      messageId: 'u_old',
      parentMessageId: 'u_old',
      role: 'user',
      chunkIndex: 0,
      text: '早期原文设定：主角必须保持冷静克制，并且不能使用夸张语气。',
      startOffset: 0,
      endOffset: 32,
      tokenCount: 32,
      semanticTitle: '早期风格设定',
      contentKind: 'plain',
      createdAt: 1000,
      metadata: { runtimeSegmentId: 'seg_old' },
    },
  ])
  await storage.saveMemoryItem({
    id: 'mem_old_anchor',
    sessionId: 'sess_history_chunks',
    runtimeSegmentId: 'seg_old',
    kind: 'decision',
    layer: 'anchor',
    text: '早期设定 冷静克制 夸张语气',
    score: 0.95,
    recallReason: 'seed',
    sourceMessageIds: ['u_old'],
    createdAt: 1000,
    tokenCount: 12,
    updatedAt: 1000,
    indexDriver: 'local',
    idempotencyKey: 'old_anchor',
    syncStatus: 'synced',
    metadata: {},
  })
  const engine = new ConversationContextEngine({ storage })
  const longHistory = Array.from({ length: 70 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `长文历史 ${index} ` + '内容 '.repeat(160),
    timestamp: 4000 + index,
  }))

  const result = await engine.build({
    userId: 'local',
    sessionId: 'sess_history_chunks',
    userInput: '继续早期设定的冷静克制风格，不要夸张语气',
    currentMessages: longHistory,
    selectedSkillId: 'skill_writer',
    primaryVaultId: null,
    enabledToolNames: [],
    modelId: 'small',
    contextBudget: 16000,
    contextMode: 'balanced',
    now: 5000,
  })

  assert.equal(result.loadLevel, 'heavy')
  assert.match(result.evidencePrompt, /\[记忆命中对应原文块\]/)
  assert.match(result.evidencePrompt, /早期原文设定/)
  assert.equal(result.trace.chunkRetrieval.historicalChunkCount, 1)
  assert.ok((result.trace.chunkRetrieval.historicalChunkTokens || 0) > 0)
})
