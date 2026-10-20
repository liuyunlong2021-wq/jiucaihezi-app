import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import * as plugin from '../yihong.plugin.js'

const MODELS = ['yh-seedance2.5 Ultra', 'yh-seedance2.5 super', 'yh-seedance-2.5-Muse', 'yh-kling-omni-4.0', 'yh-seedance2.0 mini Love', 'yh-wan3.0-video']
const url = 'https://example.com/ref.png?sig=keep'
const ctx = model => ({ model, baseUrl: plugin.meta.baseUrl, apiKey: 'fixture-key' })
const decode = (model, fields = {}) => plugin.protocols.openai_video.decodeRequest({ ...ctx(model), body: { kind: 'json', value: Object.freeze({ model, prompt: 'p', ...fields }) } })
const build = (model, fields = {}, mapping = model) => {
 const intent = decode(model, fields)
 return plugin.buildSubmitRequest({ ...ctx(model), upstreamModel: mapping, requestBody: Object.freeze(intent.requestBody), action: intent.action })
}

test('仅六个yh视频型号，图片、fast Zeus和所有旧型号退出', () => {
 assert.equal(plugin.meta.version, '0.2.0')
 assert.deepEqual(plugin.meta.models, MODELS)
 assert.deepEqual(plugin.meta.protocols, [{ name: 'openai_video', models: MODELS }])
 assert.equal(plugin.protocols.openai_image, undefined)
 assert.deepEqual(Object.keys(plugin.meta.usageSchema).sort(), ['calls', 'resolution', 'seconds'])
 for (const example of plugin.meta.usageExamples) assert.deepEqual(Object.keys(example.facts).sort(), Object.keys(plugin.meta.usageSchema).sort())
 for (const model of ['seedance2.5 super', 'seedance-2.5-pro', 'yh-seedance2.0 fast Zeus', 'gpt-image-2', 'yihong-gpt-image-2', 'minimax H3']) assert.throws(() => decode(model), /model/)
})

test('公开名映射严格，保留计费身份和URL输入，JSON不变成文件', () => {
 for (const model of MODELS) {
  for (const mapping of [model, model.slice(3)]) {
   const req = build(model, { images: [url] }, mapping)
   assert.equal(req.body.model, model.slice(3))
   assert.equal(req.url, 'https://yihongapi.com/v1/videos')
   assert.equal(req.method, 'POST')
   assert.equal(req.headers.Authorization, 'Bearer fixture-key')
   assert.equal(req.headers['Content-Type'], 'application/json')
  }
  assert.equal(decode(model).model, model)
  assert.throws(() => build(model, {}, 'wrong-upstream'), /mapping/)
 }
 assert.throws(() => plugin.protocols.openai_video.decodeRequest({ model: MODELS[0], body: { kind: 'multipart' } }), /JSON/)
 assert.throws(() => decode(MODELS[0], { model: MODELS[1] }), /model/)
})

test('Ultra 10–30整数、默认30秒、14图10音频、音频必须有图，按次不乘时长', () => {
 const model = MODELS[0]
 assert.equal(build(model).body.seconds, 30)
 for (const seconds of [10, 15, 30]) {
  const req = build(model, { seconds, images: [url], audios: ['http://example.com/a.mp3'] })
  assert.equal(req.body.seconds, seconds)
  assert.deepEqual(req.body.image_urls, [url])
  assert.deepEqual(req.body.audio_urls, ['http://example.com/a.mp3'])
  assert.equal(req.body.resolution, '720p')
  const intent = decode(model, { seconds })
  assert.deepEqual(plugin.extractUsage({ ...ctx(model), requestBody: intent.requestBody }), { calls: 1, seconds, resolution: '720P' })
 }
 for (const seconds of [9, 31, 10.5]) assert.throws(() => build(model, { seconds }), /seconds/)
 assert.throws(() => build(model, { audios: [url] }), /image/)
 assert.throws(() => build(model, { images: Array(15).fill(url) }), /images/)
 assert.throws(() => build(model, { images: [url], audios: Array(11).fill(url) }), /audios/)
 assert.throws(() => build(model, { videos: [url] }), /videos/)
 assert.throws(() => build(model, { resolution: '1080p' }), /resolution/)
})

