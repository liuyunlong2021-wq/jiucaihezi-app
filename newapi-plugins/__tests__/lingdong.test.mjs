import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as plugin from '../lingdong.plugin.js'

const VIDEO = ['ld-2.5特价-1-720']
const IMAGE = ['ld-gpt-image-2.5-flare']
const BASE = 'https://www.lingdongapi.com'
const ctx = (model = VIDEO[0], extra = {}) => ({ model, upstreamModel: model, baseUrl: BASE, apiKey: 'test-key', requestBody: { model, prompt: '海边' }, ...extra })
const decode = (model, value = {}, kind = 'json') => plugin.protocols[IMAGE.includes(model) ? 'openai_image' : 'openai_video'].decodeRequest({ model, body: { kind, value: { model, prompt: '海边', ...value } } })

test('只保留两个前缀公开名，按图片与视频绑定协议', () => {
  assert.equal(plugin.meta.version, '0.4.1')
  assert.deepEqual(plugin.meta.models, [...VIDEO, ...IMAGE])
  assert.deepEqual(plugin.meta.protocols, [{ name: 'openai_video', models: VIDEO }, { name: 'openai_image', models: IMAGE }])
  assert.deepEqual(Object.keys(plugin.meta.usageSchema), ['calls', 'image_count'])
  for (const example of plugin.meta.usageExamples) for (const key of Object.keys(plugin.meta.usageSchema)) assert.ok(key in example.facts)
})

test('旧名、原始名、跨协议、无提示词和multipart明确拒绝', () => {
  for (const model of ['SD-2.5-特价', 'sd2.5-301010', 'sd2.5-满血-301010', ...IMAGE]) {
    assert.throws(() => plugin.protocols.openai_video.decodeRequest({ model, body: { kind: 'json', value: { model, prompt: 'x' } } }), /Unsupported model/)
  }
  assert.throws(() => plugin.protocols.openai_image.decodeRequest({ model: VIDEO[0], body: { kind: 'json', value: { model: VIDEO[0], prompt: 'x' } } }), /Unsupported model/)
  assert.throws(() => decode(VIDEO[0], { prompt: ' ' }), /prompt is required/)
  assert.throws(() => decode(IMAGE[0], {}, 'multipart'), /JSON/)
  assert.throws(() => plugin.protocols.openai_video.decodeRequest({ model: VIDEO[0], body: { kind: 'json', value: [] } }), /object/)
})

test('自动去掉ld前缀，上游显式映射优先', () => {
  for (const model of [...VIDEO, ...IMAGE]) for (const upstreamModel of [undefined, model, model.slice(3)]) {
    const request = plugin.buildSubmitRequest(ctx(model, { upstreamModel }))
    assert.equal(request.body.model, model.slice(3))
    assert.equal(request.headers.Authorization, 'Bearer test-key')
    assert.equal(request.url, BASE + (IMAGE.includes(model) ? '/v1/images/generations' : '/v1/videos'))
  }
  assert.equal(plugin.buildSubmitRequest(ctx(VIDEO[0], { upstreamModel: 'vendor-id' })).body.model, 'vendor-id')
})

test('视频参考三类素材、画幅时长保留，不发图片残留字段', () => {
  for (const model of VIDEO) {
    const value = { prompt: '回头', imageUrl: 'https://x.test/a.png?sig=1', videos: ['https://x.test/v.mp4'], audios: ['https://x.test/a.mp3'], aspect_ratio: '9:16', resolution: '720p', duration: '30', n: 4, size: '2k' }
    const intent = decode(model, value)
    assert.equal(intent.action, 'image_to_video')
    assert.deepEqual(plugin.buildSubmitRequest(ctx(model, { requestBody: intent.requestBody })).body, {
      model: model.slice(3), prompt: value.prompt, images: [value.imageUrl], videos: value.videos, audios: value.audios,
      ratio: '9:16', resolution: '720p', duration: 30, watermark: false,
    })
    assert.equal(decode(model).action, 'text_to_video')
  }
})

test('图片JSON URL参考、默认一张、张数校验，不静默丢弃非法素材', () => {
  for (const model of IMAGE) {
    const intent = decode(model, { images: ['https://x.test/a.png'], size: '720x1280', n: 2, duration: 30 })
    assert.equal(intent.action, 'image_to_image')
    assert.deepEqual(plugin.buildSubmitRequest(ctx(model, { requestBody: intent.requestBody })).body, {
      model: model.slice(3), prompt: '海边', images: ['https://x.test/a.png'], size: '720x1280', n: 2, response_format: 'url',
    })
    assert.equal(plugin.buildSubmitRequest(ctx(model)).body.n, 1)
    for (const n of [0, -1, 1.5, 'x']) assert.throws(() => decode(model, { n }), /positive integer/)
    assert.throws(() => decode(model, { videos: ['https://x.test/v.mp4'] }), /video or audio/)
    for (const url of ['data:image/png;base64,abc', 'blob:https://x.test/a', '/local.png', { ref: 'file' }]) assert.throws(() => decode(model, { images: [url] }), /HTTP/)
  }
})

