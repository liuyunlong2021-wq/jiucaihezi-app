import type { ConversationMemoryItemRecord } from './types'

export interface MemoryScoreInput {
  importanceScore: number
  recencyScore: number
  usageScore: number
  anchorBoost: number
  conflictPenalty: number
}

export interface CompactConversationMemoryInput {
  items: ConversationMemoryItemRecord[]
  activeRuntimeSegmentCount: number
  now: number
}

export interface CompactConversationMemoryResult {
  active: ConversationMemoryItemRecord[]
  archived: ConversationMemoryItemRecord[]
  maxActiveAnchors: number
}

export function scoreConversationMemory(input: MemoryScoreInput): number {
  return input.importanceScore * 0.35
    + input.recencyScore * 0.25
    + input.usageScore * 0.20
    + input.anchorBoost * 0.15
    - input.conflictPenalty * 0.05
}

export function compactConversationMemory(input: CompactConversationMemoryInput): CompactConversationMemoryResult {
  const maxActiveAnchors = clamp(20 + input.activeRuntimeSegmentCount * 5, 30, 80)
  const scored = input.items.map(item => {
    const missedCount = Number(item.metadata?.missedCount || 0)
    const importanceScore = item.kind === 'decision' || item.kind === 'preference' ? 1 : item.kind === 'summary' ? 0.7 : 0.35
    const recencyScore = Math.max(0, 1 - ((input.now - item.updatedAt) / (1000 * 60 * 60 * 24 * 30)))
    const usageScore = item.lastUsedAt ? 1 : Math.max(0, 1 - missedCount / 20)
    const anchorBoost = item.layer === 'anchor' ? 1 : 0
    const conflictPenalty = item.metadata?.conflict ? 1 : 0
    return {
      item,
      score: scoreConversationMemory({ importanceScore, recencyScore, usageScore, anchorBoost, conflictPenalty }),
    }
  })

  const anchors = scored
    .filter(entry => entry.item.layer === 'anchor')
    .sort((a, b) => b.score - a.score)
  const activeAnchorIds = new Set(anchors.slice(0, maxActiveAnchors).map(entry => entry.item.id))
  const active: ConversationMemoryItemRecord[] = []
  const archived: ConversationMemoryItemRecord[] = []

  for (const entry of scored) {
    const missedCount = Number(entry.item.metadata?.missedCount || 0)
    const shouldArchive = entry.item.layer === 'anchor'
      ? !activeAnchorIds.has(entry.item.id)
      : entry.item.kind === 'fact' && (entry.score < 0.25 || missedCount >= 10)
    if (shouldArchive) archived.push({ ...entry.item, syncStatus: 'archived' })
    else active.push({ ...entry.item, score: entry.score })
  }

  return { active, archived, maxActiveAnchors }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
