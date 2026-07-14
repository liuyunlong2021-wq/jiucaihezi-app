/**
 * eventBus.ts — 极简全局事件总线
 * 用于跨组件通信（如 MessageBubble → WorkspaceLayout 切换面板）
 */
type Handler = (...args: unknown[]) => unknown

const handlers = new Map<string, Set<Handler>>()
const lastPayloads = new Map<string, unknown[]>()

export function emitEvent(event: string, ...args: unknown[]) {
  const eventHandlers = handlers.get(event)
  if (!eventHandlers?.size) {
    lastPayloads.set(event, args)
    return
  }
  lastPayloads.delete(event)
  eventHandlers.forEach(fn => fn(...args))
}

export async function emitEventAsync(event: string, ...args: unknown[]): Promise<void> {
  const eventHandlers = handlers.get(event)
  if (!eventHandlers?.size) {
    lastPayloads.set(event, args)
    return
  }
  lastPayloads.delete(event)
  for (const handler of eventHandlers) await handler(...args)
}

export function onEvent(event: string, fn: Handler) {
  if (!handlers.has(event)) handlers.set(event, new Set())
  handlers.get(event)!.add(fn)
  return () => handlers.get(event)?.delete(fn)
}

export function consumeLastEvent(event: string): unknown[] | null {
  const payload = lastPayloads.get(event)
  if (!payload) return null
  lastPayloads.delete(event)
  return payload
}
