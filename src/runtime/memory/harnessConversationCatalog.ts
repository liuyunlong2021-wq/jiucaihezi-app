import { deepSeekSessionId } from '@/services/deepSeekHarness'

export interface HarnessConversationCatalogEntry {
  conversationId: string
  sessionId: string
  workspaceKey: string
  title: string
  createdAt: string
  updatedAt: string
  legacyRawPath?: string
  migratedAt?: string
}

const keyFor = (workspaceKey: string) => `jc:harness-conversations:${workspaceKey}`

function read(workspaceKey: string, storage: Storage): HarnessConversationCatalogEntry[] {
  try {
    const value = JSON.parse(storage.getItem(keyFor(workspaceKey)) || '[]')
    return Array.isArray(value)
      ? value.filter(entry => entry?.workspaceKey === workspaceKey && entry?.conversationId && entry?.sessionId)
      : []
  } catch {
    return []
  }
}

function write(workspaceKey: string, entries: HarnessConversationCatalogEntry[], storage: Storage) {
  storage.setItem(keyFor(workspaceKey), JSON.stringify(entries))
}

export function listHarnessConversationCatalog(
  workspaceKey: string,
  storage: Storage = localStorage,
): HarnessConversationCatalogEntry[] {
  return read(workspaceKey, storage).sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
}

export function upsertHarnessConversationCatalogEntry(
  entry: HarnessConversationCatalogEntry,
  storage: Storage = localStorage,
): HarnessConversationCatalogEntry {
  const entries = read(entry.workspaceKey, storage)
  const index = entries.findIndex(item => item.conversationId === entry.conversationId)
  if (index < 0) entries.push(entry)
  else entries[index] = { ...entries[index], ...entry }
  write(entry.workspaceKey, entries, storage)
  return entry
}

export function createHarnessConversationCatalogEntry(
  workspaceKey: string,
  title = '新对话',
  storage: Storage = localStorage,
  conversationId = `conversation-${crypto.randomUUID()}`,
  now = new Date().toISOString(),
): HarnessConversationCatalogEntry {
  return upsertHarnessConversationCatalogEntry({
    conversationId,
    sessionId: deepSeekSessionId(conversationId),
    workspaceKey,
    title,
    createdAt: now,
    updatedAt: now,
  }, storage)
}

export function renameHarnessConversationCatalogEntry(
  workspaceKey: string,
  conversationId: string,
  title: string,
  storage: Storage = localStorage,
  now = new Date().toISOString(),
): HarnessConversationCatalogEntry | undefined {
  const entry = read(workspaceKey, storage).find(item => item.conversationId === conversationId)
  return entry ? upsertHarnessConversationCatalogEntry({ ...entry, title, updatedAt: now }, storage) : undefined
}

export function removeHarnessConversationCatalogEntry(
  workspaceKey: string,
  conversationId: string,
  storage: Storage = localStorage,
) {
  write(workspaceKey, read(workspaceKey, storage).filter(item => item.conversationId !== conversationId), storage)
}
