import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CONVERSATION_MEMORY_SUMMARY_PROMPT,
  CONVERSATION_MEMORY_SUMMARY_RESPONSE_FORMAT,
  buildConversationMemorySummaryRequest,
  parseConversationMemorySummaryPayload,
} from '../conversationMemorySummary'

test('conversation memory summary request uses the fixed prompt and strict schema', () => {
  const request = buildConversationMemorySummaryRequest('model-1', '当前 assistant 的完整回答')
  assert.equal(request.model, 'model-1')
  assert.equal(request.messages[0]?.role, 'system')
  assert.equal(request.messages[0]?.content, CONVERSATION_MEMORY_SUMMARY_PROMPT)
  assert.deepEqual(request.messages[1], { role: 'user', content: '当前 assistant 的完整回答' })
  assert.equal(request.max_tokens, 800)
  assert.deepEqual(request.response_format, CONVERSATION_MEMORY_SUMMARY_RESPONSE_FORMAT)
  assert.equal(request.response_format.json_schema.strict, true)
  assert.deepEqual(request.response_format.json_schema.schema.required, ['summary', 'keywords'])
  assert.equal(request.response_format.json_schema.schema.additionalProperties, false)
  assert.equal(request.response_format.json_schema.schema.properties.summary.type, 'string')
  assert.equal(request.response_format.json_schema.schema.properties.keywords.items.type, 'string')
})

test('conversation memory summary uses a forced strict tool for Opus', () => {
  const request = buildConversationMemorySummaryRequest(
    'claude-opus-4-7',
    '当前 assistant 的完整回答',
  )
  assert.equal(request.tools?.[0]?.type, 'function')
  assert.equal(request.tools?.[0]?.function?.name, 'emit_conversation_memory_summary')
  assert.equal(request.tools?.[0]?.function?.strict, true)
  assert.deepEqual(
    request.tools?.[0]?.function?.parameters,
    CONVERSATION_MEMORY_SUMMARY_RESPONSE_FORMAT.json_schema.schema,
  )
  assert.deepEqual(request.tool_choice, {
    type: 'function',
    function: { name: 'emit_conversation_memory_summary' },
  })
  assert.equal('response_format' in request, false)
})

test('conversation memory summary uses Ollama native no-thinking JSON contract', () => {
  const request = buildConversationMemorySummaryRequest(
    'qwen3.6:35b-a3b',
    '当前 assistant 的完整回答',
    'local-ollama',
  )
  assert.equal(request.model, 'qwen3.6:35b-a3b')
  assert.equal(request.stream, false)
  assert.equal(request.think, false)
  assert.equal(request.options?.num_predict, 256)
  assert.equal(request.options?.temperature, 0.2)
  assert.deepEqual(request.format, CONVERSATION_MEMORY_SUMMARY_RESPONSE_FORMAT.json_schema.schema)
  assert.equal('response_format' in request, false)
})

test('conversation memory summary parser accepts only summary and keywords from visible content', () => {
  assert.deepEqual(
    parseConversationMemorySummaryPayload({
      choices: [{ message: { content: '{"summary":"确认方案","keywords":["方案"]}' } }],
    }),
    { summary: '确认方案', keywords: ['方案'] },
  )
  assert.deepEqual(
    parseConversationMemorySummaryPayload({
      message: { content: '{"summary":"原生接口成功","keywords":["Ollama"]}' },
      done_reason: 'stop',
    }),
    { summary: '原生接口成功', keywords: ['Ollama'] },
  )
  assert.deepEqual(
    parseConversationMemorySummaryPayload({
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: 'function',
                function: {
                  name: 'emit_conversation_memory_summary',
                  arguments: '{"summary":"工具调用成功","keywords":["Opus"]}',
                },
              },
            ],
          },
        },
      ],
    }),
    { summary: '工具调用成功', keywords: ['Opus'] },
  )
})

test('conversation memory summary parser rejects malformed or non-schema responses', () => {
  const invalid = [
    { choices: [{ message: { content: '说明文字' } }] },
    { choices: [{ message: { content: '{"summary":"","keywords":[]}' } }] },
    { choices: [{ message: { content: '{"summary":"简介","keywords":[1]}' } }] },
    {
      choices: [{ message: { content: '{"summary":"简介","keywords":["关键词"],"path":"bad"}' } }],
    },
    { choices: [{ message: { reasoning: '{"summary":"推理","keywords":["错误"]}' } }] },
  ]
  for (const payload of invalid) assert.throws(() => parseConversationMemorySummaryPayload(payload))
})

test('conversation memory summary parser enforces program-side limits and normalization', () => {
  assert.deepEqual(
    parseConversationMemorySummaryPayload({
      choices: [
        { message: { content: '{"summary":"  简介  ","keywords":["  关键词 ","关键词"]}' } },
      ],
    }),
    { summary: '简介', keywords: ['关键词'] },
  )
  assert.throws(() =>
    parseConversationMemorySummaryPayload({
      choices: [
        { message: { content: JSON.stringify({ summary: 'a'.repeat(241), keywords: ['x'] }) } },
      ],
    }),
  )
  assert.throws(() =>
    parseConversationMemorySummaryPayload({
      choices: [
        { message: { content: JSON.stringify({ summary: '简介', keywords: ['x'.repeat(33)] }) } },
      ],
    }),
  )
  assert.throws(() =>
    parseConversationMemorySummaryPayload({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: '简介',
              keywords: Array.from({ length: 13 }, (_, index) => String(index)),
            }),
          },
        },
      ],
    }),
  )
})
