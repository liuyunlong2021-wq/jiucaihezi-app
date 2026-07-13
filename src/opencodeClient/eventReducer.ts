import type {
  Event,
  Message,
  Part,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
} from '@opencode-ai/sdk/v2/client'

export type OpenCodeInteractiveRequest = Record<string, any> & { id: string; sessionID: string }

export interface OpenCodeSyncState {
  sessionsByDirectory: Record<string, Session[]>
  sessionInfo: Record<string, Session | undefined>
  sessionStatus: Record<string, SessionStatus | undefined>
  sessionErrors: Record<string, unknown>
  sessionDiff: Record<string, SnapshotFileDiff[] | undefined>
  todos: Record<string, Todo[] | undefined>
  permissions: Record<string, OpenCodeInteractiveRequest[] | undefined>
  questions: Record<string, OpenCodeInteractiveRequest[] | undefined>
  messages: Record<string, Message[] | undefined>
  parts: Record<string, Part[] | undefined>
}

const SKIP_PARTS = new Set(['patch', 'step-start', 'step-finish'])

export function createOpenCodeSyncState(): OpenCodeSyncState {
  return {
    sessionsByDirectory: {},
    sessionInfo: {},
    sessionStatus: {},
    sessionErrors: {},
    sessionDiff: {},
    todos: {},
    permissions: {},
    questions: {},
    messages: {},
    parts: {},
  }
}

function upsertById<T extends { id: string }>(items: T[] | undefined, item: T): T[] {
  const next = [...(items ?? [])]
  const index = next.findIndex(value => value.id === item.id)
  if (index >= 0) next[index] = item
  else next.push(item)
  return next.sort((a, b) => a.id.localeCompare(b.id))
}

function removeById<T extends { id: string }>(items: T[] | undefined, id: string): T[] {
  return (items ?? []).filter(item => item.id !== id)
}

function dropSession(state: OpenCodeSyncState, sessionID: string) {
  const messages = state.messages[sessionID] ?? []
  for (const message of messages) delete state.parts[message.id]
  delete state.sessionInfo[sessionID]
  delete state.sessionStatus[sessionID]
  delete state.sessionErrors[sessionID]
  delete state.sessionDiff[sessionID]
  delete state.todos[sessionID]
  delete state.permissions[sessionID]
  delete state.questions[sessionID]
  delete state.messages[sessionID]
}

export function applyOpenCodeEvent(state: OpenCodeSyncState, directory: string, event: Event): void {
  const properties = (event as any).properties ?? {}
  switch (event.type) {
    case 'session.created':
    case 'session.updated': {
      const info = properties.info as Session
      if (!info?.id) return
      state.sessionInfo[info.id] = info
      const targetDirectory = info.directory || directory
      if (info.time?.archived) {
        state.sessionsByDirectory[targetDirectory] = removeById(state.sessionsByDirectory[targetDirectory], info.id)
        dropSession(state, info.id)
        return
      }
      state.sessionsByDirectory[targetDirectory] = upsertById(state.sessionsByDirectory[targetDirectory], info)
      return
    }
    case 'session.deleted': {
      const info = properties.info as Session
      if (!info?.id) return
      const targetDirectory = info.directory || directory
      state.sessionsByDirectory[targetDirectory] = removeById(state.sessionsByDirectory[targetDirectory], info.id)
      dropSession(state, info.id)
      return
    }
    case 'session.status':
      delete state.sessionErrors[properties.sessionID]
      state.sessionStatus[properties.sessionID] = properties.status
      return
    case 'session.idle':
      delete state.sessionErrors[properties.sessionID]
      state.sessionStatus[properties.sessionID] = { type: 'idle' }
      return
    case 'session.error':
      state.sessionErrors[properties.sessionID] = properties.error
      return
    case 'session.diff':
      state.sessionDiff[properties.sessionID] = [...(properties.diff ?? [])]
      return
    case 'todo.updated':
      state.todos[properties.sessionID] = [...(properties.todos ?? [])]
      return
    case 'message.updated': {
      const info = properties.info as Message
      if (!info?.id || !info.sessionID) return
      state.messages[info.sessionID] = upsertById(state.messages[info.sessionID], info)
      return
    }
    case 'message.removed': {
      state.messages[properties.sessionID] = removeById(state.messages[properties.sessionID], properties.messageID)
      delete state.parts[properties.messageID]
      return
    }
    case 'message.part.updated': {
      const part = properties.part as Part
      if (!part?.id || SKIP_PARTS.has(part.type)) return
      if (!state.messages[part.sessionID]?.some(message => message.id === part.messageID)) return
      state.parts[part.messageID] = upsertById(state.parts[part.messageID], part)
      return
    }
    case 'message.part.removed': {
      const parts = removeById(state.parts[properties.messageID], properties.partID)
      if (parts.length) state.parts[properties.messageID] = parts
      else delete state.parts[properties.messageID]
      return
    }
    case 'message.part.delta': {
      const parts = state.parts[properties.messageID]
      const index = parts?.findIndex(part => part.id === properties.partID) ?? -1
      if (!parts || index < 0) return
      const part = parts[index] as any
      const current = typeof part[properties.field] === 'string' ? part[properties.field] : ''
      parts[index] = { ...part, [properties.field]: current + String(properties.delta ?? '') }
      return
    }
    case 'permission.asked':
    case 'permission.v2.asked': {
      const request = properties as OpenCodeInteractiveRequest
      if (!request.id || !request.sessionID) return
      state.permissions[request.sessionID] = upsertById(state.permissions[request.sessionID], request)
      return
    }
    case 'permission.replied':
    case 'permission.v2.replied':
      state.permissions[properties.sessionID] = removeById(
        state.permissions[properties.sessionID],
        properties.requestID,
      )
      return
    case 'question.asked':
    case 'question.v2.asked': {
      const request = properties as OpenCodeInteractiveRequest
      if (!request.id || !request.sessionID) return
      state.questions[request.sessionID] = upsertById(state.questions[request.sessionID], request)
      return
    }
    case 'question.replied':
    case 'question.rejected':
    case 'question.v2.replied':
    case 'question.v2.rejected':
      state.questions[properties.sessionID] = removeById(
        state.questions[properties.sessionID],
        properties.requestID,
      )
      return
  }
}
