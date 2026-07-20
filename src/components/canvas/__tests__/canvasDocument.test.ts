import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import type { FileEntry } from '@/composables/useFileStore'
import type { CanvasSceneNode } from '@/types/canvas'
import { useProjectStore } from '@/stores/projectStore'
import * as eventBus from '@/utils/eventBus'
import { webProjectFiles, webProjectTextRevision } from '@/utils/webProjectFiles'
import {
  canvasDocumentRelativePath,
  canvasDocumentTemporaryPath,
  canvasFilePath,
  copyCanvasDocument,
  createCanvasDocument,
  isCanvasPath,
  migrateCanvasDocument,
  nextCanvasFileName,
  parseCanvasDocument,
  unreferencedCanvasAssetIds,
} from '../canvasDocument'
import {
  applyCanvasTaskResult,
  copyCanvasFile,
  createCanvasFile,
  createCanvasSaveQueue,
  deleteCanvasFile,
  listCanvasFiles,
  renameCanvasFile,
  restoreCanvas,
  restoreCanvasAtPath,
  saveCanvas,
  writeCanvasTaskResult,
} from '../canvasPersistence'

const root = process.cwd()

type AsyncEventEmitter = (event: string, ...args: unknown[]) => Promise<void>

function emitCanvasLifecycleEvent(event: string, ...args: unknown[]): Promise<void> {
  const emitter = (eventBus as typeof eventBus & { emitEventAsync?: AsyncEventEmitter }).emitEventAsync
  if (!emitter) throw new Error('emitEventAsync is unavailable')
  return emitter(event, ...args)
}

interface WebCanvasFileStore {
  calls: Array<{ operation: string; projectId: string; path: string }>
  get(projectId: string, path: string): string | undefined
  set(projectId: string, path: string, content: string): void
  restore(): void
}

function installWebCanvasFileStore(): WebCanvasFileStore {
  const contents = new Map<string, Map<string, string>>()
  const calls: Array<{ operation: string; projectId: string; path: string }> = []
  const originalWrite = webProjectFiles.write
  const originalWriteIfRevision = webProjectFiles.writeIfRevision
  const originalCreateText = webProjectFiles.createText
  const originalRead = webProjectFiles.read
  const originalList = webProjectFiles.list
  const originalRename = webProjectFiles.rename
  const originalRemove = webProjectFiles.remove

  function projectContents(projectId: string): Map<string, string> {
    let files = contents.get(projectId)
    if (!files) {
      files = new Map()
      contents.set(projectId, files)
    }
    return files
  }

  const revisions = new Map<string, number>()

  function key(projectId: string, path: string): string {
    return `${projectId}:${path}`
  }

  function entry(projectId: string, path: string, content: string): FileEntry {
    return {
      id: `test:${projectId}:${path}`,
      category: 'text',
      name: path.split('/').pop() || path,
      content,
      mimeType: 'text/plain',
      size: new TextEncoder().encode(content).byteLength,
      createdAt: 1,
      updatedAt: revisions.get(key(projectId, path)) || 1,
      metadata: { kind: 'project-file', projectId, relativePath: path },
    }
  }

  webProjectFiles.write = async (projectId, path, content) => {
    calls.push({ operation: 'write', projectId, path })
    revisions.set(key(projectId, path), (revisions.get(key(projectId, path)) || 0) + 1)
    projectContents(projectId).set(path, content)
    return entry(projectId, path, content)
  }
  webProjectFiles.createText = async (projectId, path, content) => {
    if (projectContents(projectId).has(path)) throw new Error(`文件已存在: ${path}`)
    return await webProjectFiles.write(projectId, path, content)
  }
  webProjectFiles.writeIfRevision = async (projectId, path, content, expectedRevision) => {
    const existing = projectContents(projectId).get(path)
    if (existing === undefined) return { status: 'missing' as const }
    const previous = entry(projectId, path, existing)
    const revision = webProjectTextRevision(previous)
    if (revision !== expectedRevision) return { status: 'conflict' as const, entry: previous, revision }
    const next = await webProjectFiles.write(projectId, path, content)
    return { status: 'saved' as const, entry: next, revision: webProjectTextRevision(next) }
  }
  webProjectFiles.read = async (projectId, path) => {
    calls.push({ operation: 'read', projectId, path })
    const content = contents.get(projectId)?.get(path)
    if (content === undefined) throw new Error(`文件不存在: ${path}`)
    return entry(projectId, path, content)
  }
  webProjectFiles.list = async projectId => {
    calls.push({ operation: 'list', projectId, path: '' })
    return [...projectContents(projectId).entries()].map(([path, content]) => ({
      id: `test:${projectId}:${path}`,
      path,
      isDir: false,
      size: new TextEncoder().encode(content).byteLength,
      mimeType: 'text/plain',
      content,
    }))
  }
  webProjectFiles.rename = async (projectId, path, newName) => {
    calls.push({ operation: 'rename', projectId, path })
    const files = projectContents(projectId)
    const content = files.get(path)
    if (content === undefined) throw new Error(`文件不存在: ${path}`)
    const parent = path.split('/').slice(0, -1).join('/')
    const nextPath = parent ? `${parent}/${newName}` : newName
    files.delete(path)
    files.set(nextPath, content)
    return entry(projectId, nextPath, content)
  }
  webProjectFiles.remove = async (projectId, path) => {
    calls.push({ operation: 'remove', projectId, path })
    const files = projectContents(projectId)
    if (!files.delete(path)) throw new Error(`文件不存在: ${path}`)
  }

  return {
    calls,
    get(projectId, path) { return contents.get(projectId)?.get(path) },
    set(projectId, path, content) {
      revisions.set(key(projectId, path), (revisions.get(key(projectId, path)) || 0) + 1)
      projectContents(projectId).set(path, content)
    },
    restore() {
      webProjectFiles.write = originalWrite
      webProjectFiles.writeIfRevision = originalWriteIfRevision
      webProjectFiles.createText = originalCreateText
      webProjectFiles.read = originalRead
      webProjectFiles.list = originalList
      webProjectFiles.rename = originalRename
      webProjectFiles.remove = originalRemove
    },
  }
}

