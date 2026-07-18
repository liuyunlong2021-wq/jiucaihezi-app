import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createProjectFileService,
  flattenProjectResourceChange,
  type ProjectFileAdapter,
} from '../projectFileService'

function createAdapter(): ProjectFileAdapter {
  const files = new Map<string, { id?: string; content: string; mimeType: string; truncated?: boolean }>([
    ['wiki/old.md', { id: 'webfile_1', content: '# old', mimeType: 'text/markdown' }],
    ['assets/cover.png', { id: 'webfile_2', content: '', mimeType: 'image/png' }],
  ])
  return {
    runtime: 'web',
    async list() {
      return Array.from(files, ([path, value]) => ({ path, isDirectory: false, ...value }))
    },
    async readText(_owner, path) {
      const value = files.get(path)
      if (!value) throw new Error('missing')
      return { content: value.content, size: value.content.length, truncated: Boolean(value.truncated), revision: { value: value.id || path, size: value.content.length } }
    },
    async createText(_owner, path, content) {
      files.set(path, { id: `webfile_${path}`, content, mimeType: 'text/plain' })
      return { path, isDirectory: false, id: `webfile_${path}`, content, mimeType: 'text/plain', size: content.length }
    },
    async rename(_owner, oldPath, newPath) {
      const value = files.get(oldPath)
      if (!value) throw new Error('missing')
      files.delete(oldPath)
      files.set(newPath, value)
      return { path: newPath, isDirectory: false, ...value }
    },
    async remove(_owner, path) { files.delete(path) },
  }
}

test('service maps adapter entries and publishes one rename event with old and new resources', async () => {
  const service = createProjectFileService(createAdapter())
  const changes: any[] = []
  service.onDidChange(change => changes.push(change))
  const [oldFile] = await service.list('project_1')
  const renamed = await service.rename(oldFile, 'new.md')

  assert.equal(renamed.path, 'wiki/new.md')
  assert.equal(renamed.id, 'webfile_1')
  assert.equal(changes.length, 1)
  assert.equal(changes[0].type, 'renamed')
  assert.equal(changes[0].oldResource.path, 'wiki/old.md')
  assert.equal(changes[0].resource.path, 'wiki/new.md')
})

test('service preserves the Desktop isDir field so nested folders remain expandable', async () => {
  const adapter: ProjectFileAdapter = {
    runtime: 'desktop',
    async list() {
      return [{ path: 'audio.mp3', isDir: true } as unknown as import('../projectFileService').ProjectFileEntry]
    },
    async readText() { throw new Error('not used') },
    async createText() { throw new Error('not used') },
    async rename() { throw new Error('not used') },
    async remove() { throw new Error('not used') },
  }

  const [folder] = await createProjectFileService(adapter).list('/tmp/project')

  assert.equal(folder.isDirectory, true)
  assert.equal(folder.kind, 'binary')
})

test('service preserves truncated reads so callers can refuse writable editor tabs', async () => {
  const adapter = createAdapter()
  const originalRead = adapter.readText
  adapter.readText = async (owner, path) => ({ ...(await originalRead(owner, path)), truncated: true })
  const service = createProjectFileService(adapter)
  const [file] = await service.list('project_1')
  const result = await service.readText(file)

  assert.equal(result.truncated, true)
})

test('create and delete publish completed resource changes only', async () => {
  const service = createProjectFileService(createAdapter())
  const changes: any[] = []
  service.onDidChange(change => changes.push(change.type))
  const created = await service.createText('project_1', 'wiki/new.md', '# new')
  await service.remove(created)

  assert.deepEqual(changes, ['created', 'deleted'])
})

test('resource changes reach a separate consumer service instance', async () => {
  const actions = createProjectFileService(createAdapter())
  const consumer = createProjectFileService(createAdapter())
  const changes: any[] = []
  consumer.onDidChange(change => changes.push(change))
  const [file] = await actions.list('project_1')
  await actions.rename(file, 'shared.md')

  assert.equal(changes.length, 1)
  assert.equal(changes[0].resource.path, 'wiki/shared.md')
})

