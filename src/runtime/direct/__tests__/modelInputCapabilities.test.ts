import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resolveCurrentModelAttachments, resolveKnownModelInputModalities, resolveModelInputModalities } from '../modelInputCapabilities'

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

  test('rejects known unsupported attachments instead of routing them elsewhere', () => {
    const attachments = [
      { id: 'image', name: 'a.png', mime: 'image/png', size: 1, kind: 'image' as const, value: 'image' },
      { id: 'video', name: 'a.mp4', mime: 'video/mp4', size: 1, kind: 'video' as const, value: 'video' },
    ]
    assert.throws(
      () => resolveCurrentModelAttachments(attachments, ['text', 'image']),
      /当前模型不支持附件：a\.mp4/,
    )
  })

  test('keeps every attachment on the current model when capability is unknown', () => {
    const attachments = [
      { id: 'video', name: 'a.mp4', mime: 'video/mp4', size: 1, kind: 'video' as const, value: 'video' },
    ]
    assert.deepEqual(resolveCurrentModelAttachments(attachments, undefined), attachments)
    assert.equal(resolveKnownModelInputModalities({ id: 'unknown', providerId: 'custom-a' }), undefined)
  })
})
