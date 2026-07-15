import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  appendSystemEvidence,
  buildToolResultMessages,
} from '../directTools'

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
  ], async () => { throw new Error('Tool argument parse failed') })

  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'assistant')
  assert.equal(messages[0].tool_calls.length, 1)
  assert.match(messages[0].tool_calls[0].id, /^call_web_search_/)
  assert.equal(messages[1].role, 'tool')
  assert.equal(messages[1].tool_call_id, messages[0].tool_calls[0].id)
  assert.match(messages[1].content, /Tool argument parse failed/)
})

test('buildToolResultMessages reports executor errors as tool results', async () => {
  let runs = 0
  const messages = await buildToolResultMessages([
    {
      id: 'call_unknown',
      type: 'function',
      function: { name: 'browser_open', arguments: '{"url":"https://example.com"}' },
    },
  ], async () => {
    runs += 1
    throw new Error('Unsupported tool: browser_open')
  })

  assert.equal(runs, 1)
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'assistant')
  assert.equal(messages[1].role, 'tool')
  assert.equal(messages[1].tool_call_id, 'call_unknown')
  assert.match(messages[1].content, /Unsupported tool: browser_open/)
})

test('buildToolResultMessages appends executor followup messages after tool outputs', async () => {
  const messages = await buildToolResultMessages([
    {
      id: 'call_empty_query',
      type: 'function',
      function: { name: 'web_search', arguments: '{"query":"   "}' },
    },
  ], async () => ({
    content: 'Image read successfully',
    followupMessages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] }],
  }))

  assert.equal(messages.length, 3)
  assert.equal(messages[1].role, 'tool')
  assert.equal(messages[1].tool_call_id, 'call_empty_query')
  assert.equal(messages[1].content, 'Image read successfully')
  assert.equal(messages[2].role, 'user')
})
