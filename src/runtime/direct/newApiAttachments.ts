export const NEW_API_REQUEST_MAX_BYTES = 128 * 1024 * 1024

const MIME_ALIASES: Readonly<Record<string, string>> = {
  'video/quicktime': 'video/mov',
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
  return String(value || '').match(/^data:([^;,]+)/i)?.[1] || ''
}

export function resolveNewApiAttachmentMime(input: { name: string; mime?: string; value?: string }): string {
  const extension = String(input.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || ''
  const declared = canonicalMime(input.mime || '')
  const embedded = canonicalMime(dataUrlMime(input.value || ''))
  if (declared && declared !== 'application/octet-stream') return declared
  if (embedded && embedded !== 'application/octet-stream') return embedded
  return EXTENSION_MIME_TYPES[extension] || declared || embedded || 'application/octet-stream'
}

export function rewriteNewApiDataUrlMime(value: string, mime: string): string {
  const match = String(value || '').match(/^data:[^;,]*(;base64),(.*)$/is)
  return match ? `data:${mime};base64,${match[2]}` : value
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
  const bytes = new TextEncoder().encode(body).byteLength
  if (bytes > maxBytes) {
    throw new Error(`最终请求体 ${bytes} 字节超过 ${maxBytes} 字节限制，请移除部分附件或历史后重试。`)
  }
  return body
}

export async function sendNewApiRequest(
  request: unknown,
  send: (body: string) => Promise<Response>,
  maxBytes = NEW_API_REQUEST_MAX_BYTES,
): Promise<Response> {
  return send(serializeNewApiRequest(request, maxBytes))
}
