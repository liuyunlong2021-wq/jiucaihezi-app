export interface FileTreeLikeEntry {
  id: string
  mimeType: string
  folderId?: string
  metadata?: Record<string, unknown>
}

export function countFolderFiles(folder: FileTreeLikeEntry, entries: FileTreeLikeEntry[]): number {
  const byParent = new Map<string, FileTreeLikeEntry[]>()
  for (const entry of entries) {
    if (!entry.folderId) continue
    const list = byParent.get(entry.folderId) || []
    list.push(entry)
    byParent.set(entry.folderId, list)
  }

  let count = 0
  const stack = [folder.id]
  while (stack.length) {
    const parentId = stack.pop()!
    for (const child of byParent.get(parentId) || []) {
      if (child.mimeType === 'folder') stack.push(child.id)
      else count++
    }
  }
  return count
}
