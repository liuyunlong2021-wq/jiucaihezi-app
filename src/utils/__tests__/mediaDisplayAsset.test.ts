import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mediaDisplayAssetFromCreationResult, mediaDisplayAssetFromFileEntry } from '../mediaDisplayAsset'
import type { FileEntry } from '@/composables/useFileStore'

test('mediaDisplayAssetFromFileEntry maps stored image media', () => {
  const entry: FileEntry = {
    id: 'file_1',
    category: 'image',
    name: 'hero.png',
    content: 'data:image/png;base64,abc',
    mimeType: 'image/png',
    size: 123,
    createdAt: 10,
    updatedAt: 11,
  }

  const asset = mediaDisplayAssetFromFileEntry(entry)

  assert.equal(asset?.id, 'file_1')
  assert.equal(asset?.kind, 'image')
  assert.equal(asset?.displayUrl, 'data:image/png;base64,abc')
  assert.equal(asset?.status, 'ready')
})

test('mediaDisplayAssetFromFileEntry maps stored video thumbnail metadata', () => {
  const entry: FileEntry = {
    id: 'file_video',
    category: 'video',
    name: 'clip.mp4',
    content: 'data:video/mp4;base64,abc',
    mimeType: 'video/mp4',
    size: 123,
    createdAt: 10,
    updatedAt: 11,
    metadata: {
      thumbnailUrl: 'data:image/jpeg;base64,thumb',
      duration: 6.4,
      width: 1280,
      height: 720,
    },
  }

  const asset = mediaDisplayAssetFromFileEntry(entry)

  assert.equal(asset?.kind, 'video')
  assert.equal(asset?.thumbnailUrl, 'data:image/jpeg;base64,thumb')
  assert.equal(asset?.duration, 6.4)
  assert.equal(asset?.width, 1280)
  assert.equal(asset?.height, 720)
})

test('mediaDisplayAssetFromCreationResult preserves jc-media refs and metadata', () => {
  const asset = mediaDisplayAssetFromCreationResult({
    id: 'result_1',
    displayUrl: 'data:image/png;base64,abc',
    result: {
      url: 'jc-media:file_abc',
      originalUrl: 'https://webstatic.aiproxy.vip/output/a.png',
      type: 'image',
      content: '霸道总裁',
      model: 'rh-image',
      task: 'image',
      ts: 20,
      taskId: 'task_1',
    },
  })

  assert.equal(asset?.localRef, 'jc-media:file_abc')
  assert.equal(asset?.originalUrl, 'https://webstatic.aiproxy.vip/output/a.png')
  assert.equal(asset?.prompt, '霸道总裁')
  assert.equal(asset?.taskId, 'task_1')
})
