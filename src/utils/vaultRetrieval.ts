export interface VaultRetrievalFile {
  id: string
  name: string
  content: string
  kind?: string
  updatedAt?: number
  metadata?: Record<string, unknown>
}

export interface VaultRetrievalHit extends VaultRetrievalFile {
  score: number
  path: string
  reasons?: string[]
}

export interface VaultRetrievalPlan {
  query: string
  wikiHits: VaultRetrievalHit[]
  rawFallback: VaultRetrievalHit[]
}

export interface VaultContextPackOptions {
  maxWikiItems?: number
  maxRawItems?: number
  perItemChars?: number
  maxTotalChars?: number
  includeRawWhenWikiHits?: boolean
}

export interface SelectedVaultContextHits {
  wikiHits: VaultRetrievalHit[]
  rawHits: VaultRetrievalHit[]
}

export interface WikiWritebackCandidate {
  targetPath: string
  fileName: string
  content: string
  reason: string
}

function normalizePath(file: VaultRetrievalFile): string {
  return String(file.metadata?.folderPath || file.metadata?.targetPath || file.name || '').replace(/\\/g, '/')
}

function tokenize(text: string): string[] {
  const lower = String(text || '').toLowerCase()
  const tokens = new Set<string>()
  const words = lower.match(/[a-z0-9][a-z0-9_-]*/g) || []
  words.forEach(token => { if (token.length > 1) tokens.add(token) })
  const cjk = lower.match(/[\u4e00-\u9fff]+/g) || []
  for (const run of cjk) {
    if (run.length >= 2) {
      for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2))
    }
    if (run.length >= 3) {
      for (let i = 0; i < run.length - 2; i++) tokens.add(run.slice(i, i + 3))
    }
    if (run.length >= 3) tokens.add(run)
  }
  return Array.from(tokens)
}

function tokenizeDocument(text: string): string[] {
  const lower = String(text || '').toLowerCase()
  const tokens: string[] = []
  const words = lower.match(/[a-z0-9][a-z0-9_-]*/g) || []
  words.forEach(token => { if (token.length > 1) tokens.push(token) })
  const cjk = lower.match(/[\u4e00-\u9fff]+/g) || []
  for (const run of cjk) {
    if (run.length >= 2) {
      for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
    }
    if (run.length >= 3) {
      for (let i = 0; i < run.length - 2; i++) tokens.push(run.slice(i, i + 3))
    }
    if (run.length >= 3) tokens.push(run)
  }
  return tokens
}

interface QueryTerm {
  token: string
  source: 'query' | 'semantic' | 'skill-hint'
  origin?: string
}

interface QueryProfile {
  terms: QueryTerm[]
  tokens: string[]
}

const SEMANTIC_ALIAS_GROUPS = [
  ['商业化', '变现', '营收', '收入', '盈利', '赚钱', '付费', '订阅', '会员', '转化', '复购', '客单价', '价格'],
  ['视觉', '品牌', '设计系统', '规范', '组件', '色板', '字体', '一致性'],
  ['知识库', 'wiki', '资料库', '文档库', '检索', '召回', '索引'],
  ['Skill', 'skill', 'agent', '能力', '角色', '工作流', '超能'],
  ['剧本', '剧情', '人物', '角色', '冲突', '爽点', '章节'],
]

function extractSkillHint(query: string): string {
  return String(query || '').match(/当前Skill检索提示[:：]\s*([^\n]+)/)?.[1]?.trim() || ''
}

function buildQueryProfile(query: string): QueryProfile {
  const terms: QueryTerm[] = []
  const seen = new Set<string>()
  const addTerm = (token: string, source: QueryTerm['source'], origin?: string) => {
    const normalized = token.toLowerCase().trim()
    if (normalized.length <= 1) return
    const key = `${source}:${normalized}`
    if (seen.has(key)) return
    seen.add(key)
    terms.push({ token: normalized, source, origin })
  }

  const queryTokens = tokenize(query)
  queryTokens.forEach(token => addTerm(token, 'query'))

  const skillHint = extractSkillHint(query)
  tokenize(skillHint).forEach(token => addTerm(token, 'skill-hint'))

  const queryText = [query, skillHint].join('\n').toLowerCase()
  for (const group of SEMANTIC_ALIAS_GROUPS) {
    const matched = group.find(alias => {
      const aliasText = alias.toLowerCase()
      return queryText.includes(aliasText) || queryTokens.some(token => aliasText.includes(token) || token.includes(aliasText))
    })
    if (!matched) continue
    for (const alias of group) {
      addTerm(alias, 'semantic', matched)
      tokenize(alias).forEach(token => addTerm(token, 'semantic', matched))
    }
  }

  return {
    terms,
    tokens: Array.from(new Set(terms.map(term => term.token))),
  }
}