interface TauriCanvasFileStore {
  calls: Array<{ command: string; root: string; path: string }>
  get(root: string, path: string): string | undefined
  set(root: string, path: string, content: string): void
  restore(): void
}

function installTauriCanvasFileStore(
  beforeInvoke?: (command: string, input: Record<string, string>) => void | Promise<void>,
): TauriCanvasFileStore {
  const contents = new Map<string, Map<string, string>>()
  const revisions = new Map<string, number>()
  const calls: Array<{ command: string; root: string; path: string }> = []
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

  function projectContents(root: string): Map<string, string> {
    let files = contents.get(root)
    if (!files) {
      files = new Map()
      contents.set(root, files)
    }
    return files
  }

  function revision(root: string, path: string, content: string) {
    const version = revisions.get(`${root}:${path}`) || 1
    return { value: `r:${version}`, size: new TextEncoder().encode(content).byteLength, updatedAt: version }
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      isTauri: true,
      __TAURI_INTERNALS__: {
        async invoke(command: string, args: { input?: Record<string, string> }) {
          const input = args.input || {}
          await beforeInvoke?.(command, input)
          const root = input.root || ''
          const path = input.relativePath || input.targetRelativePath || input.oldRelativePath || ''
          calls.push({ command, root, path })
          const files = projectContents(root)

          if (command === 'dev_read_file') {
            const content = files.get(input.relativePath || '')
            if (content === undefined) throw new Error(`文件不存在: ${input.relativePath}`)
            return {
              content,
              base64: Buffer.from(content).toString('base64'),
              size: new TextEncoder().encode(content).byteLength,
              truncated: false,
              revision: revision(root, input.relativePath || '', content),
            }
          }
          if (command === 'dev_list_files') {
            return [...files].map(([path, content]) => ({ path, isDir: false, size: new TextEncoder().encode(content).byteLength, mimeType: 'application/json' }))
          }
          if (command === 'dev_create_file_if_missing') {
            const relativePath = input.relativePath || ''
            if (files.has(relativePath)) throw new Error(`文件已存在: ${relativePath}`)
            revisions.set(`${root}:${relativePath}`, 1)
            files.set(relativePath, input.content || '')
            return
          }
          if (command === 'dev_write_file_if_revision') {
            const relativePath = input.relativePath || ''
            const previous = files.get(relativePath)
            if (previous === undefined) return { status: 'missing' }
            const current = revision(root, relativePath, previous)
            if (input.expectedRevision !== current.value) return { status: 'conflict' }
            const next = input.content || ''
            revisions.set(`${root}:${relativePath}`, (revisions.get(`${root}:${relativePath}`) || 1) + 1)
            files.set(relativePath, next)
            return { status: 'saved', revision: revision(root, relativePath, next) }
          }
          if (command === 'dev_rename_file') {
            const content = files.get(input.oldRelativePath || '')
            if (content === undefined) throw new Error(`文件不存在: ${input.oldRelativePath}`)
            files.delete(input.oldRelativePath || '')
            files.set(input.newRelativePath || '', content)
            revisions.set(`${root}:${input.newRelativePath || ''}`, revisions.get(`${root}:${input.oldRelativePath || ''}`) || 1)
            return input.newRelativePath || ''
          }
          if (command === 'dev_delete_file') {
            if (!files.delete(input.relativePath || '')) throw new Error(`文件不存在: ${input.relativePath}`)
            return
          }
          throw new Error(`unexpected Tauri command: ${command}`)
        },
      },
    },
  })

  return {
    calls,
    get(root, path) { return contents.get(root)?.get(path) },
    set(root, path, content) {
      revisions.set(`${root}:${path}`, (revisions.get(`${root}:${path}`) || 0) + 1)
      projectContents(root).set(path, content)
    },
    restore() {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
      else Reflect.deleteProperty(globalThis, 'window')
    },
  }
}

function persistenceDocument(canvasId: string) {
  return createCanvasDocument({ canvasId, updatedAt: 1, scene: [], assets: {} })
}

function hasPersistedAssetPath(document: any, path: string): boolean {
  return Object.values(document.assets || {}).some(
    (asset: any) => asset?.resource?.path === path,
  )
}

test('stores an image path only in the asset map so restore does not request it as a page URL', () => {
  const document = createCanvasDocument({
    canvasId: 'poster-one',
    updatedAt: 1,
    scene: [{ tag: 'Image', id: 'image-one', url: 'data:image/png;base64,AAAA' }],
    assets: {
      'image-one': {
        id: 'image-one',
        kind: 'image',
        path: 'jc-media/images/poster.png',
        source: 'creation',
        createdAt: 1,
      },
    },
  })

  assert.equal(document.version, 3)
  assert.equal('url' in document.scene[0], false)
  assert.equal(document.assets['image-one'].resource.path, 'jc-media/images/poster.png')
  assert.equal(JSON.stringify(document).includes('base64'), false)
})

test('persists audio as a V3 canvas card instead of an image node', () => {
  const document = createCanvasDocument({
    canvasId: 'audio-board',
    updatedAt: 1,
    scene: [{
      tag: 'canvas-audio-card',
      id: 'audio-one',
      assetId: 'audio-one',
      x: 40,
      y: 80,
      width: 320,
      height: 96,
    }],
    assets: {
      'audio-one': {
        id: 'audio-one',
        kind: 'audio',
        path: 'jc-media/audios/voice.mp3',
        source: 'import',
        duration: 12.5,
        createdAt: 1,
      } as any,
    },
  })

  assert.equal(document.version, 3)
  assert.deepEqual(document.assets['audio-one'].resource, { path: 'jc-media/audios/voice.mp3' })
  assert.equal(document.scene[0].tag, 'canvas-audio-card')
  assert.equal(JSON.stringify(document).includes('data:'), false)
})

