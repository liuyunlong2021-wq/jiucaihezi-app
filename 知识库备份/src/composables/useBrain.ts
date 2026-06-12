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
import { useVaultStore } from '@/stores/vaultStore'
import type {
  BrainRawEntry,
  BrainWikiPage,
  SkillConfig,
  WikiIndexEntry,
  WikiLogEntry,
} from '@/types/skill'
import {
  buildVaultIndexEntries,
  lintVaultKnowledge,
  planVaultWritebacks,
  type VaultEnhancementConfig,
  type VaultFolderSemantic,
} from '@/utils/vaultCompilerCore'
import { buildWikiWritebackCandidates } from '@/utils/vaultRetrieval'
import { buildBrainSuggestionsFromWikiPages } from '@/utils/brainSuggestions'
import { isPendingWikiCandidate } from '@/utils/vaultCandidate'
import {
  buildRecallSections,
  buildRetrievalFiles,
  buildRuntimeContextPackResult,
  resolveContextPackBudget,
  resolveRecallBudgetByIntent,
  toWikiWritebackRecords,
} from '@/utils/vaultRuntime'
import { buildRecallKnowledgeHits, type RecallKnowledgeHit } from '@/utils/vaultRecallTrace'
import { buildVaultChunks } from '@/utils/vaultChunking'
import { buildVaultEvidencePlan } from '@/utils/vaultEvidencePlanner'

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
  skillHint?: string
  maxTotalChars?: number
  maxItems?: number
  perItemChars?: number
}

export interface RecallKnowledgeResult {
  text: string
  hits: RecallKnowledgeHit[]
  searched: boolean
  staticKnowledgeInjected: boolean
}

interface WritebackOptions {
  vaultId?: string
  sessionId?: string
  sourceMessageIds?: string[]
}

const suggestions = ref<BrainSuggestion[]>([])
const lintResults = ref<LintIssue[]>([])
const pinnedKnowledge = ref<Array<{ name: string; content: string; vaultId: string }>>([])

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

