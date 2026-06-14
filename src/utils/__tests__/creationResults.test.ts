import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizeCreationTextField, sanitizeCreationResults } from '../creationResults'

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

test('sanitizeCreationResults normalizes legacy non-string fields before gallery render', () => {
  const now = Date.now()
  const results = sanitizeCreationResults([
    {
      url: 'https://api.jiucaihezi.studio/media/creation.png',
      type: 'image',
      content: { prompt: 'old object prompt' },
      model: ['gpt-image-2'],
      task: { kind: 'image' },
      ts: 'not-a-date',
      taskId: 123,
      originalUrl: 'javascript:alert(1)',
      errorMsg: { message: 'cache failed' },
    },
  ], { now })

  assert.equal(results.length, 1)
  assert.equal(typeof (results[0] as any).content, 'string')
  assert.equal(typeof (results[0] as any).model, 'string')
  assert.equal(typeof (results[0] as any).task, 'string')
  assert.equal(typeof (results[0] as any).taskId, 'string')
  assert.equal(typeof (results[0] as any).errorMsg, 'string')
  assert.equal((results[0] as any).ts, now)
  assert.equal((results[0] as any).originalUrl, undefined)
})

test('normalizeCreationTextField keeps saved prompt fields trim-safe', () => {
  assert.equal(normalizeCreationTextField({ prompt: 'old object prompt' }), 'old object prompt')
  assert.equal(normalizeCreationTextField(['a', 'b']), '["a","b"]')
  assert.equal(normalizeCreationTextField(null), '')
})
