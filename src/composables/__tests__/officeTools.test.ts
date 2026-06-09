import assert from 'node:assert/strict'
import { test } from 'node:test'

import { executeOfficeToolCall, getDefaultOfficeToolDefinitions, getOfficeToolDefinitions } from '../officeTools'

test('exposes local document creation and editor export tools to the model', () => {
  assert.deepEqual(getDefaultOfficeToolDefinitions().map(tool => tool.function.name), ['create_document', 'export_editor_document'])
  assert.deepEqual(getOfficeToolDefinitions('office-writer', 'Word 文档')?.map(tool => tool.function.name), ['create_document', 'export_editor_document'])
})

test('office create saves requested content through local docx writer', async () => {
  const previousDocument = (globalThis as any).document
  const previousURL = (globalThis as any).URL
  const previousBlob = (globalThis as any).Blob
  const previousBtoa = (globalThis as any).btoa
  try {
    ;(globalThis as any).document = {
      createElement: () => ({ click() {}, remove() {}, href: '', download: '' }),
      body: { appendChild() {} },
    }
    ;(globalThis as any).URL = {
      createObjectURL: () => 'blob:doc',
      revokeObjectURL() {},
    }
    ;(globalThis as any).Blob = class Blob {
      constructor(public parts: unknown[], public options?: Record<string, unknown>) {}
    }
    ;(globalThis as any).btoa = (value: string) => Buffer.from(value, 'binary').toString('base64')

  const result = JSON.parse(await executeOfficeToolCall({
      function: { name: 'create_document', arguments: JSON.stringify({ doc_type: 'docx', title: '剧本内容', content: '影视剧本正文' }) },
  }))

    assert.equal(result.status, 'success')
    assert.equal(result.engine, 'local_docx_writer')
    assert.equal(result.requested_type, 'docx')
    assert.equal(result.actual_type, 'docx')
  } finally {
    ;(globalThis as any).document = previousDocument
    ;(globalThis as any).URL = previousURL
    ;(globalThis as any).Blob = previousBlob
    ;(globalThis as any).btoa = previousBtoa
  }
})

test('legacy office read returns already extracted local attachment text', async () => {
  const result = JSON.parse(await executeOfficeToolCall({
    function: { name: 'office_read', arguments: JSON.stringify({ filename: 'notes' }) },
  }, {
    files: [{ name: 'notes.md', content: '# Notes' }],
  }))

  assert.equal(result.status, 'success')
  assert.equal(result.engine, 'local_attachment_text')
  assert.equal(result.files[0].content, '# Notes')
})
