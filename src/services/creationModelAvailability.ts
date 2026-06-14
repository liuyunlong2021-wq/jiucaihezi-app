import { DEFAULT_API_BASE_URL, buildGatewayHeaders } from './newApiClient'
import { safeFetch } from '@/utils/httpClient'

export type CreationModelAvailabilityStatus = 'enabled' | 'degraded' | 'disabled'

export interface CreationModelAvailability {
  id: string
  status: CreationModelAvailabilityStatus
  reason?: string
  lastSuccessAt?: string
  estimatedWaitSeconds?: number
}

interface RawAvailabilityItem {
  id?: unknown
  model?: unknown
  name?: unknown
  status?: unknown
  available?: unknown
  enabled?: unknown
  reason?: unknown
  message?: unknown
  last_success_at?: unknown
  lastSuccessAt?: unknown
  estimated_wait_seconds?: unknown
  estimatedWaitSeconds?: unknown
}

export function normalizeCreationModelAvailability(payload: unknown): CreationModelAvailability[] {
  const items = extractAvailabilityItems(payload)
  const normalized: CreationModelAvailability[] = []

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const raw = item as RawAvailabilityItem
    const id = String(raw.id || raw.model || raw.name || '').trim()
    if (!id) continue

    normalized.push({
      id,
      status: normalizeAvailabilityStatus(raw),
      reason: firstString(raw.reason, raw.message),
      lastSuccessAt: firstString(raw.lastSuccessAt, raw.last_success_at),
      estimatedWaitSeconds: firstFiniteNumber(raw.estimatedWaitSeconds, raw.estimated_wait_seconds),
    })
  }

  return normalized
}

export async function fetchCreationModelAvailability(): Promise<CreationModelAvailability[]> {
  const res = await safeFetch(`${DEFAULT_API_BASE_URL}/api/creation/models`, {
    method: 'GET',
    headers: buildGatewayHeaders(),
  })
  if (!res.ok) throw new Error(`模型可用性接口请求失败 (${res.status})`)
  const payload = await res.json()
  return normalizeCreationModelAvailability(payload)
}

function extractAvailabilityItems(payload: unknown): RawAvailabilityItem[] {
  if (Array.isArray(payload)) return payload as RawAvailabilityItem[]
  if (!payload || typeof payload !== 'object') return []
  const source = payload as any
  for (const key of ['models', 'items', 'data']) {
    if (Array.isArray(source[key])) return source[key]
    if (Array.isArray(source[key]?.models)) return source[key].models
    if (Array.isArray(source[key]?.items)) return source[key].items
  }
  return []
}

function normalizeAvailabilityStatus(item: RawAvailabilityItem): CreationModelAvailabilityStatus {
  const rawStatus = String(item.status || '').trim().toLowerCase()
  if (rawStatus === 'disabled' || rawStatus === 'unavailable' || rawStatus === 'offline') return 'disabled'
  if (rawStatus === 'degraded' || rawStatus === 'maintenance' || rawStatus === 'limited') return 'degraded'
  if (rawStatus === 'enabled' || rawStatus === 'available' || rawStatus === 'online') return 'enabled'

  if (item.enabled === false || item.available === false) return 'disabled'
  if (item.enabled === true || item.available === true) return 'enabled'
  return 'enabled'
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return undefined
}

function firstFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const num = Number(value)
    if (Number.isFinite(num)) return num
  }
  return undefined
}
