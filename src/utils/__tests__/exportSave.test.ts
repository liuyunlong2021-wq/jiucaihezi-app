import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildSaveDialogFilters, fetchBlobForExport, normalizeExportFilename, uint8ArrayToBase64 } from '../exportSave'

test('normalizes unsafe export filenames while keeping extension', () => {
  assert.equal(normalizeExportFilename('方案/测试:版本?.docx', 'md'), '方案_测试_版本_.docx')
})

test('adds fallback extension when missing', () => {
  assert.equal(normalizeExportFilename('韭菜盒子导出', 'pdf'), '韭菜盒子导出.pdf')
})

test('builds save dialog filter from file extension', () => {
  assert.deepEqual(buildSaveDialogFilters('方案.docx'), [{ name: 'DOCX 文件', extensions: ['docx'] }])
})

test('encodes bytes as base64 for native save command', () => {
  assert.equal(uint8ArrayToBase64(new Uint8Array([0, 1, 2, 253, 254, 255])), 'AAEC/f7/')
})

test('fetchBlobForExport rejects unsafe download protocols before fetch', async () => {
  await assert.rejects(
    () => fetchBlobForExport('data:text/html,<script>alert(1)</script>'),
    /不支持的下载链接/,
  )
})
