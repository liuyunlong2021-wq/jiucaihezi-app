export const NEW_API_REQUEST_MAX_BYTES = 128 * 1024 * 1024

export class NewApiRequestTooLargeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NewApiRequestTooLargeError'
  }
}

const MIME_ALIASES: Readonly<Record<string, string>> = {
  'video/quicktime': 'video/mov',
  'video/x-msvideo': 'video/avi',
  'video/x-ms-wmv': 'video/wmv',
  'video/x-flv': 'video/flv',
  'audio/x-wav': 'audio/wav',
  'image/jpg': 'image/jpeg',
}
const EXTENSION_MIME_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  png: 'image/png',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  txt: 'text/plain',
  mov: 'video/mov',
  mpeg: 'video/mpeg',
  mp4: 'video/mp4',
  mpg: 'video/mpg',
  avi: 'video/avi',
  wmv: 'video/wmv',
  mpegps: 'video/mpegps',
  flv: 'video/flv',
}

interface NewApiAttachment {
  name: string
  mime: string
  value: string
}

function canonicalMime(value: string): string {
  const mime = String(value || '').trim().toLowerCase().split(';', 1)[0]
  return MIME_ALIASES[mime] || mime
}

function dataUrlMime(value: string): string {
  const dataUrl = String(value || '')
  if (!dataUrl.toLowerCase().startsWith('data:')) return ''
  const comma = dataUrl.indexOf(',')
  const headerEnd = comma < 0 ? dataUrl.length : comma
  const semicolon = dataUrl.indexOf(';', 5)
  const mimeEnd = semicolon >= 0 && semicolon < headerEnd ? semicolon : headerEnd
  return dataUrl.slice(5, mimeEnd)
}

export function resolveNewApiAttachmentMime(input: { name: string; mime?: string; value?: string }): string {
  const extension = String(input.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || ''
  const declared = canonicalMime(input.mime || '')
  const embedded = canonicalMime(dataUrlMime(input.value || ''))
  if (declared && declared !== 'application/octet-stream') return declared
  return EXTENSION_MIME_TYPES[extension] || embedded || declared || 'application/octet-stream'
}

export function rewriteNewApiDataUrlMime(value: string, mime: string): string {
  if (!value.toLowerCase().startsWith('data:')) return value
  const comma = value.indexOf(',')
  if (comma < 0) throw new Error('附件数据格式无效：data URL 缺少逗号分隔符。')
  const semicolon = value.indexOf(';', 5)
  const mimeEnd = semicolon >= 0 && semicolon < comma ? semicolon : comma
  if (value.slice(5, mimeEnd) === mime) return value
  return `data:${mime}${value.slice(mimeEnd)}`
}

export function normalizeNewApiAttachment<T extends NewApiAttachment>(attachment: T): T {
  const mime = resolveNewApiAttachmentMime(attachment)
  return {
    ...attachment,
    mime,
    value: rewriteNewApiDataUrlMime(attachment.value, mime),
  }
}

export function serializeNewApiRequest(request: unknown, maxBytes = NEW_API_REQUEST_MAX_BYTES): string {
  const body = JSON.stringify(request)
  if (body === undefined) throw new Error('最终请求体无法序列化。')
  const bytes = utf8ByteLength(body)
  if (bytes > maxBytes) {
    throw new NewApiRequestTooLargeError(`最终请求体 ${bytes} 字节超过 ${maxBytes} 字节限制，请移除部分附件或历史后重试。`)
  }
  return body
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        index += 1
      } else bytes += 3
    } else bytes += 3
  }
  return bytes
}

export async function sendNewApiRequest(
  request: unknown,
  send: (body: string) => Promise<Response>,
  maxBytes = NEW_API_REQUEST_MAX_BYTES,
): Promise<Response> {
  return send(serializeNewApiRequest(request, maxBytes))
}
