import { DEFAULT_API_BASE_URL } from './newApiClient'
import { resolveWebApiBaseUrl, DEFAULT_PROVIDER_HOST } from '@/utils/providerConfig'

/** 解析 API 基址：dev 模式走 Vite proxy，生产走直连 */
function resolveBaseUrl(): string {
  try {
    return resolveWebApiBaseUrl(DEFAULT_PROVIDER_HOST)
  } catch {
    return DEFAULT_API_BASE_URL
  }
}

const ONE_CLICK_LOGIN_FLAG = 'jcOneClickLogin'
const CALLBACK_KEY_NAMES = ['key', 'jcApiKey', 'api_key']
const API_KEY_PATTERN = /^sk-[A-Za-z0-9._~+/=-]{20,}$/
const PRODUCTION_WORKBENCH_URL = 'https://jiucaihezi.studio/'
const PRODUCTION_WORKBENCH_HOSTS = new Set(['jiucaihezi.studio', 'www.jiucaihezi.studio'])
export const ONE_CLICK_LOGIN_INTENT_STORAGE_KEY = 'jcOneClickLoginIntent'
const ONE_CLICK_LOGIN_INTENT_TTL_MS = 15 * 60 * 1000

export type OneClickLoginResult =
  | { status: 'ok'; apiKey: string }
  | { status: 'needs-login' }
  | { status: 'error'; message: string }

interface CreateAutoGroupApiKeyInput {
  fetcher?: typeof fetch
  now?: Date
}

interface OneClickLoginIntent {
  nonce: string
  createdAt: number
}

interface TokenListItem {
  id?: string | number
  name?: string
  [key: string]: unknown
}

function compactTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
}

function buildTokenName(now: Date): string {
  return `jiucaihezi-studio-${compactTimestamp(now)}-${randomNonce().slice(0, 12)}`
}

function normalizeApiKey(value: unknown): string {
  const text = String(value || '').trim()
  const key = text.startsWith('sk-') ? text : `sk-${text}`
  return API_KEY_PATTERN.test(key) ? key : ''
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

export async function createAutoGroupApiKey(input: CreateAutoGroupApiKeyInput = {}): Promise<OneClickLoginResult> {
  const fetcher = input.fetcher || globalThis.fetch
  if (!fetcher) return { status: 'error', message: '当前环境不支持自动登录请求' }
  const tokenName = buildTokenName(input.now || new Date())

  try {
    const baseUrl = resolveBaseUrl()
    const createResp = await fetcher(`${baseUrl}/api/token/`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: tokenName,
        remain_quota: 0,
        expired_time: -1,
        unlimited_quota: true,
        model_limits_enabled: false,
        model_limits: '',
        allow_ips: '',
        group: 'auto',
        cross_group_retry: true,
      }),
    })

    if (createResp.status === 401 || createResp.status === 403) return { status: 'needs-login' }
    const createPayload = await readJson(createResp)
    if (!createResp.ok || createPayload?.success === false) {
      return { status: 'error', message: createPayload?.message || `创建 Key 失败：HTTP ${createResp.status}` }
    }

    const tokenId = createPayload?.data?.id ?? createPayload?.id ?? await findCreatedTokenId(fetcher, tokenName)
    if (tokenId == null || tokenId === '') return { status: 'error', message: '创建成功但没有返回 Key ID' }

    const keyResp = await fetcher(`${baseUrl}/api/token/${encodeURIComponent(String(tokenId))}/key`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    if (keyResp.status === 401 || keyResp.status === 403) return { status: 'needs-login' }
    const keyPayload = await readJson(keyResp)
    if (!keyResp.ok || keyPayload?.success === false) {
      return { status: 'error', message: keyPayload?.message || `获取 Key 失败：HTTP ${keyResp.status}` }
    }

    const apiKey = normalizeApiKey(keyPayload?.data?.key ?? keyPayload?.key ?? keyPayload?.data)
    if (!apiKey) return { status: 'error', message: 'NewAPI 没有返回有效的 sk- Key' }
    return { status: 'ok', apiKey }
  } catch (err: any) {
    return { status: 'error', message: err?.message || '自动获取 Key 失败' }
  }
}

function extractTokenItems(payload: any): TokenListItem[] {
  const candidates = [
    payload?.data?.items,
    payload?.data?.data,
    payload?.data,
    payload?.items,
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as TokenListItem[]
  }
  return []
}

