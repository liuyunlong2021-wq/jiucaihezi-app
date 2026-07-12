import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createCanvasDocument, migrateCanvasDocument } from '../canvasDocument'
import {
  canvasDocumentRelativePath,
  canvasDocumentTemporaryPath,
  canvasFilePath,
  applyCanvasTaskResult,
  copyCanvasDocument,
  createCanvasSaveQueue,
  nextCanvasFileName,
  parseCanvasDocument,
} from '../canvasPersistence'

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