test('migrates V2 image and video assets into V3 resource references', () => {
  const document = migrateCanvasDocument({
    version: 2,
    canvasId: 'legacy-v2',
    updatedAt: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    scene: [{ tag: 'Group', id: 'video-one', x: 0, y: 0 }],
    assets: {
      'video-one': {
        id: 'video-one', kind: 'video', path: 'jc-media/videos/legacy.mp4', source: 'creation', createdAt: 1,
      },
    },
  })

  assert.equal(document.version, 3)
  assert.deepEqual(document.assets['video-one'].resource, { path: 'jc-media/videos/legacy.mp4' })
  assert.deepEqual(document.scene, [{ tag: 'Group', id: 'video-one', x: 0, y: 0 }])
})

test('assigns stable ids to scene nodes that do not have one', () => {
  const document = createCanvasDocument({
    canvasId: 'poster-one',
    updatedAt: 1,
    scene: [{ tag: 'Group', children: [{ tag: 'Text', text: '标题' }] }],
    assets: {},
    idFactory: () => 'generated-id',
  })

  assert.equal(document.scene[0].id, 'generated-id')
  assert.equal(document.scene[0].children?.[0].id, 'generated-id')
})

test('migrates the legacy image layer document into a V3 scene document', () => {
  const document = migrateCanvasDocument({
    version: 1,
    canvasId: 'default',
    updatedAt: 1,
    viewport: { x: 12, y: 24, zoom: 1.5 },
    layers: [{
      id: 'legacy-image',
      path: 'jc-media/images/legacy.png',
      x: 10,
      y: 20,
      width: 300,
      height: 200,
      label: '旧海报',
      source: 'creation',
      locked: false,
      createdAt: 1,
    }],
    annotations: [],
  })

  assert.equal(document.version, 3)
  assert.equal(document.viewport.zoom, 1.5)
  assert.equal(document.scene[0].id, 'legacy-image')
  assert.equal('url' in document.scene[0], false)
  assert.equal(document.assets['legacy-image'].resource.path, 'jc-media/images/legacy.png')
})

test('migrates a V1 video layer as a V3 video reference node', () => {
  const document = migrateCanvasDocument({
    version: 1,
    canvasId: 'legacy-video',
    updatedAt: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    layers: [{
      id: 'legacy-video', kind: 'video', path: 'jc-media/videos/legacy.mp4', x: 10, y: 20,
      width: 320, height: 180, label: '旧视频', source: 'import', locked: false, createdAt: 1,
    }],
    annotations: [],
  })

  assert.equal(document.assets['legacy-video'].kind, 'video')
  assert.equal(document.scene[0].tag, 'Group')
  assert.equal(document.scene[0].name, 'canvas-video-reference')
})

test('preserves a valid resource revision in a V3 asset reference', () => {
  const document = createCanvasDocument({
    canvasId: 'revision-board', scene: [],
    assets: {
      'image-one': {
        id: 'image-one', kind: 'image', resource: {
          path: 'jc-media/images/poster.png', revision: { value: 'r1', size: 24, updatedAt: 1 },
        }, source: 'import', createdAt: 1,
      },
    },
  })

  assert.deepEqual(document.assets['image-one'].resource.revision, { value: 'r1', size: 24, updatedAt: 1 })
})

test('rejects an invalid persisted resource revision', () => {
  assert.throws(() => createCanvasDocument({
    canvasId: 'invalid-revision', scene: [],
    assets: {
      'image-one': {
        id: 'image-one', kind: 'image', resource: {
          path: 'jc-media/images/poster.png', revision: { value: '', size: -1 },
        }, source: 'import', createdAt: 1,
      },
    },
  }), /画布素材版本无效/)
})

test('identifies deleted assets only when no remaining scene node references them', () => {
  const scene: CanvasSceneNode[] = [
    { tag: 'canvas-audio-card', id: 'audio-card-copy', assetId: 'audio-one' },
    { tag: 'Image', id: 'image-one' },
  ]

  assert.deepEqual(unreferencedCanvasAssetIds(scene, ['audio-one', 'image-one', 'removed-one']), ['removed-one'])
})

test('uses a project canvas file and same-directory temporary file', () => {
  assert.equal(canvasDocumentRelativePath('default'), 'jc-canvas/default.jccanvas')
  assert.equal(canvasDocumentTemporaryPath('default'), 'jc-canvas/default.jccanvas.tmp')
})

test('uses the shared canvas-path predicate', () => {
  assert.equal(isCanvasPath('jc-canvas/example.jccanvas'), true)
})

test('commits canvas project files through shared file actions instead of platform APIs', () => {
  const source = readFileSync(join(root, 'src/components/canvas/canvasPersistence.ts'), 'utf8')

  assert.match(source, /createProjectFileActions/)
  assert.doesNotMatch(source, /dev_write_file_bytes|dev_replace_file|dev_read_file|dev_list_files|dev_rename_file|dev_delete_file/)
  assert.doesNotMatch(source, /webProjectFiles\.(write|read|list|rename|remove)/)
})

test('rejects embedded media paths before writing a canvas document', () => {
  assert.throws(() => createCanvasDocument({
    canvasId: 'poster-one',
    scene: [],
    assets: {
      'image-one': {
        id: 'image-one',
        kind: 'image',
        path: 'data:image/png;base64,AAAA',
        source: 'creation',
        createdAt: 1,
      },
    },
  }), /画布素材必须使用项目相对路径/)
})

test('rejects a damaged canvas document instead of treating it as an empty canvas', () => {
  assert.throws(() => parseCanvasDocument('{not-json'), /画布文件格式无效/)
})

test('serializes saves for the same canvas', async () => {
  const queue = createCanvasSaveQueue()
  const order: string[] = []
  let finishFirst!: () => void
  let markFirstStarted!: () => void
  const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve })
  const first = queue('default', async () => {
    order.push('first:start')
    markFirstStarted()
    await new Promise<void>(resolve => { finishFirst = resolve })
    order.push('first:end')
  })
  const second = queue('default', async () => {
    order.push('second')
  })

  await firstStarted
  assert.deepEqual(order, ['first:start'])
  finishFirst()
  await Promise.all([first, second])

  assert.deepEqual(order, ['first:start', 'first:end', 'second'])
})

