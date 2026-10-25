import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as plugin from '../fk.plugin.js'

test('FK usageSchema 单位符合宿主枚举，人民币金额通过 unitLabel 说明', () => {
 for (const [key, field] of Object.entries(plugin.meta.usageSchema)) {
   assert.ok(['second', 'count', 'token', 'credit'].includes(field.unit), `${key}: unsupported unit ${field.unit}`)
 }
 assert.equal(plugin.meta.usageSchema.upstream_cost_yuan.unit, 'count')
 assert.equal(plugin.meta.usageSchema.upstream_cost_yuan.unitLabel.zh, '元')
})

const MODEL = 'ft-image-v1-211f28f47b0355abb1798f72eb65f22d'
const BANANA = 'ft-image-v1-80fa79934b03dcdc7a54dacdb1ad7f82'
const URL = 'https://ai.fanke2026.xyz/api/image/result/job/0?exp=123&sig=signature'
function ctx(model = MODEL) { return { model, upstreamModel: model, baseUrl: plugin.meta.baseUrl, apiKey: 'fixture-key' } }
function decode(value, model = MODEL) {
 return plugin.protocols.openai_image.decodeRequest({ ...ctx(model), body: { kind: 'json', value } })
}

test('FK 图片即时成功仍查询原 jobId，以持久结果提供全部图片制品', () => {
 const urls = [URL, URL + '&image=2']
 const body = { jobId: 'image/job', success: true, status: 'success', resultAvailable: true, resultUrls: urls }
 const submitted = plugin.parseSubmitResponse(ctx(), { body })
 assert.equal(submitted.immediate, undefined)
 assert.equal(submitted.taskId, 'image/job')
 const query = plugin.buildQueryRequest({ ...ctx(), taskId: submitted.taskId })
 assert.equal(query.method, 'GET')
 assert.match(query.url, /\/image\/status\?jobId=image%2Fjob/)
 const completed = plugin.parseTaskResult(ctx(), body)
 const artifactContext = { taskId: 'public-task', status: completed.status, action: 'text_to_image', data: body }
 assert.deepEqual(plugin.listArtifacts(artifactContext), [{ key: 'image_0', type: 'image' }, { key: 'image_1', type: 'image' }])
 for (const action of ['text_to_image', 'image_to_image']) {
   for (const method of ['GET', 'HEAD']) {
     for (let index = 0; index < urls.length; index++) {
       assert.deepEqual(plugin.buildContentRequest({ ...artifactContext, action, artifactKey: 'image_' + index, clientRequest: { method } }), {
         url: urls[index], method, credentialless: true,
       })
     }
   }
 }
 for (const key of ['video', 'image_-1', 'image_01', 'image_2', 'image_0junk']) {
   assert.throws(() => plugin.buildContentRequest({ ...artifactContext, artifactKey: key, clientRequest: { method: 'GET' } }), /artifact_not_found/)
 }
 assert.deepEqual(plugin.listArtifacts({ ...artifactContext, status: 'IN_PROGRESS' }), [])
 assert.deepEqual(plugin.listArtifacts({ ...artifactContext, data: null }), [])
 assert.deepEqual(plugin.listArtifacts({ ...artifactContext, data: { resultUrls: ['http://unsafe/image'] } }), [])
 assert.deepEqual(plugin.protocols.openai_image.render({}, { data: body }), { data: urls.map(url => ({ url })) })
 assert.deepEqual(plugin.listArtifacts({ status: 'SUCCESS', action: 'text_to_video', data: { videoUrl: URL } }), [{ key: 'video', type: 'video', mimeType: 'video/mp4' }])
})

test('FK 标准图片 JSON 合同：公共 ID、鉴权、画质、图片 URL 和端点', () => {
 const intent = decode({ prompt: '一只小狗', ratio: '16:9', imageSize: '4k', imageUrls: ['https://a/ref.png'] })
 const request = plugin.buildSubmitRequest({ ...ctx(), requestBody: intent.requestBody, action: intent.action })
 assert.equal(request.url, 'https://ai.fanke2026.xyz/api/open/v1/image/generate')
 assert.equal(request.headers.Authorization, 'Bearer fixture-key')
 assert.equal(request.headers['X-Public-Model-Ids'], '1')
 assert.deepEqual(request.body, { model: MODEL, prompt: '一只小狗', ratio: '16:9', imageSize: '4K', imageUrls: ['https://a/ref.png'] })
})

