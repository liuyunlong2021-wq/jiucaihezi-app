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

const KIND_WEIGHT: Record<KnowledgeKind, number> = {
  page: 40,
  entity: 34,
  relation: 30,
  summary: 24,
  raw: 12,
  asset: 8,
}

export function scoreVaultKnowledge(query: string, item: VaultKnowledgeCandidate, now = Date.now()): number {
  const tokens = tokenize(query)
  if (tokens.length === 0) return 0

  const title = item.title.toLowerCase()
  const content = item.content.toLowerCase()
  const tags = (item.tags || []).join(' ').toLowerCase()
  let score = KIND_WEIGHT[item.kind || 'raw'] || 0

  for (const token of tokens) {
    if (title.includes(token)) score += token.length * 12
    if (tags.includes(token)) score += token.length * 8
    if (content.includes(token)) score += token.length * 3
  }

  const ageMs = Math.max(0, now - (item.updatedAt || 0))
  const ageDays = ageMs / (24 * 60 * 60 * 1000)
  score += Math.max(0, 16 - ageDays)
  return score
}

export function rankVaultKnowledge(query: string, items: VaultKnowledgeCandidate[]): VaultKnowledgeCandidate[] {
  return items
    .map(item => ({ item, score: scoreVaultKnowledge(query, item) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(row => row.item)
}

export function buildVaultIndexEntries(items: VaultKnowledgeCandidate[]): VaultIndexEntry[] {
  return items
    .filter(item => item.id && item.title)
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh-CN'))
    .map(item => ({
      id: item.id,
      title: item.title,
      kind: item.kind || 'raw',
      summary: String(item.content || '').replace(/\s+/g, ' ').slice(0, 120),
      updatedAt: item.updatedAt || 0,
    }))
}

export function lintVaultKnowledge(items: VaultKnowledgeCandidate[]): VaultLintIssue[] {
  const issues: VaultLintIssue[] = []
  const entityNames = new Set(
    items
      .filter(item => item.kind === 'entity' || item.kind === 'page')
      .map(item => item.title)
  )

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

  return issues
}
