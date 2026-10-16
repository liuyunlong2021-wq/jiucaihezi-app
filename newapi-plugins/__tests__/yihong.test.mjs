import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import * as plugin from '../yihong.plugin.js'

const models = [
  ['seedance-2.5-omni', 29, '720p', 12],
  ['seedance-2.5-pro', 30, '720p', 10],
  ['seedance-2.0-mini-Muse', 15, '720p', 2],
  ['Wan3.0 pro max', 30, '480p', 5],
  ['wan3.0-video-prime', 5, '480P'],
  ['grok-imagine-video-1.5-preview', 15, '720p', 1],
]
function submit(model, fields = {}) {
  return plugin.buildSubmitRequest({
    model, baseUrl: plugin.meta.baseUrl, apiKey: 'fixture-key',
    requestBody: { model, prompt: '镜头推进', ...fields },
  })
}

test('Max 仅透传官方 auto/fixed 运镜，固定 30 秒并保留图片参考', () => {
  const model = 'seedance-2.5-max'
  for (const camera_movement of ['auto', 'fixed']) {
    const request = submit(model, { camera_movement, images: ['https://a/i.png'] })
    assert.deepEqual(request.body, { model, prompt: '镜头推进', duration: 30, camera_movement, image_urls: ['https://a/i.png'] })
  }
  assert.equal(submit(model).body.camera_movement, undefined)
  assert.equal(submit('seedance2.5 cheap', { camera_movement: 'fixed' }).body.camera_movement, undefined)
  assert.throws(() => submit(model, { camera_movement: 'handheld' }), /camera_movement/)
})

test('NewAPI 解码请求的分辨率通过 usage enum，发上游仍使用官方大小写', () => {
  const cases = [
    ...models.map(([model, seconds, resolution]) => [model, resolution, resolution]),
    ['wan3.0-video-prime', '720p', '720P'],
    ['wan3.0-video-prime', '1080p', '1080P'],
    ['grok-imagine-video-1.5-preview', '480p', '480p'],
    ['grok-imagine-video-1.5-preview', '1080p', '1080p'],
    ['minimax H3', '768p', '768p'],
    ...['seedance2.5 super', 'seedance2.5 cheap', 'seedance-2.5-max', 'seedance-2.5-Muse']
      .map(model => [model, '1080p', undefined]),
  ]
  for (const [model, resolution, upstreamResolution] of cases) {
    for (const input of [resolution, resolution.toUpperCase(), undefined]) {
      const source = Object.freeze({ model, prompt: 'p', resolution: input, ratio: '9:16', image: 'https://a/i.png' })
      const intent = plugin.protocols.openai_video.decodeRequest({ model, body: { kind: 'json', value: source } })
      // rc.40 在构建上游请求前按 usageSchema 校验解码后的请求体。
      assert.ok(plugin.meta.usageSchema.resolution.enum.includes(intent.requestBody.resolution), model)
      const usage = plugin.extractUsage({ model, requestBody: intent.requestBody })
      assert.equal(intent.requestBody.resolution, usage.resolution)
      const request = plugin.buildSubmitRequest({ model, baseUrl: plugin.meta.baseUrl, requestBody: intent.requestBody })
      assert.equal(request.body.resolution, input === undefined ? submit(model).body.resolution : upstreamResolution)
      assert.equal(intent.action, 'image_to_video')
      if (model === 'Wan3.0 pro max') {
        assert.equal(request.body.seconds, 30)
        assert.equal(request.body.ratio, '9:16')
        assert.deepEqual(request.body.image_urls, ['https://a/i.png'])
      }
    }
  }
  const model = 'Wan3.0 pro max'
  assert.throws(() => plugin.protocols.openai_video.decodeRequest({ model, body: { kind: 'json', value: { model, prompt: 'p', resolution: '720p' } } }), /resolution/)
})

test('图片解码也规范化 resolution，GPT 按 size 确定实际计费档位', () => {
  for (const [model, fields, expected] of [
    ['gemini-nano-banana-2.1', { resolution: '4k' }, '4K'],
    ['gpt-image-2-1K-4K', { resolution: '1k', size: '3840x2160' }, '4K'],
  ]) {
    const source = Object.freeze({ model, prompt: 'p', ...fields })
    const intent = plugin.protocols.openai_image.decodeRequest({ model, body: { kind: 'json', value: source } })
    assert.ok(plugin.meta.usageSchema.resolution.enum.includes(intent.requestBody.resolution))
    assert.equal(intent.requestBody.resolution, expected)
    assert.equal(plugin.extractUsage({ requestBody: intent.requestBody }).resolution, expected)
    const request = plugin.buildSubmitRequest({ model, baseUrl: plugin.meta.baseUrl, requestBody: intent.requestBody })
    if (model.startsWith('gemini')) assert.equal(request.body.generationConfig.imageConfig.imageSize, expected)
    else assert.equal(request.body.size, fields.size)
  }
})

