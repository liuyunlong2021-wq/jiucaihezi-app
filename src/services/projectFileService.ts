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
import { copyCanvasDocument, parseCanvasDocument } from '@/components/canvas/canvasDocument'

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

export interface ProjectBinaryRead {
  data: Uint8Array
  size: number
  mimeType?: string
}

export interface ImportProjectBinaryInput {
  owner: string
  path: string
  data: Uint8Array
  mimeType: string
}

export interface ImportProjectExternalFilesInput {
  owner: string
  paths: string[]
  targetPath: string
}

export interface ProjectFileAdapter {
  runtime: ProjectRuntime
  list(owner: string): Promise<ProjectFileEntry[]>
  listDirectory?(owner: string, path: string): Promise<ProjectFileEntry[]>
  searchPaths?(owner: string, query: string, limit: number): Promise<ProjectFileEntry[]>
  /** Directory mutation snapshots must not inherit the tree view's pagination limit. */
  listDescendants?(owner: string, path: string): Promise<ProjectFileEntry[]>
  readText(owner: string, path: string, maxBytes?: number): Promise<ProjectTextRead>
  writeText?(
    owner: string,
    path: string,
    content: string,
    expectedRevision: ProjectResourceRevision,
  ): Promise<ProjectFileWriteResult>
  readBinary?(owner: string, path: string): Promise<ProjectBinaryRead>
  importBinary?(
    owner: string,
    path: string,
    data: Uint8Array,
    mimeType: string,
  ): Promise<ProjectFileEntry>
  importExternalFiles?(
    owner: string,
    paths: string[],
    targetPath: string,
  ): Promise<ProjectFileEntry[]>
  createText(owner: string, path: string, content: string): Promise<ProjectFileEntry>
  createFolder?(owner: string, path: string): Promise<ProjectFileEntry>
  rename(owner: string, oldPath: string, newPath: string): Promise<ProjectFileEntry>
  remove(owner: string, path: string): Promise<void>
  executeBatch?(
    owner: string,
    request: ProjectBatchAdapterRequest,
  ): Promise<ProjectBatchAdapterResult>
}

export type ProjectBatchKind = 'copy' | 'move' | 'delete'
export type ProjectCollisionPolicy = 'keep-both' | 'overwrite'

export interface ProjectBatchRequest {
  kind: ProjectBatchKind
  resources: ProjectResource[]
  targetDirectory?: ProjectResource
}

export interface ProjectBatchConflict {
  source: ProjectResource
  targetPath: string
  target?: ProjectResource
}

export interface ProjectBatchPlan {
  id: string
  kind: ProjectBatchKind
  owner: string
  runtime: ProjectRuntime
  roots: ProjectResource[]
  targetDirectory?: ProjectResource
  conflicts: ProjectBatchConflict[]
}

export interface ProjectBatchAdapterRequest {
  kind: ProjectBatchKind
  roots: ProjectResource[]
  targetDirectory?: ProjectResource
  policy?: ProjectCollisionPolicy
}

export interface ProjectBatchAdapterResult {
  created: ProjectFileEntry[]
  renamed: Array<{ oldPath: string; entry: ProjectFileEntry }>
  deleted: ProjectFileEntry[]
  failures: Array<{ path: string; message: string }>
}

export interface ProjectBatchResult {
  planId: string
  change: ProjectResourceChange | null
  failures: Array<{ resource: ProjectResource; message: string }>
}

export type ProjectFileWriteResult =
  | { status: 'saved'; revision: ProjectResourceRevision }
  | { status: 'conflict'; current: ProjectTextRead }
  | { status: 'missing' }

export type ProjectResourceChangeEntry =
  | {
      type: 'created'
      resource: ProjectResource
      transactionId: string
      operationId: string
      source: 'local' | 'external'
    }
  | {
      type: 'changed'
      resource: ProjectResource
      transactionId: string
      operationId: string
      source: 'local' | 'external'
      revision: ProjectResourceRevision
    }
  | {
      type: 'renamed'
      oldResource: ProjectResource
      resource: ProjectResource
      transactionId: string
      operationId: string
      source: 'local' | 'external'
    }
  | {
      type: 'deleted'
      resource: ProjectResource
      transactionId: string
      operationId: string
      source: 'local' | 'external'
    }

