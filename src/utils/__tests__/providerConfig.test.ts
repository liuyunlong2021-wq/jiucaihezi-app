import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_HOST,
  getModelProviderId,
  loadProvidersFromStorage,
  normalizeApiHost,
  rotateProviderKey,
  updateDefaultProviderModels,
} from '../providerConfig'

test('normalizeApiHost hides and normalizes the built-in NewAPI host', () => {
  assert.equal(normalizeApiHost(), DEFAULT_PROVIDER_HOST)
  assert.equal(normalizeApiHost(`${DEFAULT_PROVIDER_HOST}/`), DEFAULT_PROVIDER_HOST)
  assert.equal(normalizeApiHost(`${DEFAULT_PROVIDER_HOST}/v1`), DEFAULT_PROVIDER_HOST)
  assert.equal(normalizeApiHost(`${DEFAULT_PROVIDER_HOST}/api`), DEFAULT_PROVIDER_HOST)
})

test('rotateProviderKey returns single keys unchanged', () => {
  const store = new Map<string, string>()
  assert.equal(rotateProviderKey(DEFAULT_PROVIDER_ID, 'sk-one', store), 'sk-one')
  assert.equal(store.size, 0)
})

test('rotateProviderKey cycles comma separated keys and skips blanks', () => {
  const store = new Map<string, string>()

  assert.equal(rotateProviderKey(DEFAULT_PROVIDER_ID, ' sk-a, ,sk-b,sk-c ', store), 'sk-a')
  assert.equal(rotateProviderKey(DEFAULT_PROVIDER_ID, ' sk-a, ,sk-b,sk-c ', store), 'sk-b')
  assert.equal(rotateProviderKey(DEFAULT_PROVIDER_ID, ' sk-a, ,sk-b,sk-c ', store), 'sk-c')
  assert.equal(rotateProviderKey(DEFAULT_PROVIDER_ID, ' sk-a, ,sk-b,sk-c ', store), 'sk-a')
})

test('rotateProviderKey falls back to first key when previous key was removed', () => {
  const store = new Map<string, string>()
  store.set(`provider:${DEFAULT_PROVIDER_ID}:last_used_key`, 'sk-removed')

  assert.equal(rotateProviderKey(DEFAULT_PROVIDER_ID, 'sk-a,sk-b', store), 'sk-a')
})

test('getModelProviderId resolves hidden default provider from model metadata', () => {
  assert.equal(getModelProviderId({ id: 'claude-sonnet-4-6' }), DEFAULT_PROVIDER_ID)
  assert.equal(getModelProviderId({ id: 'gpt-5.5', providerId: 'custom' }), 'custom')
})

test('loadProvidersFromStorage migrates legacy key into hidden default provider', () => {
  const store = new Map<string, string>()
  store.set('jcApiKey', 'sk-legacy')

  const providers = loadProvidersFromStorage(store)

  assert.equal(providers.length, 1)
  assert.equal(providers[0].id, DEFAULT_PROVIDER_ID)
  assert.equal(providers[0].apiKey, 'sk-legacy')
  assert.equal(providers[0].apiHost, DEFAULT_PROVIDER_HOST)
  assert.equal(providers[0].enabled, true)
})

test('updateDefaultProviderModels persists model ownership without exposing host changes', () => {
  const store = new Map<string, string>()
  store.set('jcProviders', JSON.stringify([
    {
      id: DEFAULT_PROVIDER_ID,
      name: '韭菜盒子',
      type: 'new-api',
      apiKey: 'sk-one',
      apiHost: 'https://attacker.example/v1',
      enabled: true,
      models: [],
    },
  ]))

  const providers = updateDefaultProviderModels([
    { id: 'claude-sonnet-4-6', label: 'Sonnet' },
  ], store)

  assert.equal(providers[0].apiHost, DEFAULT_PROVIDER_HOST)
  assert.deepEqual(providers[0].models, [
    { id: 'claude-sonnet-4-6', label: 'Sonnet', providerId: DEFAULT_PROVIDER_ID },
  ])
})
