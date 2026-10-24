import test from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../yihong.plugin.js'

test('易红仅三款；Ultra三档画质，H3使用duration与attachments', () => {
 assert.deepEqual([...plugin.meta.models].sort(), ['yh-minimax H3', 'yh-seedance2.5 Ultra', 'yh-wan3.0-video'].sort())
 const build = (model, value) => {
  const ctx = { model, baseUrl: plugin.meta.baseUrl, apiKey: 'fixture' }
  const intent = plugin.protocols.openai_video.decodeRequest({ ...ctx, body: { kind: 'json', value: { prompt: 'p', ...value } } })
  return plugin.buildSubmitRequest({ ...ctx, requestBody: intent.requestBody }).body
 }
 for (const resolution of ['480p', '720p', '1080p']) assert.equal(build('yh-seedance2.5 Ultra', { resolution }).resolution, resolution)
 const body = build('yh-minimax H3', { duration: 10, images: ['https://a/ref.png'], audios: ['https://a/ref.mp3'] })
 assert.equal(body.model, 'minimax H3')
 assert.equal(body.duration, 10)
 assert.equal(body.seconds, undefined)
 assert.deepEqual(body.attachments, [{ type: 'audio', url: 'https://a/ref.mp3' }])
})

test('H3素材与可选参数严格校验，旧型号拒绝新提交', () => {
 const model = 'yh-minimax H3'
 const decode = value => plugin.protocols.openai_video.decodeRequest({ model, body: { kind: 'json', value: { prompt: 'p', ...value } } })
 for (const attachments of [[{ type: 'video', url: 'https://a/v.mp4' }], [{ type: 'video', url: 'https://a/v.mp4', duration_seconds: 1 }], [{ type: 'text', url: 'https://a/x' }], [{ type: 'audio', url: 'http://a/x' }]]) assert.throws(() => decode({ attachments }))
 assert.throws(() => decode({ images: Array(9).fill('https://a/i.png'), audios: Array(2).fill('https://a/a.mp3') }), /10 total/)
 const attachments = [{ type: 'video', url: 'https://a/v.mp4', duration_seconds: 2 }]
 const intent = decode({ attachments, ai_enhance: false, seed: 0, negative_prompt: 'blur' })
 assert.equal(intent.action, 'image_to_video')
 const request = plugin.buildSubmitRequest({ model, baseUrl: plugin.meta.baseUrl, requestBody: intent.requestBody })
 assert.deepEqual(request.body.attachments, attachments)
 assert.equal(request.body.ai_enhance, false)
 assert.equal(plugin.extractUsage({ model, requestBody: intent.requestBody }).seconds, 10)
 for (const retired of ['yh-seedance2.5 super', 'yh-seedance-2.5-Muse', 'yh-kling-omni-4.0', 'yh-seedance2.0 mini Love']) {
  assert.throws(() => plugin.protocols.openai_video.decodeRequest({ model: retired, body: { kind: 'json', value: { prompt: 'p' } } }), /Unsupported model/)
 }
})
