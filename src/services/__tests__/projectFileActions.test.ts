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

test('oversized Base64 canvas is backed up and repaired without raising the normal read limit', async () => {
  const raw = JSON.stringify({
    version: 3,
    canvasId: 'recovered',
    updatedAt: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    scene: [
      {
        tag: 'Group',
        id: 'image-one',
        x: 10,
        y: 20,
        children: [
          { tag: 'Image', name: 'canvas-image', url: `data:image/png;base64,${'A'.repeat(200)}` },
          { tag: 'Text', assetId: 'image-one', text: '1' },
        ],
      },
    ],
    assets: {
      'image-one': {
        id: 'image-one',
        kind: 'image',
        resource: { path: 'jc-media/images/one.png' },
        source: 'import',
        createdAt: 1,
      },
    },
  })
  const path = 'jc-canvas/large.jccanvas'
  const files = new Map([[path, raw]])
  const readLimits: Array<number | undefined> = []
  const adapter: ProjectFileAdapter = {
    runtime: 'desktop',
    async list() {
      return [{ path, isDirectory: false, size: raw.length, mimeType: 'application/json' }]
    },
    async readText(_owner, requestedPath, maxBytes) {
      readLimits.push(maxBytes)
      const content = files.get(requestedPath)
      if (content === undefined) throw new Error('missing')
      return {
        content: maxBytes === 30_000_000 ? '' : content,
        size: content.length,
        truncated: maxBytes === 30_000_000,
        revision: { value: 'r1', size: content.length },
      }
    },
    async writeText(_owner, requestedPath, content) {
      files.set(requestedPath, content)
      return { status: 'saved', revision: { value: 'r2', size: content.length } }
    },
    async createText(_owner, requestedPath, content) {
      files.set(requestedPath, content)
      return {
        path: requestedPath,
        isDirectory: false,
        size: content.length,
        mimeType: 'application/json',
      }
    },
    async rename() {
      throw new Error('not used')
    },
    async remove() {
      throw new Error('not used')
    },
  }
  const actions = createProjectFileActions(createProjectFileService(adapter))
  const [resource] = await actions.listCanvases('/project')

  const result = await actions.openCanvas(resource)
  const repaired = files.get(path) || ''
  const backup = [...files].find(([name]) => name.startsWith(`${path}.base64-leak-backup-`))

  assert.deepEqual(readLimits, [30_000_000, 200_000_000])
  assert.equal(backup?.[1], raw)
  assert.equal(repaired.includes('base64'), false)
  assert.equal(result.document.scene[0].children?.[1].text, '1')
  assert.equal(result.document.assets['image-one'].resource.path, 'jc-media/images/one.png')
})

function oversizedCanvasAdapter(
  options: {
    runtime?: 'desktop' | 'web'
    recoveryContent?: string
    recoveryTruncated?: boolean
    backupError?: Error
    writeStatus?: 'saved' | 'conflict'
  } = {},
) {
  const path = 'jc-canvas/recovery.jccanvas'
  const valid = JSON.stringify({
    version: 3,
    canvasId: 'recovery',
    updatedAt: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    scene: [{ tag: 'Image', id: 'image-one', url: 'data:image/png;base64,AAAA' }],
    assets: {
      'image-one': {
        id: 'image-one',
        kind: 'image',
        resource: { path: 'jc-media/images/one.png' },
        source: 'import',
        createdAt: 1,
      },
    },
  })
  const reads: Array<number | undefined> = []
  let backupCreated = false
  let writeCalled = false
  const adapter: ProjectFileAdapter = {
    runtime: options.runtime || 'desktop',
    async list() {
      return [{ path, isDirectory: false, size: valid.length, mimeType: 'application/json' }]
    },
    async readText(_owner, _path, maxBytes) {
      reads.push(maxBytes)
      if (maxBytes === 30_000_000)
        return {
          content: '',
          size: valid.length,
          truncated: true,
          revision: { value: 'r1', size: valid.length },
        }
      const content = options.recoveryContent ?? valid
      return {
        content,
        size: content.length,
        truncated: options.recoveryTruncated || false,
        revision: { value: 'r1', size: content.length },
      }
    },
    async writeText(_owner, _path, content) {
      writeCalled = true
      const status = options.writeStatus || 'saved'
      return status === 'saved'
        ? { status, revision: { value: 'r2', size: content.length } }
        : {
            status,
            current: {
              content: valid,
              size: valid.length,
              truncated: false,
              revision: { value: 'r2', size: valid.length },
            },
          }
    },
    async createText(_owner, requestedPath, content) {
      if (options.backupError) throw options.backupError
      backupCreated = true
      return {
        path: requestedPath,
        isDirectory: false,
        size: content.length,
        mimeType: 'application/json',
      }
    },
    async rename() {
      throw new Error('not used')
    },
    async remove() {
      throw new Error('not used')
    },
  }
  return {
    actions: createProjectFileActions(createProjectFileService(adapter)),
    reads,
    backupCreated: () => backupCreated,
    writeCalled: () => writeCalled,
  }
}

