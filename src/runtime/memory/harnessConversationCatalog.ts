import { queryDeepSeekHarnessConversations, type DeepSeekHarnessInput } from '@/services/deepSeekHarness'
import type { ManjuPreference } from './manjuProduction'
import type { NovelPreference } from './novelProduction'
import type { ShortDramaPreference } from './shortDramaProduction'

export interface HarnessConversationCatalogEntry {
  conversationId: string
  sessionId: string
  workspaceKey: string
  title: string
  createdAt: string
  updatedAt: string
  legacyRawPath?: string
  migratedAt?: string
  manju?: ManjuPreference
  novel?: NovelPreference
  shortDrama?: ShortDramaPreference
}
export type HarnessConversationPreferences = Pick<HarnessConversationCatalogEntry, 'manju' | 'novel' | 'shortDrama' | 'legacyRawPath' | 'migratedAt'>
export type HarnessConversationSnapshot = { entries: HarnessConversationCatalogEntry[]; hiddenIds: string[]; warnings: string[] }

/** Disposable view of official DSH sessions. Never persisted as a second directory. */
const views = new Map<string, HarnessConversationSnapshot>()
type Query = typeof queryDeepSeekHarnessConversations
const inputs = new Map<string, { input: DeepSeekHarnessInput; query: Query }>()
const mutations = new Map<string, Promise<unknown>>()
function accept(owner: string, result: HarnessConversationSnapshot): HarnessConversationSnapshot {
  if (!Array.isArray(result?.entries) || !Array.isArray(result.hiddenIds)
    || result.entries.some(entry => !entry.sessionId || !entry.conversationId || entry.workspaceKey !== owner))
    throw new Error('DSH 会话列表格式无效，保留已有列表')
  const snapshot = structuredClone(result)
  views.set(owner, snapshot)
  return snapshot
}
export function listHarnessConversationCatalog(owner: string): HarnessConversationCatalogEntry[] {
  return [...(views.get(owner)?.entries || [])].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
}
/** Update an in-flight UI projection only; DSH remains the existence/title authority. */
export function upsertHarnessConversationCatalogEntry(entry: HarnessConversationCatalogEntry): HarnessConversationCatalogEntry {
  const view = views.get(entry.workspaceKey) || { entries: [], hiddenIds: [], warnings: [] }
  if (view.hiddenIds.includes(entry.conversationId)) return entry
  const index = view.entries.findIndex(item => item.conversationId === entry.conversationId)
  if (index < 0) view.entries.push(structuredClone(entry))
  else view.entries[index] = structuredClone({ ...view.entries[index], ...entry })
  views.set(entry.workspaceKey, view)
  return entry
}
export async function refreshHarnessConversationCatalog(input: DeepSeekHarnessInput, query: Query = queryDeepSeekHarnessConversations): Promise<HarnessConversationSnapshot> {
  inputs.set(input.cwd, { input, query })
  return await mutate(input.cwd, { action: 'list' })
}

async function mutate(owner: string, params: Record<string, unknown>) {
  const input = inputs.get(owner)
  if (!input) throw new Error('尚未连接 DSH 会话服务，请重新打开项目')
  const pending = (mutations.get(owner) || Promise.resolve()).catch(() => {}).then(async () =>
    accept(owner, await input.query(input.input, params)))
  mutations.set(owner, pending)
  try { return await pending }
  finally { if (mutations.get(owner) === pending) mutations.delete(owner) }
}
export async function createHarnessConversationCatalogEntry(owner: string, _title = '新对话'): Promise<HarnessConversationCatalogEntry> {
  const id = `conversation-${crypto.randomUUID()}`
  const result = await mutate(owner, { action: 'create', conversationId: id })
  const entry = result.entries.find(item => item.conversationId === id)
  if (!entry) throw new Error('DSH 未返回新建的会话，未创建浏览器替代记录')
  return entry
}
export async function renameHarnessConversationCatalogEntry(owner: string, id: string, title: string) {
  return (await mutate(owner, { action: 'rename', conversationId: id, title })).entries.find(item => item.conversationId === id)
}
export async function removeHarnessConversationCatalogEntry(owner: string, id: string) {
  await mutate(owner, { action: 'hide', conversationId: id })
}
export async function updateHarnessConversationPreferences(owner: string, id: string, preferences: HarnessConversationPreferences) {
  const existing = listHarnessConversationCatalog(owner).find(entry => entry.conversationId === id)
  await mutate(owner, { action: 'preferences', conversationId: id, title: existing?.title,
    preferences: { ...(existing?.legacyRawPath ? { legacyRawPath: existing.legacyRawPath } : {}), ...preferences } })
}
