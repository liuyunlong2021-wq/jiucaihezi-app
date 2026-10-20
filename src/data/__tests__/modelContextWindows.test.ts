import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getModelContextWindow, getModelMaxOutputTokens } from '../modelContextWindows'

test('cloud models use the unified defaults while local and free models keep their own limits', () => {
  for (const model of ['claude-3.5-sonnet', 'gpt-4o', 'o3', 'gemini-2.5-pro', 'deepseek-r1', 'grok-3', 'glm-4.5', 'doubao-pro']) {
    assert.equal(getModelContextWindow(model, 'jiucaihezi'), 1_000_000, model)
  }
  assert.equal(getModelContextWindow('qwen3.8:9b-q5', 'local-ollama'), 262_144)
  assert.equal(getModelContextWindow('openai/gpt-oss-120b:free', 'openrouter'), 32_000)
  assert.equal(getModelMaxOutputTokens('claude-sonnet-4-6', 'jiucaihezi'), 128_000)
  assert.equal(getModelMaxOutputTokens('gpt-5', 'local-ollama'), 4_096)
  assert.equal(getModelMaxOutputTokens('openai/gpt-oss-120b:free', 'openrouter'), 32_000)
})


test('Strata discovery matches the user supplied Qwen3.8 model and 256K configuration', async () => {
  const { discoverCustomProviderModels } = await import('../../utils/customProviderModels')
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; authorization: string | null }> = []
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), authorization: new Headers(init?.headers).get('Authorization') })
    return Response.json(String(url).includes('/props?')
      ? { default_generation_settings: { n_ctx: 262144, params: { n_predict: -1 } } }
      : { data: [{ id: 'qwen3.8-flash-next-iq3_xxs', object: 'model', status: { value: 'loaded' }, meta: { n_ctx: 262144 }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } }] })
  }) as typeof fetch
  try {
    const result = await discoverCustomProviderModels({ apiBase: 'http://127.0.0.1:8080/v1', apiKey: 'local-test' })
    assert.deepEqual(result, { modelIds: ['qwen3.8-flash-next-iq3_xxs'], modelCapabilities: { 'qwen3.8-flash-next-iq3_xxs': {
      contextWindow: 262144, maxOutputTokens: 131072, inputModalities: ['text', 'image'],
    } } })
    assert.equal(requests[0]?.url, 'http://127.0.0.1:8080/v1/models')
    assert.ok(requests.every(request => request.authorization === 'Bearer local-test'))
  } finally { globalThis.fetch = originalFetch }
})

test('custom discovery honors a server output cap and tolerates missing optional props', async () => {
  const { discoverCustomProviderModels } = await import('../../utils/customProviderModels')
  const originalFetch = globalThis.fetch
  let propsAvailable = true
  globalThis.fetch = (async (url) => {
    if (String(url).includes('/props?')) return propsAvailable
      ? Response.json({ default_generation_settings: { n_ctx: 65536, params: { n_predict: 8192 } } })
      : new Response('', { status: 404 })
    return Response.json({ data: [{ id: 'local', context_length: 65536, max_output_tokens: 16384 }, { id: null }] })
  }) as typeof fetch
  try {
    assert.equal((await discoverCustomProviderModels({ apiBase: 'http://localhost:8080' })).modelCapabilities.local?.maxOutputTokens, 8192)
    propsAvailable = false
    assert.equal((await discoverCustomProviderModels({ apiBase: 'http://localhost:8080' })).modelCapabilities.local?.maxOutputTokens, 16384)
  } finally { globalThis.fetch = originalFetch }
})
