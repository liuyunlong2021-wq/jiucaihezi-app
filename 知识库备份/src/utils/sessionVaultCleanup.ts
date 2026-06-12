export interface RemoveVaultBindingsInput {
  vaultId: string
  now: number
  conversations: any[]
  documents: any[]
}

export interface RemoveVaultBindingsResult {
  conversationsToUpdate: any[]
  documentsToUpdate: any[]
}

function withoutVaultId(metadata: Record<string, any>): Record<string, any> {
  const next = { ...metadata }
  delete next.vaultId
  return next
}

export function removeVaultBindingsFromSessions(input: RemoveVaultBindingsInput): RemoveVaultBindingsResult {
  const vaultId = String(input.vaultId || '')
  if (!vaultId) return { conversationsToUpdate: [], documentsToUpdate: [] }

  const conversationsToUpdate = (input.conversations || [])
    .filter(record => record?.id && String(record.vaultId || '') === vaultId)
    .map(record => ({
      ...record,
      vaultId: null,
      contextPolicy: 'no-memory',
      updatedAt: input.now,
    }))

  const documentsToUpdate = (input.documents || [])
    .filter(doc => doc?.id && doc?.metadata?.kind === 'chat-image' && String(doc.vaultId || doc.metadata?.vaultId || '') === vaultId)
    .map(doc => {
      const next = {
        ...doc,
        updatedAt: input.now,
        metadata: withoutVaultId(doc.metadata || {}),
      }
      delete next.vaultId
      return next
    })

  return { conversationsToUpdate, documentsToUpdate }
}
