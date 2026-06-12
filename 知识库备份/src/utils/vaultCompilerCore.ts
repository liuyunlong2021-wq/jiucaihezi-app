import type { FileEntry } from '@/composables/useFileStore'

export type KnowledgeKind = NonNullable<FileEntry['kind']>

export interface KnowledgePageInput {
  title: string
  pageType?: string
  status?: string
  confidence?: string
  tags?: string[]
  sources?: string[]
  updatedAt?: number
  body: string
}

export interface ParsedCompilerPage {
  title: string
  pageType?: string
  status?: string
  confidence?: string
  tags?: string[]
  body?: string
  content?: string
  topic?: string
}

export interface ParsedCompilerEntity {
  name: string
  entityType?: string
  summary?: string
  tags?: string[]
}

export interface ParsedCompilerRelation {
  from: string
  to: string
  relation: string
  summary?: string
}

export interface ParsedCompilerOutput {
  pages: ParsedCompilerPage[]
  entities: ParsedCompilerEntity[]
  relations: ParsedCompilerRelation[]
}

export interface VaultKnowledgeCandidate {
  id: string
  title: string
  content: string
  kind?: KnowledgeKind
  updatedAt?: number
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface VaultRetrievalRule {
  path?: string
  tags?: string[]
  priority?: number
  budgetChars?: number
  description?: string
}

export interface VaultWritebackRule {
  targetPath: string
  trigger?: string[]
  mode?: 'create' | 'append'
  kind?: KnowledgeKind
  priority?: number
  description?: string
}

export interface VaultContextPackRules {
  maxItems?: number
  perItemChars?: number
  maxTotalChars?: number
  claudeMaxChars?: number
  pinnedMaxChars?: number
  includeFolderPath?: boolean
}

export interface VaultFolderSemantic {
  description?: string
  tags?: string[]
  priority?: number
  retrievalHint?: string
  writebackHint?: string
}

export interface VaultEnhancementConfig {
  retrievalRules?: VaultRetrievalRule[]
  writebackRules?: VaultWritebackRule[]
  contextPackRules?: VaultContextPackRules
  folderSemantics?: Record<string, string | VaultFolderSemantic>
}

export interface VaultIndexEntry {
  id: string
  title: string
  kind: KnowledgeKind
  summary: string
  updatedAt: number
}

export interface VaultLintIssue {
  id: string
  category: string
  description: string
  severity: 'report' | 'auto-fixed'
}

export interface VaultLintOptions {
  now?: number
  staleDays?: number
}

export interface VaultWritebackPlanInput {
  userText: string
  assistantText: string
  vaultName?: string
  enhancement?: VaultEnhancementConfig
}

export interface VaultWritebackDraft {
  targetPath: string
  fileName: string
  content: string
  kind: KnowledgeKind
  mode: 'create' | 'append'
  reason: string
}

function yamlList(items: string[] = []) {
  return `[${items.map(item => String(item).replace(/[\[\]\n\r]/g, '').trim()).filter(Boolean).join(', ')}]`
}

function frontmatterValue(value: unknown, fallback: string) {
  const text = String(value || fallback).replace(/\n/g, ' ').trim()
  return text || fallback
}

export function buildKnowledgeMarkdown(input: KnowledgePageInput): string {
  const title = frontmatterValue(input.title, '未命名知识页')
  const pageType = frontmatterValue(input.pageType, 'note')
  const status = frontmatterValue(input.status, 'developing')
  const confidence = frontmatterValue(input.confidence, 'medium')
  const updatedAt = input.updatedAt || Date.now()
  const body = String(input.body || '').trim()

  return [
    '---',
    `pageType: ${pageType}`,
    `status: ${status}`,
    `confidence: ${confidence}`,
    `tags: ${yamlList(input.tags)}`,
    `sources: ${yamlList(input.sources)}`,
    `updatedAt: ${updatedAt}`,
    '---',
    '',
    `# ${title}`,
    '',
    body,
  ].join('\n')
}

function extractJson(text: string): string {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
  const objectMatch = cleaned.match(/\{[\s\S]*\}/)
  if (objectMatch) return objectMatch[0]
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/)
  if (arrayMatch) return `{"pages":${arrayMatch[0]},"entities":[],"relations":[]}`
  return '{"pages":[],"entities":[],"relations":[]}'
}

