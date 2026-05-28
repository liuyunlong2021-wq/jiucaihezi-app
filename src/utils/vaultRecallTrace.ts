import type { VaultRetrievalHit } from './vaultRetrieval'

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
  maxItems?: number
}

export function buildRecallKnowledgeHits(input: BuildRecallKnowledgeHitsInput): RecallKnowledgeHit[] {
  const seen = new Set<string>()
  const hits: RecallKnowledgeHit[] = []
  const maxItems = Math.max(0, input.maxItems ?? 12)

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