test('continues a canvas queue after a failed operation', async () => {
  const queue = createCanvasSaveQueue()
  const order: string[] = []

  await assert.rejects(queue('default', async () => {
    order.push('failed')
    throw new Error('write failed')
  }), /write failed/)
  await queue('default', async () => { order.push('next') })

  assert.deepEqual(order, ['failed', 'next'])
})

test('uses user-visible canvas names as project file paths', () => {
  assert.equal(canvasFilePath('海报方案一'), 'jc-canvas/海报方案一.jccanvas')
  assert.equal(nextCanvasFileName(['未命名画布.jccanvas']), '未命名画布 2.jccanvas')
})

test('copies a canvas scene but gives the copy its own canvas id', () => {
  const source = createCanvasDocument({
    canvasId: 'source',
    updatedAt: 1,
    scene: [{ tag: 'Text', id: 'text-1', text: '海报标题' }],
    assets: {},
  })

  const copy = copyCanvasDocument(source, 'copy-id', 2)

  assert.equal(copy.canvasId, 'copy-id')
  assert.equal(copy.updatedAt, 2)
  assert.deepEqual(copy.scene, source.scene)
})

test('appends a generated result beside the selected canvas media', () => {
  const document = createCanvasDocument({
    canvasId: 'poster', updatedAt: 1,
    scene: [{ tag: 'Image', id: 'image-1', url: 'jc-media/images/original.png', x: 20, y: 10, width: 100, height: 120 }],
    assets: { 'image-1': { id: 'image-1', kind: 'image', path: 'jc-media/images/original.png', source: 'creation', createdAt: 1 } },
  })
  const result = applyCanvasTaskResult(document, {
    canvasId: 'poster', canvasPath: 'jc-canvas/poster.jccanvas', operation: 'append',
    referenceNodeIds: ['image-1'], referenceBounds: { x: 20, y: 10, width: 100, height: 120 },
  }, 'jc-media/images/new.png', 2)

  assert.equal(result.assets['image-1'].resource.path, 'jc-media/images/original.png')
  assert.equal(result.scene.length, 2)
  assert.equal(result.scene[1].url, 'jc-media/images/new.png')
  assert.equal(result.scene[1].x, 144)
})

test('appends a generated video as a reusable static canvas reference node', () => {
  const document = createCanvasDocument({
    canvasId: 'poster', updatedAt: 1, scene: [], assets: {},
  })
  const result = applyCanvasTaskResult(document, {
    canvasId: 'poster', canvasPath: 'jc-canvas/poster.jccanvas', operation: 'append',
    referenceNodeIds: [],
  }, 'jc-media/videos/new.mp4', 2)

  assert.equal(result.scene.length, 1)
  assert.equal(result.scene[0].tag, 'Group')
  assert.equal(result.scene[0].width, 320)
  assert.equal(result.scene[0].height, 180)
  assert.equal(result.assets[String(result.scene[0].id)].kind, 'video')
})

test('Web canvas operations require a selected project', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const document = persistenceDocument('required-project')

  projectStore.webProjectId.value = ''
  try {
    await assert.rejects(() => saveCanvas(document), /请先选择 Web 项目/)
    await assert.rejects(() => restoreCanvasAtPath(canvasDocumentRelativePath(document.canvasId)), /请先选择 Web 项目/)
    await assert.rejects(() => listCanvasFiles(), /请先选择 Web 项目/)
    await assert.rejects(() => createCanvasFile(), /请先选择 Web 项目/)
    await assert.rejects(() => copyCanvasFile('jc-canvas/source.jccanvas'), /请先选择 Web 项目/)
    await assert.rejects(() => renameCanvasFile('jc-canvas/source.jccanvas', 'copy'), /请先选择 Web 项目/)
    await assert.rejects(() => deleteCanvasFile('jc-canvas/source.jccanvas'), /请先选择 Web 项目/)
  } finally {
    projectStore.webProjectId.value = originalProjectId
  }
})

test('Web canvas documents persist as UTF-8 project files isolated by project', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const files = installWebCanvasFileStore()
  const path = 'jc-canvas/shared.jccanvas'

  try {
    projectStore.webProjectId.value = 'project-a'
    await saveCanvas(persistenceDocument('canvas-a'), path)

    projectStore.webProjectId.value = 'project-b'
    await saveCanvas(persistenceDocument('canvas-b'), path)

    const firstRaw = files.get('project-a', path)
    const secondRaw = files.get('project-b', path)
    assert.equal(JSON.parse(firstRaw || '{}').canvasId, 'canvas-a')
    assert.equal(JSON.parse(secondRaw || '{}').canvasId, 'canvas-b')

    projectStore.webProjectId.value = 'project-a'
    const first = await restoreCanvasAtPath(path)
    assert.equal(first.status, 'ready')
    if (first.status !== 'ready') throw new Error('第一项目画布未恢复')
    assert.equal(first.document.canvasId, 'canvas-a')

    projectStore.webProjectId.value = 'project-b'
    const second = await restoreCanvasAtPath(path)
    assert.equal(second.status, 'ready')
    if (second.status !== 'ready') throw new Error('第二项目画布未恢复')
    assert.equal(second.document.canvasId, 'canvas-b')
  } finally {
    files.restore()
    projectStore.webProjectId.value = originalProjectId
  }
})

