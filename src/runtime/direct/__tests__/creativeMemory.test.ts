import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { randomBytes } from 'node:crypto'

import { buildCreativeContext, fitDirectRequest } from '../creativeMemory'

function imageData(width = 1024, height = 1024, bytes = 4 * 1024 * 1024) {
  const data = randomBytes(bytes)
  data.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  data.writeUInt32BE(width, 16)
  data.writeUInt32BE(height, 20)
  return `data:image/png;base64,${data.toString('base64')}`
}

test('image payload size is not text tokens, pixels still reserve budget, and payload stays intact', () => {
  const url = imageData()
  const messages = [{ role: 'user', content: [{ type: 'text', text: '分析图片' }, { type: 'image_url', image_url: { url } }] }]
  const result = fitDirectRequest({ messages }, 32_768, 4096)
  assert.ok(result.inputTokens >= 4096 && result.inputTokens < 20_000)
  assert.deepEqual(result.messages, messages)
  assert.equal((messages[0]!.content[1] as any).image_url.url, url)
  const small = fitDirectRequest({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: imageData(1024, 1024, 100) } }] }] }, 32_768, 4096)
  assert.ok(Math.abs(result.inputTokens - small.inputTokens) < 100)
  assert.throws(() => fitDirectRequest({ messages }, 3000, 500), /上下文|分段/)
})

test('remote or malformed image dimensions keep a nonzero conservative reserve without fetching', () => {
  for (const url of ['https://example.com/ref.png', 'data:image/png;base64,broken']) {
    const messages = [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }]
    const result = fitDirectRequest({ messages }, 1_050_000, 128_000)
    assert.ok(result.inputTokens >= 65_536)
    assert.deepEqual(result.messages, messages)
  }
})

test('JPEG, GIF and all three WebP headers use pixel estimates rather than the unknown fallback', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 9, 8, 4, 0, 4, 0, 1, 0, 0xff, 0xd9])
  const gif = Buffer.alloc(10)
  gif.write('GIF89a'); gif.writeUInt16LE(1024, 6); gif.writeUInt16LE(1024, 8)
  const webp = (kind: string) => { const data = Buffer.alloc(30); data.write('RIFF'); data.write('WEBP', 8); data.write(kind, 12); return data }
  const vp8x = webp('VP8X'); vp8x.writeUIntLE(1023, 24, 3); vp8x.writeUIntLE(1023, 27, 3)
  const vp8l = webp('VP8L'); vp8l[20] = 0x2f; vp8l.writeUInt32LE(1023 | (1023 << 14), 21)
  const vp8 = webp('VP8 '); vp8.set([0x9d, 1, 0x2a], 23); vp8.writeUInt16LE(1024, 26); vp8.writeUInt16LE(1024, 28)
  for (const [mime, data] of [['jpeg', jpeg], ['gif', gif], ['webp', vp8x], ['webp', vp8l], ['webp', vp8]] as const) {
    const result = fitDirectRequest({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/${mime};base64,${data.toString('base64')}` } }] }] }, 32_768, 4096)
    assert.ok(result.inputTokens >= 4096 && result.inputTokens < 5000, mime)
  }
})

test('images reserve pixels per occurrence and do not bypass text or tool-result limits', () => {
  const url = imageData(2048, 2048, 100)
  const image = { type: 'image_url', image_url: { url } }
  const one = fitDirectRequest({ messages: [{ role: 'user', content: [image] }] }, 1_050_000, 128_000)
  const two = fitDirectRequest({ messages: [{ role: 'user', content: [image, image] }] }, 1_050_000, 128_000)
  assert.ok(two.inputTokens > one.inputTokens * 1.9)
  assert.throws(() => fitDirectRequest({ messages: [{ role: 'user', content: [image, { type: 'text', text: '正文'.repeat(100_000) }] }] }, 32_768, 4096), /上下文/)
  assert.throws(() => fitDirectRequest({ messages: [{ role: 'tool', content: imageData() }] }, 2000, 500), /上下文/)
})

test('history images use the same estimator without dropping an entire valid round', () => {
  const url = imageData()
  const result = buildCreativeContext({ messages: [
    { id: 'u1', role: 'user', content: '看图', images: [url] },
    { id: 'a1', role: 'assistant', content: '分析结果' },
    { id: 'u2', role: 'user', content: '继续' },
  ], modelId: 'gpt-6.1-sol', contextWindow: 1_050_000, reservedTokens: 130_048 })
  assert.equal(result.omittedMessages, 0)
  assert.ok(result.estimatedTokens < 20_000)
})

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
  const result = fitDirectRequest(request, 100_000, 500, current)
  assert.ok(result.messages.some(item => item.content === current.content))
  assert.ok(result.messages.some(item => item.tool_call_id === 'image'))
  assert.ok(result.messages.some(item => Array.isArray(item.content)))
})
