import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ProjectTextSync, isSyncableTextPath } from '../projectTextSync'
import { createProjectFileService, type ProjectFileAdapter } from '../projectFileService'
import { TextSyncError, type SyncFile, type SyncMutation, type SyncProject } from '../textSyncClient'

interface LocalFile { content: string; revision: number; mimeType: string }

function localFiles(runtime: 'web' | 'desktop') {
  const records = new Map<string, LocalFile>()
  const adapter: ProjectFileAdapter = {
    runtime,
    async list() {
      return [...records].map(([path, file]) => ({ path, isDirectory: false, size: file.content.length, mimeType: file.mimeType }))
    },
    async readText(_owner, path) {
      const file = records.get(path)
      if (!file) throw new Error(`missing: ${path}`)
      return { content: file.content, size: file.content.length, truncated: false, revision: { value: String(file.revision), size: file.content.length } }
    },
    async writeText(_owner, path, content, expected) {
      const file = records.get(path)
      if (!file) return { status: 'missing' as const }
      if (String(file.revision) !== expected.value) {
        return { status: 'conflict' as const, current: { content: file.content, size: file.content.length, truncated: false, revision: { value: String(file.revision), size: file.content.length } } }
      }
      file.content = content
      file.revision += 1
      return { status: 'saved' as const, revision: { value: String(file.revision), size: content.length } }
    },
    async createText(_owner, path, content) {
      if (records.has(path)) throw new Error(`exists: ${path}`)
      records.set(path, { content, revision: 1, mimeType: 'text/markdown' })
      return { path, isDirectory: false, content, size: content.length, mimeType: 'text/markdown' }
    },
    async createFolder(_owner, path) {
      return { path, isDirectory: true }
    },
    async rename(_owner, oldPath, newPath) {
      const file = records.get(oldPath)
      if (!file) throw new Error(`missing: ${oldPath}`)
      records.delete(oldPath)
      records.set(newPath, file)
      return { path: newPath, isDirectory: false, size: file.content.length, mimeType: file.mimeType }
    },
    async remove(_owner, path) { records.delete(path) },
  }
  return { records, service: createProjectFileService(adapter) }
}

function fakeCloud() {
  const project: SyncProject = { id: 'project_12345678', name: '共同记忆', created_at: 1, updated_at: 1, deleted_at: null }
  const files = new Map<string, SyncFile>()
  const mutations = new Map<string, { path: string; revision: number }>()
  let cursor = 0
  let offline = false
  let loseNextResponse = false
  const api = {
    async listProjects() { return [project] },
    async createProject() { return project },
    async pullFiles(_projectId: string, after: number) {
      if (offline) throw new TypeError('offline')
      const changed = [...files.values()].filter(file => file.updated_at > after)
      return { cursor, has_more: false, files: changed }
    },
    async pushFiles(_projectId: string, _deviceId: string, inputs: SyncMutation[]) {
      if (offline) throw new TypeError('offline')
      const results = inputs.map(input => {
        const duplicate = mutations.get(input.mutation_id)
        if (duplicate) return { mutation_id: input.mutation_id, path: duplicate.path, revision: duplicate.revision, duplicate: true }
        const current = files.get(input.path)
        const revision = current?.revision || 0
        if (revision !== input.expected_revision) throw new TextSyncError('文件版本冲突', 409, 'sync_conflict')
        cursor += 1
        const nextRevision = revision + 1
        files.set(input.path, {
          path: input.path,
          content: input.operation === 'upsert' ? input.content || '' : null,
          content_hash: input.content_hash || '',
          revision: nextRevision,
          updated_at: cursor,
          deleted_at: input.operation === 'delete' ? cursor : null,
        })
        mutations.set(input.mutation_id, { path: input.path, revision: nextRevision })
        return { mutation_id: input.mutation_id, path: input.path, revision: nextRevision, duplicate: false }
      })
      if (loseNextResponse) {
        loseNextResponse = false
        throw new TypeError('response lost')
      }
      return results
    },
  }
  return {
    api,
    files,
    setOffline(value: boolean) { offline = value },
    loseResponseOnce() { loseNextResponse = true },
  }
}

