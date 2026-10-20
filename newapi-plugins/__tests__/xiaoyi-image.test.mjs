import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import * as plugin from '../xiaoyi-image.plugin.js'

const MODELS = {
 'xy-gpt-image-2-1k': 'gpt-image-2',
 'xy-gpt-image-2.5-1k': 'gpt-image-2.5',
 'xy-gpt-image-2.5-flare-1k': 'gpt-image-2.5-flare',
 'xy-gpt-image-2.5-sunburst-1k': 'gpt-image-2.5-sunburst',
 'xy-grok-imagine-image-2.0': 'grok-imagine-image-2.0',
}
const GPT = Object.keys(MODELS)[0]
const GROK = 'xy-grok-imagine-image-2.0'
const ctx = (model = GPT) => ({ model, upstreamModel: model, baseUrl: plugin.meta.baseUrl, apiKey: 'fixture-key' })
const decode = (value, model = GPT) => plugin.protocols.openai_image.decodeRequest({ ...ctx(model), operation: 'generate', body: { kind: 'json', value } })
const edit = (fields = {}, files = [{ ref: 'request_file:image', field: 'image', filename: 'a.png' }], model = GPT) =>
 plugin.protocols.openai_image.decodeRequest({ ...ctx(model), operation: 'edit', body: { kind: 'multipart', fields: { prompt: ['p'], ...fields }, files } })
const submit = (intent, model = GPT, overrides = {}) => plugin.buildSubmitRequest({ ...ctx(model), requestBody: intent.requestBody, action: intent.action, ...overrides })

test('仅五个 xy 图片公开名，没有视频协议与视频用量', () => {
 assert.equal(plugin.meta.key, 'xiaoyi-image')
 assert.equal(plugin.meta.version, '0.3.1')
 assert.deepEqual(plugin.meta.models, Object.keys(MODELS))
 assert.deepEqual(plugin.meta.protocols, [{ name: 'openai_image', models: Object.keys(MODELS) }])
 assert.equal(plugin.protocols.openai_video, undefined)
 assert.equal(plugin.buildContentRequest, undefined)
 assert.equal(plugin.listArtifacts, undefined)
 assert.deepEqual(Object.keys(plugin.meta.usageSchema), ['image_count'])
 for (const example of plugin.meta.usageExamples) assert.deepEqual(Object.keys(example.facts), ['image_count'])
 for (const model of ['gpt-image-2-1k', 'grok-imagine-image-2.0', 'grok-imagine-video-1.5']) assert.throws(() => decode({ prompt: 'p' }, model), /Unsupported/)
})

test('五型号文生图：去除公开别名、标准异步端点与 Base64 返回', () => {
 for (const [model, upstream] of Object.entries(MODELS)) {
  const request = submit(decode({ prompt: 'p', size: '1024x1024' }, model), model)
  assert.equal(request.url, 'https://image.xiaoyiapi.xyz/v1/images/generations/async')
  assert.equal(request.body.model, upstream)
  assert.equal(request.body.response_format, 'b64_json')
  assert.equal(request.headers.Authorization, 'Bearer fixture-key')
  assert.equal(request.body.size, '1024x1024')
  assert.equal(submit(decode({ prompt: 'p' }, model), model, { upstreamModel: upstream }).body.model, upstream)
 }
 assert.throws(() => submit(decode({ prompt: 'p' }), GPT, { upstreamModel: 'gpt-image-2.5-CF' }), /mapping|model/i)
 const intent = decode({ prompt: 'p' })
 Object.freeze(intent.requestBody)
 assert.equal(submit(intent).body.size, '1024x1024')
})

test('五型号编辑直接使用宿主文件引用，单图 image、多图 image[]，无存储上传', () => {
 for (const model of Object.keys(MODELS)) {
  const single = submit(edit({}, undefined, model), model)
  assert.equal(single.url, 'https://image.xiaoyiapi.xyz/v1/images/edits/async')
  assert.equal(single.bodyType, 'multipart')
  assert.equal(single.headers['Content-Type'], undefined)
  assert.deepEqual(single.parts.find(part => part.fileRef), { name: 'image', fileRef: 'request_file:image', filename: 'a.png' })
  assert.equal(single.parts.find(part => part.name === 'response_format').value, 'b64_json')
  assert.equal(single.parts.find(part => part.name === 'model').value, MODELS[model])
  const files = [{ ref: 'request_file:image[]', field: 'image[]', filename: 'a.png' }, { ref: 'request_file:image[]#1', field: 'image[]', filename: 'b.png' }]
  const multiple = submit(edit({}, files, model), model)
  assert.deepEqual(multiple.parts.filter(part => part.fileRef).map(part => [part.name, part.fileRef]), [['image[]', 'request_file:image[]'], ['image[]', 'request_file:image[]#1']])
 }
})

