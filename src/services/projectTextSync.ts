import { reactive } from 'vue'
import { createRuntimeProjectFileService, type ProjectFileService } from './projectFileService'
import { textSyncClient, TextSyncError, type SyncFile, type SyncMutation, type SyncProject } from './textSyncClient'
import type { ProjectResource } from '@/utils/projectResource'

const STATE_DIRECTORY = '.raw/.sync'
const STATE_PATH = `${STATE_DIRECTORY}/state.json`
const TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'json', 'yaml', 'yml', 'csv', 'tsv', 'srt', 'vtt'])
const BLOCKED_PARTS = new Set(['.sync', '.git', '.ssh', '.aws', '.config', '.claude', '.codex', '.agents', 'node_modules', 'skills'])
const BLOCKED_FILES = new Set(['credentials.json', 'secrets.json', 'secrets.yaml', 'secrets.yml', 'api-keys.json', 'mcp.json'])

interface LocalSyncState {
  version: 1
  cloudProjectId: string
  cursor: number
  revisions: Record<string, number>
  hashes: Record<string, string>
  pending: []
}

interface TextSyncApi {
  listProjects(includeDeleted?: boolean): Promise<SyncProject[]>
  createProject(name: string): Promise<SyncProject>
  pullFiles(projectId: string, cursor: number): Promise<{ cursor: number; has_more: boolean; total: number; files: SyncFile[] }>
  pushFiles(projectId: string, deviceId: string, mutations: SyncMutation[]): Promise<Array<{ mutation_id: string; path: string; revision: number; duplicate: boolean }>>
}

