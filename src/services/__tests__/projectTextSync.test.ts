import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import { ProjectTextSync, isSyncableTextPath, projectTextSyncStatus } from '../projectTextSync'
import { createProjectFileService, type ProjectFileAdapter } from '../projectFileService'
import { TextSyncError, type SyncFile, type SyncMutation, type SyncProject } from '../textSyncClient'

interface LocalFile { content: string; revision: number; mimeType: string }

function localFiles(runtime: 'web' | 'desktop') {
  const records = new Map<string, LocalFile>()
  let hideStateFromRecursiveList = false
  const adapter: ProjectFileAdapter = {
    runtime,
    async list() {
      return [...records]
        .filter(([path]) => !hideStateFromRecursiveList || path !== '.raw/.sync/state.json')
        .map(([path, file]) => ({ path, isDirectory: false, size: file.content.length, mimeType: file.mimeType }))
    },
    async listDirectory(_owner, directory) {
      const prefix = directory ? `${directory}/` : ''
      return [...records]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, file]) => ({ path, isDirectory: false, size: file.content.length, mimeType: file.mimeType }))
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
  return {
    records,
    service: createProjectFileService(adapter),
    hideStateFromRecursiveList() { hideStateFromRecursiveList = true },
  }
}

function hash(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

function fakeCloud() {
  const project: SyncProject = { id: 'project_12345678', name: '共同记忆', created_at: 1, updated_at: 1, deleted_at: null }
  const files = new Map<string, SyncFile>()
  const mutations = new Map<string, { path: string; revision: number }>()
  const pushBatchSizes: number[] = []
  const pushProgress: string[] = []
  let cursor = 0
  let pulls = 0
  let pushes = 0
  let offline = false

  function seed(path: string, content: string | null) {
    cursor += 1
    const previous = files.get(path)
    files.set(path, {
      path,
      content,
      content_hash: hash(content || ''),
      revision: (previous?.revision || 0) + 1,
      updated_at: cursor,
      deleted_at: content == null ? cursor : null,
    })
  }

  const api = {
    async listProjects() { return [project] },
    async createProject() { return project },
    async pullFiles(_projectId: string, after: number) {
      if (offline) throw new TypeError('offline')
      pulls += 1
      const changed = [...files.values()].filter(file => file.updated_at > after)
      return { cursor, has_more: false, total: changed.length, files: changed }
    },
    async pushFiles(_projectId: string, _deviceId: string, inputs: SyncMutation[]) {
      if (offline) throw new TypeError('offline')
      pushes += 1
      pushBatchSizes.push(inputs.length)
      pushProgress.push(projectTextSyncStatus.message)
      return inputs.map(input => {
        const duplicate = mutations.get(input.mutation_id)
        if (duplicate) return { mutation_id: input.mutation_id, path: duplicate.path, revision: duplicate.revision, duplicate: true }
        const current = files.get(input.path)
        if ((current?.revision || 0) !== input.expected_revision) throw new TextSyncError('文件版本冲突', 409, 'sync_conflict')
        seed(input.path, input.operation === 'upsert' ? input.content || '' : null)
        const revision = files.get(input.path)!.revision
        mutations.set(input.mutation_id, { path: input.path, revision })
        return { mutation_id: input.mutation_id, path: input.path, revision, duplicate: false }
      })
    },
  }

  return {
    api,
    files,
    pushBatchSizes,
    pushProgress,
    seed,
    counts: () => ({ pulls, pushes }),
    setOffline(value: boolean) { offline = value },
  }
}

async function text(service: ReturnType<typeof createProjectFileService>, owner: string, path: string) {
  const resource = (await service.list(owner)).find(item => item.path === path)
  return resource ? (await service.readText(resource)).content : undefined
}

function bind(local: ReturnType<typeof localFiles>, cloudProjectId = 'project_12345678') {
  local.records.set('.raw/.sync/state.json', {
    content: JSON.stringify({ version: 1, cloudProjectId, cursor: 0, revisions: {}, hashes: {}, pending: [] }),
    revision: 1,
    mimeType: 'application/json',
  })
}

test('upload overwrites cloud text snapshot and leaves excluded paths untouched', async () => {
  const cloud = fakeCloud()
  const local = localFiles('web')
  cloud.seed('wiki/shared.md', '云端旧内容')
  cloud.seed('wiki/cloud-only.md', '应删除')
  cloud.seed('jc-media/keep.txt', '云端媒体旁路')
  local.records.set('wiki/shared.md', { content: '本地新内容', revision: 1, mimeType: 'text/markdown' })
  local.records.set('wiki/local-only.md', { content: '本地新增', revision: 1, mimeType: 'text/markdown' })
  local.records.set('jc-media/keep.txt', { content: '本地媒体旁路', revision: 1, mimeType: 'text/plain' })
  bind(local)

  const sync = new ProjectTextSync(local.service, cloud.api)
  try {
    await sync.open('web-owner', '共同记忆')
    await sync.uploadNow()

    assert.equal(cloud.files.get('wiki/shared.md')?.content, '本地新内容')
    assert.equal(cloud.files.get('wiki/local-only.md')?.content, '本地新增')
    assert.ok(cloud.files.get('wiki/cloud-only.md')?.deleted_at)
    assert.equal(cloud.files.get('jc-media/keep.txt')?.content, '云端媒体旁路')
    assert.equal(await text(local.service, 'web-owner', 'jc-media/keep.txt'), '本地媒体旁路')
  } finally {
    sync.dispose()
  }
})

test('download overwrites local text snapshot and leaves excluded paths untouched', async () => {
  const cloud = fakeCloud()
  const local = localFiles('desktop')
  cloud.seed('wiki/shared.md', '云端新内容')
  cloud.seed('wiki/cloud-only.md', '云端新增')
  local.records.set('wiki/shared.md', { content: '本地旧内容', revision: 1, mimeType: 'text/markdown' })
  local.records.set('wiki/local-only.md', { content: '应删除', revision: 1, mimeType: 'text/markdown' })
  local.records.set('jc-media/keep.txt', { content: '本地媒体旁路', revision: 1, mimeType: 'text/plain' })
  bind(local)

  const sync = new ProjectTextSync(local.service, cloud.api)
  try {
    await sync.open('desktop-owner', '共同记忆')
    await sync.downloadNow()

    assert.equal(await text(local.service, 'desktop-owner', 'wiki/shared.md'), '云端新内容')
    assert.equal(await text(local.service, 'desktop-owner', 'wiki/cloud-only.md'), '云端新增')
    assert.equal(await text(local.service, 'desktop-owner', 'wiki/local-only.md'), undefined)
    assert.equal(await text(local.service, 'desktop-owner', 'jc-media/keep.txt'), '本地媒体旁路')
    assert.equal(cloud.files.has('wiki/local-only.md'), false)
  } finally {
    sync.dispose()
  }
})

test('local edits stay offline until an explicit directional action', async () => {
  const cloud = fakeCloud()
  const local = localFiles('web')
  bind(local)
  const sync = new ProjectTextSync(local.service, cloud.api)
  try {
    await sync.open('web-owner', '共同记忆')
    await local.service.createText('web-owner', 'wiki/local.md', '只在本地')
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.deepEqual(cloud.counts(), { pulls: 0, pushes: 0 })

    await sync.uploadNow()
    assert.equal(cloud.files.get('wiki/local.md')?.content, '只在本地')
  } finally {
    sync.dispose()
  }
})

test('upload creates a cloud project and batches at most 100 mutations', async () => {
  const cloud = fakeCloud()
  const local = localFiles('web')
  const sync = new ProjectTextSync(local.service, cloud.api)
  try {
    for (let index = 0; index < 205; index += 1) {
      await local.service.createText('web-owner', `wiki/${index}.md`, `# ${index}`)
    }
    await sync.open('web-owner', '批量记忆')
    await sync.uploadNow()

    assert.equal(await sync.cloudProjectIdFor('web-owner'), 'project_12345678')
    assert.deepEqual(cloud.pushBatchSizes, [100, 100, 5])
    assert.deepEqual(cloud.pushProgress, ['上传 0/205', '上传 100/205', '上传 200/205'])
    assert.match(projectTextSyncStatus.message, /已上传并覆盖云端/)
  } finally {
    sync.dispose()
  }
})

test('disconnect removes only the current local cloud binding', async () => {
  const cloud = fakeCloud()
  const local = localFiles('web')
  bind(local)
  const sync = new ProjectTextSync(local.service, cloud.api)
  try {
    await sync.open('web-owner', '共同记忆')
    await sync.disconnect()
    assert.equal(await sync.cloudProjectIdFor('web-owner'), '')
    assert.equal(projectTextSyncStatus.phase, 'disabled')
  } finally {
    sync.dispose()
  }
})

test('sync state lookup does not depend on the capped recursive project listing', async () => {
  const cloud = fakeCloud()
  const local = localFiles('desktop')
  bind(local)
  local.hideStateFromRecursiveList()
  const sync = new ProjectTextSync(local.service, cloud.api)
  try {
    assert.equal(await sync.cloudProjectIdFor('desktop-owner'), 'project_12345678')
    await sync.open('desktop-owner', '共同记忆')
    await sync.downloadNow()
    assert.match(local.records.get('.raw/.sync/state.json')?.content || '', /project_12345678/)
  } finally {
    sync.dispose()
  }
})

test('download emits a safe operation trace through pull and write completion', async () => {
  const cloud = fakeCloud()
  const local = localFiles('desktop')
  cloud.seed('wiki/trace.md', '云端内容')
  bind(local)
  const events: string[] = []
  const sync = new ProjectTextSync(local.service, cloud.api, event => events.push(`${event.operationId}:${event.step}:${event.fileCount || 0}`))
  try {
    await sync.open('desktop-owner', '共同记忆', 'op_trace')
    await sync.connect('project_12345678', 'op_trace')
    assert.deepEqual(events, [
      'op_trace:open-start:0',
      'op_trace:open-ready:0',
      'op_trace:connect-start:0',
      'op_trace:pull-start:0',
      'op_trace:pull-complete:1',
      'op_trace:success:1',
    ])
  } finally {
    sync.dispose()
  }
})

test('sync path contract excludes queue state, media, credentials and binary files', () => {
  assert.equal(isSyncableTextPath('.raw/对话记录/今天.md'), true)
  assert.equal(isSyncableTextPath('.raw/jc-media/文档/资料.md'), true)
  for (const path of ['.raw/.sync/state.json', 'jc-media/a.txt', '.raw/jc-media/图片/a.txt', '.env.local', 'credentials.json', 'wiki/a.png']) {
    assert.equal(isSyncableTextPath(path), false)
  }
})
