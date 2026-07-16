import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Message, OpencodeClient, Part, Session } from '@opencode-ai/sdk/v2/client'

import type { QueuedServerEvent } from '@/opencodeClient/eventBridge'
import { applyOpenCodeEvent, createOpenCodeSyncState } from '@/opencodeClient/eventReducer'
import { mapOpenCodeMessagesToChatMessages } from '@/opencodeClient/messageMapper'
import { createOpenCodeId } from '@/opencodeClient/identifier'
import {
  createJiucaiOpenCodeClient,
  createJiucaiOpenCodeGlobalClient,
} from '@/opencodeClient/client'
import {
  createOpenCodeGlobalEventBridge,
  type OpenCodeGlobalEventBridgeOptions,
} from '@/opencodeClient/eventBridge'
import type { OpenCodeServerHandle } from '@/opencodeClient/types'
import { ensureOpenCodeServer } from '@/opencodeClient/daemon'
import {
  rejectOpenCodeQuestion,
  replyOpenCodePermission,
  replyOpenCodeQuestion,
  type OpenCodePermissionReply,
} from '@/opencodeClient/interactive'

type GlobalBridge = ReturnType<typeof createOpenCodeGlobalEventBridge>
type ConnectDependencies = {
  globalClient?: OpencodeClient
  directoryClient?: OpencodeClient
  bridge?: GlobalBridge
}
type EnsureConnectedDependencies = {
  ensureServer?: typeof ensureOpenCodeServer
  connectDependencies?: ConnectDependencies
}
type PendingConnection = {
  intent: number
  guards: Array<(() => boolean) | undefined>
  promise: Promise<OpenCodeServerHandle>
}
type CreatingSession = {
  promise: Promise<string>
  token: string
  shared: boolean
}

export interface SubmitOpenCodePromptInput {
  sessionID?: string
  messageID?: string
  directory: string
  title?: string
  text: string
  agent: string
  model: { providerID: string; modelID: string; variant?: string }
  system?: string
  tools?: Record<string, boolean>
  parts: Array<Record<string, any> & { type: string; id?: string }>
}

export interface EnsureSessionResult {
  sessionID: string
  created: boolean
  cleanupToken?: string
}

