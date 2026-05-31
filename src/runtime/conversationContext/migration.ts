import type { ConversationContextStorage } from './storage'
import type { RuntimeSegmentRecord } from './types'

export interface EnsureMigrationBaselineSegmentInput {
  storage: ConversationContextStorage
  sessionId: string
  skillId?: string
  primaryVaultId?: string | null
  createdAt: number
  now: number
}

export async function ensureMigrationBaselineSegment(
  input: EnsureMigrationBaselineSegmentInput,
): Promise<RuntimeSegmentRecord> {
  const existing = (await input.storage.listRuntimeSegments(input.sessionId))
    .find(segment => segment.trigger === 'migration_baseline')
  if (existing) return existing
  const segment: RuntimeSegmentRecord = {
    id: `seg_${input.sessionId}_migration`,
    sessionId: input.sessionId,
    trigger: 'migration_baseline',
    label: '历史会话导入',
    skillId: input.skillId,
    primaryVaultId: input.primaryVaultId,
    createdAt: input.createdAt || input.now,
    metadata: { migratedAt: input.now },
  }
  await input.storage.saveRuntimeSegment(segment)
  return segment
}
