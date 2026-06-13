import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isChatImageFile, visibleCreationGalleryFiles, visibleMediaFiles } from '../fileEntryFilters'

test('visibleMediaFiles excludes chat images from the media asset list', () => {
  const chatImage = {
    id: 'chat_image_1',
    category: 'image',
    name: '聊天图片',
    content: 'data:image/png;base64,abc',
    mimeType: 'image/png',
    size: 1,
    createdAt: 1,
    updatedAt: 1,
    metadata: { kind: 'chat-image' },
  }
  const generatedImage = {
    id: 'generated_1',
    category: 'image',
    name: '生图结果',
    content: 'data:image/png;base64,def',
    mimeType: 'image/png',
    size: 1,
    createdAt: 1,
    updatedAt: 1,
  }

  assert.equal(isChatImageFile(chatImage), true)
  assert.deepEqual(visibleMediaFiles([chatImage, generatedImage]).map(file => file.id), ['generated_1'])
})

test('visibleCreationGalleryFiles only includes explicit creation gallery media', () => {
  const creationImage = {
    id: 'creation_1',
    category: 'image',
    metadata: { source: 'creation-gallery', kind: 'creation-result' },
  }
  const importedImage = {
    id: 'import_1',
    category: 'image',
    metadata: { source: 'creation-gallery', kind: 'creation-import' },
  }
  const chatImage = {
    id: 'chat_1',
    category: 'image',
    metadata: { kind: 'chat-image' },
  }
  const unlabeledImage = {
    id: 'old_global_1',
    category: 'image',
    metadata: {},
  }

  assert.deepEqual(
    visibleCreationGalleryFiles([creationImage, importedImage, chatImage, unlabeledImage]).map(file => file.id),
    ['creation_1', 'import_1'],
  )
})
