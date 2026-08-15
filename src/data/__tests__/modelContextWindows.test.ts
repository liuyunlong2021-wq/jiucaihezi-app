import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getModelContextWindow, getModelMaxOutputTokens } from '../modelContextWindows'

test('cloud models use the unified defaults while local and free models keep their own limits', () => {
  for (const model of ['claude-3.5-sonnet', 'gpt-4o', 'o3', 'gemini-2.5-pro', 'deepseek-r1', 'grok-3', 'glm-4.5', 'doubao-pro']) {
    assert.equal(getModelContextWindow(model, 'jiucaihezi'), 1_000_000, model)
  }
  assert.equal(getModelContextWindow('gpt-5', 'local-ollama'), 32_768)
  assert.equal(getModelContextWindow('openai/gpt-oss-120b:free', 'openrouter'), 32_000)
  assert.equal(getModelMaxOutputTokens('claude-sonnet-4-6', 'jiucaihezi'), 128_000)
  assert.equal(getModelMaxOutputTokens('gpt-5', 'local-ollama'), 4_096)
  assert.equal(getModelMaxOutputTokens('openai/gpt-oss-120b:free', 'openrouter'), 32_000)
})
