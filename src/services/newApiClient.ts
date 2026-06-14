import { safeFetch } from '../utils/httpClient'
import { isMediaModelEnabled, isRemovedMediaModelId } from '../data/mediaModelCapabilities'
import { isTauriRuntime } from '../utils/tauriEnv'

export const DEFAULT_API_BASE_URL = 'https://api.jiucaihezi.studio'
export const API_KEY_STORAGE_KEY = 'jcApiKey'  // 仅保留兼容旧 localStorage 迁移
export const API_ACCOUNT_CACHE_KEY = 'jcApiAccount'
const LEGACY_AUTH_STORAGE_KEYS = [
  'jcMemberAccessToken',
  'jcUserAccessToken',
  'jcMemberApiKey',
  'jcNewApiUserId',
  'jcMemberUserId',
  'jcProviderMode',
  'jcUserMode',
]

let apiKeyMemoryCache = ''
let invokeApi: null | ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) = null

async function getInvokeApi() {
  if (!isTauriRuntime()) return null
  if (!invokeApi) {
    const mod = await import('@tauri-apps/api/core')
    invokeApi = mod.invoke as (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  }
  return invokeApi
}

function readLegacyApiKey(): string {
  if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return ''
  return (localStorage.getItem(API_KEY_STORAGE_KEY) || '').trim()
}

export async function initApiKey(): Promise<string> {
  if (apiKeyMemoryCache) return apiKeyMemoryCache
  const invoke = await getInvokeApi()
  if (invoke) {
    const stored = String((await invoke('get_api_key')) || '').trim()
    if (stored) {
      apiKeyMemoryCache = stored
      clearLegacyAuthStorage()
      return apiKeyMemoryCache
    }
  }

  const legacy = readLegacyApiKey()
  if (legacy && !invoke) {
    apiKeyMemoryCache = legacy
    return apiKeyMemoryCache
  }
  if (legacy && invoke) {
    apiKeyMemoryCache = legacy
    await invoke('set_api_key', { apiKey: legacy })
    clearLegacyAuthStorage()
  }
  return apiKeyMemoryCache
}

export function getApiKey(): string {
  if (!apiKeyMemoryCache && !isTauriRuntime()) {
    apiKeyMemoryCache = readLegacyApiKey()
  }
  return apiKeyMemoryCache
}

export async function setApiKey(token: string): Promise<void> {
  const clean = String(token || '').trim()
  apiKeyMemoryCache = clean
  const invoke = await getInvokeApi()
  if (invoke) {
    if (clean) await invoke('set_api_key', { apiKey: clean })
    else await invoke('clear_api_key')
  } else if (typeof localStorage !== 'undefined') {
    try {
      if (clean) localStorage.setItem(API_KEY_STORAGE_KEY, clean)
      else localStorage.removeItem(API_KEY_STORAGE_KEY)
    } catch {}
  }
  clearLegacyAuthStorage()
}

export async function clearApiKey(): Promise<void> {
  apiKeyMemoryCache = ''
  const invoke = await getInvokeApi()
  if (invoke) await invoke('clear_api_key')
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(API_KEY_STORAGE_KEY)
    localStorage.removeItem(API_ACCOUNT_CACHE_KEY)
  }
}

export function __resetApiKeyMemoryCacheForTests(value = ''): void {
  apiKeyMemoryCache = value
}

export interface GatewayUser {
  id: string
  username: string
  email?: string
  displayName?: string
  affCode?: string
  aff_code?: string
  requestCount: number
  request_count: number
  plan: string
  balanceFlowers: number
  quota: number
  isMember: boolean
  membership: GatewayMembership | null
  permissions: Record<string, unknown>
  raw: Record<string, unknown>
}

export interface GatewayMembership {
  isMember: boolean
  source?: string
  planTitle?: string
  memberUntil?: string
}

export interface GatewayModelEntry {
  id: string
  label: string
  providerId: 'jiucaihezi'
  capability: 'text' | 'image' | 'video' | 'audio'
  channel?: string
  taskTypes?: string[]
}

