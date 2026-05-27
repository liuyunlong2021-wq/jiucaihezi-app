import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LOCAL_MLX_PROVIDER_ID } from '../providerConfig'
import { buildChatCompletionExtras, buildHeaders, checkAuth, resolveApiConfig, type ApiConfig } from '../api'


async function withAsyncLocalStorage(values: Record<string, string>, fn: () => Promise<void>) {
  const store = new Map<string, string>(Object.entries(values))
  const previousStorage = (globalThis as any).localStorage
  const previousWindow = (globalThis as any).window
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
  ;(globalThis as any).window = {}
  try {
    await fn()
  } finally {
    ;(globalThis as any).localStorage = previousStorage
    ;(globalThis as any).window = previousWindow
  }
}

function withLocalStorage(values: Record<string, string>, fn: () => void) {
  const store = new Map<string, string>(Object.entries(values))
  const previous = (globalThis as any).localStorage
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
  try {
    fn()
  } finally {
    ;(globalThis as any).localStorage = previous
  }
}

const localConfig: ApiConfig = {
  providerId: LOCAL_MLX_PROVIDER_ID,
  apiKey: 'local',
  apiBase: 'http://127.0.0.1:17880',
  model: 'mlx-community/gemma-4-e4b-it-OptiQ-4bit',
}

test('buildChatCompletionExtras lets users enable local mlx thinking mode', () => {
  withLocalStorage({ jcLocalMlxThinking: 'true' }, () => {
    assert.deepEqual(buildChatCompletionExtras(localConfig), {
      chat_template_kwargs: { enable_thinking: true },
    })
  })
})

test('buildChatCompletionExtras keeps local thinking disabled by default', () => {
  withLocalStorage({}, () => {
    assert.deepEqual(buildChatCompletionExtras(localConfig), {
      chat_template_kwargs: { enable_thinking: false },
    })
  })
})


test('resolveApiConfig forceCloud keeps explicit cloud model when local provider storage is stale', async () => {
  await withAsyncLocalStorage({
    jcGatewaySessionToken: 'session-cloud',
    jcModel: 'gpt-oss:120b-cloud',
    jcModelProviderId: 'local-ollama',
    jcLocalOllamaModels: JSON.stringify([{ id: 'gpt-oss:120b-cloud', label: 'gpt-oss:120b-cloud', providerId: 'local-ollama' }]),
  }, async () => {
    const config = await resolveApiConfig({
      forceCloud: true,
      modelId: 'gpt-5.5',
      modelProviderId: 'jiucaihezi',
    })

    assert.equal(config.providerId, 'jiucaihezi')
    assert.equal(config.apiBase, 'https://api.jiucaihezi.studio')
    assert.equal(config.model, 'gpt-5.5')
    assert.equal(config.apiKey, 'session-cloud')
  })
})

test('resolveApiConfig still routes local Ollama when local provider is explicitly selected', async () => {
  await withAsyncLocalStorage({
    jcApiKey: 'sk-cloud',
    jcModel: 'gpt-5.5',
    jcModelProviderId: 'jiucaihezi',
    jcLocalOllamaModels: JSON.stringify([{ id: 'qwen3:8b', label: 'qwen3:8b', providerId: 'local-ollama' }]),
  }, async () => {
    const config = await resolveApiConfig({
      modelId: 'qwen3:8b',
      modelProviderId: 'local-ollama',
    })

    assert.equal(config.providerId, 'local-ollama')
    assert.equal(config.apiBase, 'http://127.0.0.1:11434')
    assert.equal(config.model, 'qwen3:8b')
  })
})

test('checkAuth only trusts the Gateway session token, not stale provider mode', () => {
  withLocalStorage({ jcProviderMode: 'member' }, () => {
    assert.equal(checkAuth(), false)
  })

  withLocalStorage({ jcGatewaySessionToken: 'session-cloud', jcProviderMode: 'member' }, () => {
    assert.equal(checkAuth(), true)
  })
})

test('resolveApiConfig ignores legacy API key when Gateway session is missing', async () => {
  await withAsyncLocalStorage({ jcApiKey: 'sk-legacy-cloud' }, async () => {
    await assert.rejects(
      () => resolveApiConfig({ forceCloud: true, modelId: 'gpt-5.5' }),
      /请先登录韭菜盒子账号/,
    )
  })
})

test('resolveApiConfig does not accept JC_WORKSPACE token without local Gateway session', async () => {
  await withAsyncLocalStorage({}, async () => {
    ;(globalThis as any).window = {
      JC_WORKSPACE: {
        async getConfig() {
          return { sessionToken: 'bridge-token', gatewaySessionToken: 'bridge-gateway-token' }
        },
      },
    }

    await assert.rejects(
      () => resolveApiConfig({ forceCloud: true, modelId: 'gpt-5.5' }),
      /请先登录韭菜盒子账号/,
    )
  })
})

test('resolveApiConfig can use managed anonymous config for plain chat only', async () => {
  await withAsyncLocalStorage({}, async () => {
    const config = await resolveApiConfig({
      forceCloud: true,
      allowAnonymous: true,
      modelId: 'gpt-5.4',
    })

    assert.equal(config.providerId, 'jiucaihezi')
    assert.equal(config.apiBase, 'https://api.jiucaihezi.studio')
    assert.equal(config.model, 'gpt-5.4')
    assert.equal(config.apiKey, '__JC_MANAGED_SESSION__')
    assert.deepEqual(buildHeaders(config), { 'Content-Type': 'application/json' })
  })
})