test('Web canvas restore does not use global localStorage and preserves file errors', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const files = installWebCanvasFileStore()
  let localStorageCalls = 0

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() {
        localStorageCalls += 1
        return JSON.stringify(persistenceDocument('legacy-global-canvas'))
      },
      setItem() { localStorageCalls += 1 },
      removeItem() { localStorageCalls += 1 },
      get length() { localStorageCalls += 1; return 0 },
      key() { localStorageCalls += 1; return null },
    },
  })

  projectStore.webProjectId.value = 'project-a'
  try {
    const missing = await restoreCanvasAtPath('jc-canvas/missing.jccanvas')
    assert.deepEqual(missing, { status: 'missing' })
    assert.equal(localStorageCalls, 0)

    files.set('project-a', 'jc-canvas/damaged.jccanvas', '{not-json')
    const damaged = await restoreCanvasAtPath('jc-canvas/damaged.jccanvas')
    assert.equal(damaged.status, 'error')
    if (damaged.status === 'error') assert.match(damaged.error.message, /画布文件格式无效/)

    const originalRead = webProjectFiles.read
    const oversized: FileEntry = {
      id: 'oversized', category: 'text', name: 'oversized.jccanvas', content: '{}', mimeType: 'text/plain', size: 30_000_001,
      createdAt: 1, updatedAt: 1, metadata: { kind: 'project-file', projectId: 'project-a', relativePath: 'jc-canvas/oversized.jccanvas' },
    }
    files.set('project-a', 'jc-canvas/oversized.jccanvas', '{}')
    webProjectFiles.read = async () => oversized
    try {
      const tooLarge = await restoreCanvasAtPath('jc-canvas/oversized.jccanvas')
      assert.equal(tooLarge.status, 'error')
      if (tooLarge.status === 'error') assert.match(tooLarge.error.message, /30 MB/)
    } finally {
      webProjectFiles.read = originalRead
    }
  } finally {
    files.restore()
    projectStore.webProjectId.value = originalProjectId
    if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('Web canvas file commands stay within the active project', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const files = installWebCanvasFileStore()
  const sourcePath = 'jc-canvas/source.jccanvas'

  projectStore.webProjectId.value = 'project-a'
  files.set('project-a', sourcePath, JSON.stringify(persistenceDocument('source')))
  files.set('project-a', 'jc-canvas/nested/ignored.jccanvas', JSON.stringify(persistenceDocument('ignored')))
  try {
    assert.deepEqual((await listCanvasFiles()).map(file => file.path), [sourcePath])

    const created = await createCanvasFile()
    assert.equal(JSON.parse(files.get('project-a', created.file.path) || '{}').canvasId, created.document.canvasId)

    const copied = await copyCanvasFile(sourcePath)
    assert.notEqual(copied.document.canvasId, 'source')
    assert.equal(JSON.parse(files.get('project-a', copied.file.path) || '{}').canvasId, copied.document.canvasId)

    const renamed = await renameCanvasFile(created.file.path, 'renamed')
    assert.equal(renamed.path, 'jc-canvas/renamed.jccanvas')
    assert.equal(files.get('project-a', created.file.path), undefined)
    assert.ok(files.get('project-a', renamed.path))

    await deleteCanvasFile(renamed.path)
    assert.equal(files.get('project-a', renamed.path), undefined)
    assert.ok((await listCanvasFiles()).some(file => file.path === sourcePath))
    assert.ok(files.calls.every(call => call.projectId === 'project-a'))
  } finally {
    files.restore()
    projectStore.webProjectId.value = originalProjectId
  }
})

test('Web canvas creation honors an explicit project owner', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const files = installWebCanvasFileStore()

  projectStore.webProjectId.value = 'project-b'
  try {
    const created = await createCanvasFile('project-a')

    assert.equal(JSON.parse(files.get('project-a', created.file.path) || '{}').canvasId, created.document.canvasId)
    assert.equal(files.get('project-b', created.file.path), undefined)
  } finally {
    files.restore()
    projectStore.webProjectId.value = originalProjectId
  }
})

test('Desktop canvas operations retain an explicit directory owner', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectDir = projectStore.projectDir.value
  const files = installTauriCanvasFileStore()
  const owner = '/projects/a'
  const otherOwner = '/projects/b'
  const source = persistenceDocument('desktop-source')
  const sourcePath = canvasDocumentRelativePath(source.canvasId)

  projectStore.projectDir.value = otherOwner
  try {
    await saveCanvas(source, sourcePath, owner)
    assert.equal(JSON.parse(files.get(owner, sourcePath) || '{}').canvasId, source.canvasId)
    assert.equal(files.get(otherOwner, sourcePath), undefined)

    const restored = await restoreCanvasAtPath(sourcePath, owner)
    assert.equal(restored.status, 'ready')
    const restoredById = await restoreCanvas(source.canvasId, owner)
    assert.equal(restoredById.status, 'ready')
    assert.deepEqual((await listCanvasFiles(owner)).map(file => file.path), [sourcePath])

    const created = await createCanvasFile(owner)
    const copied = await copyCanvasFile(sourcePath, owner)
    const renamed = await renameCanvasFile(created.file.path, 'renamed', owner)
    await deleteCanvasFile(renamed.path, owner)
    const taskResult = await writeCanvasTaskResult({
      canvasId: source.canvasId, canvasPath: sourcePath, operation: 'append', referenceNodeIds: [],
    }, 'jc-media/images/result.png', owner)

    assert.equal(files.get(owner, created.file.path), undefined)
    assert.equal(JSON.parse(files.get(owner, copied.file.path) || '{}').canvasId, copied.document.canvasId)
    assert.equal(taskResult.scene.length, 1)
    assert.equal(
      hasPersistedAssetPath(
        JSON.parse(files.get(owner, sourcePath) || '{}'),
        'jc-media/images/result.png',
      ),
      true,
    )
    assert.ok(files.calls.every(call => call.root === owner))
  } finally {
    files.restore()
    projectStore.projectDir.value = originalProjectDir
  }
})

