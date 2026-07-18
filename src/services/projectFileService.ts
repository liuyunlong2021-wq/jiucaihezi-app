import {
  classifyProjectResource,
  renamedProjectResource,
  type ProjectResource,
  type ProjectRuntime,
  type ProjectResourceRevision,
  type ProjectTextRead,
} from '@/utils/projectResource'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { webProjectFiles, webProjectTextRevision } from '@/utils/webProjectFiles'

export interface ProjectFileEntry {
  id?: string
  path: string
  isDirectory: boolean
  /** Desktop Rust serializes `is_dir` as `isDir`. */
  isDir?: boolean
  size?: number
  updatedAt?: number
  mimeType?: string
  content?: string
}

export interface ProjectFileAdapter {
  runtime: ProjectRuntime
  list(owner: string): Promise<ProjectFileEntry[]>
  /** Directory mutation snapshots must not inherit the tree view's pagination limit. */
  listDescendants?(owner: string, path: string): Promise<ProjectFileEntry[]>
  readText(owner: string, path: string): Promise<ProjectTextRead>
  writeText?(
    owner: string,
    path: string,
    content: string,
    expectedRevision: ProjectResourceRevision,
  ): Promise<ProjectFileWriteResult>
  createText(owner: string, path: string, content: string): Promise<ProjectFileEntry>
  createFolder?(owner: string, path: string): Promise<ProjectFileEntry>
  rename(owner: string, oldPath: string, newPath: string): Promise<ProjectFileEntry>
  remove(owner: string, path: string): Promise<void>
}

export type ProjectFileWriteResult =
  | { status: 'saved'; revision: ProjectResourceRevision }
  | { status: 'conflict'; current: ProjectTextRead }
  | { status: 'missing' }

export type ProjectResourceChangeEntry =
  | { type: 'created'; resource: ProjectResource; transactionId: string; operationId: string; source: 'local' | 'external' }
  | { type: 'changed'; resource: ProjectResource; transactionId: string; operationId: string; source: 'local' | 'external'; revision: ProjectResourceRevision }
  | { type: 'renamed'; oldResource: ProjectResource; resource: ProjectResource; transactionId: string; operationId: string; source: 'local' | 'external' }
  | { type: 'deleted'; resource: ProjectResource; transactionId: string; operationId: string; source: 'local' | 'external' }

export type ProjectResourceChange = ProjectResourceChangeEntry
  | { type: 'batch'; changes: ProjectResourceChangeEntry[]; transactionId: string; operationId: string; source: 'local' | 'external' }

export function flattenProjectResourceChange(change: ProjectResourceChange): ProjectResourceChangeEntry[] {
  return change.type === 'batch' ? change.changes : [change]
}

export interface ProjectFileService {
  list(owner: string): Promise<ProjectResource[]>
  readText(resource: ProjectResource): Promise<ProjectTextRead>
  writeText(resource: ProjectResource, content: string, expectedRevision: ProjectResourceRevision): Promise<ProjectFileWriteResult>
  createText(owner: string, path: string, content: string): Promise<ProjectResource>
  createFolder(owner: string, path: string): Promise<ProjectResource>
  rename(resource: ProjectResource, newName: string): Promise<ProjectResource>
  remove(resource: ProjectResource): Promise<void>
  onDidChange(listener: (change: ProjectResourceChange) => void): () => void
}

const changeListeners = new Set<(change: ProjectResourceChange) => void>()
const ownerMutationQueues = new Map<string, Promise<void>>()

export function emitProjectResourceChange(change: ProjectResourceChange) {
  changeListeners.forEach(listener => listener(change))
}

export function onProjectResourceChange(listener: (change: ProjectResourceChange) => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

function normalizePath(path: string): string {
  const normalized = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0') || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('项目路径无效')
  }
  return normalized
}

function resourceFromEntry(runtime: ProjectRuntime, owner: string, entry: ProjectFileEntry): ProjectResource {
  const path = normalizePath(entry.path)
  const isDirectory = entry.isDirectory ?? entry.isDir ?? false
  return {
    runtime,
    owner,
    path,
    id: entry.id,
    name: path.split('/').pop() || path,
    isDirectory,
    mimeType: entry.mimeType,
    size: entry.size,
    updatedAt: entry.updatedAt,
    kind: isDirectory ? 'binary' : classifyProjectResource({ path, mimeType: entry.mimeType }),
  }
}

