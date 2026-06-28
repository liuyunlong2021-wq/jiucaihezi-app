import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  abortOpenCodeSession,
  fireOpenCodePrompt,
  getOpenCodeStatusType,
  getOpenCodeSessionStatusWithTimeout,
  listOpenCodeChatMessages,
  prefetchOpenCodeSession,
  sendOpenCodePrompt,
  updateOpenCodeSessionPermission,
} from '../session'

test('sends prompts through the official legacy prompt endpoint with typed text parts', async () => {
  const calls: unknown[] = []
  const client = {
    session: {
      prompt: async (input: unknown) => {
        calls.push(input)
        return {
          data: {
            info: { id: 'a1', type: 'assistant', time: { created: 1001 } },
            parts: [{ type: 'text', text: '收到' }],
          },
        }
      },
    },
  } as any

  const messages = await sendOpenCodePrompt(client, {
    sessionID: 'ses_123',
    text: '你好',
    system: '系统提示',
    model: { providerID: 'jiucaihezi', modelID: 'claude-sonnet-4-6' },
  })

  assert.deepEqual(calls, [{
    sessionID: 'ses_123',
    model: { providerID: 'jiucaihezi', modelID: 'claude-sonnet-4-6' },
    agent: undefined,
    tools: undefined,
    system: '系统提示',
    parts: [{ type: 'text', text: '你好' }],
  }])
  assert.equal(messages.length, 1)
  assert.equal(messages[0].role, 'assistant')
  assert.equal(messages[0].content, '')
  assert.equal(messages[0].openCodeParts?.[0]?.type, 'text')
  assert.equal(messages[0].openCodeParts?.[0]?.text, '收到')
})

test('fire prompt forwards official structured request parts without flattening attachments', async () => {
  const calls: unknown[] = []
  const client = {
    session: {
      prompt: async (input: unknown) => {
        calls.push(input)
        return { data: { ok: true } }
      },
    },
  } as any

  await fireOpenCodePrompt(client, {
    sessionID: 'ses_123',
    text: '请读取附件',
    agent: 'build',
    parts: [
      { type: 'agent', name: 'build' },
      { type: 'file', mime: 'image/png', filename: 'image-1.png', url: 'data:image/png;base64,abc' },
      {
        type: 'file',
        mime: 'text/markdown',
        filename: 'note.md',
        url: 'data:text/markdown;charset=utf-8,%23%20Note',
        source: {
          type: 'resource',
          clientName: 'jiucaihezi',
          uri: 'jiucaihezi://attachments/note.md',
          text: { value: '# Note', start: 0, end: 6 },
        },
      },
      { type: 'text', text: '请读取附件' },
    ],
  } as any)

  assert.deepEqual(calls, [{
    sessionID: 'ses_123',
    model: undefined,
    agent: 'build',
    tools: undefined,
    system: undefined,
    parts: [
      { type: 'agent', name: 'build' },
      { type: 'file', mime: 'image/png', filename: 'image-1.png', url: 'data:image/png;base64,abc' },
      {
        type: 'file',
        mime: 'text/markdown',
        filename: 'note.md',
        url: 'data:text/markdown;charset=utf-8,%23%20Note',
        source: {
          type: 'resource',
          clientName: 'jiucaihezi',
          uri: 'jiucaihezi://attachments/note.md',
          text: { value: '# Note', start: 0, end: 6 },
        },
      },
      { type: 'text', text: '请读取附件' },
    ],
  }])
})

test('prompt payload can disable OpenCode web tools without using legacy search injection', async () => {
  const calls: unknown[] = []
  const client = {
    session: {
      prompt: async (input: unknown) => {
        calls.push(input)
        return { data: { ok: true } }
      },
    },
  } as any

  await sendOpenCodePrompt(client, {
    sessionID: 'ses_123',
    text: '不要联网',
    tools: { websearch: false, webfetch: false },
  })

  assert.deepEqual((calls[0] as any).tools, { websearch: false, webfetch: false })
  assert.deepEqual((calls[0] as any).parts, [{ type: 'text', text: '不要联网' }])
})

test('aborts through the official v2 session abort endpoint', async () => {
  const calls: unknown[] = []
  const client = {
    session: {
      abort: async (input: unknown) => {
        calls.push(input)
        return { data: { ok: true } }
      },
    },
  } as any

  await abortOpenCodeSession(client, 'ses_123')

  assert.deepEqual(calls, [{ sessionID: 'ses_123' }])
})

