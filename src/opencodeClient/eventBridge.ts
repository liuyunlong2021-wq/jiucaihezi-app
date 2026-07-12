import { fetchEventSource } from '@microsoft/fetch-event-source'
import type { Event } from '@opencode-ai/sdk/v2'

export type OpenCodeEventHandler = (event: Event) => void

export interface OpenCodeEventSubscription {
  close: () => void
}

export interface SubscribeOpenCodeEventsInput {
  baseUrl: string
  authorization: string
  directory?: string
  workspace?: string
  debug?: boolean
  onClose?: () => void
  onError?: (error: unknown) => void
}

const debugEventTypes = new Set<string>()

function getEventType(event: unknown): string {
  return String((event as any)?.type || (event as any)?.event || 'unknown')
}

function logEventSample(event: unknown): void {
  const env = (import.meta as any).env
  if (!env?.DEV) return
  const type = getEventType(event)
  if (debugEventTypes.has(type) || debugEventTypes.size >= 32) return
  debugEventTypes.add(type)
  const properties = (event as any)?.properties || {}
  console.info(
    '[JC OpenCode event]', type,
    'keys=' + (Object.keys(properties).join(',') || '-'),
    'session=' + (properties.sessionID || '-'),
    'message=' + (properties.assistantMessageID || properties.messageID || properties.part?.messageID || '-'),
    'part=' + (properties.partID || properties.part?.id || '-'),
    'tool=' + (properties.tool || properties.name || properties.part?.tool || properties.part?.name || '-'),
    'delta=' + (typeof properties.delta === 'string'),
  )
}

function normalizeEvent(rawData: string): Event | null {
  if (!rawData) return null
  let parsed: unknown
  try { parsed = JSON.parse(rawData) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>
  if (obj.syncEvent && typeof obj.syncEvent === 'object') {
    const se = obj.syncEvent as Record<string, unknown>
    return { type: String(se.type || '').replace(/\.1$/, ''), properties: (se.data as Record<string, unknown>) || {} } as unknown as Event
  }
  if (obj.properties && typeof obj.properties === 'object') return obj as unknown as Event
  return { type: '', properties: obj } as unknown as Event
}

export async function subscribeOpenCodeEvents(
  handler: OpenCodeEventHandler,
  input: SubscribeOpenCodeEventsInput,
): Promise<OpenCodeEventSubscription> {
  const { baseUrl, authorization, directory, workspace } = input
  const controller = new AbortController()
  const params = new URLSearchParams()
  if (directory) params.set('directory', directory)
  if (workspace) params.set('workspace', workspace)
  const url = baseUrl.replace(/\/$/, '') + '/event?' + params.toString()

  // 指数退避重连
  let retryDelay = 1000
  const MAX_RETRY_DELAY = 30_000
  let lastEventTime = Date.now()

  void (async () => {
    await fetchEventSource(url, {
      headers: { Authorization: authorization, Accept: 'text/event-stream' },
      signal: controller.signal,
      openWhenHidden: true,
      onopen: async (response) => {
        if (!response.ok) throw new Error('OpenCode SSE HTTP ' + response.status)
        retryDelay = 1000
        lastEventTime = Date.now()
      },
      onmessage: (msg) => {
        lastEventTime = Date.now()
        const event = normalizeEvent(msg.data)
        if (!event) return
        if (input.debug) logEventSample(event)
        handler(event)
      },
      onerror: (err) => {
        if (controller.signal.aborted) throw err
        const silent = ((Date.now() - lastEventTime) / 1000).toFixed(0)
        console.warn('[OpenCode SSE] 重连, 静默' + silent + 's, ' + (retryDelay / 1000).toFixed(0) + 's后', err instanceof Error ? err.message : err)
        input.onError?.(err)
        const delay = retryDelay
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY)
        return delay
      },
      onclose: () => {
        if (!controller.signal.aborted) input.onClose?.()
      },
      fetch: (inputUrl, init) => fetch(inputUrl, { ...init, cache: 'no-store' }),
    })
  })()

  return { close() { controller.abort() } }
}
