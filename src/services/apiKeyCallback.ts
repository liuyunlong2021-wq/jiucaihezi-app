export const PENDING_API_KEY_STORAGE_KEY = 'jcPendingApiKey'

const CALLBACK_KEY_NAMES = ['key', 'jcApiKey', 'api_key']
const API_KEY_PATTERN = /^sk-[A-Za-z0-9._~+/=-]{20,}$/

function defaultPendingStorage(): Storage | undefined {
  return globalThis.sessionStorage || globalThis.localStorage
}

function stripCallbackKeyParams(href: string, replaceState?: (url: string) => void): boolean {
  try {
    const url = new URL(String(href || ''), 'tauri://localhost/index.html')
    let changed = false
    for (const name of CALLBACK_KEY_NAMES) {
      if (url.searchParams.has(name)) changed = true
      url.searchParams.delete(name)
    }
    if (!changed) return false
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

export function consumeApiKeyCallbackUrl(input: {
  href?: string
  storage?: Storage
  replaceState?: (url: string) => void
} = {}): string {
  const href = input.href || globalThis.location?.href || ''
  const storage = input.storage || defaultPendingStorage()
  const key = extractApiKeyFromCallbackUrl(href)
  stripCallbackKeyParams(href, input.replaceState)
  if (!key || !storage) return ''

  storage.setItem(PENDING_API_KEY_STORAGE_KEY, key)
  return key
}

export function popPendingApiKey(storage: Storage | undefined = defaultPendingStorage()): string {
  if (!storage) return ''
  const key = String(storage.getItem(PENDING_API_KEY_STORAGE_KEY) || '').trim()
  if (key) storage.removeItem(PENDING_API_KEY_STORAGE_KEY)
  return API_KEY_PATTERN.test(key) ? key : ''
}
