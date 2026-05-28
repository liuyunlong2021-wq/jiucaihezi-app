import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildReasoningChatExtras,
  normalizeRuntimeCapabilityTier,
  resolveRecallRuntimeBudget,
  resolveRuntimeProfile,
} from '../runtimeCapabilities'
import type { ProviderCapabilityProbe } from '../providerCapabilityProbe'

test('resolveRuntimeProfile treats GPT-5.5 as deep-capable chat runtime through Gateway', () => {
  const profile = resolveRuntimeProfile({
    modelId: 'gpt-5.5',
    providerId: 'jiucaihezi',
    requestedTier: 'deep',
  })

  assert.equal(profile.contextMode, 'deep')
  assert.equal(profile.reasoningEffort, 'high')
  assert.equal(profile.supportsReasoningEffort, true)
  assert.equal(profile.runtime, 'chat-completions')
})

test('resolveRuntimeProfile downgrades local models to fast chat runtime without reasoning effort', () => {
  const profile = resolveRuntimeProfile({
    modelId: 'qwen3:8b',
    providerId: 'local-ollama',
    requestedTier: 'deep',
  })

  assert.equal(profile.contextMode, 'fast')
  assert.equal(profile.reasoningEffort, undefined)
  assert.equal(profile.supportsReasoningEffort, false)
})

test('resolveRuntimeProfile uses cached provider capability before choosing Responses runtime', () => {
  const capability: ProviderCapabilityProbe = {
    providerId: 'jiucaihezi',
    apiHost: 'https://api.jiucaihezi.studio',
    checkedAt: 1,
    supportsModelsEndpoint: true,
    supportsChatCompletionsStream: true,
    supportsResponses: true,
    modelCount: 1,
    models: {},
  }

  assert.equal(resolveRuntimeProfile({
    modelId: 'gpt-5.5',
    providerId: 'jiucaihezi',
    providerCapability: capability,
    preferResponses: true,
  }).runtime, 'responses')

  assert.equal(resolveRuntimeProfile({
    modelId: 'gpt-5.5',
    providerId: 'jiucaihezi',
    providerCapability: { ...capability, supportsResponses: false },
    preferResponses: true,
  }).runtime, 'chat-completions')
})

test('buildReasoningChatExtras emits reasoning parameters only when explicitly enabled and supported', () => {
  assert.deepEqual(buildReasoningChatExtras(resolveRuntimeProfile({
    modelId: 'gpt-5.5',
    providerId: 'jiucaihezi',
    requestedTier: 'balanced',
  })), {})

  assert.deepEqual(buildReasoningChatExtras(resolveRuntimeProfile({
    modelId: 'gpt-5.5',
    providerId: 'jiucaihezi',
    requestedTier: 'balanced',
  }), { enabled: true }), {
    reasoning_effort: 'medium',
    reasoning: { effort: 'medium' },
  })

  assert.deepEqual(buildReasoningChatExtras(resolveRuntimeProfile({
    modelId: 'claude-sonnet-4-6',
    providerId: 'jiucaihezi',
    requestedTier: 'balanced',
  })), {})
})

test('resolveRuntimeProfile does not enable reasoning extras for GPT-5.4 compatibility models', () => {
  const profile = resolveRuntimeProfile({
    modelId: 'gpt-5.4',
    providerId: 'jiucaihezi',
    requestedTier: 'deep',
  })

  assert.equal(profile.supportsReasoningEffort, false)
  assert.deepEqual(buildReasoningChatExtras(profile), {})
})

test('resolveRecallRuntimeBudget scales knowledge recall budget by capability tier', () => {
  assert.deepEqual(resolveRecallRuntimeBudget('fast'), {
    maxTotalChars: 3000,
    maxItems: 4,
    perItemChars: 360,
  })
  assert.deepEqual(resolveRecallRuntimeBudget('deep'), {
    maxTotalChars: 12000,
    maxItems: 12,
    perItemChars: 700,
  })
  assert.deepEqual(resolveRecallRuntimeBudget('full-vault'), {
    maxTotalChars: 20000,
    maxItems: 20,
    perItemChars: 900,
  })
})

test('normalizeRuntimeCapabilityTier falls back to balanced for invalid stored values', () => {
  assert.equal(normalizeRuntimeCapabilityTier('deep'), 'deep')
  assert.equal(normalizeRuntimeCapabilityTier('bad-value'), 'balanced')
  assert.equal(normalizeRuntimeCapabilityTier(null), 'balanced')
})
