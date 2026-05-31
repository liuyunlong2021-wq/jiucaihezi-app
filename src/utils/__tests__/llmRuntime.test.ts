import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildResponsesRequestBody,
  chooseLlmRuntime,
  normalizeResponsesFinishReason,
  normalizeResponsesText,
} from '../llmRuntime'

test('chooseLlmRuntime keeps chat completions as default for Gateway models', () => {
  assert.equal(chooseLlmRuntime({
    providerId: 'jiucaihezi',
    modelId: 'gpt-5.5',
    responsesCapable: true,
    preferResponses: false,
  }), 'chat-completions')
})

test('chooseLlmRuntime uses responses only when explicitly preferred and capable', () => {
  assert.equal(chooseLlmRuntime({
    providerId: 'jiucaihezi',
    modelId: 'gpt-5.5',
    responsesCapable: true,
    preferResponses: true,
  }), 'responses')

  assert.equal(chooseLlmRuntime({
    providerId: 'jiucaihezi',
    modelId: 'gpt-5.5',
    responsesCapable: false,
    preferResponses: true,
  }), 'chat-completions')
})

test('chooseLlmRuntime can derive responses capability from provider probe cache', () => {
  assert.equal(chooseLlmRuntime({
    providerId: 'jiucaihezi',
    modelId: 'gpt-5.5',
    preferResponses: true,
    providerCapability: {
      providerId: 'jiucaihezi',
      apiHost: 'https://api.jiucaihezi.studio',
      checkedAt: 1,
      supportsModelsEndpoint: true,
      supportsChatCompletionsStream: true,
      supportsResponses: true,
      modelCount: 1,
      models: {},
    },
  }), 'responses')

  assert.equal(chooseLlmRuntime({
    providerId: 'jiucaihezi',
    modelId: 'gpt-5.5',
    preferResponses: true,
    providerCapability: {
      providerId: 'jiucaihezi',
      apiHost: 'https://api.jiucaihezi.studio',
      checkedAt: 1,
      supportsModelsEndpoint: true,
      supportsChatCompletionsStream: true,
      supportsResponses: false,
      modelCount: 1,
      models: {},
    },
  }), 'chat-completions')
})

test('normalizeResponsesText extracts output_text and message content variants', () => {
  assert.equal(normalizeResponsesText({ output_text: '直接文本' }), '直接文本')
  assert.equal(normalizeResponsesText({
    output: [
      { type: 'message', content: [{ type: 'output_text', text: '分段文本' }] },
    ],
  }), '分段文本')
})

test('normalizeResponsesFinishReason maps max output token incompletes to length', () => {
  assert.equal(normalizeResponsesFinishReason({
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
  }), 'length')
  assert.equal(normalizeResponsesFinishReason({
    status: 'completed',
  }), undefined)
})

test('buildResponsesRequestBody preserves system prompt and user conversation input', () => {
  const body = buildResponsesRequestBody({
    model: 'gpt-5.5',
    systemPrompt: '[当前Skill开始]\n完整 Skill\n[当前Skill结束]',
    messages: [
      { role: 'system', content: 'legacy system should be ignored' },
      { role: 'user', content: '请根据知识库回答' },
      { role: 'assistant', content: '上一轮回答' },
    ],
    maxOutputTokens: 4096,
    reasoningEffort: 'high',
  })

  assert.equal(body.model, 'gpt-5.5')
  assert.equal(body.instructions, '[当前Skill开始]\n完整 Skill\n[当前Skill结束]')
  assert.deepEqual(body.input, [
    { role: 'user', content: '请根据知识库回答' },
    { role: 'assistant', content: '上一轮回答' },
  ])
  assert.equal(body.max_output_tokens, 4096)
  assert.deepEqual(body.reasoning, { effort: 'high' })
})
