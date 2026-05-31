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
