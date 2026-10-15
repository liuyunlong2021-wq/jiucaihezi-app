import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { buildCreativeContext, fitDirectRequest } from '../creativeMemory'

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

test('buildCreativeContext keeps all five complete rounds when capacity permits', () => {
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
    'u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'u4', 'a4', 'u5', 'a5', 'u-latest',
  ])
})

test('buildCreativeContext uses model capacity rather than a fixed history token ceiling', () => {
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

  assert.deepEqual(result.messages.map(message => message.id), ['u1', 'a1', 'u-latest'])
  assert.equal(result.omittedMessages, 0)
})

test('request budget includes rules, tools and output, removes whole older turns only', () => {
  const messages = [
    { role: 'system', content: '规则'.repeat(500) },
    { role: 'user', content: '旧问题'.repeat(500) },
    { role: 'assistant', content: '旧回答'.repeat(500) },
    { role: 'user', content: '修改本段：不能复合。' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'r1', type: 'function', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'r1', content: '王刚的初恋尚未揭晓。' },
  ]
  const result = fitDirectRequest({ messages, tools: [{ function: { name: 'read', description: '工具'.repeat(80) } }] }, 4000, 500)
  assert.ok(result.inputTokens + result.maxOutputTokens + result.safetyTokens <= 4000)
  assert.equal(result.messages.length, 4)
  assert.equal(result.messages.at(-1)?.tool_call_id, 'r1')
  assert.match(result.messages.find(item => item.role === 'user')!.content, /不能复合/)
  assert.equal(messages.length, 6)
})

test('oversized current source fails visibly instead of truncating names or dialogue', () => {
  assert.throws(() => fitDirectRequest({ messages: [{ role: 'user', content: '不能复合。'.repeat(3000) }] }, 2000, 500), /上下文|分段/)
})

test('query material is optional, latest task evidence and tool pairs are not discarded', () => {
  const result = fitDirectRequest({ messages: [
    { role: 'system', content: '规则' },
    { role: 'system', content: `<retrieved_context>\n${'可选历史'.repeat(4000)}\n</retrieved_context>` },
    { role: 'user', content: '当前文本' },
  ] }, 2000, 500)
  assert.equal(result.messages.at(-1)?.content, '当前文本')
  assert.ok(result.omittedMessages > 0)
})

test('tool image followups and length continuation prompts do not replace the protected user request', () => {
  const current = { role: 'user', content: '当前不可丢失的修改要求：不要复合。' }
  const request = { messages: [
    { role: 'user', content: '旧问题'.repeat(1500) },
    { role: 'assistant', content: '旧回答'.repeat(1500) }, current,
    { role: 'assistant', tool_calls: [{ id: 'image', type: 'function', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'image', content: '图片已读取' },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/ref.png' } }] },
    { role: 'user', content: '继续未完成输出' },
  ] }
  const result = fitDirectRequest(request, 3000, 500, current)
  assert.ok(result.messages.some(item => item.content === current.content))
  assert.ok(result.messages.some(item => item.tool_call_id === 'image'))
  assert.ok(result.messages.some(item => Array.isArray(item.content)))
})