test('Web refuses an oversized canvas without a second unbounded read', async () => {
  const fixture = oversizedCanvasAdapter({ runtime: 'web' })
  const [resource] = await fixture.actions.listCanvases('/project')

  await assert.rejects(() => fixture.actions.openCanvas(resource), /超过 30 MB/)

  assert.deepEqual(fixture.reads, [30_000_000])
  assert.equal(fixture.backupCreated(), false)
  assert.equal(fixture.writeCalled(), false)
})

test('oversized canvas recovery refuses a read still truncated at 200 MB', async () => {
  const fixture = oversizedCanvasAdapter({ recoveryTruncated: true })
  const [resource] = await fixture.actions.listCanvases('/project')

  await assert.rejects(() => fixture.actions.openCanvas(resource), /无法安全读取/)

  assert.equal(fixture.backupCreated(), false)
  assert.equal(fixture.writeCalled(), false)
})

test('oversized canvas recovery refuses invalid JSON before backup', async () => {
  const fixture = oversizedCanvasAdapter({ recoveryContent: '{"url":"data:image/png;base64,AAAA"' })
  const [resource] = await fixture.actions.listCanvases('/project')

  await assert.rejects(() => fixture.actions.openCanvas(resource), /画布文件格式无效/)

  assert.equal(fixture.backupCreated(), false)
  assert.equal(fixture.writeCalled(), false)
})

test('oversized canvas recovery refuses content that normalization cannot remove', async () => {
  const fixture = oversizedCanvasAdapter({
    recoveryContent: JSON.stringify({
      version: 3,
      canvasId: 'unsafe',
      updatedAt: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      scene: [{ tag: 'Text', id: 'note', text: 'data:image/png;base64,AAAA' }],
      assets: {},
    }),
  })
  const [resource] = await fixture.actions.listCanvases('/project')

  await assert.rejects(() => fixture.actions.openCanvas(resource), /无法安全修复/)

  assert.equal(fixture.backupCreated(), false)
  assert.equal(fixture.writeCalled(), false)
})

test('oversized canvas recovery refuses a normalized document still at least 30 MB', async () => {
  const fixture = oversizedCanvasAdapter({
    recoveryContent: JSON.stringify({
      version: 3,
      canvasId: 'still-large',
      updatedAt: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
      scene: [
        { tag: 'Image', id: 'image-one', url: 'data:image/png;base64,AAAA' },
        { tag: 'Text', id: 'large-note', text: 'x'.repeat(30_000_000) },
      ],
      assets: {
        'image-one': {
          id: 'image-one',
          kind: 'image',
          resource: { path: 'jc-media/images/one.png' },
          source: 'import',
          createdAt: 1,
        },
      },
    }),
  })
  const [resource] = await fixture.actions.listCanvases('/project')

  await assert.rejects(() => fixture.actions.openCanvas(resource), /无法安全修复/)

  assert.equal(fixture.backupCreated(), false)
  assert.equal(fixture.writeCalled(), false)
})

test('oversized canvas recovery never rewrites when backup creation fails', async () => {
  const fixture = oversizedCanvasAdapter({ backupError: new Error('disk full') })
  const [resource] = await fixture.actions.listCanvases('/project')

  await assert.rejects(() => fixture.actions.openCanvas(resource), /disk full/)

  assert.equal(fixture.writeCalled(), false)
})