test('status timeout fallback preserves session keyed shape for completion checks', async () => {
  const client = {
    session: {
      status: async () => {
        throw new Error('offline')
      },
    },
  } as any

  const statusMap = await getOpenCodeSessionStatusWithTimeout(
    client,
    { sessionID: 'ses_timeout' } as any,
    1,
    'idle',
  )

  assert.equal(statusMap.ses_timeout.type, 'idle')
  assert.equal(statusMap.__fallback, true)
})

test('status type resolver accepts keyed and top-level official status shapes', () => {
  assert.equal(getOpenCodeStatusType({ ses_1: { type: 'idle' } }, 'ses_1'), 'idle')
  assert.equal(getOpenCodeStatusType({ type: 'idle' }, 'ses_1'), 'idle')
  assert.equal(getOpenCodeStatusType({ status: { type: 'idle' } }, 'ses_1'), 'idle')
  assert.equal(getOpenCodeStatusType({ status: 'idle' }, 'ses_1'), 'idle')
  assert.equal(getOpenCodeStatusType({ sessions: [{ id: 'ses_1', type: 'idle' }] }, 'ses_1'), 'idle')
  assert.equal(getOpenCodeStatusType({ data: { sessions: [{ sessionID: 'ses_1', status: 'busy' }] } }, 'ses_1'), 'busy')
})

test('lists projected legacy messages from the same endpoint family as prompt', async () => {
  const calls: unknown[] = []
  const client = {
    session: {
      messages: async (input: unknown) => {
        calls.push(input)
        return {
          data: [
            {
              info: { id: 'u1', role: 'user', time: { created: 1000 } },
              parts: [{ type: 'text', text: '你好' }],
            },
            {
              info: { id: 'a1', role: 'assistant', agent: 'build', time: { created: 1001 } },
              parts: [{ type: 'text', id: 't1', text: '收到' }],
            },
          ],
        }
      },
    },
  } as any

  const messages = await listOpenCodeChatMessages(client, 'ses_123')

  assert.deepEqual(calls, [{ sessionID: 'ses_123' }])
  assert.equal(messages.length, 2)
  assert.equal(messages[1].role, 'assistant')
  assert.equal(messages[1].content, '')
  assert.equal(messages[1].openCodeParts?.[0]?.type, 'text')
  assert.equal(messages[1].openCodeParts?.[0]?.text, '收到')
})

test('reuses cached projected messages when prefetch already loaded a session', async () => {
  let calls = 0
  const client = {
    session: {
      messages: async () => {
        calls++
        return {
          data: [
            {
              info: { id: 'a_cached', role: 'assistant', time: { created: 1001 } },
              parts: [{ type: 'text', id: 't1', text: '缓存命中' }],
            },
          ],
        }
      },
    },
  } as any

  await listOpenCodeChatMessages(client, 'ses_cached')
  const cached = await listOpenCodeChatMessages(client, 'ses_cached', { preferCache: true })

  assert.equal(calls, 1)
  assert.equal(cached[0].content, '')
  assert.equal(cached[0].openCodeParts?.[0]?.type, 'text')
  assert.equal(cached[0].openCodeParts?.[0]?.text, '缓存命中')
})

test('prefetch loads OpenCode messages for later preferCache session switching', async () => {
  let calls = 0
  const client = {
    session: {
      messages: async () => {
        calls++
        return {
          data: [
            {
              info: { id: 'a_prefetch', role: 'assistant', time: { created: 1001 } },
              parts: [{ type: 'text', id: 't1', text: '预取命中' }],
            },
          ],
        }
      },
    },
  } as any

  await prefetchOpenCodeSession(client, 'ses_prefetch')
  const cached = await listOpenCodeChatMessages(client, 'ses_prefetch', { preferCache: true })

  assert.equal(calls, 1)
  assert.equal(cached[0].openCodeParts?.[0]?.text, '预取命中')
})

test('updates session permission through the official session update endpoint', async () => {
  const calls: unknown[] = []
  const permission = [{ permission: 'skill', pattern: '*', action: 'deny' }]
  const client = {
    session: {
      update: async (input: unknown) => {
        calls.push(input)
        return { data: { ok: true } }
      },
    },
  } as any

  await updateOpenCodeSessionPermission(client, 'ses_123', permission as any)

  assert.deepEqual(calls, [{ sessionID: 'ses_123', permission }])
})