test('FK multipart 使用 images 字段和宿主 fileRef，不写死 boundary', () => {
 const intent = plugin.protocols.openai_image.decodeRequest({ ...ctx(), body: { kind: 'multipart', fields: { prompt: ['p'], imageSize: ['2K'] }, files: [{ ref: 'request_file:image', filename: 'a.png' }] } })
 const request = plugin.buildSubmitRequest({ ...ctx(), requestBody: intent.requestBody })
 assert.equal(request.bodyType, 'multipart')
 assert.equal(request.headers['Content-Type'], undefined)
 assert.deepEqual(request.parts.at(-1), { name: 'images', fileRef: 'request_file:image', filename: 'a.png' })
})

test('FK 错误画质、比例、超量和混合文件/URL 在提交前被拒绝', () => {
 assert.throws(() => decode({ prompt: 'p', imageSize: '8K' }), /imageSize/)
 assert.throws(() => decode({ prompt: 'p', ratio: '7:5' }), /ratio/)
 assert.throws(() => decode({ prompt: 'p', imageUrls: Array(11).fill('https://a/ref.png') }), /10/)
 assert.throws(() => decode({ prompt: 'p', imageUrls: Array(9).fill('https://a/ref.png') }, BANANA), /8/)
 assert.throws(() => plugin.protocols.openai_image.decodeRequest({ ...ctx(), body: { kind: 'multipart', fields: { prompt: ['p'], imageUrls: ['https://a/ref.png'] }, files: [{ ref: 'file', filename: 'a.png' }] } }), /combined/)
})

test('FK success=false 是请求失败，不得把 status 和 URL 当生成成功', () => {
 assert.throws(() => plugin.parseSubmitResponse(ctx(), { body: { success: false, jobId: 'job', status: 'success', resultUrls: [URL], error: { message: '没有权限' } } }), /没有权限/)
 assert.throws(() => plugin.parseTaskResult(ctx(), { success: false, status: 'success', resultAvailable: true, resultUrls: [URL], errorMessage: '查询失败' }), /查询失败/)
})

test('FK 保存真实 jobId，结果不可用时查询已有任务，保留完整签名 URL', () => {
 const submitted = plugin.parseSubmitResponse(ctx(), { body: { success: true, jobId: 'job/a', status: 'submitted' } })
 assert.equal(submitted.taskId, 'job/a')
 const query = plugin.buildQueryRequest({ ...ctx(), taskId: submitted.taskId })
 assert.match(query.url, /\/api\/open\/v1\/image\/status\?jobId=job%2Fa/)
 assert.equal(query.method, 'GET')
 assert.equal(plugin.parseTaskResult(ctx(), { success: true, status: 'success', resultAvailable: true, resultUrls: [URL] }).status, 'SUCCESS')
 assert.equal(plugin.parseTaskResult(ctx(), { success: true, status: 'success', resultAvailable: false, resultUrls: [URL] }).status, 'IN_PROGRESS')
 assert.equal(plugin.parseTaskResult(ctx(), { success: true, status: 'success', resultUrls: [URL] }).status, 'IN_PROGRESS')
 assert.equal(plugin.protocols.openai_image.render({}, { data: { resultUrls: [URL] } }).data[0].url, URL)
 assert.equal(plugin.parseSubmitResponse(ctx(), { body: { success: true, jobId: 'job', status: 'success', resultAvailable: false, resultUrls: [URL] } }).immediate, undefined)
 assert.throws(() => plugin.parseSubmitResponse(ctx(), { body: { success: true, status: 'success', resultUrls: [URL] } }), /jobId/)
})

test('FK 失败原因保留 error.message，用量不混入参考图数量', () => {
 const result = plugin.parseTaskResult(ctx(), { success: true, status: 'failed', error: { message: '参数组合错误' } })
 assert.equal(result.status, 'FAILURE')
 assert.equal(result.reason, '参数组合错误')
 assert.deepEqual(plugin.extractUsage(ctx()), { seconds: 0, seconds_480p: 0, seconds_720p: 0, seconds_1080p: 0, image_count: 1 })
 assert.deepEqual(plugin.extractUsageOnComplete(ctx(), {}, { resultUrls: [URL] }), { image_count: 1, seconds_1080p: 0 })
})

const VIDEO = 'ft-video-v1-451adae35b0c4a3d275c2c46394abc98'
const SPECIAL = 'ft-video-v1-43644108aaba72b7cbad4cd322737f6c'
const H3 = 'ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746'

