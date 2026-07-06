import type { OpencodeClient, Event } from '@opencode-ai/sdk/v2'

export type OpenCodeEventHandler = (event: Event) => void

export interface OpenCodeEventSubscription {
  close: () => void
}

export interface SubscribeOpenCodeEventsInput {
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
    `[JC OpenCode event] ${type}`,
    `keys=${Object.keys(properties).join(',') || '-'}`,
    `session=${properties.sessionID || '-'}`,
    `message=${properties.assistantMessageID || properties.messageID || properties.part?.messageID || '-'}`,
    `part=${properties.partID || properties.part?.id || '-'}`,
    `tool=${properties.tool || properties.name || properties.part?.tool || properties.part?.name || '-'}`,
    `delta=${typeof properties.delta === 'string'}`,
  )
}

function normalizeEvent(event: unknown): unknown {
  let value = event
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return { type: 'unknown', properties: { text: value } }
    }
  }

  const data = (value as any)?.data
  if (typeof data === 'string') {
    try {
      value = JSON.parse(data)
    } catch {
      return value
    }
  } else if (data && typeof data === 'object' && !(value as any)?.properties) {
    return {
      ...(value as any),
      properties: data,
    }
  }

  const syncEvent = (value as any)?.syncEvent
  if (syncEvent?.data && typeof syncEvent.data === 'object') {
    return {
      id: (value as any)?.id || syncEvent.id,
      type: String(syncEvent.type || '').replace(/\.1$/, ''),
      properties: syncEvent.data,
      syncEvent,
    }
  }

  return value
}

function resolveEventStream(result: unknown): AsyncIterable<unknown> {
  const stream = (result as any)?.stream || result
  if (!stream || typeof (stream as any)[Symbol.asyncIterator] !== 'function') {
    throw new Error('OpenCode event.subscribe() 未返回可订阅的事件流。')
  }
  return stream as AsyncIterable<unknown>
}

// ponytail: 照抄 OpenCode server-sdk.tsx — SSE 重连常量
// 来源: OpenCode packages/frontend/src/server-sdk.tsx L106-L117
const RECONNECT_DELAY_MS = 250
const HEARTBEAT_TIMEOUT_MS = 15_000

export async function subscribeOpenCodeEvents(
  client: OpencodeClient,
  handler: OpenCodeEventHandler,
  input: SubscribeOpenCodeEventsInput = {},
): Promise<OpenCodeEventSubscription> {
  const controller = new AbortController()
  let attempt = 0

  // ponytail: 照抄 OpenCode server-sdk.tsx L213-L220 — 重连循环
  void (async () => {
    while (!controller.signal.aborted) {
      attempt += 1
      let lastEventTime = Date.now()
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null

      try {
        const attemptController = new AbortController()
        const linkedAbort = () => {
          attemptController.abort()
          heartbeatTimer && clearInterval(heartbeatTimer)
        }
        controller.signal.addEventListener('abort', linkedAbort, { once: true })

        // ponytail: 照抄 OpenCode — client.event.subscribe()
        const subscribeOptions = { signal: attemptController.signal } as any
        const eventResult = await client.event.subscribe({
          directory: input.directory,
          workspace: input.workspace,
        }, subscribeOptions)
        const stream = resolveEventStream(eventResult)

        // ponytail: 照抄 OpenCode server-sdk.tsx L117 — 15s 心跳超时
        heartbeatTimer = setInterval(() => {
          if (Date.now() - lastEventTime > HEARTBEAT_TIMEOUT_MS) {
            attemptController.abort()
          }
        }, 5_000)

        for await (const rawEvent of stream) {
          lastEventTime = Date.now()
          const event = normalizeEvent(rawEvent)
          if (input.debug) logEventSample(event)
          handler(event as Event)
        }

        heartbeatTimer && clearInterval(heartbeatTimer)
        controller.signal.removeEventListener('abort', linkedAbort)

        if (!controller.signal.aborted) input.onClose?.()
        break
      } catch (error) {
        heartbeatTimer && clearInterval(heartbeatTimer)
        if (controller.signal.aborted) break
        input.onError?.(error)
      }

      // ponytail: 照抄 OpenCode server-sdk.tsx L213 — 重连前等 250ms
      await new Promise(resolve => setTimeout(resolve, RECONNECT_DELAY_MS))
    }
  })()

  return {
    close() {
      controller.abort()
    },
  }
}
