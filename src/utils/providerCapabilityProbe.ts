import { normalizeApiHost } from './providerConfig'

export interface ProviderModelCapability {
  id: string
  supportsReasoningEffort: boolean
  supportsVisionLikely: boolean
}

export interface ProviderCapabilityProbe {
  providerId: string
  apiHost: string
  checkedAt: number
  supportsModelsEndpoint: boolean
  supportsChatCompletionsStream: boolean
  supportsResponses: boolean
  modelCount: number
  models: Record<string, ProviderModelCapability>
  lastError?: string
}

export interface BuildProviderCapabilityProbeInput {
  providerId: string
  apiHost: string
  modelIds: string[]
  modelsOk: boolean
  streamOk: boolean
  responsesOk: boolean
  checkedAt?: number
  error?: string
}

export interface ProbeProviderCapabilitiesInput {
  providerId: string
  apiHost: string
  apiKey: string
  testModel: string
  fetcher?: typeof fetch
  checkedAt?: number
  timeoutMs?: number
}

export interface RunAndCacheProviderCapabilityProbeInput extends ProbeProviderCapabilitiesInput {
  store?: KeyValueStore
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'> | Map<string, string>

const CACHE_TTL_MS = 24 * 60 * 60 * 1000

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
  if (
    typeof localStorage !== 'undefined'
    && typeof localStorage.getItem === 'function'
    && typeof localStorage.setItem === 'function'
  ) return localStorage
  return new Map<string, string>()
}

export function providerCapabilityCacheKey(providerId: string, apiHost: string): string {
  return `jcProviderCapability:${String(providerId || 'unknown')}:${normalizeApiHost(apiHost)}`
}

export function buildProviderCapabilityProbe(input: BuildProviderCapabilityProbeInput): ProviderCapabilityProbe {
  const modelIds = Array.from(new Set((input.modelIds || []).map(id => String(id || '').trim()).filter(Boolean)))
  const models: Record<string, ProviderModelCapability> = {}
  for (const id of modelIds) {
    models[id] = {
      id,
      supportsReasoningEffort: isReasoningModel(id),
      supportsVisionLikely: isVisionLikelyModel(id),
    }
  }

  return {
    providerId: String(input.providerId || 'unknown'),
    apiHost: normalizeApiHost(input.apiHost),
    checkedAt: input.checkedAt || Date.now(),
    supportsModelsEndpoint: Boolean(input.modelsOk),
    supportsChatCompletionsStream: Boolean(input.streamOk),
    supportsResponses: Boolean(input.responsesOk),
    modelCount: modelIds.length,
    models,
    lastError: input.error ? String(input.error).slice(0, 240) : undefined,
  }
}

export function saveProviderCapabilityProbe(
  probe: ProviderCapabilityProbe,
  store: KeyValueStore = getStorage(),
): void {
  writeStore(store, providerCapabilityCacheKey(probe.providerId, probe.apiHost), JSON.stringify(probe))
}

