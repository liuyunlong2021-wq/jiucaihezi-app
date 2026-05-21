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
  lower.split(/\s+/).forEach(token => { if (token.length > 1) tokens.add(token) })
  const cjk = lower.match(/[\u4e00-\u9fff]+/g) || []
  for (const run of cjk) {
    if (run.length >= 2) {
      for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2))
    }
    if (run.length >= 3) tokens.add(run)
  }
  return Array.from(tokens)
}

function scoreFile(queryTokens: string[], file: VaultRetrievalFile): number {
  const path = normalizePath(file).toLowerCase()
  const text = `${file.name}\n${path}\n${file.content}`.toLowerCase()
  let score = 0
  for (const token of queryTokens) {
    if (file.name.toLowerCase().includes(token)) score += 8
    if (path.includes(token)) score += 5
    if (text.includes(token)) score += 3
  }
  if (queryTokens.length > 0 && score === 0) return 0
  if (file.metadata?.kind === 'vault-hot-cache') score += 20
  if (path.includes('wiki/index')) score += 10
  if (path.includes('wiki')) score += 4
  if (path.includes('raw')) score -= 1
  score += Math.min(5, Math.max(0, (file.updatedAt || 0) / 1_000_000_000_000))
  return score
}

function isWiki(file: VaultRetrievalFile): boolean {
  const path = normalizePath(file)
  return file.metadata?.vaultFolder === 'wiki' || path.startsWith('wiki') || file.kind === 'page' || file.kind === 'entity'
}

function isRaw(file: VaultRetrievalFile): boolean {
  const path = normalizePath(file)
  return file.metadata?.vaultFolder === 'raw' || path.startsWith('raw') || file.kind === 'raw'
}

function toHit(file: VaultRetrievalFile, score: number): VaultRetrievalHit {
  return { ...file, score, path: normalizePath(file) }
}

export function buildVaultRetrievalPlan(query: string, files: VaultRetrievalFile[]): VaultRetrievalPlan {
  const tokens = tokenize(query)
  const scored = (files || [])
    .filter(file => file.content && file.name !== 'CLAUDE.md')
    .map(file => toHit(file, scoreFile(tokens, file)))
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

function buildBudgetedHitLines(
  hits: VaultRetrievalHit[],
  maxItems: number,
  perItemChars: number,
  budgetChars: number,
  emptyLine = '- 无',
): string[] {
  if (budgetChars <= 0) return []
  const lines: string[] = []
  for (const hit of hits.slice(0, maxItems)) {
    const line = `- [${hit.path || 'wiki'}] ${hit.name}: ${excerpt(hit.content, perItemChars)}`
    const separatorLength = lines.length > 0 ? 1 : 0
    const remaining = budgetChars - linesLength(lines) - separatorLength
    if (remaining <= 0) break
    if (line.length <= remaining) {
      lines.push(line)
      continue
    }
    if (remaining > 24) lines.push(line.slice(0, remaining))
    break
  }

  if (lines.length === 0) {
    lines.push(emptyLine.slice(0, budgetChars))
  }
  return lines
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
  return bestRaw >= Math.max(1, Math.floor(bestWiki * 0.75))
}

export function buildVaultContextPack(plan: VaultRetrievalPlan, opts: VaultContextPackOptions = {}): string {
  const maxWikiItems = opts.maxWikiItems || 6
  const maxRawItems = opts.maxRawItems || 2
  const perItemChars = opts.perItemChars || 450
  const maxTotalChars = opts.maxTotalChars || 6000
  const shouldIncludeRaw = rawFallbackShouldBeIncluded(plan, opts.includeRawWhenWikiHits)
  const skeleton = '[Wiki 命中]\n\n[Raw 兜底]\n'
  const contentBudget = Math.max(0, maxTotalChars - skeleton.length)
  const rawBudget = shouldIncludeRaw ? Math.min(contentBudget, Math.max(32, Math.floor(contentBudget * 0.3))) : 0
  const wikiBudget = Math.max(0, contentBudget - rawBudget)
  const wikiLines = buildBudgetedHitLines(plan.wikiHits, maxWikiItems, perItemChars, wikiBudget)
  const usedWikiBudget = linesLength(wikiLines)
  const rawLines = shouldIncludeRaw
    ? buildBudgetedHitLines(
      plan.rawFallback,
      maxRawItems,
      perItemChars,
      Math.max(0, contentBudget - usedWikiBudget),
    )
    : ['- Raw 兜底无/未启用']

  return [
    '[Wiki 命中]',
    wikiLines.join('\n'),
    '',
    '[Raw 兜底]',
    rawLines.join('\n'),
  ].join('\n').slice(0, maxTotalChars)
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
