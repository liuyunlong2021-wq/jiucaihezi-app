import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import { ProjectTextSync, isSyncableTextPath, projectTextSyncStatus } from '../projectTextSync'
import { createProjectFileService, type ProjectFileAdapter } from '../projectFileService'
import { TextSyncError, type SyncFile, type SyncMutation, type SyncProject } from '../textSyncClient'
import { appendConversationTurn, createConversationTranscript, parseConversationTranscript } from '../../runtime/memory/conversationTranscript'

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
  const pushBatchSizes: number[] = []
  const pushProgress: string[] = []
  const api = {
    async listProjects() { return [project] },
    async createProject() { return project },
    async pullFiles(_projectId: string, after: number) {
      if (offline) throw new TypeError('offline')
      const changed = [...files.values()].filter(file => file.updated_at > after)
      return { cursor, has_more: false, total: changed.length, files: changed }
    },
    async pushFiles(_projectId: string, _deviceId: string, inputs: SyncMutation[]) {
      if (offline) throw new TypeError('offline')
      pushBatchSizes.push(inputs.length)
      pushProgress.push(projectTextSyncStatus.message)
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
    pushBatchSizes,
    pushProgress,
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

function hash(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

test('pending local edit ignores an already acknowledged remote revision', async () => {
  const cloud = fakeCloud()
  const local = localFiles('desktop')
  const path = '.raw/对话记录/连续对话.md'
  const previous = '第一轮'
  const current = '第一轮\n第二轮'
  cloud.files.set(path, {
    path,
    content: previous,
    content_hash: hash(previous),
    revision: 1,
    updated_at: 1,
    deleted_at: null,
  })
  local.records.set(path, { content: current, revision: 1, mimeType: 'text/markdown' })
  local.records.set('.raw/.sync/state.json', {
    content: JSON.stringify({
      version: 1,
      cloudProjectId: 'project_12345678',
      cursor: 0,
      revisions: { [path]: 1 },
      hashes: { [path]: hash(previous) },
      pending: [{
        mutation_id: 'mutation_local_edit',
        path,
        operation: 'upsert',
        expected_revision: 1,
        content: current,
        content_hash: hash(current),
      }],
    }),
    revision: 1,
    mimeType: 'application/json',
  })
  const sync = new ProjectTextSync(local.service, cloud.api)
  try {
    await sync.open('desktop-owner', '共同记忆')
    await sync.syncNow()
    assert.equal(await text(local.service, 'desktop-owner', path), current)
    assert.equal(cloud.files.get(path)?.content, current)
    assert.equal([...local.records.keys()].some(name => name.includes('(冲突 ')), false)
  } finally {
    sync.dispose()
  }
})

test('concurrent Raw appends merge into one conversation without a conflict copy', async () => {
  const cloud = fakeCloud()
  const local = localFiles('desktop')
  const path = '.raw/对话记录/连续对话.md'
  const empty = createConversationTranscript('conversation_merge', '连续对话', '2026-07-27T10:00:00.000Z')
  const first = appendConversationTurn(empty, {
    id: 'turn_user_1', role: 'user', content: '第一问', createdAt: '2026-07-27T10:01:00.000Z',
  })
  const remote = appendConversationTurn(first, {
    id: 'turn_assistant_1', role: 'assistant', content: '第一答', createdAt: '2026-07-27T10:01:10.000Z',
  })
  const current = appendConversationTurn(first, {
    id: 'turn_user_2', role: 'user', content: '第二问', createdAt: '2026-07-27T10:01:20.000Z',
  })
  cloud.files.set(path, {
    path, content: remote, content_hash: hash(remote), revision: 2, updated_at: 1, deleted_at: null,
  })
  local.records.set(path, { content: empty, revision: 1, mimeType: 'text/markdown' })
  local.records.set('.raw/.sync/state.json', {
    content: JSON.stringify({
      version: 1,
      cloudProjectId: 'project_12345678',
      cursor: 0,
      revisions: { [path]: 1 },
      hashes: { [path]: hash(first) },
      pending: [
        {
          mutation_id: 'mutation_second_turn', path, operation: 'upsert', expected_revision: 1,
          content: current, content_hash: hash(current),
        },
        {
          mutation_id: 'mutation_stale_header', path, operation: 'upsert', expected_revision: 2,
          content: empty, content_hash: hash(empty),
        },
      ],
    }),
    revision: 1,
    mimeType: 'application/json',
  })
  const sync = new ProjectTextSync(local.service, cloud.api)
  try {
    await sync.open('desktop-owner', '共同记忆')
    await sync.syncNow()
    const merged = cloud.files.get(path)?.content || ''
    assert.deepEqual(parseConversationTranscript(path, merged)?.turns.map(turn => turn.content), [
      '第一问', '第一答', '第二问',
    ])
    assert.equal(await text(local.service, 'desktop-owner', path), merged)
    assert.equal([...local.records.keys()].some(name => name.includes('(冲突 ')), false)
  } finally {
    sync.dispose()
  }
})

test('Web and Mac share text with offline retry, idempotency and visible conflict copies', async () => {
  const cloud = fakeCloud()
  const web = localFiles('web')
  const mac = localFiles('desktop')
  const webSync = new ProjectTextSync(web.service, cloud.api)
  const macSync = new ProjectTextSync(mac.service, cloud.api)
  try {
    await web.service.createText('web-owner', '.raw/对话记录/第一轮.md', 'Web 第一轮')
    await web.service.createText('web-owner', '.raw/jc-media/文档/资料.md', '资料正文')
    await web.service.createText('web-owner', 'wiki/人物.md', '人物初稿')
    await web.service.createText('web-owner', 'jc-media/video.txt', '不应同步')
    await webSync.open('web-owner', '共同记忆')
    await webSync.enable()

    assert.equal(await webSync.cloudProjectIdFor('web-owner'), 'project_12345678')

    assert.equal(cloud.files.get('.raw/对话记录/第一轮.md')?.content, 'Web 第一轮')
    assert.equal(cloud.files.get('.raw/jc-media/文档/资料.md')?.content, '资料正文')
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
  assert.equal(isSyncableTextPath('.raw/jc-media/文档/资料.md'), true)
  for (const path of ['.raw/.sync/state.json', 'jc-media/a.txt', '.raw/jc-media/图片/a.txt', '.env.local', 'credentials.json', 'wiki/a.png']) {
    assert.equal(isSyncableTextPath(path), false)
  }
})

test('opening and editing a cloud project stay local until manual sync', async () => {
  const cloud = fakeCloud()
  const local = localFiles('web')
  const path = 'wiki/人物.md'
  local.records.set(path, { content: '本地初稿', revision: 1, mimeType: 'text/markdown' })
  local.records.set('.raw/.sync/state.json', {
    content: JSON.stringify({
      version: 1,
      cloudProjectId: 'project_12345678',
      cursor: 0,
      revisions: {},
      hashes: {},
      pending: [],
    }),
    revision: 1,
    mimeType: 'application/json',
  })
  const sync = new ProjectTextSync(local.service, cloud.api)
  try {
    await sync.open('web-owner', '共同记忆')
    assert.equal(cloud.files.size, 0)

    await replace(local.service, 'web-owner', path, '只保存在本地')
    for (let attempt = 0; attempt < 20 && projectTextSyncStatus.pending === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(cloud.files.size, 0)
    assert.equal(projectTextSyncStatus.pending, 1)

    await sync.syncNow()
    assert.equal(cloud.files.get(path)?.content, '只保存在本地')
  } finally {
    sync.dispose()
  }
})

test('first upload sends at most 100 files per request and reports progress', async () => {
  const cloud = fakeCloud()
  const web = localFiles('web')
  const sync = new ProjectTextSync(web.service, cloud.api)
  try {
    for (let index = 0; index < 205; index += 1) {
      await web.service.createText('web-owner', `wiki/${index}.md`, `# ${index}`)
    }
    await sync.open('web-owner', '批量记忆')
    await sync.enable()

    assert.deepEqual(cloud.pushBatchSizes, [100, 100, 5])
    assert.deepEqual(cloud.pushProgress, ['上传 0/205', '上传 100/205', '上传 200/205'])
    assert.equal(projectTextSyncStatus.message, '文字已同步')
    assert.equal(projectTextSyncStatus.progressTotal, 0)
  } finally {
    sync.dispose()
  }
})
