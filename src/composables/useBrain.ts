/**
 * composables/useBrain.ts — 长脑子轻量索引层
 *
 * 知识单源统一为 IndexedDB documents store:
 * - raw: 对话原材料，vault-scoped，等待编译
 * - page/entity/relation/summary: 编译后的结构化知识
 *
 * 这里不再维护 localStorage Brain Wiki，避免双重存储和跨库串味。
 */
import { ref } from 'vue'
import { useFileStore, type FileEntry } from '@/composables/useFileStore'
import type {
  BrainRawEntry,
  BrainWikiPage,
  SkillConfig,
  WikiIndexEntry,
  WikiLogEntry,
} from '@/types/skill'
import { buildVaultIndexEntries, lintVaultKnowledge, rankVaultKnowledge } from '@/utils/vaultCompilerCore'

const rawEntries = ref<BrainRawEntry[]>([])
const wikiPages = ref<BrainWikiPage[]>([])
const wikiIndex = ref<WikiIndexEntry[]>([])
const wikiLog = ref<WikiLogEntry[]>([])
const isProcessing = ref(false)
const currentStep = ref(0)
const stepLabels = [
  '',
  '正在读取当前知识库',
  '正在整理原始记录',
  '正在更新知识页',
  '正在生成反哺建议',
  '正在完成体检',
]

export interface BrainSuggestion {
  id: string
  skillId: string
  skillName: string
  type: 'rule' | 'reference' | 'example' | 'trigger'
  content: string
  status: 'pending' | 'accepted' | 'ignored'
}

export interface LintIssue {
  id: string
  severity: 'auto-fixed' | 'report'
  category: string
  description: string
  pageId?: string
}

interface RecallOptions {
  vaultId?: string
  skillId?: string
}

const suggestions = ref<BrainSuggestion[]>([])
const lintResults = ref<LintIssue[]>([])
const pinnedKnowledge = ref<Array<{ name: string; content: string; vaultId: string }>>([])

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function toRawEntry(file: FileEntry): BrainRawEntry {
  return {
    id: file.id,
    skillId: file.skillId || 'general',
    vaultId: file.vaultId,
    sessionId: file.sourceSessionId,
    sourceMessageIds: file.sourceMessageIds,
    content: file.content,
    timestamp: file.createdAt || file.updatedAt || Date.now(),
    indexed: Boolean(file.indexed),
    collectedAt: Number(file.metadata?.collectedAt || file.createdAt || Date.now()),
    topic: file.topic || file.skillId || 'conversation',
  }
}

function toWikiPage(file: FileEntry): BrainWikiPage {
  return {
    id: file.id,
    skillId: file.skillId || String(file.metadata?.skillId || 'general'),
    vaultId: file.vaultId,
    title: file.name,
    content: file.content,
    sources: Array.isArray(file.metadata?.sources)
      ? file.metadata.sources as string[]
      : file.sourceMessageIds || [],
    updatedAt: file.updatedAt || Date.now(),
    topic: file.topic || file.kind || 'knowledge',
    seeAlso: Array.isArray(file.metadata?.seeAlso) ? file.metadata.seeAlso as string[] : [],
    archived: Boolean(file.metadata?.archived),
    conflicts: Array.isArray(file.metadata?.conflicts) ? file.metadata.conflicts as string[] : [],
  }
}

async function refreshBrainState(vaultId?: string) {
  const fileStore = useFileStore()
  const knowledge = vaultId
    ? await fileStore.loadByVault(vaultId)
    : await fileStore.loadByCategory('knowledge')
  const scoped = knowledge.filter(file => file.category === 'knowledge' && file.mimeType !== 'folder')
  rawEntries.value = scoped
    .filter(file => file.kind === 'raw' || file.indexed === false)
    .map(toRawEntry)
  wikiPages.value = scoped
    .filter(file => file.kind && file.kind !== 'raw' && file.kind !== 'asset')
    .map(toWikiPage)
  wikiIndex.value = buildVaultIndexEntries(scoped.map(file => ({
    id: file.id,
    title: file.name,
    content: file.content,
    kind: file.kind,
    updatedAt: file.updatedAt,
    tags: Array.isArray(file.metadata?.tags) ? file.metadata.tags as string[] : [],
    metadata: file.metadata,
  }))).map(item => ({
    pageId: item.id,
    title: item.title,
    topic: item.kind,
    summary: item.summary,
    updatedAt: item.updatedAt,
  }))
}