function summaryText(file: VaultRetrievalFile): string {
  return String(file.metadata?.summary || '').replace(/\s+/g, ' ').trim()
}

interface SummaryCorpusStats {
  avgLength: number
  idf: Map<string, number>
}

function buildSummaryCorpusStats(queryTokens: string[], files: VaultRetrievalFile[]): SummaryCorpusStats {
  const docs = files.map(file => tokenizeDocument(summaryText(file)))
  const avgLength = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, docs.length)
  const idf = new Map<string, number>()
  for (const token of queryTokens) {
    const df = docs.filter(doc => doc.includes(token)).length
    idf.set(token, Math.log(1 + (docs.length - df + 0.5) / (df + 0.5)))
  }
  return { avgLength: Math.max(1, avgLength), idf }
}

function bm25SummaryScore(queryTokens: string[], file: VaultRetrievalFile, stats?: SummaryCorpusStats): number {
  const summary = summaryText(file)
  if (!summary || !stats) return 0
  const doc = tokenizeDocument(summary)
  if (doc.length === 0) return 0
  const freq = new Map<string, number>()
  for (const token of doc) freq.set(token, (freq.get(token) || 0) + 1)
  const k1 = 1.2
  const b = 0.75
  let score = 0
  for (const token of queryTokens) {
    const tf = freq.get(token) || 0
    if (tf <= 0) continue
    const idf = stats.idf.get(token) || 0
    const denominator = tf + k1 * (1 - b + b * (doc.length / stats.avgLength))
    score += idf * ((tf * (k1 + 1)) / denominator)
  }
  return score
}

interface ScoredFile {
  score: number
  reasons: string[]
}

function pushReason(reasons: string[], reason: string) {
  if (reasons.length >= 60 || reasons.includes(reason)) return
  reasons.push(reason)
}

function metadataText(file: VaultRetrievalFile, key: string): string {
  const value = file.metadata?.[key]
  if (Array.isArray(value)) return value.map(String).join(' ')
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).map(String).join(' ')
  return String(value || '')
}

function scoreField(input: {
  field: 'title' | 'path' | 'summary' | 'tags' | 'folder-semantic' | 'body'
  text: string
  term: QueryTerm
  weight: number
  reasons: string[]
}): number {
  if (!input.text.includes(input.term.token)) return 0
  const sourceMultiplier = input.term.source === 'skill-hint' ? 1.15 : input.term.source === 'semantic' ? 0.85 : 1
  const score = Math.max(1, input.term.token.length) * input.weight * sourceMultiplier
  const label = input.term.source === 'semantic'
    ? `${input.field}:语义:${input.term.origin || input.term.token}->${input.term.token}`
    : `${input.field}:${input.term.token}`
  pushReason(input.reasons, label)
  if (input.term.source === 'skill-hint') pushReason(input.reasons, `skill-hint:${input.term.token}`)
  return score
}

function scoreFile(profile: QueryProfile, file: VaultRetrievalFile, stats?: SummaryCorpusStats): ScoredFile {
  const path = normalizePath(file).toLowerCase()
  const summary = summaryText(file).toLowerCase()
  const title = file.name.toLowerCase()
  const body = String(file.content || '').toLowerCase()
  const tags = metadataText(file, 'tags').toLowerCase()
  const folderSemantic = metadataText(file, 'folderSemantic').toLowerCase()
  const reasons: string[] = []
  let score = 0
  for (const term of profile.terms) {
    score += scoreField({ field: 'title', text: title, term, weight: 8, reasons })
    score += scoreField({ field: 'path', text: path, term, weight: 5, reasons })
    score += scoreField({ field: 'summary', text: summary, term, weight: 6, reasons })
    score += scoreField({ field: 'tags', text: tags, term, weight: 5, reasons })
    score += scoreField({ field: 'folder-semantic', text: folderSemantic, term, weight: 5, reasons })
    score += scoreField({ field: 'body', text: body, term, weight: 3, reasons })
  }
  const bm25 = bm25SummaryScore(profile.tokens, file, stats) * 14
  if (bm25 > 0) {
    score += bm25
    pushReason(reasons, 'summary-bm25')
  }
  if (profile.tokens.length > 0 && score === 0) return { score: 0, reasons: [] }
  if (file.metadata?.kind === 'vault-hot-cache') score += 80
  if (path.includes('wiki/index')) score += 10
  if (path.includes('wiki')) score += 4
  if (path.includes('raw')) score -= 1
  score += Math.min(5, Math.max(0, (file.updatedAt || 0) / 1_000_000_000_000))
  return { score, reasons }
}