test('新增六个型号：白名单、默认时长、分辨率、面板与取整售价一致', () => {
  const registry = readFileSync(new URL('../../src/runtime/creation/creationModelRegistry.ts', import.meta.url), 'utf8')
  const capabilities = readFileSync(new URL('../../src/data/mediaModelCapabilities.ts', import.meta.url), 'utf8')
  for (const [model, seconds, resolution, price] of models) {
    assert.ok(plugin.meta.models.includes(model))
    const request = submit(model)
    assert.equal(request.url, 'https://yihongapi.com/v1/videos')
    assert.equal(request.headers.Authorization, 'Bearer fixture-key')
    assert.deepEqual(request.body, model.startsWith('grok-') ? { model, prompt: '镜头推进', resolution } : { model, prompt: '镜头推进', seconds, resolution })
    assert.ok(registry.includes(`model: '${model}'`))
    assert.ok(capabilities.includes(`id: '${model}'`))
    if (price) assert.ok(registry.includes(`price: '¥${price}/次'`))
  }
  assert.deepEqual([9, 8, 1.5, 4].map(price => Math.round(price * 1.3)), [12, 10, 2, 5])
  assert.deepEqual([0.27, 0.35, 0.36].map(price => Math.round(price * 130) / 100), [0.35, 0.46, 0.47])
})

test('新型号按真实参数校验，Pro 接受多模态，Omni 不接受视频', () => {
  assert.throws(() => submit('seedance-2.5-omni', { seconds: 30 }), /seconds/)
  assert.throws(() => submit('seedance-2.5-omni', { videos: ['https://a/v.mp4'] }), /videos/)
  assert.throws(() => submit('seedance-2.5-pro', { ratio: '1:1' }), /ratio/)
  assert.throws(() => submit('seedance-2.5-pro', { resolution: '480p' }), /resolution/)
  assert.throws(() => submit('seedance-2.0-mini-Muse', { images: Array(10).fill('https://a/i.png') }), /images/)
  assert.throws(() => submit('Wan3.0 pro max', { seconds: 1 }), /seconds/)
  const body = submit('seedance-2.5-pro', { images: ['https://a/i.png'], videos: ['https://a/v.mp4'], audios: ['https://a/a.mp3'] }).body
  assert.deepEqual(body.video_urls, ['https://a/v.mp4'])
  assert.deepEqual(body.audio_urls, ['https://a/a.mp3'])
})

test('Prime 转换参考素材并保留视频时长，按分辨率报完整用量', () => {
  const model = 'wan3.0-video-prime'
  for (const resolution of ['480P', '720P', '1080P']) {
    assert.deepEqual(plugin.extractUsage({ requestBody: { model, seconds: 10, resolution } }), { calls: 1, seconds: 10, resolution, image_count: 0 })
  }
  const fields = { resolution: '1080p', images: ['https://a/i.png'], videos: [{ url: 'https://a/v.mp4', duration_seconds: 4 }], audios: ['https://a/a.mp3'], prompt_extend: false }
  const body = submit(model, fields).body
  assert.equal(body.resolution, '1080P')
  assert.equal(body.prompt_extend, false)
  assert.deepEqual(body.media, [
    { type: 'reference_image', url: 'https://a/i.png' },
    { type: 'reference_video', url: 'https://a/v.mp4', duration_seconds: 4 },
    { type: 'reference_audio', url: 'https://a/a.mp3' },
  ])
  assert.equal(body.video_urls, undefined)
  const intent = plugin.protocols.openai_video.decodeRequest({ model, body: { kind: 'json', value: { model, prompt: 'p', media: body.media } } })
  assert.equal(intent.action, 'image_to_video')
})

test('Prime 拒绝缺失时长、超长视频、首尾帧混用、超量和非法素材', () => {
  const model = 'wan3.0-video-prime'
  assert.throws(() => submit(model, { videos: ['https://a/v.mp4'] }), /duration_seconds/)
  assert.throws(() => submit(model, { media: [8, 8].map(duration_seconds => ({ type: 'reference_video', url: 'https://a/v.mp4', duration_seconds })) }), /total duration/)
  assert.throws(() => submit(model, { media: [{ type: 'first_frame', url: 'https://a/i.png' }], images: ['https://a/r.png'] }), /cannot be combined/)
  assert.throws(() => submit(model, { images: Array(11).fill('https://a/i.png') }), /Too many/)
  assert.throws(() => submit(model, { media: [{ type: 'invalid', url: 'https://a/i.png' }] }), /Unsupported media/)
  assert.throws(() => submit(model, { images: ['file:///i.png'] }), /HTTPS/)
  assert.throws(() => submit(model, { resolution: '4k' }), /resolution/)
})

