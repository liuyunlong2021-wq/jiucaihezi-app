import assert from 'node:assert/strict'
import { test } from 'node:test'

import { projectNewApiForOpenCode, toOpenCodeModelProjection } from '../providerProjection'

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