test('即时图片结果按实际张数结算，不猜测未公开的图片轮询接口', () => {
  const body = { created: 1, data: [{ url: 'https://x.test/out.png' }, { b64_json: 'fixture' }] }
  const result = plugin.parseSubmitResponse(ctx(IMAGE[0], { publicTaskId: 'public-image' }), { body })
  assert.equal(result.immediate.status, 'SUCCESS')
  assert.equal(result.taskId, 'public-image')
  assert.deepEqual(plugin.protocols.openai_image.render({}, { data: result.taskData }), body)
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, result.taskData), { calls: 0, image_count: 2 })
  for (const data of [[], [{}], [{ url: '' }]]) assert.throws(() => plugin.parseSubmitResponse(ctx(IMAGE[0]), { body: { data } }), /image results/)
  assert.throws(() => plugin.parseSubmitResponse(ctx(IMAGE[0]), { body: { id: 'image-job', status: 'processing' } }), /image results/)
  assert.throws(() => plugin.buildQueryRequest(ctx(IMAGE[0], { taskId: 'image-job' })), /image polling/)
  assert.deepEqual(plugin.listArtifacts({ model: IMAGE[0], status: 'SUCCESS' }), [])
})

test('视频任务查询、状态、产物和HEAD鉴权不退化', () => {
  for (const key of ['id', 'task_id']) assert.equal(plugin.parseSubmitResponse(ctx(), { body: { [key]: 'task/a' } }).taskId, 'task/a')
  assert.throws(() => plugin.parseSubmitResponse(ctx(), { body: {} }), /task id/)
  assert.equal(plugin.buildQueryRequest(ctx(VIDEO[0], { taskId: 'task/a' })).url, BASE + '/v1/videos/task%2Fa')
  const req = plugin.buildContentRequest(ctx(VIDEO[0], { artifactKey: 'video', upstreamTaskId: 'task/a', clientRequest: { method: 'HEAD' } }))
  assert.equal(req.url, BASE + '/v1/videos/task%2Fa/content')
  assert.equal(req.method, 'HEAD')
  assert.equal(req.headers.Authorization, 'Bearer test-key')
  assert.throws(() => plugin.buildContentRequest(ctx(VIDEO[0], { artifactKey: 'poster' })), /artifact_not_found/)
  assert.equal(plugin.parseTaskResult({}, { status: 'processing' }).status, 'IN_PROGRESS')
  assert.equal(plugin.parseTaskResult({}, { status: 'completed' }).status, 'SUCCESS')
  assert.match(plugin.parseTaskResult({}, { status: 'failed', error: { message: '资源不足' } }).reason, /资源不足/)
  assert.equal(plugin.parseTaskResult({}, { status: 'unknown' }).status, 'UNKNOWN')
  assert.deepEqual(plugin.listArtifacts({ model: VIDEO[0], status: 'SUCCESS' }), [{ key: 'video', type: 'video', mimeType: 'video/mp4' }])
  assert.deepEqual(plugin.listArtifacts({ model: VIDEO[0], status: 'IN_PROGRESS' }), [])
  const view = plugin.protocols.openai_video.render({ artifacts: { video: { url: '/v1/videos/public/content' } } }, { task_id: 'public', status: 'SUCCESS' })
  assert.equal(view.video_url, '/v1/videos/public/content')
  assert.equal(JSON.stringify(view).includes('test-key'), false)
})

test('两个指定售价，视频按次、图片按张，视频不按时长加价', () => {
  const pricing = JSON.parse(readFileSync(new URL('../lingdong-pricing-2026-10-14.json', import.meta.url), 'utf8'))
  assert.equal(pricing.version, plugin.meta.version)
  assert.deepEqual(pricing.models.map(row => row.model), plugin.meta.models)
  const prices = [4, 0.08]
  for (const [index, row] of pricing.models.entries()) {
    assert.equal(row.upstreamModel, row.model.slice(3))
    assert.equal(row.salePriceCny, prices[index])
    assert.equal(row.expression, `tier("base", u("${IMAGE.includes(row.model) ? 'image_count' : 'calls'}") * ${prices[index]})`)
  }
  for (const model of VIDEO) for (const duration of [4, 30]) assert.deepEqual(plugin.extractUsage(ctx(model, { requestBody: { model, duration } })), { calls: 1, image_count: 0 })
  for (const model of IMAGE) {
    assert.deepEqual(plugin.extractUsage(ctx(model)), { calls: 0, image_count: 1 })
    assert.deepEqual(plugin.extractUsage(ctx(model, { requestBody: { model, n: 3 } })), { calls: 0, image_count: 3 })
  }
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, { status: 'completed' }), { calls: 1 })
})

test('宿主同步沙箱语法', () => {
  const source = readFileSync(new URL('../lingdong.plugin.js', import.meta.url), 'utf8')
  for (const token of ['.async', 'async function', 'await ', 'import ', 'require(', 'import(']) assert.equal(source.includes(token), false, token)
})

test('新映射与退役名单：只允许两个ld公开名提交，历史视频仍可下载', () => {
  const mapping = JSON.parse(readFileSync(new URL('../lingdong-model-mapping.json', import.meta.url), 'utf8'))
  assert.deepEqual(mapping, { 'ld-2.5特价-1-720': '2.5特价-1-720', 'ld-gpt-image-2.5-flare': 'gpt-image-2.5-flare' })
  for (const model of ['灵动-sd2.5-满血-301010', '灵动-sd2.5-满血-301010-2', '灵动-gpt-image-2.5-flare', '灵动-gpt-image-2.5-sunburst']) {
    assert.ok(!plugin.meta.models.includes(model))
    for (const protocol of Object.values(plugin.protocols)) {
      assert.throws(() => protocol.decodeRequest({ model, body: { kind: 'json', value: { model, prompt: 'p' } } }), /Unsupported/)
    }
  }
  assert.equal(plugin.listArtifacts({ model: '灵动-sd2.5-满血-301010', status: 'SUCCESS' })[0].key, 'video')
})
