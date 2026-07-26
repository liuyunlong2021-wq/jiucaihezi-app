import { reactive } from 'vue'
import {
  createRuntimeProjectFileService,
  flattenProjectResourceChange,
  type ProjectFileService,
} from './projectFileService'
import {
  textSyncClient,
  TextSyncError,
  type SyncFile,
  type SyncMutation,
  type SyncProject,
} from './textSyncClient'
import type { ProjectResource } from '@/utils/projectResource'

const STATE_DIRECTORY = '.raw/.sync'
const STATE_PATH = `${STATE_DIRECTORY}/state.json`
const TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'csv', 'tsv', 'srt', 'vtt'])
const BLOCKED_PARTS = new Set(['.sync', '.git', '.ssh', '.aws', '.config', '.claude', '.codex', '.agents', 'node_modules', 'skills', 'jc-media'])
const BLOCKED_FILES = new Set(['credentials.json', 'secrets.json', 'secrets.yaml', 'secrets.yml', 'api-keys.json', 'mcp.json'])

interface PendingMutation extends SyncMutation {
  content_hash: string
}

interface LocalSyncState {
  version: 1
  cloudProjectId: string
  cursor: number
  revisions: Record<string, number>
  hashes: Record<string, string>
  pending: PendingMutation[]
}

interface TextSyncApi {
  listProjects(includeDeleted?: boolean): Promise<SyncProject[]>
  createProject(name: string): Promise<SyncProject>
  pullFiles(projectId: string, cursor: number): Promise<{ cursor: number; has_more: boolean; files: SyncFile[] }>
  pushFiles(projectId: string, deviceId: string, mutations: SyncMutation[]): Promise<Array<{ mutation_id: string; path: string; revision: number; duplicate: boolean }>>
}

export const projectTextSyncStatus = reactive({
  owner: '',
  cloudProjectId: '',
  phase: 'idle' as 'idle' | 'disabled' | 'syncing' | 'synced' | 'offline' | 'auth' | 'error',
  message: '',
  pending: 0,
  lastSyncedAt: 0,
})

export function isSyncableTextPath(path: string): boolean {
  const value = String(path || '')
  if (!value || value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false
  const parts = value.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) return false
  const lower = parts.map(part => part.toLowerCase())
  const fileName = lower.at(-1) || ''
  if (lower.some(part => BLOCKED_PARTS.has(part) || part === '.env' || part.startsWith('.env.'))) return false
  if (BLOCKED_FILES.has(fileName)) return false
  return TEXT_EXTENSIONS.has(fileName.split('.').pop() || '')
}

function emptyState(): LocalSyncState {
  return { version: 1, cloudProjectId: '', cursor: 0, revisions: {}, hashes: {}, pending: [] }
}

function uniqueId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  return `${prefix}_${String(id).replace(/[^A-Za-z0-9_-]/g, '')}`
}

