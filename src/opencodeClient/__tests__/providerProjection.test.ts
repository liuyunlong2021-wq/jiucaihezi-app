import assert from 'node:assert/strict'
import { test } from 'node:test'

import { projectNewApiForOpenCode, projectStoredNewApiForOpenCode, toOpenCodeModelProjection } from '../providerProjection'

const models = [
  { id: 'claude-sonnet-4-6', label: 'Claude', providerId: 'jiucaihezi' as const, capability: 'text' as const },
  { id: 'gpt-image-2', label: 'Image', providerId: 'jiucaihezi' as const, capability: 'image' as const },
]

test('projects Jiucai NewAPI text models into OpenCode provider config', () => {
  const config = projectNewApiForOpenCode({
    currentModel: 'claude-sonnet-4-6',
    models,
    apiKey: 'sk-test',
  })

  assert.deepEqual(config.enabled_providers, ['jiucaihezi'])
  assert.equal(config.model, 'jiucaihezi/claude-sonnet-4-6')
  const provider = config.provider.jiucaihezi as any
  assert.equal(provider.npm, '@ai-sdk/openai-compatible')
  assert.equal(provider.api, 'https://api.jiucaihezi.studio/v1')
  assert.equal(provider.options.apiKey, 'sk-test')
  assert.ok(provider.models['claude-sonnet-4-6'])
  assert.equal(provider.models['gpt-image-2'], undefined)
})

test('account session without scoped key is explicit Wave 2 blocker', () => {
  assert.throws(
    () => projectNewApiForOpenCode({
      currentModel: 'claude-sonnet-4-6',
      models,
      apiKey: '',
      gatewaySessionToken: 'sess-user',
    }),
    /短期 NewAPI API Key/,
  )
})

test('maps selected model to OpenCode SDK model projection', () => {
  assert.deepEqual(toOpenCodeModelProjection('claude-sonnet-4-6'), {
    providerID: 'jiucaihezi',
    modelID: 'claude-sonnet-4-6',
  })
})

test('projects Ollama-only catalog without requiring NewAPI auth', async () => {
  const config = await projectStoredNewApiForOpenCode({
    currentModel: 'gpt-oss:20b',
    models: [
      { id: 'gpt-oss:20b', label: 'GPT OSS 20B', providerId: 'local-ollama', capability: 'text' },
    ],
  })

  assert.deepEqual(config.enabled_providers, ['local-ollama'])
  assert.equal(config.model, 'local-ollama/gpt-oss:20b')
  assert.equal(config.provider.jiucaihezi, undefined)
  const provider = config.provider['local-ollama'] as any
  assert.equal(provider.api, 'http://127.0.0.1:11434/v1')
  assert.equal(provider.options.apiKey, undefined)
  assert.equal(provider.models['gpt-oss:20b'].tool_call, true)
})

test('uses current local model as OpenCode default when cloud models are also present', () => {
  const config = projectNewApiForOpenCode({
    currentModel: 'gpt-oss:20b',
    models: [
      ...models,
      { id: 'gpt-oss:20b', label: 'GPT OSS 20B', providerId: 'local-ollama', capability: 'text' },
    ],
    apiKey: 'sk-test',
  })

  assert.deepEqual(config.enabled_providers, ['jiucaihezi', 'local-ollama'])
  assert.equal(config.model, 'local-ollama/gpt-oss:20b')
})

test('selected Ollama model ignores cached cloud catalog when NewAPI auth is missing', async () => {
  const config = await projectStoredNewApiForOpenCode({
    currentModel: 'gpt-oss:20b',
    gatewaySessionToken: 'sess-user',
    models: [
      ...models,
      { id: 'gpt-oss:20b', label: 'GPT OSS 20B', providerId: 'local-ollama', capability: 'text' },
    ],
  })

  assert.deepEqual(config.enabled_providers, ['local-ollama'])
  assert.equal(config.model, 'local-ollama/gpt-oss:20b')
  assert.equal(config.provider.jiucaihezi, undefined)
})