test('serializes a canvas task result read-modify-write behind an in-flight save', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectDir = projectStore.projectDir.value
  const owner = '/projects/task-rmw'
  const path = 'jc-canvas/task-rmw.jccanvas'
  const initial = persistenceDocument('task-rmw')
  const edited = createCanvasDocument({
    canvasId: initial.canvasId,
    updatedAt: 2,
    scene: [{ tag: 'Text', id: 'user-edit', text: 'new user edit' }],
    assets: {},
  })
  let releaseSave: () => void = () => {}
  let markSaveStarted: () => void = () => {}
  let markTaskRead: () => void = () => {}
  let holdFirstWrite = true
  let released = false
  const saveWriteStarted = new Promise<void>(resolve => { markSaveStarted = resolve })
  const taskRead = new Promise<void>(resolve => { markTaskRead = resolve })
  const saveGate = new Promise<void>(resolve => { releaseSave = resolve })
  const files = installTauriCanvasFileStore(async (command, input) => {
    if (command === 'dev_write_file_if_revision' && input.relativePath === path && holdFirstWrite) {
      holdFirstWrite = false
      markSaveStarted()
      await saveGate
    }
    if (command === 'dev_read_file' && input.relativePath === path) markTaskRead()
  })
  const releaseOnce = () => {
    if (released) return
    released = true
    releaseSave()
  }
  let save: Promise<void> = Promise.resolve()
  let taskResult: Promise<unknown> = Promise.resolve()

  files.set(owner, path, JSON.stringify(initial))
  projectStore.projectDir.value = owner
  try {
    save = saveCanvas(edited, path, owner)
    await saveWriteStarted
    taskResult = writeCanvasTaskResult({
      canvasId: initial.canvasId, canvasPath: path, operation: 'append', referenceNodeIds: [],
    }, 'jc-media/images/result.png', owner)

    void taskRead.then(releaseOnce)
    setTimeout(releaseOnce, 0)
    await Promise.all([save, taskResult])

    const document = JSON.parse(files.get(owner, path) || '{}')
    assert.equal(document.scene.some((node: CanvasSceneNode) => node.id === 'user-edit'), true)
    assert.equal(hasPersistedAssetPath(document, 'jc-media/images/result.png'), true)
  } finally {
    releaseOnce()
    await Promise.allSettled([save, taskResult])
    files.restore()
    projectStore.projectDir.value = originalProjectDir
  }
})

test('retains concurrent task results for the same canvas', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectDir = projectStore.projectDir.value
  const owner = '/projects/a'
  const path = 'jc-canvas/shared-results.jccanvas'
  const files = installTauriCanvasFileStore()

  files.set(owner, path, JSON.stringify(persistenceDocument('shared-results')))
  projectStore.projectDir.value = owner
  try {
    await Promise.all([
      writeCanvasTaskResult({
        canvasId: 'shared-results', canvasPath: path, operation: 'append', referenceNodeIds: [],
      }, 'jc-media/images/first-result.png', owner),
      writeCanvasTaskResult({
        canvasId: 'shared-results', canvasPath: path, operation: 'append', referenceNodeIds: [],
      }, 'jc-media/images/second-result.png', owner),
    ])

    const document = JSON.parse(files.get(owner, path) || '{}')
    assert.equal(hasPersistedAssetPath(document, 'jc-media/images/first-result.png'), true)
    assert.equal(hasPersistedAssetPath(document, 'jc-media/images/second-result.png'), true)
  } finally {
    files.restore()
    projectStore.projectDir.value = originalProjectDir
  }
})

test('deletes a canvas after an in-flight task result instead of letting the task recreate it', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectDir = projectStore.projectDir.value
  const owner = '/projects/a'
  const path = 'jc-canvas/deleting-task.jccanvas'
  const initial = persistenceDocument('deleting-task')
  let releaseTaskWrite: () => void = () => {}
  let markTaskWriteStarted: () => void = () => {}
  let holdTaskWrite = true
  const taskWriteStarted = new Promise<void>(resolve => { markTaskWriteStarted = resolve })
  const taskWriteGate = new Promise<void>(resolve => { releaseTaskWrite = resolve })
  const files = installTauriCanvasFileStore(async (command, input) => {
    if (command === 'dev_write_file_if_revision' && input.relativePath === path && holdTaskWrite) {
      holdTaskWrite = false
      markTaskWriteStarted()
      await taskWriteGate
    }
  })
  let task: Promise<unknown> = Promise.resolve()
  let deletion: Promise<void> = Promise.resolve()

  files.set(owner, path, JSON.stringify(initial))
  projectStore.projectDir.value = owner
  try {
    task = writeCanvasTaskResult({
      canvasId: initial.canvasId, canvasPath: path, operation: 'append', referenceNodeIds: [],
    }, 'jc-media/images/deleting-task.png', owner)
    await taskWriteStarted
    deletion = deleteCanvasFile(path, owner)
    releaseTaskWrite()
    await Promise.all([task, deletion])

    assert.equal(files.get(owner, path), undefined)
  } finally {
    releaseTaskWrite()
    await Promise.allSettled([task, deletion])
    files.restore()
    projectStore.projectDir.value = originalProjectDir
  }
})

test('moves an in-flight task result with its renamed canvas file', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectDir = projectStore.projectDir.value
  const owner = '/projects/a'
  const path = 'jc-canvas/renaming-task.jccanvas'
  const renamedPath = 'jc-canvas/renamed-task.jccanvas'
  const initial = persistenceDocument('renaming-task')
  let releaseTaskWrite: () => void = () => {}
  let markTaskWriteStarted: () => void = () => {}
  let holdTaskWrite = true
  const taskWriteStarted = new Promise<void>(resolve => { markTaskWriteStarted = resolve })
  const taskWriteGate = new Promise<void>(resolve => { releaseTaskWrite = resolve })
  const files = installTauriCanvasFileStore(async (command, input) => {
    if (command === 'dev_write_file_if_revision' && input.relativePath === path && holdTaskWrite) {
      holdTaskWrite = false
      markTaskWriteStarted()
      await taskWriteGate
    }
  })
  let task: Promise<unknown> = Promise.resolve()
  let rename: Promise<unknown> = Promise.resolve()

  files.set(owner, path, JSON.stringify(initial))
  projectStore.projectDir.value = owner
  try {
    task = writeCanvasTaskResult({
      canvasId: initial.canvasId, canvasPath: path, operation: 'append', referenceNodeIds: [],
    }, 'jc-media/images/renaming-task.png', owner)
    await taskWriteStarted
    rename = renameCanvasFile(path, 'renamed-task', owner)
    releaseTaskWrite()
    await Promise.all([task, rename])

    assert.equal(files.get(owner, path), undefined)
    const document = JSON.parse(files.get(owner, renamedPath) || '{}')
    assert.equal(hasPersistedAssetPath(document, 'jc-media/images/renaming-task.png'), true)
  } finally {
    releaseTaskWrite()
    await Promise.allSettled([task, rename])
    files.restore()
    projectStore.projectDir.value = originalProjectDir
  }
})

