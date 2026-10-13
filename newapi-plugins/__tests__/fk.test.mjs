import assert from 'node:assert/strict'
import test from 'node:test'
import * as plugin from '../fk.plugin.js'

const MODEL = 'ft-image-v1-211f28f47b0355abb1798f72eb65f22d'
const BANANA = 'ft-image-v1-80fa79934b03dcdc7a54dacdb1ad7f82'
const URL = 'https://ai.fanke2026.xyz/api/image/result/job/0?exp=123&sig=signature'
function ctx(model = MODEL) { return { model, upstreamModel: model, baseUrl: plugin.meta.baseUrl, apiKey: 'fixture-key' } }
function decode(value, model = MODEL) {
 return plugin.protocols.openai_image.decodeRequest({ ...ctx(model), body: { kind: 'json', value } })
}

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
 assert.deepEqual(plugin.extractUsage(ctx()), { seconds: 0, seconds_480p: 0, seconds_720p: 0, image_count: 1 })
 assert.deepEqual(plugin.extractUsageOnComplete(ctx(), {}, { resultUrls: [URL] }), { image_count: 1 })
})

test('FK 旧视频路由和计费用量保持可用，examples 覆盖完整 schema', () => {
 const model = 'ft-video-v1-fe82aee0b8ce5ee1d790a56291dc5563'
 const intent = plugin.protocols.openai_video.decodeRequest({ ...ctx(model), body: { kind: 'json', value: { model, prompt: 'p', seconds: 10, ratio: '9:16' } } })
 assert.equal(plugin.buildSubmitRequest({ ...ctx(model), requestBody: intent.requestBody }).url, 'https://ai.fanke2026.xyz/v1/videos')
 assert.equal(plugin.extractUsage({ ...ctx(model), requestBody: intent.requestBody }).seconds, 10)
 for (const example of plugin.meta.usageExamples) assert.deepEqual(Object.keys(example.facts).sort(), Object.keys(plugin.meta.usageSchema).sort())
})
