import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readChatCompletionDetails, readChatCompletionResponse } from '../directStream'
import type { DirectToolCall } from '../directTypes'

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })
}

function sseResponse(rows: string[]): Response {
  return new Response(rows.map(row => `data: ${row}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
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

test('readChatCompletionResponse never exposes JSON reasoning as visible text', async () => {
  const seen: string[] = []
  const text = await readChatCompletionResponse(
    jsonResponse({ choices: [{ message: { reasoning_content: 'hidden reasoning' } }] }),
    value => seen.push(value),
  )

  assert.equal(text, '')
  assert.deepEqual(seen, [])
})

test('readChatCompletionResponse accumulates tool calls from JSON fallback responses', async () => {
  const toolCalls: Record<number, DirectToolCall> = {}
  const text = await readChatCompletionResponse(
    jsonResponse({ choices: [{ message: { content: null, tool_calls: [{ id: 'call_json', type: 'function', function: { name: 'read', arguments: '{"path":"wiki/hot.md"}' } }] } }] }),
    () => {},
    toolCalls,
  )

  assert.equal(text, '')
  assert.equal(toolCalls[0].id, 'call_json')
  assert.equal(toolCalls[0].function.name, 'read')
  assert.equal(toolCalls[0].function.arguments, '{"path":"wiki/hot.md"}')
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

test('readChatCompletionResponse ignores reasoning deltas and stops on DONE', async () => {
  const seen: string[] = []
  const text = await readChatCompletionResponse(
    sseResponse([
      JSON.stringify({ choices: [{ delta: { reasoning_content: 'hidden reasoning' } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'visible answer' } }] }),
      '[DONE]',
      JSON.stringify({ choices: [{ delta: { content: '不应出现' } }] }),
    ]),
    value => seen.push(value),
  )

  assert.equal(text, 'visible answer')
  assert.deepEqual(seen, ['visible answer'])
})

test('readChatCompletionResponse consumes a final SSE row without a trailing newline', async () => {
  const seen: string[] = []
  const response = new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: '末尾内容' } }] })}`,
    { headers: { 'content-type': 'text/event-stream' } },
  )

  const text = await readChatCompletionResponse(response, value => seen.push(value))

  assert.equal(text, '末尾内容')
  assert.deepEqual(seen, ['末尾内容'])
})

test('readChatCompletionDetails keeps the provider finish reason', async () => {
  const result = await readChatCompletionDetails(
    sseResponse([
      JSON.stringify({ choices: [{ delta: { content: '输出达到模型限制' }, finish_reason: 'length' }] }),
      '[DONE]',
    ]),
    () => {},
  )

  assert.equal(result.text, '输出达到模型限制')
  assert.equal(result.finishReason, 'length')
})
