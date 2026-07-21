import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resolveKnownModelInputModalities, resolveModelInputModalities } from '../modelInputCapabilities'

describe('direct model input capabilities', () => {
  test('uses the product-verified media contract only for the exact Provider and model', () => {
    assert.deepEqual(
      resolveKnownModelInputModalities({ id: 'gemini-3.5-flash', providerId: 'jiucaihezi' }),
      ['text', 'image', 'video', 'audio', 'file'],
    )
    assert.equal(resolveKnownModelInputModalities({ id: 'gemini-3.5-flash', providerId: 'custom-a' }), undefined)
  })

  test('does not claim video or audio support for GPT-5.6 Terra', () => {
    const modalities = resolveModelInputModalities({ id: 'gpt-5.6-terra', providerId: 'jiucaihezi' })
    assert.equal(modalities.includes('video'), false)
    assert.equal(modalities.includes('audio'), false)
  })

  test('preserves explicit provider model declarations', () => {
    assert.deepEqual(
      resolveModelInputModalities({
        id: 'local-video-model',
        providerId: 'local-ollama',
        inputModalities: ['text', 'image', 'video'],
      }),
      ['text', 'image', 'video'],
    )
  })

  test('keeps unknown Provider capabilities unclaimed', () => {
    assert.equal(resolveKnownModelInputModalities({ id: 'unknown', providerId: 'custom-a' }), undefined)
  })
})
