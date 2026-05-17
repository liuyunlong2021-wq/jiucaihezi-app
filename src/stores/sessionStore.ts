/**
 * stores/sessionStore.ts — 对话历史管理 Store
 * 源自 code.html:
 *   - Chat History V3 (行 4809-4940)
 *   - saveChatHistory / loadChatHistory
 *   - buildConversationTitleFromMessages (行 4868-4881)
 *   - createConversationSessionId (行 4859-4861)
 *   - syncChatToCloud (行 2183-2208)
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as idb from '@/utils/idb'
import { emitEvent } from '@/utils/eventBus'
import type { ChatMessage } from '@/composables/useChat'

export interface Session {
  id: string
  title: string
  agentId: string
  vaultId: string | null
  contextPolicy: 'vault-only' | 'no-memory'
  createdAt: number
  updatedAt: number
  messageCount: number
}

const IMAGE_REF_PREFIX = 'jc-doc://'

export const useSessionStore = defineStore('sessions', () => {
  const sessions = ref<Session[]>([])
  // 从 localStorage 恢复上次的 activeSessionId
  const activeSessionId = ref<string>(localStorage.getItem('jc_active_session') || '')

  // ─── createConversationSessionId — 行 4859-4861 ───
  function createSessionId(): string {
    return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
  }

  // ─── buildConversationTitleFromMessages — 行 4868-4881 ───
  function buildTitle(messages: ChatMessage[], fallback?: string): string {
    const list = Array.isArray(messages) ? messages : []
    // 先找用户消息
    for (const item of list) {
      const content = String(item?.content || '').replace(/[\n\r]/g, ' ').trim()
      if (content && item.role === 'user') return content.substring(0, 50)
    }
    // 再找任意消息
    for (const item of list) {
      const content = String(item?.content || '').replace(/[\n\r]/g, ' ').trim()
      if (content) return content.substring(0, 50)
    }
    return String(fallback || '无主题对话')
  }

  // ─── 保存当前对话到 IndexedDB ───
  async function saveSession(
    sessionId: string,
    agentId: string,
    messages: ChatMessage[],
    vaultId: string | null = null,
    contextPolicy: Session['contextPolicy'] = vaultId ? 'vault-only' : 'no-memory',
  ) {
    if (!messages.length) return

    const title = buildTitle(messages)
    const now = Date.now()
    const existingRecord = await idb.getRecord('conversations', sessionId) as any

    // 保存 conversation 元数据
    const convRecord = {
      id: sessionId,
      scopeKey: agentId || 'direct',
      sessionId,
      title,
      kind: 'active',
      agentId: agentId || '',
      vaultId,
      contextPolicy,
      createdAt: existingRecord?.createdAt || now,
      updatedAt: now,
    }
    await idb.setRecord('conversations', convRecord)

    // 保存消息（base64 图片单独转存到 documents，避免消息记录无限膨胀）
    const cleanMessages = await Promise.all(messages.map(async (m) => {
      const cleaned = { ...m }
      if (cleaned.images?.length) {
        cleaned.images = await Promise.all(cleaned.images.map(async (img, index) => {
          if (!img.startsWith('data:')) return img
          const imageId = `chat_image_${sessionId}_${cleaned.id}_${index}`
          try {
            const existing = await idb.getRecord('documents', imageId)
            await idb.setRecord('documents', {
              ...(existing || {}),
              id: imageId,
              category: 'image',
              name: `聊天图片_${index + 1}`,
              content: img,
              mimeType: img.match(/^data:([^;]+);/)?.[1] || 'image/png',
              size: img.length,
              createdAt: existing?.createdAt || now,
              updatedAt: now,
              vaultId,
              sourceSessionId: sessionId,
              sourceMessageIds: [cleaned.id],
              metadata: { kind: 'chat-image', sessionId, messageId: cleaned.id, imageIndex: index, vaultId },
            })
            return `${IMAGE_REF_PREFIX}${imageId}`
          } catch {
            return img
          }
        }))
      }
      return cleaned
    }))
    const msgRecord = {
      id: sessionId,
      conversationId: sessionId,
      items: cleanMessages,
      updatedAt: now,
    }
    await idb.setRecord('messages', msgRecord)

    // 更新内存列表
    const existingIdx = sessions.value.findIndex(s => s.id === sessionId)
    const sessionMeta: Session = {
      id: sessionId,
      title,
      agentId: agentId || '',
      vaultId,
      contextPolicy,
      createdAt: existingIdx >= 0 ? sessions.value[existingIdx].createdAt : now,
      updatedAt: now,
      messageCount: messages.length,
    }
    if (existingIdx >= 0) {
      sessions.value[existingIdx] = sessionMeta
    } else {
      sessions.value.unshift(sessionMeta)
    }
    emitEvent('refresh-file-list', { category: 'history' })
  }

  // ─── 加载对话消息 ───
  async function loadSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    const record = await idb.getRecord('messages', sessionId)
    if (record && Array.isArray(record.items)) {
      return await Promise.all(record.items.map(async (m: ChatMessage) => {
        if (!m.images?.length) return m
        const restored = { ...m }
        restored.images = await Promise.all(m.images.map(async (img) => {
          if (!img.startsWith(IMAGE_REF_PREFIX)) return img
          const imageId = img.slice(IMAGE_REF_PREFIX.length)
          const file = await idb.getRecord('documents', imageId)
          return file?.content || ''
        }))
        restored.images = restored.images.filter(Boolean)
        return restored
      }))
    }
    return []
  }

  // ─── 加载所有对话列表 ───
  async function loadAllSessions() {
    const records = await idb.getAll('conversations')
    const messageRecords = await idb.getAll('messages')
    const messageCounts = new Map(
      messageRecords
        .filter((r: any) => r && r.id)
        .map((r: any) => [r.id, Array.isArray(r.items) ? r.items.length : 0])
    )
    sessions.value = records
      .filter((r: any) => r && r.id)
      .map((r: any) => ({
        id: r.id,
        title: r.title || '无主题对话',
        agentId: r.agentId || r.scopeKey || '',
        vaultId: r.vaultId || null,
        contextPolicy: r.contextPolicy || (r.vaultId ? 'vault-only' : 'no-memory'),
        createdAt: r.createdAt || 0,
        updatedAt: r.updatedAt || 0,
        messageCount: messageCounts.get(r.id) || 0,
      }))
      .sort((a: Session, b: Session) => b.updatedAt - a.updatedAt)
  }

  // ─── 新建对话 ───
  function startNewSession(agentId: string, vaultId: string | null = null): string {
    const id = createSessionId()
    activeSessionId.value = id
    localStorage.setItem('jc_active_session', id)
    return id
  }

  // ─── 切换对话 ───
  function switchSession(sessionId: string) {
    activeSessionId.value = sessionId
    localStorage.setItem('jc_active_session', sessionId)
  }

  // ─── 删除对话 ───
  async function deleteSession(sessionId: string) {
    await idb.removeRecord('conversations', sessionId)
    await idb.removeRecord('messages', sessionId)
    const docs = await idb.getAll('documents')
    const chatImages = docs.filter((d: any) => d?.metadata?.kind === 'chat-image' && d.metadata.sessionId === sessionId)
    for (const doc of chatImages) {
      await idb.removeRecord('documents', doc.id)
    }
    sessions.value = sessions.value.filter(s => s.id !== sessionId)
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = ''
      localStorage.removeItem('jc_active_session')
    }
    emitEvent('refresh-file-list', { category: 'history' })
  }

  // ─── 重命名对话 ───
  async function renameSession(sessionId: string, newTitle: string) {
    const record = await idb.getRecord('conversations', sessionId) as any
    if (record) {
      record.title = newTitle
      record.updatedAt = Date.now()
      await idb.setRecord('conversations', record)
    }
    const idx = sessions.value.findIndex(s => s.id === sessionId)
    if (idx !== -1) sessions.value[idx].title = newTitle
    emitEvent('refresh-file-list', { category: 'history' })
  }

  return {
    sessions,
    activeSessionId,
    createSessionId,
    buildTitle,
    saveSession,
    loadSessionMessages,
    loadAllSessions,
    startNewSession,
    switchSession,
    deleteSession,
    renameSession,
  }
})
