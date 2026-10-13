import assert from 'node:assert/strict'
import test from 'node:test'
import * as plugin from '../xiaoyi-image.plugin.js'
const GPT = 'gpt-image-2.5-1k'
const GROK = 'grok-imagine-image-2.0'
const ctx = model => ({ model, baseUrl: plugin.meta.baseUrl, apiKey: 'fixture-key' })
function decode(value, model = GPT) {
 return plugin.protocols.openai_image.decodeRequest({ ...ctx(model), operation: 'generate', body: { kind: 'json', value } })
}
function submit(intent, model = GPT, overrides = {}) {
 return plugin.buildSubmitRequest({ ...ctx(model), requestBody: intent.requestBody, action: intent.action, ...overrides })
}

test('小易官方异步协议：别名映射、鉴权、提交/查询端点与 URL 结果', () => {
 const request = submit(decode({ prompt: 'p', size: '2048x1152', quality: 'high' }))
 assert.equal(request.url, 'https://image.xiaoyiapi.xyz/v1/images/generations/async')
 assert.equal(request.body.model, 'gpt-image-2.5')
 assert.equal(request.body.size, '2048x1152')
 assert.equal(request.body.quality, 'high')
 assert.equal(request.body.response_format, 'url')
 assert.equal(request.headers.Authorization, 'Bearer fixture-key')
 assert.equal(plugin.buildQueryRequest({ ...ctx(GPT), taskId: 'task/a' }).url, 'https://image.xiaoyiapi.xyz/v1/images/tasks/task%2Fa')
 assert.equal(plugin.parseSubmitResponse({}, { body: { task_id: 'task/a', status: 'running' } }).taskId, 'task/a')
})

test('小易 n 必须是正整数，实际请求数量与预扣数量一致，不静默截为10', () => {
 const intent = decode({ prompt: 'p', n: 12 })
 assert.equal(submit(intent).body.n, 12)
 assert.deepEqual(plugin.extractUsage({ requestBody: intent.requestBody }), { image_count: 12, seconds: 0, resolution: 'none' })
 for (const n of [0, -1, 1.5, 'no', Number.POSITIVE_INFINITY]) assert.throws(() => decode({ prompt: 'p', n }), /n must/)
})

test('官方 background/output_format 在 JSON 与 multipart 请求中完整保留', () => {
 const options = { background: 'transparent', output_format: 'webp' }
 const request = submit(decode({ prompt: 'p', ...options }))
 assert.equal(request.body.background, 'transparent')
 assert.equal(request.body.output_format, 'webp')
 const intent = plugin.protocols.openai_image.decodeRequest({ ...ctx(GPT), operation: 'edit', body: { kind: 'multipart', fields: { prompt: ['p'], background: ['transparent'], output_format: ['webp'] }, files: [{ ref: 'request_file:image', filename: 'a.png' }] } })
 const edit = submit(intent)
 assert.equal(edit.url, 'https://image.xiaoyiapi.xyz/v1/images/edits/async')
 assert.equal(edit.headers['Content-Type'], undefined)
 assert.ok(edit.parts.some(part => part.name === 'background' && part.value === 'transparent'))
 assert.ok(edit.parts.some(part => part.name === 'output_format' && part.value === 'webp'))
})

test('Grok 不能把 JSON 参考图静默当成文生图，size 与 aspect_ratio 必须一致', () => {
 assert.throws(() => decode({ prompt: 'p', images: ['https://a/ref.png'] }, GROK), /multipart/)
 assert.throws(() => decode({ prompt: 'p', size: '1024x1024', aspect_ratio: '9:16' }, GROK), /ratio/)
 const request = submit(decode({ prompt: 'p', size: '2048x1152', aspect_ratio: '16:9' }, GROK), GROK)
 assert.equal(request.body.aspect_ratio, '16:9')
 assert.equal(request.body.size, '2048x1152')
})

test('小易编辑逐文件保留 fileRef，多图 image[]，不得在文生图请求中丢掉图片', () => {
 const intent = plugin.protocols.openai_image.decodeRequest({ ...ctx(GPT), operation: 'edit', body: { kind: 'multipart', fields: { prompt: ['p'] }, files: [{ ref: 'request_file:image[]', filename: 'a.png' }, { ref: 'request_file:image[]#1', filename: 'b.png' }] } })
 const request = submit(intent)
 assert.deepEqual(request.parts.filter(part => part.fileRef).map(part => [part.name, part.fileRef]), [['image[]', 'request_file:image[]'], ['image[]', 'request_file:image[]#1']])
 assert.throws(() => decode({ prompt: 'p', image: 'https://a/ref.png' }), /multipart/)
})

test('小易 status=success 必须有图片，真实张数只统计 URL 或 Base64 图片', () => {
 assert.equal(plugin.parseTaskResult({}, { status: 'success', result: { data: [] } }).status, 'UNKNOWN')
 const body = { status: 'success', result: { data: [{ url: 'https://a/a.png?sig=keep' }, { b64_json: 'fixture' }, { revised_prompt: '没有图' }] } }
 assert.equal(plugin.parseTaskResult({}, body).status, 'SUCCESS')
 assert.deepEqual(plugin.extractUsageOnComplete({}, {}, body), { image_count: 2 })
 assert.equal(plugin.protocols.openai_image.render({}, { data: body }).data[0].url, 'https://a/a.png?sig=keep')
})