export async function ingestConversation(
  skillId: string,
  conversation: string,
  opts: { vaultId?: string; sessionId?: string; sourceMessageIds?: string[] } = {},
) {
  const content = conversation.trim()
  if (!opts.vaultId || !content) return null

  const fileStore = useFileStore()
  const file = await fileStore.addKnowledge({
    name: `对话原料_${new Date().toLocaleString('zh-CN')}`,
    content,
    topic: skillId || 'conversation',
    skillId: skillId || 'general',
    vaultId: opts.vaultId,
    kind: 'raw',
    sourceSessionId: opts.sessionId,
    sourceMessageIds: opts.sourceMessageIds,
    indexed: false,
    metadata: {
      kind: 'conversation-raw',
      collectedAt: Date.now(),
    },
  })
  await refreshBrainState(opts.vaultId)
  return file
}

export async function getSkillBrainStats(skills: SkillConfig[], vaultId?: string) {
  await refreshBrainState(vaultId)
  return skills.map(skill => {
    const raws = rawEntries.value.filter(r => r.skillId === skill.id)
    const wikis = wikiPages.value.filter(w => w.skillId === skill.id)
    const lastWiki = [...wikis].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    return {
      skillId: skill.id,
      skillName: skill.name,
      rawCount: raws.length,
      wikiCount: wikis.length,
      unindexedCount: raws.filter(r => !r.indexed).length,
      lastCompiled: lastWiki?.updatedAt || 0,
    }
  })
}

export async function runBrainCompilation(_skills: SkillConfig[]): Promise<BrainSuggestion[]> {
  suggestions.value = []
  return []
}

export function runBrainLint(): LintIssue[] {
  const issues = lintVaultKnowledge(wikiPages.value.map(page => ({
    id: page.id,
    title: page.title,
    content: page.content,
    kind: 'page',
    updatedAt: page.updatedAt,
  }))).map(issue => ({
    id: issue.id,
    severity: issue.severity,
    category: issue.category,
    description: issue.description,
    pageId: issue.id,
  }))
  lintResults.value = issues
  return issues
}

export function archiveQueryResult(title: string, content: string, sourcePageIds: string[], skillId: string, vaultId?: string) {
  if (!vaultId) return
  void useFileStore().addKnowledge({
    name: `[归档] ${title}`,
    content,
    topic: 'archive',
    skillId,
    vaultId,
    kind: 'page',
    indexed: true,
    metadata: { archived: true, seeAlso: sourcePageIds },
  })
}

export function setSuggestionStatus(id: string, status: 'accepted' | 'ignored') {
  const idx = suggestions.value.findIndex(s => s.id === id)
  if (idx !== -1) suggestions.value[idx].status = status
}

export function acceptAllSuggestions() {
  suggestions.value.forEach(s => { if (s.status === 'pending') s.status = 'accepted' })
}

export function ignoreAllSuggestions() {
  suggestions.value.forEach(s => { if (s.status === 'pending') s.status = 'ignored' })
}

export function pinKnowledge(name: string, content: string, vaultId: string) {
  if (!vaultId) return
  if (pinnedKnowledge.value.some(p => p.name === name && p.vaultId === vaultId)) return
  pinnedKnowledge.value.push({ name, content: content.slice(0, 2000), vaultId })
}

