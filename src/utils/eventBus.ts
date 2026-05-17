/**
 * eventBus.ts — 极简全局事件总线
 * 用于跨组件通信（如 MessageBubble → WorkspaceLayout 切换面板）
 */
type Handler = (...args: unknown[]) => void

const handlers = new Map<string, Set<Handler>>()

export function emitEvent(event: string, ...args: unknown[]) {
  handlers.get(event)?.forEach(fn => fn(...args))
}

export function onEvent(event: string, fn: Handler) {
  if (!handlers.has(event)) handlers.set(event, new Set())
  handlers.get(event)!.add(fn)
  return () => handlers.get(event)?.delete(fn)
}
