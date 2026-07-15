import type { FileEntry } from '@/composables/useFileStore'
import {
  createWebProjectFiles,
  WebProjectCollisionCancelledError,
  type WebProjectCollisionDecision,
} from './webProjectFiles'

type BinaryCategory = Extract<FileEntry['category'], 'image' | 'video' | 'audio' | 'binary'>

export interface WebProjectTransferEntry {
  path: string
  kind: 'text' | 'binary'
  category: FileEntry['category']
  mimeType: string
  blob: Blob
}

export type { WebProjectCollisionDecision } from './webProjectFiles'

export interface WebProjectCollisionRequest {
  projectId: string
  path: string
  entry: WebProjectTransferEntry
}

export interface WriteWebProjectEntriesOptions {
  resolveCollision?: (request: WebProjectCollisionRequest) => Promise<WebProjectCollisionDecision>
}

export interface WriteWebProjectEntriesResult {
  importedPaths: string[]
  skippedPaths: string[]
}

export interface ImportWebProjectResult extends WriteWebProjectEntriesResult {
  project: FileEntry
}

type WebProjectFiles = ReturnType<typeof createWebProjectFiles>

function normalizePath(input: string): string {
  const raw = String(input || '').replace(/\\/g, '/')
  if (raw.startsWith('/') || raw.includes('\0')) throw new Error('项目路径无效')
  const parts = raw.split('/').filter(part => part && part !== '.')
  if (!parts.length || parts.some(part => part === '..')) throw new Error('项目路径无效')
  return parts.join('/')
}

function binaryCategory(category: FileEntry['category'], mimeType: string): BinaryCategory {
  if (category === 'image' || category === 'video' || category === 'audio' || category === 'binary') return category
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'binary'
}

function entryPath(entry: FileEntry): string {
  return String(entry.metadata?.relativePath || '')
}

export async function exportWebProject(
  files: WebProjectFiles,
  projectId: string,
): Promise<WebProjectTransferEntry[]> {
  const entries: WebProjectTransferEntry[] = []
  for (const item of await files.list(projectId)) {
    if (item.isDir) continue
    const entry = await files.read(projectId, item.path)
    const binary = entry.metadata?.binaryStorage === 'opfs'
    entries.push({
      path: item.path,
      kind: binary ? 'binary' : 'text',
      category: entry.category,
      mimeType: entry.mimeType || (binary ? 'application/octet-stream' : 'text/plain'),
      blob: binary
        ? await files.readBinary(projectId, item.path)
        : new Blob([entry.content], { type: entry.mimeType || 'text/plain' }),
    })
  }
  return entries
}

export async function writeWebProjectEntries(
  files: WebProjectFiles,
  projectId: string,
  entries: WebProjectTransferEntry[],
  options: WriteWebProjectEntriesOptions = {},
): Promise<WriteWebProjectEntriesResult> {
  const importedPaths: string[] = []
  const skippedPaths: string[] = []

  for (const sourceEntry of entries) {
    const path = normalizePath(sourceEntry.path)
    const entry = { ...sourceEntry, path }
    const onCollision = options.resolveCollision
      ? async (collisionPath: string) => await options.resolveCollision!({ projectId, path: collisionPath, entry })
      : undefined
    try {
      const written = entry.kind === 'binary'
        ? await files.writeBinary(projectId, path, entry.blob, {
          category: binaryCategory(entry.category, entry.mimeType),
          mimeType: entry.mimeType || 'application/octet-stream',
          onCollision,
        })
        : await files.write(projectId, path, await entry.blob.text(), { onCollision })
      importedPaths.push(entryPath(written))
    } catch (error) {
      if (error instanceof WebProjectCollisionCancelledError) {
        skippedPaths.push(path)
        continue
      }
      throw error
    }
  }

  return { importedPaths, skippedPaths }
}

export async function importWebProject(
  files: WebProjectFiles,
  folderName: string,
  entries: WebProjectTransferEntry[],
  options: WriteWebProjectEntriesOptions = {},
): Promise<ImportWebProjectResult> {
  const root = normalizePath(folderName)
  if (root.includes('/')) throw new Error('项目文件夹名称无效')
  const prefix = `${root}/`
  const projectEntries = entries.map(entry => {
    const sourcePath = normalizePath(entry.path)
    if (!sourcePath.startsWith(prefix)) throw new Error(`导入文件不在所选项目目录中: ${sourcePath}`)
    return { ...entry, path: sourcePath.slice(prefix.length) }
  })
  const project = await files.createProject(root)
  return { project, ...await writeWebProjectEntries(files, project.id, projectEntries, options) }
}
