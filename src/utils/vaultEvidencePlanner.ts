import type { VaultSourceChunk } from './vaultChunking'

export interface VaultEvidenceWikiFile {
  id: string
  path: string
  name: string
  content: string
  metadata?: Record<string, unknown>
}

export interface VaultEvidencePlan {
  intent: VaultEvidenceIntent
  selectedWiki: VaultEvidenceWikiFile[]
  selectedChunks: VaultSourceChunk[]
  evidenceText: string
}

export interface VaultEvidenceIntent {
  domain: 'novel' | 'legal' | 'general'
  kind: 'novel_relationship' | 'legal_similar_case' | 'legal_template_draft' | 'general_lookup'
  keywords: string[]
}

function normalize(text: string): string {
  return String(text || '').toLowerCase()
}

function includesAny(text: string, terms: string[]): boolean {
  const value = normalize(text)
  return terms.some(term => value.includes(normalize(term)))
}

function identifyVaultIntent(query: string): VaultEvidenceIntent {
  const tokens = queryTokens(query)
  if (includesAny(query, ['故意伤害', '案子', '案件', '案由', '起诉状', '诉状', '证据'])) {
    return {
      domain: 'legal',
      kind: includesAny(query, ['起诉状', '诉状', '模板', '参照', '写'])
        ? 'legal_template_draft'
        : 'legal_similar_case',
      keywords: tokens,
    }
  }
  if (includesAny(query, ['男主', '女主', '爱情', '感情', '关系', '回忆'])) {
    return {
      domain: 'novel',
      kind: 'novel_relationship',
      keywords: tokens,
    }
  }
  return {
    domain: 'general',
    kind: 'general_lookup',
    keywords: tokens,
  }
}

function scoreWiki(query: string, intent: VaultEvidenceIntent, file: VaultEvidenceWikiFile): number {
  const path = normalize(file.path)
  const body = normalize(`${file.name}\n${file.content}`)
  let score = 0

  if (intent.kind === 'novel_relationship') {
    if (path.includes('wiki/人物/男主')) score += 10000
    if (path.includes('wiki/人物/女主')) score += 9000
    if (path.includes('wiki/关系/')) score += 8000
    if (path.includes('wiki/事件线/') || path.includes('感情线')) score += 7000
    if (path.includes('wiki/写作状态/')) score += 60
  }

  if (intent.kind === 'legal_similar_case' || intent.kind === 'legal_template_draft') {
    if (path.includes('wiki/案由/') && body.includes('故意伤害')) score += 10000
    if (path.includes('wiki/案件/')) score += 9000
    if (path.includes('wiki/文书模板/') && body.includes('起诉状')) score += 8000
    if (path.includes('wiki/办案策略/')) score += 7000
    if (path.includes('wiki/证据/')) score += 65
  }

  for (const token of intent.keywords.length ? intent.keywords : queryTokens(query)) {
    if (path.includes(token)) score += 8
    if (body.includes(token)) score += 4
  }
  return score
}

function queryTokens(query: string): string[] {
  const text = normalize(query)
  const tokens = new Set<string>()
  const words = text.match(/[a-z0-9][a-z0-9_-]*/g) || []
  words.forEach(word => { if (word.length > 1) tokens.add(word) })
  const cjk = text.match(/[\u4e00-\u9fff]+/g) || []
  for (const run of cjk) {
    if (run.length >= 2) {
      for (let i = 0; i < run.length - 1; i++) tokens.add(run.slice(i, i + 2))
    }
    if (run.length >= 3) tokens.add(run)
  }
  return Array.from(tokens)
}

function scoreChunk(query: string, intent: VaultEvidenceIntent, chunk: VaultSourceChunk): number {
  const text = normalize(`${chunk.sourcePath}\n${chunk.title}\n${chunk.headingPath.join(' ')}\n${chunk.text}`)
  let score = 0
  if (intent.kind === 'novel_relationship' && includesAny(text, ['男主', '女主', '饼干', '山洞', '感情', '爱情'])) {
    score += 90
  }
  if ((intent.kind === 'legal_similar_case' || intent.kind === 'legal_template_draft') && includesAny(text, ['故意伤害', '案由', '证据', '起诉状', '诉状'])) {
    score += 90
  }
  for (const token of intent.keywords.length ? intent.keywords : queryTokens(query)) {
    if (text.includes(token)) score += 5
  }
  return score
}

function excerpt(text: string, maxChars: number): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxChars)
}

function intentLabel(intent: VaultEvidenceIntent): string {
  if (intent.kind === 'novel_relationship') return '小说关系/感情线续写'
  if (intent.kind === 'legal_similar_case') return '律师相似案件检索'
  if (intent.kind === 'legal_template_draft') return '律师文书模板参照'
  return '通用知识检索'
}

function capEvidenceText(text: string, maxTotalChars?: number): string {
  if (!maxTotalChars || maxTotalChars <= 0 || text.length <= maxTotalChars) return text
  const marker = '\n[已按预算截断]'
  const limit = Math.max(0, maxTotalChars - marker.length)
  return `${text.slice(0, limit).trimEnd()}${marker}`.slice(0, maxTotalChars)
}

function buildEvidenceText(
  intent: VaultEvidenceIntent,
  wiki: VaultEvidenceWikiFile[],
  chunks: VaultSourceChunk[],
  perItemChars: number,
  maxTotalChars?: number,
): string {
  return capEvidenceText([
    '[检索意图]',
    `- ${intentLabel(intent)} (${intent.kind})`,
    '',
    '[结构化 Wiki 命中]',
    ...(wiki.length
      ? wiki.map(file => `- [${file.path}] ${file.name}: ${excerpt(file.content, perItemChars)}`)
      : ['- 无']),
    '',
    '[来源原文片段]',
    ...(chunks.length
      ? chunks.map(chunk => `- [${chunk.sourcePath}${chunk.anchor}] ${chunk.title}: ${excerpt(chunk.text, perItemChars)}`)
      : ['- 无']),
  ].join('\n'), maxTotalChars)
}

export function buildVaultEvidencePlan(input: {
  query: string
  wikiFiles: VaultEvidenceWikiFile[]
  chunks: VaultSourceChunk[]
  maxWikiItems?: number
  maxChunkItems?: number
  perItemChars?: number
  maxTotalChars?: number
}): VaultEvidencePlan {
  const maxWikiItems = input.maxWikiItems || 8
  const maxChunkItems = input.maxChunkItems || 4
  const perItemChars = input.perItemChars || 500
  const intent = identifyVaultIntent(input.query)
  const selectedWiki = (input.wikiFiles || [])
    .map(file => ({ file, score: scoreWiki(input.query, intent, file) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxWikiItems)
    .map(item => item.file)
  const selectedChunks = (input.chunks || [])
    .map(chunk => ({ chunk, score: scoreChunk(input.query, intent, chunk) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxChunkItems)
    .map(item => item.chunk)

  return {
    intent,
    selectedWiki,
    selectedChunks,
    evidenceText: buildEvidenceText(intent, selectedWiki, selectedChunks, perItemChars, input.maxTotalChars),
  }
}
