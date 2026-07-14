/**
 * useFileStore.ts — 统一文件存储层（IndexedDB documents store）
 *
 * 所有文件（文本、图片、视频、Skill、历史、画布）统一存储，用 category 区分。
 */
import { ref } from 'vue'
import { getAll, getAllByIndex, setRecord, removeRecord, getRecord } from '@/utils/idb'
import type { ChatMessage } from '@/composables/useChat'
import type { SkillConfig } from '@/types/skill'
import { serializeToSkillMd } from '@/types/skill'

export interface FileEntry {
  id: string
  category: 'text' | 'image' | 'video' | 'audio' | 'binary' | 'skill' | 'history' | 'project'
  name: string
  content: string
  mimeType: string
  size: number
  createdAt: number
  updatedAt: number
  folderId?: string
  kind?: 'raw' | 'summary' | 'page' | 'entity' | 'relation' | 'asset'
  sourceSessionId?: string
  sourceMessageIds?: string[]
  skillId?: string
  indexed?: boolean
  topic?: string
  metadata?: Record<string, unknown>
}

const STORE = 'documents'
const HISTORY_DOC_PREFIX = 'history_'
const SKILL_FOLDER_PREFIX = 'skill_folder_'
const SKILL_CORE_PREFIX = 'skill_core_'

function toSafeDocId(prefix: string, id: string): string {
  return prefix + encodeURIComponent(id)
}

function collectDescendantEntries(folderId: string, all: FileEntry[]): FileEntry[] {
  const result: FileEntry[] = []
  const stack = all.filter(entry => entry.folderId === folderId)
  while (stack.length) {
    const current = stack.shift()!
    result.push(current)
    if (current.mimeType === 'folder') {
      stack.push(...all.filter(entry => entry.folderId === current.id))
    }
  }
  return result
}

function buildHistoryMarkdown(conversation: any, messages: ChatMessage[]): string {
  const title = conversation.title || '未命名对话'
  const parts = [`# ${title}`]
  for (const msg of messages) {
    const role = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? '助手' : msg.role
    const body = String(msg.content || '').trim()
    if (!body) continue
    parts.push(`**${role}**:\n${body}`)
  }
  return parts.join('\n\n---\n\n')
}

