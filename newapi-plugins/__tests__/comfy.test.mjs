// 夹具：锁住 comfy 插件的对外行为。
// 这个插件的存在理由只有一条：让面板的自定义参数（画幅、戏种）无损到达适配器。
// 跑法：node --test newapi-plugins/__tests__/comfy.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as plugin from '../comfy.plugin.js'

const REF2V = 'jc-minimax-h3-ref2v'
const H3 = 'jc-minimax-h3'
const IMG = 'jc-qwen-image-2.1'
const INTERNAL_REF2V = 'minimax-h3-ref2v'
const INTERNAL_IMG = 'qwen-image-2.1'

function decode(value, model = REF2V) {
  return plugin.protocols.openai_video.decodeRequest({
    model,
    body: { kind: 'json', value: { model, ...value } },
  })
}

function decodeImage(value, model = IMG) {
  return plugin.protocols.openai_image.decodeRequest({
    model,
    upstreamModel: INTERNAL_IMG,
    body: { kind: 'json', value: { model, ...value } },
  })
}

test('meta 声明与适配器一致', () => {
  assert.equal(plugin.meta.apiVersion, 1)
  assert.equal(plugin.meta.key, 'comfy')
  assert.equal(plugin.meta.fetchMode, 'per_task')
  assert.equal(plugin.meta.baseUrl, 'http://frps:8796')
  assert.deepEqual(plugin.meta.protocols, ['openai_video', 'openai_image'])
  // 面板 body 里的 model 就是这三个对外名（creationModelRegistry 的 model 字段）
  assert.deepEqual(plugin.meta.models, [H3, REF2V, IMG])
  assert.deepEqual(Object.keys(plugin.meta.usageSchema), ['seconds', 'image_count'])
})

test('★ 每个 usageExample 都要带齐所有声明的用量 key（宿主上传校验，少了直接拒收）', () => {
  const keys = Object.keys(plugin.meta.usageSchema)
  for (const example of plugin.meta.usageExamples) {
    for (const key of keys) {
      assert.ok(Object.prototype.hasOwnProperty.call(example.facts, key), `${example.label} 缺 ${key}`)
    }
  }
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
  assert.deepEqual(plugin.extractUsage({ requestBody: { duration: 3 } }), { seconds: 3, image_count: 0 })
  assert.deepEqual(plugin.extractUsage({ requestBody: {} }), { seconds: 5, image_count: 0 })
  // 适配器 GET /v1/videos/{id} 的 params 就是模板归一化后的值（duration 已 clamp）
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, { params: { duration: 28 } }), { seconds: 28 })
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, { duration: 12 }), { seconds: 12 })
  assert.equal(plugin.extractUsageOnComplete({}, {}, null), null)
})

test('★ 源码里不许出现宿主静态检查封的语法（实测 ".async" 会直接拒收上传）', () => {
  // 报错原文：unsupported plugin syntax ".async": plugins must be synchronous and cannot import modules
  // 宿主按关键字扫源码 —— 连 ".async" 这种普通点号访问都会被误伤，所以插件里一律不出现这些写法：
  // 图片的同步语义靠适配器默认值（default_async 回落 output_kind == 'video'）实现，不靠传参。
  const source = readFileSync(fileURLToPath(new URL('../comfy.plugin.js', import.meta.url)), 'utf8')
  const banned = ['.async', 'async function', 'await ', 'import ', 'require(', 'import(']
  for (const token of banned) {
    assert.equal(source.includes(token), false, `插件源码里出现了宿主封的语法：${token}`)
  }
})

test('render 输出 OpenAI video 形状且不泄露内网地址', () => {
  const view = plugin.protocols.openai_video.render({}, { task_id: 'task_x', status: 'SUCCESS', progress: '100%', created_at: 1 })
  assert.equal(view.id, 'task_x')
  assert.equal(view.object, 'video')
  assert.equal(view.status, 'completed')
  // 适配器给的是 http://frps:8796/... 内网地址，绝不能出现在响应里
  assert.equal(JSON.stringify(view).includes('frps'), false)
})

// ---------------------------------------------------------------- 图片模型（Qwen-Image 2.1）
// 适配器的图片入口是**同步**的：一次请求就把图跑完回来，所以走宿主协议 openai_image，
// 图片必须内联 b64 回（适配器 public_base_url 是 Docker 内网名，客户端取不到）。

