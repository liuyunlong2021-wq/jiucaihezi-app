const TRUNCATED_MARKERS = ['...[truncated]', '[truncated]']
const MAX_PERSISTED_RESULTS = 50
const MAX_PERSISTED_DATA_URL_LENGTH = 500
const LOCAL_MEDIA_REF_PATTERN = /^jc-media:file_[A-Za-z0-9_-]+$/

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

export function sanitizeCreationResults<T extends { url: string }>(
  results: unknown,
  options: { forStorage?: boolean; limit?: number } = {},
): T[] {
  if (!Array.isArray(results)) return []
  const limit = options.limit ?? MAX_PERSISTED_RESULTS
  const predicate = options.forStorage ? canPersistResultUrl : isRenderableResultUrl
  const safe: T[] = []

  for (const item of results) {
    if (!item || typeof item !== 'object') continue
    if ((item as { type?: unknown }).type === 'failed') {
      safe.push({ ...(item as T), url: '' })
      if (safe.length >= limit) break
      continue
    }
    const url = (item as { url?: unknown }).url
    if (!predicate(url)) continue
    safe.push({ ...(item as T), url: url.trim() })
    if (safe.length >= limit) break
  }

  return safe
}
import { isAllowedCreationResultUrl } from './urlSafety'
