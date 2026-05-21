/**
 * useFileStore.ts — 统一文件存储层（IndexedDB documents store）
 *
 * 所有文件（文本、图片、视频、知识库、搭子）统一存储，用 category 区分。
 */
import { ref } from 'vue'
import { getAll, setRecord, removeRecord, getRecord } from '@/utils/idb'
import type { ChatMessage } from '@/composables/useChat'
import type { SkillConfig } from '@/types/skill'
import { serializeToSkillMd } from '@/types/skill'
import { syncEntryToDisk, isDesktop, ensureVaultOnDisk, inferRelativePath } from '@/utils/vaultFs'
import { normalizeVaultLookupPath, vaultRootFolderTypeForPath, type VaultRootFolderType } from '@/utils/vaultPath'
import { shouldSyncVaultEntryToDisk } from '@/utils/vaultSyncScope'
import {
  buildConversationRawFileName,
  buildConversationRawMarkdown,
  collectConversationRawMessageIds,
  shouldSyncConversationRaw,
} from '@/utils/conversationRaw'

export interface FileStoreTreeNode {
  entry: FileEntry
  children: FileStoreTreeNode[]
}

export interface FileEntry {
  id: string
  category: 'text' | 'image' | 'video' | 'knowledge' | 'skill' | 'history'
  name: string
  content: string
  mimeType: string
  size: number
  createdAt: number
  updatedAt: number
  folderId?: string
  vaultId?: string
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

function inferMetadataFolderPath(entry: FileEntry, allEntries: FileEntry[]): string {
  const relativePath = inferRelativePath(entry, allEntries)
  if (entry.mimeType === 'folder') return normalizeVaultLookupPath(relativePath)
  const slash = relativePath.lastIndexOf('/')
  return slash >= 0 ? normalizeVaultLookupPath(relativePath.slice(0, slash)) : ''
}

function withSyncedVaultPathMetadata(entry: FileEntry, allEntries: FileEntry[]): FileEntry {
  if (entry.category !== 'knowledge' || !entry.vaultId) return entry
  const folderPath = inferMetadataFolderPath(entry, allEntries)
  if (!folderPath) return entry
  const rootType = vaultRootFolderTypeForPath(folderPath)
  return {
    ...entry,
    metadata: {
      ...(entry.metadata || {}),
      folderPath,
      ...(rootType ? { vaultFolder: rootType } : {}),
    },
  }
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

  async function loadByCategory(category: FileEntry['category'], vaultId?: string | null): Promise<FileEntry[]> {
    const all = await getAll(STORE) as FileEntry[]
    return all.filter(f => f.category === category && (vaultId === undefined || f.vaultId === (vaultId || undefined)))
  }

  async function loadBySkillId(skillId: string): Promise<FileEntry[]> {
    const all = await getAll(STORE) as FileEntry[]
    return all.filter(f => f.skillId === skillId)
  }

  async function loadByVault(vaultId: string): Promise<FileEntry[]> {
    const all = await getAll(STORE) as FileEntry[]
    return all.filter(f => f.vaultId === vaultId)
  }

  async function loadUnindexed(vaultId?: string): Promise<FileEntry[]> {
    const all = await getAll(STORE) as FileEntry[]
    return all.filter(f => f.category === 'knowledge' && f.indexed === false && (vaultId ? f.vaultId === vaultId : true))
  }

  async function addFile(entry: Omit<FileEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<FileEntry> {
    const file: FileEntry = {
      ...entry,
      id: `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await setRecord(STORE, file)
    // 桌面端：同步写入真实文件系统
    if (isDesktop() && file.vaultId && file.category === 'knowledge') {
      const all = await getAll(STORE) as FileEntry[]
      await syncEntryToDisk('write', file, all).catch(err => console.warn('[VaultFS] 同步写入失败:', err))
    }
    return file
  }

  async function updateFile(id: string, patch: Partial<FileEntry>) {
    const existing = await getRecord(STORE, id) as FileEntry | undefined
    if (!existing) return
    const allBefore = await getAll(STORE) as FileEntry[]
    const pathChanged = existing.category === 'knowledge' && existing.vaultId && (
      (patch.name !== undefined && patch.name !== existing.name) ||
      (patch.folderId !== undefined && patch.folderId !== existing.folderId)
    )
    if (isDesktop() && pathChanged) {
      await syncEntryToDisk('delete', existing, allBefore).catch(err => console.warn('[VaultFS] 删除旧路径失败:', err))
    }

    let updated = { ...existing, ...patch, updatedAt: Date.now() }
    let allAfter = allBefore.map(file => file.id === id ? updated : file)
    updated = withSyncedVaultPathMetadata(updated, allAfter)
    allAfter = allAfter.map(file => file.id === id ? updated : file)
    await setRecord(STORE, updated)

    const changedDescendants = pathChanged && existing.mimeType === 'folder'
      ? collectDescendantEntries(existing.id, allBefore)
      : []
    const syncedDescendants: FileEntry[] = []
    for (const descendant of changedDescendants) {
      const synced = withSyncedVaultPathMetadata(descendant, allAfter)
      await setRecord(STORE, synced)
      syncedDescendants.push(synced)
      allAfter = allAfter.map(file => file.id === synced.id ? synced : file)
    }

    // 桌面端：同步更新真实文件
    if (isDesktop() && updated.vaultId && updated.category === 'knowledge') {
      await syncEntryToDisk('write', updated, allAfter).catch(err => console.warn('[VaultFS] 同步更新失败:', err))
      for (const descendant of syncedDescendants) {
        await syncEntryToDisk('write', descendant, allAfter).catch(err => console.warn('[VaultFS] 同步子文件失败:', err))
      }
    }
  }

  async function deleteFile(id: string) {
    const entry = await getRecord(STORE, id) as FileEntry | undefined
    const all = await getAll(STORE) as FileEntry[]
    // 桌面端：先读取条目信息再删除
    if (isDesktop() && entry?.vaultId && entry.category === 'knowledge') {
      await syncEntryToDisk('delete', entry, all).catch(err => console.warn('[VaultFS] 同步删除失败:', err))
    }
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
        vaultId: conversation.vaultId || undefined,
        kind: 'raw',
        sourceSessionId: conversation.id,
        sourceMessageIds: messages.map((message: ChatMessage) => message.id).filter(Boolean),
        metadata: {
          ...(existing?.metadata || {}),
          kind: 'session-history',
          originalId: conversation.id,
          agentId: conversation.agentId || conversation.scopeKey || '',
          vaultId: conversation.vaultId || null,
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

  async function syncSessionToVaultRaw(opts: {
    vaultId?: string | null
    sessionId: string
    messages: ChatMessage[]
    title?: string
  }): Promise<FileEntry | null> {
    if (!shouldSyncConversationRaw(opts)) return null

    const vaultId = opts.vaultId!
    let chatLogFolder = await findFolderByPath(vaultId, 'raw/对话记录')
    if (!chatLogFolder) {
      let rawFolder = await findVaultRootFolder(vaultId, 'raw')
      if (!rawFolder) {
        rawFolder = await addFile({
          category: 'knowledge',
          name: 'raw',
          content: '',
          mimeType: 'folder',
          size: 0,
          vaultId,
          metadata: { vaultFolder: 'raw', isFolder: true },
        })
      }
      chatLogFolder = await createFolder('对话记录', rawFolder.id, vaultId)
    }

    const fileName = buildConversationRawFileName(opts.sessionId)
    const content = buildConversationRawMarkdown({
      sessionId: opts.sessionId,
      title: opts.title,
      messages: opts.messages,
      updatedAt: Date.now(),
    })
    const messageIds = collectConversationRawMessageIds(opts.messages)
    const children = await getChildren(chatLogFolder.id, vaultId)
    const existing = children.find(file =>
      file.name === fileName &&
      file.mimeType !== 'folder' &&
      file.sourceSessionId === opts.sessionId
    )

    const patch = {
      content,
      size: new TextEncoder().encode(content).length,
      indexed: false,
      sourceSessionId: opts.sessionId,
      sourceMessageIds: messageIds,
      metadata: {
        ...(existing?.metadata || {}),
        vaultFolder: 'raw',
        kind: 'conversation-log',
        storageMode: 'session-file',
        sessionId: opts.sessionId,
      },
    }

    if (existing) {
      await updateFile(existing.id, patch)
      return { ...existing, ...patch, updatedAt: Date.now() }
    }

    return await addFile({
      category: 'knowledge',
      name: fileName,
      content,
      mimeType: 'text/markdown',
      size: new TextEncoder().encode(content).length,
      vaultId,
      folderId: chatLogFolder.id,
      kind: 'raw',
      indexed: false,
      sourceSessionId: opts.sessionId,
      sourceMessageIds: messageIds,
      metadata: {
        vaultFolder: 'raw',
        kind: 'conversation-log',
        storageMode: 'session-file',
        sessionId: opts.sessionId,
      },
    })
  }

  async function syncVaultKnowledgeToDisk(vaults: Array<{
    id: string
    enhancement?: { folderSemantics?: Record<string, unknown> }
  }> = []): Promise<number> {
    if (!isDesktop()) return 0
    const all = await getAll(STORE) as FileEntry[]
    const scopedVaultIds = new Set(vaults.map(vault => vault.id))

    for (const vault of vaults) {
      await ensureVaultOnDisk(vault.id).catch(err => console.warn('[VaultFS] 创建知识库目录失败:', err))
    }

    let count = 0
    for (const entry of all) {
      if (!shouldSyncVaultEntryToDisk(entry, scopedVaultIds)) continue
      const entryVaultId = entry.vaultId!
      await ensureVaultOnDisk(entryVaultId).catch(err => console.warn('[VaultFS] 创建知识库目录失败:', err))
      await syncEntryToDisk('write', entry, all).catch(err => console.warn('[VaultFS] 同步知识库条目失败:', err))
      count++
    }
    return count
  }

  async function deleteByCategory(category: FileEntry['category']) {
    const all = await loadByCategory(category)
    for (const f of all) {
      await deleteFile(f.id)
    }
  }

  async function deleteByVault(vaultId: string): Promise<number> {
    const all = await loadByVault(vaultId)
    let count = 0
    for (const entry of all) {
      await removeRecord(STORE, entry.id)
      count++
    }
    return count
  }

  async function getFile(id: string): Promise<FileEntry | undefined> {
    return await getRecord(STORE, id) as FileEntry | undefined
  }

  // 快捷方法：添加知识库条目
  async function addKnowledge(opts: {
    name: string
    content: string
    topic?: string
    skillId?: string
    vaultId?: string
    kind?: FileEntry['kind']
    sourceSessionId?: string
    sourceMessageIds?: string[]
    indexed?: boolean
    metadata?: Record<string, unknown>
  }): Promise<FileEntry> {
    return addFile({
      category: 'knowledge',
      name: opts.name,
      content: opts.content,
      mimeType: 'text/plain',
      size: new TextEncoder().encode(opts.content).length,
      topic: opts.topic,
      skillId: opts.skillId,
      vaultId: opts.vaultId,
      kind: opts.kind,
      sourceSessionId: opts.sourceSessionId,
      sourceMessageIds: opts.sourceMessageIds,
      indexed: opts.indexed ?? false,
      metadata: opts.metadata,
    })
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
  async function addMedia(name: string, url: string, type: 'image' | 'video', mimeType: string): Promise<FileEntry> {
    return addFile({
      category: type,
      name,
      content: url,
      mimeType,
      size: 0,
    })
  }

  // ─── 文件夹辅助函数（知识库三层结构用） ───

  /** 根据 vaultId 和 metadata.vaultFolder 找到 raw/ 或 wiki/ 根文件夹 */
  async function findVaultRootFolder(vaultId: string, folderType: VaultRootFolderType): Promise<FileEntry | undefined> {
    const all = await loadByVault(vaultId)
    return all.find(f => f.mimeType === 'folder' && f.metadata?.vaultFolder === folderType && !f.folderId)
  }

  /** 在指定父文件夹下按名称查找子文件夹 */
  async function findChildFolder(parentFolderId: string, name: string, vaultId: string): Promise<FileEntry | undefined> {
    const all = await loadByVault(vaultId)
    return all.find(f => f.mimeType === 'folder' && f.folderId === parentFolderId && f.name === name)
  }

  /** 按路径（如 "raw/对话记录"）在 vault 中查找文件夹 */
  async function findFolderByPath(vaultId: string, path: string): Promise<FileEntry | undefined> {
    const parts = normalizeVaultLookupPath(path).split('/').filter(Boolean)
    if (parts.length === 0) return undefined

    const rootType = vaultRootFolderTypeForPath(path)
    if (!rootType) return undefined
    const root = await findVaultRootFolder(vaultId, rootType)
    if (!root || parts.length === 1) return root

    // 后续级别
    let current = root
    for (let i = 1; i < parts.length; i++) {
      const child = await findChildFolder(current.id, parts[i], vaultId)
      if (!child) return undefined
      current = child
    }
    return current
  }

  /** 创建子文件夹 */
  async function createFolder(
    name: string,
    parentFolderId: string,
    vaultId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<FileEntry> {
    return addFile({
      category: 'knowledge',
      name,
      content: '',
      mimeType: 'folder',
      size: 0,
      vaultId,
      folderId: parentFolderId,
      metadata: { isFolder: true, ...metadata },
    })
  }

  /** 获取文件夹下所有直接子项 */
  async function getChildren(folderId: string, vaultId: string): Promise<FileEntry[]> {
    const all = await loadByVault(vaultId)
    return all.filter(f => f.folderId === folderId)
  }

  /** 获取 vault 的完整文件树（递归） */
  async function getVaultTree(vaultId: string): Promise<FileStoreTreeNode[]> {
    const all = await loadByVault(vaultId)
    const byParent = new Map<string, FileEntry[]>()

    // 根节点 = 没有 folderId 的项
    const roots: FileEntry[] = []
    for (const f of all) {
      if (!f.folderId) {
        roots.push(f)
      } else {
        const list = byParent.get(f.folderId) || []
        list.push(f)
        byParent.set(f.folderId, list)
      }
    }

    function buildTree(entries: FileEntry[]): FileStoreTreeNode[] {
      return entries
        .sort((a, b) => {
          // 文件夹在前
          if (a.mimeType === 'folder' && b.mimeType !== 'folder') return -1
          if (a.mimeType !== 'folder' && b.mimeType === 'folder') return 1
          return a.name.localeCompare(b.name, 'zh-CN')
        })
        .map(entry => ({
          entry,
          children: entry.mimeType === 'folder' ? buildTree(byParent.get(entry.id) || []) : [],
        }))
    }

    return buildTree(roots)
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
    loadByVault,
    loadUnindexed,
    syncHistoryFromSessions,
    syncSkillsFromStore,
    syncSessionToVaultRaw,
    syncVaultKnowledgeToDisk,
    addFile,
    addKnowledge,
    addText,
    addMedia,
    updateFile,
    deleteFile,
    deleteByCategory,
    deleteByVault,
    getFile,
    // 新增文件夹辅助
    findVaultRootFolder,
    findChildFolder,
    findFolderByPath,
    createFolder,
    getChildren,
    getVaultTree,
    appendToFile,
  }
}
