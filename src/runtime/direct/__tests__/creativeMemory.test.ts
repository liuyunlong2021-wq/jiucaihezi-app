import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  appendCreativeMemoryEvent,
  buildCreativeContext,
  createCreativeMemoryRecorder,
  encodeCreativeMemoryEvent,
  toCreativeMemorySessionId,
} from '../creativeMemory'

test('encodes one append-only raw event for a creative turn', () => {
  const line = encodeCreativeMemoryEvent({
    sessionId: 'creative_turn_01',
    turnId: 'user_turn_01',
    type: 'tool_result',
    at: 1_700_000_000_000,
    data: {
      tool: 'terminal',
      status: 'succeeded',
      result: 'frame written',
      apiKey: 'must-not-leak',
      cachePath: '/private/media-cache/clip.mp4',
    },
  })

  assert.equal(toCreativeMemorySessionId('creative_turn_01'), 'jcses_turn_01')
  assert.ok(line.endsWith('\n'))
  assert.deepEqual(JSON.parse(line), {
    v: 1,
    sessionId: 'jcses_turn_01',
    turnId: 'user_turn_01',
    type: 'tool_result',
    at: 1_700_000_000_000,
    data: { tool: 'terminal', status: 'succeeded', result: 'frame written' },
  })
})

test('rejects invalid turn completion status', () => {
  assert.throws(() => encodeCreativeMemoryEvent({
    sessionId: 'creative_turn_01',
    turnId: 'user_turn_01',
    type: 'turn_finished',
    at: 1,
    data: { status: 'running' },
  }), /turn_finished status/)
})

test('appends ordered events to one project raw session without making the caller manage the path', async () => {
  const files = new Map<string, string>()
  const access = {
    read: async (path: string) => files.get(path) ?? null,
    write: async (path: string, content: string) => { files.set(path, content) },
  }
  const recorder = createCreativeMemoryRecorder(access, 'creative_turn_01', 'user_turn_01')

  await recorder.record('user', { text: '分析素材', attachments: [{ name: 'clip.mp4' }] })
  await recorder.record('assistant', { text: '我先检查视频。' })
  await recorder.finish('done')

  const raw = files.get('.raw/sessions/jcses_turn_01.jsonl')
  assert.ok(raw)
  const events = raw.trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(events.map(event => event.type), ['user', 'assistant', 'turn_finished'])
  assert.equal(events.every(event => event.sessionId === 'jcses_turn_01'), true)

  await appendCreativeMemoryEvent(access, {
    sessionId: 'creative_turn_01', turnId: 'user_turn_02', type: 'user', at: 2, data: { text: '继续' },
  })
  assert.equal(files.get('.raw/sessions/jcses_turn_01.jsonl')?.trim().split('\n').length, 4)
})

test('uses a native append operation when the project adapter provides one', async () => {
  const writes: Array<{ path: string; content: string }> = []
  const access = {
    read: async () => { throw new Error('native append must not read the whole ledger') },
    write: async () => { throw new Error('native append must not rewrite the whole ledger') },
    append: async (path: string, content: string) => { writes.push({ path, content }) },
  }

  await appendCreativeMemoryEvent(access, {
    sessionId: 'creative_turn_01', turnId: 'user_turn_01', type: 'assistant', at: 2, data: { text: '完成' },
  })

  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.path, '.raw/sessions/jcses_turn_01.jsonl')
  assert.equal(JSON.parse(writes[0]?.content || '{}').data.text, '完成')
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