async function loadVaultEnhancement(vaultId?: string): Promise<VaultEnhancementConfig | undefined> {
  if (!vaultId) return undefined
  try {
    const vaultStore = useVaultStore()
    if (vaultStore.vaults.length === 0) await vaultStore.loadAll()
    return vaultStore.vaults.find(v => v.id === vaultId)?.enhancement
  } catch {
    return undefined
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
}

function buildVaultPathHelpers(files: FileEntry[]) {
  const folders = new Map(files.filter(file => file.mimeType === 'folder').map(file => [file.id, file]))
  const pathCache = new Map<string, string>()
  const semanticByPath = new Map<string, unknown>()

  function folderPath(folder: FileEntry): string {
    if (pathCache.has(folder.id)) return pathCache.get(folder.id)!
    let path = ''
    if (!folder.folderId) {
      path = String(folder.metadata?.vaultFolder || folder.name || '')
    } else {
      const parent = folders.get(folder.folderId)
      path = parent ? `${folderPath(parent)}/${folder.name}` : folder.name
    }
    path = normalizePath(path)
    pathCache.set(folder.id, path)
    if (folder.metadata?.semantic) semanticByPath.set(path, folder.metadata.semantic)
    return path
  }

  for (const folder of folders.values()) folderPath(folder)

  function filePath(file: FileEntry): string {
    if (file.metadata?.folderPath) return normalizePath(String(file.metadata.folderPath))
    if (!file.folderId) return normalizePath(String(file.metadata?.vaultFolder || ''))
    const parent = folders.get(file.folderId)
    return parent ? normalizePath(`${folderPath(parent)}/${file.name}`) : file.name
  }

  function semanticFor(path: string, enhancement?: VaultEnhancementConfig): unknown {
    const normalized = normalizePath(path)
    let best: unknown = null
    let bestLength = -1

    for (const [semanticPath, semantic] of semanticByPath.entries()) {
      if (normalized === semanticPath || normalized.startsWith(semanticPath + '/')) {
        if (semanticPath.length > bestLength) {
          best = semantic
          bestLength = semanticPath.length
        }
      }
    }

    for (const [semanticPath, semantic] of Object.entries(enhancement?.folderSemantics || {})) {
      const normalizedSemanticPath = normalizePath(semanticPath)
      if (normalized === normalizedSemanticPath || normalized.startsWith(normalizedSemanticPath + '/')) {
        if (normalizedSemanticPath.length > bestLength) {
          best = semantic
          bestLength = normalizedSemanticPath.length
        }
      }
    }

    return best
  }

  return { filePath, semanticFor }
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
  const scoped = knowledge.filter(file =>
    file.category === 'knowledge' &&
    file.mimeType !== 'folder' &&
    !isPendingWikiCandidate(file)
  )
  rawEntries.value = scoped
    .filter(file => file.kind === 'raw' || file.indexed === false)
    .map(toRawEntry)
  wikiPages.value = scoped
    .filter(file => file.kind && file.kind !== 'raw' && file.kind !== 'asset' && !isPendingWikiCandidate(file))
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

export async function runBrainCompilation(skills: SkillConfig[], opts: { vaultId?: string } = {}): Promise<BrainSuggestion[]> {
  await refreshBrainState(opts.vaultId)
  suggestions.value = buildBrainSuggestionsFromWikiPages({
    skills,
    pages: wikiPages.value,
  })
  return suggestions.value
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

export async function recallKnowledgeWithTrace(userMsg: string, opts: RecallOptions = {}): Promise<RecallKnowledgeResult> {
  const vaultId = opts.vaultId
  if (!vaultId) return { text: '', hits: [], searched: false, staticKnowledgeInjected: false }

  const fileStore = useFileStore()
  const allFiles = (await fileStore.loadByVault(vaultId))
    .filter(file => file.category === 'knowledge' && file.mimeType !== 'folder' && file.content)
  const allVaultFiles = await fileStore.loadByVault(vaultId)
  const enhancement = await loadVaultEnhancement(vaultId)
  const contextRules = enhancement?.contextPackRules || {}
  const { filePath, semanticFor } = buildVaultPathHelpers(allVaultFiles)

  const scopedPinned = getPinnedKnowledge(vaultId)
  const claudeFile = allFiles.find(f => f.name === 'CLAUDE.md' && f.metadata?.isConfig)
  const hasStaticKnowledge = Boolean(claudeFile?.content || scopedPinned.length)
  const maxTotalChars = resolveRecallBudgetByIntent(userMsg, opts.maxTotalChars || contextRules.maxTotalChars || 6000)

  if (!allFiles.length || !userMsg.trim()) {
    return {
      text: buildRecallSections({
        claudeText: claudeFile?.content,
        pinned: scopedPinned,
        maxTotalChars,
        claudeMaxChars: contextRules.claudeMaxChars || 1500,
        pinnedMaxChars: contextRules.pinnedMaxChars || 2000,
      }),
      hits: [],
      searched: Boolean(allFiles.length && userMsg.trim()),
      staticKnowledgeInjected: hasStaticKnowledge,
    }
  }

  const maxItems = opts.maxItems || contextRules.maxItems || 8
  const retrievalFiles = buildRetrievalFiles(allFiles, { filePath, semanticFor }, enhancement)
  const retrievalQuery = [userMsg, opts.skillHint ? `当前Skill检索提示：${opts.skillHint}` : '']
    .filter(Boolean)
    .join('\n')
  const contextPackResult = buildRuntimeContextPackResult(retrievalQuery, retrievalFiles, enhancement, {
    maxWikiItems: maxItems,
    maxRawItems: Math.max(1, Math.ceil(maxItems / 4)),
    perItemChars: opts.perItemChars || contextRules.perItemChars || 450,
    maxTotalChars: resolveContextPackBudget({
      maxTotalChars,
      hasClaudeText: Boolean(claudeFile?.content),
      hasPinned: scopedPinned.length > 0,
      claudeMaxChars: contextRules.claudeMaxChars || 1500,
      pinnedMaxChars: contextRules.pinnedMaxChars || 2000,
    }),
  })
  const evidencePlan = buildVaultEvidencePlan({
    query: retrievalQuery,
    wikiFiles: allFiles
      .filter(file => file.metadata?.vaultFolder === 'wiki' || file.kind === 'page' || file.kind === 'entity')
      .map(file => ({
        id: file.id,
        path: filePath(file),
        name: file.name,
        content: file.content,
        metadata: file.metadata,
      })),
    chunks: buildVaultChunks({
      vaultId,
      rawFiles: allFiles
        .filter(file => file.metadata?.vaultFolder === 'raw' || file.kind === 'raw')
        .map(file => ({
          id: file.id,
          name: file.name,
          content: file.content,
          metadata: file.metadata,
        })),
    }),
    maxWikiItems: maxItems,
    maxChunkItems: Math.max(1, Math.ceil(maxItems / 3)),
    perItemChars: opts.perItemChars || contextRules.perItemChars || 450,
  })
  const structuredEvidence = evidencePlan.selectedWiki.length || evidencePlan.selectedChunks.length
    ? evidencePlan.evidenceText
    : ''
  const contextPack = [
    structuredEvidence,
    contextPackResult.contextPack,
  ].filter(Boolean).join('\n\n')
  const recallText = buildRecallSections({
    claudeText: claudeFile?.content,
    contextPack,
    pinned: scopedPinned,
    maxTotalChars,
    claudeMaxChars: contextRules.claudeMaxChars || 1500,
    pinnedMaxChars: contextRules.pinnedMaxChars || 2000,
  })
  const fileById = new Map(allFiles.map(file => [file.id, file]))
  const now = Date.now()
  for (const hit of contextPackResult.wikiHits) {
    if (!recallText.includes(hit.path) && !recallText.includes(hit.name)) continue
    const source = fileById.get(hit.id)
    if (!source || source.metadata?.vaultFolder !== 'wiki') continue
    const readCount = Number(source.metadata?.readCount || 0)
    await fileStore.updateFile(source.id, {
      metadata: {
        ...(source.metadata || {}),
        readCount: Number.isFinite(readCount) ? readCount + 1 : 1,
        lastReadAt: now,
      },
    })
  }

  const hits = buildRecallKnowledgeHits({
    wikiHits: contextPackResult.wikiHits,
    rawHits: contextPackResult.rawHits,
    evidenceWiki: evidencePlan.selectedWiki,
    evidenceChunks: evidencePlan.selectedChunks,
    evidenceIntent: evidencePlan.intent.kind,
  })
  return {
    text: recallText,
    hits,
    searched: true,
    staticKnowledgeInjected: hasStaticKnowledge,
  }
}

export async function recallKnowledge(userMsg: string, opts: RecallOptions = {}): Promise<string> {
  return (await recallKnowledgeWithTrace(userMsg, opts)).text
}

async function ensureWikiFolder(vaultId: string, targetPath: string) {
  const fileStore = useFileStore()
  const parts = normalizePath(targetPath).replace(/^wiki\/?/, '').split('/').filter(Boolean)
  const wikiRoot = await fileStore.findVaultRootFolder(vaultId, 'wiki')
  if (!wikiRoot) return null
  let parent = wikiRoot
  let currentPath = 'wiki'
  for (const part of parts) {
    currentPath = `${currentPath}/${part}`
    const existing = await fileStore.findChildFolder(parent.id, part, vaultId)
    if (existing) {
      parent = existing
      continue
    }
    parent = await fileStore.createFolder(part, parent.id, vaultId, {
      vaultFolder: 'wiki',
      folderPath: currentPath,
    })
  }
  return parent
}

async function ensureFolderForTargetPath(vaultId: string, targetPath: string) {
  const fileStore = useFileStore()
  const normalized = normalizePath(targetPath)
  if (normalized === 'wiki' || normalized.startsWith('wiki/')) return ensureWikiFolder(vaultId, normalized)
  const folder = await fileStore.findFolderByPath(vaultId, normalized)
  if (folder) return folder
  const parts = normalized.split('/').filter(Boolean)
  const rootPath = parts.shift()
  if (!rootPath) return null
  let root = await fileStore.findFolderByPath(vaultId, rootPath)
  if (!root) {
    const vaultFolder = rootPath === '_reports' ? 'reports' : rootPath === '_templates' ? 'templates' : rootPath
    root = await fileStore.addFile({
      category: 'knowledge',
      name: rootPath,
      content: '',
      mimeType: 'folder',
      size: 0,
      vaultId,
      metadata: { isFolder: true, vaultFolder, folderPath: rootPath },
    })
  }
  let parent = root
  let currentPath = rootPath
  for (const part of parts) {
    currentPath = `${currentPath}/${part}`
    const existing = await fileStore.findChildFolder(parent.id, part, vaultId)
    if (existing) {
      parent = existing
      continue
    }
    parent = await fileStore.createFolder(part, parent.id, vaultId, {
      vaultFolder: root.metadata?.vaultFolder || rootPath,
      folderPath: currentPath,
    })
  }
  return parent
}

export async function writebackAssistantOutput(
  userText: string,
  assistantText: string,
  opts: WritebackOptions = {},
) {
  if (!opts.vaultId || !assistantText.trim() || assistantText.trim().startsWith('⚠️')) return []

  const enhancement = await loadVaultEnhancement(opts.vaultId)
  const drafts = planVaultWritebacks({
    userText,
    assistantText,
    enhancement,
  })
  const fallbackDrafts = drafts.length > 0
    ? []
    : buildWikiWritebackCandidates({
      userText,
      assistantText,
      preferredPath: 'wiki/沉淀内容',
    }).map(candidate => ({
      targetPath: candidate.targetPath,
      fileName: candidate.fileName,
      content: candidate.content,
      kind: 'page' as const,
      mode: 'create' as const,
      reason: candidate.reason,
    }))
  const writebackDrafts = drafts.length > 0 ? drafts : fallbackDrafts
  if (writebackDrafts.length === 0) return []

  const fileStore = useFileStore()
  const written = []
  const records = toWikiWritebackRecords({
    drafts: writebackDrafts,
    userText,
    assistantText,
    sessionId: opts.sessionId,
    sourceMessageIds: opts.sourceMessageIds,
  })

  for (const record of records) {
    const folder = await ensureFolderForTargetPath(opts.vaultId, record.targetPath)
    if (!folder) continue
    const children = await fileStore.getChildren(folder.id, opts.vaultId)
    const existing = children.find(file => file.name === record.name && file.mimeType !== 'folder')
    const name = existing && record.mode === 'append'
      ? `待确认_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}_${record.name}`
      : record.name
    const file = await fileStore.addFile({
      category: 'knowledge',
      name,
      content: record.content,
      mimeType: 'text/markdown',
      size: new TextEncoder().encode(record.content).length,
      vaultId: opts.vaultId,
      folderId: folder.id,
      kind: record.kind,
      sourceSessionId: opts.sessionId,
      sourceMessageIds: opts.sourceMessageIds,
      indexed: record.metadata.status === 'active',
      metadata: record.metadata,
    })
    written.push(file.id)
  }
  return written
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
    writebackAssistantOutput,
  }
}