test('FK 成功响应缺少可靠计费字段时保留预扣，不以零用量全额退款', () => {
 const model = 'ft-video-v1-b8a797753dd4c6bf8e5a69820b293848'
 const body = { jobId: 'job', success: true, status: 'success', videoUrl: URL, billing: null }
 for (const requestBody of [undefined, {}, { duration: 22 }, { resolution: '720p' }]) {
   assert.equal(plugin.extractUsageOnComplete({ ...ctx(model), requestBody }, {}, body), null)
 }
 assert.equal(plugin.extractUsageOnComplete(ctx(model), {}, { ...body, duration: 22 }), null)
 assert.equal(plugin.extractUsageOnComplete(ctx(model), {}, { ...body, duration: 22, resolution: '1080p' }), null)
 assert.equal(plugin.extractUsageOnComplete(ctx(VIDEO), {}, body), null)
 assert.equal(plugin.extractUsageOnComplete(ctx(H3), {}, body), null)
 for (const resolution of ['480p', '720p']) {
   const context = { ...ctx(model), requestBody: { duration: 22, resolution } }
   assert.equal(plugin.extractUsageOnComplete(context, {}, body)['seconds_' + resolution], 22)
   const result = plugin.extractUsageOnComplete(ctx(model), {}, { data: { ...body, duration: 20, resolution } })
   assert.equal(result['seconds_' + resolution], 20)
 }
 assert.equal(plugin.extractUsageOnComplete(ctx(SPECIAL), {}, body).calls, 1)
 const token = { ...body, billing: { mode: 'token', settled: true, usage: { total_tokens: 123456 }, charged_cost_cents: 389 } }
 assert.equal(plugin.extractUsageOnComplete(ctx(VIDEO), {}, token).video_reference_tokens, 123456)
 assert.equal(plugin.extractUsageOnComplete(ctx(VIDEO), {}, { ...token, billing: { ...token.billing, settled: false } }), null)
})
const OFFICIAL_20 = [
 ['官方渠道-Seedance 2.0 Mini 720p', 'ft-video-v1-e820a676bd820bff4a79d2571fdb7fde', 0.4, 10.5],
 ['官方渠道-Seedance 2.0 Fast 720p', 'ft-video-v1-0a4bb4e7f4e95d0bd4ef584f2a4db1a3', 0.6, 16.5],
 ['官方渠道-Seedance 2.0 满血 720p', 'ft-video-v1-24ee1a4df896ea53869d6a2e5ae59a30', 0.7, 21],
]

test('FK 退役型号拒绝新提交', () => {
 for (const [name, id] of OFFICIAL_20) {
   assert.ok(!plugin.meta.models.includes(name))
   assert.ok(!plugin.meta.models.includes(id))
   assert.throws(() => video({ duration: 5 }, id), /Unsupported/)
 }
})

test('FK H3 当前合同支持公开映射、本地文件和标准 jobId 查询', () => {
 for (const upstreamModel of ['特价渠道 MiniMax H3 480p-1080p', H3]) {
   const context = { ...ctx('特价渠道 MiniMax H3 480p-1080p'), upstreamModel }
   const intent = plugin.protocols.openai_video.decodeRequest({ ...context, body: {
     kind: 'multipart', fields: { prompt: ['p'], duration: ['1'], resolution: ['768p'], ratio: ['4:3'] },
     files: [{ field: 'images', ref: 'request_file:images', filename: 'a.png' }, { field: 'audios', ref: 'request_file:audios', filename: 'a.mp3' }],
   } })
   const request = plugin.buildSubmitRequest({ ...context, requestBody: intent.requestBody })
   assert.equal(request.url, 'https://ai.fanke2026.xyz/api/open/v1/video/generate')
   assert.equal(request.headers['X-Public-Model-Ids'], '1')
   assert.equal(request.parts.find(part => part.name === 'model').value, H3)
   assert.deepEqual(request.parts.slice(-2).map(part => part.name), ['images', 'audios'])
   const submitted = plugin.parseSubmitResponse(context, { body: { success: true, jobId: 'h3/job', taskId: 'provider' } })
   assert.equal(submitted.taskId, 'h3/job')
   assert.match(plugin.buildQueryRequest({ ...context, taskId: submitted.taskId }).url, /video\/status\?jobId=h3%2Fjob/)
   assert.equal(plugin.parseTaskResult(context, { success: true, status: 'success' }).status, 'IN_PROGRESS')
   assert.equal(plugin.parseTaskResult(context, { success: true, status: 'success', videoUrl: URL }).status, 'SUCCESS')
 }
 assert.ok(plugin.meta.models.includes('特价渠道 MiniMax H3 480p-1080p'))
 for (const value of [{ duration: 0 }, { duration: 16 }, { duration: 1, resolution: '720p' }, { duration: 1, videoUrls: ['https://a/v.mp4'] }, { duration: 1, imageUrls: Array(10).fill('https://a/i.png') }, { duration: 1, audioUrls: Array(4).fill('https://a/a.mp3') }])
   assert.throws(() => video(value, H3))
 const legacy = { ...ctx(H3), data: { id: 'old-h3', job_id: 'old-h3' }, taskId: 'old-h3' }
 assert.equal(plugin.buildQueryRequest(legacy).url, 'https://ai.fanke2026.xyz/v1/videos/old-h3')
})

