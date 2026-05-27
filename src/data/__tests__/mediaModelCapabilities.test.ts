import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MEDIA_MODEL_CAPABILITIES,
  getMediaModelsForTask,
  isMediaModelEnabled,
  isRemovedMediaModelId,
} from '../mediaModelCapabilities'

test('approved media catalog contains active models and excludes removed models', () => {
  const ids = MEDIA_MODEL_CAPABILITIES.map(model => model.id)

  assert.ok(ids.includes('nano-banana-2k'))
  assert.ok(ids.includes('nano-banana-4k'))
  assert.ok(ids.includes('seedance-2-0'))
  assert.equal(ids.includes('nano-banana'), false)
  assert.equal(ids.includes('nano-banana-hd'), false)
  assert.equal(ids.includes('grok-4.2-image'), false)
  assert.equal(ids.includes('grok-4.1-image'), false)
})

test('catalog exposes only Suno custom song, not secondary Suno modes', () => {
  const suno = MEDIA_MODEL_CAPABILITIES.find(model => model.id === 'suno-custom-song')

  assert.ok(suno)
  assert.equal(suno.model, 'suno_music')
  assert.deepEqual(suno.fields.map(field => field.key), [
    'title',
    'tags',
    'negative_tags',
    'mv',
    'prompt',
  ])
})

test('media models are grouped by user-visible task with explicit model selection', () => {
  assert.deepEqual(getMediaModelsForTask('image').map(model => model.id), [
    'gpt-image-2',
    'nano-banana-2k',
    'nano-banana-4k',
  ])
  assert.deepEqual(getMediaModelsForTask('video').map(model => model.id), [
    'grok-video-3',
    'veo3.1-fast',
    'seedance-2-0',
    'rh-mimic',
  ])
  assert.deepEqual(getMediaModelsForTask('digital-human').map(model => model.id), [
    'rh-digital-human-fast',
    'rh-digital-human',
  ])
  assert.deepEqual(getMediaModelsForTask('audio').map(model => model.id), [
    'suno-custom-song',
    'rh-voice-clone',
    'rh-voice-design',
  ])
})

test('removed models are not enabled', () => {
  assert.equal(isMediaModelEnabled('seedance-2.0-fast'), false)
  assert.equal(isMediaModelEnabled('seedance-2-0'), true)
  assert.equal(isMediaModelEnabled('seedance-2-0-pro'), true)
  assert.equal(isMediaModelEnabled('grok-4.2-image'), false)
  assert.equal(isMediaModelEnabled('nano-banana-2k'), true)
})

test('removed media model matcher blocks stale upstream names before capability inference', () => {
  assert.equal(isRemovedMediaModelId('seedance-2.0-fast'), true)
  assert.equal(isRemovedMediaModelId('doubao-seedance-1-0-pro-250528'), true)
  assert.equal(isRemovedMediaModelId('seedance-2-0'), false)
  assert.equal(isRemovedMediaModelId('seedance-2-0-pro'), false)
  assert.equal(isRemovedMediaModelId('grok-4.2-image'), true)
  assert.equal(isRemovedMediaModelId('grok-4.1-image'), true)
  assert.equal(isRemovedMediaModelId('nano-banana'), true)
  assert.equal(isRemovedMediaModelId('nano-banana-hd'), true)
  assert.equal(isRemovedMediaModelId('nano-banana-2k'), false)
  assert.equal(isRemovedMediaModelId('gpt-image-2'), false)
})
