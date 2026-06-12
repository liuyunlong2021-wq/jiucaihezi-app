import type { FileEntry } from '@/composables/useFileStore'

export interface LegacyConversationRef {
  id: string
  vaultId?: string | null
}

export interface LegacyKnowledgeUpdate {
  id: string
  patch: Partial<FileEntry>
}

export interface LegacyMigrationPlan {
  updates: LegacyKnowledgeUpdate[]
}

function getSessionId(file: Partial<FileEntry>): string {
  return String(file.metadata?.sessionId || file.metadata?.originalId || file.sourceSessionId || '')
}

function mergeMetadata(file: Partial<FileEntry>, bucket: string): Record<string, unknown> {
  return {
    ...(file.metadata || {}),
    migrationBucket: bucket,
    migratedAt: Date.now(),
    legacySkillId: file.skillId || null,
  }
}

export function planLegacyKnowledgeMigration(
  files: Array<Partial<FileEntry> & { id: string }>,
  conversations: LegacyConversationRef[],
): LegacyMigrationPlan {
  const sessionVaults = new Map(conversations.map(c => [c.id, c.vaultId || null]))
  const updates: LegacyKnowledgeUpdate[] = []

  for (const file of files) {
    if (file.category !== 'knowledge' || file.vaultId) continue

    const sessionId = getSessionId(file)
    const sessionVaultId = sessionId ? sessionVaults.get(sessionId) : null
    if (sessionVaultId) {
      updates.push({
        id: file.id,
        patch: {
          vaultId: sessionVaultId,
          kind: file.kind || 'raw',
          sourceSessionId: file.sourceSessionId || sessionId,
          metadata: mergeMetadata(file, 'session-vault'),
        },
      })
      continue
    }

    if (file.skillId === 'general') {
      updates.push({
        id: file.id,
        patch: {
          kind: file.kind || 'raw',
          metadata: mergeMetadata(file, 'global-legacy'),
        },
      })
      continue
    }

    if (file.skillId) {
      updates.push({
        id: file.id,
        patch: {
          kind: file.kind || 'raw',
          metadata: mergeMetadata(file, 'skill-legacy'),
        },
      })
      continue
    }

    updates.push({
      id: file.id,
      patch: {
        kind: file.kind || 'raw',
        metadata: mergeMetadata(file, 'uncategorized-legacy'),
      },
    })
  }

  return { updates }
}