function hitSummary(hit: VaultRetrievalHit): string {
  return String(hit.metadata?.summary || '').replace(/\s+/g, ' ').trim()
}

function hitExcerptText(hit: VaultRetrievalHit): string {
  const summary = hitSummary(hit)
  if (!summary) return hit.content
  return `摘要：${summary}\n正文：${hit.content}`
}

function isWiki(file: VaultRetrievalFile): boolean {
  const path = normalizePath(file)
  return file.metadata?.vaultFolder === 'wiki' || path.startsWith('wiki') || file.kind === 'page' || file.kind === 'entity'
}

function isRaw(file: VaultRetrievalFile): boolean {
  const path = normalizePath(file)
  return file.metadata?.vaultFolder === 'raw' || path.startsWith('raw') || file.kind === 'raw'
}

function toHit(file: VaultRetrievalFile, scored: ScoredFile): VaultRetrievalHit {
  return {
    ...file,
    score: scored.score,
    path: normalizePath(file),
    reasons: scored.reasons,
    metadata: {
      ...(file.metadata || {}),
      reasons: scored.reasons,
    },
  }
}

export function buildVaultRetrievalPlan(query: string, files: VaultRetrievalFile[]): VaultRetrievalPlan {
  const profile = buildQueryProfile(query)
  const searchableFiles = (files || []).filter(file => file.content && file.name !== 'CLAUDE.md')
  const summaryStats = buildSummaryCorpusStats(profile.tokens, searchableFiles)
  const scored = searchableFiles
    .map(file => toHit(file, scoreFile(profile, file, summaryStats)))
    .filter(hit => hit.score > 0)
    .sort((a, b) => b.score - a.score)

  return {
    query,
    wikiHits: scored.filter(isWiki),
    rawFallback: scored.filter(hit => isRaw(hit) && !isWiki(hit)),
  }
}

function excerpt(text: string, maxChars: number): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxChars)
}

function linesLength(lines: string[]): number {
  return lines.join('\n').length
}

interface BudgetedHitLines {
  lines: string[]
  hits: VaultRetrievalHit[]
}

function buildBudgetedHitLines(
  hits: VaultRetrievalHit[],
  maxItems: number,
  perItemChars: number,
  budgetChars: number,
  emptyLine = '- 无',
): BudgetedHitLines {
  if (budgetChars <= 0) return { lines: [], hits: [] }
  const lines: string[] = []
  const selectedHits: VaultRetrievalHit[] = []
  for (const hit of hits.slice(0, maxItems)) {
    const line = `- [${hit.path || 'wiki'}] ${hit.name}: ${excerpt(hitExcerptText(hit), perItemChars)}`
    const separatorLength = lines.length > 0 ? 1 : 0
    const remaining = budgetChars - linesLength(lines) - separatorLength
    if (remaining <= 0) break
    if (line.length <= remaining) {
      lines.push(line)
      selectedHits.push(hit)
      continue
    }
    if (remaining > 24) {
      lines.push(line.slice(0, remaining))
      selectedHits.push(hit)
    }
    break
  }

  if (lines.length === 0) {
    lines.push(emptyLine.slice(0, budgetChars))
  }
  return { lines, hits: selectedHits }
}

function isStructuralWikiHit(hit: VaultRetrievalHit): boolean {
  const path = String(hit.path || '').toLowerCase()
  const name = String(hit.name || '').toLowerCase()
  const kind = String(hit.metadata?.kind || '').toLowerCase()
  return (
    ['index.md', 'overview.md', 'hot.md', 'log.md'].includes(name) ||
    /wiki\/(index|overview|hot|log)(\.md)?$/.test(path) ||
    ['vault-index', 'vault-overview', 'vault-hot-cache', 'vault-log'].includes(kind)
  )
}

function hasSubstantiveWikiHit(plan: VaultRetrievalPlan): boolean {
  return plan.wikiHits.some(hit => !isStructuralWikiHit(hit))
}

function bestScore(hits: VaultRetrievalHit[]): number {
  return hits.reduce((max, hit) => Math.max(max, hit.score || 0), 0)
}

function rawFallbackShouldBeIncluded(plan: VaultRetrievalPlan, includeRawWhenWikiHits?: boolean): boolean {
  if (plan.wikiHits.length === 0) return true
  if (includeRawWhenWikiHits === true) return true
  if (!hasSubstantiveWikiHit(plan)) return true
  const bestRaw = bestScore(plan.rawFallback)
  if (bestRaw <= 0) return false
  const bestWiki = bestScore(plan.wikiHits.filter(hit => !isStructuralWikiHit(hit)))
  const tokens = tokenize(plan.query)
  const hasSummaryOnlyWikiHit = plan.wikiHits.some(hit => {
    const summary = hitSummary(hit).toLowerCase()
    if (!summary) return false
    const body = [hit.name, hit.path, hit.content].join('\n').toLowerCase()
    return tokens.some(token => summary.includes(token)) && !tokens.some(token => body.includes(token))
  })
  if (hasSummaryOnlyWikiHit && bestRaw > 0) return true
  return bestRaw >= Math.max(1, Math.floor(bestWiki * 0.75))
}