test('参考文件字段校验，不能把非图片字段当参考图或静默忽略 JSON 素材', () => {
 assert.throws(() => edit({}, []), /at least one/)
 assert.throws(() => edit({}, [{ ref: 'request_file:video', field: 'video', filename: 'a.mp4' }]), /field|image/i)
 for (const model of Object.keys(MODELS)) {
  for (const field of ['image', 'images', 'image_url', 'image_urls', 'imageUrl', 'imageUrls', 'input_reference', 'image[]']) {
   assert.throws(() => decode({ prompt: 'p', [field]: ['https://example.com/ref.png'] }, model), /multipart/)
  }
 }
})

test('n 正整数、预扣与实际返回张数一致，默认规格及可选参数保持', () => {
 const intent = decode({ prompt: 'p', n: 12, quality: 'high', background: 'transparent', output_format: 'webp' })
 const request = submit(intent)
 assert.equal(request.body.n, 12)
 assert.equal(request.body.size, '1024x1024')
 assert.equal(request.body.quality, 'high')
 assert.equal(request.body.background, 'transparent')
 assert.equal(request.body.output_format, 'webp')
 assert.deepEqual(plugin.extractUsage({ requestBody: intent.requestBody }), { image_count: 12 })
 for (const n of [0, -1, 1.5, 'no', Infinity]) assert.throws(() => decode({ prompt: 'p', n }), /n must/)
 const requestEdit = submit(edit({ background: ['transparent'], output_format: ['webp'] }))
 assert.ok(requestEdit.parts.some(part => part.name === 'background' && part.value === 'transparent'))
 assert.ok(requestEdit.parts.some(part => part.name === 'output_format' && part.value === 'webp'))
})

test('Grok 显式像素尺寸及比例一致，JSON 图片不能伪装编辑', () => {
 assert.throws(() => decode({ prompt: 'p', size: '1024x1024', aspect_ratio: '9:16' }, GROK), /ratio/)
 const request = submit(decode({ prompt: 'p', size: '2048x1152', aspect_ratio: '16:9' }, GROK), GROK)
 assert.equal(request.body.size, '2048x1152')
 assert.equal(request.body.aspect_ratio, '16:9')
})

test('四个 GPT 拒绝已知 2K/4K 档位，Grok 支持 1K/2K，quality 不当分辨率', () => {
 for (const model of Object.keys(MODELS)) {
  assert.equal(submit(decode({ prompt: 'p', size: '864x1536', quality: 'high' }, model), model).body.size, '864x1536')
  if (model !== GROK) {
   for (const size of ['2048x2048', '2048x1152', '1152x2688', '2880x2880', '3840x2160']) {
    assert.throws(() => decode({ prompt: 'p', size }, model), /1K/)
    assert.throws(() => edit({ size: [size] }, undefined, model), /1K/)
   }
   assert.throws(() => decode({ prompt: 'p', resolution: '2k' }, model), /1K/)
  } else {
   for (const size of ['2048x2048', '2048x1152', '1152x2688']) assert.equal(submit(decode({ prompt: 'p', size }, model), model).body.size, size)
   assert.throws(() => decode({ prompt: 'p', size: '3840x2160' }, model), /1K.*2K/)
   assert.throws(() => decode({ prompt: 'p', resolution: '4k' }, model), /1K.*2K/)
  }
 }
 assert.throws(() => decode({ prompt: 'p', size: '0x1024' }), /size/)
 assert.throws(() => decode({ prompt: 'p', size: '2k' }), /size/)
 assert.throws(() => decode({ prompt: 'p', size: '1024x1024', resolution: '2k' }, GROK), /conflicts/)
})

test('严格预设：五型号在解码及提交阶段拒绝自定义尺寸，不缩小或绕过', () => {
 const oneK = ['1024x1024', '1024x1536', '1536x1024', '1024x768', '768x1024', '1536x864', '864x1536', '2016x864', '864x2016']
 const twoK = ['2048x2048', '1360x2048', '2048x1360', '2048x1536', '1536x2048', '2048x1152', '1152x2048', '2688x1152', '1152x2688']
 for (const model of Object.keys(MODELS)) {
  for (const size of [...oneK, ...(model === GROK ? twoK : [])]) {
   assert.equal(submit(decode({ prompt: 'p', size }, model), model).body.size, size)
   assert.equal(submit(edit({ size: [size] }, undefined, model), model).parts.find(part => part.name === 'size').value, size)
  }
  for (const size of ['1000x1000', '1024x1025', '2000x1000', '4096x4096']) {
   assert.throws(() => decode({ prompt: 'p', size }, model), /preset/)
   assert.throws(() => edit({ size: [size] }, undefined, model), /preset/)
   assert.throws(() => submit({ action: 'text_to_image', requestBody: { prompt: 'p', size } }, model), /preset/)
  }
  assert.equal(submit(decode({ prompt: 'p' }, model), model).body.size, '1024x1024')
 }
})