test('conditional text write rejects a stale revision without publishing a changed event', async () => {
  const files = new Map([
    ['wiki/current.md', { id: 'webfile_1', content: '# current', mimeType: 'text/markdown', revision: 'r2' }],
  ])
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() { return Array.from(files, ([path, value]) => ({ path, isDirectory: false, ...value })) },
    async readText(_owner, path) {
      const value = files.get(path)
      if (!value) throw new Error('missing')
      return { content: value.content, size: value.content.length, truncated: false, revision: { value: value.revision, size: value.content.length } }
    },
    async createText() { throw new Error('not used') },
    async rename() { throw new Error('not used') },
    async remove() { throw new Error('not used') },
    async writeText(_owner, path, content, expectedRevision) {
      const value = files.get(path)
      if (!value) return { status: 'missing' as const }
      if (value.revision !== expectedRevision.value) {
        return { status: 'conflict' as const, current: { content: value.content, size: value.content.length, truncated: false, revision: { value: value.revision, size: value.content.length } } }
      }
      value.content = content
      value.revision = 'r3'
      return { status: 'saved' as const, revision: { value: value.revision, size: content.length } }
    },
  }
  const service = createProjectFileService(adapter)
  const [resource] = await service.list('project_1')
  const changes: any[] = []
  service.onDidChange(change => changes.push(change))

  const result = await service.writeText(resource, '# local', { value: 'r1', size: 5 })

  assert.equal(result.status, 'conflict')
  assert.equal(changes.length, 0)
})

test('conditional text write publishes its new revision after a successful save', async () => {
  const adapter = createAdapter()
  adapter.writeText = async (_owner, _path, content) => ({
    status: 'saved' as const,
    revision: { value: 'after-save', size: content.length },
  })
  const service = createProjectFileService(adapter)
  const [resource] = await service.list('project_1')
  const changes: any[] = []
  service.onDidChange(change => changes.push(change))

  const result = await service.writeText(resource, '# updated', { value: 'before-save', size: 5 })

  assert.equal(result.status, 'saved')
  assert.equal(result.revision.value, 'after-save')
  assert.equal(changes.length, 1)
  assert.equal(changes[0].type, 'changed')
  assert.equal(changes[0].revision.value, 'after-save')
})

test('service serializes a save and delete for the same owner', async () => {
  const adapter = createAdapter()
  let releaseWrite!: () => void
  const writeGate = new Promise<void>(resolve => { releaseWrite = resolve })
  const calls: string[] = []
  adapter.writeText = async () => {
    calls.push('write:start')
    await writeGate
    calls.push('write:end')
    return { status: 'saved' as const, revision: { value: 'r2', size: 1 } }
  }
  const originalRemove = adapter.remove
  adapter.remove = async (owner, path) => {
    calls.push('remove')
    await originalRemove(owner, path)
  }
  const service = createProjectFileService(adapter)
  const [resource] = await service.list('project_1')

  const save = service.writeText(resource, 'x', { value: 'r1', size: 1 })
  const remove = service.remove(resource)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(calls, ['write:start'])
  releaseWrite()
  await Promise.all([save, remove])
  assert.deepEqual(calls, ['write:start', 'write:end', 'remove'])
})

test('separate service instances serialize mutations for the same runtime owner', async () => {
  const adapter = createAdapter()
  let releaseWrite!: () => void
  const writeGate = new Promise<void>(resolve => { releaseWrite = resolve })
  const calls: string[] = []
  adapter.writeText = async () => {
    calls.push('write:start')
    await writeGate
    calls.push('write:end')
    return { status: 'saved' as const, revision: { value: 'r2', size: 1 } }
  }
  const originalRemove = adapter.remove
  adapter.remove = async (owner, path) => {
    calls.push('remove')
    await originalRemove(owner, path)
  }
  const editorService = createProjectFileService(adapter)
  const treeService = createProjectFileService(adapter)
  const [resource] = await editorService.list('project_1')

  const save = editorService.writeText(resource, 'x', { value: 'r1', size: 1 })
  const remove = treeService.remove(resource)
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(calls, ['write:start'])
  releaseWrite()
  await Promise.all([save, remove])
  assert.deepEqual(calls, ['write:start', 'write:end', 'remove'])
})

