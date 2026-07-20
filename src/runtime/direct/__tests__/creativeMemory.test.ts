import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { buildCreativeContext } from '../creativeMemory'

test('creative memory only assembles context and never defines a project raw ledger', () => {
  const source = readFileSync('src/runtime/direct/creativeMemory.ts', 'utf8')

  assert.doesNotMatch(source, /appendCreativeMemoryEvent|createCreativeMemoryRecorder|encodeCreativeMemoryEvent/)
  assert.doesNotMatch(source, /\.raw\/sessions|jcses_/)
})

test('builds creative context by capacity, keeps the newest complete turn, and adds hot project memory', () => {
  const messages = [
    { id: 'u1', role: 'user', content: '旧消息'.repeat(80) },
    { id: 'a1', role: 'assistant', content: '旧回答'.repeat(80) },
    { id: 'u2', role: 'user', content: '最新问题' },
  ]
  const result = buildCreativeContext({
    messages,
    modelId: 'openai/gpt-oss-120b:free',
    contextWindow: 150,
    reservedTokens: 100,
    projectMemory: { claude: '项目规则', hot: '当前热记忆' },
  })

  assert.deepEqual(result.messages.map(message => message.id), ['u2'])
  assert.match(result.systemPrompt, /项目规则/)
  assert.match(result.systemPrompt, /当前热记忆/)
  assert.ok(result.estimatedTokens <= 150)
})
