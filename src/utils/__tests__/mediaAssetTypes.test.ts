import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { MediaAsset, SendMediaAssetToCanvasPayload } from '@/types/mediaAsset'

test('media asset long-term contract keeps creation and canvas fields explicit', () => {
  const asset: MediaAsset = {
    id: 'asset_1',
    kind: 'image',
    name: 'hero.png',
    mimeType: 'image/png',
    localFileId: 'file_1',
    prompt: 'hero',
    model: 'gpt-image-2',
    origin: 'creation-panel',
    createdAt: 1,
    updatedAt: 2,
  }
  const payload: SendMediaAssetToCanvasPayload = {
    id: asset.id,
    fileId: asset.localFileId,
    kind: asset.kind,
    name: asset.name,
    url: 'data:image/png;base64,abc',
  }

  assert.equal(payload.kind, 'image')
  assert.equal(payload.fileId, 'file_1')
})
