import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { findMediaSpecialist, resolveModelInputModalities } from '../modelInputCapabilities'

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

  test('finds a media specialist only inside the current provider', () => {
    const models = [
      { id: 'main', providerId: 'custom-a', inputModalities: ['text'] as const },
      { id: 'gemini-3.5-flash', providerId: 'jiucaihezi', inputModalities: ['text', 'video'] as const },
      { id: 'gemini-3.5-flash', providerId: 'custom-b', inputModalities: ['text', 'video'] as const },
    ]
    assert.equal(findMediaSpecialist(models, 'custom-a', ['video']), null)
    assert.equal(findMediaSpecialist(models, 'local-ollama', ['video']), null)
  })

  test('returns current-provider Gemini when it covers every required modality', () => {
    const models = [
      { id: 'gemini-3.5-flash', providerId: 'custom-a', inputModalities: ['text', 'video', 'audio'] as const },
    ]
    assert.equal(findMediaSpecialist(models, 'custom-a', ['video', 'audio'])?.id, 'gemini-3.5-flash')
    assert.equal(findMediaSpecialist(models, 'custom-a', ['video', 'file']), null)
  })
})
