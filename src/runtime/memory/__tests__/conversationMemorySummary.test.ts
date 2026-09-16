import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CONVERSATION_MEMORY_SUMMARY_PROMPT,
  buildConversationMemorySummaryRequest,
  parseConversationMemorySummaryPayload,
} from '../conversationMemorySummary'

test('conversation memory summary request uses the fixed plain-text prompt', () => {
  const request = buildConversationMemorySummaryRequest('model-1', '当前 assistant 的完整回答')
  assert.equal(request.model, 'model-1')
  assert.equal(request.messages[0]?.role, 'system')
  assert.equal(request.messages[0]?.content, CONVERSATION_MEMORY_SUMMARY_PROMPT)
  assert.deepEqual(request.messages[1], { role: 'user', content: '当前 assistant 的完整回答' })
  assert.equal(request.max_tokens, 800)
  assert.match(CONVERSATION_MEMORY_SUMMARY_PROMPT, /只输出两行纯文本/)
  assert.equal('response_format' in request, false)
  assert.equal('tools' in request, false)
})

test('conversation memory summary uses the same text contract for Opus', () => {
  const request = buildConversationMemorySummaryRequest(
    'claude-opus-4-7',
    '当前 assistant 的完整回答',
  )
  assert.equal(request.max_tokens, 800)
  assert.equal('tools' in request, false)
  assert.equal('response_format' in request, false)
})

test('conversation memory summary uses Ollama native no-thinking text contract', () => {
  const request = buildConversationMemorySummaryRequest(
    'qwen3.6:35b-a3b',
    '当前 assistant 的完整回答',
    'local-ollama',
  )
  assert.equal(request.model, 'qwen3.6:35b-a3b')
  assert.equal(request.stream, false)
  assert.equal(request.think, false)
  assert.equal(request.options?.num_predict, 256)
  assert.equal(request.options?.temperature, 0.2)
  assert.equal('format' in request, false)
  assert.equal('response_format' in request, false)
})

test('conversation memory summary parser turns plain text into the fixed index structure', () => {
  assert.deepEqual(
    parseConversationMemorySummaryPayload({
      choices: [{ message: { content: '简介：确认方案\n关键词：方案、记忆索引' } }],
    }),
    { summary: '确认方案', keywords: ['方案', '记忆索引'] },
  )
  assert.deepEqual(
    parseConversationMemorySummaryPayload({
      message: { content: '简介：原生接口成功\n关键词：Ollama' },
      done_reason: 'stop',
    }),
    { summary: '原生接口成功', keywords: ['Ollama'] },
  )
})

test('conversation memory summary parser accepts a plain summary and derives a fallback keyword', () => {
  assert.deepEqual(
    parseConversationMemorySummaryPayload(
      { choices: [{ message: { content: '已将 MemoryWorkbench.vue 的持续引用改为跨轮保留。' } }] },
      '修改 src/components/memory/MemoryWorkbench.vue',
    ),
    { summary: '已将 MemoryWorkbench.vue 的持续引用改为跨轮保留。', keywords: ['已将 MemoryWorkbench.vue 的持续引用改为跨轮', 'src', 'components', 'memory', 'MemoryWorkbench.vue'] },
  )
})

test('conversation memory summary parser rejects missing visible text', () => {
  const invalid = [
    { choices: [{ message: { content: '' } }] },
    { choices: [{ message: { reasoning: '无可见正文' } }] },
  ]
  for (const payload of invalid) assert.throws(() => parseConversationMemorySummaryPayload(payload))
})

test('conversation memory summary parser normalizes text and caps it program-side', () => {
  assert.deepEqual(
    parseConversationMemorySummaryPayload({
      choices: [
        { message: { content: '简介：  简介  \n关键词：  关键词 、关键词' } },
      ],
    }),
    { summary: '简介', keywords: ['关键词'] },
  )
  const result = parseConversationMemorySummaryPayload({ choices: [{ message: { content: `简介：${'a'.repeat(241)}\n关键词：${'x'.repeat(33)}` } }] })
  assert.equal(result.summary.length, 240)
  assert.deepEqual(result.keywords, ['a'.repeat(32)])
})