export function parseCompilerJson(text: string): ParsedCompilerOutput {
  const parsed = JSON.parse(extractJson(text || ''))
  if (Array.isArray(parsed)) {
    return { pages: parsed, entities: [], relations: [] }
  }

  return {
    pages: Array.isArray(parsed.pages) ? parsed.pages : [],
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
    relations: Array.isArray(parsed.relations) ? parsed.relations : [],
  }
}

function tokenize(query: string): string[] {
  const tokens = new Set<string>()
  const msg = query.toLowerCase()
  msg.split(/\s+/).forEach(w => { if (w.length > 1) tokens.add(w) })
  const cjkRuns = msg.match(/[\u4e00-\u9fff\u3400-\u4dbf]+/g) || []
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length; i++) {
      tokens.add(run[i])
      if (i < run.length - 1) tokens.add(run.substring(i, i + 2))
    }
    if (run.length >= 3) tokens.add(run)
  }
  return Array.from(tokens)
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')
}

function semanticToText(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return ''
  const semantic = value as VaultFolderSemantic
  return [
    semantic.description,
    semantic.retrievalHint,
    semantic.writebackHint,
    ...(semantic.tags || []),
  ].filter(Boolean).join(' ')
}

function semanticPriority(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const priority = Number((value as VaultFolderSemantic).priority || 0)
  return Number.isFinite(priority) ? priority : 0
}

function getFolderPath(item: VaultKnowledgeCandidate): string {
  return normalizePath(String(item.metadata?.folderPath || item.metadata?.path || ''))
}

function getFolderSemantic(item: VaultKnowledgeCandidate, enhancement?: VaultEnhancementConfig): unknown {
  const direct = item.metadata?.folderSemantic || item.metadata?.semantic
  if (direct) return direct

  const folderPath = getFolderPath(item)
  if (!folderPath || !enhancement?.folderSemantics) return null

  let best: unknown = null
  let bestLength = -1
  for (const [path, semantic] of Object.entries(enhancement.folderSemantics)) {
    const normalized = normalizePath(path)
    if (folderPath === normalized || folderPath.startsWith(normalized + '/')) {
      if (normalized.length > bestLength) {
        best = semantic
        bestLength = normalized.length
      }
    }
  }
  return best
}

function ruleMatchesQuery(rule: VaultRetrievalRule, tokens: string[]): boolean {
  const text = [rule.description, ...(rule.tags || [])].filter(Boolean).join(' ').toLowerCase()
  if (!text) return true
  return tokens.some(token => text.includes(token))
}

function cleanFileName(text: string, fallback: string): string {
  const firstLine = (text || '').split('\n').find(line => line.trim()) || fallback
  const heading = firstLine.replace(/^#+\s*/, '').trim()
  const cleaned = heading
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 48)
  return (cleaned || fallback).replace(/\.md$/i, '') + '.md'
}

