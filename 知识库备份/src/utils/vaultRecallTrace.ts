import type { VaultRetrievalHit } from './vaultRetrieval'
import type { VaultEvidenceWikiFile, VaultEvidenceIntent } from './vaultEvidencePlanner'
import type { VaultSourceChunk } from './vaultChunking'

export interface RecallKnowledgeHit {
  id: string
  path: string
  title: string
  source: 'wiki' | 'raw'
  reason: string
  score: number
  snippet: string
  risk?: 'prompt-injection'
}

export interface BuildRecallKnowledgeHitsInput {
  wikiHits: VaultRetrievalHit[]
  rawHits: VaultRetrievalHit[]
  evidenceWiki?: VaultEvidenceWikiFile[]
  evidenceChunks?: VaultSourceChunk[]
  evidenceIntent?: VaultEvidenceIntent['kind'] | string
  maxItems?: number
}

export function buildRecallKnowledgeHits(input: BuildRecallKnowledgeHitsInput): RecallKnowledgeHit[] {
  const seen = new Set<string>()
  const hits: RecallKnowledgeHit[] = []
  const maxItems = Math.max(0, input.maxItems ?? 12)

  for (const hit of buildEvidenceHits(input)) {
    if (!hit.id || seen.has(hit.id)) continue
    seen.add(hit.id)
    hits.push(hit)
    if (hits.length >= maxItems) return hits
  }

  for (const [source, retrievalHits] of [
    ['wiki', input.wikiHits],
    ['raw', input.rawHits],
  ] as const) {
    for (const hit of retrievalHits || []) {
      const id = String(hit.id || hit.path || hit.name || '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      hits.push({
        id,
        path: String(hit.path || hit.metadata?.folderPath || hit.name || ''),
        title: String(hit.name || hit.path || '知识条目'),
        source,
        reason: buildReason(source, hit),
        score: Number.isFinite(hit.score) ? Number(hit.score) : 0,
        snippet: excerpt(String(hit.metadata?.summary || hit.content || ''), 180),
        risk: hasPromptInjectionRisk(hit) ? 'prompt-injection' : undefined,
      })
      if (hits.length >= maxItems) return hits
    }
  }

  return hits
}

function buildEvidenceHits(input: BuildRecallKnowledgeHitsInput): RecallKnowledgeHit[] {
  const intent = input.evidenceIntent ? ` · ${input.evidenceIntent}` : ''
  const wikiHits = (input.evidenceWiki || []).map(file => ({
    id: String(file.id || file.path || file.name || ''),
    path: String(file.path || file.name || ''),
    title: String(file.name || file.path || '结构化 Wiki'),
    source: 'wiki' as const,
    reason: `结构化 Evidence Wiki${intent}`,
    score: 100000,
    snippet: excerpt(String(file.metadata?.summary || file.content || ''), 180),
    risk: hasPromptInjectionRisk({
      id: file.id,
      path: file.path,
      name: file.name,
      content: file.content,
      metadata: file.metadata,
      score: 0,
    } as VaultRetrievalHit) ? 'prompt-injection' as const : undefined,
  }))
  const chunkHits = (input.evidenceChunks || []).map(chunk => ({
    id: String(chunk.id || `${chunk.sourcePath}${chunk.anchor}`),
    path: `${chunk.sourcePath}${chunk.anchor}`,
    title: chunk.title || chunk.sourcePath,
    source: 'raw' as const,
    reason: `结构化 Evidence Raw Chunk${intent}`,
    score: 90000,
    snippet: excerpt(chunk.text, 180),
    risk: hasPromptInjectionRisk({
      id: chunk.id,
      path: `${chunk.sourcePath}${chunk.anchor}`,
      name: chunk.title,
      content: chunk.text,
      metadata: chunk.metadata,
      score: 0,
    } as VaultRetrievalHit) ? 'prompt-injection' as const : undefined,
  }))
  return [...wikiHits, ...chunkHits]
}

function buildReason(source: 'wiki' | 'raw', hit: VaultRetrievalHit): string {
  const base = source === 'wiki' ? 'Wiki 命中' : 'Raw 兜底'
  const reasons = Array.isArray(hit.metadata?.reasons)
    ? hit.metadata.reasons.map(String).filter(Boolean)
    : Array.isArray(hit.reasons)
      ? hit.reasons.map(String).filter(Boolean)
      : []
  const reasonText = reasons.length ? ` · ${reasons.slice(0, 4).join(' · ')}` : ''
  return hasPromptInjectionRisk(hit) ? `${base}${reasonText} · 疑似注入风险` : `${base}${reasonText}`
}

function hasPromptInjectionRisk(hit: VaultRetrievalHit): boolean {
  const text = [
    hit.name,
    hit.path,
    hit.metadata?.summary,
    hit.content,
  ].filter(Boolean).join('\n').toLowerCase()
  return /忽略(上文|之前|系统)|泄露|api key|apikey|token|系统管理员|developer message|system prompt/.test(text)
}

function excerpt(text: string, maxChars: number): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, maxChars)
}