test('★ 图片 decodeRequest：JSON 两种模式 + action 推导', () => {
  const text = decodeImage({ prompt: '一只猫' })
  assert.equal(text.kind, 'submit')
  assert.equal(text.action, 'text_to_image')
  assert.equal(text.requestBody.prompt, '一只猫')

  const edit = decodeImage({ prompt: '换成夜景', image: 'https://a/1.png' })
  assert.equal(edit.action, 'image_to_image')
  assert.equal(edit.requestBody.image, 'https://a/1.png')

  const multi = decodeImage({ prompt: 'p', images: ['https://a/1.png', 'https://a/2.png'] })
  assert.equal(multi.action, 'image_to_image')
  // 空数组不算参考图
  assert.equal(decodeImage({ prompt: 'p', images: [] }).action, 'text_to_image')
})

test('★ 图片 decodeRequest：multipart 的上传文件换成宿主占位符（适配器收 data URL）', () => {
  const intent = plugin.protocols.openai_image.decodeRequest({
    model: IMG,
    upstreamModel: INTERNAL_IMG,
    body: {
      kind: 'multipart',
      fields: { prompt: ['p'], n: ['2'] },
      files: [
        { ref: 'request_file:image', field: 'image', filename: 'a.png', mimeType: 'image/png', size: 10 },
        { ref: 'request_file:image#1', field: 'image', filename: 'b.png', mimeType: 'image/png', size: 10 },
      ],
    },
  })
  assert.equal(intent.action, 'image_to_image')
  assert.equal(intent.requestBody.prompt, 'p')
  assert.equal(intent.requestBody.n, '2')
  assert.deepEqual(intent.requestBody.images, [
    { __fileRef: 'request_file:image', encoding: 'dataUrl' },
    { __fileRef: 'request_file:image#1', encoding: 'dataUrl' },
  ])
  assert.throws(
    () => plugin.protocols.openai_image.decodeRequest({ model: IMG, body: { kind: 'multipart', fields: { prompt: ['p'] }, files: [] } }),
    /at least one file/,
  )
})

test('图片协议只收图片模型，且必须有 prompt', () => {
  // 视频模型从图片协议进来要拦掉（upstreamModel 也要一起给，否则会拿默认的图片 id 误判）
  assert.throws(
    () =>
      plugin.protocols.openai_image.decodeRequest({
        model: REF2V,
        upstreamModel: INTERNAL_REF2V,
        body: { kind: 'json', value: { model: REF2V, prompt: 'p' } },
      }),
    /is not an image model/,
  )
  assert.throws(() => decodeImage({ prompt: 'p' }, 'jc-别的模型'), /Unsupported model/)
  assert.throws(() => decodeImage({ prompt: '   ' }), /prompt is required/)
  assert.throws(
    () => plugin.protocols.openai_image.decodeRequest({ model: IMG, body: { kind: 'none' } }),
    /JSON or multipart body required/,
  )
})

test('★ 图片提交：/v1/images/generations + async:false + b64_json；视频不受影响', () => {
  const requestBody = { model: IMG, prompt: 'p', n: 2 }
  const ctx = {
    baseUrl: 'http://frps:8796',
    apiKey: 'adapter-key',
    model: IMG,
    upstreamModel: INTERNAL_IMG,
    requestBody,
    action: 'text_to_image',
  }

  const submit = plugin.buildSubmitRequest(ctx)
  assert.equal(submit.url, 'http://frps:8796/v1/images/generations')
  assert.equal(submit.method, 'POST')
  assert.equal(submit.headers.Authorization, 'Bearer adapter-key')
  assert.equal(submit.body.model, INTERNAL_IMG)
  // 同步由**适配器默认**保证（图片模板 output_kind=image → default_async=false），
  // 插件**不能**显式写 `async`：宿主的源码静态检查把 `.async` 判成非法语法（见下面的守卫用例）
  assert.equal(submit.body.async, undefined)
  assert.equal(submit.body.response_format, 'b64_json')
  // 不改入参
  assert.notEqual(submit.body, requestBody)
  assert.equal(requestBody.async, undefined)
  assert.equal(requestBody.response_format, undefined)

  // 视频那条不能被这两个字段污染，仍然走异步任务口
  const video = plugin.buildSubmitRequest({
    ...ctx,
    model: REF2V,
    upstreamModel: INTERNAL_REF2V,
    requestBody: { model: REF2V, prompt: 'p', duration: 3 },
    action: 'text_to_video',
  })
  assert.equal(video.url, 'http://frps:8796/v1/videos')
  assert.equal(video.body.async, undefined)
  assert.equal(video.body.response_format, undefined)
})

