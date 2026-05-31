export interface MemoryProvenanceLike {
  sessionId?: string
  runtimeSegmentId?: string
  sourceMessageIds?: string[]
}

export function hasValidMemoryProvenance(input: MemoryProvenanceLike): boolean {
  return Boolean(
    String(input.sessionId || '').trim()
    && String(input.runtimeSegmentId || '').trim()
    && Array.isArray(input.sourceMessageIds)
    && input.sourceMessageIds.length > 0
    && input.sourceMessageIds.every(id => String(id || '').trim()),
  )
}

export function buildMemoryIdempotencyKey(
  sessionId: string,
  runtimeSegmentId: string,
  runId: string,
  sourceMessageIds: string[],
): string {
  return [sessionId, runtimeSegmentId, runId, [...sourceMessageIds].join(',')].join(':')
}
