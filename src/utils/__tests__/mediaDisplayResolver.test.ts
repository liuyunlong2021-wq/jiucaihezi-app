import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isDeferredMediaDisplayUrl, resolveMediaDisplayUrl } from '../mediaDisplayResolver'

test('resolveMediaDisplayUrl returns ready for ordinary display URLs', async () => {
  const result = await resolveMediaDisplayUrl('data:image/png;base64,abc')

  assert.equal(result.status, 'ready')
  assert.equal(result.displayUrl, 'data:image/png;base64,abc')
})

test('resolveMediaDisplayUrl resolves local media refs with injected resolver', async () => {
  assert.equal(isDeferredMediaDisplayUrl('jc-media:file_abc'), true)

  const result = await resolveMediaDisplayUrl('jc-media:file_abc', async () => 'data:image/png;base64,abc')

  assert.equal(result.status, 'ready')
  assert.equal(result.displayUrl, 'data:image/png;base64,abc')
})

test('resolveMediaDisplayUrl reports failed local refs without falling back to blank success', async () => {
  const result = await resolveMediaDisplayUrl('jc-media:file_missing', async () => '')

  assert.equal(result.status, 'failed')
  assert.equal(result.displayUrl, '')
  assert.match(result.errorMsg || '', /无法解析/)
})
