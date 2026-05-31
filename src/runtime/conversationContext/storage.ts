import {
  getConversationContextRecord,
  listConversationContextRecords,
  removeConversationContextRecord,
  setConversationContextRecord,
} from '@/utils/idb'
import type {
  ContinuationState,
  ConversationDirtySegmentRecord,
  ConversationMemoryIndexJob,
  ConversationMemoryItemRecord,
  ConversationMessageChunk,
  ConversationRebuildJobRecord,
  ConversationRunSnapshotRecord,
  RuntimeSegmentRecord,
} from './types'

export type ConversationContextStoreName =
  | 'runtime_segments'
  | 'conversation_run_snapshots'
  | 'conversation_message_chunks'
  | 'conversation_memory_items'
  | 'conversation_memory_jobs'
  | 'conversation_continuations'
  | 'conversation_rebuild_jobs'
  | 'conversation_dirty_segments'

export interface ConversationContextStorage {
  saveRuntimeSegment(record: RuntimeSegmentRecord): Promise<void>
  listRuntimeSegments(sessionId: string): Promise<RuntimeSegmentRecord[]>
  saveRunSnapshot(record: ConversationRunSnapshotRecord): Promise<void>
  listRunSnapshots(sessionId: string): Promise<ConversationRunSnapshotRecord[]>
  saveMessageChunks(chunks: ConversationMessageChunk[]): Promise<void>
  listMessageChunksByMessageId(messageId: string): Promise<ConversationMessageChunk[]>
  listMessageChunksBySession(sessionId: string): Promise<ConversationMessageChunk[]>
  saveMemoryItem(record: ConversationMemoryItemRecord): Promise<void>
  listMemoryItems(sessionId: string): Promise<ConversationMemoryItemRecord[]>
  enqueueMemoryJob(record: ConversationMemoryIndexJob): Promise<void>
  listMemoryJobsByStatus(status: ConversationMemoryIndexJob['status'], now: number): Promise<ConversationMemoryIndexJob[]>
  saveMemoryJob(record: ConversationMemoryIndexJob): Promise<void>
  saveContinuation(record: ContinuationState & { id: string; sessionId: string; runtimeSegmentId: string; createdAt: number; updatedAt: number; metadata: Record<string, unknown> }): Promise<void>
  saveRebuildJob(record: ConversationRebuildJobRecord): Promise<void>
  saveDirtySegment(record: ConversationDirtySegmentRecord): Promise<void>
  listDirtySegments(sessionId: string): Promise<ConversationDirtySegmentRecord[]>
  invalidateMessages(
    sessionId: string,
    messageIds: string[],
    now: number,
    reason: ConversationDirtySegmentRecord['reason'],
  ): Promise<void>
  deleteSession(sessionId: string): Promise<void>
}

export function createConversationContextMemoryStorage(): ConversationContextStorage {
  const stores = new Map<ConversationContextStoreName, Map<string, any>>()
  const getStore = (name: ConversationContextStoreName) => {
    let store = stores.get(name)
    if (!store) {
      store = new Map()
      stores.set(name, store)
    }
    return store
  }
  const list = <T>(name: ConversationContextStoreName): T[] => Array.from(getStore(name).values())
  const save = async (name: ConversationContextStoreName, record: any) => {
    const store = getStore(name)
    if (name === 'conversation_memory_jobs') {
      for (const [key, existing] of store.entries()) {
        if (existing.idempotencyKey === record.idempotencyKey) store.delete(key)
      }
    }
    store.set(record.id, record)
  }

  return {
    saveRuntimeSegment: record => save('runtime_segments', record),
    listRuntimeSegments: async sessionId => list<RuntimeSegmentRecord>('runtime_segments')
      .filter(record => record.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt),
    saveRunSnapshot: record => save('conversation_run_snapshots', record),
    listRunSnapshots: async sessionId => list<ConversationRunSnapshotRecord>('conversation_run_snapshots')
      .filter(record => record.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt),
    saveMessageChunks: async chunks => {
      for (const chunk of chunks) await save('conversation_message_chunks', chunk)
    },
    listMessageChunksByMessageId: async messageId => list<ConversationMessageChunk>('conversation_message_chunks')
      .filter(record => record.messageId === messageId)
      .sort((a, b) => a.chunkIndex - b.chunkIndex),
    listMessageChunksBySession: async sessionId => list<ConversationMessageChunk>('conversation_message_chunks')
      .filter(record => record.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt || a.chunkIndex - b.chunkIndex),
    saveMemoryItem: record => save('conversation_memory_items', record),
    listMemoryItems: async sessionId => list<ConversationMemoryItemRecord>('conversation_memory_items')
      .filter(record => record.sessionId === sessionId),
    enqueueMemoryJob: record => save('conversation_memory_jobs', record),
    saveMemoryJob: record => save('conversation_memory_jobs', record),
    listMemoryJobsByStatus: async (status, now) => list<ConversationMemoryIndexJob>('conversation_memory_jobs')
      .filter(record => record.status === status && record.nextRunAt <= now)
      .sort((a, b) => a.nextRunAt - b.nextRunAt),
    saveContinuation: record => save('conversation_continuations', record),
    saveRebuildJob: record => save('conversation_rebuild_jobs', record),
    saveDirtySegment: record => save('conversation_dirty_segments', record),
    listDirtySegments: async sessionId => list<ConversationDirtySegmentRecord>('conversation_dirty_segments')
      .filter(record => record.sessionId === sessionId),
    invalidateMessages: async (sessionId, messageIds, now, reason) => {
      invalidateRecordsForMessages({
        stores,
        sessionId,
        messageIds,
        now,
        reason,
        save,
      })
    },
    deleteSession: async sessionId => {
      for (const name of stores.keys()) {
        for (const [id, record] of getStore(name).entries()) {
          if (record.sessionId === sessionId) getStore(name).delete(id)
        }
      }
    },
  }
}

