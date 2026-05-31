import assert from 'node:assert/strict'
import { test } from 'node:test'

import { filterExecutableModels, resolveModelSelection, resolveTextModelSelection } from '../modelSelection'

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

test('resolveTextModelSelection replaces current media model with first text model', () => {
  assert.equal(
    resolveTextModelSelection('gpt-image-2', [
      { id: 'gpt-image-2', capability: 'image' },
      { id: 'gpt-5.4', capability: 'text' },
      { id: 'grok-video-3', capability: 'video' },
    ]),
    'gpt-5.4',
  )
})

test('resolveTextModelSelection keeps current model when it is already text', () => {
  assert.equal(
    resolveTextModelSelection('gpt-5.4', [
      { id: 'gpt-image-2', capability: 'image' },
      { id: 'gpt-5.4', capability: 'text' },
    ]),
    'gpt-5.4',
  )
})

test('filters removed and stale media models from cached model lists', () => {
  const filtered = filterExecutableModels([
    { id: 'seedance-2.0-fast', capability: 'video' },
    { id: 'grok-4.2-image', capability: 'image' },
    { id: 'nano-banana', capability: 'image' },
    { id: 'nano-banana-hd', capability: 'image' },
    { id: 'nano-banana-pro-4k', capability: 'image' },
    { id: 'gpt-5.4', capability: 'text' },
  ]).map(model => model.id)

  assert.deepEqual(filtered, ['nano-banana-pro-4k', 'gpt-5.4'])
})

test('resolveModelSelection does not keep removed cached model ids', () => {
  assert.equal(
    resolveModelSelection('seedance-2.0-fast', [
      { id: 'seedance-2.0-fast', capability: 'video' },
      { id: 'gpt-5.4', capability: 'text' },
    ]),
    'gpt-5.4',
  )
})