export const projectTextSyncStatus = reactive({
  owner: '',
  cloudProjectId: '',
  phase: 'idle' as 'idle' | 'disabled' | 'syncing' | 'synced' | 'offline' | 'auth' | 'error',
  message: '',
  pending: 0,
  progressCurrent: 0,
  progressTotal: 0,
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
  if (lower.includes('jc-media') && !(lower[0] === '.raw' && lower[1] === 'jc-media' && parts[2] === '文档')) return false
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
      pending: [],
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

  constructor(
    private readonly files: ProjectFileService = createRuntimeProjectFileService(),
    private readonly api: TextSyncApi = textSyncClient,
  ) {}

  async open(owner: string, name: string): Promise<void> {
    await this.enqueue(async () => {
      this.owner = owner
      this.projectName = name
      this.state = owner ? await this.readState() : emptyState()
      this.updateStatus(owner ? (this.state.cloudProjectId ? 'idle' : 'disabled') : 'idle')
    })
  }

  async uploadNow(): Promise<void> {
    await this.enqueue(async () => {
      if (!this.owner) throw new Error('请先选择本地项目')
      if (!this.state.cloudProjectId) {
        const project = await this.api.createProject(this.projectName || '记忆空间')
        this.state.cloudProjectId = project.id
        await this.persistState()
      }
      await this.uploadSnapshot()
    })
  }

  async connect(cloudProjectId: string): Promise<void> {
    await this.enqueue(async () => {
      if (!this.owner) throw new Error('请先选择本地项目')
      this.state = { ...emptyState(), cloudProjectId }
      await this.persistState()
      await this.downloadSnapshot()
    })
  }

  async downloadNow(): Promise<void> {
    await this.enqueue(async () => {
      if (!this.state.cloudProjectId) throw new Error('当前项目尚未连接云端')
      await this.downloadSnapshot()
    })
  }

  async disconnect(): Promise<void> {
    await this.enqueue(async () => {
      if (!this.owner) return
      this.state = emptyState()
      await this.persistState()
      this.updateStatus('disabled', '当前项目未连接云端')
    })
  }

  async listCloudProjects(): Promise<SyncProject[]> {
    return await this.api.listProjects()
  }

  async cloudProjectIdFor(owner: string): Promise<string> {
    if (!owner) return ''
    const resource = await this.findState(owner)
    if (!resource) return ''
    return parseState((await this.files.readText(resource)).content).cloudProjectId
  }

  dispose(): void {}

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = this.task.catch(() => undefined).then(action)
    this.task = next
    return next
  }

  private async findState(owner = this.owner): Promise<ProjectResource | undefined> {
    try {
      return (await this.files.listDirectory(owner, STATE_DIRECTORY)).find(resource => resource.path === STATE_PATH)
    } catch {
      return undefined
    }
  }

  private async readState(): Promise<LocalSyncState> {
    const resource = await this.findState()
    if (!resource) return emptyState()
    return parseState((await this.files.readText(resource)).content)
  }

  private async persistState(): Promise<void> {
    const content = JSON.stringify(this.state)
    const existing = await this.findState()
    if (!existing) {
      await this.files.createFolder(this.owner, STATE_DIRECTORY).catch(() => {})
      await this.files.createText(this.owner, STATE_PATH, content)
    } else {
      const current = await this.files.readText(existing)
      const result = await this.files.writeText(existing, content, current.revision)
      if (result.status !== 'saved') throw new Error('本地同步状态保存冲突')
    }
    this.updateStatus(projectTextSyncStatus.phase)
  }

  private async readLocalSnapshot(): Promise<Map<string, { content: string; hash: string; resource: ProjectResource }>> {
    const resources = (await this.files.list(this.owner)).filter(resource => !resource.isDirectory && isSyncableTextPath(resource.path))
    const snapshot = new Map<string, { content: string; hash: string; resource: ProjectResource }>()
    for (const [index, resource] of resources.entries()) {
      const content = (await this.files.readText(resource)).content
      snapshot.set(resource.path, { content, hash: await sha256(content), resource })
      this.updateProgress(`正在扫描 ${index + 1}/${resources.length}`, index + 1, resources.length)
    }
    return snapshot
  }

  private async readRemoteSnapshot(): Promise<{ cursor: number; files: Map<string, SyncFile> }> {
    const files = new Map<string, SyncFile>()
    let cursor = 0
    let more = true
    while (more) {
      const page = await this.api.pullFiles(this.state.cloudProjectId, cursor)
      for (const file of page.files) if (isSyncableTextPath(file.path)) files.set(file.path, file)
      cursor = page.cursor
      more = page.has_more
    }
    return { cursor, files }
  }

  private async uploadSnapshot(): Promise<void> {
    this.updateStatus('syncing', '正在扫描文字...')
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const [local, remote] = await Promise.all([this.readLocalSnapshot(), this.readRemoteSnapshot()])
        const mutations: SyncMutation[] = []
        for (const [path, file] of local) {
          const current = remote.files.get(path)
          if (current && current.deleted_at == null && current.content_hash === file.hash) continue
          mutations.push({ mutation_id: uniqueId('mutation'), path, operation: 'upsert', expected_revision: current?.revision || 0, content: file.content, content_hash: file.hash })
        }
        for (const [path, remoteFile] of remote.files) {
          if (remoteFile.deleted_at == null && !local.has(path)) {
            mutations.push({ mutation_id: uniqueId('mutation'), path, operation: 'delete', expected_revision: remoteFile.revision, content_hash: await sha256('') })
          }
        }
        try {
          await this.pushMutations(mutations)
          this.state.cursor = remote.cursor
          this.state.revisions = Object.fromEntries([...remote.files].map(([path, file]) => [path, file.revision]))
          this.state.hashes = Object.fromEntries([...local].map(([path, file]) => [path, file.hash]))
          await this.persistState()
          projectTextSyncStatus.lastSyncedAt = Date.now()
          this.updateStatus('synced', `已上传并覆盖云端（${mutations.filter(item => item.operation === 'upsert').length} 个文字文件，删除 ${mutations.filter(item => item.operation === 'delete').length} 个）`)
          return
        } catch (error) {
          if (!(error instanceof TextSyncError) || error.status !== 409 || attempt === 2) throw error
        }
      }
    } catch (error) {
      this.setFailure(error)
      throw error
    }
  }

  private async pushMutations(mutations: SyncMutation[]): Promise<void> {
    const total = mutations.length
    let completed = 0
    for (let index = 0; index < mutations.length; index += 100) {
      const batch = mutations.slice(index, index + 100)
      this.updateProgress(`上传 ${completed}/${total}`, completed, total)
      const results = await this.api.pushFiles(this.state.cloudProjectId, deviceId(), batch)
      if (results.length !== batch.length) throw new Error('云端返回的同步结果数量不完整')
      for (const [resultIndex, result] of results.entries()) {
        if (result.mutation_id !== batch[resultIndex].mutation_id || result.path !== batch[resultIndex].path) throw new Error('云端返回的同步结果顺序无效')
      }
      completed += batch.length
      this.updateProgress(`上传 ${completed}/${total}`, completed, total)
    }
  }

  private async downloadSnapshot(): Promise<void> {
    this.updateStatus('syncing', '正在下载文字...')
    try {
      const [local, remote] = await Promise.all([this.readLocalSnapshot(), this.readRemoteSnapshot()])
      const active = new Set<string>()
      const remoteActive = [...remote.files].filter(([, file]) => file.deleted_at == null)
      const total = remoteActive.length
      let downloaded = 0
      let deleted = 0
      for (const [path, file] of remoteActive) {
        if (file.deleted_at != null) continue
        active.add(path)
        const existing = local.get(path)?.resource
        if (!existing) await this.files.createText(this.owner, path, file.content || '')
        else {
          const current = await this.files.readText(existing)
          if (current.content !== (file.content || '')) {
            const result = await this.files.writeText(existing, file.content || '', current.revision)
            if (result.status !== 'saved') throw new Error(`本地文件正在更新：${path}`)
          }
        }
        downloaded += 1
        this.updateProgress(`下载 ${downloaded}/${total}`, downloaded, total)
      }
      for (const [path, file] of local) {
        if (!active.has(path)) {
          await this.files.remove(file.resource)
          deleted += 1
        }
      }
      this.state.cursor = remote.cursor
      this.state.revisions = Object.fromEntries([...remote.files].map(([path, file]) => [path, file.revision]))
      this.state.hashes = Object.fromEntries([...remote.files].filter(([, file]) => file.deleted_at == null).map(([path, file]) => [path, file.content_hash]))
      this.state.pending = []
      await this.persistState()
      projectTextSyncStatus.lastSyncedAt = Date.now()
      this.updateStatus('synced', `已下载并覆盖本地（${downloaded} 个文字文件，删除 ${deleted} 个）`)
    } catch (error) {
      this.setFailure(error)
      throw error
    }
  }

  private updateProgress(message: string, current: number, total: number): void {
    this.updateStatus('syncing', message)
    projectTextSyncStatus.progressCurrent = current
    projectTextSyncStatus.progressTotal = total
  }

  private updateStatus(phase: typeof projectTextSyncStatus.phase, message?: string): void {
    projectTextSyncStatus.owner = this.owner
    projectTextSyncStatus.cloudProjectId = this.state.cloudProjectId
    projectTextSyncStatus.phase = phase
    if (message !== undefined) projectTextSyncStatus.message = message
    projectTextSyncStatus.pending = 0
    if (phase !== 'syncing') {
      projectTextSyncStatus.progressCurrent = 0
      projectTextSyncStatus.progressTotal = 0
    }
  }

  private setFailure(error: unknown): void {
    if (error instanceof TextSyncError && error.status === 401) this.updateStatus('auth', error.message)
    else if (error instanceof TypeError) this.updateStatus('offline', '当前离线，本次文字覆盖未完成')
    else this.updateStatus('error', error instanceof Error ? error.message : String(error))
  }
}

export const projectTextSync = new ProjectTextSync()