test('oversized canvas recovery preserves the backup and reports a write conflict', async () => {
  const fixture = oversizedCanvasAdapter({ writeStatus: 'conflict' })
  const [resource] = await fixture.actions.listCanvases('/project')

  await assert.rejects(() => fixture.actions.openCanvas(resource), /外部修改/)

  assert.equal(fixture.backupCreated(), true)
  assert.equal(fixture.writeCalled(), true)
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

test('memory media import accepts the protected raw media directory', async () => {
  const files = new Map<string, Uint8Array>()
  const adapter: ProjectFileAdapter = {
    runtime: 'desktop',
    async list() { return [...files].map(([path, data]) => ({ path, isDirectory: false, size: data.byteLength, mimeType: 'image/png' })) },
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
    owner: '/tmp/project',
    path: '.raw/jc-media/图片/generated.png',
    data: new Uint8Array([4, 5, 6]),
    mimeType: 'image/png',
  })

  assert.equal(resource.path, '.raw/jc-media/图片/generated.png')
  assert.deepEqual(files.get(resource.path), new Uint8Array([4, 5, 6]))

  await assert.rejects(() => actions.importMedia({
    owner: '/tmp/project',
    path: '.raw/jc-media/文档/wrong.png',
    data: new Uint8Array([7]),
    mimeType: 'image/png',
  }), /必须按图片、视频、音频或文档分类/)
  await assert.rejects(() => actions.importMedia({
    owner: '/tmp/project',
    path: '.raw/jc-media/generated/wrong.png',
    data: new Uint8Array([8]),
    mimeType: 'image/png',
  }), /必须按图片、视频、音频或文档分类/)
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

test('shared media read accepts an image stored anywhere in the project', async () => {
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() { return [{ path: '152/152-1.jpg', isDirectory: false, mimeType: 'image/jpeg', size: 3 }] },
    async readText() { throw new Error('not used') }, async createText() { throw new Error('not used') },
    async rename() { throw new Error('not used') }, async remove() { throw new Error('not used') },
    async readBinary() { return { data: new Uint8Array([7, 8, 9]), size: 3, mimeType: 'image/jpeg' } },
  }
  const actions = createProjectFileActions(createProjectFileService(adapter))

  const result = await actions.readMedia({ runtime: 'web', owner: 'project_1', path: '152/152-1.jpg', name: '152-1.jpg', isDirectory: false, kind: 'media', mimeType: 'image/jpeg' })

  assert.deepEqual(result.data, new Uint8Array([7, 8, 9]))
  assert.equal(result.mimeType, 'image/jpeg')
})

test('shared media submission URL encodes a project image outside jc-media', async () => {
  const adapter: ProjectFileAdapter = {
    runtime: 'web', async list() { return [] }, async readText() { throw new Error('not used') },
    async createText() { throw new Error('not used') }, async rename() { throw new Error('not used') }, async remove() { throw new Error('not used') },
    async readBinary() { return { data: new Uint8Array([65, 66]), size: 2, mimeType: 'audio/mpeg' } },
  }
  const actions = createProjectFileActions(createProjectFileService(adapter))

  const url = await actions.readMediaDataUrl({ runtime: 'web', owner: 'project_1', path: '152/152-1.jpg', name: '152-1.jpg', isDirectory: false, kind: 'media' })

  assert.equal(url, 'data:audio/mpeg;base64,QUI=')
})

test('shared media submission restores image MIME when Desktop binary reads return bytes only', async () => {
  const adapter: ProjectFileAdapter = {
    runtime: 'desktop', async list() { return [] }, async readText() { throw new Error('not used') },
    async createText() { throw new Error('not used') }, async rename() { throw new Error('not used') }, async remove() { throw new Error('not used') },
    async readBinary() { return { data: new Uint8Array([65, 66]), size: 2 } },
  }
  const actions = createProjectFileActions(createProjectFileService(adapter))

  const url = await actions.readMediaDataUrl({
    runtime: 'desktop', owner: '/project', path: 'jc-media/uploads/reference.jpg',
    name: 'reference.jpg', isDirectory: false, kind: 'media',
  })

  assert.equal(url, 'data:image/jpeg;base64,QUI=')
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
