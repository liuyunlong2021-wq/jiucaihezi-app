import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fileEntryToDownloadBlob } from '../fileDownload'

test('fileEntryToDownloadBlob treats URL-looking content as file content', async () => {
  const blob = fileEntryToDownloadBlob({
    id: 'f1',
    category: 'text',
    name: 'link.txt',
    content: 'https://evil.example/payload',
    mimeType: 'text/plain',
    size: 1,
    createdAt: 1,
    updatedAt: 1,
  })

  assert.equal(await blob.text(), 'https://evil.example/payload')
  assert.equal(blob.type, 'text/plain')
})