export interface GatewayLedgerItem {
  id?: string
  type?: string
  title?: string
  amount?: number
  flowers?: number
  createdAt?: string
  [key: string]: unknown
}

export interface GatewayTopupOrder {
  order_id?: string
  orderId?: string
  pay_payload?: Record<string, unknown>
  payPayload?: Record<string, unknown>
  payment?: {
    qr_image_url?: string
    qrImageUrl?: string
    scan_url?: string
    scanUrl?: string
    pay_url?: string
    payUrl?: string
  }
  pay_url?: string
  payUrl?: string
  qr_image_url?: string
  qrImageUrl?: string
  qr_url?: string
  qrUrl?: string
  scan_url?: string
  scanUrl?: string
  url_qrcode?: string
  [key: string]: unknown
}

export function getGatewayBaseUrl(): string {
  return DEFAULT_GATEWAY_BASE_URL
}

export function clearLegacyAuthStorage(): void {
  if (typeof localStorage === 'undefined') return
  for (const key of LEGACY_AUTH_STORAGE_KEYS) localStorage.removeItem(key)
}

export function buildGatewayHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra }
  const token = getGatewaySessionToken()
  if (token) {
    headers.Authorization = `Bearer ${token}`
    headers['x-api-key'] = token
  }
  return headers
}

export function buildGatewayJsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return buildGatewayHeaders({ 'Content-Type': 'application/json', ...extra })
}

export async function gatewayFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${getGatewayBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
  const headers = {
    ...buildGatewayHeaders(),
    ...(init.headers ? headersToObject(init.headers) : {}),
  }
  return safeFetch(url, { ...init, headers })
}

export async function gatewayJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const hasBody = init.body != null
  const headers = {
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...buildGatewayHeaders(),
    ...(init.headers ? headersToObject(init.headers) : {}),
  }
  const res = await gatewayFetch(path, { ...init, headers })
  const text = await res.text()
  const payload = text ? parseJson(text) : {}
  if (!res.ok) {
    const message = extractGatewayError(payload) || text || `Gateway ${res.status}`
    throw new Error(message)
  }
  return payload as T
}

export async function gatewayLogin(payload: Record<string, unknown>): Promise<{ user: GatewayUser; apiKey: string; baseUrl: string }> {
  const data = await gatewayJson<any>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  const apiKey = extractGatewayApiKey(data)
  if (!apiKey) throw new Error('登录响应缺少 API Key，请稍后重试')
  await setApiKey(apiKey)
  const user = normalizeGatewayUser(extractGatewayUserPayload(data))
  cacheGatewayAccount(user)
  return { user, apiKey, baseUrl: extractGatewayBaseUrl(data) }
}

export async function gatewayRegister(payload: Record<string, unknown>): Promise<{ user: GatewayUser; sessionToken: string }> {
  const data = await gatewayJson<any>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  const sessionToken = extractGatewaySessionToken(data)
  if (sessionToken) await setGatewaySessionToken(sessionToken)
  const user = normalizeGatewayUser(extractGatewayUserPayload(data))
  cacheGatewayAccount(user)
  return { user, sessionToken }
}

export async function gatewayLogout(): Promise<void> {
  try {
    await gatewayJson('/auth/logout', { method: 'POST' })
  } finally {
    await clearGatewaySession()
  }
}

export async function gatewaySession(): Promise<{ authenticated: boolean; user: GatewayUser | null }> {
  const data = await gatewayJson<any>('/auth/session')
  const authenticated = Boolean(data?.authenticated ?? data?.success ?? data?.data?.authenticated)
  const user = authenticated ? normalizeGatewayUser(extractGatewayUserPayload(data)) : null
  if (user) cacheGatewayAccount(user)
  return { authenticated, user }
}

export async function gatewayMe(): Promise<GatewayUser> {
  const data = await gatewayJson<any>('/api/me')
  const user = normalizeGatewayUser(extractGatewayUserPayload(data))
  cacheGatewayAccount(user)
  return user
}

export async function gatewayCheckinStatus(): Promise<any> {
  return gatewayJson('/api/me/checkin')
}

export async function gatewayCheckin(): Promise<any> {
  return gatewayJson('/api/me/checkin', { method: 'POST' })
}