test('rejects a task result whose target was deleted before it entered the queue', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectDir = projectStore.projectDir.value
  const owner = '/projects/a'
  const path = 'jc-canvas/deleted-before-task.jccanvas'
  const initial = persistenceDocument('deleted-before-task')
  const files = installTauriCanvasFileStore()

  files.set(owner, path, JSON.stringify(initial))
  projectStore.projectDir.value = owner
  try {
    await deleteCanvasFile(path, owner)
    await assert.rejects(() => writeCanvasTaskResult({
      canvasId: initial.canvasId, canvasPath: path, operation: 'append', referenceNodeIds: [],
    }, 'jc-media/images/deleted-before-task.png', owner), /画布目标已失效/)
    assert.equal(files.get(owner, path), undefined)
  } finally {
    files.restore()
    projectStore.projectDir.value = originalProjectDir
  }
})

test('preserves a pending user snapshot before renaming its canvas file', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const owner = 'project-lifecycle-rename'
  const path = 'jc-canvas/lifecycle-rename.jccanvas'
  const renamedPath = 'jc-canvas/lifecycle-renamed.jccanvas'
  const initial = persistenceDocument('lifecycle-rename')
  const pending = createCanvasDocument({
    canvasId: initial.canvasId,
    updatedAt: 2,
    scene: [{ tag: 'Text', id: 'pending-user-edit', text: 'pending user edit' }],
    assets: {},
  })
  const files = installWebCanvasFileStore()
  const off = eventBus.onEvent('canvas:before-rename', async (payload: unknown) => {
    if ((payload as { path?: string })?.path !== path) return
    await saveCanvas(pending, path, owner)
  })

  files.set(owner, path, JSON.stringify(initial))
  projectStore.webProjectId.value = owner
  try {
    await emitCanvasLifecycleEvent('canvas:before-rename', { path, owner })
    await renameCanvasFile(path, 'lifecycle-renamed', owner)

    const document = JSON.parse(files.get(owner, renamedPath) || '{}')
    assert.equal(document.scene.some((node: CanvasSceneNode) => node.id === 'pending-user-edit'), true)
  } finally {
    off()
    files.restore()
    projectStore.webProjectId.value = originalProjectId
  }
})

test('preserves a pending user snapshot when a delete fails after its barrier', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const owner = 'project-lifecycle-delete'
  const path = 'jc-canvas/lifecycle-delete.jccanvas'
  const initial = persistenceDocument('lifecycle-delete')
  const pending = createCanvasDocument({
    canvasId: initial.canvasId,
    updatedAt: 2,
    scene: [{ tag: 'Text', id: 'pending-user-edit', text: 'pending user edit' }],
    assets: {},
  })
  const files = installWebCanvasFileStore()
  const remove = webProjectFiles.remove
  const off = eventBus.onEvent('canvas:before-delete', async (payload: unknown) => {
    if ((payload as { path?: string })?.path !== path) return
    await saveCanvas(pending, path, owner)
  })

  files.set(owner, path, JSON.stringify(initial))
  projectStore.webProjectId.value = owner
  webProjectFiles.remove = async () => { throw new Error('delete failed') }
  try {
    await emitCanvasLifecycleEvent('canvas:before-delete', { path, owner })
    await assert.rejects(() => deleteCanvasFile(path, owner), /delete failed/)

    const document = JSON.parse(files.get(owner, path) || '{}')
    assert.equal(document.scene.some((node: CanvasSceneNode) => node.id === 'pending-user-edit'), true)
  } finally {
    off()
    webProjectFiles.remove = remove
    files.restore()
    projectStore.webProjectId.value = originalProjectId
  }
})

test('allows a delete after its barrier persists a pending user snapshot', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const owner = 'project-lifecycle-delete-success'
  const path = 'jc-canvas/lifecycle-delete-success.jccanvas'
  const initial = persistenceDocument('lifecycle-delete-success')
  const pending = createCanvasDocument({
    canvasId: initial.canvasId,
    updatedAt: 2,
    scene: [{ tag: 'Text', id: 'pending-user-edit', text: 'pending user edit' }],
    assets: {},
  })
  const files = installWebCanvasFileStore()
  const off = eventBus.onEvent('canvas:before-delete', async (payload: unknown) => {
    if ((payload as { path?: string; owner?: string })?.path !== path || (payload as { owner?: string }).owner !== owner) return
    await saveCanvas(pending, path, owner)
  })

  files.set(owner, path, JSON.stringify(initial))
  projectStore.webProjectId.value = owner
  try {
    await emitCanvasLifecycleEvent('canvas:before-delete', { path, owner })
    await deleteCanvasFile(path, owner)

    assert.equal(files.get(owner, path), undefined)
  } finally {
    off()
    files.restore()
    projectStore.webProjectId.value = originalProjectId
  }
})

test('Desktop canvas saves use owner-scoped queues', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectDir = projectStore.projectDir.value
  const ownerA = '/projects/desktop-queue-a'
  const ownerB = '/projects/desktop-queue-b'
  const path = 'jc-canvas/desktop-owner-queue.jccanvas'
  const writes: string[] = []
  let releaseFirst: () => void = () => {}
  let markFirstStarted: () => void = () => {}
  const firstWrite = new Promise<void>(resolve => { releaseFirst = resolve })
  const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve })
  let first: Promise<void> = Promise.resolve()
  let second: Promise<void> = Promise.resolve()

  const files = installTauriCanvasFileStore(async (command, input) => {
    if (command !== 'dev_create_file_if_missing') return
    const root = input.root || ''
    writes.push(root)
    if (root === ownerA) {
      markFirstStarted()
      await firstWrite
    }
  })

  try {
    projectStore.projectDir.value = ownerA
    first = saveCanvas(persistenceDocument('queue-a'), path, ownerA)
    await firstStarted
    projectStore.projectDir.value = ownerB
    second = saveCanvas(persistenceDocument('queue-b'), path, ownerB)
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.deepEqual(writes, [ownerA, ownerB])
  } finally {
    releaseFirst()
    await Promise.allSettled([first, second])
    files.restore()
    projectStore.projectDir.value = originalProjectDir
  }
})

