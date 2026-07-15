import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import * as idb from '@/utils/idb'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { useProjectStore } from '@/stores/projectStore'
import type { ChatMessage } from '@/composables/useChat'

export interface CreativeSession {
  id: string
  title: string
  preview: string
  projectId: string
  createdAt: number
  updatedAt: number
}

function titleFor(messages: ChatMessage[]): string {
  return messages.find(message => message.role === 'user' && message.content.trim())?.content.replace(/[\n\r]/g, ' ').trim().slice(0, 50)
    || '无主题对话'
}

function previewFor(messages: ChatMessage[]): string {
  for (const message of [...messages].reverse()) {
    if (message.role === 'system' || message.role === 'tool') continue
    const content = message.content.replace(/\s+/g, ' ').trim()
    if (content) return content.slice(0, 96)
  }
  return ''
}

export const useCreativeSessionStore = defineStore('creativeSessions', () => {
  const projectStore = useProjectStore()
  const sessions = ref<CreativeSession[]>([])
  const currentProjectId = computed(() => isTauriRuntime()
    ? projectStore.projectDir.value
    : projectStore.webProjectId.value)
  const activeSessionId = ref('')
  const sessionProjectIds = new Map<string, string>()
  const projectSessions = computed(() => sessions.value.filter(session => session.projectId === currentProjectId.value))

  function activeSessionKey() {
    return currentProjectId.value ? `jc_creative_active_session:${currentProjectId.value}` : 'jc_creative_active_session'
  }

  function restoreActiveSession() {
    activeSessionId.value = currentProjectId.value ? localStorage.getItem(activeSessionKey()) || '' : ''
  }

  watch(currentProjectId, restoreActiveSession, { immediate: true, flush: 'sync' })

  function createSessionId() {
    return `creative_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  function createPendingSession(): string {
    if (!currentProjectId.value) return ''
    const id = createSessionId()
    sessionProjectIds.set(id, currentProjectId.value)
    return id
  }

  function startNewSession(): string {
    const id = createPendingSession()
    if (!id) return ''
    switchSession(id)
    return id
  }

  function switchSession(sessionId: string) {
    const id = String(sessionId || '').trim()
    activeSessionId.value = id
    if (id) localStorage.setItem(activeSessionKey(), id)
    else localStorage.removeItem(activeSessionKey())
  }

  async function loadAllSessions() {
    const records = await idb.getAll('conversations')
    sessions.value = records
      .filter((record: any) => record?.scopeKey === 'creative' && record.id && !String(record.id).startsWith('ses_'))
      .map((record: any): CreativeSession => ({
        id: record.id,
        title: record.title || '无主题对话',
        preview: record.preview || '',
        projectId: record.projectId || '',
        createdAt: record.createdAt || 0,
        updatedAt: record.updatedAt || 0,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    for (const session of sessions.value) sessionProjectIds.set(session.id, session.projectId)
  }

  async function saveSession(sessionId: string, messages: ChatMessage[]) {
    const id = String(sessionId || '').trim()
    if (!id.startsWith('creative_') || messages.length === 0) return
    const existing = await idb.getRecord('conversations', id) as any
    const projectId = String(existing?.projectId || sessionProjectIds.get(id) || currentProjectId.value || '')
    if (!projectId) return
    sessionProjectIds.set(id, projectId)
    const now = Date.now()
    const record = {
      id,
      sessionId: id,
      scopeKey: 'creative',
      projectId,
      title: existing?.title || titleFor(messages),
      preview: previewFor(messages),
      kind: 'active',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    }
    await idb.setRecord('conversations', record)
    await idb.setRecord('messages', { id, conversationId: id, items: messages, updatedAt: now })

    const index = sessions.value.findIndex(session => session.id === id)
    const session: CreativeSession = {
      id,
      title: record.title,
      preview: record.preview,
      projectId,
      createdAt: record.createdAt,
      updatedAt: now,
    }
    if (index >= 0) sessions.value[index] = session
    else sessions.value.unshift(session)
  }

  async function loadSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    const record = await idb.getRecord('messages', sessionId) as any
    return Array.isArray(record?.items) ? record.items : []
  }

  async function deleteSession(sessionId: string) {
    await idb.removeRecord('conversations', sessionId)
    await idb.removeRecord('messages', sessionId)
    sessions.value = sessions.value.filter(session => session.id !== sessionId)
    sessionProjectIds.delete(sessionId)
    if (activeSessionId.value === sessionId) switchSession('')
  }

  async function renameSession(sessionId: string, title: string) {
    const record = await idb.getRecord('conversations', sessionId) as any
    if (!record?.scopeKey || record.scopeKey !== 'creative') return
    const updatedAt = Date.now()
    await idb.setRecord('conversations', { ...record, title, updatedAt })
    const index = sessions.value.findIndex(session => session.id === sessionId)
    if (index >= 0) sessions.value[index] = { ...sessions.value[index], title, updatedAt }
  }

  return {
    sessions,
    activeSessionId,
    currentProjectId,
    projectSessions,
    createSessionId,
    createPendingSession,
    startNewSession,
    switchSession,
    loadAllSessions,
    saveSession,
    loadSessionMessages,
    deleteSession,
    renameSession,
  }
})
