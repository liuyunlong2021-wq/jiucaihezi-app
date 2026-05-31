import type { ConversationContextStorage } from './storage'

export interface RebuildConversationMemoryIndexInput {
  storage: ConversationContextStorage
  sessionId: string
  runtimeSegmentId?: string
  dirtyOnly?: boolean
  priority: 'active' | 'recent' | 'manual' | 'maintenance'
  now: number
}

export interface RebuildConversationMemoryIndexResult {
  createdJobs: number
}

const PRIORITY_WEIGHT = {
  active: 100,
  manual: 80,
  recent: 60,
  maintenance: 10,
}

export async function rebuildConversationMemoryIndex(
  input: RebuildConversationMemoryIndexInput,
): Promise<RebuildConversationMemoryIndexResult> {
  const dirtySegments = input.dirtyOnly !== false
    ? await input.storage.listDirtySegments(input.sessionId)
    : []
  const segmentIds = input.runtimeSegmentId
    ? [input.runtimeSegmentId]
    : dirtySegments.map(segment => segment.runtimeSegmentId)
  let createdJobs = 0
  for (const runtimeSegmentId of [...new Set(segmentIds)]) {
    const chunks = (await input.storage.listMessageChunksBySession(input.sessionId))
      .filter(chunk => !input.runtimeSegmentId || chunk.metadata?.runtimeSegmentId === runtimeSegmentId)
    const messageIds = [...new Set(chunks
      .filter(chunk => chunk.metadata?.runtimeSegmentId === runtimeSegmentId || input.runtimeSegmentId === runtimeSegmentId)
      .map(chunk => chunk.messageId))]
    if (messageIds.length) {
      const idempotencyKey = [
        input.sessionId,
        runtimeSegmentId,
        'rebuild',
        messageIds.join(','),
      ].join(':')
      await input.storage.enqueueMemoryJob({
        id: `job_rebuild_${Math.abs(hashString(idempotencyKey))}`,
        sessionId: input.sessionId,
        runtimeSegmentId,
        runId: `rebuild_${runtimeSegmentId}_${input.now}`,
        sourceMessageIds: messageIds,
        status: 'pending',
        attempts: 0,
        nextRunAt: input.now,
        idempotencyKey,
        createdAt: input.now,
        updatedAt: input.now,
      })
    }
    await input.storage.saveRebuildJob({
      id: `rebuild_${input.sessionId}_${runtimeSegmentId}`,
      sessionId: input.sessionId,
      runtimeSegmentId,
      status: 'pending',
      priority: PRIORITY_WEIGHT[input.priority],
      processedChunks: 0,
      totalChunks: 0,
      attempts: 0,
      createdAt: input.now,
      updatedAt: input.now,
    })
    createdJobs += 1
  }
  return { createdJobs }
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i)
    hash |= 0
  }
  return hash
}
