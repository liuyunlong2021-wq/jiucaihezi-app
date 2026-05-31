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
      const item: ConversationMemoryItemRecord = {
        id: `mem_${Math.abs(hashString(turnInput.sessionId + turnInput.runId))}`,
        sessionId: turnInput.sessionId,
        runtimeSegmentId: turnInput.runtimeSegmentId,
        kind: /决定|确认|采用/.test(turnInput.text) ? 'decision' : 'fact',
        layer: 'turn',
        text: turnInput.text.slice(0, 1000),
        score: 0.5,
        recallReason: 'indexed_turn',
        sourceMessageIds: turnInput.sourceMessageIds,
        createdAt: now,
        tokenCount: approximateTokenSize(turnInput.text),
        updatedAt: now,
        indexDriver: 'local',
        idempotencyKey: buildMemoryIdempotencyKey(turnInput.sessionId, turnInput.runtimeSegmentId, turnInput.runId, turnInput.sourceMessageIds),
        syncStatus: 'local_only',
        metadata: {},
      }
      await input.storage.saveMemoryItem(item)
      return { items: [item] }
    },
    async deleteSession(sessionId: string): Promise<void> {
      await input.storage.deleteSession(sessionId)
    },
  }
}

function tokenize(text: string): Set<string> {
  return new Set(String(text || '').toLowerCase().match(/[a-z0-9_-]{2,}|[\u4e00-\u9fa5]{2,}/g) || [])
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
