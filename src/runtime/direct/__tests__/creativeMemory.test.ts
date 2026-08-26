import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { buildCreativeContext } from '../creativeMemory'

test('creative memory only assembles context and never defines a project raw ledger', () => {
  const source = readFileSync('src/runtime/direct/creativeMemory.ts', 'utf8')

  assert.doesNotMatch(source, /appendCreativeMemoryEvent|createCreativeMemoryRecorder|encodeCreativeMemoryEvent/)
  assert.doesNotMatch(source, /\.raw\/sessions|jcses_/)
  assert.doesNotMatch(source, /readCreativeProjectMemory|projectMemory|hotMemoryPrompt/)
})

test('builds creative context by capacity without mandatory Wiki injection', () => {
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
  })

  assert.deepEqual(result.messages.map(message => message.id), ['u2'])
  assert.ok(result.estimatedTokens <= 150)
  assert.equal(result.omittedMessages, 2)
})

test('buildCreativeContext estimates Chinese text with the installed multilingual estimator', () => {
  const result = buildCreativeContext({
    messages: [{ id: 'u1', role: 'user', content: '中文'.repeat(1_000) }],
    modelId: 'claude-sonnet-4-6',
    contextWindow: 10_000,
    reservedTokens: 0,
  })

  assert.ok(result.estimatedTokens > 1_000)
})

test('buildCreativeContext excludes failed assistant UI errors and their user turns', () => {
  for (const finishReason of ['network_error', 'http_error', 'web_cloud_error', 'web_cloud_http_error', 'web_cloud_login_required', 'abort', 'content_filter']) {
    const result = buildCreativeContext({
      messages: [
        { id: 'u-ok', role: 'user', content: '正常历史问题' },
        { id: 'a-ok', role: 'assistant', content: '正常历史回答', finishReason: 'stop' },
        { id: `u-${finishReason}`, role: 'user', content: `失败附件说明 ${finishReason}`, files: [{ name: 'old.mov', content: '旧附件摘要' }] },
        { id: `a-${finishReason}`, role: 'assistant', content: `UI 错误 ${finishReason}`, finishReason },
        { id: 'u-latest', role: 'user', content: '最新纯文字请求' },
      ],
      modelId: 'gpt-5.6-terra',
      contextWindow: 10_000,
      reservedTokens: 1_000,
    })

    assert.deepEqual(result.messages.map(message => message.id), ['u-ok', 'a-ok', 'u-latest'])
  }
})

test('buildCreativeContext keeps ordinary stop and length assistant turns', () => {
  const result = buildCreativeContext({
    messages: [
      { id: 'u-stop', role: 'user', content: '问题一' },
      { id: 'a-stop', role: 'assistant', content: '回答一', finishReason: 'stop' },
      { id: 'u-length', role: 'user', content: '问题二' },
      { id: 'a-length', role: 'assistant', content: '回答二', finishReason: 'length' },
      { id: 'u-latest', role: 'user', content: '问题三' },
    ],
    modelId: 'gpt-5.6-terra',
    contextWindow: 10_000,
    reservedTokens: 1_000,
  })

  assert.deepEqual(result.messages.map(message => message.id), ['u-stop', 'a-stop', 'u-length', 'a-length', 'u-latest'])
})

test('buildCreativeContext keeps only the last three complete rounds', () => {
  const messages = Array.from({ length: 5 }, (_, index) => [
    { id: `u${index + 1}`, role: 'user', content: `问题 ${index + 1}` },
    { id: `a${index + 1}`, role: 'assistant', content: `回答 ${index + 1}` },
  ]).flat()
  const result = buildCreativeContext({
    messages: [...messages, { id: 'u-latest', role: 'user', content: '继续修改' }],
    modelId: 'gpt-5.6-terra',
    contextWindow: 100_000,
    reservedTokens: 0,
  })

  assert.deepEqual(result.messages.map(message => message.id), [
    'u3', 'a3', 'u4', 'a4', 'u5', 'a5', 'u-latest',
  ])
})

test('buildCreativeContext caps completed-round history at 12K tokens', () => {
  const result = buildCreativeContext({
    messages: [
      { id: 'u1', role: 'user', content: '旧问题'.repeat(10_000) },
      { id: 'a1', role: 'assistant', content: '旧回答'.repeat(10_000) },
      { id: 'u-latest', role: 'user', content: '当前问题' },
    ],
    modelId: 'gpt-5.6-terra',
    contextWindow: 100_000,
    reservedTokens: 0,
  })

  assert.deepEqual(result.messages.map(message => message.id), ['u-latest'])
  assert.equal(result.omittedMessages, 2)
})
