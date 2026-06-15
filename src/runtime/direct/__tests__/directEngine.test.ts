import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runDirectChatCompletion } from '../directEngine'

function sseResponse(rows: string[]): Response {
  return new Response(rows.map(row => `data: ${row}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

test('runDirectChatCompletion performs a second pass when the model requests web_search', async () => {
  const seen: string[] = []
  const sentMessages: any[][] = []

  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '查一下韭菜盒子' }],
    tools: [{ type: 'function', function: { name: 'web_search' } }],
    onText: value => seen.push(value),
    runWebSearch: async query => `[search:${query}]`,
    sendChatCompletion: async request => {
      sentMessages.push(request.messages)
      if (sentMessages.length === 1) {
        return sseResponse([
          JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'web_search', arguments: '{"query":"韭菜盒子"}' } }] } }] }),
          '[DONE]',
        ])
      }
      return sseResponse([
        JSON.stringify({ choices: [{ delta: { content: '搜索后回答' } }] }),
        '[DONE]',
      ])
    },
  })

  assert.equal(result.text, '搜索后回答')
  assert.deepEqual(seen, ['搜索后回答'])
  assert.equal(sentMessages.length, 2)
  assert.deepEqual(sentMessages[0], [{ role: 'user', content: '查一下韭菜盒子' }])
  assert.equal(sentMessages[1][1].role, 'assistant')
  assert.equal(sentMessages[1][2].role, 'tool')
  assert.equal(sentMessages[1][2].content, '[search:韭菜盒子]')
})

test('runDirectChatCompletion keeps the first-pass text when there are no tool calls', async () => {
  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '你好' }],
    onText: () => {},
    runWebSearch: async query => `[search:${query}]`,
    sendChatCompletion: async () => sseResponse([
      JSON.stringify({ choices: [{ delta: { content: '你好呀' } }] }),
      '[DONE]',
    ]),
  })

  assert.equal(result.text, '你好呀')
  assert.deepEqual(result.toolCalls, [])
})