test('小易失败和未知状态保留原因，查询失败不会重新生成', () => {
 assert.equal(plugin.parseTaskResult({}, { status: 'running' }).status, 'IN_PROGRESS')
 assert.equal(plugin.parseTaskResult({}, { status: 'failed', error: { message: '素材无法解析' } }).reason, '素材无法解析')
 assert.equal(plugin.parseTaskResult({}, { status: 'unexpected' }).status, 'UNKNOWN')
 assert.equal(plugin.buildQueryRequest({ ...ctx(GPT), taskId: 'saved-task' }).method, 'GET')
 assert.throws(() => plugin.parseSubmitResponse({}, { body: { status: 'running' } }), /task id/)
})

test('小易视频三档：请求秒数字符串、分辨率和秒数用量一致，旧图片facts完整', () => {
 const model = 'grok-imagine-video-1.5'
 assert.ok(plugin.meta.models.includes(model))
 for (const [resolution, price] of [['480p', 0.2], ['720p', 0.3], ['1080p', 0.4]]) {
  const intent = plugin.protocols.openai_video.decodeRequest({ ...ctx(model), body: { kind: 'json', value: { prompt: 'p', duration: 10, resolution, ratio: '9:16' } } })
  const request = submit(intent, model)
  assert.equal(request.url, 'https://image.xiaoyiapi.xyz/v1/videos')
  assert.deepEqual(request.body, { model, prompt: 'p', seconds: '10', resolution, aspect_ratio: '9:16' })
  const facts = plugin.extractUsage({ ...ctx(model), requestBody: intent.requestBody })
  assert.deepEqual(facts, { seconds: 10, resolution, image_count: 0 })
  assert.equal(facts.seconds * price, { '480p': 2, '720p': 3, '1080p': 4 }[resolution])
 }
 for (const example of plugin.meta.usageExamples) assert.deepEqual(Object.keys(example.facts).sort(), Object.keys(plugin.meta.usageSchema).sort())
})

test('小易视频HTTPS单参考图生效，非法时长、档位、多图及冲突在创建前拒绝', () => {
 const model = 'grok-imagine-video-1.5'
 const video = value => plugin.protocols.openai_video.decodeRequest({ ...ctx(model), body: { kind: 'json', value: { prompt: 'p', ...value } } })
 const intent = video({ images: ['https://a/ref.png'], seconds: '6', resolution: '1080p' })
 assert.equal(intent.action, 'image_to_video')
 assert.equal(submit(intent, model).body.image, 'https://a/ref.png')
 assert.throws(() => video({ seconds: 15 }), /seconds/)
 assert.throws(() => video({ resolution: '4k' }), /resolution/)
 assert.throws(() => video({ images: ['https://a/1.png', 'https://a/2.png'] }), /at most one/)
 assert.throws(() => video({ image: 'data:image/png;base64,fixture' }), /HTTPS/)
 assert.throws(() => video({ seconds: 6, duration: 10 }), /conflicts/)
 assert.throws(() => video({ ratio: '16:9', aspect_ratio: '9:16' }), /Conflicting/)
 assert.throws(() => video({ audios: ['https://a/a.mp3'] }), /audio/)
})

test('小易视频ID、状态、带鉴权下载、图片协议隔离与计费保留', () => {
 const model = 'grok-imagine-video-1.5'
 const parsed = plugin.parseSubmitResponse(ctx(model), { body: { id: 'upstream/a', status: 'queued' } })
 assert.equal(parsed.taskId, 'upstream/a')
 assert.equal(plugin.buildQueryRequest({ ...ctx(model), taskId: parsed.taskId }).url, 'https://image.xiaoyiapi.xyz/v1/videos/upstream%2Fa')
 for (const [status, expected] of [['queued', 'QUEUED'], ['in_progress', 'IN_PROGRESS'], ['completed', 'SUCCESS'], ['failed', 'FAILURE']]) assert.equal(plugin.parseTaskResult(ctx(model), { status }).status, expected)
 assert.equal(plugin.parseTaskResult(ctx(model), { status: 'failed', error: { message: '素材失效' } }).reason, '素材失效')
 assert.equal(plugin.parseTaskResult(ctx(model), { status: 'unknown' }).status, 'UNKNOWN')
 const request = plugin.buildContentRequest({ ...ctx(model), upstreamTaskId: 'upstream/a', artifactKey: 'video', clientRequest: { method: 'HEAD' } })
 assert.equal(request.url, 'https://image.xiaoyiapi.xyz/v1/videos/upstream%2Fa/content')
 assert.equal(request.method, 'HEAD')
 assert.equal(request.headers.Authorization, 'Bearer fixture-key')
 assert.deepEqual(plugin.listArtifacts({ status: 'SUCCESS', data: parsed.taskData }), [{ key: 'video', type: 'video', mimeType: 'video/mp4' }])
 assert.deepEqual(plugin.listArtifacts({ status: 'SUCCESS', model: GPT }), [])
 assert.equal(plugin.extractUsageOnComplete({}, {}, { status: 'completed' }), null)
 assert.throws(() => decode({ prompt: 'p' }, model), /Unsupported Xiaoyi image model/)
 const view = plugin.protocols.openai_video.render({ artifacts: { video: { url: '/v1/videos/public/content' } } }, { task_id: 'public', status: 'SUCCESS', data: parsed.taskData })
 assert.equal(view.id, 'public')
 assert.equal(view.video_url, '/v1/videos/public/content')
 assert.ok(!JSON.stringify(view).includes('upstream/a'))
})
