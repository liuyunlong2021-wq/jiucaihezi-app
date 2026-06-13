import assert from 'node:assert/strict'
import { test } from 'node:test'
import { API_KEY_CALLBACK_INTENT_STORAGE_KEY } from '../apiKeyCallback'
import { buildDesktopBrowserLoginUrl } from '../desktopBrowserLogin'

function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => Array.from(data.keys())[index] ?? null,
    removeItem: key => { data.delete(key) },
    setItem: (key, value) => { data.set(key, String(value)) },
  }
}

test('buildDesktopBrowserLoginUrl creates gateway start URL with deep-link redirect and pending state', () => {
  const storage = createMemoryStorage()
  const url = new URL(buildDesktopBrowserLoginUrl({
    gatewayBase: 'https://api.jiucaihezi.studio/',
    storage,
  }))

  assert.equal(url.origin, 'https://api.jiucaihezi.studio')
  assert.equal(url.pathname, '/auth/desktop/start')
  assert.equal(url.searchParams.get('redirect'), 'jiucaihezi://auth/callback')

  const state = String(url.searchParams.get('state') || '')
  const intent = JSON.parse(String(storage.getItem(API_KEY_CALLBACK_INTENT_STORAGE_KEY)))
  assert.ok(state.length >= 24)
  assert.equal(intent.nonce, state)
})
