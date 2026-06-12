export type VaultRootFolderType = 'raw' | 'wiki' | 'reports' | 'templates'

export function normalizeVaultLookupPath(path: string): string {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')
}

export function vaultRootFolderTypeForPath(path: string): VaultRootFolderType | null {
  const root = normalizeVaultLookupPath(path).split('/').filter(Boolean)[0]
  if (root === 'raw' || root === 'wiki') return root
  if (root === '_reports' || root === 'reports') return 'reports'
  if (root === '_templates' || root === 'templates') return 'templates'
  return null
}