test('FK 视频字符串错误不丢失，避免只显示生成失败', () => {
 const result = plugin.parseTaskResult(ctx(VIDEO), { status: 'failed', error: '模型补量中' })
 assert.equal(result.reason, '模型补量中')
 assert.equal(plugin.protocols.openai_video.render({}, { status: 'FAILURE', data: { error: '模型补量中' } }).error, '模型补量中')
})

test('FK 中文公开名可提交且始终转为真实公共 ID，计费和轮询保持正确', () => {
 for (const [name, model, duration] of [
   ['Seedance 2.5 满血 480-720p', 'ft-video-v1-b8a797753dd4c6bf8e5a69820b293848', 15],
   ['XN2-Seedance 2.5 满血 480-720p', 'ft-video-v1-756e0feb4b3e1f893726314109762123', 15],
   ['官方渠道-Seedance 2.5 满血 720p', VIDEO, 15],
 ]) {
   assert.ok(plugin.meta.models.includes(name))
   for (const upstreamModel of [name, model]) {
     const context = { ...ctx(name), upstreamModel }
     const intent = plugin.protocols.openai_video.decodeRequest({ ...context, body: { kind: 'json', value: { model: name, prompt: 'p', duration, resolution: '720p' } } })
     assert.equal(intent.model, name)
     assert.equal(plugin.buildSubmitRequest({ ...context, requestBody: intent.requestBody }).body.model, model)
     assert.equal(plugin.extractUsage({ ...context, requestBody: intent.requestBody }).calls, [SPECIAL, 'ft-video-v1-99d13a482c1f6f0e71db1e36c4154b70', 'ft-video-v1-bdf45387433ac0a9042ebab3fae0299d'].includes(model) ? 1 : 0)
     assert.match(plugin.buildQueryRequest({ ...context, taskId: 'job' }).url, /video\/status\?jobId=job/)
   }
 }
})
function video(value, model = VIDEO) {
 return plugin.protocols.openai_video.decodeRequest({ ...ctx(model), body: { kind: 'json', value: { model, prompt: 'p', ...value } } })
}

test('FK 标准视频请求：别名归一、公共 ID、字段白名单及 jobId 轮询', () => {
 const intent = video({ seconds: 10, aspect_ratio: '9:16', resolution: '720p', image: 'https://a/ref.png', ignored: 'x' })
 const request = plugin.buildSubmitRequest({ ...ctx(VIDEO), requestBody: intent.requestBody })
 assert.equal(request.url, 'https://ai.fanke2026.xyz/api/open/v1/video/generate')
 assert.equal(request.headers['X-Public-Model-Ids'], '1')
 assert.deepEqual(request.body, { model: VIDEO, prompt: 'p', duration: 10, ratio: '9:16', resolution: '720p', imageUrls: ['https://a/ref.png'] })
 const submitted = plugin.parseSubmitResponse(ctx(VIDEO), { body: { success: true, jobId: 'job/a', taskId: 'provider-id', status: 'submitted' } })
 assert.equal(submitted.taskId, 'job/a')
 assert.match(plugin.buildQueryRequest({ ...ctx(VIDEO), taskId: submitted.taskId }).url, /video\/status\?jobId=job%2Fa&_t=/)
 assert.throws(() => plugin.parseSubmitResponse(ctx(VIDEO), { body: { success: true, taskId: 'provider' } }), /jobId/)
 assert.throws(() => plugin.parseSubmitResponse(ctx(VIDEO), { body: { success: false, errorMessage: '余额不足' } }), /余额不足/)
})

