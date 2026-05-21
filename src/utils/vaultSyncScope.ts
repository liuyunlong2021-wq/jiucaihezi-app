export interface VaultSyncEntryLike {
  vaultId?: string
  category?: string
}

export function shouldSyncVaultEntryToDisk(entry: VaultSyncEntryLike, scopedVaultIds: Set<string>): boolean {
  if (!entry.vaultId || entry.category !== 'knowledge') return false
  return scopedVaultIds.size === 0 || scopedVaultIds.has(entry.vaultId)
}
