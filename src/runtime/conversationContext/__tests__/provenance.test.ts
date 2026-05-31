import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildMemoryIdempotencyKey, hasValidMemoryProvenance } from '../provenance'

test('memory provenance requires source messages and runtime segment', () => {
  assert.equal(hasValidMemoryProvenance({
    sourceMessageIds: ['u1'],
    runtimeSegmentId: 'seg_1',
    sessionId: 'sess_1',
  }), true)
  assert.equal(hasValidMemoryProvenance({
    sourceMessageIds: [],
    runtimeSegmentId: 'seg_1',
    sessionId: 'sess_1',
  }), false)
})

test('memory idempotency key is stable', () => {
  assert.equal(
    buildMemoryIdempotencyKey('sess_1', 'seg_1', 'run_1', ['u1', 'a1']),
    buildMemoryIdempotencyKey('sess_1', 'seg_1', 'run_1', ['u1', 'a1']),
  )
})