test('旧模型请求与完成结算保持兼容，examples 提供完整 schema', () => {
  assert.equal(submit('seedance2.5 super').body.seconds, 5)
  assert.equal(submit('seedance2.5 cheap').body.seconds, 15)
  assert.equal(submit('seedance-2.5-max', { seconds: 8 }).body.duration, 30)
  assert.equal(submit('seedance-2.5-Muse').body.seconds, 30)
  assert.equal(submit('seedance2.5 super', { resolution: '1080p' }).body.resolution, undefined)
  for (const example of plugin.meta.usageExamples) {
    assert.deepEqual(Object.keys(example.facts).sort(), Object.keys(plugin.meta.usageSchema).sort())
  }
  assert.deepEqual(plugin.extractUsageOnComplete(), { calls: 1 })
})

test('异步状态、失败原因、成片代理不受新型号影响', () => {
  assert.equal(plugin.parseSubmitResponse({}, { body: { id: 'upstream-task' } }).taskId, 'upstream-task')
  for (const [status, expected] of [['queued', 'QUEUED'], ['in_progress', 'IN_PROGRESS'], ['completed', 'SUCCESS'], ['failed', 'FAILURE']]) {
    assert.equal(plugin.parseTaskResult({}, { status }).status, expected)
  }
  assert.equal(plugin.parseTaskResult({}, { status: 'failed', error: { message: '退款' } }).reason, '退款')
  assert.equal(plugin.buildContentRequest({ artifactKey: 'video', baseUrl: plugin.meta.baseUrl, apiKey: 'fixture-key', upstreamTaskId: 'task/a', clientRequest: { method: 'HEAD' } }).url, 'https://yihongapi.com/v1/videos/task%2Fa/content')
})


test('Grok 固定 15 秒，首帧/多图互斥，字段和分辨率用量正确', () => {
  const model = 'grok-imagine-video-1.5-preview'
  const first = submit(model, { input_reference: 'https://a/i.png', aspect_ratio: '3:2', resolution: '1080p' }).body
  assert.deepEqual(first, { model, prompt: '镜头推进', image_url: 'https://a/i.png', aspect_ratio: '3:2', resolution: '1080p' })
  const refs = ['https://a/i.png', 'data:image/png;base64,fixture']
  assert.deepEqual(submit(model, { images: refs }).body.reference_images, refs)
  assert.deepEqual(submit(model, { reference_images: refs }).body.reference_images, refs)
  assert.equal(submit(model, { images: refs }).body.image_urls, undefined)
  assert.throws(() => submit(model, { image_url: refs[0], reference_images: refs }), /cannot be combined/)
  assert.throws(() => submit(model, { reference_images: Array(8).fill(refs[0]) }), /images/)
  assert.throws(() => submit(model, { seconds: 10 }), /seconds/)
  assert.throws(() => submit(model, { audios: ['https://a/a.mp3'] }), /audios/)
  assert.deepEqual(plugin.extractUsage({ requestBody: { model, resolution: '1080p' } }), { calls: 1, seconds: 15, resolution: '1080P', image_count: 0 })
  assert.equal(Math.round(0.7 * 1.3), 1)
})

test('官方文档：Prime 尾帧不能独立提交，非媒体型号不能静默丢掉首尾帧', () => {
  assert.throws(() => submit('wan3.0-video-prime', { media: [{ type: 'last_frame', url: 'https://a/last.png' }] }), /first_frame/)
  assert.throws(() => submit('seedance-2.5-pro', { media: [{ type: 'first_frame', url: 'https://a/first.png' }] }), /media/)
  assert.throws(() => submit('seedance-2.0-mini-Muse', { last_frame_image_url: 'https://a/last.png' }), /frame/)
})

