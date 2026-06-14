const TRUNCATED_MARKERS = ['...[truncated]', '[truncated]']
const MAX_PERSISTED_RESULTS = 50
const MAX_PERSISTED_DATA_URL_LENGTH = 500
const LOCAL_MEDIA_REF_PATTERN = /^jc-media:file_[A-Za-z0-9_-]+$/
const RESULT_TYPES = new Set(['image', 'video', 'audio', 'text', 'failed', 'unknown'])

function hasTruncatedMarker(value: string) {
  return TRUNCATED_MARKERS.some(marker => value.includes(marker))
}

function isValidBase64DataUrl(value: string) {
  const marker = ';base64,'
  const markerIndex = value.indexOf(marker)
  if (markerIndex < 0 || !value.startsWith('data:')) return false
  const mime = value.slice(5, markerIndex)
  const body = value.slice(markerIndex + marker.length)
  if (!mime.includes('/') || !body) return false
  if (/^image\/svg\+xml$/i.test(mime)) return false
  return /^[A-Za-z0-9+/]+={0,2}$/.test(body)
}

export function isRenderableResultUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  const value = url.trim()
  if (!value || hasTruncatedMarker(value)) return false
  if (LOCAL_MEDIA_REF_PATTERN.test(value)) return true
  if (value.startsWith('data:')) return isValidBase64DataUrl(value)
  return isAllowedCreationResultUrl(value)
}

export function canPersistResultUrl(url: unknown): url is string {
  if (!isRenderableResultUrl(url)) return false
  if (url.startsWith('data:') && url.length > MAX_PERSISTED_DATA_URL_LENGTH) return false
  return true
}

function stringField(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['message', 'prompt', 'text', 'content', 'url']) {
      if (typeof record[key] === 'string') return record[key] as string
    }
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return undefined
}

export function normalizeCreationTextField(value: unknown, fallback = ''): string {
  return stringField(value) || fallback
}

function normalizedType(value: unknown): string {
  return typeof value === 'string' && RESULT_TYPES.has(value) ? value : 'unknown'
}

function normalizedTimestamp(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function safeOriginalUrl(value: unknown): string | undefined {
  return isRenderableResultUrl(value) ? value.trim() : undefined
}

function normalizeResult<T extends { url: string }>(
  item: Record<string, unknown>,
  url: string,
  fallbackTs: number,
): T {
  const normalized: Record<string, unknown> = {
    url,
    type: normalizedType(item.type),
    content: stringField(item.content) || '',
    model: stringField(item.model) || 'unknown',
    task: stringField(item.task) || normalizedType(item.type),
    ts: normalizedTimestamp(item.ts, fallbackTs),
  }
  const taskId = stringField(item.taskId)
  const errorMsg = stringField(item.errorMsg)
  const originalUrl = safeOriginalUrl(item.originalUrl)
  if (taskId) normalized.taskId = taskId
  if (errorMsg) normalized.errorMsg = errorMsg
  if (originalUrl) normalized.originalUrl = originalUrl
  return normalized as T
}

export function sanitizeCreationResults<T extends { url: string }>(
  results: unknown,
  options: { forStorage?: boolean; limit?: number; now?: number } = {},
): T[] {
  if (!Array.isArray(results)) return []
  const limit = options.limit ?? MAX_PERSISTED_RESULTS
  const predicate = options.forStorage ? canPersistResultUrl : isRenderableResultUrl
  const fallbackTs = options.now ?? Date.now()
  const safe: T[] = []

  for (const item of results) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (record.type === 'failed') {
      safe.push(normalizeResult<T>(record, '', fallbackTs))
      if (safe.length >= limit) break
      continue
    }
    const url = record.url
    if (!predicate(url)) continue
    safe.push(normalizeResult<T>(record, url.trim(), fallbackTs))
    if (safe.length >= limit) break
  }

  return safe
}
import { isAllowedCreationResultUrl } from './urlSafety'
