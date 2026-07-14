import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FileEntry } from '@/composables/useFileStore'
import { useProjectStore } from '@/stores/projectStore'
import { webProjectFiles } from '@/utils/webProjectFiles'
import { createCanvasDocument, migrateCanvasDocument } from '../canvasDocument'
import {
  canvasDocumentRelativePath,
  canvasDocumentTemporaryPath,
  canvasFilePath,
  applyCanvasTaskResult,
  copyCanvasFile,
  copyCanvasDocument,
  createCanvasFile,
  createCanvasSaveQueue,
  deleteCanvasFile,
  listCanvasFiles,
  nextCanvasFileName,
  parseCanvasDocument,
  renameCanvasFile,
  restoreCanvasAtPath,
  saveCanvas,
  writeCanvasTaskResult,
} from '../canvasPersistence'

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

  function entry(projectId: string, path: string, content: string): FileEntry {
    return {
      id: `test:${projectId}:${path}`,
      category: 'text',
      name: path.split('/').pop() || path,
      content,
      mimeType: 'text/plain',
      size: new TextEncoder().encode(content).byteLength,
      createdAt: 1,
      updatedAt: 1,
      metadata: { kind: 'project-file', projectId, relativePath: path },
    }
  }

  webProjectFiles.write = async (projectId, path, content) => {
    calls.push({ operation: 'write', projectId, path })
    projectContents(projectId).set(path, content)
    return entry(projectId, path, content)
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
    set(projectId, path, content) { projectContents(projectId).set(path, content) },
    restore() {
      webProjectFiles.write = originalWrite
      webProjectFiles.read = originalRead
      webProjectFiles.list = originalList
      webProjectFiles.rename = originalRename
      webProjectFiles.remove = originalRemove
    },
  }
}

function persistenceDocument(canvasId: string) {
  return createCanvasDocument({ canvasId, updatedAt: 1, scene: [], assets: {} })
}

test('stores an image asset as a project path instead of a data URL', () => {
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

  assert.equal(document.version, 2)
  assert.equal(document.scene[0].url, 'jc-media/images/poster.png')
  assert.equal(JSON.stringify(document).includes('base64'), false)
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

test('migrates the legacy image layer document into a V2 scene document', () => {
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

  assert.equal(document.version, 2)
  assert.equal(document.viewport.zoom, 1.5)
  assert.equal(document.scene[0].id, 'legacy-image')
  assert.equal(document.scene[0].url, 'jc-media/images/legacy.png')
  assert.equal(document.assets['legacy-image'].path, 'jc-media/images/legacy.png')
})

test('uses a project canvas file and same-directory temporary file', () => {
  assert.equal(canvasDocumentRelativePath('default'), 'jc-canvas/default.jccanvas')
  assert.equal(canvasDocumentTemporaryPath('default'), 'jc-canvas/default.jccanvas.tmp')
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
  }), /画布图片必须先保存到项目媒体目录/)
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

  assert.equal(result.assets['image-1'].path, 'jc-media/images/original.png')
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

test('Web canvas saves capture the project before queueing and do not share another project queue', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const files = installWebCanvasFileStore()
  const originalWrite = webProjectFiles.write
  const writes: string[] = []
  let releaseFirst: () => void = () => {}
  const firstWrite = new Promise<void>(resolve => { releaseFirst = resolve })
  let first: Promise<void> = Promise.resolve()
  let second: Promise<void> = Promise.resolve()

  webProjectFiles.write = async (projectId, path, content) => {
    writes.push(projectId)
    if (projectId === 'project-a') await firstWrite
    return await originalWrite(projectId, path, content)
  }

  try {
    projectStore.webProjectId.value = 'project-a'
    first = saveCanvas(persistenceDocument('queue-a'), 'jc-canvas/shared.jccanvas')
    projectStore.webProjectId.value = 'project-b'
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(writes, ['project-a'])

    second = saveCanvas(persistenceDocument('queue-b'), 'jc-canvas/shared.jccanvas')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(writes, ['project-a', 'project-b'])
  } finally {
    releaseFirst()
    await Promise.allSettled([first, second])
    webProjectFiles.write = originalWrite
    files.restore()
    projectStore.webProjectId.value = originalProjectId
  }
})

test('Web task canvas writes honor an explicit project owner', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const files = installWebCanvasFileStore()
  const path = 'jc-canvas/task.jccanvas'

  files.set('project-a', path, JSON.stringify(persistenceDocument('task-canvas')))
  projectStore.webProjectId.value = 'project-b'
  try {
    const document = await writeCanvasTaskResult({
      canvasId: 'task-canvas', canvasPath: path, operation: 'append', referenceNodeIds: [],
    }, 'jc-media/images/result.png', 'project-a')

    assert.equal(document.scene.length, 1)
    assert.equal(JSON.parse(files.get('project-a', path) || '{}').scene[0].url, 'jc-media/images/result.png')
    assert.equal(files.get('project-b', path), undefined)
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
