export const PENDING_API_KEY_STORAGE_KEY = 'jcPendingApiKey'
export const API_KEY_CALLBACK_INTENT_STORAGE_KEY = 'jcPendingApiKeyCallbackIntent'

const CALLBACK_KEY_NAMES = ['key', 'jcApiKey', 'api_key']
const CALLBACK_STATE_NAMES = ['state', 'jcDesktopState']
const API_KEY_PATTERN = /^sk-[A-Za-z0-9._~+/=-]{20,}$/
const CALLBACK_INTENT_TTL_MS = 15 * 60 * 1000

function defaultPendingStorage(): Storage | undefined {
  return globalThis.sessionStorage
}

function stripCallbackKeyParams(href: string, replaceState?: (url: string) => void): boolean {
  try {
    const url = new URL(String(href || ''), 'tauri://localhost/index.html')
    const hasCallbackKeyParam = CALLBACK_KEY_NAMES.some(name => url.searchParams.has(name))
    if (!hasCallbackKeyParam) return false
    let changed = true
    for (const name of CALLBACK_KEY_NAMES) {
      url.searchParams.delete(name)
    }
    for (const name of CALLBACK_STATE_NAMES) url.searchParams.delete(name)
    const clean = `${url.pathname || '/'}${url.search}${url.hash}`
    const target = url.protocol === 'tauri:' ? `${url.protocol}//${url.host}${clean}` : clean
    if (replaceState) replaceState(target)
    else globalThis.history?.replaceState?.({}, '', clean)
    return true
  } catch {
    return false
  }
}

export function extractApiKeyFromCallbackUrl(href: string): string {
  let url: URL
  try {
    url = new URL(String(href || ''), 'tauri://localhost/index.html')
  } catch {
    return ''
  }
  for (const name of CALLBACK_KEY_NAMES) {
    const value = String(url.searchParams.get(name) || '').trim()
    if (API_KEY_PATTERN.test(value)) return value
  }
  return ''
}

function isTrustedApiKeyCallbackUrl(href: string): boolean {
  try {
    const url = new URL(String(href || ''), 'tauri://localhost/index.html')
    if (url.protocol === 'tauri:' && url.hostname === 'localhost') return true
    return url.protocol === 'jiucaihezi:' && url.hostname === 'auth' && url.pathname === '/callback'
  } catch {
    return false
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(16)
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes)
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`
}

function buildCallbackIntent(nonce: string, now = Date.now()): string {
  return JSON.stringify({ nonce, createdAt: now })
}

function getCallbackState(href: string): string {
  try {
    const url = new URL(String(href || ''), 'tauri://localhost/index.html')
    for (const name of CALLBACK_STATE_NAMES) {
      const value = String(url.searchParams.get(name) || '').trim()
      if (value) return value
    }
  } catch {}
  return ''
}

function hasFreshCallbackIntent(storage: Storage | undefined, state: string, now = Date.now()): boolean {
  if (!storage) return false
  try {
    const raw = storage.getItem(API_KEY_CALLBACK_INTENT_STORAGE_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw)
    const nonce = String(parsed?.nonce || '').trim()
    const createdAt = Number(parsed?.createdAt || 0)
    return Boolean(nonce && state && nonce === state && createdAt > 0 && now - createdAt <= CALLBACK_INTENT_TTL_MS)
  } catch {
    return false
  }
}

export function prepareApiKeyCallbackIntent(storage: Storage | undefined = defaultPendingStorage()): string {
  const nonce = randomNonce()
  storage?.setItem(API_KEY_CALLBACK_INTENT_STORAGE_KEY, buildCallbackIntent(nonce))
  return nonce
}

export function consumeApiKeyCallbackUrl(input: {
  href?: string
  storage?: Storage
  replaceState?: (url: string) => void
} = {}): string {
  const href = input.href || globalThis.location?.href || ''
  const storage = input.storage || defaultPendingStorage()
  const key = extractApiKeyFromCallbackUrl(href)
  const state = getCallbackState(href)
  stripCallbackKeyParams(href, input.replaceState)
  if (!key || !storage) return ''
  if (!isTrustedApiKeyCallbackUrl(href) || !hasFreshCallbackIntent(storage, state)) {
    storage.removeItem(API_KEY_CALLBACK_INTENT_STORAGE_KEY)
    return ''
  }

  storage.setItem(PENDING_API_KEY_STORAGE_KEY, key)
  storage.removeItem(API_KEY_CALLBACK_INTENT_STORAGE_KEY)
  return key
}

export function popPendingApiKey(storage: Storage | undefined = defaultPendingStorage()): string {
  if (!storage) return ''
  const key = String(storage.getItem(PENDING_API_KEY_STORAGE_KEY) || '').trim()
  if (key) storage.removeItem(PENDING_API_KEY_STORAGE_KEY)
  return API_KEY_PATTERN.test(key) ? key : ''
}
