import { getToolCardByName, summarizeToolInvocation } from './toolRegistry'

export type ToolInvocationStatus = 'running' | 'done' | 'error' | 'pending'

export interface ToolActivityItem {
  id: string
  active: boolean
  status: ToolInvocationStatus
  callCount: number
  activeCallIds: string[]
  seenCallIds: string[]
  lastToolName: string
  lastDetail: string
  lastStartedAt: number
  lastFinishedAt: number | null
  lastError: string
}

export type ToolActivityState = Record<string, ToolActivityItem>

export interface ToolInvocationEvent {
  callId: string
  toolName: string
  status: ToolInvocationStatus
  args?: Record<string, unknown>
  error?: string
  at?: number
}

function createItem(toolId: string): ToolActivityItem {
  return {
    id: toolId,
    active: false,
    status: 'done',
    callCount: 0,
    activeCallIds: [],
    seenCallIds: [],
    lastToolName: '',
    lastDetail: '',
    lastStartedAt: 0,
    lastFinishedAt: null,
    lastError: '',
  }
}

export function applyToolInvocation(
  state: ToolActivityState,
  event: ToolInvocationEvent,
): ToolActivityState {
  const card = getToolCardByName(event.toolName)
  if (!card) return state

  const at = event.at ?? Date.now()
  const existing = state[card.id] || createItem(card.id)
  const activeCallIds = new Set(existing.activeCallIds)
  const seenCallIds = new Set(existing.seenCallIds)
  const isNewCall = !seenCallIds.has(event.callId)

  if (event.status === 'running' || event.status === 'pending') {
    activeCallIds.add(event.callId)
  } else {
    activeCallIds.delete(event.callId)
  }
  seenCallIds.add(event.callId)

  const next: ToolActivityItem = {
    ...existing,
    active: activeCallIds.size > 0,
    status: event.status,
    callCount: existing.callCount + (isNewCall ? 1 : 0),
    activeCallIds: Array.from(activeCallIds),
    seenCallIds: Array.from(seenCallIds),
    lastToolName: event.toolName,
    lastDetail: event.args ? summarizeToolInvocation(event.toolName, event.args) : existing.lastDetail,
    lastStartedAt: event.status === 'running' || event.status === 'pending' ? at : existing.lastStartedAt,
    lastFinishedAt: event.status === 'done' || event.status === 'error' ? at : existing.lastFinishedAt,
    lastError: event.status === 'error' ? event.error || '执行失败' : existing.lastError,
  }

  return {
    ...state,
    [card.id]: next,
  }
}
