import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LOCAL_MLX_PROVIDER_ID } from '../providerConfig'
import { buildChatCompletionExtras, type ApiConfig } from '../api'

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
