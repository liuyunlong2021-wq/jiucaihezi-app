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
  preview?: string
  agentId: string
  contextBoundaryMessageId?: string
  contextClearedAt?: number
  openCodeSessionId?: string
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

  function normalizePreviewText(value: unknown): string {
    return String(value || '')
      .replace(/\[MEDIA_TASK:[^\]]+\]/g, '媒体生成任务已提交')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '[图片]')
      .replace(/\[[^\]]+\]\([^)]+\)/g, '$1')
      .replace(/[#>*_`~|-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function buildPreview(messages: ChatMessage[]): string {
    const list = Array.isArray(messages) ? messages : []
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const message = list[index]
      if (!message || message.role === 'system' || message.role === 'tool') continue
      const text = normalizePreviewText(message.content)
      if (text) return text.slice(0, 96)
      if (message.images?.length) return `[图片] ${message.images.length} 张`
      if (message.files?.length) return `[文件] ${message.files.map(file => file.name).filter(Boolean).join('、')}`.slice(0, 96)
    }
    return ''
  }

  function buildPreviewFromStoredMessages(record: any): string {
    return Array.isArray(record?.items) ? buildPreview(record.items as ChatMessage[]) : ''
  }

  async function saveSessionPreview(
    sessionId: string,
    agentId: string,
    message: ChatMessage,
    options?: { openCodeSessionId?: string },
  ) {
    if (!sessionId) return
    const now = Date.now()
    const existingRecord = await idb.getRecord('conversations', sessionId) as any
    const existingMessages = await idb.getRecord('messages', sessionId) as any
    const existingCount = Array.isArray(existingMessages?.items) ? existingMessages.items.length : 0
    const preview = buildPreview([message])
    const title = existingRecord?.title || buildTitle([message])
    const createdAt = existingRecord?.createdAt || now

    const convRecord = {
      ...(existingRecord || {}),
      id: sessionId,
      scopeKey: agentId || existingRecord?.scopeKey || 'direct',
      sessionId,
      title,
      preview,
      kind: existingRecord?.kind || 'active',
      agentId: agentId || existingRecord?.agentId || '',
      openCodeSessionId: options?.openCodeSessionId || existingRecord?.openCodeSessionId,
      contextBoundaryMessageId: existingRecord?.contextBoundaryMessageId,
      contextClearedAt: existingRecord?.contextClearedAt,
      createdAt,
      updatedAt: now,
    }
    await idb.setRecord('conversations', convRecord)

    const existingIdx = sessions.value.findIndex(s => s.id === sessionId)
    const sessionMeta: Session = {
      id: sessionId,
      title,
      preview,
      agentId: agentId || existingRecord?.agentId || '',
      openCodeSessionId: options?.openCodeSessionId || existingRecord?.openCodeSessionId,
      contextBoundaryMessageId: existingRecord?.contextBoundaryMessageId,
      contextClearedAt: existingRecord?.contextClearedAt,
      createdAt: existingIdx >= 0 ? sessions.value[existingIdx].createdAt : createdAt,
      updatedAt: now,
      messageCount: Math.max(existingCount, existingIdx >= 0 ? sessions.value[existingIdx].messageCount : 0, 1),
    }
    if (existingIdx >= 0) {
      sessions.value[existingIdx] = sessionMeta
    } else {
      sessions.value.unshift(sessionMeta)
    }
    emitEvent('refresh-file-list', { category: 'history' })
    emitEvent('show-history-list', { sessionId })
  }

  // ─── 保存当前对话到 IndexedDB ───
  async function saveSession(
    sessionId: string,
    agentId: string,
    messages: ChatMessage[],
    options?: { openCodeSessionId?: string },
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
      preview: buildPreview(messages),
      kind: 'active',
      agentId: agentId || '',
      openCodeSessionId: options?.openCodeSessionId || existingRecord?.openCodeSessionId,
      contextBoundaryMessageId: existingRecord?.contextBoundaryMessageId,
      contextClearedAt: existingRecord?.contextClearedAt,
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
              sourceSessionId: sessionId,
              sourceMessageIds: [cleaned.id],
              metadata: { kind: 'chat-image', sessionId, messageId: cleaned.id, imageIndex: index },
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
      preview: buildPreview(messages),
      agentId: agentId || '',
      openCodeSessionId: options?.openCodeSessionId || existingRecord?.openCodeSessionId,
      contextBoundaryMessageId: existingRecord?.contextBoundaryMessageId,
      contextClearedAt: existingRecord?.contextClearedAt,
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
    emitEvent('show-history-list', { sessionId })
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
    const messagePreviews = new Map(
      messageRecords
        .filter((r: any) => r && r.id)
        .map((r: any) => [r.id, buildPreviewFromStoredMessages(r)])
    )
    sessions.value = records
      .filter((r: any) => r && r.id)
      .map((r: any) => ({
        id: r.id,
        title: r.title || '无主题对话',
        preview: r.preview || messagePreviews.get(r.id) || '',
        agentId: r.agentId || r.scopeKey || '',
        openCodeSessionId: r.openCodeSessionId,
        contextBoundaryMessageId: r.contextBoundaryMessageId,
        contextClearedAt: r.contextClearedAt,
        createdAt: r.createdAt || 0,
        updatedAt: r.updatedAt || 0,
        messageCount: messageCounts.get(r.id) || 0,
      }))
      .sort((a: Session, b: Session) => b.updatedAt - a.updatedAt)
  }

  // ─── 新建对话 ───
  function startNewSession(agentId: string): string {
    void agentId
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

  async function setContextBoundary(sessionId: string, boundaryMessageId: string, clearedAt: number) {
    const record = await idb.getRecord('conversations', sessionId) as any
    if (!record) return
    const now = Date.now()
    await idb.setRecord('conversations', {
      ...record,
      contextBoundaryMessageId: boundaryMessageId,
      contextClearedAt: clearedAt,
      updatedAt: now,
    })
    const idx = sessions.value.findIndex(s => s.id === sessionId)
    if (idx !== -1) {
      sessions.value[idx] = {
        ...sessions.value[idx],
        contextBoundaryMessageId: boundaryMessageId,
        contextClearedAt: clearedAt,
        updatedAt: now,
      }
    }
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

  // ─── 搜索消息内容（会话内搜索） ───
  async function searchMessages(query: string): Promise<{
    sessionId: string
    sessionTitle: string
    messageIds: string[]
    snippets: string[]
    matchCount: number
    updatedAt: number
  }[]> {
    if (!query.trim()) return []
    const q = query.toLowerCase().trim()

    // 获取消息记录（限制最近 50 个会话，每会话最多 200 条消息）
    const messageRecords = await idb.getAll('messages')
    const sortedRecords = messageRecords
      .filter((r: any) => r?.id && Array.isArray(r?.items))
      .sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 50)

    const results: {
      sessionId: string
      sessionTitle: string
      messageIds: string[]
      snippets: string[]
      matchCount: number
      updatedAt: number
    }[] = []

    for (const record of sortedRecords) {
      const items = (record.items as ChatMessage[]).slice(-200)
      const matchedMessageIds: string[] = []
      const snippets: string[] = []

      for (const msg of items) {
        if (!msg.content) continue
        const content = String(msg.content).toLowerCase()
        if (content.includes(q)) {
          matchedMessageIds.push(msg.id)
          // 提取包含关键词的片段（前后各 30 字符）
          const idx = content.indexOf(q)
          const start = Math.max(0, idx - 30)
          const end = Math.min(content.length, idx + q.length + 30)
          const raw = String(msg.content).substring(start, end)
          snippets.push((start > 0 ? '...' : '') + raw + (end < msg.content.length ? '...' : ''))
        }
      }

      if (matchedMessageIds.length > 0) {
        const session = sessions.value.find(s => s.id === record.id)
        results.push({
          sessionId: String(record.id),
          sessionTitle: session?.title || '无主题对话',
          messageIds: matchedMessageIds.slice(0, 5),
          snippets: snippets.slice(0, 5),
          matchCount: matchedMessageIds.length,
          updatedAt: session?.updatedAt || record.updatedAt || 0,
        })
      }
    }

    return results.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20)
  }

  return {
    sessions,
    activeSessionId,
    createSessionId,
    buildTitle,
    saveSession,
    saveSessionPreview,
    loadSessionMessages,
    loadAllSessions,
    startNewSession,
    switchSession,
    setContextBoundary,
    deleteSession,
    renameSession,
    searchMessages,
  }
})
