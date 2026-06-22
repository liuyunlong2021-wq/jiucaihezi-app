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
  // 🔧 Phase A 临时：取消 32 种事件类型上限，debug 模式下打印全部事件
  // 原逻辑：if (debugEventTypes.has(type) || debugEventTypes.size >= 32) return
  // 修复 Bug #2 需要看到 v1.17.9 服务端发出的所有事件类型，确认完成事件名
  if (debugEventTypes.has(type)) return
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

export async function subscribeOpenCodeEvents(
  client: OpencodeClient,
  handler: OpenCodeEventHandler,
  input: SubscribeOpenCodeEventsInput = {},
): Promise<OpenCodeEventSubscription> {
  const controller = new AbortController()
  const subscribeOptions = { signal: controller.signal } as any
  let eventResult: unknown
  try {
    eventResult = await (client as any).v2?.event?.subscribe?.({
      location: {
        directory: input.directory,
        workspace: input.workspace,
      },
    }, subscribeOptions)
  } catch (error) {
    if (controller.signal.aborted) throw error
    eventResult = undefined
  }

  if (!eventResult) {
    eventResult = await client.event.subscribe({
      directory: input.directory,
      workspace: input.workspace,
    }, subscribeOptions)
  }
  const stream = resolveEventStream(eventResult)

  void (async () => {
    try {
      for await (const rawEvent of stream) {
        const event = normalizeEvent(rawEvent)
        if (input.debug) logEventSample(event)
        handler(event as Event)
      }
      if (!controller.signal.aborted) input.onClose?.()
    } catch (error) {
      if (!controller.signal.aborted) input.onError?.(error)
    }
  })()

  return {
    close() {
      controller.abort()
    },
  }
}
