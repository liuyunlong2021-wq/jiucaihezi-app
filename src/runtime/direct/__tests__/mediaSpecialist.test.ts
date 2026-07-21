import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  resolveMediaAttachments,
  type MediaSpecialistConsent,
} from '../mediaSpecialist'

const video = {
  id: 'video-1',
  name: 'clip.mp4',
  mime: 'video/mp4',
  size: 12,
  kind: 'video' as const,
  value: 'data:video/mp4;base64,AAA',
}

const models = [
  { id: 'main', providerId: 'account-a', inputModalities: ['text'] as const },
  { id: 'gemini-3.5-flash', providerId: 'account-a', inputModalities: ['text', 'video'] as const },
]

function consent(value: MediaSpecialistConsent) {
  return async () => value
}

describe('same-provider media specialist', () => {
  test('keeps media on the primary model when it supports every attachment', async () => {
    let calls = 0
    const result = await resolveMediaAttachments({
      primaryModel: { id: 'main', providerId: 'account-a', inputModalities: ['text', 'video'] },
      models,
      attachments: [video],
      userGoal: '分析视频',
      requestConsent: consent('always'),
      sendCompletion: async () => { calls++; return '' },
    })
    assert.equal(result.kind, 'direct')
    assert.equal(calls, 0)
  })

  test('uses only a verified Gemini from the current provider after consent', async () => {
    let calledModel = ''
    let request: unknown
    const result = await resolveMediaAttachments({
      primaryModel: models[0],
      models,
      attachments: [video],
      userGoal: '拆解剧本',
      requestConsent: consent('once'),
      sendCompletion: async (modelId, messages) => {
        calledModel = modelId
        request = messages
        return JSON.stringify({
          results: [{
            assetId: 'video-1',
            modality: 'video',
            summary: '红色画面',
            observations: ['画面为红色'],
            uncertainties: [],
          }],
        })
      },
    })
    assert.equal(result.kind, 'assisted')
    assert.equal(calledModel, 'gemini-3.5-flash')
    assert.match(JSON.stringify(request), /file_data/)
    if (result.kind === 'assisted') {
      assert.equal(result.results[0]?.specialistModel, 'gemini-3.5-flash')
      assert.deepEqual(result.results[0]?.uncertainties, [])
    }
  })

  test('never crosses providers or uploads a local-provider attachment', async () => {
    let calls = 0
    const otherProvider = await resolveMediaAttachments({
      primaryModel: { id: 'main', providerId: 'account-a', inputModalities: ['text'] },
      models: [{ id: 'gemini-3.5-flash', providerId: 'account-b', inputModalities: ['text', 'video'] }],
      attachments: [video],
      userGoal: '分析视频',
      requestConsent: consent('always'),
      sendCompletion: async () => { calls++; return '' },
    })
    const local = await resolveMediaAttachments({
      primaryModel: { id: 'main', providerId: 'local-ollama', inputModalities: ['text'] },
      models: [{ id: 'gemini-3.5-flash', providerId: 'local-ollama', inputModalities: ['text', 'video'] }],
      attachments: [video],
      userGoal: '分析视频',
      requestConsent: consent('always'),
      sendCompletion: async () => { calls++; return '' },
    })
    assert.equal(otherProvider.kind, 'local_tools_required')
    assert.equal(local.kind, 'local_tools_required')
    assert.equal(calls, 0)
  })

  test('refusal falls back to local tools without sending media', async () => {
    let calls = 0
    const result = await resolveMediaAttachments({
      primaryModel: models[0],
      models,
      attachments: [video],
      userGoal: '分析视频',
      requestConsent: consent('reject'),
      sendCompletion: async () => { calls++; return '' },
    })
    assert.equal(result.kind, 'local_tools_required')
    assert.equal(calls, 0)
  })

  test('invalid specialist output falls back instead of pretending media was read', async () => {
    const result = await resolveMediaAttachments({
      primaryModel: models[0],
      models,
      attachments: [video],
      userGoal: '分析视频',
      requestConsent: consent('always'),
      sendCompletion: async () => '{"results":[]}',
    })
    assert.equal(result.kind, 'local_tools_required')
  })
})
