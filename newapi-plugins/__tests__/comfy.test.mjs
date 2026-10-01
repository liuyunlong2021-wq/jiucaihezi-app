// 夹具：锁住 comfy 插件的对外行为。
// 这个插件的存在理由只有一条：让面板的自定义参数（画幅、戏种）无损到达适配器。
// 跑法：node --test newapi-plugins/__tests__/comfy.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

import * as plugin from '../comfy.plugin.js'

const REF2V = 'jc-minimax-h3-ref2v'
const H3 = 'jc-minimax-h3'
const INTERNAL_REF2V = 'minimax-h3-ref2v'

function decode(value, model = REF2V) {
  return plugin.protocols.openai_video.decodeRequest({
    model,
    body: { kind: 'json', value: { model, ...value } },
  })
}

test('meta 声明与适配器一致', () => {
  assert.equal(plugin.meta.apiVersion, 1)
  assert.equal(plugin.meta.key, 'comfy')
  assert.equal(plugin.meta.fetchMode, 'per_task')
  assert.equal(plugin.meta.baseUrl, 'http://frps:8796')
  assert.deepEqual(plugin.meta.protocols, ['openai_video'])
  // 面板 body 里的 model 就是这两个对外名（creationModelRegistry 的 model 字段）
  assert.deepEqual(plugin.meta.models, [H3, REF2V])
  assert.deepEqual(Object.keys(plugin.meta.usageSchema), ['seconds'])
})

test('★ 画幅与戏种原样透传 —— 换插件的唯一理由', () => {
  const value = {
    prompt: '竖屏人物回头',
    duration: 3,
    ratio: '4:3 (Standard)',
    aspectRatio: '4:3 (Standard)',
    aspect_ratio: '4:3 (Standard)',
    extra_fields: { mode: 1, aspect_ratio: '4:3 (Standard)' },
    metadata: { mode: 1, aspect_ratio: '4:3 (Standard)' },
    images: ['https://api.jiucaihezi.studio/media/creation/a.png'],
  }
  const intent = decode(value)
  // NewAPI 的 type 1 渠道会在 TaskSubmitReq 那一层把这些字段吃掉，插件通道不会
  assert.equal(intent.requestBody.aspect_ratio, '4:3 (Standard)')
  assert.equal(intent.requestBody.ratio, '4:3 (Standard)')
  assert.equal(intent.requestBody.extra_fields.mode, 1)
  assert.equal(intent.requestBody.metadata.aspect_ratio, '4:3 (Standard)')
  assert.deepEqual(intent.requestBody.images, value.images)
  // 没有尺寸字段：ref2v 由工作流的 ResolutionSelector 自己算
  assert.equal(intent.requestBody.size, undefined)
  assert.equal(intent.action, 'image_to_video')
})

test('三个用显式像素的模式照传 size / first_frame / last_frame', () => {
  const text = decode({ prompt: 'p', duration: 5, size: '1088x1920' }, H3)
  assert.equal(text.action, 'text_to_video')
  assert.equal(text.requestBody.size, '1088x1920')

  const first = decode({ prompt: 'p', duration: 5, first_frame: 'https://a/f.png' }, H3)
  assert.equal(first.action, 'image_to_video')
  assert.equal(first.requestBody.first_frame, 'https://a/f.png')

  const firstLast = decode(
    { prompt: 'p', duration: 5, first_frame: 'https://a/f.png', last_frame: 'https://a/l.png' },
    H3,
  )
  assert.equal(firstLast.action, 'image_to_video')
  assert.equal(firstLast.requestBody.last_frame, 'https://a/l.png')
})

test('校验失败同步抛错（宿主回 400，不占额度）', () => {
  assert.throws(() => plugin.protocols.openai_video.decodeRequest({ model: REF2V, body: { kind: 'multipart', fields: {} } }), /JSON body required/)
  assert.throws(() => decode({ prompt: '   ' }), /prompt is required/)
  assert.throws(() => decode({ prompt: 'p' }, 'jc-别的模型'), /Unsupported model/)
  assert.throws(() => decode({ prompt: 'p', duration: 0 }), /duration must be a positive number/)
  assert.throws(() => decode({ prompt: 'p', duration: '3' }), /duration must be a positive number/)
  assert.throws(() => plugin.protocols.openai_video.decodeRequest({ model: REF2V, body: { kind: 'json', value: [] } }), /request body must be an object/)
})