test('官方文档：H3 用 duration、attachments，视频必须带时长', () => {
  const body = submit('minimax H3', { duration: 8, images: ['https://a/i.png'], attachments: [{ type: 'video', url: 'https://a/v.mp4', duration_seconds: 5 }], ai_enhance: true, seed: 0, negative_prompt: '模糊' }).body
  assert.equal(body.duration, 8)
  assert.equal(submit('minimax H3', { duration: 8, seconds: 10 }).body.duration, 8)
  assert.equal(body.seconds, undefined)
  assert.equal(body.resolution, '768p')
  assert.equal(body.ai_enhance, true)
  assert.equal(body.seed, 0)
  assert.deepEqual(body.attachments, [{ type: 'video', url: 'https://a/v.mp4', duration_seconds: 5 }])
  assert.throws(() => submit('minimax H3', { videos: ['https://a/v.mp4'] }), /duration_seconds/)
  assert.throws(() => submit('minimax H3', { attachments: Array(4).fill({ type: 'audio', url: 'https://a/a.mp3', duration_seconds: 3 }) }), /audio/)
})


test('同步图片：GPT JSON 编辑与分辨率计费，拒绝错尺寸、超量及多张输出', () => {
  const model = 'gpt-image-2-1K-4K'
  const req = submit(model, { size: '3840x2160', images: ['https://a/i.png'], quality: 'high' })
  assert.equal(req.url, 'https://yihongapi.com/v1/images/edits')
  assert.deepEqual(req.body, { model, prompt: '镜头推进', size: '3840x2160', n: 1, response_format: 'b64_json', images: [{ image_url: 'https://a/i.png' }] })
  assert.deepEqual(plugin.extractUsage({ requestBody: { model, prompt: 'p', size: '3840x2160' } }), { calls: 1, seconds: 0, resolution: '4K', image_count: 1 })
  assert.throws(() => submit(model, { size: 'auto' }), /size/)
  assert.throws(() => submit(model, { n: 2 }), /n must/)
  assert.throws(() => submit(model, { images: Array(11).fill('https://a/i.png') }), /Too many/)
})

test('易红 GPT Image 新型号使用 yihong-公开名映射到上游原名', () => {
  for (const model of ['yihong-gpt-image-2', 'yihong-gpt-image-2.5-flare', 'yihong-gpt-image-2.5-sunburst']) {
    const upstreamModel = model.replace(/^yihong-/, '')
    assert.ok(plugin.meta.models.includes(model))
    assert.ok(plugin.meta.models.includes(upstreamModel))
    const decoded = plugin.protocols.openai_image.decodeRequest({
      model,
      body: { kind: 'json', value: { model, prompt: 'p', size: '1024x1024' } },
    })
    const request = plugin.buildSubmitRequest({
      model,
      upstreamModel,
      baseUrl: plugin.meta.baseUrl,
      requestBody: decoded.requestBody,
    })
    assert.equal(request.url, 'https://yihongapi.com/v1/images/generations')
    assert.equal(request.body.model, upstreamModel)
    assert.deepEqual(plugin.extractUsage({ requestBody: decoded.requestBody }), {
      calls: 1, seconds: 0, resolution: '1K', image_count: 1,
    })
  }
})

test('Gemini multipart 参考图转原生 inline_data，比例画质保留，返回 OpenAI 图片形状', () => {
  const model = 'gemini-nano-banana-2.1'
  const decoded = plugin.protocols.openai_image.decodeRequest({ model, operation: 'edit', body: { kind: 'multipart', fields: { prompt: ['p'], resolution: ['4k'], ratio: ['9:16'] }, files: [{ ref: 'request_file:image', mimeType: 'image/png' }] } })
  assert.ok(plugin.meta.usageSchema.resolution.enum.includes(decoded.requestBody.resolution))
  const req = plugin.buildSubmitRequest({ model, baseUrl: plugin.meta.baseUrl, requestBody: decoded.requestBody })
  assert.equal(req.url, 'https://yihongapi.com/v1beta/models/gemini-nano-banana-2.1:generateContent')
  assert.deepEqual(req.body.generationConfig.imageConfig, { imageSize: '4K', aspectRatio: '9:16' })
  assert.deepEqual(req.body.contents[0].parts[1].inline_data.data, { __fileRef: 'request_file:image', encoding: 'base64', maxBytes: 20 * 1024 * 1024 })
  const b64 = 'x'.repeat(2 * 1024 * 1024)
  const parsed = plugin.parseSubmitResponse({ model, publicTaskId: 'public-image' }, { body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: b64 } }] } }] } })
  assert.equal(parsed.immediate.status, 'SUCCESS')
  assert.equal(parsed.taskId, 'public-image')
  assert.equal(plugin.protocols.openai_image.render({}, { data: parsed.taskData }).data[0].b64_json, b64)
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, parsed.taskData), { calls: 1, image_count: 1 })
  assert.throws(() => submit(model, { images: ['https://a/i.png'] }), /multipart/)
  assert.throws(() => plugin.parseSubmitResponse({ model }, { body: { candidates: [] } }), /exactly one/)
})
