import type { Event, OpencodeClient } from '@opencode-ai/sdk/v2/client'

export type QueuedServerEvent = { directory: string; payload: Event }

function coalescedKey(event: QueuedServerEvent): string | undefined {
  if (event.payload.type === 'lsp.updated') return `lsp.updated:${event.directory}`
  if (event.payload.type === 'message.part.updated') {
    const part = event.payload.properties.part
    return `message.part.updated:${event.directory}:${part.messageID}:${part.id}`
  }
  return undefined
}

export function enqueueServerEvent(queue: QueuedServerEvent[], event: QueuedServerEvent): boolean {
  const key = coalescedKey(event)
  const previous = queue[queue.length - 1]
  if (key && previous && coalescedKey(previous) === key) {
    queue[queue.length - 1] = event
    return false
  }
  queue.push(event)
  return true
}

export function coalesceServerEvents(events: QueuedServerEvent[]): QueuedServerEvent[] {
  const output: QueuedServerEvent[] = []
  for (const event of events) {
    if (event.payload.type !== 'message.part.delta') {
      output.push(event)
      continue
    }
    const properties = event.payload.properties
    const previous = output[output.length - 1]
    if (
      !previous
      || previous.payload.type !== 'message.part.delta'
      || previous.directory !== event.directory
      || previous.payload.properties.messageID !== properties.messageID
      || previous.payload.properties.partID !== properties.partID
      || previous.payload.properties.field !== properties.field
    ) {
      output.push({
        directory: event.directory,
        payload: { ...event.payload, properties: { ...properties } },
      })
      continue
    }
    output[output.length - 1] = {
      directory: event.directory,
      payload: {
        ...event.payload,
        properties: {
          ...properties,
          delta: previous.payload.properties.delta + properties.delta,
        },
      },
    }
  }
  return output
}

export interface OpenCodeGlobalEventBridgeOptions {
  flushFrameMs?: number
  streamYieldMs?: number
  reconnectDelayMs?: number
  heartbeatTimeoutMs?: number
  onError?: (error: unknown) => void
}

export function createOpenCodeGlobalEventBridge(
  client: OpencodeClient,
  options: OpenCodeGlobalEventBridgeOptions = {},
) {
  const flushFrameMs = options.flushFrameMs ?? 16
  const streamYieldMs = options.streamYieldMs ?? 8
  const reconnectDelayMs = options.reconnectDelayMs ?? 250
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 15_000
  const listeners = new Set<(event: QueuedServerEvent) => void>()
  const abort = new AbortController()

  let queue: QueuedServerEvent[] = []
  let buffer: QueuedServerEvent[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setTimeout> | undefined
  let attempt: AbortController | undefined
  let run: Promise<void> | undefined
  let started = false
  let generation = 0
  let lastFlush = 0

  const clearHeartbeat = () => {
    if (heartbeat) clearTimeout(heartbeat)
    heartbeat = undefined
  }
  const resetHeartbeat = () => {
    clearHeartbeat()
    heartbeat = setTimeout(() => attempt?.abort(), heartbeatTimeoutMs)
  }
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    if (queue.length === 0) return
    const events = queue
    queue = buffer
    buffer = events
    queue.length = 0
    lastFlush = Date.now()
    for (const event of coalesceServerEvents(events)) {
      for (const listener of listeners) listener(event)
    }
    buffer.length = 0
  }
  const schedule = () => {
    if (timer) return
    timer = setTimeout(flush, Math.max(0, flushFrameMs - (Date.now() - lastFlush)))
  }
  const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
  const isClosed = (error: unknown, signal?: AbortSignal) => (
    signal?.aborted === true
    || (error !== null && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
  )

  const start = () => {
    if (started && run) return run
    started = true
    const active = ++generation
    const current = (async () => {
      while (!abort.signal.aborted && started && generation === active) {
        attempt = new AbortController()
        const onAbort = () => attempt?.abort()
        abort.signal.addEventListener('abort', onAbort)
        try {
          const events = await client.global.event({ signal: attempt.signal })
          let yielded = Date.now()
          resetHeartbeat()
          for await (const event of events.stream) {
            resetHeartbeat()
            if ((event.payload as any).type !== 'sync') {
              const queued = {
                directory: event.directory ?? 'global',
                payload: event.payload as Event,
              }
              if (enqueueServerEvent(queue, queued)) schedule()
            }
            if (Date.now() - yielded < streamYieldMs) continue
            yielded = Date.now()
            await wait(0)
          }
        } catch (error) {
          if (!isClosed(error, attempt.signal)) options.onError?.(error)
        } finally {
          abort.signal.removeEventListener('abort', onAbort)
          attempt = undefined
          clearHeartbeat()
        }
        if (abort.signal.aborted || !started || generation !== active) return
        await wait(reconnectDelayMs)
      }
    })().finally(() => {
      if (run === current) run = undefined
      flush()
    })
    run = current
    return current
  }

  return {
    start,
    stop() {
      started = false
      generation++
      attempt?.abort()
      clearHeartbeat()
      flush()
    },
    dispose() {
      started = false
      generation++
      abort.abort()
      clearHeartbeat()
      flush()
      listeners.clear()
    },
    subscribe(handler: (event: QueuedServerEvent) => void) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
}