test('Super普通数组与media互斥，首尾帧/多媒体类型不丢失', () => {
 const model = MODELS[1]
 assert.deepEqual(build(model, { seconds: 5, images: [url], videos: [url], audios: [url] }).body, { model: model.slice(3), prompt: 'p', seconds: 5, resolution: '720p', image_urls: [url], video_urls: [url], audio_urls: [url] })
 const media = [{ type: 'first_frame', url }, { type: 'last_frame', url }]
 assert.deepEqual(build(model, { media }).body.media, media)
 assert.deepEqual(build(model, { media: [{ type: 'reference_video', url, duration_seconds: 5 }] }).body.media, [{ type: 'reference_video', url }])
 assert.throws(() => build(model, { media, images: [url] }), /combined/)
 assert.throws(() => build(model, { media: [], images: [url] }), /combined/)
 assert.throws(() => build(model, { resolution: '1080p' }), /resolution/)
 assert.throws(() => build(model, { images: Array(31).fill(url) }), /images/)
})

test('Muse仅四档时长，不接受首尾帧/音视频/未知参数，不静默修正', () => {
 const model = MODELS[2]
 for (const seconds of [5, 10, 15, 30]) assert.equal(build(model, { seconds }).body.seconds, seconds)
 assert.equal(build(model).body.seconds, 30)
 for (const seconds of [6, 20]) assert.throws(() => build(model, { seconds }), /seconds/)
 for (const fields of [{ media: [{ type: 'first_frame', url }] }, { videos: [url] }, { audios: [url] }, { seed: 1 }, { n: 1 }]) assert.throws(() => build(model, fields))
 assert.deepEqual(build(model, { images: [url], ratio: '9:16' }).body.image_urls, [url])
})

test('Love使用images而非image_urls，支持单首帧和content音频，默认无声', () => {
 const model = MODELS[4]
 const req = build(model, { seconds: 8, images: [url], resolution: '480p' })
 assert.deepEqual(req.body.images, [url])
 assert.equal(req.body.image_urls, undefined)
 assert.equal(req.body.generate_audio, undefined)
 assert.equal(build(model).body.resolution, '720p')
 assert.equal(build(model, { input_reference: url }).body.input_reference, url)
 assert.deepEqual(build(model, { image_urls: [url] }).body.images, [url])
 const content = [
  { type: 'image_url', image_url: { url }, role: 'first_frame' },
  { type: 'image_url', image_url: { url }, role: 'last_frame' },
  { type: 'audio_url', audio_url: { url: 'https://example.com/a.mp3' }, role: 'reference_audio' },
 ]
 const full = build(model, { content, generate_audio: true, seed: 0, watermark: false, camera_fixed: true, return_last_frame: false })
 assert.deepEqual(full.body.content, content)
 assert.equal(full.body.generate_audio, true)
 assert.equal(full.body.seed, 0)
 assert.throws(() => build(model, { content, images: [url] }), /combined/)
 assert.throws(() => build(model, { content: [], images: [url] }), /combined/)
 assert.throws(() => build(model, { content: [content[1]] }), /first_frame/)
 assert.throws(() => build(model, { images: Array(10).fill(url) }), /images/)
 assert.throws(() => build(model, { videos: [url] }), /videos/)
 assert.throws(() => build(model, { generate_audio: 'true' }), /boolean/)
 assert.throws(() => build(model, { audios: [{ url, duration_seconds: 1 }] }), /duration_seconds/)
})

test('Kling 3–30秒、10图3音频、不接受视频/首尾帧', () => {
 const model = MODELS[3]
 assert.equal(build(model, { seconds: 3, images: [url], audios: [url] }).body.seconds, 3)
 assert.throws(() => build(model, { seconds: 2 }), /seconds/)
 assert.throws(() => build(model, { videos: [url] }), /videos/)
 assert.throws(() => build(model, { media: [{ type: 'first_frame', url }] }), /media/)
 assert.throws(() => build(model, { audios: Array(4).fill(url) }), /audios/)
})

test('Wan普通多模态转media，大小写、片段时长/总时长与首尾互斥', () => {
 const model = MODELS[5]
 assert.equal(build(model).body.resolution, '480P')
 const body = build(model, { resolution: '720p', images: [url], videos: [{ url, duration_seconds: 4 }], audios: [{ url, duration_seconds: 3 }], prompt_extend: false }).body
 assert.equal(body.resolution, '720P')
 assert.equal(body.prompt_extend, false)
 assert.deepEqual(body.media, [{ type: 'reference_image', url }, { type: 'reference_video', url, duration_seconds: 4 }, { type: 'reference_audio', url, duration_seconds: 3 }])
 assert.equal(body.image_urls, undefined)
 assert.equal(build(model, { media: [{ type: 'reference_audio', url, duration_seconds: 0.5 }] }).body.media[0].duration_seconds, 0.5)
 assert.throws(() => build(model, { videos: [url] }), /duration_seconds/)
 assert.throws(() => build(model, { media: [8, 8].map(duration_seconds => ({ type: 'reference_audio', url, duration_seconds })) }), /total duration/)
 assert.throws(() => build(model, { media: [{ type: 'last_frame', url }] }), /first_frame/)
 assert.throws(() => build(model, { media: [{ type: 'first_frame', url }], images: [url] }), /combined/)
 assert.throws(() => build(model, { media: Array(11).fill({ type: 'reference_image', url }) }), /images|reference_image/)
})