test('renaming a directory publishes every descendant resource in one batch', async () => {
  const files = new Map([
    ['docs', { id: 'folder_1', content: '', mimeType: 'folder', isDirectory: true }],
    ['docs/one.md', { id: 'file_1', content: '# one', mimeType: 'text/markdown', isDirectory: false }],
  ])
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() { return [...files].map(([path, value]) => ({ path, ...value })) },
    async readText() { throw new Error('not used') },
    async createText() { throw new Error('not used') },
    async rename(_owner, oldPath, newPath) {
      for (const [path, value] of [...files]) {
        if (path === oldPath || path.startsWith(`${oldPath}/`)) {
          files.delete(path)
          files.set(`${newPath}${path.slice(oldPath.length)}`, value)
        }
      }
      return { path: newPath, ...files.get(newPath)! }
    },
    async remove() { throw new Error('not used') },
  }
  const service = createProjectFileService(adapter)
  const changes: any[] = []
  service.onDidChange(change => changes.push(change))
  const [folder] = await service.list('project_1')

  await service.rename(folder, 'notes')

  assert.equal(changes.length, 1)
  assert.equal(changes[0].type, 'batch')
  assert.deepEqual(flattenProjectResourceChange(changes[0]).map(change => [change.type === 'renamed' ? change.oldResource.path : '', change.resource.path]), [
    ['docs', 'notes'],
    ['docs/one.md', 'notes/one.md'],
  ])
})

test('deleting a directory publishes every descendant resource in one batch', async () => {
  const files = new Map([
    ['docs', { id: 'folder_1', content: '', mimeType: 'folder', isDirectory: true }],
    ['docs/one.md', { id: 'file_1', content: '# one', mimeType: 'text/markdown', isDirectory: false }],
  ])
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() { return [...files].map(([path, value]) => ({ path, ...value })) },
    async readText() { throw new Error('not used') },
    async createText() { throw new Error('not used') },
    async rename() { throw new Error('not used') },
    async remove(_owner, path) {
      for (const key of [...files.keys()]) if (key === path || key.startsWith(`${path}/`)) files.delete(key)
    },
  }
  const service = createProjectFileService(adapter)
  const changes: any[] = []
  service.onDidChange(change => changes.push(change))
  const [folder] = await service.list('project_1')

  await service.remove(folder)

  assert.equal(changes.length, 1)
  assert.equal(changes[0].type, 'batch')
  assert.deepEqual(flattenProjectResourceChange(changes[0]).map(change => change.resource.path), ['docs', 'docs/one.md'])
})

test('directory mutation snapshots all descendants through the adapter-specific complete listing', async () => {
  const descendants = Array.from({ length: 1_001 }, (_, index) => ({
    path: `docs/note-${index}.md`, id: `file_${index}`, content: '', mimeType: 'text/markdown', isDirectory: false,
  }))
  const adapter: ProjectFileAdapter = {
    runtime: 'desktop',
    async list() { return [{ path: 'docs', isDirectory: true }] },
    async listDescendants() { return descendants },
    async readText() { throw new Error('not used') },
    async createText() { throw new Error('not used') },
    async rename(_owner, _oldPath, newPath) { return { path: newPath, isDirectory: true } },
    async remove() { throw new Error('not used') },
  }
  const service = createProjectFileService(adapter)
  const changes: any[] = []
  service.onDidChange(change => changes.push(change))
  const [folder] = await service.list('/project')

  await service.rename(folder, 'notes')

  assert.equal(changes[0].type, 'batch')
  assert.equal(flattenProjectResourceChange(changes[0]).length, 1_002)
  assert.equal(flattenProjectResourceChange(changes[0]).at(-1)?.resource.path, 'notes/note-1000.md')
})

test('renaming a folder with a media extension keeps it binary', async () => {
  const adapter: ProjectFileAdapter = {
    runtime: 'desktop',
    async list() { return [{ path: 'assets', isDirectory: true }] },
    async readText() { throw new Error('not used') },
    async createText() { throw new Error('not used') },
    async rename(_owner, _oldPath, newPath) { return { path: newPath, isDirectory: true } },
    async remove() { throw new Error('not used') },
  }
  const service = createProjectFileService(adapter)
  const [folder] = await service.list('/project')
  const changes: any[] = []
  service.onDidChange(change => changes.push(change))

  const renamed = await service.rename(folder, 'assets.mp3')

  assert.equal(renamed.kind, 'binary')
  assert.equal(flattenProjectResourceChange(changes[0])[0].resource.kind, 'binary')
})
