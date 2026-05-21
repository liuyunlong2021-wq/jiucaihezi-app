import assert from 'node:assert/strict'
import { test } from 'node:test'

import { countFolderFiles } from '../fileTreeView'

test('countFolderFiles counts descendant files by folderId instead of metadata children', () => {
  const entries: any[] = [
    { id: 'root', name: 'raw', mimeType: 'folder' },
    { id: 'a', name: '转换后的MD', mimeType: 'folder', folderId: 'root' },
    { id: 'b', name: '子目录', mimeType: 'folder', folderId: 'a' },
    { id: 'f1', name: 'a.md', mimeType: 'text/markdown', folderId: 'a' },
    { id: 'f2', name: 'b.md', mimeType: 'text/markdown', folderId: 'b' },
  ]

  assert.equal(countFolderFiles(entries[0], entries), 2)
  assert.equal(countFolderFiles(entries[1], entries), 2)
  assert.equal(countFolderFiles(entries[2], entries), 1)
})
