import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildOversizedInputPlan, chunkConversationText } from '../oversizedInput'

test('chunkConversationText preserves markdown code fences and records offsets', () => {
  const text = [
    '# 标题',
    '',
    '第一段内容，说明任务背景。',
    '',
    '```ts',
    'const answer = 42',
    'console.log(answer)',
    '```',
    '',
    '第二段内容，继续说明约束。',
  ].join('\n')

  const chunks = chunkConversationText({
    messageId: 'msg_1',
    sessionId: 'sess_1',
    role: 'user',
    text,
    targetTokens: 40,
    maxTokens: 80,
    overlapTokens: 10,
    now: 1000,
  })

  assert.ok(chunks.length >= 1)
  assert.equal(chunks[0].chunkIndex, 0)
  assert.equal(text.slice(chunks[0].startOffset, chunks[0].endOffset), chunks[0].text)
  assert.ok(chunks.some(chunk => chunk.text.includes('```ts\nconst answer = 42')))
  assert.ok(chunks.every(chunk => chunk.semanticTitle.length > 0))
})

test('buildOversizedInputPlan creates three-layer brief and mandatory chunks', () => {
  const longText = Array.from({ length: 80 }, (_, index) => `## 小节 ${index}\n这里是第 ${index} 段，包含角色设定、风格约束和关键决策。`).join('\n\n')
  const plan = buildOversizedInputPlan({
    sessionId: 'sess_1',
    messageId: 'msg_1',
    role: 'user',
    text: longText,
    availableInputBudget: 12000,
    loadLevel: 'heavy',
    recentTurnSummaries: ['上一轮决定采用冷静克制的语气。'],
    anchorSummaries: ['锚点：主角必须保持理性，不使用夸张口吻。'],
    now: 1000,
  })

  assert.equal(plan.enabled, true)
  assert.equal(plan.reason, 'current_input_dominates_budget')
  assert.ok(plan.briefLayers.currentTurnDetailed.includes('当前任务'))
  assert.ok(plan.briefLayers.recentTurnsCompressed.includes('上一轮决定'))
  assert.ok(plan.briefLayers.anchorSummary.includes('锚点'))
  assert.ok(plan.mandatoryChunkIds.length > 0)
  assert.ok(plan.chunkIds.length >= plan.mandatoryChunkIds.length)
  assert.ok(plan.brief.sourcePointers.length > 0)
})

test('chunkConversationText applies real overlap between oversized chunks', () => {
  const text = Array.from({ length: 120 }, (_, index) => `第${index}句包含连续长文本和上下文锚点。`).join('')
  const chunks = chunkConversationText({
    messageId: 'msg_overlap',
    sessionId: 'sess_1',
    role: 'user',
    text,
    targetTokens: 80,
    maxTokens: 120,
    overlapTokens: 20,
    now: 1000,
  })

  assert.ok(chunks.length > 1)
  for (let index = 1; index < chunks.length; index += 1) {
    assert.ok(chunks[index].startOffset < chunks[index - 1].endOffset)
    assert.ok(chunks[index].text.length > 0)
  }
})