let browserMemoryStorage: ConversationContextStorage | null = null

export function createConversationContextMemoryStorageSingleton(): ConversationContextStorage {
  if (!browserMemoryStorage) browserMemoryStorage = createConversationContextMemoryStorage()
  return browserMemoryStorage
}

export function createConversationContextStorage(): ConversationContextStorage {
  const fallback = createConversationContextMemoryStorageSingleton()
  return {
    saveRuntimeSegment: record => setConversationContextRecord('runtime_segments', record).catch(() => fallback.saveRuntimeSegment(record)),
    listRuntimeSegments: async sessionId => (await listOrFallback<RuntimeSegmentRecord>('runtime_segments', 'sessionId', sessionId, fallback.listRuntimeSegments(sessionId))).sort((a, b) => a.createdAt - b.createdAt),
    saveRunSnapshot: record => setConversationContextRecord('conversation_run_snapshots', record).catch(() => fallback.saveRunSnapshot(record)),
    listRunSnapshots: async sessionId => (await listOrFallback<ConversationRunSnapshotRecord>('conversation_run_snapshots', 'sessionId', sessionId, fallback.listRunSnapshots(sessionId))).sort((a, b) => a.createdAt - b.createdAt),
    saveMessageChunks: async chunks => {
      for (const chunk of chunks) {
        await setConversationContextRecord('conversation_message_chunks', chunk).catch(() => fallback.saveMessageChunks([chunk]))
      }
    },
    listMessageChunksByMessageId: async messageId => (await listOrFallback<ConversationMessageChunk>('conversation_message_chunks', 'messageId', messageId, fallback.listMessageChunksByMessageId(messageId))).sort((a, b) => a.chunkIndex - b.chunkIndex),
    listMessageChunksBySession: async sessionId => (await listOrFallback<ConversationMessageChunk>('conversation_message_chunks', 'sessionId', sessionId, fallback.listMessageChunksBySession(sessionId))).sort((a, b) => a.createdAt - b.createdAt || a.chunkIndex - b.chunkIndex),
    saveMemoryItem: record => setConversationContextRecord('conversation_memory_items', record).catch(() => fallback.saveMemoryItem(record)),
    listMemoryItems: sessionId => listOrFallback<ConversationMemoryItemRecord>('conversation_memory_items', 'sessionId', sessionId, fallback.listMemoryItems(sessionId)),
    enqueueMemoryJob: record => setConversationContextRecord('conversation_memory_jobs', record, 'idempotencyKey').catch(() => fallback.enqueueMemoryJob(record)),
    saveMemoryJob: record => setConversationContextRecord('conversation_memory_jobs', record, 'idempotencyKey').catch(() => fallback.saveMemoryJob(record)),
    listMemoryJobsByStatus: async (status, now) => (await listOrFallback<ConversationMemoryIndexJob>('conversation_memory_jobs', 'status', status, fallback.listMemoryJobsByStatus(status, now)))
      .filter(record => record.nextRunAt <= now)
      .sort((a, b) => a.nextRunAt - b.nextRunAt),
    saveContinuation: record => setConversationContextRecord('conversation_continuations', record).catch(() => fallback.saveContinuation(record)),
    saveRebuildJob: record => setConversationContextRecord('conversation_rebuild_jobs', record).catch(() => fallback.saveRebuildJob(record)),
    saveDirtySegment: record => setConversationContextRecord('conversation_dirty_segments', record).catch(() => fallback.saveDirtySegment(record)),
    listDirtySegments: sessionId => listOrFallback<ConversationDirtySegmentRecord>('conversation_dirty_segments', 'sessionId', sessionId, fallback.listDirtySegments(sessionId)),
    invalidateMessages: async (sessionId, messageIds, now, reason) => {
      const ids = normalizeMessageIds(messageIds)
      if (!ids.length) return
      const storeNames: ConversationContextStoreName[] = [
        'conversation_message_chunks',
        'conversation_memory_items',
        'conversation_memory_jobs',
      ]
      for (const storeName of storeNames) {
        const records = await listConversationContextRecords<any>(storeName, 'sessionId', sessionId).catch(() => null)
        if (!records) continue
        for (const record of records) {
          if (!recordReferencesMessage(record, ids)) continue
          if (storeName === 'conversation_message_chunks') {
            await removeConversationContextRecord(storeName, record.id).catch(() => undefined)
          } else if (storeName === 'conversation_memory_items') {
            await setConversationContextRecord(storeName, {
              ...record,
              syncStatus: 'delete_pending',
              updatedAt: now,
              metadata: {
                ...(record.metadata || {}),
                invalidatedAt: now,
                invalidatedReason: reason,
                invalidatedMessageIds: ids,
              },
            }).catch(() => undefined)
          } else if (storeName === 'conversation_memory_jobs') {
            await setConversationContextRecord(storeName, {
              ...record,
              status: 'repair_required',
              attempts: record.attempts + 1,
              lastError: `source messages invalidated: ${ids.join(',')}`,
              updatedAt: now,
            }, 'idempotencyKey').catch(() => undefined)
          }
        }
      }
      await fallback.invalidateMessages(sessionId, ids, now, reason)
    },
    deleteSession: async sessionId => {
      const storeNames: ConversationContextStoreName[] = [
        'runtime_segments',
        'conversation_run_snapshots',
        'conversation_message_chunks',
        'conversation_memory_items',
        'conversation_memory_jobs',
        'conversation_continuations',
        'conversation_rebuild_jobs',
        'conversation_dirty_segments',
      ]
      for (const store of storeNames) {
        const records = await listConversationContextRecords<any>(store, 'sessionId', sessionId).catch(() => [])
        for (const record of records) await removeConversationContextRecord(store, record.id).catch(() => undefined)
      }
      await fallback.deleteSession(sessionId)
    },
  }
}

