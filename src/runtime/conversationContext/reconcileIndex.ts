import { hasValidMemoryProvenance } from './provenance'
import type { ConversationContextStorage } from './storage'

export interface ReconcileConversationMemoryIndexInput {
  storage: ConversationContextStorage
  sessionId: string
  now: number
}

export interface ReconcileConversationMemoryIndexResult {
  dirtySegments: number
}

export async function reconcileConversationMemoryIndex(
  input: ReconcileConversationMemoryIndexInput,
): Promise<ReconcileConversationMemoryIndexResult> {
  const items = await input.storage.listMemoryItems(input.sessionId)
  const dirtySegmentIds = new Set<string>()
  for (const item of items) {
    if (!hasValidMemoryProvenance(item)) dirtySegmentIds.add(item.runtimeSegmentId)
  }
  for (const runtimeSegmentId of dirtySegmentIds) {
    await input.storage.saveDirtySegment({
      id: `dirty_${input.sessionId}_${runtimeSegmentId}_missing_provenance`,
      sessionId: input.sessionId,
      runtimeSegmentId,
      reason: 'external_index_drift',
      severity: 'high',
      estimatedTokenImpact: 0,
      dirtySince: input.now,
      priority: 80,
      status: 'pending',
      metadata: { source: 'reconcile' },
    })
  }
  return { dirtySegments: dirtySegmentIds.size }
}