test('FK 视频模型限制拒绝无效组合、超量、旧型号和非 HTTPS 素材', () => {
 assert.throws(() => video({ duration: 3 }, SPECIAL), /duration/)
 assert.throws(() => video({ duration: 4, resolution: '480p', videoUrls: Array(4).fill('https://a/ref.mp4') }, SPECIAL), /videos/)
 assert.throws(() => video({ duration: 5, resolution: '1080p' }), /resolution/)
 assert.throws(() => video({ duration: 5.5 }), /duration/)
 assert.throws(() => video({ duration: 5, imageUrls: ['http://a/ref.png'] }), /HTTPS/)
 assert.throws(() => video({ duration: 5 }, 'ft-video-v1-fe82aee0b8ce5ee1d790a56291dc5563'), /Unsupported/)
 assert.throws(() => video({ duration: 15, prompt: 'p'.repeat(10001) }, 'ft-video-v1-756e0feb4b3e1f893726314109762123'), /prompt/)
})

test('FK 视频成功须有成片与 Token 结算，签名 URL 经免鉴权代理回收', () => {
 const body = { success: true, status: 'success', videoUrl: URL, billing: { mode: 'token', settled: false, usage: { total_tokens: 123456 }, charged_cost_cents: 389 } }
 assert.equal(plugin.parseTaskResult(ctx(VIDEO), body).status, 'IN_PROGRESS')
 body.billing.settled = true
 assert.equal(plugin.parseTaskResult(ctx(VIDEO), body).status, 'SUCCESS')
 assert.equal(plugin.parseTaskResult(ctx(VIDEO), { success: true, status: 'success' }).status, 'IN_PROGRESS')
 assert.throws(() => plugin.parseTaskResult(ctx(VIDEO), { success: false, errorMessage: '查询失败' }), /查询失败/)
 const content = plugin.buildContentRequest({ ...ctx(VIDEO), artifactKey: 'video', data: body, clientRequest: { method: 'GET' } })
 assert.deepEqual(content, { url: URL, method: 'GET', credentialless: true })
 const facts = plugin.extractUsageOnComplete({ ...ctx(VIDEO), requestBody: video({ duration: 5, videoUrls: ['https://a/ref.mp4'] }).requestBody }, {}, body)
 assert.equal(facts.seconds, 0)
 assert.equal(facts.video_reference_tokens, 123456)
 assert.equal(facts.upstream_cost_yuan, 3.89)
 assert.equal(plugin.extractUsageOnComplete(ctx(VIDEO), {}, { ...body, billing: { ...body.billing, settled: false } }), null)
 assert.equal(plugin.extractUsage({ ...ctx(SPECIAL), requestBody: video({ duration: 4, resolution: '480p' }, SPECIAL).requestBody }).calls, 1)
 assert.equal(plugin.extractUsage({ ...ctx(SPECIAL), requestBody: video({ duration: 4, resolution: '480p' }, SPECIAL).requestBody }).seconds, 0)
 const withVideo = { ...ctx(VIDEO), requestBody: video({ duration: 5, videoUrls: ['https://a/ref.mp4'] }).requestBody }
 assert.equal(plugin.parseTaskResult(withVideo, { success: true, status: 'success', videoUrl: URL }).status, 'IN_PROGRESS')
 for (const billing of [{ ...body.billing, usage: { total_tokens: -1 } }, { ...body.billing, charged_cost_cents: null }, { ...body.billing, mode: 'second' }]) {
   assert.equal(plugin.parseTaskResult(withVideo, { ...body, billing }).status, 'IN_PROGRESS')
 }
})

test('FK 视频 multipart 使用重复素材字段，不写死 boundary', () => {
 const intent = plugin.protocols.openai_video.decodeRequest({ ...ctx(VIDEO), body: { kind: 'multipart', fields: { prompt: ['p'], duration: ['5'], resolution: ['720p'] }, files: [{ field: 'images', ref: 'request_file:images', filename: 'a.png' }, { field: 'videos', ref: 'request_file:videos', filename: 'a.mp4' }] } })
 const request = plugin.buildSubmitRequest({ ...ctx(VIDEO), requestBody: intent.requestBody })
 assert.equal(request.headers['Content-Type'], undefined)
 assert.equal(request.bodyType, 'multipart')
 assert.deepEqual(request.parts.slice(-2), [{ name: 'images', fileRef: 'request_file:images', filename: 'a.png' }, { name: 'videos', fileRef: 'request_file:videos', filename: 'a.mp4' }])
})

