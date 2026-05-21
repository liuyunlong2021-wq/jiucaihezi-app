import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveModelSelection } from '../modelSelection'

test('keeps current model when it exists in available models', () => {
  assert.equal(
    resolveModelSelection('gpt-5.5', [
      { id: 'claude-sonnet-4-6', capability: 'text' },
      { id: 'gpt-5.5', capability: 'text' },
    ]),
    'gpt-5.5',
  )
})

test('falls back to first text model when current model is unavailable', () => {
  assert.equal(
    resolveModelSelection('missing-model', [
      { id: 'gpt-image-2', capability: 'image' },
      { id: 'claude-haiku-4-5-20251001', capability: 'text' },
      { id: 'gpt-5.5', capability: 'text' },
    ]),
    'claude-haiku-4-5-20251001',
  )
})

test('falls back to provided default when no text model exists', () => {
  assert.equal(
    resolveModelSelection('missing-model', [
      { id: 'gpt-image-2', capability: 'image' },
    ], 'claude-sonnet-4-6'),
    'claude-sonnet-4-6',
  )
})
