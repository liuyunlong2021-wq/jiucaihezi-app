import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createProjectFileActions } from '../projectFileActions'
import { createProjectFileService, type ProjectFileAdapter } from '../projectFileService'

test('shared canvas creation creates a project resource and publishes one event', async () => {
  const files = new Map<string, string>()
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() {
      return [...files].map(([path, content]) => ({ path, isDirectory: false, content, size: content.length, mimeType: 'application/json' }))
    },
    async readText(_owner, path) {
      const content = files.get(path)
      if (content === undefined) throw new Error('missing')
      return { content, size: content.length, truncated: false, revision: { value: `r:${content}`, size: content.length } }
    },
    async createText(_owner, path, content) {
      files.set(path, content)
      return { path, isDirectory: false, content, size: content.length, mimeType: 'application/json' }
    },
    async rename() { throw new Error('not used') },
    async remove() { throw new Error('not used') },
  }
  const service = createProjectFileService(adapter)
  const actions = createProjectFileActions(service)
  const changes: any[] = []
  service.onDidChange(change => changes.push(change))

  const result = await actions.createCanvas({ owner: 'project_1' })

  assert.equal(result.resource.path, 'jc-canvas/未命名画布.jccanvas')
  assert.equal(result.document.canvasId.length > 0, true)
  assert.equal(JSON.parse(files.get(result.resource.path)!).canvasId, result.document.canvasId)
  assert.equal(changes.length, 1)
  assert.equal(changes[0].type, 'created')
})

test('shared canvas creation accepts an explicit safe project path', async () => {
  const files = new Map<string, string>()
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() { return [...files].map(([path, content]) => ({ path, isDirectory: false, content, size: content.length, mimeType: 'application/json' })) },
    async readText(_owner, path) {
      const content = files.get(path)
      if (content === undefined) throw new Error('missing')
      return { content, size: content.length, truncated: false, revision: { value: `r:${content}`, size: content.length } }
    },
    async createText(_owner, path, content) {
      files.set(path, content)
      return { path, isDirectory: false, content, size: content.length, mimeType: 'application/json' }
    },
    async rename() { throw new Error('not used') },
    async remove() { throw new Error('not used') },
  }
  const actions = createProjectFileActions(createProjectFileService(adapter))
  const document = { version: 3 as const, canvasId: 'custom', updatedAt: 1, viewport: { x: 0, y: 0, zoom: 1 }, scene: [], assets: {} }

  const result = await actions.createCanvasAtPath({ owner: 'project_1', path: 'jc-canvas/custom.jccanvas', document })

  assert.equal(result.resource.path, 'jc-canvas/custom.jccanvas')
  assert.equal(JSON.parse(files.get(result.resource.path)!).canvasId, 'custom')
})

test('shared media import creates a media resource under the project media directory', async () => {
  const files = new Map<string, Uint8Array>()
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() { return [...files].map(([path, data]) => ({ path, isDirectory: false, size: data.byteLength, mimeType: 'audio/mpeg' })) },
    async readText() { throw new Error('not used') },
    async createText() { throw new Error('not used') },
    async rename() { throw new Error('not used') },
    async remove() { throw new Error('not used') },
    async importBinary(_owner, path, data, mimeType) {
      files.set(path, data)
      return { path, isDirectory: false, size: data.byteLength, mimeType }
    },
  }
  const actions = createProjectFileActions(createProjectFileService(adapter))

  const resource = await actions.importMedia({
    owner: 'project_1',
    path: 'jc-media/audios/imported.mp3',
    data: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/mpeg',
  })

  assert.equal(resource.path, 'jc-media/audios/imported.mp3')
  assert.equal(resource.kind, 'media')
  assert.deepEqual(files.get(resource.path), new Uint8Array([1, 2, 3]))
})

test('shared media read returns binary data only for a project media resource', async () => {
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() { return [{ path: 'jc-media/images/poster.png', isDirectory: false, mimeType: 'image/png', size: 3 }] },
    async readText() { throw new Error('not used') }, async createText() { throw new Error('not used') },
    async rename() { throw new Error('not used') }, async remove() { throw new Error('not used') },
    async readBinary() { return { data: new Uint8Array([7, 8, 9]), size: 3, mimeType: 'image/png' } },
  }
  const actions = createProjectFileActions(createProjectFileService(adapter))

  const result = await actions.readMedia({ runtime: 'web', owner: 'project_1', path: 'jc-media/images/poster.png', name: 'poster.png', isDirectory: false, kind: 'media', mimeType: 'image/png' })

  assert.deepEqual(result.data, new Uint8Array([7, 8, 9]))
  assert.equal(result.mimeType, 'image/png')
})

test('shared media submission URL encodes only the resource bytes', async () => {
  const adapter: ProjectFileAdapter = {
    runtime: 'web', async list() { return [] }, async readText() { throw new Error('not used') },
    async createText() { throw new Error('not used') }, async rename() { throw new Error('not used') }, async remove() { throw new Error('not used') },
    async readBinary() { return { data: new Uint8Array([65, 66]), size: 2, mimeType: 'audio/mpeg' } },
  }
  const actions = createProjectFileActions(createProjectFileService(adapter))

  const url = await actions.readMediaDataUrl({ runtime: 'web', owner: 'project_1', path: 'jc-media/audios/a.mp3', name: 'a.mp3', isDirectory: false, kind: 'media' })

  assert.equal(url, 'data:audio/mpeg;base64,QUI=')
})

test('shared export rejects resources from different projects before platform export begins', async () => {
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() { return [] }, async readText() { throw new Error('not used') }, async createText() { throw new Error('not used') },
    async rename() { throw new Error('not used') }, async remove() { throw new Error('not used') },
  }
  const actions = createProjectFileActions(createProjectFileService(adapter))
  let called = false

  await assert.rejects(() => actions.exportResources({
    resources: [
      { runtime: 'web', owner: 'project_a', path: 'one.md', name: 'one.md', isDirectory: false, kind: 'document' },
      { runtime: 'web', owner: 'project_b', path: 'two.md', name: 'two.md', isDirectory: false, kind: 'document' },
    ],
    export: async () => { called = true },
  }), /同一项目/)

  assert.equal(called, false)
})

test('Desktop external paths become created project resources through the shared action', async () => {
  const adapter = {
    runtime: 'desktop' as const,
    async list() { return [] },
    async readText() { throw new Error('not used') },
    async createText() { throw new Error('not used') },
    async rename() { throw new Error('not used') },
    async remove() { throw new Error('not used') },
    async importExternalFiles(_owner: string, paths: string[], targetPath: string) {
      assert.deepEqual(paths, ['/Users/by3/Desktop/reference.pdf'])
      assert.equal(targetPath, 'jc-imports')
      return [{ path: 'jc-imports/reference.pdf', isDirectory: false, size: 3, mimeType: 'application/pdf' }]
    },
  } satisfies ProjectFileAdapter & { importExternalFiles(owner: string, paths: string[], targetPath: string): Promise<Array<{ path: string; isDirectory: boolean; size: number; mimeType: string }>> }
  const service = createProjectFileService(adapter)
  const changes: any[] = []
  service.onDidChange(change => changes.push(change))

  const resources = await (createProjectFileActions(service) as any).importDesktopPaths({
    owner: '/Users/by3/Documents/project',
    paths: ['/Users/by3/Desktop/reference.pdf'],
    targetPath: 'jc-imports',
  })

  assert.equal(resources[0].path, 'jc-imports/reference.pdf')
  assert.equal(resources[0].kind, 'binary')
  assert.equal(changes.length, 1)
  assert.equal(changes[0].type, 'created')
})
