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

function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::' || host === '::1' || host.startsWith('fc') || host.startsWith('fd')) return true
  if (/^fe[89ab]/.test(host)) return true

  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
}

export function isSafePublicHttpUrl(input: string): boolean {
  const parsed = parseUrl(input)
  return Boolean(
    parsed &&
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    !parsed.username &&
    !parsed.password &&
    !isPrivateNetworkHost(parsed.hostname)
  )
}

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
  const text = String(input || '').trim()
  if (!text) return false
  // data: / blob: / asset: 协议直接放行（asset:// 是 Tauri convertFileSrc 专用协议）
  if (/^(data|blob|asset):/i.test(text)) return true
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
  if (parsed.username || parsed.password) return false
  return !isPrivateNetworkHost(parsed.hostname)
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