export function useFileStore() {
  const files = ref<FileEntry[]>([])
  const loading = ref(false)

  async function loadAll() {
    loading.value = true
    try {
      const all = await getAll(STORE) as FileEntry[]
      files.value = all.filter(f => f.category)
    } catch { files.value = [] }
    loading.value = false
  }

  async function loadByCategory(category: FileEntry['category']): Promise<FileEntry[]> {
    // P0-2: 走 category 投影列索引（不回退全表扫，防 1.34GB OOM）
    const indexed = await getAllByIndex(STORE, 'category', category) as FileEntry[]
    return indexed
  }

  async function loadBySkillId(skillId: string): Promise<FileEntry[]> {
    const all = await getAll(STORE) as FileEntry[]
    return all.filter(f => f.skillId === skillId)
  }

  async function addFile(entry: Omit<FileEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<FileEntry> {
    const file: FileEntry = {
      ...entry,
      id: `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await setRecord(STORE, file)
    return file
  }

  async function updateFile(id: string, patch: Partial<FileEntry>) {
    const existing = await getRecord(STORE, id) as FileEntry | undefined
    if (!existing) return
    const allBefore = await getAll(STORE) as FileEntry[]

    const updated = { ...existing, ...patch, updatedAt: Date.now() }
    const allAfter = allBefore.map(file => file.id === id ? updated : file)
    await setRecord(STORE, updated)

    void allAfter
  }

  async function deleteFile(id: string) {
    const entry = await getRecord(STORE, id) as FileEntry | undefined
    const all = await getAll(STORE) as FileEntry[]
    const descendants = entry?.mimeType === 'folder' ? collectDescendantEntries(entry.id, all) : []
    for (const descendant of descendants) {
      await removeRecord(STORE, descendant.id)
    }
    await removeRecord(STORE, id)
  }

  async function syncHistoryFromSessions(): Promise<number> {
    const conversations = await getAll('conversations')
    const messagesData = await getAll('messages')
    const existingDocs = await loadByCategory('history')
    const activeIds = new Set<string>()
    let count = 0

    for (const conversation of conversations) {
      if (!conversation?.id) continue
      const messageRecord = messagesData.find((m: any) => m.id === conversation.id)
      const messages = Array.isArray(messageRecord?.items) ? messageRecord.items : []
      const id = toSafeDocId(HISTORY_DOC_PREFIX, conversation.id)
      const existing = existingDocs.find(f => f.id === id)
      const content = buildHistoryMarkdown(conversation, messages)
      const updated: FileEntry = {
        id,
        category: 'history',
        name: conversation.title || '历史会话',
        content,
        mimeType: 'text/markdown',
        size: new TextEncoder().encode(content).length,
        createdAt: existing?.createdAt || conversation.createdAt || Date.now(),
        updatedAt: conversation.updatedAt || Date.now(),
        kind: 'raw',
        sourceSessionId: conversation.id,
        sourceMessageIds: messages.map((message: ChatMessage) => message.id).filter(Boolean),
        metadata: {
          ...(existing?.metadata || {}),
          kind: 'session-history',
          originalId: conversation.id,
          agentId: conversation.agentId || conversation.scopeKey || '',
          messageCount: messages.length,
        },
      }
      await setRecord(STORE, updated)
      activeIds.add(id)
      count++
    }

    for (const doc of existingDocs) {
      if (doc.metadata?.kind === 'session-history' && !activeIds.has(doc.id)) {
        await deleteFile(doc.id)
      }
    }
    return count
  }

  async function syncSkillsFromStore(skills: SkillConfig[]): Promise<number> {
    const existingDocs = await loadByCategory('skill')
    const activeSkillIds = new Set(skills.map(s => s.id))
    let count = 0

    for (const skill of skills) {
      const folderId = toSafeDocId(SKILL_FOLDER_PREFIX, skill.id)
      const coreId = toSafeDocId(SKILL_CORE_PREFIX, skill.id)
      const existingFolder = existingDocs.find(f => f.id === folderId)
      const skillMd = serializeToSkillMd(skill)
      const folder: FileEntry = {
        id: folderId,
        category: 'skill',
        name: skill.name,
        content: '',
        mimeType: 'folder',
        size: 0,
        createdAt: existingFolder?.createdAt || skill.createdAt || Date.now(),
        updatedAt: skill.updatedAt || Date.now(),
        metadata: {
          ...(existingFolder?.metadata || {}),
          kind: 'skill-folder',
          isFolder: true,
          children: [coreId],
          skillId: skill.id,
        },
      }
      const coreFile: FileEntry = {
        id: coreId,
        category: 'skill',
        name: 'SKILL.md',
        content: skillMd,
        mimeType: 'text/markdown',
        size: new TextEncoder().encode(skillMd).length,
        createdAt: existingDocs.find(f => f.id === coreId)?.createdAt || skill.createdAt || Date.now(),
        updatedAt: skill.updatedAt || Date.now(),
        folderId,
        metadata: {
          kind: 'skill-core',
          isSkillCore: true,
          skillId: skill.id,
        },
      }
      await setRecord(STORE, folder)
      await setRecord(STORE, coreFile)
      count++
    }

    for (const doc of existingDocs) {
      const skillId = String(doc.metadata?.skillId || '')
      const isManagedSkillDoc = doc.metadata?.kind === 'skill-folder' || doc.metadata?.kind === 'skill-core'
      if (isManagedSkillDoc && skillId && !activeSkillIds.has(skillId)) {
        await deleteFile(doc.id)
      }
    }
    return count
  }

  async function deleteByCategory(category: FileEntry['category']) {
    const all = await loadByCategory(category)
    for (const f of all) {
      await deleteFile(f.id)
    }
  }

  async function getFile(id: string): Promise<FileEntry | undefined> {
    return await getRecord(STORE, id) as FileEntry | undefined
  }

  // 快捷方法：添加文本文件
  async function addText(name: string, content: string): Promise<FileEntry> {
    return addFile({
      category: 'text',
      name,
      content,
      mimeType: 'text/plain',
      size: new TextEncoder().encode(content).length,
    })
  }

  // 快捷方法：添加媒体文件
  async function addMedia(
    name: string,
    url: string,
    type: 'image' | 'video' | 'audio' | 'text',
    mimeType: string,
    metadata?: Record<string, unknown>,
  ): Promise<FileEntry> {
    return addFile({
      category: type,
      name,
      content: url,
      mimeType,
      size: 0,
      metadata,
    })
  }

  /** 追加内容到已有文件（用于对话记录增量追加） */
  async function appendToFile(fileId: string, content: string): Promise<void> {
    const existing = await getFile(fileId)
    if (!existing) return
    const newContent = existing.content + content
    await updateFile(fileId, {
      content: newContent,
      size: new TextEncoder().encode(newContent).length,
    })
  }

  return {
    files,
    loading,
    loadAll,
    loadByCategory,
    loadBySkillId,
    syncHistoryFromSessions,
    syncSkillsFromStore,
    addFile,
    addText,
    
    addMedia,
    updateFile,
    deleteFile,
    deleteByCategory,
    getFile,
    appendToFile,
  }
}