export type ProjectResourceChange =
  | ProjectResourceChangeEntry
  | {
      type: 'batch'
      changes: ProjectResourceChangeEntry[]
      transactionId: string
      operationId: string
      source: 'local' | 'external'
    }

export function flattenProjectResourceChange(
  change: ProjectResourceChange,
): ProjectResourceChangeEntry[] {
  return change.type === 'batch' ? change.changes : [change]
}

export interface ProjectFileService {
  list(owner: string): Promise<ProjectResource[]>
  listDirectory(owner: string, path: string): Promise<ProjectResource[]>
  searchPaths(owner: string, query: string, limit: number): Promise<ProjectResource[]>
  readText(resource: ProjectResource): Promise<ProjectTextRead>
  writeText(
    resource: ProjectResource,
    content: string,
    expectedRevision: ProjectResourceRevision,
  ): Promise<ProjectFileWriteResult>
  readBinary(resource: ProjectResource): Promise<ProjectBinaryRead>
  importBinary(input: ImportProjectBinaryInput): Promise<ProjectResource>
  importExternalFiles(input: ImportProjectExternalFilesInput): Promise<ProjectResource[]>
  createText(owner: string, path: string, content: string): Promise<ProjectResource>
  createFolder(owner: string, path: string): Promise<ProjectResource>
  rename(resource: ProjectResource, newName: string): Promise<ProjectResource>
  remove(resource: ProjectResource): Promise<void>
  planBatch(request: ProjectBatchRequest): Promise<ProjectBatchPlan>
  executeBatch(plan: ProjectBatchPlan, policy?: ProjectCollisionPolicy): Promise<ProjectBatchResult>
  onDidChange(listener: (change: ProjectResourceChange) => void): () => void
}

const changeListeners = new Set<(change: ProjectResourceChange) => void>()
const ownerMutationQueues = new Map<string, Promise<void>>()

export function emitProjectResourceChange(change: ProjectResourceChange) {
  changeListeners.forEach(listener => listener(change))
}

export function onProjectResourceChange(
  listener: (change: ProjectResourceChange) => void,
): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

function normalizePath(path: string): string {
  const normalized = String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (
    !normalized ||
    normalized.includes('\0') ||
    normalized.split('/').some(part => !part || part === '.' || part === '..')
  ) {
    throw new Error('项目路径无效')
  }
  return normalized
}

function normalizeDirectoryPath(path: string): string {
  return path === '' ? '' : normalizePath(path)
}

function isDirectChild(path: string, parent: string): boolean {
  const prefix = parent ? `${parent}/` : ''
  if (!path.startsWith(prefix)) return false
  return !path.slice(prefix.length).includes('/')
}

function resourceFromEntry(
  runtime: ProjectRuntime,
  owner: string,
  entry: ProjectFileEntry,
): ProjectResource {
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
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  )
}

function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const data = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index)
  return data
}

async function affectedResources(
  adapter: ProjectFileAdapter,
  resource: ProjectResource,
): Promise<ProjectResource[]> {
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
  else
    emitProjectResourceChange({
      type: 'batch',
      changes,
      transactionId,
      operationId: transactionId,
      source: 'local',
    })
}

function collapseBatchRoots(resources: ProjectResource[]): ProjectResource[] {
  const ordered = [...resources].sort(
    (a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path),
  )
  return ordered.filter(
    resource =>
      !ordered.some(
        parent =>
          parent !== resource && parent.isDirectory && resource.path.startsWith(`${parent.path}/`),
      ),
  )
}