test('Web canvas saves capture the project before queueing and do not share another project queue', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const files = installWebCanvasFileStore()
  const ownerA = 'project-web-queue-a'
  const ownerB = 'project-web-queue-b'
  const path = 'jc-canvas/web-owner-queue.jccanvas'
  const originalWriteIfRevision = webProjectFiles.writeIfRevision
  const writes: string[] = []
  let releaseFirst: () => void = () => {}
  const firstWrite = new Promise<void>(resolve => { releaseFirst = resolve })
  let first: Promise<void> = Promise.resolve()
  let second: Promise<void> = Promise.resolve()

  webProjectFiles.writeIfRevision = async (projectId, path, content, expectedRevision) => {
    writes.push(projectId)
    if (projectId === ownerA) await firstWrite
    return await originalWriteIfRevision(projectId, path, content, expectedRevision)
  }

  try {
    files.set(ownerA, path, JSON.stringify(persistenceDocument('queue-a')))
    files.set(ownerB, path, JSON.stringify(persistenceDocument('queue-b')))
    projectStore.webProjectId.value = ownerA
    first = saveCanvas(persistenceDocument('queue-a'), path)
    projectStore.webProjectId.value = ownerB
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(writes, [ownerA])

    second = saveCanvas(persistenceDocument('queue-b'), path)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(writes, [ownerA, ownerB])
  } finally {
    releaseFirst()
    await Promise.allSettled([first, second])
    webProjectFiles.writeIfRevision = originalWriteIfRevision
    files.restore()
    projectStore.webProjectId.value = originalProjectId
  }
})

test('Web task canvas writes return the final document for their explicit project owner', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const files = installWebCanvasFileStore()
  const owner = 'project-explicit-task-owner'
  const otherOwner = 'project-explicit-task-other'
  const path = 'jc-canvas/explicit-owner-task.jccanvas'

  files.set(owner, path, JSON.stringify(persistenceDocument('task-canvas')))
  projectStore.webProjectId.value = otherOwner
  try {
    const result = await writeCanvasTaskResult({
      canvasId: 'task-canvas', canvasPath: path, operation: 'append', referenceNodeIds: [],
    }, 'jc-media/images/result.png', owner)

    assert.equal((result as unknown as { canvasId?: string }).canvasId, 'task-canvas')
    assert.equal((result as unknown as { scene?: unknown[] }).scene?.length, 1)
    assert.equal(
      hasPersistedAssetPath(
        JSON.parse(files.get(owner, path) || '{}'),
        'jc-media/images/result.png',
      ),
      true,
    )
    assert.equal(files.get(otherOwner, path), undefined)
  } finally {
    files.restore()
    projectStore.webProjectId.value = originalProjectId
  }
})

test('rejects malformed canvas paths before Web project files are touched', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const files = installWebCanvasFileStore()
  const document = persistenceDocument('path-validation')
  const invalidPaths = [
    'jc-canvas/nested/path.jccanvas',
    '../jc-canvas/path.jccanvas',
    'jc-canvas/path.canvas',
    'jc-canvas/path.jccanvas.tmp',
  ]

  projectStore.webProjectId.value = 'project-a'
  try {
    for (const path of invalidPaths) {
      await assert.rejects(() => saveCanvas(document, path), /画布路径无效/)
      await assert.rejects(() => restoreCanvasAtPath(path), /画布路径无效/)
      await assert.rejects(() => copyCanvasFile(path), /画布路径无效/)
      await assert.rejects(() => renameCanvasFile(path, 'renamed'), /画布路径无效/)
      await assert.rejects(() => deleteCanvasFile(path), /画布路径无效/)
      await assert.rejects(() => writeCanvasTaskResult({
        canvasId: document.canvasId, canvasPath: path, operation: 'append', referenceNodeIds: [],
      }, 'jc-media/images/result.png', 'project-a'), /画布路径无效/)
    }

    assert.deepEqual(files.calls, [])
  } finally {
    files.restore()
    projectStore.webProjectId.value = originalProjectId
  }
})

test('rejects generated result paths outside project media', () => {
  const document = persistenceDocument('task-canvas')
  const target = {
    canvasId: 'task-canvas', canvasPath: 'jc-canvas/task.jccanvas', operation: 'append' as const, referenceNodeIds: [],
  }

  for (const path of [
    'blob:https://studio.example/result',
    'data:image/png;base64,AAAA',
    'https://studio.example/result.png',
    '/tmp/result.png',
    '../jc-media/result.png',
    'jc-media/../result.png',
  ]) {
    assert.throws(() => applyCanvasTaskResult(document, target, path), /画布结果必须先保存到项目媒体目录/)
  }
})

test('Web task canvas results reject blob paths before persistence', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const files = installWebCanvasFileStore()
  const path = 'jc-canvas/task.jccanvas'
  const persisted = JSON.stringify(persistenceDocument('task-canvas'))

  files.set('project-a', path, persisted)
  projectStore.webProjectId.value = 'project-a'
  try {
    await assert.rejects(() => writeCanvasTaskResult({
      canvasId: 'task-canvas', canvasPath: path, operation: 'append', referenceNodeIds: [],
    }, 'blob:https://studio.example/result', 'project-a'), /画布结果必须先保存到项目媒体目录/)

    assert.equal(files.get('project-a', path), persisted)
  } finally {
    files.restore()
    projectStore.webProjectId.value = originalProjectId
  }
})
