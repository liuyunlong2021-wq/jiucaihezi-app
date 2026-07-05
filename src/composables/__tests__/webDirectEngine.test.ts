import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  appendSystemEvidence,
  buildToolResultMessages,
  readChatCompletionResponse,
  type DirectToolCall,
} from '../web/webDirectEngine'

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
  })
}

function sseResponse(rows: string[]): Response {
  return new Response(rows.map(row => `data: ${row}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

test('readChatCompletionResponse reads ordinary JSON fallback responses', async () => {
  const seen: string[] = []

  const text = await readChatCompletionResponse(
    jsonResponse({ choices: [{ message: { content: '普通 JSON 回复' } }] }),
    value => seen.push(value),
  )

  assert.equal(text, '普通 JSON 回复')
  assert.deepEqual(seen, ['普通 JSON 回复'])
})

test('readChatCompletionResponse streams text and accumulates tool calls', async () => {
  const toolCalls: Record<number, DirectToolCall> = {}
  const seen: string[] = []

  const text = await readChatCompletionResponse(
    sseResponse([
      JSON.stringify({ choices: [{ delta: { content: '你' } }] }),
      JSON.stringify({ choices: [{ delta: { content: '好' } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'web_search', arguments: '{"query":"' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '韭菜盒子"}' } }] } }] }),
      '[DONE]',
    ]),
    value => seen.push(value),
    toolCalls,
  )

  assert.equal(text, '你好')
  assert.deepEqual(seen, ['你', '你好'])
  assert.equal(toolCalls[0].id, 'call_1')
  assert.equal(toolCalls[0].function.name, 'web_search')
  assert.equal(toolCalls[0].function.arguments, '{"query":"韭菜盒子"}')
})

test('readChatCompletionResponse streams reasoning deltas and stops on DONE', async () => {
  const seen: string[] = []

  const text = await readChatCompletionResponse(
    sseResponse([
      JSON.stringify({ choices: [{ delta: { reasoning_content: '推理' } }] }),
      '[DONE]',
      JSON.stringify({ choices: [{ delta: { content: '不应出现' } }] }),
    ]),
    value => seen.push(value),
  )

  assert.equal(text, '推理')
  assert.deepEqual(seen, ['推理'])
})

test('appendSystemEvidence merges search evidence into the first system message', () => {
  const messages = [
    { role: 'system', content: '基础规则' },
    { role: 'user', content: '今天有什么新闻' },
  ]

  const merged = appendSystemEvidence(messages, '搜索结果')

  assert.equal(merged.length, 2)
  assert.equal(merged[0].role, 'system')
  assert.match(merged[0].content, /基础规则/)
  assert.match(merged[0].content, /搜索结果/)
  assert.equal(merged[1].role, 'user')
})

test('buildToolResultMessages always returns paired assistant tool_calls and tool messages', async () => {
  const messages = await buildToolResultMessages([
    {
      id: '',
      type: 'function',
      function: { name: 'web_search', arguments: 'not json' },
    },
  ], async query => `[search:${query}]`)

  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'assistant')
  assert.equal(messages[0].tool_calls.length, 1)
  assert.match(messages[0].tool_calls[0].id, /^call_web_search_/)
  assert.equal(messages[1].role, 'tool')
  assert.equal(messages[1].tool_call_id, messages[0].tool_calls[0].id)
  assert.match(messages[1].content, /Tool argument parse failed/)
})

test('buildToolResultMessages reports unsupported tools without running web search', async () => {
  let searchRuns = 0
  const messages = await buildToolResultMessages([
    {
      id: 'call_unknown',
      type: 'function',
      function: { name: 'browser_open', arguments: '{"url":"https://example.com"}' },
    },
  ], async query => {
    searchRuns += 1
    return `[search:${query}]`
  })

  assert.equal(searchRuns, 0)
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'assistant')
  assert.equal(messages[1].role, 'tool')
  assert.equal(messages[1].tool_call_id, 'call_unknown')
  assert.match(messages[1].content, /Unsupported tool: browser_open/)
})

test('buildToolResultMessages reports missing web_search query as a tool result', async () => {
  let searchRuns = 0
  const messages = await buildToolResultMessages([
    {
      id: 'call_empty_query',
      type: 'function',
      function: { name: 'web_search', arguments: '{"query":"   "}' },
    },
  ], async query => {
    searchRuns += 1
    return `[search:${query}]`
  })

  assert.equal(searchRuns, 0)
  assert.equal(messages.length, 2)
  assert.equal(messages[1].role, 'tool')
  assert.equal(messages[1].tool_call_id, 'call_empty_query')
  assert.match(messages[1].content, /query is required/)
})
