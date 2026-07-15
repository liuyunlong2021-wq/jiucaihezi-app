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

test('runDirectChatCompletion reports the normalized tool id used by the tool result', async () => {
  const reportedCalls: string[] = []
  const executedCalls: string[] = []
  const responses = [
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'skill', arguments: '{"name":"writer"}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([
      JSON.stringify({ choices: [{ delta: { content: 'Skill 已加载' } }] }),
      '[DONE]',
    ]),
  ]

  await runDirectChatCompletion({
    messages: [{ role: 'user', content: '加载写作 Skill' }],
    tools: [{ type: 'function', function: { name: 'skill' } }],
    onText: () => {},
    onToolCalls: calls => reportedCalls.push(...calls.map(call => call.id)),
    executeTool: async call => {
      executedCalls.push(call.id)
      return { content: 'loaded' }
    },
    sendChatCompletion: async () => responses.shift()!,
  })

  assert.deepEqual(reportedCalls, ['call_skill_1'])
  assert.deepEqual(executedCalls, ['call_skill_1'])
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

test('runDirectChatCompletion continues through multiple tool rounds', async () => {
  const requests: any[] = []
  const executed: string[] = []
  const responses = [
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_skill', function: { name: 'skill', arguments: '{"name":"writer"}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_read', function: { name: 'read', arguments: '{"path":"wiki/hot.md"}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_write', function: { name: 'write', arguments: '{"path":"wiki/剧本/第1集.md","content":"正文"}' } }] } }] }),
      '[DONE]',
    ]),
    sseResponse([JSON.stringify({ choices: [{ delta: { content: '第一集已保存' } }] }), '[DONE]']),
  ]

  const result = await runDirectChatCompletion({
    messages: [{ role: 'user', content: '写第一集' }],
    tools: [{ type: 'function', function: { name: 'skill' } }],
    onText: () => {},
    executeTool: async call => {
      executed.push(call.function.name)
      return { content: `ok:${call.function.name}` }
    },
    sendChatCompletion: async request => {
      requests.push(request)
      return responses.shift()!
    },
  })

  assert.equal(result.text, '第一集已保存')
  assert.deepEqual(executed, ['skill', 'read', 'write'])
  assert.equal(requests.length, 4)
  assert.ok(requests.every(request => request.tools?.length === 1))
  assert.equal(result.usedSecondPass, true)
})

test('runDirectChatCompletion stops a runaway tool loop', async () => {
  await assert.rejects(() => runDirectChatCompletion({
    messages: [{ role: 'user', content: '循环' }],
    tools: [{ type: 'function', function: { name: 'read' } }],
    maxToolRounds: 2,
    onText: () => {},
    executeTool: async () => ({ content: 'ok' }),
    sendChatCompletion: async () => sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_read', function: { name: 'read', arguments: '{"path":"a"}' } }] } }] }),
      '[DONE]',
    ]),
  }), /工具调用超过 2 轮/)
})

test('runDirectChatCompletion stops remaining tools when the run is aborted', async () => {
  const controller = new AbortController()
  const executed: string[] = []

  await assert.rejects(() => runDirectChatCompletion({
    messages: [{ role: 'user', content: '先读 Skill 再写文件' }],
    tools: [{ type: 'function', function: { name: 'skill' } }],
    onText: () => {},
    signal: controller.signal,
    executeTool: async call => {
      executed.push(call.function.name)
      if (call.function.name === 'skill') controller.abort()
      return { content: 'ok' }
    },
    sendChatCompletion: async () => sseResponse([
      JSON.stringify({ choices: [{ delta: { tool_calls: [
        { index: 0, id: 'call_skill', function: { name: 'skill', arguments: '{}' } },
        { index: 1, id: 'call_write', function: { name: 'write', arguments: '{"path":"wiki/hot.md","content":"x"}' } },
      ] } }] }),
      '[DONE]',
    ]),
  }), error => error instanceof DOMException && error.name === 'AbortError')

  assert.deepEqual(executed, ['skill'])
})