async function text(service: ReturnType<typeof createProjectFileService>, owner: string, path: string) {
  const resource = (await service.list(owner)).find(item => item.path === path)
  return resource ? (await service.readText(resource)).content : undefined
}

async function replace(service: ReturnType<typeof createProjectFileService>, owner: string, path: string, content: string) {
  const resource = (await service.list(owner)).find(item => item.path === path)
  assert.ok(resource)
  const current = await service.readText(resource)
  assert.equal((await service.writeText(resource, content, current.revision)).status, 'saved')
}

test('Web and Mac share text with offline retry, idempotency and visible conflict copies', async () => {
  const cloud = fakeCloud()
  const web = localFiles('web')
  const mac = localFiles('desktop')
  const webSync = new ProjectTextSync(web.service, cloud.api)
  const macSync = new ProjectTextSync(mac.service, cloud.api)
  try {
    await web.service.createText('web-owner', '.raw/对话记录/第一轮.md', 'Web 第一轮')
    await web.service.createText('web-owner', 'wiki/人物.md', '人物初稿')
    await web.service.createText('web-owner', 'jc-media/video.txt', '不应同步')
    await webSync.open('web-owner', '共同记忆')
    await webSync.enable()

    assert.equal(cloud.files.get('.raw/对话记录/第一轮.md')?.content, 'Web 第一轮')
    assert.equal(cloud.files.get('wiki/人物.md')?.content, '人物初稿')
    assert.equal(cloud.files.has('jc-media/video.txt'), false)
    assert.equal(cloud.files.has('.raw/.sync/state.json'), false)

    await macSync.open('mac-owner', '共同记忆')
    await macSync.connect('project_12345678')
    assert.equal(await text(mac.service, 'mac-owner', '.raw/对话记录/第一轮.md'), 'Web 第一轮')
    assert.equal(await text(mac.service, 'mac-owner', 'wiki/人物.md'), '人物初稿')

    cloud.setOffline(true)
    await replace(mac.service, 'mac-owner', 'wiki/人物.md', 'Mac 离线修改')
    await macSync.syncNow().catch(() => {})
    cloud.setOffline(false)
    await macSync.syncNow()
    assert.equal(cloud.files.get('wiki/人物.md')?.content, 'Mac 离线修改')

    cloud.loseResponseOnce()
    await replace(web.service, 'web-owner', '.raw/对话记录/第一轮.md', '响应丢失但只写一次')
    await webSync.syncNow().catch(() => {})
    const committedRevision = cloud.files.get('.raw/对话记录/第一轮.md')?.revision
    await webSync.syncNow()
    assert.equal(cloud.files.get('.raw/对话记录/第一轮.md')?.revision, committedRevision)

    cloud.setOffline(true)
    await replace(web.service, 'web-owner', 'wiki/人物.md', 'Web 冲突版本')
    await replace(mac.service, 'mac-owner', 'wiki/人物.md', 'Mac 冲突版本')
    cloud.setOffline(false)
    await webSync.syncNow()
    await macSync.syncNow()
    assert.equal(await text(mac.service, 'mac-owner', 'wiki/人物.md'), 'Web 冲突版本')
    const conflict = [...mac.records].find(([path]) => /wiki\/人物 \(冲突 \d{14}(?:-\d+)?\)\.md/.test(path))
    assert.equal(conflict?.[1].content, 'Mac 冲突版本')
  } finally {
    webSync.dispose()
    macSync.dispose()
  }
})

test('sync path contract excludes queue state, media, credentials and binary files', () => {
  assert.equal(isSyncableTextPath('.raw/对话记录/今天.md'), true)
  for (const path of ['.raw/.sync/state.json', 'jc-media/a.txt', '.env.local', 'credentials.json', 'wiki/a.png']) {
    assert.equal(isSyncableTextPath(path), false)
  }
})