export function getCachedProviderCapabilityProbe(
  providerId: string,
  apiHost: string,
  store: KeyValueStore = getStorage(),
  now = Date.now(),
): ProviderCapabilityProbe | null {
  const raw = readStore(store, providerCapabilityCacheKey(providerId, apiHost))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ProviderCapabilityProbe
    if (!parsed || typeof parsed !== 'object') return null
    if (now - Number(parsed.checkedAt || 0) > CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

export function mergeProviderCapabilityProbe(
  previous: ProviderCapabilityProbe | null | undefined,
  next: ProviderCapabilityProbe,
): ProviderCapabilityProbe {
  if (!previous) return next
  return {
    ...next,
    supportsModelsEndpoint: next.supportsModelsEndpoint || previous.supportsModelsEndpoint,
    supportsChatCompletionsStream: next.supportsChatCompletionsStream || previous.supportsChatCompletionsStream,
    supportsResponses: next.supportsResponses,
    modelCount: next.modelCount || previous.modelCount,
    models: next.modelCount > 0 ? next.models : previous.models,
    lastError: next.lastError || previous.lastError,
  }
}

export async function probeProviderCapabilities(input: ProbeProviderCapabilitiesInput): Promise<ProviderCapabilityProbe> {
  const apiHost = normalizeApiHost(input.apiHost)
  const fetcher = input.fetcher || fetch
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${input.apiKey}`,
  }
  const modelIds: string[] = []
  let modelsOk = false
  let streamOk = false
  let responsesOk = false
  let lastError = ''

  try {
    const res = await fetchWithTimeout(fetcher, `${apiHost}/v1/models`, { method: 'GET', headers }, input.timeoutMs)
    modelsOk = res.ok
    if (res.ok) {
      const payload = await res.json().catch(() => ({}))
      for (const item of Array.isArray((payload as any)?.data) ? (payload as any).data : []) {
        const id = String(item?.id || '').trim()
        if (id) modelIds.push(id)
      }
    } else {
      if (res.status !== 401) lastError = `models ${res.status}`
    }
  } catch (err) {
    lastError = sanitizeProbeError(err, input.apiKey)
  }

  try {
    const res = await fetchWithTimeout(fetcher, `${apiHost}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: input.testModel,
        messages: [{ role: 'user', content: 'ping' }],
        stream: true,
        max_tokens: 8,
      }),
    }, input.timeoutMs)
    streamOk = res.ok
    if (!res.ok && !lastError) lastError = `chat ${res.status}`
  } catch (err) {
    if (!lastError) lastError = sanitizeProbeError(err, input.apiKey)
  }

  if (shouldProbeResponsesEndpoint(input.providerId)) {
    try {
      const res = await fetchWithTimeout(fetcher, `${apiHost}/v1/responses`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: input.testModel,
          input: 'ping',
          max_output_tokens: 8,
        }),
      }, input.timeoutMs)
      responsesOk = res.ok
      if (!res.ok && !lastError) lastError = `responses ${res.status}`
    } catch (err) {
      if (!lastError) lastError = sanitizeProbeError(err, input.apiKey)
    }
  }

  return buildProviderCapabilityProbe({
    providerId: input.providerId,
    apiHost,
    modelIds,
    modelsOk,
    streamOk,
    responsesOk,
    checkedAt: input.checkedAt,
    error: lastError,
  })
}

export async function runAndCacheProviderCapabilityProbe(
  input: RunAndCacheProviderCapabilityProbeInput,
): Promise<ProviderCapabilityProbe> {
  const store = input.store || getStorage()
  const previous = getCachedProviderCapabilityProbe(input.providerId, input.apiHost, store)
  const next = await probeProviderCapabilities(input)
  const merged = mergeProviderCapabilityProbe(previous, next)
  saveProviderCapabilityProbe(merged, store)
  return merged
}

function shouldProbeResponsesEndpoint(providerId: string): boolean {
  return String(providerId || '').trim() !== 'jiucaihezi'
}

async function fetchWithTimeout(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs = 8000,
): Promise<Response> {
  if (!timeoutMs || timeoutMs <= 0) return fetcher(url, init)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetcher(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function sanitizeProbeError(err: unknown, apiKey: string): string {
  let text = String((err as Error)?.message || err || 'probe failed')
  if (apiKey) text = text.replaceAll(apiKey, '[REDACTED_API_KEY]')
  return text
    .replace(/Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Authorization: Bearer [REDACTED_API_KEY]')
    .replace(/Bearer\s+(?:sk|jc|or|wr)-[A-Za-z0-9_\-]{12,}/gi, 'Bearer [REDACTED_API_KEY]')
    .replace(/\b(?:sk|jc|or|wr)-[A-Za-z0-9_\-]{20,}\b/gi, '[REDACTED_API_KEY]')
    .replace(/\beyJ[A-Za-z0-9_\-]{3,}\.[A-Za-z0-9_\-]{3,}\.[A-Za-z0-9_\-]{3,}\b/g, '[REDACTED_JWT]')
    .slice(0, 240)
}

function isReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return id === 'gpt-5.5' || id.includes('/gpt-5.5') || /^o[134](?:-|$)/.test(id)
}

function isVisionLikelyModel(modelId: string): boolean {
  const id = modelId.toLowerCase()
  if (/deepseek|qwen|kimi|mistral|mixtral|codex/.test(id)) return false
  return /gpt|claude|gemini|doubao|vision|image/.test(id)
}