test('★ 同步图片：parseSubmitResponse 直接判终态，taskId 用适配器的 prompt_id', () => {
  const body = {
    created: 1790388368,
    data: [{ b64_json: 'AAAA' }],
    model: INTERNAL_IMG,
    prompt_id: 'c0ffee-1111',
    elapsed_seconds: 21.5,
  }
  const parsed = plugin.parseSubmitResponse({ model: IMG, upstreamModel: INTERNAL_IMG }, { statusCode: 200, body })
  assert.equal(parsed.taskId, 'c0ffee-1111')
  assert.deepEqual(parsed.immediate, { status: 'SUCCESS' })
  assert.equal(parsed.taskData, body)

  // 没有 prompt_id 时退回宿主的公开任务号，绝不能是空串
  assert.equal(
    plugin.parseSubmitResponse({ model: IMG, upstreamModel: INTERNAL_IMG, publicTaskId: 'task_pub' }, { body: { data: [{ b64_json: 'A' }] } }).taskId,
    'task_pub',
  )
  assert.throws(
    () => plugin.parseSubmitResponse({ model: IMG, upstreamModel: INTERNAL_IMG }, { body: { created: 1 } }),
    /没有 data 数组/,
  )
})

test('★ 图片 render 回 OpenAI ImageResponse 形状', () => {
  const view = plugin.protocols.openai_image.render({}, {
    task_id: 'task_x',
    status: 'SUCCESS',
    data: { created: 1790388368, data: [{ b64_json: 'AAAA' }, { url: 'http://frps:8796/files/a.png' }] },
  })
  assert.equal(view.data.length, 2)
  assert.equal(view.data[0].b64_json, 'AAAA')
  // b64 优先：宿主自己补 created
  assert.equal(view.created, undefined)
  assert.throws(
    () => plugin.protocols.openai_image.render({}, { task_id: 'task_x', status: 'SUCCESS', data: { data: [] } }),
    /没有 data 数组/,
  )
})

test('图片不给 artifact（内联回，没有可代理的产物）', () => {
  assert.deepEqual(plugin.listArtifacts({ status: 'SUCCESS', action: 'text_to_image' }), [])
  assert.deepEqual(
    plugin.listArtifacts({ status: 'SUCCESS', action: 'unknown', data: { model: INTERNAL_IMG } }),
    [],
  )
  // 视频不变
  assert.deepEqual(plugin.listArtifacts({ status: 'SUCCESS', action: 'text_to_video', data: { model: 'minimax-h3' } }), [
    { key: 'video', type: 'video', mimeType: 'video/mp4' },
  ])
})

test('图片用量：按 n 预约（不超适配器的 batch 上限），结算用实际张数纠正', () => {
  const usage = n => plugin.extractUsage({ model: IMG, upstreamModel: INTERNAL_IMG, requestBody: { n } })
  assert.deepEqual(usage(1), { seconds: 0, image_count: 1 })
  assert.deepEqual(usage(3), { seconds: 0, image_count: 3 })
  assert.deepEqual(usage(undefined), { seconds: 0, image_count: 1 })
  // 适配器 meta 的 max_batch = 4，超出的不提前多扣
  assert.deepEqual(usage(8), { seconds: 0, image_count: 4 })
  assert.deepEqual(usage('x'), { seconds: 0, image_count: 1 })

  const ctx = { model: IMG, upstreamModel: INTERNAL_IMG }
  assert.deepEqual(plugin.extractUsageOnComplete(ctx, {}, { data: [{ b64_json: 'A' }, { b64_json: 'B' }] }), {
    image_count: 2,
  })
  assert.equal(plugin.extractUsageOnComplete(ctx, {}, { data: [] }), null)
  assert.equal(plugin.extractUsageOnComplete(ctx, {}, null), null)
})