function normalizeMessageIds(messageIds: string[]): string[] {
  return [...new Set(messageIds.map(id => String(id || '').trim()).filter(Boolean))]
}

function recordReferencesMessage(record: any, messageIds: string[]): boolean {
  const ids = new Set(messageIds)
  if (ids.has(String(record.messageId || ''))) return true
  if (ids.has(String(record.parentMessageId || ''))) return true
  if (Array.isArray(record.sourceMessageIds)) {
    return record.sourceMessageIds.some((id: string) => ids.has(String(id || '')))
  }
  return false
}

function invalidateRecordsForMessages(input: {
  stores: Map<ConversationContextStoreName, Map<string, any>>
  sessionId: string
  messageIds: string[]
  now: number
  reason: ConversationDirtySegmentRecord['reason']
  save: (name: ConversationContextStoreName, record: any) => Promise<void>
}) {
  const ids = normalizeMessageIds(input.messageIds)
  if (!ids.length) return
  const chunks = input.stores.get('conversation_message_chunks')
  for (const [id, record] of Array.from(chunks?.entries() || [])) {
    if (record.sessionId === input.sessionId && recordReferencesMessage(record, ids)) chunks?.delete(id)
  }
  const touchedSegments = new Set<string>()
  const memoryItems = input.stores.get('conversation_memory_items')
  for (const [id, record] of Array.from(memoryItems?.entries() || [])) {
    if (record.sessionId !== input.sessionId || !recordReferencesMessage(record, ids)) continue
    touchedSegments.add(record.runtimeSegmentId)
    memoryItems?.set(id, {
      ...record,
      syncStatus: 'delete_pending',
      updatedAt: input.now,
      metadata: {
        ...(record.metadata || {}),
        invalidatedAt: input.now,
        invalidatedReason: input.reason,
        invalidatedMessageIds: ids,
      },
    })
  }
  const jobs = input.stores.get('conversation_memory_jobs')
  for (const [id, record] of Array.from(jobs?.entries() || [])) {
    if (record.sessionId !== input.sessionId || !recordReferencesMessage(record, ids)) continue
    touchedSegments.add(record.runtimeSegmentId)
    jobs?.set(id, {
      ...record,
      status: 'repair_required',
      attempts: record.attempts + 1,
      lastError: `source messages invalidated: ${ids.join(',')}`,
      updatedAt: input.now,
    })
  }
  for (const runtimeSegmentId of touchedSegments) {
    void input.save('conversation_dirty_segments', {
      id: `dirty_${input.sessionId}_${runtimeSegmentId}_${input.reason}_${input.now}`,
      sessionId: input.sessionId,
      runtimeSegmentId,
      reason: input.reason,
      severity: 'high',
      estimatedTokenImpact: 0,
      dirtySince: input.now,
      priority: 80,
      status: 'pending',
      metadata: {
        invalidatedMessageIds: ids,
      },
    } satisfies ConversationDirtySegmentRecord)
  }
}

async function listOrFallback<T>(
  storeName: ConversationContextStoreName,
  indexName: string,
  key: string,
  fallbackPromise: Promise<T[]>,
): Promise<T[]> {
  const records = await listConversationContextRecords<T>(storeName, indexName, key).catch(() => null)
  if (records && records.length > 0) return records
  return fallbackPromise
}