function buildVaultContextSelection(plan: VaultRetrievalPlan, opts: VaultContextPackOptions = {}) {
  const maxWikiItems = opts.maxWikiItems || 6
  const maxRawItems = opts.maxRawItems || 2
  const perItemChars = opts.perItemChars || 450
  const maxTotalChars = opts.maxTotalChars || 6000
  let shouldIncludeRaw = rawFallbackShouldBeIncluded(plan, opts.includeRawWhenWikiHits)
  const skeleton = '[Wiki 命中]\n\n[Raw 兜底]\n'
  const contentBudget = Math.max(0, maxTotalChars - skeleton.length)
  let rawBudget = shouldIncludeRaw ? Math.min(contentBudget, Math.max(32, Math.floor(contentBudget * 0.3))) : 0
  let wikiBudget = Math.max(0, contentBudget - rawBudget)
  let wikiSelection = buildBudgetedHitLines(plan.wikiHits, maxWikiItems, perItemChars, wikiBudget)

  if (!shouldIncludeRaw && rawFallbackShouldBeIncluded({ ...plan, wikiHits: wikiSelection.hits }, opts.includeRawWhenWikiHits)) {
    shouldIncludeRaw = true
    rawBudget = Math.min(contentBudget, Math.max(32, Math.floor(contentBudget * 0.3)))
    wikiBudget = Math.max(0, contentBudget - rawBudget)
    wikiSelection = buildBudgetedHitLines(plan.wikiHits, maxWikiItems, perItemChars, wikiBudget)
  }

  const wikiLines = wikiSelection.lines
  const usedWikiBudget = linesLength(wikiLines)
  const rawSelection = shouldIncludeRaw
    ? buildBudgetedHitLines(
      plan.rawFallback,
      maxRawItems,
      perItemChars,
      Math.max(0, contentBudget - usedWikiBudget),
    )
    : { lines: ['- Raw 兜底无/未启用'], hits: [] }

  return {
    wikiLines,
    rawLines: rawSelection.lines,
    wikiHits: wikiSelection.hits,
    rawHits: rawSelection.hits,
    maxTotalChars,
  }
}

export function selectVaultContextHits(plan: VaultRetrievalPlan, opts: VaultContextPackOptions = {}): SelectedVaultContextHits {
  const selection = buildVaultContextSelection(plan, opts)
  return {
    wikiHits: selection.wikiHits,
    rawHits: selection.rawHits,
  }
}

export function buildVaultContextPack(plan: VaultRetrievalPlan, opts: VaultContextPackOptions = {}): string {
  const selection = buildVaultContextSelection(plan, opts)

  return [
    '[Wiki 命中]',
    selection.wikiLines.join('\n'),
    '',
    '[Raw 兜底]',
    selection.rawLines.join('\n'),
  ].join('\n').slice(0, selection.maxTotalChars)
}

function fileNameFromText(text: string): string {
  const heading = String(text || '').split(/\r?\n/).find(line => /^#{1,3}\s+/.test(line))
  const base = (heading || String(text || '').split(/\r?\n/).find(Boolean) || '知识沉淀')
    .replace(/^#+\s*/, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 50) || '知识沉淀'
  return /\.md$/i.test(base) ? base : `${base}.md`
}

export function buildWikiWritebackCandidates(input: {
  userText: string
  assistantText: string
  preferredPath?: string
}): WikiWritebackCandidate[] {
  const assistantText = String(input.assistantText || '').trim()
  if (!assistantText || assistantText.startsWith('⚠️')) return []
  const substantial = assistantText.length >= 300 || /(^|\n)#{1,3}\s+/.test(assistantText)
  if (!substantial) return []

  return [{
    targetPath: String(input.preferredPath || 'wiki/沉淀内容').replace(/\/+$/g, ''),
    fileName: fileNameFromText(assistantText),
    content: [
      `<!-- 写回候选：${new Date().toLocaleString('zh-CN')} -->`,
      '',
      `## 用户问题`,
      input.userText,
      '',
      `## 输出内容`,
      assistantText,
    ].join('\n'),
    reason: '输出内容较完整，适合沉淀为 wiki 候选更新。',
  }]
}
