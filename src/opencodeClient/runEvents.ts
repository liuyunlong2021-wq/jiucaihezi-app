export function normalizeOpenCodeSessionStatus(properties: Record<string, any>): string {
  const status = properties.status
  if (status && typeof status === 'object') return String(status.type || '')
  if (typeof status === 'string') return status
  return ''
}

export function isOpenCodeRunCompleteEvent(type: string, properties: Record<string, any>): boolean {
  if (type === 'session.idle') return true
  if (type === 'session.next.idle') return true
  if (type === 'session.finished') return true
  if (type === 'session.next.finished') return true
  if (type === 'session.closed') return true
  if (type === 'session.next.closed') return true
  if (type === 'session.status') {
    return normalizeOpenCodeSessionStatus(properties) === 'idle'
  }
  // 🔧 Phase A: 泛化兜底 — 任何 session.* 事件如果携带 status===idle，视为完成
  if (type.startsWith('session.') && normalizeOpenCodeSessionStatus(properties) === 'idle') {
    return true
  }
  return false
}

export function isOpenCodeRunErrorEvent(type: string, properties: Record<string, any>): boolean {
  if (type === 'session.error') return true
  if (type !== 'session.status') return false
  return normalizeOpenCodeSessionStatus(properties) === 'error'
}

function parseJsonObject(value: unknown): Record<string, any> | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

function openCodeErrorMessage(value: any): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  if (typeof value.data?.message === 'string' && value.data.message) return value.data.message
  if (typeof value.message === 'string' && value.message) return value.message
  if (typeof value.error?.message === 'string' && value.error.message) return value.error.message
  if (typeof value.status?.message === 'string' && value.status.message) return value.status.message

  const responseBody = value.data?.responseBody ?? value.responseBody
  const parsedBody = parseJsonObject(responseBody)
  const bodyMessage = parsedBody?.error?.message ?? parsedBody?.message
  if (typeof bodyMessage === 'string' && bodyMessage) return bodyMessage

  if (typeof value.name === 'string' && value.name) return value.name
  return undefined
}

export function getOpenCodeRunErrorDetail(type: string, properties: Record<string, any>): string {
  const status = properties.status && typeof properties.status === 'object' ? properties.status : undefined
  const value = properties.error ?? status?.error ?? status?.message ?? properties
  const message = openCodeErrorMessage(value)
  if (message) return message
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return String(value)
  }
}
