import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildProviderCapabilityProbe,
  getCachedProviderCapabilityProbe,
  mergeProviderCapabilityProbe,
  probeProviderCapabilities,
  providerCapabilityCacheKey,
  runAndCacheProviderCapabilityProbe,
  saveProviderCapabilityProbe,
} from '../providerCapabilityProbe'

test('buildProviderCapabilityProbe summarizes models stream reasoning and responses support', () => {
  const probe = buildProviderCapabilityProbe({
    providerId: 'jiucaihezi',
    apiHost: 'https://api.jiucaihezi.studio/v1',
    modelIds: ['gpt-5.5', 'claude-sonnet-4-6'],
    modelsOk: true,
    streamOk: true,
    responsesOk: false,
  })

  assert.equal(probe.providerId, 'jiucaihezi')
  assert.equal(probe.apiHost, 'https://api.jiucaihezi.studio')
  assert.equal(probe.supportsModelsEndpoint, true)
  assert.equal(probe.supportsChatCompletionsStream, true)
  assert.equal(probe.supportsResponses, false)
  assert.equal(probe.modelCount, 2)
  assert.equal(probe.models['gpt-5.5'].supportsReasoningEffort, true)
  assert.equal(probe.models['claude-sonnet-4-6'].supportsReasoningEffort, false)
})

test('provider capability cache keeps host scoped records and expires old probes', () => {
  const store = new Map<string, string>()
  const fresh = buildProviderCapabilityProbe({
    providerId: 'jiucaihezi',
    apiHost: 'https://api.jiucaihezi.studio',
    modelIds: ['gpt-5.5'],
    modelsOk: true,
    streamOk: true,
    responsesOk: true,
    checkedAt: 1_000,
  })
  saveProviderCapabilityProbe(fresh, store)

  assert.equal(providerCapabilityCacheKey('jiucaihezi', 'https://api.jiucaihezi.studio/v1'), 'jcProviderCapability:jiucaihezi:https://api.jiucaihezi.studio')
  assert.equal(getCachedProviderCapabilityProbe('jiucaihezi', 'https://api.jiucaihezi.studio', store, 1_500)?.supportsResponses, true)
  assert.equal(getCachedProviderCapabilityProbe('jiucaihezi', 'https://api.jiucaihezi.studio', store, 90_000_000), null)
})

test('mergeProviderCapabilityProbe preserves last known good fields when a later probe is partial', () => {
  const previous = buildProviderCapabilityProbe({
    providerId: 'jiucaihezi',
    apiHost: 'https://api.jiucaihezi.studio',
    modelIds: ['gpt-5.5'],
    modelsOk: true,
    streamOk: true,
    responsesOk: true,
    checkedAt: 1,
  })
  const next = buildProviderCapabilityProbe({
    providerId: 'jiucaihezi',
    apiHost: 'https://api.jiucaihezi.studio',
    modelIds: [],
    modelsOk: false,
    streamOk: false,
    responsesOk: false,
    error: 'timeout',
    checkedAt: 2,
  })

  const merged = mergeProviderCapabilityProbe(previous, next)

  assert.equal(merged.lastError, 'timeout')
  assert.equal(merged.supportsModelsEndpoint, true)
  assert.equal(merged.supportsChatCompletionsStream, true)
  assert.equal(merged.supportsResponses, true)
  assert.equal(merged.models['gpt-5.5'].supportsReasoningEffort, true)
})

test('probeProviderCapabilities checks models stream and responses endpoints without leaking auth', async () => {
  const calls: Array<{ url: string; auth?: string; body?: any }> = []
  const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({
      url,
      auth: (init?.headers as Record<string, string>)?.Authorization,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    if (url.endsWith('/v1/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'gpt-5.5' }, { id: 'claude-sonnet-4-6' }] }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }

  const probe = await probeProviderCapabilities({
    providerId: 'jiucaihezi',
    apiHost: 'https://api.jiucaihezi.studio/v1',
    apiKey: 'secret-token',
    testModel: 'gpt-5.5',
    fetcher,
    checkedAt: 123,
  })

  assert.equal(probe.supportsModelsEndpoint, true)
  assert.equal(probe.supportsChatCompletionsStream, true)
  assert.equal(probe.supportsResponses, true)
  assert.deepEqual(Object.keys(probe.models), ['gpt-5.5', 'claude-sonnet-4-6'])
  assert.equal(calls.length, 3)
  assert.ok(calls.every(call => call.auth === 'Bearer secret-token'))
  assert.equal(JSON.stringify(probe).includes('secret-token'), false)
})

test('probeProviderCapabilities records sanitized failure without throwing', async () => {
  const probe = await probeProviderCapabilities({
    providerId: 'jiucaihezi',
    apiHost: 'https://api.jiucaihezi.studio',
    apiKey: 'secret-token',
    testModel: 'gpt-5.5',
    fetcher: async () => {
      throw new Error('network failed with secret-token')
    },
    checkedAt: 456,
  })

  assert.equal(probe.supportsModelsEndpoint, false)
  assert.equal(probe.supportsChatCompletionsStream, false)
  assert.equal(probe.supportsResponses, false)
  assert.equal(probe.lastError?.includes('secret-token'), false)
  assert.match(probe.lastError || '', /network failed/)
})

test('probeProviderCapabilities redacts bearer jwt and sk-like secrets from errors', async () => {
  const probe = await probeProviderCapabilities({
    providerId: 'jiucaihezi',
    apiHost: 'https://api.jiucaihezi.studio',
    apiKey: '',
    testModel: 'gpt-5.5',
    fetcher: async () => {
      throw new Error('proxy echoed Authorization: Bearer sk-live-secret-12345678901234567890 and eyJabc.defghi.jklmnop')
    },
    checkedAt: 789,
  })

  assert.equal(probe.lastError?.includes('sk-live-secret'), false)
  assert.equal(probe.lastError?.includes('eyJabc'), false)
  assert.match(probe.lastError || '', /\[REDACTED/)
})

test('runAndCacheProviderCapabilityProbe saves merged probe without losing previous good models', async () => {
  const store = new Map<string, string>()
  const previous = buildProviderCapabilityProbe({
    providerId: 'jiucaihezi',
    apiHost: 'https://api.jiucaihezi.studio',
    modelIds: ['gpt-5.5'],
    modelsOk: true,
    streamOk: true,
    responsesOk: true,
    checkedAt: Date.now(),
  })
  saveProviderCapabilityProbe(previous, store)

  const probe = await runAndCacheProviderCapabilityProbe({
    providerId: 'jiucaihezi',
    apiHost: 'https://api.jiucaihezi.studio',
    apiKey: 'secret-token',
    testModel: 'gpt-5.5',
    fetcher: async () => {
      throw new Error('temporary network reset')
    },
    checkedAt: Date.now(),
    store,
  })

  assert.equal(probe.supportsChatCompletionsStream, true)
  assert.equal(probe.models['gpt-5.5'].supportsReasoningEffort, true)
  assert.match(probe.lastError || '', /temporary network reset/)
  assert.equal(getCachedProviderCapabilityProbe('jiucaihezi', 'https://api.jiucaihezi.studio', store)?.supportsChatCompletionsStream, true)
})