test('上游三件套：同一 baseUrl、渠道密钥、模型换成适配器内部 id', () => {
  const requestBody = { model: REF2V, prompt: 'p', aspect_ratio: '4:3 (Standard)' }
  const ctx = {
    baseUrl: 'http://frps:8796',
    apiKey: 'adapter-key',
    model: REF2V,
    upstreamModel: INTERNAL_REF2V,
    requestBody,
    action: 'image_to_video',
  }

  const submit = plugin.buildSubmitRequest(ctx)
  assert.equal(submit.url, 'http://frps:8796/v1/videos')
  assert.equal(submit.method, 'POST')
  assert.equal(submit.headers.Authorization, 'Bearer adapter-key')
  assert.equal(submit.body.model, INTERNAL_REF2V) // 渠道映射后交给适配器的内部 id
  assert.equal(submit.body.aspect_ratio, '4:3 (Standard)')
  // 不改入参：宿主把 hook 参数当只读
  assert.notEqual(submit.body, requestBody)
  assert.equal(requestBody.model, REF2V)

  // 没有渠道映射时退回对外名，不能变成 undefined
  const unmapped = plugin.buildSubmitRequest({ ...ctx, upstreamModel: undefined })
  assert.equal(unmapped.body.model, REF2V)

  const query = plugin.buildQueryRequest({ ...ctx, taskId: 'task_20261001_abc' })
  assert.equal(query.url, 'http://frps:8796/v1/videos/task_20261001_abc')
  assert.equal(query.headers.Authorization, 'Bearer adapter-key')

  const content = plugin.buildContentRequest({
    ...ctx,
    artifactKey: 'video',
    upstreamTaskId: 'task_20261001_abc',
    clientRequest: { method: 'GET' },
  })
  assert.equal(content.url, 'http://frps:8796/v1/videos/task_20261001_abc/content')
  assert.equal(content.method, 'GET')
  // 适配器的 /content 支持 Range，宿主会把客户端的 Range 透过来
  assert.throws(
    () => plugin.buildContentRequest({ ...ctx, artifactKey: 'poster', upstreamTaskId: 'x', clientRequest: { method: 'GET' } }),
    /artifact_not_found/,
  )
})

test('parseSubmitResponse 取适配器任务号', () => {
  const body = { id: 'task_20261001_507ed5c79295', task_id: 'task_20261001_507ed5c79295', status: 'queued' }
  assert.deepEqual(plugin.parseSubmitResponse({}, { statusCode: 200, body }), {
    taskId: 'task_20261001_507ed5c79295',
    taskData: body,
  })
  assert.throws(() => plugin.parseSubmitResponse({}, { statusCode: 200, body: { status: 'queued' } }), /did not return a task id/)
})

test('状态映射：适配器 queued/running/succeeded/failed/cancelled + 不认识的算 UNKNOWN', () => {
  assert.equal(plugin.parseTaskResult({}, { status: 'queued' }).status, 'SUBMITTED')
  assert.equal(plugin.parseTaskResult({}, { status: 'running' }).status, 'IN_PROGRESS')
  assert.equal(plugin.parseTaskResult({}, { status: 'succeeded' }).status, 'SUCCESS')
  const failed = plugin.parseTaskResult({}, { status: 'failed', fail_reason: 'REF2VA requires at least one reference media input' })
  assert.equal(failed.status, 'FAILURE')
  assert.match(failed.reason, /REF2VA/)
  assert.equal(plugin.parseTaskResult({}, { status: 'cancelled' }).status, 'FAILURE')
  assert.equal(plugin.parseTaskResult({}, {}).status, 'UNKNOWN')
  assert.equal(plugin.parseTaskResult({}, { status: '神秘状态' }).status, 'UNKNOWN')
})

test('成片只在 SUCCESS 时挂 artifact', () => {
  assert.deepEqual(plugin.listArtifacts({ status: 'SUCCESS' }), [{ key: 'video', type: 'video', mimeType: 'video/mp4' }])
  assert.deepEqual(plugin.listArtifacts({ status: 'SUBMITTED' }), [])
})

test('用量：预留用请求时长，结算优先用适配器归一化后的实际时长', () => {
  assert.deepEqual(plugin.extractUsage({ requestBody: { duration: 3 } }), { seconds: 3 })
  assert.deepEqual(plugin.extractUsage({ requestBody: {} }), { seconds: 5 })
  // 适配器 GET /v1/videos/{id} 的 params 就是模板归一化后的值（duration 已 clamp）
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, { params: { duration: 28 } }), { seconds: 28 })
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, { duration: 12 }), { seconds: 12 })
  assert.equal(plugin.extractUsageOnComplete({}, {}, null), null)
})

test('render 输出 OpenAI video 形状且不泄露内网地址', () => {
  const view = plugin.protocols.openai_video.render({}, { task_id: 'task_x', status: 'SUCCESS', progress: '100%', created_at: 1 })
  assert.equal(view.id, 'task_x')
  assert.equal(view.object, 'video')
  assert.equal(view.status, 'completed')
  // 适配器给的是 http://frps:8796/... 内网地址，绝不能出现在响应里
  assert.equal(JSON.stringify(view).includes('frps'), false)
})