test('轮询原任务，不重发生成；Base64 结果可以直接交给画布', () => {
 assert.equal(plugin.buildQueryRequest({ ...ctx(), taskId: 'task/a' }).url, 'https://image.xiaoyiapi.xyz/v1/images/tasks/task%2Fa')
 assert.equal(plugin.buildQueryRequest({ ...ctx(), taskId: 'task/a' }).method, 'GET')
 assert.equal(plugin.parseSubmitResponse({}, { body: { task_id: 'task/a' } }).taskId, 'task/a')
 assert.throws(() => plugin.parseSubmitResponse({}, { body: { status: 'running' } }), /task id/)
 const body = { status: 'success', result: { data: [{ b64_json: 'fixture', revised_prompt: 'p' }, { revised_prompt: 'empty' }] } }
 assert.equal(plugin.parseTaskResult({}, body).status, 'SUCCESS')
 assert.deepEqual(plugin.protocols.openai_image.render({}, { data: body }).data, [{ b64_json: 'fixture', revised_prompt: 'p' }])
 assert.deepEqual(plugin.extractUsageOnComplete({}, {}, body), { image_count: 1 })
 assert.equal(plugin.parseTaskResult({}, { status: 'success', result: { data: [] } }).status, 'UNKNOWN')
 assert.equal(plugin.parseTaskResult({}, { status: 'failed', error: { message: '素材错误' } }).reason, '素材错误')
 assert.equal(plugin.parseTaskResult({}, { status: 'unexpected' }).status, 'UNKNOWN')
 assert.equal(plugin.parseTaskResult({}, { status: 'running' }).status, 'IN_PROGRESS')
})

test('厂商只回 URL 时不伪称 Base64，保留真实结果及按张结算', () => {
 const body = { status: 'success', result: { data: [{ url: 'https://example.com/a.png?sig=keep' }, { b64_json: 'fixture' }] } }
 assert.deepEqual(plugin.protocols.openai_image.render({}, { data: body }).data, body.result.data)
 assert.deepEqual(plugin.extractUsageOnComplete({}, {}, body), { image_count: 2 })
})

test('五型号售价清单与插件一致，人民币系数按实际张数', () => {
 const pricing = JSON.parse(readFileSync(new URL('../xiaoyi-image-pricing.json', import.meta.url), 'utf8'))
 assert.equal(pricing.plugin, plugin.meta.key)
 assert.equal(pricing.version, plugin.meta.version)
 assert.deepEqual(pricing.models.map(item => item.model), plugin.meta.models)
 for (const item of pricing.models) {
  const grok = item.model === GROK
  assert.equal(item.upstreamModel, MODELS[item.model])
  assert.equal(item.salePriceCny, grok ? 0.08 : 0.04)
  assert.deepEqual(item.resolutions, grok ? ['1k', '2k'] : ['1k'])
  assert.equal(item.expression, 'tier("base", u("image_count") * ' + item.salePriceCny + ')')
 }
})

test('原生图片路由提交立即返回公共任务号，查询才提供终态图片', () => {
 const routes = plugin.meta.routes
 assert.ok(routes && routes.length === 3)
 for (const model of Object.keys(MODELS)) {
  for (const editMode of [false, true]) {
   const route = routes.find(route => route.type === 'submit' && route.path.endsWith(editMode ? '/edits' : '/generations'))
   assert.ok(route.models.includes(model))
   const context = editMode
    ? { ...ctx(model), body: { kind: 'multipart', fields: { model: [model], prompt: ['p'], size: ['1024x1024'] }, files: [{ ref: 'file:a', field: 'image', filename: 'a.png' }] } }
    : { ...ctx(model), body: { kind: 'json', value: { model, prompt: 'p', size: '1024x1024' } } }
   const intent = plugin.native[route.decode]({ ...context, model: undefined })
   assert.equal(intent.action, editMode ? 'image_to_image' : 'text_to_image')
   assert.equal(submit(intent, model).body?.model || submit(intent, model).parts.find(part => part.name === 'model').value, MODELS[model])
   const created = plugin.native[route.render](context, { task_id: 'task_public', status: 'SUBMITTED', data: { task_id: 'private_upstream' } })
   assert.deepEqual(created, { id: 'task_public', status: 'queued' })
  }
 }
 const query = routes.find(route => route.type === 'query')
 const render = plugin.native[query.render]
 assert.deepEqual(render({}, { task_id: 'task_public', status: 'IN_PROGRESS' }), { id: 'task_public', status: 'in_progress' })
 assert.deepEqual(render({}, { task_id: 'task_public', status: 'SUCCESS', data: { result: { data: [{ b64_json: 'AA==' }] } } }), { id: 'task_public', status: 'completed', data: [{ b64_json: 'AA==' }] })
 assert.equal(render({}, { task_id: 'task_public', status: 'FAILURE', fail_reason: 'upstream failed' }).error.message, 'upstream failed')
 assert.throws(() => render({}, { task_id: 'task_public', status: 'SUCCESS', data: {} }), /without an image/)
 assert.throws(() => render({}, { task_id: 'task_public', status: 'nonsense' }), /Unknown/)
})
