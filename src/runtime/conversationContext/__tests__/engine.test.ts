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
