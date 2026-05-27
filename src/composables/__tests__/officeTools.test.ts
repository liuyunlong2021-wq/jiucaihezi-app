import assert from 'node:assert/strict'
import { test } from 'node:test'

import { executeOfficeToolCall, getDefaultOfficeToolDefinitions, getOfficeToolDefinitions } from '../officeTools'

test('does not expose remote office tools to the model', () => {
  assert.deepEqual(getDefaultOfficeToolDefinitions(), [])
  assert.equal(getOfficeToolDefinitions('office-writer', 'Word 文档'), undefined)
})

test('legacy office create calls are disabled locally and do not need network', async () => {
  const result = JSON.parse(await executeOfficeToolCall({
    function: { name: 'office_create', arguments: JSON.stringify({ doc_type: 'docx', content: 'hello' }) },
  }))

  assert.equal(result.status, 'disabled')
  assert.equal(result.local_only, true)
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
