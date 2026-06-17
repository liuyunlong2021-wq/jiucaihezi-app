const EDITOR_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const EXTERNAL_URL_PROTOCOLS = new Set([
  'http:',
  'https:',
  'mailto:',
  'alipay:',
  'alipays:',
  'weixin:',
  'weixinpay:',
])
const DOWNLOAD_PROTOCOLS = new Set(['https:', 'http:', 'asset:', 'blob:'])
const MEDIA_ATTACHMENT_PROTOCOLS = new Set(['https:', 'http:', 'blob:', 'asset:'])
const MAX_MEDIA_DATA_URL_LENGTH = 12 * 1024 * 1024
const CREATION_RESULT_HOST_PATTERNS = [
  /(^|\.)jiucaihezi\.studio$/i,
  /(^|\.)runninghub\.cn$/i,
  /(^|\.)runninghub\.ai$/i,
  /^rh-[a-z0-9-]+\.cos\.ap-beijing\.myqcloud\.com$/i,
  /^cdn\.sd2\.mengfactory\.cn$/i,
  /(^|\.)suno\.com$/i,
  /(^|\.)sunoapi\.org$/i,
  /(^|\.)x\.ai$/i,
  /(^|\.)openai\.com$/i,
  /(^|\.)oaidalleapiprodscus\.blob\.core\.windows\.net$/i,
  /(^|\.)aiproxy\.vip$/i,
  /(^|\.)soruxgpt\.com$/i,
  /(^|\.)innk\.cc$/i,
]

function parseUrl(input: string, defaultHttp = false): URL | null {
  const text = String(input || '').trim()
  if (!text) return null
  try {
    return new URL(text)
  } catch {
    if (!defaultHttp) return null
    try {
      return new URL(`https://${text}`)
    } catch {
      return null
    }
  }
}

export function normalizeEditorLinkUrl(input: string): string | null {
  const parsed = parseUrl(input, true)
  if (!parsed || !EDITOR_LINK_PROTOCOLS.has(parsed.protocol)) return null
  return parsed.href
}

export function isAllowedExternalUrl(input: string): boolean {
  const parsed = parseUrl(input)
  return Boolean(parsed && EXTERNAL_URL_PROTOCOLS.has(parsed.protocol))
}

export function isAllowedDownloadUrl(input: string): boolean {
  const parsed = parseUrl(input)
  return Boolean(parsed && DOWNLOAD_PROTOCOLS.has(parsed.protocol))
}

export function isAllowedMediaAttachmentUrl(input: string): boolean {
  const text = String(input || '').trim()
  if (/^data:(image|video|audio)\//i.test(text)) {
    if (text.length > MAX_MEDIA_DATA_URL_LENGTH) return false
    if (/^data:image\/svg\+xml/i.test(text)) return false
    return /^data:(image|video|audio)\/[a-z0-9.+-]+;base64,[a-z0-9+/]+={0,2}$/i.test(text)
  }
  const parsed = parseUrl(text)
  return Boolean(parsed && MEDIA_ATTACHMENT_PROTOCOLS.has(parsed.protocol))
}

export function isAllowedCreationResultUrl(input: string): boolean {
  const text = String(input || '').trim()
  if (/^data:(image|video|audio)\//i.test(text)) return isAllowedMediaAttachmentUrl(text)
  const parsed = parseUrl(text)
  if (!parsed) return false
  if (parsed.protocol !== 'https:') return false
  return CREATION_RESULT_HOST_PATTERNS.some(pattern => pattern.test(parsed.hostname))
}

export function isAllowedCreationPollUrl(input: string): boolean {
  const text = String(input || '').trim()
  if (!text || !text.startsWith('/') || text.startsWith('//')) return false
  if (text.includes('..') || /[\s\\]/.test(text)) return false
  try {
    const parsed = new URL(text, 'https://gateway.local')
    if (parsed.origin !== 'https://gateway.local') return false
    const isRhTaskPoll = /^\/rh\/tasks\/[A-Za-z0-9._:-]+$/.test(parsed.pathname) &&
      (parsed.search === '' || parsed.search === '?ai_app=true')
    if (isRhTaskPoll) return true
    return /^\/api\/creations\/tasks\/[A-Za-z0-9._:-]+$/.test(parsed.pathname) ||
      /^\/api\/seedance\/v1\/videos\/[A-Za-z0-9._:-]+$/.test(parsed.pathname) ||
      /^\/v1\/images\/generations\/[A-Za-z0-9._:-]+$/.test(parsed.pathname) ||
      /^\/v1\/audio\/generations\/[A-Za-z0-9._:-]+$/.test(parsed.pathname) ||
      /^\/v1\/videos\/[A-Za-z0-9._:-]+$/.test(parsed.pathname) ||
      /^\/v1\/video\/generations\/[A-Za-z0-9._:-]+$/.test(parsed.pathname) ||
      /^\/v2\/videos\/generations\/[A-Za-z0-9._:-]+$/.test(parsed.pathname) ||
      /^\/suno\/fetch\/[A-Za-z0-9._:-]+$/.test(parsed.pathname) ||
      /^\/mj\/task\/[A-Za-z0-9._:-]+\/fetch$/.test(parsed.pathname)
  } catch {
    return false
  }
}
