import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PENDING_API_KEY_STORAGE_KEY,
  consumeApiKeyCallbackUrl,
  extractApiKeyFromCallbackUrl,
  popPendingApiKey,
} from '../apiKeyCallback'

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

test('extractApiKeyFromCallbackUrl accepts supported callback key aliases', () => {
  assert.equal(extractApiKeyFromCallbackUrl('tauri://localhost/index.html?key=sk-abc12345678901234567890'), 'sk-abc12345678901234567890')
  assert.equal(extractApiKeyFromCallbackUrl('tauri://localhost/index.html?jcApiKey=sk-def12345678901234567890'), 'sk-def12345678901234567890')
  assert.equal(extractApiKeyFromCallbackUrl('tauri://localhost/index.html?api_key=sk-ghi12345678901234567890'), 'sk-ghi12345678901234567890')
  assert.equal(extractApiKeyFromCallbackUrl('tauri://localhost/index.html?key=not-a-real-key'), '')
})

test('consumeApiKeyCallbackUrl stores callback key as pending and strips it from url', () => {
  const storage = createMemoryStorage()
  let replaced = ''

  const key = consumeApiKeyCallbackUrl({
    href: 'tauri://localhost/index.html?key=sk-callback12345678901234567890&foo=1',
    storage,
    replaceState: url => { replaced = url },
  })

  assert.equal(key, 'sk-callback12345678901234567890')
  assert.equal(storage.getItem(PENDING_API_KEY_STORAGE_KEY), 'sk-callback12345678901234567890')
  assert.equal(replaced, 'tauri://localhost/index.html?foo=1')
})

test('consumeApiKeyCallbackUrl strips invalid callback key aliases without storing them', () => {
  const storage = createMemoryStorage()
  let replaced = ''

  const key = consumeApiKeyCallbackUrl({
    href: 'tauri://localhost/index.html?key=not-a-real-key&api_key=also-invalid&foo=1',
    storage,
    replaceState: url => { replaced = url },
  })

  assert.equal(key, '')
  assert.equal(storage.getItem(PENDING_API_KEY_STORAGE_KEY), null)
  assert.equal(replaced, 'tauri://localhost/index.html?foo=1')
})

test('popPendingApiKey returns the pending key once without persisting it', () => {
  const storage = createMemoryStorage()
  storage.setItem(PENDING_API_KEY_STORAGE_KEY, 'sk-pending12345678901234567890')

  assert.equal(popPendingApiKey(storage), 'sk-pending12345678901234567890')
  assert.equal(popPendingApiKey(storage), '')
})
