import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resolveModelInputModalities } from '../modelInputCapabilities'

describe('direct model input capabilities', () => {
  test('uses the production-verified Gemini media contract only for the Jiucaihezi provider', () => {
    assert.deepEqual(
      resolveModelInputModalities({ id: 'gemini-3.5-flash', providerId: 'jiucaihezi' }),
      ['text', 'image', 'video', 'audio', 'file'],
    )
    assert.deepEqual(
      resolveModelInputModalities({ id: 'gemini-3.5-flash', providerId: 'custom-a' }),
      ['text'],
    )
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
})
