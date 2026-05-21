export const DEFAULT_PROVIDER_ID = 'jiucaihezi'
export const DEFAULT_PROVIDER_HOST = 'https://api.jiucaihezi.studio'
export const DEFAULT_PROVIDER_NAME = '韭菜盒子'

export type ProviderType = 'new-api'

export interface JcModelRef {
  id: string
  label?: string
  providerId?: string
}

export interface JcProvider {
  id: string
  name: string
  type: ProviderType
  apiKey: string
  apiHost: string
  enabled: boolean
  models: JcModelRef[]
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'> | Map<string, string>

function readStore(store: KeyValueStore, key: string): string | null {
  if (store instanceof Map) return store.get(key) || null
  return store.getItem(key)
}

function writeStore(store: KeyValueStore, key: string, value: string): void {
  if (store instanceof Map) {
    store.set(key, value)
    return
  }
  store.setItem(key, value)
}

function getStorage(): Storage | Map<string, string> {
  if (typeof localStorage !== 'undefined') return localStorage
  return new Map<string, string>()
}

export function normalizeApiHost(host = DEFAULT_PROVIDER_HOST): string {
  return (host || DEFAULT_PROVIDER_HOST)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '')
    .replace(/\/api$/, '')
}

export function withApiVersion(host: string): string {
  return `${normalizeApiHost(host)}/v1`
}

export function createDefaultProvider(apiKey = ''): JcProvider {
  return {
    id: DEFAULT_PROVIDER_ID,
    name: DEFAULT_PROVIDER_NAME,
    type: 'new-api',
    apiKey,
    apiHost: DEFAULT_PROVIDER_HOST,
    enabled: true,
    models: [],
  }
}

function sanitizeProvider(provider: Partial<JcProvider> | null | undefined, legacyKey = ''): JcProvider {
  return {
    ...createDefaultProvider(legacyKey),
    ...provider,
    id: DEFAULT_PROVIDER_ID,
    name: provider?.name || DEFAULT_PROVIDER_NAME,
    type: 'new-api',
    apiKey: provider?.apiKey || legacyKey,
    apiHost: normalizeApiHost(DEFAULT_PROVIDER_HOST),
    enabled: true,
    models: Array.isArray(provider?.models) ? provider.models : [],
  }
}

export function getModelProviderId(model: JcModelRef | string | null | undefined): string {
  if (!model) return DEFAULT_PROVIDER_ID
  if (typeof model === 'string') return DEFAULT_PROVIDER_ID
  return model.providerId || DEFAULT_PROVIDER_ID
}

export function rotateProviderKey(
  providerId: string,
  apiKey: string,
  store: KeyValueStore = getStorage()
): string {
  const keys = apiKey
    .split(',')
    .map(key => key.trim())
    .filter(Boolean)

  if (keys.length === 0) return ''
  if (keys.length === 1) return keys[0]

  const keyName = `provider:${providerId}:last_used_key`
  const lastUsedKey = readStore(store, keyName)
  const currentIndex = lastUsedKey ? keys.indexOf(lastUsedKey) : -1
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % keys.length
  const nextKey = keys[nextIndex]
  writeStore(store, keyName, nextKey)
  return nextKey
}

export function decodeApiKey(rawKey: string): string {
  let apiKey = rawKey.trim()
  try {
    const decoded = atob(apiKey)
    if (decoded.startsWith('sk-')) apiKey = decoded
  } catch (_) {}
  return apiKey
}

export function loadProvidersFromStorage(store: KeyValueStore = getStorage()): JcProvider[] {
  const legacyKey = readStore(store, 'jcApiKey') || ''
  const raw = readStore(store, 'jcProviders')
  if (!raw) return [createDefaultProvider(legacyKey)]

  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      const defaultProvider = parsed.find((p: Partial<JcProvider>) => p?.id === DEFAULT_PROVIDER_ID) || parsed[0]
      return [sanitizeProvider(defaultProvider, legacyKey)]
    }
  } catch (_) {}

  return [createDefaultProvider(legacyKey)]
}

export function saveProvidersToStorage(providers: JcProvider[], store: KeyValueStore = getStorage()): void {
  writeStore(store, 'jcProviders', JSON.stringify(providers.map(provider => sanitizeProvider(provider))))
}

export function resolveDefaultProviderFromStorage(store: KeyValueStore = getStorage()): JcProvider {
  const provider = loadProvidersFromStorage(store)[0] || createDefaultProvider()
  return sanitizeProvider(provider)
}

export function updateDefaultProviderModels(
  models: JcModelRef[],
  store: KeyValueStore = getStorage()
): JcProvider[] {
  const provider = resolveDefaultProviderFromStorage(store)
  provider.models = models.map(model => ({
    id: model.id,
    label: model.label,
    providerId: DEFAULT_PROVIDER_ID,
  }))
  const providers = [provider]
  saveProvidersToStorage(providers, store)
  return providers
}
