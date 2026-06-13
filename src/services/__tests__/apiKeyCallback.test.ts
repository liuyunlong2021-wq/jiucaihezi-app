import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  API_KEY_CALLBACK_INTENT_STORAGE_KEY,
  PENDING_API_KEY_STORAGE_KEY,
  consumeApiKeyCallbackUrl,
  extractApiKeyFromCallbackUrl,
  prepareApiKeyCallbackIntent,
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
  assert.equal(extractApiKeyFromCallbackUrl('tauri://localhost/?key=sk-root12345678901234567890'), 'sk-root12345678901234567890')
  assert.equal(extractApiKeyFromCallbackUrl('jiucaihezi://auth/callback?key=sk-deeplink12345678901234567890'), 'sk-deeplink12345678901234567890')
  assert.equal(extractApiKeyFromCallbackUrl('tauri://localhost/index.html?jcApiKey=sk-def12345678901234567890'), 'sk-def12345678901234567890')
  assert.equal(extractApiKeyFromCallbackUrl('tauri://localhost/index.html?api_key=sk-ghi12345678901234567890'), 'sk-ghi12345678901234567890')
  assert.equal(extractApiKeyFromCallbackUrl('tauri://localhost/index.html?key=not-a-real-key'), '')
})

test('consumeApiKeyCallbackUrl stores callback key as pending and strips it from url', () => {
  const storage = createMemoryStorage()
  const state = prepareApiKeyCallbackIntent(storage)
  let replaced = ''

  const key = consumeApiKeyCallbackUrl({
    href: `tauri://localhost/index.html?key=sk-callback12345678901234567890&state=${state}&foo=1`,
    storage,
    replaceState: url => { replaced = url },
  })

  assert.equal(key, 'sk-callback12345678901234567890')
  assert.equal(storage.getItem(PENDING_API_KEY_STORAGE_KEY), 'sk-callback12345678901234567890')
  assert.equal(storage.getItem(API_KEY_CALLBACK_INTENT_STORAGE_KEY), null)
  assert.equal(replaced, 'tauri://localhost/index.html?foo=1')
})

test('consumeApiKeyCallbackUrl accepts app root callback URLs', () => {
  const storage = createMemoryStorage()
  const state = prepareApiKeyCallbackIntent(storage)
  let replaced = ''

  const key = consumeApiKeyCallbackUrl({
    href: `tauri://localhost/?key=sk-rootcallback12345678901234567890&state=${state}&foo=1`,
    storage,
    replaceState: url => { replaced = url },
  })

  assert.equal(key, 'sk-rootcallback12345678901234567890')
  assert.equal(storage.getItem(PENDING_API_KEY_STORAGE_KEY), 'sk-rootcallback12345678901234567890')
  assert.equal(replaced, 'tauri://localhost/?foo=1')
})

test('consumeApiKeyCallbackUrl accepts desktop deep link callback URLs', () => {
  const storage = createMemoryStorage()
  const state = prepareApiKeyCallbackIntent(storage)

  const key = consumeApiKeyCallbackUrl({
    href: `jiucaihezi://auth/callback?key=sk-deeplinkcallback12345678901234567890&state=${state}`,
    storage,
  })

  assert.equal(key, 'sk-deeplinkcallback12345678901234567890')
  assert.equal(storage.getItem(PENDING_API_KEY_STORAGE_KEY), 'sk-deeplinkcallback12345678901234567890')
})

test('consumeApiKeyCallbackUrl strips but ignores callback keys with a mismatched state', () => {
  const storage = createMemoryStorage()
  prepareApiKeyCallbackIntent(storage)
  let replaced = ''

  const key = consumeApiKeyCallbackUrl({
    href: 'tauri://localhost/index.html?key=sk-callback12345678901234567890&state=attacker&foo=1',
    storage,
    replaceState: url => { replaced = url },
  })

  assert.equal(key, '')
  assert.equal(storage.getItem(PENDING_API_KEY_STORAGE_KEY), null)
  assert.equal(storage.getItem(API_KEY_CALLBACK_INTENT_STORAGE_KEY), null)
  assert.equal(replaced, 'tauri://localhost/index.html?foo=1')
})

test('consumeApiKeyCallbackUrl strips but ignores callback keys without a pending intent', () => {
  const storage = createMemoryStorage()
  let replaced = ''

  const key = consumeApiKeyCallbackUrl({
    href: 'tauri://localhost/index.html?key=sk-callback12345678901234567890&foo=1',
    storage,
    replaceState: url => { replaced = url },
  })

  assert.equal(key, '')
  assert.equal(storage.getItem(PENDING_API_KEY_STORAGE_KEY), null)
  assert.equal(replaced, 'tauri://localhost/index.html?foo=1')
})

test('consumeApiKeyCallbackUrl strips but ignores web callback key URLs', () => {
  const storage = createMemoryStorage()
  prepareApiKeyCallbackIntent(storage)
  let replaced = ''

  const key = consumeApiKeyCallbackUrl({
    href: 'https://jiucaihezi.studio/?key=sk-callback12345678901234567890&foo=1',
    storage,
    replaceState: url => { replaced = url },
  })

  assert.equal(key, '')
  assert.equal(storage.getItem(PENDING_API_KEY_STORAGE_KEY), null)
  assert.equal(replaced, '/?foo=1')
})

test('consumeApiKeyCallbackUrl strips invalid callback key aliases without storing them', () => {
  const storage = createMemoryStorage()
  prepareApiKeyCallbackIntent(storage)
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