function stripMarkdownNoise(content: string): string {
  return String(content || '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#+\s+/gm, '')
    .replace(/[*_`>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildKnowledgeSummary(content: string, maxWords = 64): string {
  const summarySection = String(content || '').match(/##\s*摘要\s+([\s\S]*?)(?:\n##\s+|$)/)
  const source = summarySection?.[1]?.trim() || content
  const cleaned = stripMarkdownNoise(source)
  if (!cleaned) return ''
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length > 1) return words.slice(0, maxWords).join(' ')
  return cleaned.slice(0, Math.max(80, maxWords * 3))
}

const KIND_WEIGHT: Record<KnowledgeKind, number> = {
  page: 40,
  entity: 34,
  relation: 30,
  summary: 24,
  raw: 12,
  asset: 8,
}

export function scoreVaultKnowledge(
  query: string,
  item: VaultKnowledgeCandidate,
  nowOrEnhancement: number | VaultEnhancementConfig = Date.now(),
  enhancementArg?: VaultEnhancementConfig,
): number {
  const now = typeof nowOrEnhancement === 'number' ? nowOrEnhancement : Date.now()
  const enhancement = typeof nowOrEnhancement === 'number' ? enhancementArg : nowOrEnhancement
  const tokens = tokenize(query)
  if (tokens.length === 0) return 0

  const title = item.title.toLowerCase()
  const content = item.content.toLowerCase()
  const summary = String(item.metadata?.summary || '').toLowerCase()
  const tags = (item.tags || []).join(' ').toLowerCase()
  const folderPath = getFolderPath(item).toLowerCase()
  const folderSemantic = getFolderSemantic(item, enhancement)
  const folderSemanticText = semanticToText(folderSemantic).toLowerCase()
  let score = KIND_WEIGHT[item.kind || 'raw'] || 0
  let relevance = 0

  for (const token of tokens) {
    if (title.includes(token)) relevance += token.length * 12
    if (tags.includes(token)) relevance += token.length * 8
    if (folderPath.includes(token)) relevance += token.length * 8
    if (folderSemanticText.includes(token)) relevance += token.length * 10
    if (summary.includes(token)) relevance += token.length * 10
    if (content.includes(token)) relevance += token.length * 3
  }
  score += relevance

  if (folderSemanticText && tokens.some(token => folderSemanticText.includes(token))) {
    score += semanticPriority(folderSemantic)
  }

  if (enhancement?.retrievalRules?.length) {
    for (const rule of enhancement.retrievalRules) {
      const rulePath = normalizePath(rule.path || '').toLowerCase()
      const pathMatches = rulePath && (folderPath === rulePath || folderPath.startsWith(rulePath + '/'))
      const queryMatches = ruleMatchesQuery(rule, tokens)
      if (pathMatches && queryMatches) {
        score += Math.max(1, rule.priority || 8)
        relevance += 1
      } else if (pathMatches) {
        score += Math.max(1, Math.floor((rule.priority || 8) / 2))
      }
    }
  }

  if (relevance <= 0) return 0
  const ageMs = Math.max(0, now - (item.updatedAt || 0))
  const ageDays = ageMs / (24 * 60 * 60 * 1000)
  score += Math.max(0, 16 - ageDays)
  return score
}

export function rankVaultKnowledge(
  query: string,
  items: VaultKnowledgeCandidate[],
  enhancement?: VaultEnhancementConfig,
): VaultKnowledgeCandidate[] {
  return items
    .map(item => ({ item, score: scoreVaultKnowledge(query, item, enhancement) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(row => row.item)
}

export function createDefaultVaultEnhancement(input: {
  wikiFolders?: string[]
  rawFolders?: string[]
  keywords?: string[]
  oneLineDesc?: string
} = {}): VaultEnhancementConfig {
  const wikiFolders = (input.wikiFolders || []).map(path => normalizePath(`wiki/${path.replace(/^wiki\//, '')}`))
  const folderSemantics: Record<string, VaultFolderSemantic> = {}
  const retrievalRules: VaultRetrievalRule[] = []

  for (const path of wikiFolders) {
    const parts = path.split('/').filter(Boolean)
    const tags = Array.from(new Set([...parts.slice(1), ...(input.keywords || [])])).filter(Boolean)
    folderSemantics[path] = {
      description: `${parts.slice(1).join(' / ') || '知识页'}：${input.oneLineDesc || '用户自定义知识分类'}`,
      tags,
      priority: 6,
    }
    retrievalRules.push({
      path,
      tags,
      priority: 6,
      budgetChars: 800,
      description: folderSemantics[path].description,
    })
  }

  const preferredOutputPath =
    wikiFolders.find(path => /作品|成果|产出|文档|报告|案例|项目|章节|记录/.test(path)) ||
    wikiFolders[0] ||
    'wiki/沉淀内容'

  return {
    retrievalRules,
    writebackRules: [
      {
        targetPath: preferredOutputPath,
        trigger: ['生成', '输出', '整理', '总结', '方案', '正文', '报告', '文档', '结论'],
        mode: 'create',
        kind: 'page',
        priority: 8,
        description: '把高价值生成结果沉淀为可复用 wiki 知识页',
      },
    ],
    contextPackRules: {
      maxItems: 8,
      perItemChars: 450,
      maxTotalChars: 6000,
      claudeMaxChars: 1500,
      pinnedMaxChars: 2000,
      includeFolderPath: true,
    },
    folderSemantics,
  }
}

export function planVaultWritebacks(input: VaultWritebackPlanInput): VaultWritebackDraft[] {
  const userText = input.userText.trim()
  const assistantText = input.assistantText.trim()
  if (!assistantText || assistantText.startsWith('⚠️')) return []

  const mergedText = `${userText}\n${assistantText}`
  const rules = input.enhancement?.writebackRules || []
  const matchedRules = rules
    .map(rule => {
      const triggerScore = (rule.trigger || [])
        .filter(trigger => trigger && mergedText.includes(trigger))
        .length
      return {
        rule,
        score: triggerScore * 10 + (rule.priority || 0),
      }
    })
    .filter(row => row.score > 0 || !row.rule.trigger?.length)
    .sort((a, b) => b.score - a.score)

  const isSubstantial = assistantText.length >= 500 || /(^|\n)#{1,3}\s+/.test(assistantText)
  if (!isSubstantial && matchedRules.length === 0) return []

  const rule = matchedRules[0]?.rule
  const fallbackEnhancement = createDefaultVaultEnhancement({
    wikiFolders: [],
    oneLineDesc: input.vaultName,
  })
  const fallbackRule = fallbackEnhancement.writebackRules?.[0]
  const targetPath = normalizePath(rule?.targetPath || fallbackRule?.targetPath || 'wiki/沉淀内容')

  return [
    {
      targetPath,
      fileName: cleanFileName(assistantText, input.vaultName || '知识沉淀'),
      content: assistantText,
      kind: rule?.kind || 'page',
      mode: rule?.mode || 'create',
      reason: rule?.description || '生成内容达到沉淀阈值，自动规划写回 wiki',
    },
  ]
}

export function buildVaultIndexEntries(items: VaultKnowledgeCandidate[]): VaultIndexEntry[] {
  return items
    .filter(item => item.id && item.title)
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-CN'))
    .map(item => ({
      id: item.id,
      title: item.title,
      kind: item.kind || 'raw',
      summary: String(item.metadata?.summary || '').trim() || buildKnowledgeSummary(item.content),
      updatedAt: item.updatedAt || 0,
    }))
}

function canonicalTitle(title: string): string {
  return String(title || '')
    .replace(/\.md$/i, '')
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]/gu, '')
    .toLowerCase()
}

function charJaccard(a: string, b: string): number {
  const left = new Set(canonicalTitle(a))
  const right = new Set(canonicalTitle(b))
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const ch of left) if (right.has(ch)) intersection++
  const union = new Set([...left, ...right]).size
  return union === 0 ? 0 : intersection / union
}

function isLintableWikiPage(item: VaultKnowledgeCandidate): boolean {
  const kind = String(item.kind || '')
  const metaKind = String(item.metadata?.kind || '')
  const vaultFolder = String(item.metadata?.vaultFolder || '')
  const folderPath = normalizePath(String(item.metadata?.folderPath || item.metadata?.targetPath || ''))
  if (!['page', 'entity', 'summary'].includes(kind)) return false
  if (vaultFolder !== 'wiki' && folderPath !== 'wiki' && !folderPath.startsWith('wiki/')) return false
  if ([
    'vault-index',
    'vault-overview',
    'vault-hot-cache',
    'vault-log',
    'vault-log-entry',
    'vault-lint-report',
    'vault-compile-log',
    'vault-organize-report',
    'writeback-candidate',
    'writeback-candidate-report',
    'organize-candidate',
  ].includes(metaKind)) return false
  return true
}

function explicitRefs(item: VaultKnowledgeCandidate): string[] {
  const refs = [
    ...(Array.isArray(item.metadata?.seeAlso) ? item.metadata!.seeAlso!.map(String) : []),
    ...(Array.isArray(item.metadata?.references) ? item.metadata!.references!.map(String) : []),
  ]
  const wikilinks = Array.from(String(item.content || '').matchAll(/\[\[([^\]]+)\]\]/g))
    .map(match => match[1].split('|')[0].trim())
  return [...refs, ...wikilinks].filter(Boolean)
}

export function lintVaultKnowledge(items: VaultKnowledgeCandidate[], options: VaultLintOptions = {}): VaultLintIssue[] {
  const issues: VaultLintIssue[] = []
  const now = options.now || Date.now()
  const staleMs = (options.staleDays || 60) * 24 * 60 * 60 * 1000
  const entityNames = new Set(
    items
      .filter(item => item.kind === 'entity' || item.kind === 'page')
      .map(item => item.title)
  )
  const wikiPages = items.filter(isLintableWikiPage)
  const referenced = new Set<string>()
  const titleToId = new Map<string, string>()
  const nameToId = new Map<string, string>()

  for (const item of wikiPages) {
    titleToId.set(item.id, item.id)
    nameToId.set(canonicalTitle(item.title), item.id)
  }

  for (const item of wikiPages) {
    for (const ref of explicitRefs(item)) {
      if (titleToId.has(ref)) referenced.add(ref)
      const canonical = canonicalTitle(ref)
      if (nameToId.has(canonical)) referenced.add(nameToId.get(canonical)!)
    }
  }

  for (const item of items) {
    if (!item.title || !String(item.content || '').trim()) {
      issues.push({
        id: item.id,
        category: '空知识',
        description: `"${item.title || item.id}" 缺少标题或内容`,
        severity: 'report',
      })
    }

    if (item.kind === 'relation') {
      const from = String(item.metadata?.from || item.title.split(' - ')[0] || '').trim()
      const to = String(item.metadata?.to || item.title.split(' - ').at(-1) || '').trim()
      if ((from && !entityNames.has(from)) || (to && !entityNames.has(to))) {
        issues.push({
          id: item.id,
          category: '关系缺失实体',
          description: `"${item.title}" 指向尚未建立的实体`,
          severity: 'report',
        })
      }
    }
  }

  for (const item of wikiPages) {
    const lastReadAt = Number(item.metadata?.lastReadAt || 0)
    const staleBase = lastReadAt > 0 ? lastReadAt : Number(item.updatedAt || 0)
    if (staleBase > 0 && now - staleBase > staleMs) {
      issues.push({
        id: item.id,
        category: '过期知识',
        description: `"${item.title}" 已超过 ${options.staleDays || 60} 天未被召回，建议复查或归档。`,
        severity: 'report',
      })
    }

    const hasOutgoingRefs = explicitRefs(item).length > 0
    if (!referenced.has(item.id) && !hasOutgoingRefs) {
      issues.push({
        id: item.id,
        category: '孤岛知识',
        description: `"${item.title}" 没有被其他页面引用，也没有 seeAlso/双链指向其他页面。`,
        severity: 'report',
      })
    }
  }

  for (let i = 0; i < wikiPages.length; i++) {
    for (let j = i + 1; j < wikiPages.length; j++) {
      const leftPath = normalizePath(String(wikiPages[i].metadata?.folderPath || ''))
      const rightPath = normalizePath(String(wikiPages[j].metadata?.folderPath || ''))
      if (leftPath && rightPath && leftPath !== rightPath) continue
      const score = charJaccard(wikiPages[i].title, wikiPages[j].title)
      if (score > 0.8) {
        issues.push({
          id: wikiPages[j].id,
          category: '重复知识',
          description: `"${wikiPages[i].title}" 与 "${wikiPages[j].title}" 标题相似度超过 80%，建议合并或改名。`,
          severity: 'report',
        })
      }
    }
  }

  return issues
}