async function refreshCopiedCanvasIds(
  adapter: ProjectFileAdapter,
  owner: string,
  created: ProjectFileEntry[],
): Promise<void> {
  if (!adapter.writeText) return
  for (const entry of created) {
    if (!entry.path.endsWith('.jccanvas')) continue
    const source = await adapter.readText(owner, entry.path)
    if (source.truncated) throw new Error(`画布副本过大，无法安全复制: ${entry.path}`)
    const document = copyCanvasDocument(parseCanvasDocument(source.content), transactionId())
    const result = await adapter.writeText(
      owner,
      entry.path,
      JSON.stringify(document),
      source.revision,
    )
    if (result.status !== 'saved') throw new Error(`无法安全写入画布副本: ${entry.path}`)
  }
}

function isSameRuntimeOwner(first: ProjectResource, second: ProjectResource): boolean {
  return first.runtime === second.runtime && first.owner === second.owner
}

export function createProjectFileService(adapter: ProjectFileAdapter): ProjectFileService {
  const plans = new Map<string, ProjectBatchPlan>()
  function mutate<T>(owner: string, action: () => Promise<T>): Promise<T> {
    const key = `${adapter.runtime}:${owner}`
    const previous = (ownerMutationQueues.get(key) || Promise.resolve()).catch(() => undefined)
    const current = previous.then(action)
    const tracked = current
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (ownerMutationQueues.get(key) === tracked) ownerMutationQueues.delete(key)
      })
    ownerMutationQueues.set(key, tracked)
    return current
  }
  return {
    async list(owner) {
      return (await adapter.list(owner)).map(entry =>
        resourceFromEntry(adapter.runtime, owner, entry),
      )
    },
    async listDirectory(owner, path) {
      const directoryPath = normalizeDirectoryPath(path)
      const entries = adapter.listDirectory
        ? await adapter.listDirectory(owner, directoryPath)
        : (await adapter.list(owner)).filter(entry => isDirectChild(entry.path, directoryPath))
      return entries.map(entry => resourceFromEntry(adapter.runtime, owner, entry))
    },
    async searchPaths(owner, query, limit) {
      const needle = query.toLocaleLowerCase()
      const entries = adapter.searchPaths
        ? await adapter.searchPaths(owner, query, limit)
        : (await adapter.list(owner))
            .filter(entry => entry.path.toLocaleLowerCase().includes(needle))
            .slice(0, limit)
      return entries.map(entry => resourceFromEntry(adapter.runtime, owner, entry))
    },
    async readText(resource) {
      return await adapter.readText(
        resource.owner,
        resource.path,
        resource.kind === 'canvas' ? 30_000_000 : undefined,
      )
    },
    async writeText(resource, content, expectedRevision) {
      return await mutate(resource.owner, async () => {
        if (!adapter.writeText) throw new Error('当前运行时不支持条件文本保存')
        const result = await adapter.writeText(
          resource.owner,
          resource.path,
          content,
          expectedRevision,
        )
        if (result.status === 'saved') {
          const id = transactionId()
          emitProjectResourceChange({
            type: 'changed',
            resource,
            transactionId: id,
            operationId: id,
            source: 'local',
            revision: result.revision,
          })
        }
        return result
      })
    },
    async readBinary(resource) {
      if (!adapter.readBinary) throw new Error('当前运行时不支持二进制读取')
      return await adapter.readBinary(resource.owner, resource.path)
    },
    async importBinary(input) {
      return await mutate(input.owner, async () => {
        if (!adapter.importBinary) throw new Error('当前运行时不支持二进制导入')
        const resource = resourceFromEntry(
          adapter.runtime,
          input.owner,
          await adapter.importBinary(
            input.owner,
            normalizePath(input.path),
            input.data,
            input.mimeType,
          ),
        )
        const id = transactionId()
        emitProjectResourceChange({
          type: 'created',
          resource,
          transactionId: id,
          operationId: id,
          source: 'local',
        })
        return resource
      })
    },
    async importExternalFiles(input) {
      return await mutate(input.owner, async () => {
        if (!adapter.importExternalFiles) throw new Error('当前运行时不支持外部文件导入')
        if (!input.paths.length) return []
        const targetPath = normalizeDirectoryPath(input.targetPath)
        const resources = (
          await adapter.importExternalFiles(input.owner, input.paths, targetPath)
        ).map(entry => resourceFromEntry(adapter.runtime, input.owner, entry))
        const id = transactionId()
        emitCompletedChanges(
          resources.map(resource => ({
            type: 'created' as const,
            resource,
            transactionId: id,
            operationId: id,
            source: 'local' as const,
          })),
          id,
        )
        return resources
      })
    },
    async createText(owner, path, content) {
      return await mutate(owner, async () => {
        const resource = resourceFromEntry(
          adapter.runtime,
          owner,
          await adapter.createText(owner, normalizePath(path), content),
        )
        const id = transactionId()
        emitProjectResourceChange({
          type: 'created',
          resource,
          transactionId: id,
          operationId: id,
          source: 'local',
        })
        return resource
      })
    },
    async createFolder(owner, path) {
      return await mutate(owner, async () => {
        if (!adapter.createFolder) throw new Error('当前运行时不支持创建文件夹')
        const resource = resourceFromEntry(
          adapter.runtime,
          owner,
          await adapter.createFolder(owner, normalizePath(path)),
        )
        const id = transactionId()
        emitProjectResourceChange({
          type: 'created',
          resource,
          transactionId: id,
          operationId: id,
          source: 'local',
        })
        return resource
      })
    },
    async rename(resource, newName) {
      return await mutate(resource.owner, async () => {
        const cleanName = String(newName || '').trim()
        if (!cleanName || /[\\/]/.test(cleanName) || cleanName === '.' || cleanName === '..')
          throw new Error('新名称无效')
        const parent = resource.path.split('/').slice(0, -1).join('/')
        const path = parent ? `${parent}/${cleanName}` : cleanName
        const affected = await affectedResources(adapter, resource)
        await adapter.rename(resource.owner, resource.path, path)
        const next = renamedProjectResource(resource, path)
        const id = transactionId()
        emitCompletedChanges(
          affected.map(oldResource => ({
            type: 'renamed' as const,
            oldResource,
            resource: renamedProjectResource(
              oldResource,
              `${path}${oldResource.path.slice(resource.path.length)}`,
            ),
            transactionId: id,
            operationId: id,
            source: 'local' as const,
          })),
          id,
        )
        return next
      })
    },
    async remove(resource) {
      await mutate(resource.owner, async () => {
        const affected = await affectedResources(adapter, resource)
        await adapter.remove(resource.owner, resource.path)
        const id = transactionId()
        emitCompletedChanges(
          affected.map(item => ({
            type: 'deleted' as const,
            resource: item,
            transactionId: id,
            operationId: id,
            source: 'local' as const,
          })),
          id,
        )
      })
    },
    async planBatch(request) {
      if (!request.resources.length) throw new Error('请先选择项目资源')
      const first = request.resources[0]
      if (!request.resources.every(resource => isSameRuntimeOwner(resource, first)))
        throw new Error('批量操作只能在同一项目内进行')
      if (first.runtime !== adapter.runtime) throw new Error('资源运行时不匹配')
      if (request.kind === 'delete' && request.targetDirectory)
        throw new Error('删除操作不能指定目标目录')
      if (request.kind !== 'delete' && !request.targetDirectory)
        throw new Error('复制或移动必须指定目标目录')
      if (
        request.targetDirectory &&
        (!request.targetDirectory.isDirectory ||
          !isSameRuntimeOwner(request.targetDirectory, first))
      ) {
        throw new Error('目标必须是同一项目中的文件夹')
      }

      const current = (await adapter.list(first.owner)).map(entry =>
        resourceFromEntry(adapter.runtime, first.owner, entry),
      )
      const byPath = new Map(current.map(resource => [resource.path, resource]))
      const roots = collapseBatchRoots(
        request.resources.map(
          resource =>
            byPath.get(resource.path) ||
            (() => {
              throw new Error(`资源不存在: ${resource.path}`)
            })(),
        ),
      )
      const targetDirectory =
        request.targetDirectory?.path === ''
          ? request.targetDirectory
          : request.targetDirectory
            ? byPath.get(request.targetDirectory.path)
            : undefined
      if (request.targetDirectory && (!targetDirectory || !targetDirectory.isDirectory))
        throw new Error('目标文件夹不存在')
      if (targetDirectory && request.kind === 'move') {
        for (const root of roots) {
          if (
            targetDirectory.path === root.path ||
            (root.isDirectory && targetDirectory.path.startsWith(`${root.path}/`))
          ) {
            throw new Error('不能移动到资源自身或其子目录')
          }
        }
      }

      const conflicts = targetDirectory
        ? roots
            .map(source => {
              const targetPath = targetDirectory.path
                ? `${targetDirectory.path}/${source.name}`
                : source.name
              return { source, targetPath, target: byPath.get(targetPath) }
            })
            .filter((conflict): conflict is ProjectBatchConflict & { target: ProjectResource } =>
              Boolean(conflict.target),
            )
        : []
      const plan: ProjectBatchPlan = {
        id: transactionId(),
        kind: request.kind,
        owner: first.owner,
        runtime: first.runtime,
        roots,
        targetDirectory,
        conflicts,
      }
      plans.set(plan.id, plan)
      return plan
    },
    async executeBatch(plan, policy) {
      return await mutate(plan.owner, async () => {
        const stored = plans.get(plan.id)
        if (!stored || stored !== plan) throw new Error('批量操作计划已失效')
        if (plan.runtime !== adapter.runtime) throw new Error('资源运行时不匹配')
        if (plan.conflicts.length && !policy)
          throw new Error('存在同名资源，请选择保留两份或覆盖全部')
        if (!adapter.executeBatch) throw new Error('当前运行时不支持批量文件操作')
        plans.delete(plan.id)

        const current = (await adapter.list(plan.owner)).map(entry =>
          resourceFromEntry(adapter.runtime, plan.owner, entry),
        )
        const byPath = new Map(current.map(resource => [resource.path, resource]))
        const roots = plan.roots.map(
          resource =>
            byPath.get(resource.path) ||
            (() => {
              throw new Error(`资源不存在: ${resource.path}`)
            })(),
        )
        const targetDirectory =
          plan.targetDirectory?.path === ''
            ? plan.targetDirectory
            : plan.targetDirectory
              ? byPath.get(plan.targetDirectory.path)
              : undefined
        if (plan.targetDirectory && (!targetDirectory || !targetDirectory.isDirectory))
          throw new Error('目标文件夹不存在')
        const result = await adapter.executeBatch(plan.owner, {
          kind: plan.kind,
          roots,
          targetDirectory,
          policy,
        })
        if (plan.kind === 'copy') await refreshCopiedCanvasIds(adapter, plan.owner, result.created)
        const id = transactionId()
        const changes: ProjectResourceChangeEntry[] = [
          ...result.deleted.map(entry => ({
            type: 'deleted' as const,
            resource:
              byPath.get(entry.path) || resourceFromEntry(adapter.runtime, plan.owner, entry),
            transactionId: id,
            operationId: id,
            source: 'local' as const,
          })),
          ...result.created.map(entry => ({
            type: 'created' as const,
            resource: resourceFromEntry(adapter.runtime, plan.owner, entry),
            transactionId: id,
            operationId: id,
            source: 'local' as const,
          })),
          ...result.renamed.map(rename => {
            const oldResource = byPath.get(rename.oldPath)
            if (!oldResource) throw new Error(`资源不存在: ${rename.oldPath}`)
            return {
              type: 'renamed' as const,
              oldResource,
              resource: resourceFromEntry(adapter.runtime, plan.owner, rename.entry),
              transactionId: id,
              operationId: id,
              source: 'local' as const,
            }
          }),
        ]
        const change: ProjectResourceChange | null = changes.length
          ? { type: 'batch', changes, transactionId: id, operationId: id, source: 'local' }
          : null
        if (change) emitProjectResourceChange(change)
        return {
          planId: plan.id,
          change,
          failures: result.failures.map(failure => ({
            resource:
              byPath.get(failure.path) ||
              resourceFromEntry(adapter.runtime, plan.owner, {
                path: failure.path,
                isDirectory: false,
              }),
            message: failure.message,
          })),
        }
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
      async list(owner) {
        return webProjectFiles
          .list(owner)
          .then(entries => entries.map(entry => ({ ...entry, isDirectory: entry.isDir })))
      },
      async listDirectory(owner, path) {
        return (await webProjectFiles.list(owner))
          .filter(entry => isDirectChild(entry.path, path))
          .map(entry => ({ ...entry, isDirectory: entry.isDir }))
      },
      async searchPaths(owner, query, limit) {
        const needle = query.toLocaleLowerCase()
        return (await webProjectFiles.list(owner))
          .filter(entry => entry.path.toLocaleLowerCase().includes(needle))
          .slice(0, limit)
          .map(entry => ({ ...entry, isDirectory: entry.isDir }))
      },
      async listDescendants(owner, path) {
        return (await webProjectFiles.list(owner))
          .filter(entry => entry.path.startsWith(`${path}/`))
          .map(entry => ({ ...entry, isDirectory: entry.isDir }))
      },
      async readText(owner, path, maxBytes) {
        const entry = await webProjectFiles.read(owner, path)
        return {
          content: entry.content,
          size: entry.size,
          truncated: Boolean(maxBytes && entry.size > maxBytes),
          revision: {
            value: webProjectTextRevision(entry),
            size: entry.size,
            updatedAt: entry.updatedAt,
          },
        }
      },
      async writeText(owner, path, content, expectedRevision) {
        const result = await webProjectFiles.writeIfRevision(
          owner,
          path,
          content,
          expectedRevision.value,
        )
        if (result.status === 'missing') return result
        const revision = {
          value: result.revision,
          size: result.entry.size,
          updatedAt: result.entry.updatedAt,
        }
        if (result.status === 'conflict') {
          return {
            status: 'conflict' as const,
            current: {
              content: result.entry.content,
              size: result.entry.size,
              truncated: false,
              revision,
            },
          }
        }
        return { status: 'saved' as const, revision }
      },
      async readBinary(owner, path) {
        const entry = await webProjectFiles.read(owner, path)
        const data = new Uint8Array(
          await (await webProjectFiles.readBinary(owner, path)).arrayBuffer(),
        )
        return { data, size: entry.size, mimeType: entry.mimeType }
      },
      async importBinary(owner, path, data, mimeType) {
        const bytes = new Uint8Array(data.byteLength)
        bytes.set(data)
        const entry = await webProjectFiles.writeBinary(
          owner,
          path,
          new Blob([bytes.buffer], { type: mimeType }),
          {
            category: mimeType.startsWith('image/')
              ? 'image'
              : mimeType.startsWith('video/')
                ? 'video'
                : mimeType.startsWith('audio/')
                  ? 'audio'
                  : 'binary',
            mimeType,
          },
        )
        return { ...entry, path: String(entry.metadata?.relativePath || path), isDirectory: false }
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
        const entry = await webProjectFiles.rename(
          owner,
          oldPath,
          newPath.split('/').pop() || newPath,
        )
        return { ...entry, path: newPath, isDirectory: false }
      },
      async remove(owner, path) {
        await webProjectFiles.remove(owner, path)
      },
      async executeBatch(owner, request) {
        const result = await webProjectFiles.executeBatch(owner, {
          kind: request.kind,
          roots: request.roots.map(resource => resource.path),
          targetDirectory: request.targetDirectory?.path,
          policy: request.policy,
        })
        const entry = (
          item: Awaited<ReturnType<typeof webProjectFiles.executeBatch>>['created'][number],
        ): ProjectFileEntry => ({
          id: item.id,
          path: String(item.metadata?.relativePath || ''),
          isDirectory: item.mimeType === 'folder' || item.metadata?.isFolder === true,
          size: item.size,
          updatedAt: item.updatedAt,
          mimeType: item.mimeType,
          content: item.content,
        })
        return {
          created: result.created.map(entry),
          renamed: result.renamed.map(item => ({
            oldPath: item.oldPath,
            entry: entry(item.entry),
          })),
          deleted: result.deleted.map(entry),
          failures: result.failures,
        }
      },
    })
  }

  return createProjectFileService({
    runtime: 'desktop',
    async list(owner) {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke<ProjectFileEntry[]>('dev_list_files', {
        input: { root: owner, maxEntries: 1000 },
      })
    },
    async listDirectory(owner, path) {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke<ProjectFileEntry[]>('dev_list_directory', {
        input: { root: owner, relativePath: path || undefined },
      })
    },
    async searchPaths(owner, query, limit) {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke<ProjectFileEntry[]>('dev_search_project_paths', {
        input: { root: owner, query, limit },
      })
    },
    async listDescendants(owner, path) {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke<ProjectFileEntry[]>('dev_list_file_descendants', {
        input: { root: owner, relativePath: path },
      })
    },
    async readText(owner, path, maxBytes) {
      const { invoke } = await import('@tauri-apps/api/core')
      const result = await invoke<ProjectTextRead>('dev_read_file', {
        input: { root: owner, relativePath: path, maxBytes: maxBytes || 500_000 },
      })
      return result
    },
    async writeText(owner, path, content, expectedRevision) {
      const { invoke } = await import('@tauri-apps/api/core')
      const result = await invoke<{
        status: 'saved' | 'conflict' | 'missing'
        revision?: ProjectResourceRevision
      }>('dev_write_file_if_revision', {
        input: {
          root: owner,
          relativePath: path,
          content,
          expectedRevision: expectedRevision.value,
        },
      })
      if (result.status === 'saved' && result.revision)
        return { status: 'saved', revision: result.revision }
      if (result.status === 'missing') return { status: 'missing' }
      return { status: 'conflict', current: await this.readText(owner, path) }
    },
    async readBinary(owner, path) {
      const { invoke } = await import('@tauri-apps/api/core')
      const result = await invoke<{ base64: string; size: number; truncated: boolean }>(
        'dev_read_file',
        {
          input: { root: owner, relativePath: path, maxBytes: 30_000_000 },
        },
      )
      if (result.truncated) throw new Error('二进制文件超过 30 MB，无法安全读取')
      return { data: base64ToBytes(result.base64), size: result.size }
    },
    async importBinary(owner, path, data, mimeType) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('dev_write_file_bytes', {
        input: { root: owner, relativePath: path, dataBase64: bytesToBase64(data) },
      })
      return { path, isDirectory: false, size: data.byteLength, mimeType }
    },
    async importExternalFiles(owner, paths, targetPath) {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke<ProjectFileEntry[]>('dev_import_project_drop', {
        input: { root: owner, sourcePaths: paths, targetRelativePath: targetPath },
      })
    },
    async createText(owner, path, content) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('dev_create_file_if_missing', {
        input: { root: owner, relativePath: path, content },
      })
      return { path, isDirectory: false, content, size: new TextEncoder().encode(content).length }
    },
    async createFolder(owner, path) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('dev_create_dir', { input: { root: owner, relativePath: path, content: '' } })
      return { path, isDirectory: true }
    },
    async rename(owner, oldPath, newPath) {
      const { invoke } = await import('@tauri-apps/api/core')
      const path = await invoke<string>('dev_rename_file', {
        input: { root: owner, oldRelativePath: oldPath, newRelativePath: newPath },
      })
      return { path, isDirectory: false }
    },
    async remove(owner, path) {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('dev_delete_file', { input: { root: owner, relativePath: path } })
    },
    async executeBatch(owner, request) {
      const { invoke } = await import('@tauri-apps/api/core')
      const result = await invoke<{
        created: ProjectFileEntry[]
        renamed: Array<{ oldPath: string; entry: ProjectFileEntry }>
        deleted: ProjectFileEntry[]
      }>('dev_batch_project_operation', {
        input: {
          root: owner,
          kind: request.kind,
          relativePaths: request.roots.map(resource => resource.path),
          targetRelativePath: request.targetDirectory?.path,
          policy: request.policy,
        },
      })
      return {
        created: result.created,
        renamed: result.renamed,
        deleted: result.deleted,
        failures: [],
      }
    },
  })
}

export { resourceFromEntry as projectResourceFromEntry, renamedProjectResource }