function deviceId(): string {
  const key = 'jc_text_sync_device_id'
  try {
    const current = String(localStorage.getItem(key) || '')
    if (/^[A-Za-z0-9_-]{8,128}$/.test(current)) return current
    const next = uniqueId('device')
    localStorage.setItem(key, next)
    return next
  } catch {
    return uniqueId('device')
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function parseState(content: string): LocalSyncState {
  try {
    const value = JSON.parse(content)
    if (value?.version !== 1) return emptyState()
    return {
      version: 1,
      cloudProjectId: String(value.cloudProjectId || ''),
      cursor: Number.isSafeInteger(value.cursor) && value.cursor >= 0 ? value.cursor : 0,
      revisions: value.revisions && typeof value.revisions === 'object' ? value.revisions : {},
      hashes: value.hashes && typeof value.hashes === 'object' ? value.hashes : {},
      pending: Array.isArray(value.pending) ? value.pending : [],
    }
  } catch {
    return emptyState()
  }
}

export class ProjectTextSync {
  private owner = ''
  private projectName = ''
  private state = emptyState()
  private task: Promise<unknown> = Promise.resolve()
  private suppressed = new Set<string>()
  private stopChanges: (() => void) | null = null

  constructor(
    private readonly files: ProjectFileService = createRuntimeProjectFileService(),
    private readonly api: TextSyncApi = textSyncClient,
  ) {
    this.stopChanges = files.onDidChange(change => {
      const changes = flattenProjectResourceChange(change).filter(entry => {
        if (entry.resource.owner !== this.owner || entry.resource.isDirectory) return false
        if (this.suppressed.has(entry.resource.path)) return false
        return entry.type !== 'renamed' || !this.suppressed.has(entry.oldResource.path)
      })
      if (!changes.length) return
      void this.enqueue(async () => {
        await this.captureChanges(changes)
        if (this.state.cloudProjectId) await this.syncCycle()
      }).catch(() => {})
    })
  }

  async open(owner: string, name: string): Promise<void> {
    await this.enqueue(async () => {
      this.owner = owner
      this.projectName = name
      this.state = owner ? await this.readState() : emptyState()
      this.updateStatus(owner ? (this.state.cloudProjectId ? 'idle' : 'disabled') : 'idle')
      if (!owner || !this.state.cloudProjectId) return
      try {
        await this.reconcileLocalFiles()
        await this.syncCycle()
      } catch (error) {
        this.setFailure(error)
      }
    })
  }

  async enable(): Promise<void> {
    await this.enqueue(async () => {
      if (!this.owner) throw new Error('请先选择本地项目')
      if (!this.state.cloudProjectId) {
        const project = await this.api.createProject(this.projectName || '记忆空间')
        this.state.cloudProjectId = project.id
      }
      await this.reconcileLocalFiles()
      await this.persistState()
      await this.syncCycle()
    })
  }

  async connect(cloudProjectId: string): Promise<void> {
    await this.enqueue(async () => {
      if (!this.owner) throw new Error('请先选择本地项目')
      this.state = { ...emptyState(), cloudProjectId }
      await this.reconcileLocalFiles()
      await this.persistState()
      await this.syncCycle()
    })
  }

  async syncNow(): Promise<void> {
    await this.enqueue(async () => {
      if (!this.state.cloudProjectId) throw new Error('当前项目尚未开启云同步')
      await this.reconcileLocalFiles()
      await this.syncCycle()
    })
  }

  async listCloudProjects(): Promise<SyncProject[]> {
    return await this.api.listProjects()
  }

  dispose(): void {
    this.stopChanges?.()
    this.stopChanges = null
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.task.catch(() => undefined).then(action)
    this.task = next
    return next
  }

  private async find(path: string): Promise<ProjectResource | undefined> {
    return (await this.files.list(this.owner)).find(resource => resource.path === path)
  }

  private async readState(): Promise<LocalSyncState> {
    const resource = await this.find(STATE_PATH)
    if (!resource) return emptyState()
    return parseState((await this.files.readText(resource)).content)
  }

  private async persistState(): Promise<void> {
    const content = JSON.stringify(this.state)
    this.suppressed.add(STATE_PATH)
    try {
      const existing = await this.find(STATE_PATH)
      if (!existing) {
        await this.files.createFolder(this.owner, STATE_DIRECTORY).catch(() => {})
        await this.files.createText(this.owner, STATE_PATH, content)
      } else {
        const current = await this.files.readText(existing)
        const result = await this.files.writeText(existing, content, current.revision)
        if (result.status !== 'saved') throw new Error('本地同步队列保存冲突')
      }
    } finally {
      this.suppressed.delete(STATE_PATH)
    }
    this.updateStatus(projectTextSyncStatus.phase)
  }

  private expectedRevision(path: string): number {
    return (this.state.revisions[path] || 0) + this.state.pending.filter(item => item.path === path).length
  }

  private async enqueueUpsert(path: string, content?: string): Promise<void> {
    if (!isSyncableTextPath(path)) return
    const value = content ?? (await this.files.readText((await this.find(path))!)).content
    this.state.pending.push({
      mutation_id: uniqueId('mutation'),
      path,
      operation: 'upsert',
      expected_revision: this.expectedRevision(path),
      content: value,
      content_hash: await sha256(value),
    })
  }

  private async enqueueDelete(path: string): Promise<void> {
    if (!isSyncableTextPath(path)) return
    this.state.pending.push({
      mutation_id: uniqueId('mutation'),
      path,
      operation: 'delete',
      expected_revision: this.expectedRevision(path),
      content_hash: await sha256(''),
    })
  }

  private async captureChanges(entries: ReturnType<typeof flattenProjectResourceChange>): Promise<void> {
    if (!this.owner) return
    let changed = false
    for (const entry of entries) {
      if (entry.type === 'renamed') {
        await this.enqueueDelete(entry.oldResource.path)
        changed = true
      }
      const path = entry.resource.path
      if (!isSyncableTextPath(path)) continue
      if (entry.type === 'deleted') await this.enqueueDelete(path)
      else {
        const resource = await this.find(path)
        if (resource) await this.enqueueUpsert(path, (await this.files.readText(resource)).content)
      }
      changed = true
    }
    if (changed) await this.persistState()
  }

  private async reconcileLocalFiles(): Promise<void> {
    const resources = (await this.files.list(this.owner)).filter(resource =>
      !resource.isDirectory && isSyncableTextPath(resource.path),
    )
    const present = new Set(resources.map(resource => resource.path))
    const pendingPaths = new Set(this.state.pending.map(item => item.path))
    for (const resource of resources) {
      if (pendingPaths.has(resource.path)) continue
      const content = (await this.files.readText(resource)).content
      const hash = await sha256(content)
      if (this.state.hashes[resource.path] !== hash) await this.enqueueUpsert(resource.path, content)
    }
    for (const path of Object.keys(this.state.hashes)) {
      if (!present.has(path) && !pendingPaths.has(path)) await this.enqueueDelete(path)
    }
    await this.persistState()
  }

  private async syncCycle(): Promise<void> {
    this.updateStatus('syncing', '正在同步文字...')
    try {
      await this.pullAll()
      while (this.state.pending.length) {
        const mutation = this.state.pending[0]
        try {
          const [result] = await this.api.pushFiles(this.state.cloudProjectId, deviceId(), [mutation])
          this.state.revisions[mutation.path] = result.revision
          if (mutation.operation === 'delete') delete this.state.hashes[mutation.path]
          else this.state.hashes[mutation.path] = mutation.content_hash
          this.state.pending.shift()
          await this.persistState()
        } catch (error) {
          if (error instanceof TextSyncError && error.status === 409) {
            const before = this.state.pending.length
            await this.pullAll()
            if (this.state.pending.length < before) continue
          }
          throw error
        }
      }
      await this.pullAll()
      projectTextSyncStatus.lastSyncedAt = Date.now()
      this.updateStatus('synced', '文字已同步')
    } catch (error) {
      this.setFailure(error)
      throw error
    }
  }

  private async pullAll(): Promise<void> {
    let more = true
    while (more) {
      const page = await this.api.pullFiles(this.state.cloudProjectId, this.state.cursor)
      for (const remote of page.files) await this.applyRemote(remote)
      this.state.cursor = page.cursor
      more = page.has_more
      await this.persistState()
    }
  }

  private async applyRemote(remote: SyncFile): Promise<void> {
    const pending = this.state.pending.filter(item => item.path === remote.path)
    if (pending.length) {
      const local = [...pending].reverse().find(item => item.operation === 'upsert')
      this.state.pending = this.state.pending.filter(item => item.path !== remote.path)
      if (local?.content != null && local.content_hash !== remote.content_hash) {
        await this.createConflictCopy(remote.path, local.content)
      }
    }

    this.suppressed.add(remote.path)
    try {
      const existing = await this.find(remote.path)
      if (remote.deleted_at != null) {
        if (existing) await this.files.remove(existing)
        delete this.state.hashes[remote.path]
      } else if (!existing) {
        await this.files.createText(this.owner, remote.path, remote.content || '')
        this.state.hashes[remote.path] = remote.content_hash
      } else {
        const current = await this.files.readText(existing)
        if (await sha256(current.content) !== remote.content_hash) {
          const result = await this.files.writeText(existing, remote.content || '', current.revision)
          if (result.status !== 'saved') throw new Error(`本地文件正在更新：${remote.path}`)
        }
        this.state.hashes[remote.path] = remote.content_hash
      }
      this.state.revisions[remote.path] = remote.revision
    } finally {
      this.suppressed.delete(remote.path)
    }
  }

  private async createConflictCopy(path: string, content: string): Promise<void> {
    const dot = path.lastIndexOf('.')
    const base = dot > path.lastIndexOf('/') ? path.slice(0, dot) : path
    const extension = dot > path.lastIndexOf('/') ? path.slice(dot) : '.txt'
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
    let candidate = `${base} (冲突 ${stamp})${extension}`
    for (let index = 2; await this.find(candidate); index += 1) {
      candidate = `${base} (冲突 ${stamp}-${index})${extension}`
    }
    await this.files.createText(this.owner, candidate, content)
  }

  private updateStatus(phase: typeof projectTextSyncStatus.phase, message = ''): void {
    projectTextSyncStatus.owner = this.owner
    projectTextSyncStatus.cloudProjectId = this.state.cloudProjectId
    projectTextSyncStatus.phase = phase
    projectTextSyncStatus.message = message
    projectTextSyncStatus.pending = this.state.pending.length
  }

  private setFailure(error: unknown): void {
    if (error instanceof TextSyncError && error.status === 401) {
      this.updateStatus('auth', error.message)
    } else if (error instanceof TypeError) {
      this.updateStatus('offline', '当前离线，文字将在联网后继续同步')
    } else {
      this.updateStatus('error', error instanceof Error ? error.message : String(error))
    }
  }
}

export const projectTextSync = new ProjectTextSync()
