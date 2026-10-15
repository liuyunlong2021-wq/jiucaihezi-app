import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getModelContextWindow, getModelMaxOutputTokens, resolveModelCapacity } from '../modelContextWindows'

test('known OpenAI models resolve official capacity and only supported aliases and snapshots match', () => {
  for (const id of ['GPT-5.4', 'gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-sol', 'gpt-6-astra', 'gpt-6.1-sol', 'openai/gpt-6.1-sol', 'gpt-5.4-2026-03-05']) {
    assert.equal(getModelContextWindow(id, 'relay'), 1_050_000, id)
    assert.equal(getModelMaxOutputTokens(id, 'relay'), 128_000, id)
    assert.equal(resolveModelCapacity(id, 'relay').contextWindowSource, 'preset')
  }
  for (const id of ['gpt-6.1-sol-mini', 'random/gpt-6.1-sol', 'gpt-5.4-mini', 'not-gpt-6-astra']) {
    assert.equal(resolveModelCapacity(id, 'relay').contextWindowSource, 'estimated', id)
  }
})

test('common relay IDs use explicit product presets, not an entire family wildcard', () => {
  for (const id of ['Opus', 'Sonnet', 'Opus-4.7', 'claude-fable-5-1', 'claude-opus-4-8', 'claude-opus-5-5', 'gemini-3.8-flash', 'G-3.1-Pro', 'gemini-4-argon-high', 'kimi-k3', 'glm-5.2', 'ZHIPU/GLM-5.2', 'deepseek/deepseek-v4.1-flash', 'deepseek-v4-flash-0731', 'grok-4.7-build-fast', 'doubao-seed-2-1-pro-260628', 'qwen3.8-flash-next-iq3_xxs']) {
    const capacity = resolveModelCapacity(id, 'relay')
    assert.equal(capacity.contextWindow, 1_000_000, id)
    assert.equal(capacity.contextWindowSource, 'preset', id)
    assert.equal(capacity.contextWindowEstimated, false, id)
  }
  assert.equal(getModelContextWindow('claude-haiku-4-5-20251001', 'relay'), 200_000)
  for (const id of ['claude-haiku-5-5', 'claude-haiku-5.5', 'anthropic/claude-haiku-5.5:batch', 'anthropic/claude-haiku-5-5:batch']) {
    assert.equal(getModelContextWindow(id, 'relay'), 1_000_000, id)
    assert.equal(getModelMaxOutputTokens(id, 'relay'), 128_000, id)
  }
  for (const provider of ['local-ollama', 'local-mlx']) {
    assert.equal(getModelContextWindow('gpt-6.1-sol', provider), 32_768)
    assert.equal(resolveModelCapacity('gemini-3.8-flash', provider).contextWindowEstimated, true)
  }
})

test('declared metadata wins; stale estimates and preset caches are recomputed; invalid numbers are ignored', () => {
  assert.equal(resolveModelCapacity('gpt-6.1-sol', 'relay', { contextWindow: 256_000, maxOutputTokens: 8_000 }).contextWindow, 256_000)
  const stale = resolveModelCapacity('gpt-6.1-sol', 'relay', { contextWindow: 32_768, maxOutputTokens: 4_096, contextWindowEstimated: true })
  assert.equal(stale.contextWindow, 1_050_000)
  assert.equal(stale.maxOutputTokens, 128_000)
  assert.equal(stale.contextWindowEstimated, false)
  assert.equal(resolveModelCapacity('gpt-6.1-sol', 'relay', { contextWindow: 1_000_000, contextWindowSource: 'preset' }).contextWindow, 1_050_000)
  assert.equal(resolveModelCapacity('gpt-6.1-sol', 'relay', { contextWindow: Infinity, maxOutputTokens: NaN }).contextWindow, 1_050_000)
  assert.equal(resolveModelCapacity('unknown', 'relay', { contextWindow: 128_000 }).contextWindowSource, 'declared')
  const partial = resolveModelCapacity('gpt-6.1-sol', 'relay', { maxOutputTokens: 8_000 })
  assert.equal(resolveModelCapacity('gpt-6.1-sol', 'relay', partial).maxOutputTokens, 8_000)
  const small = resolveModelCapacity('unknown', 'relay', { contextWindow: 2, maxOutputTokens: 999 })
  assert.equal(small.maxOutputTokens, 1)
})

test('cloud models use the unified defaults while local and free models keep their own limits', () => {
  for (const model of ['claude-3.5-sonnet', 'gpt-4o', 'o3', 'gemini-2.5-pro', 'deepseek-r1', 'grok-3', 'glm-4.5', 'doubao-pro']) {
    assert.equal(getModelContextWindow(model, 'jiucaihezi'), 32_768, model)
  }
  assert.equal(getModelContextWindow('gpt-5', 'local-ollama'), 32_768)
  assert.equal(getModelContextWindow('openai/gpt-oss-120b:free', 'openrouter'), 32_000)
  assert.equal(getModelMaxOutputTokens('claude-sonnet-4-6', 'jiucaihezi'), 4_096)
  assert.equal(getModelMaxOutputTokens('gpt-5', 'local-ollama'), 4_096)
  assert.equal(getModelMaxOutputTokens('openai/gpt-oss-120b:free', 'openrouter'), 32_000)
})
