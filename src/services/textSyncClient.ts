import {
  clearGatewaySession,
  getGatewayBaseUrl,
  getGatewaySessionToken,
  initGatewaySessionToken,
} from './newApiClient'
import { safeFetch } from '@/utils/httpClient'

export interface SyncProject {
  id: string
  name: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

export interface SyncFile {
  path: string
  content: string | null
  content_hash: string
  revision: number
  updated_at: number
  deleted_at: number | null
}

export interface SyncMutation {
  mutation_id: string
  path: string
  operation: 'upsert' | 'delete'
  expected_revision: number
  content?: string
  content_hash?: string
}

export class TextSyncError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'TextSyncError'
  }
}

async function syncJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = getGatewaySessionToken() || await initGatewaySessionToken()
  if (!session) throw new TextSyncError('请先登录后再使用文字同步', 401, 'unauthorized')
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  headers.set('X-JC-Session', session)
  const response = await safeFetch(`${getGatewayBaseUrl()}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  })
  const payload = await response.json().catch(() => ({})) as any
  if (!response.ok) {
    if (response.status === 401) await clearGatewaySession()
    throw new TextSyncError(
      String(payload?.message || `文字同步失败：HTTP ${response.status}`),
      response.status,
      String(payload?.code || 'sync_error'),
    )
  }
  return payload as T
}

export const textSyncClient = {
  async listProjects(includeDeleted = false): Promise<SyncProject[]> {
    const payload = await syncJson<{ projects: SyncProject[] }>(
      `/sync/projects${includeDeleted ? '?include_deleted=1' : ''}`,
    )
    return payload.projects
  },
  async createProject(name: string): Promise<SyncProject> {
    const payload = await syncJson<{ project: SyncProject }>('/sync/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    return payload.project
  },
  async pullFiles(projectId: string, cursor: number): Promise<{ cursor: number; has_more: boolean; total: number; files: SyncFile[] }> {
    return await syncJson(`/sync/projects/${encodeURIComponent(projectId)}/files?cursor=${cursor}`)
  },
  async pushFiles(projectId: string, deviceId: string, mutations: SyncMutation[]): Promise<Array<{ mutation_id: string; path: string; revision: number; duplicate: boolean }>> {
    const payload = await syncJson<{ results: Array<{ mutation_id: string; path: string; revision: number; duplicate: boolean }> }>(
      `/sync/projects/${encodeURIComponent(projectId)}/files`,
      { method: 'POST', body: JSON.stringify({ device_id: deviceId, mutations }) },
    )
    return payload.results
  },
  async deleteProject(projectId: string): Promise<SyncProject> {
    const payload = await syncJson<{ project: SyncProject }>(
      `/sync/projects/${encodeURIComponent(projectId)}/delete`,
      { method: 'POST' },
    )
    return payload.project
  },
  async restoreProject(projectId: string): Promise<SyncProject> {
    const payload = await syncJson<{ project: SyncProject }>(
      `/sync/projects/${encodeURIComponent(projectId)}/restore`,
      { method: 'POST' },
    )
    return payload.project
  },
}
