import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sanitizeCreationResults } from '../creationResults'

test('sanitizeCreationResults preserves local media references for gallery persistence', () => {
  const results = sanitizeCreationResults([
    { url: 'jc-media:file_abc123', type: 'image', model: 'gpt-image-2', task: 'image', ts: 1 },
    { url: 'javascript:alert(1)', type: 'image', model: 'bad', task: 'image', ts: 2 },
  ], { forStorage: true })

  assert.deepEqual(results.map(item => item.url), ['jc-media:file_abc123'])
})

test('sanitizeCreationResults preserves failed task cards without media URLs', () => {
  const results = sanitizeCreationResults([
    { url: '', type: 'failed', content: 'HTTP 500', model: 'rh-pro-image', task: 'image', ts: 1, errorMsg: 'HTTP 500' },
  ], { forStorage: true })

  assert.equal(results.length, 1)
  assert.equal((results[0] as any).type, 'failed')
  assert.equal((results[0] as any).errorMsg, 'HTTP 500')
})