test('FK 历史视频保留兼容轮询及 content 回收，examples 覆盖完整 schema', () => {
 const old = ctx('ft-video-v1-fe82aee0b8ce5ee1d790a56291dc5563')
 assert.equal(plugin.buildQueryRequest({ ...old, taskId: 'old-job' }).url, 'https://ai.fanke2026.xyz/v1/videos/old-job')
 assert.equal(plugin.buildContentRequest({ ...old, artifactKey: 'video', upstreamTaskId: 'old-job', clientRequest: { method: 'GET' } }).url, 'https://ai.fanke2026.xyz/v1/videos/old-job/content')
 const previous = { ...ctx(VIDEO), taskId: 'compat-job', data: { id: 'compat-job', job_id: 'old-platform-job' } }
 assert.equal(plugin.buildQueryRequest(previous).url, 'https://ai.fanke2026.xyz/v1/videos/compat-job')
 assert.equal(plugin.parseTaskResult(previous, { status: 'completed' }).status, 'SUCCESS')
 assert.equal(plugin.extractUsage({ ...ctx('ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746'), requestBody: { duration: 3, resolution: '768p' } }).seconds, 3)
 assert.equal(plugin.meta.models.filter(id => id.startsWith('ft-video-v1-')).length, 7)
 for (const example of plugin.meta.usageExamples) assert.deepEqual(Object.keys(example.facts).sort(), Object.keys(plugin.meta.usageSchema).sort())
})

test('FK Wan 3.0 映射、规格、HTTPS素材和两档计费', () => {
 const name = 'Wan 3.0 720-1080p'
 const id = 'ft-video-v1-9cf6b90d6d04866453951fc3a26720aa'
 assert.ok(plugin.meta.models.includes(name))
 assert.ok(plugin.meta.models.includes(id))
 const pricing = JSON.parse(readFileSync(new globalThis.URL('../fk-pricing.json', import.meta.url))).models.find(model => model.model === name)
 assert.equal(pricing.upstreamModel, id)
 assert.deepEqual(pricing.salePriceCnyPerSecond, { '720p': 0.2, '1080p': 0.25 })
 assert.equal(pricing.expression, 'tier("base", u("seconds_720p") * 0.2 + u("seconds_1080p") * 0.25)')
 assert.deepEqual(JSON.parse(readFileSync(new globalThis.URL('../fk-wan30-model-mapping.json', import.meta.url))), { [name]: id })
 for (const model of [name, id]) {
   for (const resolution of ['720p', '1080p']) {
     for (const duration of [2, 30]) {
       const intent = video({ duration, resolution, imageUrls: Array(10).fill('https://a/i.png'), videoUrls: Array(5).fill('https://a/v.mp4'), audioUrls: Array(5).fill('https://a/a.mp3') }, model)
       const request = plugin.buildSubmitRequest({ ...ctx(model), requestBody: intent.requestBody })
       assert.equal(request.body.model, id)
       assert.equal(request.body.prompt_extend, false)
       const context = { ...ctx(model), requestBody: request.body }
       const estimated = plugin.extractUsage(context)
       assert.equal(estimated['seconds_' + resolution], duration)
       const actual = plugin.extractUsageOnComplete(context, {}, { duration: 3, resolution })
       assert.equal(actual['seconds_' + resolution], 3)
       assert.equal(actual[resolution === '720p' ? 'seconds_1080p' : 'seconds_720p'], 0)
       assert.equal(actual.seconds_720p * 0.2 + actual.seconds_1080p * 0.25, resolution === '720p' ? 3 * 0.2 : 0.75)
     }
   }
   assert.equal(video({ duration: 2, prompt_extend: true }, model).requestBody.prompt_extend, true)
   for (const value of [{ duration: 1 }, { duration: 31 }, { duration: 2.5 }, { resolution: '480p' }, { ratio: '21:9' }, { imageUrls: Array(11).fill('https://a/i') }, { videoUrls: Array(6).fill('https://a/v') }, { audioUrls: Array(6).fill('https://a/a') }, { imageUrls: ['http://a/i'] }, { prompt_extend: 'true' }]) assert.throws(() => video({ duration: 2, ...value }, model))
 }
})
