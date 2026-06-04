import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MEDIA_MODEL_CAPABILITIES,
  clearMediaModelAvailability,
  getMediaModelAvailability,
  getMediaModelsForTask,
  isMediaModelEnabled,
  isRemovedMediaModelId,
  setMediaModelAvailability,
} from '../mediaModelCapabilities'
import { RH_CREATION_MODELS } from '../creationModels'

test('approved media catalog contains active models and excludes removed models', () => {
  const ids = MEDIA_MODEL_CAPABILITIES.map(model => model.id)

  assert.ok(ids.includes('nano-banana-4k'))
  assert.ok(ids.includes('rh-pro-image'))
  assert.ok(ids.includes('rh-image-v2'))
  assert.ok(ids.includes('rh-gpt2-image'))
  assert.ok(ids.includes('rh-gpt2-text'))
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
    'nano-banana-4k',
    'rh-pro-image',
    'rh-image-v2',
    'rh-gpt2-image',
    'rh-gpt2-text',
  ])
  assert.deepEqual(getMediaModelsForTask('video').map(model => model.id), [
    'grok-video-3',
    'rh-video-v31-fast',
    'rh-seedance2-text-video',
    'rh-seedance2-image-video',
    'rh-seedance2-multimodal-video',
    'rh-grok-text-video',
    'rh-grok-image-video',
  ])
  assert.deepEqual(getMediaModelsForTask('digital-human').map(model => model.id), [
    'rh-aiapp-fast-digital-human',
    'rh-aiapp-digital-human',
    'rh-aiapp-director',
  ])
  assert.deepEqual(getMediaModelsForTask('audio').map(model => model.id), [
    'suno-custom-song',
    'rh-voice-clone',
    'rh-aiapp-voice-clone',
    'rh-aiapp-voice-design',
    'rh-speech-hd',
    'rh-speech-turbo',
    'rh-music',
  ])
})

test('creation model projection keeps visible Nano Banana id but submits upstream Pro model', () => {
  assert.equal(RH_CREATION_MODELS['nano-banana-4k']?.modelName, 'nano-banana-pro-4k')
})

test('creation model projection exposes numeric duration ranges for the panel', () => {
  assert.deepEqual(RH_CREATION_MODELS['rh-grok-text-video']?.dur, [
    6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    26, 27, 28, 29, 30,
  ])
  assert.equal(RH_CREATION_MODELS['rh-grok-text-video']?.defDur, 8)
})

test('removed models are not enabled', () => {
  assert.equal(isMediaModelEnabled('seedance-2.0-fast'), false)
  assert.equal(isMediaModelEnabled('seedance-2-0'), false)
  assert.equal(isMediaModelEnabled('seedance-2-0-pro'), false)
  assert.equal(isMediaModelEnabled('grok-4.2-image'), false)
  assert.equal(isMediaModelEnabled('nano-banana-2k'), false)
  assert.equal(isMediaModelEnabled('nano-banana-4k'), true)
  assert.equal(isMediaModelEnabled('nano-banana-pro-4k'), true)
})

test('removed media model matcher blocks stale upstream names before capability inference', () => {
  assert.equal(isRemovedMediaModelId('seedance-2.0-fast'), true)
  assert.equal(isRemovedMediaModelId('doubao-seedance-1-0-pro-250528'), true)
  assert.equal(isRemovedMediaModelId('rh-seedance2'), true)
  assert.equal(isRemovedMediaModelId('rh-seedance2-text-video'), false)
  assert.equal(isRemovedMediaModelId('rh-seedance2-image-video'), false)
  assert.equal(isRemovedMediaModelId('rh-seedance2-multimodal-video'), false)
  assert.equal(isRemovedMediaModelId('seedance-2-0'), false)
  assert.equal(isRemovedMediaModelId('seedance-2-0-pro'), false)
  assert.equal(isRemovedMediaModelId('grok-4.2-image'), true)
  assert.equal(isRemovedMediaModelId('grok-4.1-image'), true)
  assert.equal(isRemovedMediaModelId('nano-banana'), true)
  assert.equal(isRemovedMediaModelId('nano-banana-hd'), true)
  assert.equal(isRemovedMediaModelId('nano-banana-2k'), true)
  assert.equal(isRemovedMediaModelId('nano-banana-pro-2k'), true)
  assert.equal(isRemovedMediaModelId('nano-banana-4k'), false)
  assert.equal(isRemovedMediaModelId('nano-banana-pro-4k'), false)
  assert.equal(isRemovedMediaModelId('gpt-image-2'), false)
})

test('runtime model availability can disable an otherwise local enabled model', () => {
  clearMediaModelAvailability()
  assert.equal(isMediaModelEnabled('gpt-image-2'), true)

  setMediaModelAvailability([
    { id: 'gpt-image-2', status: 'disabled', reason: '维护中' },
  ])

  assert.equal(isMediaModelEnabled('gpt-image-2'), false)
  assert.equal(getMediaModelAvailability('gpt-image-2')?.reason, '维护中')
  assert.equal(getMediaModelsForTask('image').some(model => model.id === 'gpt-image-2'), false)

  clearMediaModelAvailability()
  assert.equal(isMediaModelEnabled('gpt-image-2'), true)
})