function transactionId(): string {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function affectedResources(adapter: ProjectFileAdapter, resource: ProjectResource): Promise<ProjectResource[]> {
  if (!resource.isDirectory) return [resource]
  const entries = adapter.listDescendants
    ? await adapter.listDescendants(resource.owner, resource.path)
    : await adapter.list(resource.owner)
  const descendants = entries
    .map(entry => resourceFromEntry(adapter.runtime, resource.owner, entry))
    .filter(item => item.path.startsWith(`${resource.path}/`))
  return [resource, ...descendants]
}

function emitCompletedChanges(changes: ProjectResourceChangeEntry[], transactionId: string) {
  if (changes.length === 1) emitProjectResourceChange(changes[0])
  else emitProjectResourceChange({ type: 'batch', changes, transactionId, operationId: transactionId, source: 'local' })
}

export function createProjectFileService(adapter: ProjectFileAdapter): ProjectFileService {
  function mutate<T>(owner: string, action: () => Promise<T>): Promise<T> {
    const key = `${adapter.runtime}:${owner}`
    const previous = (ownerMutationQueues.get(key) || Promise.resolve()).catch(() => undefined)
    const current = previous.then(action)
    const tracked = current.then(() => undefined, () => undefined).finally(() => {
      if (ownerMutationQueues.get(key) === tracked) ownerMutationQueues.delete(key)
    })
    ownerMutationQueues.set(key, tracked)
    return current
  }
  return {
    async list(owner) {
      return (await adapter.list(owner)).map(entry => resourceFromEntry(adapter.runtime, owner, entry))
    },
    async readText(resource) {
      return adapter.readText(resource.owner, resource.path)
    },
    async writeText(resource, content, expectedRevision) {
      return await mutate(resource.owner, async () => {
        if (!adapter.writeText) throw new Error('当前运行时不支持条件文本保存')
        const result = await adapter.writeText(resource.owner, resource.path, content, expectedRevision)
        if (result.status === 'saved') {
          const id = transactionId()
          emitProjectResourceChange({ type: 'changed', resource, transactionId: id, operationId: id, source: 'local', revision: result.revision })
        }
        return result
      })
    },
    async createText(owner, path, content) {
      return await mutate(owner, async () => {
        const resource = resourceFromEntry(adapter.runtime, owner, await adapter.createText(owner, normalizePath(path), content))
        const id = transactionId()
        emitProjectResourceChange({ type: 'created', resource, transactionId: id, operationId: id, source: 'local' })
        return resource
      })
    },
    async createFolder(owner, path) {
      return await mutate(owner, async () => {
        if (!adapter.createFolder) throw new Error('当前运行时不支持创建文件夹')
        const resource = resourceFromEntry(adapter.runtime, owner, await adapter.createFolder(owner, normalizePath(path)))
        const id = transactionId()
        emitProjectResourceChange({ type: 'created', resource, transactionId: id, operationId: id, source: 'local' })
        return resource
      })
    },
    async rename(resource, newName) {
      return await mutate(resource.owner, async () => {
        const cleanName = String(newName || '').trim()
        if (!cleanName || /[\\/]/.test(cleanName) || cleanName === '.' || cleanName === '..') throw new Error('新名称无效')
        const parent = resource.path.split('/').slice(0, -1).join('/')
        const path = parent ? `${parent}/${cleanName}` : cleanName
        const affected = await affectedResources(adapter, resource)
        await adapter.rename(resource.owner, resource.path, path)
        const next = renamedProjectResource(resource, path)
        const id = transactionId()
        emitCompletedChanges(affected.map(oldResource => ({
          type: 'renamed' as const,
          oldResource,
          resource: renamedProjectResource(oldResource, `${path}${oldResource.path.slice(resource.path.length)}`),
          transactionId: id,
          operationId: id,
          source: 'local' as const,
        })), id)
        return next
      })
    },
    async remove(resource) {
      await mutate(resource.owner, async () => {
        const affected = await affectedResources(adapter, resource)
        await adapter.remove(resource.owner, resource.path)
        const id = transactionId()
        emitCompletedChanges(affected.map(item => ({ type: 'deleted' as const, resource: item, transactionId: id, operationId: id, source: 'local' as const })), id)
      })
    },
    onDidChange(listener) {
      return onProjectResourceChange(listener)
    },
  }
}

export function createRuntimeProjectFileService(): ProjectFileService {
  if (!isTauriRuntime()) {
    return createProjectFileService({
      runtime: 'web',
      async list(owner) { return webProjectFiles.list(owner).then(entries => entries.map(entry => ({ ...entry, isDirectory: entry.isDir }))) },
      async listDescendants(owner, path) {
        return (await webProjectFiles.list(owner))
          .filter(entry => entry.path.startsWith(`${path}/`))
          .map(entry => ({ ...entry, isDirectory: entry.isDir }))
      },
      async readText(owner, path) {
        const entry = await webProjectFiles.read(owner, path)
        return {
          content: entry.content,
          size: entry.size,
          truncated: false,
          revision: { value: webProjectTextRevision(entry), size: entry.size, updatedAt: entry.updatedAt },
        }
      },
      async writeText(owner, path, content, expectedRevision) {
        const result = await webProjectFiles.writeIfRevision(owner, path, content, expectedRevision.value)
        if (result.status === 'missing') return result
        const revision = { value: result.revision, size: result.entry.size, updatedAt: result.entry.updatedAt }
        if (result.status === 'conflict') {
          return { status: 'conflict' as const, current: { content: result.entry.content, size: result.entry.size, truncated: false, revision } }
        }
        return { status: 'saved' as const, revision }
      },
      async createText(owner, path, content) {
        const entry = await webProjectFiles.createText(owner, path, content)
        return { ...entry, path, isDirectory: false }
      },
      async createFolder(owner, path) {
        const entry = await webProjectFiles.createFolder(owner, path)
        return { ...entry, path, isDirectory: true }
      },
      async rename(owner, oldPath, newPath) {
        const entry = await webProjectFiles.rename(owner, oldPath, newPath.split('/').pop() || newPath)
        return { ...entry, path: newPath, isDirectory: false }
      },
      async remove(owner, path) { await webProjectFiles.remove(owner, path) },
    })
  }

  return createProjectFileService({
    runtime: 'desktop',
    async list(owner) {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke<ProjectFileEntry[]>('dev_list_files', { input: { root: owner, maxEntries: 1000 } })
    },
    async listDescendants(owner, path) {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke<ProjectFileEntry[]>('dev_list_file_descendants', { input: { root: owner, relativePath: path } })
    },
      async readText(owner, path) {
        const { invoke } = await import('@tauri-apps/api/core')
        const result = await invoke<ProjectTextRead>('dev_read_file', { input: { root: owner, relativePath: path, maxBytes: 500_000 } })
        return result
      },
      async writeText(owner, path, content, expectedRevision) {
        const { invoke } = await import('@tauri-apps/api/core')
        const result = await invoke<{ status: 'saved' | 'conflict' | 'missing'; revision?: ProjectResourceRevision }>('dev_write_file_if_revision', {
          input: { root: owner, relativePath: path, content, expectedRevision: expectedRevision.value },
        })
        if (result.status === 'saved' && result.revision) return { status: 'saved', revision: result.revision }
        if (result.status === 'missing') return { status: 'missing' }
        return { status: 'conflict', current: await this.readText(owner, path) }
      },
      async createText(owner, path, content) {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('dev_create_file_if_missing', { input: { root: owner, relativePath: path, content } })
      return { path, isDirectory: false, content, size: new TextEncoder().encode(content).length }
    },
    async createFolder(owner, path) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('dev_create_dir', { input: { root: owner, relativePath: path, content: '' } })
      return { path, isDirectory: true }
    },
    async rename(owner, oldPath, newPath) {
      const { invoke } = await import('@tauri-apps/api/core')
      const path = await invoke<string>('dev_rename_file', { input: { root: owner, oldRelativePath: oldPath, newRelativePath: newPath } })
      return { path, isDirectory: false }
    },
    async remove(owner, path) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('dev_delete_file', { input: { root: owner, relativePath: path } })
    },
  })
}

export { resourceFromEntry as projectResourceFromEntry, renamedProjectResource }
