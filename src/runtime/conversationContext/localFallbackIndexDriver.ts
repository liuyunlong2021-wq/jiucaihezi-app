import { approximateTokenSize } from 'tokenx'
import type { ConversationContextStorage } from './storage'
import type {
  ConversationMemoryIndexDriver,
  MemoryIndexSearchInput,
  MemoryIndexSearchResult,
  MemoryIndexTurnInput,
  MemoryIndexWriteResult,
} from './memoryIndex'
import type { ConversationMemoryItemRecord } from './types'
import { buildMemoryIdempotencyKey } from './provenance'

export interface LocalFallbackIndexDriverInput {
  storage: ConversationContextStorage
}

export function createLocalFallbackIndexDriver(input: LocalFallbackIndexDriverInput): ConversationMemoryIndexDriver {
  return {
    async search(searchInput: MemoryIndexSearchInput): Promise<MemoryIndexSearchResult> {
      const terms = tokenize(searchInput.query)
      const items = await input.storage.listMemoryItems(searchInput.sessionId)
      const hits = items
        .filter(item => item.syncStatus !== 'delete_pending' && item.syncStatus !== 'archived')
        .filter(item => shouldSearchMemoryItem(item, searchInput.selectedSkillId, searchInput.runtimeSegmentId))
        .map(item => ({
          item,
          overlap: lexicalOverlap(terms, tokenize(item.text)),
        }))
        .filter(entry => entry.overlap > 0 || entry.item.runtimeSegmentId === searchInput.runtimeSegmentId)
        .sort((a, b) => (b.overlap + b.item.score) - (a.overlap + a.item.score))
        .slice(0, searchInput.limit)
        .map(entry => ({
          id: entry.item.id,
          text: entry.item.text,
          score: entry.item.score,
          kind: entry.item.kind,
          layer: entry.item.layer,
          recallReason: entry.overlap > 0 ? 'lexical_overlap' : 'same_runtime_segment',
          sourceMessageIds: entry.item.sourceMessageIds,
          sessionId: entry.item.sessionId,
          runtimeSegmentId: entry.item.runtimeSegmentId,
          skillId: entry.item.skillId,
          vaultId: entry.item.vaultId,
          createdAt: entry.item.createdAt,
          lastUsedAt: entry.item.lastUsedAt,
        }))
      return { hits }
    },
    async indexTurn(turnInput: MemoryIndexTurnInput): Promise<MemoryIndexWriteResult> {
      const now = Date.now()
      const classification = classifyMemoryText(turnInput.text)
      const item: ConversationMemoryItemRecord = {
        id: `mem_${Math.abs(hashString(turnInput.sessionId + turnInput.runId))}`,
        sessionId: turnInput.sessionId,
        runtimeSegmentId: turnInput.runtimeSegmentId,
        kind: classification.kind,
        layer: classification.layer,
        text: turnInput.text.slice(0, 1000),
        score: classification.score,
        recallReason: 'indexed_turn',
        sourceMessageIds: turnInput.sourceMessageIds,
        createdAt: now,
        tokenCount: approximateTokenSize(turnInput.text),
        updatedAt: now,
        indexDriver: 'local',
        idempotencyKey: buildMemoryIdempotencyKey(turnInput.sessionId, turnInput.runtimeSegmentId, turnInput.runId, turnInput.sourceMessageIds),
        syncStatus: 'local_only',
        metadata: classification.metadata,
      }
      await input.storage.saveMemoryItem(item)
      return { items: [item] }
    },
    async deleteSession(sessionId: string): Promise<void> {
      await input.storage.deleteSession(sessionId)
    },
  }
}

function shouldSearchMemoryItem(
  item: ConversationMemoryItemRecord,
  selectedSkillId: string | undefined,
  runtimeSegmentId: string,
): boolean {
  if (item.skillId == null) return true
  if (!selectedSkillId) {
    return item.runtimeSegmentId === runtimeSegmentId
  }
  if (item.skillId === selectedSkillId) return true
  if (item.runtimeSegmentId === runtimeSegmentId) return true
  return false
}

function classifyMemoryText(text: string): Pick<ConversationMemoryItemRecord, 'kind' | 'layer' | 'score' | 'metadata'> {
  const hasDecision = /决定|确认|采用|定了|选择/.test(text)
  const hasPreference = /我希望|我喜欢|偏好|以后都|始终/.test(text)
  const hasOpenThread = /下一步|还需要|待办|未完成|继续|TODO|todo/i.test(text)
  if (hasPreference) {
    return {
      kind: 'preference',
      layer: 'anchor',
      score: 0.82,
      metadata: { hasDecision, hasOpenThread },
    }
  }
  if (hasDecision) {
    return {
      kind: 'decision',
      layer: 'anchor',
      score: 0.78,
      metadata: { hasOpenThread },
    }
  }
  if (hasOpenThread) {
    return {
      kind: 'open_thread',
      layer: 'turn',
      score: 0.62,
      metadata: { hasOpenThread },
    }
  }
  return {
    kind: 'fact',
    layer: 'turn',
    score: 0.5,
    metadata: {},
  }
}

function tokenize(text: string): Set<string> {
  const tokens = new Set(String(text || '').toLowerCase().match(/[a-z0-9_-]{2,}|[\u4e00-\u9fa5]{2,}/g) || [])
  const chineseText = String(text || '').match(/[\u4e00-\u9fa5]+/g)?.join('') || ''
  for (let index = 0; index < chineseText.length - 1; index += 1) {
    tokens.add(chineseText.slice(index, index + 2))
  }
  return tokens
}

function lexicalOverlap(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0
  let hits = 0
  for (const term of left) if (right.has(term)) hits += 1
  return hits / Math.max(left.size, 1)
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i)
    hash |= 0
  }
  return hash
}
