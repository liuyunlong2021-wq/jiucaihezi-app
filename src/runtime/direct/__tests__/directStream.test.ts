import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readChatCompletionResponse } from '../directStream'
import type { DirectToolCall } from '../directTypes'

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