export function unpinKnowledge(name: string, vaultId?: string) {
  pinnedKnowledge.value = pinnedKnowledge.value.filter(p =>
    p.name !== name || (vaultId ? p.vaultId !== vaultId : false)
  )
}

export function getPinnedKnowledge(vaultId?: string): Array<{ name: string; content: string; vaultId: string }> {
  if (vaultId) return pinnedKnowledge.value.filter(p => p.vaultId === vaultId)
  return pinnedKnowledge.value
}

export async function recallKnowledge(userMsg: string, opts: RecallOptions = {}): Promise<string> {
  const vaultId = opts.vaultId
  if (!vaultId) return ''

  const fileStore = useFileStore()
  const allFiles = (await fileStore.loadByVault(vaultId))
    .filter(file => file.category === 'knowledge' && file.mimeType !== 'folder' && file.content)

  const scopedPinned = getPinnedKnowledge(vaultId)
  const pinnedSection = scopedPinned.length > 0
    ? `\n\n---\n[钉选记忆]\n${scopedPinned.map(p => `- ${p.name}: ${p.content.slice(0, 300)}`).join('\n')}`
    : ''

  // 注入 CLAUDE.md 配置（如果存在）
  const claudeFile = allFiles.find(f => f.name === 'CLAUDE.md' && f.metadata?.isConfig)
  const claudeSection = claudeFile
    ? `\n\n---\n[知识库配置]\n${claudeFile.content.slice(0, 1000)}`
    : ''

  if (!allFiles.length || !userMsg.trim()) return claudeSection + pinnedSection

  // 优先检索 wiki/ 目录下的文件
  const wikiFiles = allFiles.filter(f =>
    f.metadata?.vaultFolder === 'wiki' || f.kind === 'page' || f.kind === 'entity'
  )
  // 如果 wiki 为空，回退到全部文件
  const searchPool = wikiFiles.length > 0 ? wikiFiles : allFiles

  const ranked = rankVaultKnowledge(userMsg, searchPool.map(file => ({
    id: file.id,
    title: file.name,
    content: file.content,
    kind: file.kind,
    updatedAt: file.updatedAt,
    tags: Array.isArray(file.metadata?.tags) ? file.metadata.tags as string[] : [],
    metadata: file.metadata,
  }))).slice(0, 4)

  if (ranked.length === 0) return claudeSection + pinnedSection

  const lines = ranked.map(item => `- ${item.title}: ${item.content.slice(0, 200)}`)
  return `${claudeSection}\n\n---\n[知识回忆]\n${lines.join('\n')}${pinnedSection}`
}

export function getAcceptedSuggestionsBySkill(): Record<string, BrainSuggestion[]> {
  const accepted = suggestions.value.filter(s => s.status === 'accepted')
  const grouped: Record<string, BrainSuggestion[]> = {}
  for (const s of accepted) {
    if (!grouped[s.skillId]) grouped[s.skillId] = []
    grouped[s.skillId].push(s)
  }
  return grouped
}

export function rebuildIndex() {
  wikiIndex.value = buildVaultIndexEntries(wikiPages.value.map(page => ({
    id: page.id,
    title: page.title,
    content: page.content,
    kind: 'page',
    updatedAt: page.updatedAt,
  }))).map(item => ({
    pageId: item.id,
    title: item.title,
    topic: item.kind,
    summary: item.summary,
    updatedAt: item.updatedAt,
  }))
}

export function useBrain() {
  void refreshBrainState()

  return {
    rawEntries, wikiPages, wikiIndex, wikiLog, pinnedKnowledge,
    isProcessing, currentStep, stepLabels, suggestions, lintResults,
    ingestConversation, getSkillBrainStats, runBrainCompilation,
    setSuggestionStatus, acceptAllSuggestions, ignoreAllSuggestions,
    recallKnowledge, getAcceptedSuggestionsBySkill,
    pinKnowledge, unpinKnowledge, getPinnedKnowledge,
    runBrainLint, archiveQueryResult, rebuildIndex,
  }
}