test('签名URL原样，无效素材/冲突字段/未知参数在提交前拒绝', () => {
 for (const model of MODELS) {
  assert.throws(() => build(model, { images: ['file:///private/ref.png'] }), /URL/)
  assert.throws(() => build(model, { images: [url], image_urls: ['https://example.com/other.png'] }), /Conflicting/)
  assert.throws(() => build(model, { size: '1024x1024' }), /Unsupported/)
  assert.throws(() => build(model, { prompt: ' ' }), /prompt/)
  const intent = decode(model, { images: [url], seconds: model === MODELS[0] ? 10 : 5 })
  const usage = plugin.extractUsage({ ...ctx(model), requestBody: Object.freeze(intent.requestBody) })
  assert.ok(plugin.meta.usageSchema.resolution.enum.includes(usage.resolution))
 }
})

test('真实任务号、失败原因、同Key查询/鉴权content保持，查询不重新生成', () => {
 assert.equal(plugin.parseSubmitResponse({}, { body: { id: 'task/a' } }).taskId, 'task/a')
 assert.throws(() => plugin.parseSubmitResponse({}, { body: {} }), /task id/)
 const config = { ...ctx(MODELS[0]), taskId: 'task/a', upstreamTaskId: 'task/a', artifactKey: 'video', clientRequest: { method: 'HEAD' } }
 assert.equal(plugin.buildQueryRequest(config).url, 'https://yihongapi.com/v1/videos/task%2Fa')
 assert.equal(plugin.buildQueryRequest(config).method, 'GET')
 assert.equal(plugin.buildContentRequest(config).url, 'https://yihongapi.com/v1/videos/task%2Fa/content')
 assert.equal(plugin.buildContentRequest(config).headers.Authorization, 'Bearer fixture-key')
 assert.equal(plugin.buildContentRequest(config).method, 'HEAD')
 for (const [status, expected] of [['queued', 'QUEUED'], ['in_progress', 'IN_PROGRESS'], ['completed', 'SUCCESS'], ['failed', 'FAILURE']]) assert.equal(plugin.parseTaskResult({}, { status }).status, expected)
 assert.equal(plugin.parseTaskResult({}, { status: 'failed', error: { message: '失败原因' } }).reason, '失败原因')
 assert.equal(plugin.parseTaskResult({}, { status: 'unknown' }).status, 'UNKNOWN')
 assert.deepEqual(plugin.extractUsageOnComplete(), { calls: 1 })
 assert.deepEqual(plugin.listArtifacts({ status: 'SUCCESS' }), [{ key: 'video', type: 'video', mimeType: 'video/mp4' }])
 assert.deepEqual(plugin.listArtifacts({ status: 'IN_PROGRESS' }), [])
})

test('用户售价与公开名清单一致，按次不乘时长，按秒按实际请求档位', () => {
 const pricing = JSON.parse(readFileSync(new URL('../yihong-pricing.json', import.meta.url), 'utf8'))
 assert.equal(pricing.plugin, plugin.meta.key)
 assert.equal(pricing.version, plugin.meta.version)
 assert.deepEqual(pricing.models.map(item => item.model), MODELS)
 const expected = [8.5, 0.5, 9, 0.25, { '480P': 0.15, '720P': 0.25 }, { '480P': 0.2, '720P': 0.3, '1080P': 0.4 }]
 pricing.models.forEach((item, index) => {
  assert.equal(item.upstreamModel, item.model.slice(3))
  assert.deepEqual(item.salePriceCny, expected[index])
  // Only evaluate our checked-in expression fixture, never server/user text.
  const evaluate = new Function('u', 'tier', 'return (' + item.expression + ')')
  const cases = typeof expected[index] === 'number' ? [['720P', expected[index]]] : Object.entries(expected[index])
  for (const [resolution, price] of cases) {
   const seconds = item.model === MODELS[0] ? 10 : 5
   const intent = decode(item.model, { seconds, resolution })
   const facts = plugin.extractUsage({ ...ctx(item.model), requestBody: intent.requestBody })
   const actual = evaluate(key => facts[key], (_tier, amount) => amount)
   assert.equal(actual, item.unit === '次' ? price : price * seconds)
  }
 })
})