export async function gatewayRedeem(key: string): Promise<any> {
  return gatewayJson('/api/me/redeem', {
    method: 'POST',
    body: JSON.stringify({ key }),
  })
}

export async function gatewayLedger(): Promise<GatewayLedgerItem[]> {
  const data = await gatewayJson<any>('/api/me/ledger')
  return normalizeItems(data) as GatewayLedgerItem[]
}

export async function gatewayUsage(): Promise<GatewayLedgerItem[]> {
  const data = await gatewayJson<any>('/api/me/usage')
  return normalizeItems(data) as GatewayLedgerItem[]
}

export async function gatewayAffiliate(): Promise<any> {
  return gatewayJson('/api/me/affiliate')
}

export async function gatewaySubscribeMembership(): Promise<GatewayUser> {
  const data = await gatewayJson<any>('/api/me/membership/subscribe', { method: 'POST' })
  const user = normalizeGatewayUser(data?.data?.account || data?.account || data?.data || data)
  cacheGatewayAccount(user)
  return user
}

export async function gatewayModels(): Promise<GatewayModelEntry[]> {
  const data = await gatewayJson<any>('/v1/models')
  return normalizeGatewayModels(data)
}

export async function gatewayCreateTopupOrder(body: Record<string, unknown>): Promise<GatewayTopupOrder> {
  const data = await gatewayJson<any>('/api/topup/create-order', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return normalizeGatewayTopupOrder(data?.data || data)
}

export async function gatewayTopupOrderStatus(orderId: string): Promise<any> {
  return gatewayJson(`/api/topup/order-status?orderId=${encodeURIComponent(orderId)}`)
}

export async function gatewaySendVerificationCode(email: string): Promise<any> {
  return gatewayJson(`/api/verification?email=${encodeURIComponent(email)}`)
}

export function loadCachedGatewayAccount(): GatewayUser | null {
  if (typeof localStorage === 'undefined') return null
  if (!getGatewaySessionToken()) return null
  try {
    const raw = localStorage.getItem(API_ACCOUNT_CACHE_KEY)
    return raw ? normalizeGatewayUser(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function extractGatewaySessionToken(payload: any): string {
  return String(
    payload?.sessionToken
    || payload?.session_token
    || payload?.token
    || payload?.accessToken
    || payload?.access_token
    || payload?.data?.sessionToken
    || payload?.data?.session_token
    || payload?.data?.token
    || payload?.data?.accessToken
    || payload?.data?.access_token
    || payload?.session?.id
    || payload?.data?.session?.id
    || ''
  ).trim()
}

export function extractGatewayApiKey(payload: any): string {
  return String(
    payload?.api_key
    || payload?.apiKey
    || payload?.key
    || payload?.data?.api_key
    || payload?.data?.apiKey
    || payload?.data?.key
    || ''
  ).trim()
}

export function extractGatewayBaseUrl(payload: any): string {
  return String(
    payload?.base_url
    || payload?.baseUrl
    || payload?.data?.base_url
    || payload?.data?.baseUrl
    || `${DEFAULT_API_BASE_URL}/v1`
  ).trim()
}

export function extractGatewayUserPayload(payload: any): any {
  return firstObject(
    payload?.user,
    payload?.account,
    payload?.data?.account,
    payload?.data?.user,
    payload?.data,
    payload,
  ) || {}
}

export function normalizeGatewayUser(payload: any): GatewayUser {
  const source = firstObject(payload?.account, payload?.user, payload?.data, payload)
  const membership = normalizeGatewayMembership(firstObject(source?.membership, payload?.membership))
  const affCode = String(
    source?.affCode
    || source?.aff_code
    || source?.inviteCode
    || source?.invite_code
    || payload?.affCode
    || payload?.aff_code
    || ''
  ).trim()
  const requestCount = firstNumber(
    source?.requestCount,
    source?.request_count,
    payload?.requestCount,
    payload?.request_count,
  )
  const balanceFlowers = firstNumber(
    source?.balanceFlowers,
    source?.balance_flowers,
    source?.flowers,
    source?.quota && quotaToFlowers(source.quota),
    payload?.balanceFlowers,
    payload?.balance_flowers,
    payload?.quota && quotaToFlowers(payload.quota),
  )
  const quota = firstNumber(
    source?.quota,
    payload?.quota,
    flowersToQuota(balanceFlowers),
  )
  const permissions = firstObject(source?.permissions, payload?.permissions) || {}
  const isMember = Boolean(
    source?.isMember
    ?? source?.is_member
    ?? membership?.isMember
    ?? false
  )

  return {
    id: String(source?.id || source?.userId || source?.user_id || ''),
    username: String(source?.username || source?.name || source?.displayName || source?.email || '韭菜盒子用户'),
    email: source?.email ? String(source.email) : undefined,
    displayName: source?.displayName || source?.display_name || source?.name,
    affCode,
    aff_code: affCode,
    requestCount,
    request_count: requestCount,
    plan: String(source?.plan || payload?.plan || 'free'),
    balanceFlowers,
    quota,
    isMember,
    membership,
    permissions,
    raw: source || {},
  }
}

function normalizeGatewayMembership(input: any): GatewayMembership | null {
  if (!input || typeof input !== 'object') return null
  return {
    isMember: Boolean(input.isMember ?? input.is_member ?? false),
    source: input.source ? String(input.source) : undefined,
    planTitle: input.planTitle || input.plan_title ? String(input.planTitle || input.plan_title) : undefined,
    memberUntil: input.memberUntil || input.member_until || input.expiresAt || input.expires_at
      ? String(input.memberUntil || input.member_until || input.expiresAt || input.expires_at)
      : undefined,
  }
}

export function normalizeGatewayModels(payload: any): GatewayModelEntry[] {
  const raw = normalizeItems(payload)
  return raw
    .map((item: any) => {
      const id = String(item?.id || item?.model || item?.name || '').trim()
      if (!id) return null
      if (isRemovedMediaModelId(id)) return null
      const taskTypes = Array.isArray(item?.taskTypes)
        ? item.taskTypes.map((value: unknown) => String(value))
        : Array.isArray(item?.task_types)
          ? item.task_types.map((value: unknown) => String(value))
          : []
      const capability = inferGatewayModelCapability(id, taskTypes, String(item?.channel || ''))
      if (capability !== 'text' && !isMediaModelEnabled(id)) return null
      return {
        id,
        label: String(item?.label || item?.name || item?.displayName || item?.display_name || id),
        providerId: 'jiucaihezi' as const,
        capability,
        channel: item?.channel ? String(item.channel) : undefined,
        taskTypes,
      }
    })
    .filter(Boolean) as GatewayModelEntry[]
}

export function normalizeGatewayTopupOrder(input: any): GatewayTopupOrder {
  const order = firstObject(input?.data, input) || {}
  const payPayload = firstObject(order?.pay_payload, order?.payPayload) || {}
  const payloadData = firstObject(payPayload?.data) || {}
  const nestedPayloadData = firstObject(payloadData?.data) || {}
  const payment = firstObject(order?.payment, payPayload?.payment, payloadData?.payment, nestedPayloadData?.payment) || {}
  const qrImageUrl = firstString(
    payment?.qr_image_url,
    payment?.qrImageUrl,
    order?.qr_image_url,
    order?.qrImageUrl,
    order?.url_qrcode,
    payPayload?.qr_image_url,
    payPayload?.qrImageUrl,
    payloadData?.qr_image_url,
    payloadData?.qrImageUrl,
    nestedPayloadData?.qr_image_url,
    nestedPayloadData?.qrImageUrl,
    payPayload?.url_qrcode,
    payloadData?.url_qrcode,
    nestedPayloadData?.url_qrcode
  )
  const scanUrl = firstString(
    payment?.scan_url,
    payment?.scanUrl,
    order?.scan_url,
    order?.scanUrl,
    payPayload?.scan_url,
    payPayload?.scanUrl,
    payloadData?.scan_url,
    payloadData?.scanUrl,
    nestedPayloadData?.scan_url,
    nestedPayloadData?.scanUrl,
    order?.code_url,
    payPayload?.qr_url,
    payloadData?.qr_url,
    nestedPayloadData?.qr_url,
    payPayload?.code_url,
    payloadData?.code_url,
    nestedPayloadData?.code_url,
    payPayload?.qrcode,
    payloadData?.qrcode,
    nestedPayloadData?.qrcode,
    payPayload?.qrCode,
    payloadData?.qrCode,
    nestedPayloadData?.qrCode
  )
  const payUrl = String(
    firstString(
      payment?.pay_url,
      payment?.payUrl,
      order?.pay_url,
      order?.payUrl,
      payPayload?.pay_url,
      payPayload?.payUrl,
      payloadData?.pay_url,
      payloadData?.payUrl,
      nestedPayloadData?.pay_url,
      nestedPayloadData?.payUrl,
      payPayload?.url,
      payloadData?.url,
      nestedPayloadData?.url,
      payPayload?.openUrl,
      payloadData?.openUrl,
      nestedPayloadData?.openUrl,
      qrImageUrl,
      scanUrl
    )
  ).trim()
  const qrUrl = qrImageUrl || scanUrl
  return {
    ...order,
    pay_payload: payPayload,
    payPayload,
    payment: {
      ...payment,
      qr_image_url: qrImageUrl || undefined,
      qrImageUrl: qrImageUrl || undefined,
      scan_url: scanUrl || undefined,
      scanUrl: scanUrl || undefined,
      pay_url: payUrl || undefined,
      payUrl: payUrl || undefined,
    },
    pay_url: payUrl || undefined,
    payUrl: payUrl || undefined,
    qr_image_url: qrImageUrl || undefined,
    qrImageUrl: qrImageUrl || undefined,
    scan_url: scanUrl || undefined,
    scanUrl: scanUrl || undefined,
    qr_url: qrUrl || undefined,
    qrUrl: qrUrl || undefined,
    url_qrcode: qrImageUrl || undefined,
  }
}

export function inferGatewayModelCapability(
  id: string,
  taskTypes: string[] = [],
  channel = '',
): GatewayModelEntry['capability'] {
  const text = `${id} ${channel} ${taskTypes.join(' ')}`.toLowerCase()
  if (/image|images|dall|gpt-image|grok.*image|flux|stable|sd2/.test(text)) return 'image'
  if (/video|videos|veo|grok-video|kling|runway|pika|luma|t8/.test(text)) return 'video'
  if (/audio|speech|voice|tts|suno|music|whisper/.test(text)) return 'audio'
  return 'text'
}

function cacheGatewayAccount(user: GatewayUser): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(API_ACCOUNT_CACHE_KEY, JSON.stringify(user))
}

function headersToObject(headers: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {}
  if (headers instanceof Headers) {
    headers.forEach((value, key) => { out[key] = value })
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) out[key] = value
  } else {
    Object.assign(out, headers)
  }
  return out
}

function normalizeItems(payload: any): any[] {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.items)) return payload.items
  if (Array.isArray(payload?.models)) return payload.models
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.data?.items)) return payload.data.items
  if (Array.isArray(payload?.data?.models)) return payload.data.models
  return []
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function extractGatewayError(payload: any): string {
  return String(
    payload?.error?.message
    || payload?.error
    || payload?.message
    || payload?.msg
    || ''
  )
}

function firstObject(...values: any[]): any {
  return values.find(value => value && typeof value === 'object' && !Array.isArray(value)) || null
}

function firstString(...values: any[]): string {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return ''
}

function firstNumber(...values: any[]): number {
  for (const value of values) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return 0
}

function flowersToQuota(flowers: number): number {
  return Math.max(0, Number(flowers || 0)) * 500000
}

function quotaToFlowers(quota: number): number {
  return Math.max(0, Math.floor(Number(quota || 0) / 500000))
}


// ─── 兼容别名（旧名字 → 新名字） ───
export const getGatewaySessionToken = getApiKey
export const setGatewaySessionToken = setApiKey
export const clearGatewaySession = clearApiKey
export const initSessionToken = initApiKey
export const DEFAULT_GATEWAY_BASE_URL = DEFAULT_API_BASE_URL