async function fetchTokens(fetcher: typeof fetch, path: string): Promise<TokenListItem[]> {
  const response = await fetcher(`${resolveBaseUrl()}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })
  if (response.status === 401 || response.status === 403) return []
  if (!response.ok) return []
  return extractTokenItems(await readJson(response))
}

async function findCreatedTokenId(fetcher: typeof fetch, tokenName: string): Promise<string | number | null> {
  const searchPaths = [
    `/api/token/search?keyword=${encodeURIComponent(tokenName)}&p=1&page_size=10`,
    `/api/token/?p=1&page_size=100`,
  ]
  for (const path of searchPaths) {
    const tokens = await fetchTokens(fetcher, path)
    const match = tokens.find(token => String(token.name || '') === tokenName && token.id != null && token.id !== '')
    if (match) return match.id as string | number
  }
  return null
}

export function buildOneClickLoginReturnUrl(
  href: string = globalThis.location?.href || '',
  storage: Storage | undefined = defaultIntentStorage(),
): string {
  const url = new URL(String(href || '/'), globalThis.location?.origin || 'https://jiucaihezi.studio')
  for (const name of CALLBACK_KEY_NAMES) url.searchParams.delete(name)
  url.searchParams.set(ONE_CLICK_LOGIN_FLAG, '1')
  url.searchParams.set('state', prepareOneClickLoginIntent(storage))
  return url.href
}

export function isProductionWorkbenchOrigin(href: string = globalThis.location?.href || ''): boolean {
  try {
    const url = new URL(String(href || '/'), globalThis.location?.origin || PRODUCTION_WORKBENCH_URL)
    return url.protocol === 'https:' && PRODUCTION_WORKBENCH_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

export function buildProductionOneClickLoginUrl(): string {
  return PRODUCTION_WORKBENCH_URL
}

export function buildNewApiSignInUrl(returnUrl: string): string {
  const url = new URL('/sign-in', DEFAULT_API_BASE_URL)
  url.searchParams.set('redirect', returnUrl)
  return url.href
}

function defaultIntentStorage(): Storage | undefined {
  return globalThis.sessionStorage
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

function readOneClickLoginIntent(storage: Storage | undefined = defaultIntentStorage()): OneClickLoginIntent | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(ONE_CLICK_LOGIN_INTENT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const nonce = String(parsed?.nonce || '').trim()
    const createdAt = Number(parsed?.createdAt || 0)
    if (!nonce || !createdAt || Date.now() - createdAt > ONE_CLICK_LOGIN_INTENT_TTL_MS) return null
    return { nonce, createdAt }
  } catch {
    return null
  }
}

export function prepareOneClickLoginIntent(storage: Storage | undefined = defaultIntentStorage()): string {
  const nonce = randomNonce()
  storage?.setItem(ONE_CLICK_LOGIN_INTENT_STORAGE_KEY, JSON.stringify({ nonce, createdAt: Date.now() }))
  return nonce
}

export function consumeOneClickLoginRetryFlag(
  href: string = globalThis.location?.href || '',
  storage: Storage | undefined = defaultIntentStorage(),
  replaceState?: (url: string) => void,
): boolean {
  try {
    const url = new URL(String(href || '/'), globalThis.location?.origin || 'https://jiucaihezi.studio')
    const shouldRetry = url.searchParams.get(ONE_CLICK_LOGIN_FLAG) === '1'
    const intent = readOneClickLoginIntent(storage)
    const state = String(url.searchParams.get('state') || '').trim()
    if (!shouldRetry) return false
    if (!intent || !state || state !== intent.nonce) {
      url.searchParams.delete(ONE_CLICK_LOGIN_FLAG)
      url.searchParams.delete('state')
      const cleanWithoutIntent = `${url.pathname || '/'}${url.search}${url.hash}`
      if (replaceState) replaceState(cleanWithoutIntent)
      else globalThis.history?.replaceState?.({}, '', cleanWithoutIntent)
      return false
    }
    url.searchParams.delete(ONE_CLICK_LOGIN_FLAG)
    url.searchParams.delete('state')
    storage?.removeItem(ONE_CLICK_LOGIN_INTENT_STORAGE_KEY)
    const clean = `${url.pathname || '/'}${url.search}${url.hash}`
    if (replaceState) replaceState(clean)
    else globalThis.history?.replaceState?.({}, '', clean)
    return true
  } catch {
    return false
  }
}
