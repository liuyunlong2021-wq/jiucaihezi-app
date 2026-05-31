import type { ConversationContextDegradation, ConversationMemoryHit, ConversationMemoryItemRecord } from './types'
import { hasValidMemoryProvenance } from './provenance'

export interface MemoryIndexSearchInput {
  query: string
  sessionId: string
  runtimeSegmentId: string
  selectedSkillId?: string
  limit: number
}

export interface MemoryIndexSearchResult {
  hits: ConversationMemoryHit[]
}

export interface MemoryIndexTurnInput {
  sessionId: string
  runtimeSegmentId: string
  runId: string
  sourceMessageIds: string[]
  text: string
}

export interface MemoryIndexWriteResult {
  items: ConversationMemoryItemRecord[]
}

export interface ConversationMemoryIndexDriver {
  search(input: MemoryIndexSearchInput): Promise<MemoryIndexSearchResult>
  indexTurn(input: MemoryIndexTurnInput): Promise<MemoryIndexWriteResult>
  deleteSession(sessionId: string): Promise<void>
}

export interface SearchConversationMemoryIndexInput extends MemoryIndexSearchInput {
  driver: ConversationMemoryIndexDriver
  timeoutMs: number
}

export interface SearchConversationMemoryIndexResult {
  hits: ConversationMemoryHit[]
  degradation?: ConversationContextDegradation
}

export async function searchConversationMemoryIndex(
  input: SearchConversationMemoryIndexInput,
): Promise<SearchConversationMemoryIndexResult> {
  try {
    const result = await withTimeout(input.driver.search(input), input.timeoutMs)
    const hits = result.hits
      .filter(hit => hasValidMemoryProvenance(hit))
      .slice(0, input.limit)
    return { hits }
  } catch (error) {
    return {
      hits: [],
      degradation: {
        reason: error instanceof Error && error.message === 'timeout' ? 'memory_index_timeout' : 'memory_index_error',
        omittedSections: ['conversation-memory'],
      },
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