export const useOpenCodeSyncStore = defineStore('openCodeSync', () => {
  const state = reactive(createOpenCodeSyncState())
  const activeDirectory = ref('')
  const activeSessionId = ref('')
  const connected = ref(false)
  const connectionError = ref('')
  const serverKey = ref('')
  let bridge: GlobalBridge | undefined
  let navigationGeneration = 0
  let serverGeneration = 0
  let reconcileGeneration = 0
  let sessionLoadGeneration = 0
  let directoryBootstrapGeneration = 0
  let connectionIntentGeneration = 0
  const pendingConnections = new Map<string, PendingConnection>()
  let unsubscribeBridge: (() => void) | undefined
  const clients = new Map<string, OpencodeClient>()
  const directoryRevision = new Map<string, number>()
  const sessionRevision = new Map<string, number>()
  const todoRevision = new Map<string, number>()
  const diffRevision = new Map<string, number>()
  const statusRevision = new Map<string, number>()
  const permissionRevision = new Map<string, number>()
  const questionRevision = new Map<string, number>()
  const deletedSessions = new Map<string, Set<string>>()
  const removedMessages = new Map<string, Set<string>>()
  const removedParts = new Map<string, Set<string>>()
  const confirmedMessages = new Set<string>()
  const confirmedParts = new Set<string>()
  const loadedSessions = new Set<string>()
  const creatingSessions = new Map<string, CreatingSession>()
  const sessionCleanupReservations = new Map<string, { token: string; directory: string }>()
  const deletingSessions = new Map<string, Promise<void>>()
  const openingSessions = new Map<string, Promise<void>>()
  const bootstrappingDirectories = new Map<string, Promise<void>>()

  const isStreaming = computed(() => {
    if (!activeSessionId.value) return false
    return (state.sessionStatus[activeSessionId.value]?.type ?? 'idle') !== 'idle'
  })
  const chatMessages = computed(() => {
    const sessionID = activeSessionId.value
    if (!sessionID) return []
    return mapOpenCodeMessagesToChatMessages((state.messages[sessionID] ?? []).map(info => ({
      info,
      parts: state.parts[info.id] ?? [],
    })))
  })
  const activePermissions = computed(() => state.permissions[activeSessionId.value] ?? [])
  const activeQuestions = computed(() => state.questions[activeSessionId.value] ?? [])
  const activeTodos = computed(() => state.todos[activeSessionId.value] ?? [])
  const activeDiffs = computed(() => state.sessionDiff[activeSessionId.value] ?? [])

  function applyServerEvent(event: QueuedServerEvent) {
    const properties = (event.payload as any).properties ?? {}
    if (event.payload.type === 'session.created' || event.payload.type === 'session.updated') {
      const id = String(properties.info?.id || '')
      if (id && deletedSessions.get(event.directory)?.has(id)) return
    }
    directoryRevision.set(event.directory, (directoryRevision.get(event.directory) ?? 0) + 1)
    const sessionID = String(properties.sessionID || properties.info?.sessionID || properties.part?.sessionID || '')
    if (sessionID) sessionRevision.set(sessionID, (sessionRevision.get(sessionID) ?? 0) + 1)
    if (sessionID && event.payload.type === 'todo.updated') todoRevision.set(sessionID, (todoRevision.get(sessionID) ?? 0) + 1)
    if (sessionID && event.payload.type === 'session.diff') diffRevision.set(sessionID, (diffRevision.get(sessionID) ?? 0) + 1)
    if (sessionID && (event.payload.type === 'session.status' || event.payload.type === 'session.idle')) statusRevision.set(sessionID, (statusRevision.get(sessionID) ?? 0) + 1)
    if (sessionID && event.payload.type.startsWith('permission.')) permissionRevision.set(sessionID, (permissionRevision.get(sessionID) ?? 0) + 1)
    if (sessionID && event.payload.type.startsWith('question.')) questionRevision.set(sessionID, (questionRevision.get(sessionID) ?? 0) + 1)
    if (event.payload.type === 'session.deleted') {
      const id = String(properties.info?.id || properties.sessionID || '')
      if (id) {
        sessionCleanupReservations.delete(id)
        const deleted = deletedSessions.get(event.directory) ?? new Set<string>()
        deleted.add(id)
        deletedSessions.set(event.directory, deleted)
      }
    }
    if (event.payload.type === 'session.created' || event.payload.type === 'session.updated') {
      const id = String(properties.info?.id || '')
      if (properties.info?.time?.archived) {
        const deleted = deletedSessions.get(event.directory) ?? new Set<string>()
        deleted.add(id)
        deletedSessions.set(event.directory, deleted)
      }
    }
    if (event.payload.type === 'message.removed' && sessionID) {
      const messageID = String(properties.messageID || '')
      confirmedMessages.delete(messageID)
      for (const part of state.parts[messageID] ?? []) confirmedParts.delete(part.id)
      const removed = removedMessages.get(sessionID) ?? new Set<string>()
      removed.add(messageID)
      removedMessages.set(sessionID, removed)
    }
    if (event.payload.type === 'message.updated' && sessionID) {
      const messageID = String(properties.info?.id || '')
      removedMessages.get(sessionID)?.delete(messageID)
      if (messageID) confirmedMessages.add(messageID)
    }
    if (event.payload.type === 'message.part.removed' && sessionID) {
      confirmedParts.delete(String(properties.partID || ''))
      const removed = removedParts.get(sessionID) ?? new Set<string>()
      removed.add(String(properties.partID || ''))
      removedParts.set(sessionID, removed)
    }
    if (event.payload.type === 'message.part.updated' && sessionID) {
      const partID = String(properties.part?.id || '')
      removedParts.get(sessionID)?.delete(partID)
      if (partID) confirmedParts.add(partID)
    }
    applyOpenCodeEvent(state, event.directory, event.payload)
    if (event.payload.type === 'server.connected') {
      sessionLoadGeneration++
      directoryBootstrapGeneration++
      openingSessions.clear()
      bootstrappingDirectories.clear()
      loadedSessions.clear()
      void reconcileActiveDirectory().catch(error => {
        connectionError.value = error instanceof Error ? error.message : String(error)
      })
    }
    if ((event.payload.type === 'session.deleted' || event.payload.type === 'session.updated')
      && (event.payload.type === 'session.deleted' || properties.info?.time?.archived)) {
      const id = String(properties.info?.id || properties.sessionID || '')
      for (const key of loadedSessions) if (key.endsWith(`\u0000${id}`)) loadedSessions.delete(key)
      if (activeSessionId.value === id) activeSessionId.value = ''
    }
  }

  function unwrap<T>(result: any): T {
    return (result?.data ?? result) as T
  }

  function clientFor(directory: string): OpencodeClient {
    const client = clients.get(directory)
    if (!client) throw new Error(`当前项目的本机服务未注册: ${directory}`)
    return client
  }

  function registerClient(directory: string, client: OpencodeClient) {
    clients.set(String(directory || '').trim(), client)
  }

  async function abortActiveSession(): Promise<void> {
    const directory = activeDirectory.value
    const sessionID = activeSessionId.value
    if (!directory || !sessionID) throw new Error('当前没有可停止的会话。')
    await clientFor(directory).session.abort({ sessionID, directory } as any)
  }

  async function renameSession(sessionID: string, title: string): Promise<void> {
    const directory = String(state.sessionInfo[sessionID]?.directory || activeDirectory.value || '').trim()
    if (!directory) throw new Error('当前没有可重命名的目录。')
    await clientFor(directory).session.update({ sessionID, title, directory } as any)
  }

  async function deleteSession(sessionID: string): Promise<void> {
    for (const tombstones of deletedSessions.values()) if (tombstones.has(sessionID)) return
    const info = state.sessionInfo[sessionID]
    const directory = String(info?.directory || '').trim()
    if (!info?.id || !directory) throw new Error(`未知会话: ${sessionID}`)
    const key = `${directory}\u0000${sessionID}`
    const pending = deletingSessions.get(key)
    if (pending) return pending
    const request = (async () => {
      let result: any
      try {
        result = await clientFor(directory).session.delete({ sessionID, directory } as any)
      } catch (error) {
        if (deletedSessions.get(directory)?.has(sessionID)) return
        throw error
      }
      if (unwrap<boolean>(result) === false) throw new Error(`会话删除失败: ${sessionID}`)
      applyServerEvent({
        directory,
        payload: { type: 'session.deleted', properties: { info } } as any,
      })
    })().finally(() => {
      if (deletingSessions.get(key) === request) deletingSessions.delete(key)
    })
    deletingSessions.set(key, request)
    return request
  }

  async function updateSessionPermission(directory: string, sessionID: string, permission: unknown): Promise<void> {
    await clientFor(directory).session.update({ sessionID, permission, directory } as any)
  }

  function activeRequestClient(sessionID: string, requestID: string, requests: any[]) {
    const directory = activeDirectory.value
    if (!directory || activeSessionId.value !== sessionID) throw new Error('请求不属于当前活动会话。')
    const owner = state.sessionInfo[sessionID]?.directory
    if (owner && owner !== directory) throw new Error('请求不属于当前活动目录。')
    if (!requests.some(request => request?.id === requestID)) throw new Error('交互请求不存在。')
    return { directory, client: clientFor(directory) }
  }

  async function replyPermission(input: { sessionID: string; requestID: string; reply: OpenCodePermissionReply }) {
    const location = activeRequestClient(input.sessionID, input.requestID, state.permissions[input.sessionID] ?? [])
    await replyOpenCodePermission(location.client, { ...input, directory: location.directory })
  }

  async function replyQuestion(input: { sessionID: string; requestID: string; answers: string[][] }) {
    const location = activeRequestClient(input.sessionID, input.requestID, state.questions[input.sessionID] ?? [])
    await replyOpenCodeQuestion(location.client, { ...input, directory: location.directory })
  }

  async function rejectQuestion(input: { sessionID: string; requestID: string }) {
    const location = activeRequestClient(input.sessionID, input.requestID, state.questions[input.sessionID] ?? [])
    await rejectOpenCodeQuestion(location.client, { ...input, directory: location.directory })
  }

  function connect(handle: OpenCodeServerHandle, dependencies: ConnectDependencies = {}) {
    if (!handle.url || !handle.authorization) throw new Error('韭菜盒子本机服务未连接。')
    const key = `${handle.url}|${handle.authorization}`
    const directory = String(handle.directory || activeDirectory.value || '').trim()
    if (directory) {
      registerClient(directory, dependencies.directoryClient ?? createJiucaiOpenCodeClient(handle, directory))
      activeDirectory.value = directory
    }
    if (serverKey.value === key && bridge) return
    if (serverKey.value && serverKey.value !== key) {
      serverGeneration++
      reconcileGeneration++
      sessionLoadGeneration++
      directoryBootstrapGeneration++
      loadedSessions.clear()
      creatingSessions.clear()
      sessionCleanupReservations.clear()
      deletingSessions.clear()
      openingSessions.clear()
      bootstrappingDirectories.clear()
      directoryRevision.clear(); sessionRevision.clear(); todoRevision.clear(); diffRevision.clear()
      statusRevision.clear(); permissionRevision.clear(); questionRevision.clear()
      deletedSessions.clear(); removedMessages.clear(); removedParts.clear(); confirmedMessages.clear(); confirmedParts.clear()
    }
    unsubscribeBridge?.()
    bridge?.dispose()
    const globalClient = dependencies.globalClient ?? createJiucaiOpenCodeGlobalClient(handle)
    const generation = serverGeneration
    let connectedBridge: GlobalBridge
    const options: OpenCodeGlobalEventBridgeOptions = {
      onError(error) {
        if (generation !== serverGeneration || bridge !== connectedBridge) return
        connectionError.value = error instanceof Error ? error.message : String(error)
      },
    }
    connectedBridge = dependencies.bridge ?? createOpenCodeGlobalEventBridge(globalClient, options)
    bridge = connectedBridge
    unsubscribeBridge = connectedBridge.subscribe(applyServerEvent)
    serverKey.value = key
    connected.value = true
    connectionError.value = ''
    void connectedBridge.start().catch(error => {
      if (!connected.value || generation !== serverGeneration || bridge !== connectedBridge) return
      connectionError.value = error instanceof Error ? error.message : String(error)
    })
  }

  function disconnect() {
    connectionIntentGeneration++
    pendingConnections.clear()
    serverGeneration++
    reconcileGeneration++
    sessionLoadGeneration++
    directoryBootstrapGeneration++
    openingSessions.clear()
    creatingSessions.clear()
    sessionCleanupReservations.clear()
    deletingSessions.clear()
    bootstrappingDirectories.clear()
    loadedSessions.clear()
    directoryRevision.clear()
    sessionRevision.clear()
    todoRevision.clear()
    diffRevision.clear()
    statusRevision.clear()
    permissionRevision.clear()
    questionRevision.clear()
    deletedSessions.clear()
    confirmedMessages.clear()
    confirmedParts.clear()
    removedMessages.clear()
    removedParts.clear()
    connected.value = false
    unsubscribeBridge?.()
    unsubscribeBridge = undefined
    bridge?.dispose()
    bridge = undefined
    serverKey.value = ''
  }

  async function ensureConnected(
    input: { config: unknown; directory?: string; isCurrent?: () => boolean },
    dependencies: EnsureConnectedDependencies = {},
  ): Promise<OpenCodeServerHandle> {
    const key = String(input.directory || '').trim()
    const pending = pendingConnections.get(key)
    if (pending?.intent === connectionIntentGeneration) {
      pending.guards.push(input.isCurrent)
      return pending.promise
    }
    const intent = ++connectionIntentGeneration
    const entry = { intent, guards: [input.isCurrent] } as PendingConnection
    entry.promise = (async () => {
      const handle = await (dependencies.ensureServer ?? ensureOpenCodeServer)({
        config: input.config,
        directory: input.directory,
      })
      if (intent !== connectionIntentGeneration) throw new Error('连接请求已失效。')
      if (!entry.guards.some(guard => !guard || guard())) return handle
      connect(handle, dependencies.connectDependencies)
      if (intent !== connectionIntentGeneration) throw new Error('连接请求已失效。')
      const directory = String(input.directory || handle.directory || '').trim()
      if (directory) await bootstrapDirectory(directory)
      if (intent !== connectionIntentGeneration) throw new Error('连接请求已失效。')
      return handle
    })().finally(() => {
      if (pendingConnections.get(key) === entry) pendingConnections.delete(key)
    })
    pendingConnections.set(key, entry)
    return entry.promise
  }

  async function bootstrapDirectory(directory: string): Promise<void> {
    const key = String(directory || '').trim()
    const pending = bootstrappingDirectories.get(key)
    if (pending) return pending
    const revision = directoryRevision.get(key) ?? 0
    const generation = serverGeneration
    const bootstrapGeneration = directoryBootstrapGeneration
    const request = clientFor(key).session.list({ directory: key, roots: true, limit: 64 }).then(result => {
      if (generation !== serverGeneration || bootstrapGeneration !== directoryBootstrapGeneration) return
      const snapshot = (unwrap<Session[]>(result) ?? [])
        .filter(item => item?.id && !item.parentID && !item.time?.archived)
        .filter(item => !deletedSessions.get(key)?.has(item.id))
      const current = state.sessionsByDirectory[key] ?? []
      if (revision === (directoryRevision.get(key) ?? 0)) {
        const present = new Set(snapshot.map(item => item.id))
        for (const stale of current.map(item => item.id).filter(id => !present.has(id))) {
          evictSessionCaches(stale, key)
        }
      }
      const merged = revision === (directoryRevision.get(key) ?? 0)
        ? snapshot
        : [...snapshot, ...current].reduce<Session[]>((items, item) => {
            const index = items.findIndex(existing => existing.id === item.id)
            if (index >= 0) items[index] = item
            else items.push(item)
            return items
          }, [])
      merged.sort((a, b) => a.id.localeCompare(b.id))
      state.sessionsByDirectory[key] = merged
      for (const info of merged) state.sessionInfo[info.id] = info
    }).finally(() => {
      if (bootstrappingDirectories.get(key) === request) bootstrappingDirectories.delete(key)
    })
    bootstrappingDirectories.set(key, request)
    return request
  }

  function evictSessionCaches(sessionID: string, directory?: string) {
    const messageIDs = (state.messages[sessionID] ?? []).map(message => message.id)
    const partIDs = Object.values(state.parts).flatMap(parts => parts ?? [])
      .filter(part => part.sessionID === sessionID).map(part => part.id)
    for (const messageID of messageIDs) delete state.parts[messageID]
    for (const [messageID, parts] of Object.entries(state.parts)) {
      if (parts?.some(part => part.sessionID === sessionID)) delete state.parts[messageID]
    }
    delete state.sessionInfo[sessionID]
    delete state.sessionStatus[sessionID]
    delete state.sessionErrors[sessionID]
    delete state.sessionDiff[sessionID]
    delete state.todos[sessionID]
    delete state.permissions[sessionID]
    delete state.questions[sessionID]
    delete state.messages[sessionID]
    for (const key of loadedSessions) if (key === `${directory}\u0000${sessionID}`) loadedSessions.delete(key)
    sessionRevision.delete(sessionID)
    todoRevision.delete(sessionID)
    diffRevision.delete(sessionID)
    statusRevision.delete(sessionID)
    permissionRevision.delete(sessionID)
    questionRevision.delete(sessionID)
    for (const messageID of messageIDs) confirmedMessages.delete(messageID)
    for (const partID of partIDs) confirmedParts.delete(partID)
    removedMessages.delete(sessionID)
    removedParts.delete(sessionID)
    if (activeSessionId.value === sessionID && (!directory || activeDirectory.value === directory)) activeSessionId.value = ''
  }

  async function reconcileActiveDirectory(): Promise<void> {
    const directory = activeDirectory.value
    if (!directory || !clients.has(directory)) return
    const sessionID = activeSessionId.value
    const generation = serverGeneration
    const reconcile = ++reconcileGeneration
    const statusBefore = new Map(statusRevision)
    const permissionBefore = new Map(permissionRevision)
    const questionBefore = new Map(questionRevision)
    loadedSessions.delete(`${directory}\u0000${sessionID}`)
    const client = clientFor(directory)
    const [statusesResult, permissionsResult, questionsResult] = await Promise.all([
      client.session.status({ directory } as any),
      client.permission.list({ directory } as any),
      client.question.list({ directory } as any),
    ])
    if (generation !== serverGeneration || reconcile !== reconcileGeneration) return
    await bootstrapDirectory(directory)
    if (generation !== serverGeneration || reconcile !== reconcileGeneration) return
    if (activeDirectory.value !== directory || activeSessionId.value !== sessionID) return
    const statuses = unwrap<Record<string, any>>(statusesResult) ?? {}
    const permissions = unwrap<any[]>(permissionsResult) ?? []
    const questions = unwrap<any[]>(questionsResult) ?? []
    const snapshotSessions = new Set([
      ...(state.sessionsByDirectory[directory] ?? []).map(item => item.id),
      ...Object.keys(statuses),
      ...permissions.map(item => item?.sessionID).filter(Boolean),
      ...questions.map(item => item?.sessionID).filter(Boolean),
    ])
    for (const id of snapshotSessions) {
      if ((statusBefore.get(id) ?? 0) === (statusRevision.get(id) ?? 0)) {
        if (statuses[id]) state.sessionStatus[id] = statuses[id]
        else delete state.sessionStatus[id]
      }
    }
    for (const id of snapshotSessions) {
      if ((permissionBefore.get(id) ?? 0) === (permissionRevision.get(id) ?? 0)) {
        state.permissions[id] = permissions
          .filter(item => item?.id && item.sessionID === id)
          .sort((a, b) => a.id.localeCompare(b.id))
      }
      if ((questionBefore.get(id) ?? 0) === (questionRevision.get(id) ?? 0)) {
        state.questions[id] = questions
          .filter(item => item?.id && item.sessionID === id)
          .sort((a, b) => a.id.localeCompare(b.id))
      }
    }
    if (sessionID) await openSession(directory, sessionID)
  }

  async function ensureSessionWithOwnership(input: { directory: string; title?: string }): Promise<EnsureSessionResult> {
    const directory = String(input.directory || '').trim()
    if (activeSessionId.value && activeDirectory.value === directory) {
      sessionCleanupReservations.delete(activeSessionId.value)
      return { sessionID: activeSessionId.value, created: false }
    }
    const pending = creatingSessions.get(directory)
    if (pending) {
      pending.shared = true
      return { sessionID: await pending.promise, created: false }
    }
    const token = createOpenCodeId('part')
    const generation = ++navigationGeneration
    const startingDirectory = activeDirectory.value
    const entry = { token, shared: false } as CreatingSession
    const request = (async () => {
      const info = unwrap<Session>(await clientFor(directory).session.create({
        directory,
        title: input.title,
      } as any))
      if (!info?.id) throw new Error('韭菜盒子会话创建失败。')
      applyServerEvent({
        directory,
        payload: { type: 'session.created', properties: { sessionID: info.id, info } } as any,
      })
      if (generation === navigationGeneration && activeDirectory.value === startingDirectory) {
        activeDirectory.value = directory
        activeSessionId.value = info.id
      }
      if (!entry.shared) sessionCleanupReservations.set(info.id, { token, directory })
      return info.id
    })().finally(() => {
      if (creatingSessions.get(directory) === entry) creatingSessions.delete(directory)
    })
    entry.promise = request
    creatingSessions.set(directory, entry)
    return { sessionID: await request, created: true, cleanupToken: token }
  }

  async function ensureSession(input: { directory: string; title?: string }): Promise<string> {
    return (await ensureSessionWithOwnership(input)).sessionID
  }

  async function cleanupCreatedSessionIfExclusive(sessionID: string, token: string): Promise<boolean> {
    const reservation = sessionCleanupReservations.get(sessionID)
    if (!reservation || reservation.token !== token || (state.messages[sessionID]?.length ?? 0) > 0) return false
    sessionCleanupReservations.delete(sessionID)
    await deleteSession(sessionID)
    if (!activeSessionId.value) newDraft()
    return true
  }

  async function openSession(directory: string, sessionID: string): Promise<void> {
    const key = `${directory}\u0000${sessionID}`
    const intent = ++navigationGeneration
    if (loadedSessions.has(key)) {
      const owner = state.sessionInfo[sessionID]?.directory
      if (!owner || owner === directory) {
        activeDirectory.value = directory
        activeSessionId.value = sessionID
      }
      return
    }
    const pending = openingSessions.get(key)
    if (pending) {
      return pending.then(() => {
        if (intent === navigationGeneration) {
          activeDirectory.value = directory
          activeSessionId.value = sessionID
        }
      })
    }
    const generation = intent
    const serverRequestGeneration = serverGeneration
    const loadGeneration = sessionLoadGeneration
    const startingDirectory = activeDirectory.value
    const revision = sessionRevision.get(sessionID) ?? 0
    const todoSnapshotRevision = todoRevision.get(sessionID) ?? 0
    const diffSnapshotRevision = diffRevision.get(sessionID) ?? 0
    const client = clientFor(directory)
    const request = Promise.all([
      client.session.get({ sessionID, directory } as any),
      client.session.messages({ sessionID, directory, limit: 500 } as any),
      client.session.todo({ sessionID, directory } as any),
      client.session.diff({ sessionID, directory } as any),
    ]).then(([sessionResult, messageResult, todoResult, diffResult]) => {
      if (serverRequestGeneration !== serverGeneration || loadGeneration !== sessionLoadGeneration) return
      if (deletedSessions.get(directory)?.has(sessionID)) return
      const info = unwrap<Session>(sessionResult)
      if (!info?.id || info.id !== sessionID) {
        throw new Error(`会话不存在: ${sessionID}`)
      }
      if (info?.directory && info.directory !== directory) {
        throw new Error(`会话项目目录不匹配: ${info.directory}`)
      }
      if (info?.time?.archived) {
        const deleted = deletedSessions.get(directory) ?? new Set<string>()
        deleted.add(sessionID)
        deletedSessions.set(directory, deleted)
        applyOpenCodeEvent(state, directory, {
          type: 'session.updated', properties: { info },
        } as any)
        loadedSessions.delete(key)
        if (activeSessionId.value === sessionID) activeSessionId.value = ''
        return
      }
      if (generation === navigationGeneration && activeDirectory.value === startingDirectory) {
        activeDirectory.value = directory
        activeSessionId.value = sessionID
      }
      const unchanged = revision === (sessionRevision.get(sessionID) ?? 0)
      const todoUnchanged = todoSnapshotRevision === (todoRevision.get(sessionID) ?? 0)
      const diffUnchanged = diffSnapshotRevision === (diffRevision.get(sessionID) ?? 0)
      if (info?.id && unchanged) {
        state.sessionInfo[info.id] = info
        state.sessionsByDirectory[directory] = [...(state.sessionsByDirectory[directory] ?? []).filter(item => item.id !== info.id), info]
          .sort((a, b) => a.id.localeCompare(b.id))
      }
      const rows = unwrap<Array<{ info: Message; parts: Part[] }>>(messageResult) ?? []
      const snapshotMessages = rows.map(row => row.info).filter(Boolean)
      const currentMessages = state.messages[sessionID] ?? []
      const messages = revision === (sessionRevision.get(sessionID) ?? 0)
        ? snapshotMessages
        : [...snapshotMessages, ...currentMessages].reduce<Message[]>((items, item) => {
            if (removedMessages.get(sessionID)?.has(item.id)) return items
            const index = items.findIndex(existing => existing.id === item.id)
            if (index >= 0) items[index] = item
            else items.push(item)
            return items
          }, [])
      state.messages[sessionID] = messages.sort((a, b) => a.id.localeCompare(b.id))
      if (unchanged) {
        const snapshotMessageIDs = new Set(snapshotMessages.map(message => message.id))
        for (const [messageID, parts] of Object.entries(state.parts)) {
          if (parts?.some(part => part.sessionID === sessionID) && !snapshotMessageIDs.has(messageID)) delete state.parts[messageID]
        }
      }
      for (const row of rows) {
        const currentParts = state.parts[row.info.id] ?? []
        const source = unchanged ? (row.parts ?? []) : [...(row.parts ?? []), ...currentParts]
        const parts = source.reduce<Part[]>((items, part) => {
          if (removedParts.get(sessionID)?.has(part.id)) return items
          const index = items.findIndex(existing => existing.id === part.id)
          if (index >= 0) items[index] = part
          else items.push(part)
          return items
        }, [])
        if (parts.length) state.parts[row.info.id] = parts.sort((a, b) => a.id.localeCompare(b.id))
        else delete state.parts[row.info.id]
      }
      if (todoUnchanged) {
        state.todos[sessionID] = unwrap<any[]>(todoResult) ?? []
      }
      if (diffUnchanged) {
        state.sessionDiff[sessionID] = unwrap<any[]>(diffResult) ?? []
      }
      loadedSessions.add(key)
    }).finally(() => {
      if (openingSessions.get(key) === request) openingSessions.delete(key)
    })
    openingSessions.set(key, request)
    return request
  }

  function newDraft() {
    navigationGeneration++
    activeSessionId.value = ''
  }

  function sessionsForDirectory(directory: string): Session[] {
    return state.sessionsByDirectory[directory] ?? []
  }

  async function submitPrompt(input: SubmitOpenCodePromptInput): Promise<{ sessionID: string; messageID: string }> {
    const sessionID = input.sessionID ?? await ensureSession({ directory: input.directory, title: input.title })
    if (activeDirectory.value !== input.directory || activeSessionId.value !== sessionID) {
      throw new Error('项目已切换，已取消上一项提交。')
    }
    const messageID = input.messageID || createOpenCodeId('message')
    const requestParts = input.parts.map(part => ({
      ...part,
      id: part.id || createOpenCodeId('part'),
    }))
    const message: Message = {
      id: messageID,
      sessionID,
      role: 'user',
      time: { created: Date.now() },
      agent: input.agent,
      model: input.model,
    } as Message
    const optimisticParts = requestParts.map(part => ({
      ...part,
      sessionID,
      messageID,
    })) as Part[]
    state.messages[sessionID] = [...(state.messages[sessionID] ?? []), message]
      .sort((a, b) => a.id.localeCompare(b.id))
    state.parts[messageID] = optimisticParts.sort((a, b) => a.id.localeCompare(b.id))
    state.sessionStatus[sessionID] = { type: 'busy' }
    try {
      await (clientFor(input.directory).session as any).promptAsync({
        sessionID,
        directory: input.directory,
        agent: input.agent,
        model: input.model,
        messageID,
        system: input.system,
        tools: input.tools,
        parts: requestParts,
      })
      return { sessionID, messageID }
    } catch (error) {
      const hasConfirmedPart = optimisticParts.some(part => confirmedParts.has(part.id))
      if (!confirmedMessages.has(messageID) && !hasConfirmedPart) {
        state.messages[sessionID] = (state.messages[sessionID] ?? []).filter(item => item.id !== messageID)
        state.sessionStatus[sessionID] = { type: 'idle' }
      }
      const parts = (state.parts[messageID] ?? []).filter(part => confirmedParts.has(part.id))
      if (parts.length) state.parts[messageID] = parts
      else delete state.parts[messageID]
      throw error
    }
  }

  function setActiveDirectory(directory: string) {
    const next = String(directory || '').trim()
    if (activeDirectory.value !== next) {
      navigationGeneration++
      activeSessionId.value = ''
    }
    activeDirectory.value = next
  }

  function setActiveSession(sessionID: string) {
    const next = String(sessionID || '').trim()
    const owner = state.sessionInfo[next]?.directory
    navigationGeneration++
    activeSessionId.value = owner && owner !== activeDirectory.value ? '' : next
  }

  return {
    state,
    activeDirectory,
    activeSessionId,
    connected,
    connectionError,
    serverKey,
    isStreaming,
    chatMessages,
    activePermissions,
    activeQuestions,
    activeTodos,
    activeDiffs,
    applyServerEvent,
    registerClient,
    abortActiveSession,
    renameSession,
    deleteSession,
    updateSessionPermission,
    replyPermission,
    replyQuestion,
    rejectQuestion,
    connect,
    disconnect,
    ensureConnected,
    bootstrapDirectory,
    ensureSession,
    ensureSessionWithOwnership,
    cleanupCreatedSessionIfExclusive,
    openSession,
    newDraft,
    sessionsForDirectory,
    submitPrompt,
    setActiveDirectory,
    setActiveSession,
  }
})
