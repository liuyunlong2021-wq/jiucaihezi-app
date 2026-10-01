// 夹具：锁住 zx 插件的对外行为。
// 存在理由与 comfy / dola / shanhai 同一条：面板的画幅、分辨率、时长都在
// TaskSubmitReq 白名单之外，走旧渠道会被整段丢掉。
// 跑法：node --test newapi-plugins/__tests__/zx.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

import * as plugin from '../zx.plugin.js'

const GROK = 'grok-1.5-video-10s'
const OMNI = 'omni-fast'
const MJ = 'mj_fast_imagine'
const SEEDANCE = 'doubao-seedance-2-5-260628'
const BASE = 'http://zx-video-adapter:8789'

function decode(value, model = GROK) {
  return plugin.protocols.openai_video.decodeRequest({
    model,
    body: { kind: 'json', value: { model, ...value } },
  })
}

function render(task, ctx = {}) {
  return plugin.protocols.openai_video.render(ctx, task)
}

test('meta 对齐适配器与面板注册', () => {
  assert.equal(plugin.meta.apiVersion, 1)
  assert.equal(plugin.meta.key, 'zx')
  assert.equal(plugin.meta.version, '0.1.0')
  assert.equal(plugin.meta.fetchMode, 'per_task')
  assert.deepEqual(plugin.meta.protocols, ['openai_video'])
  // 适配器容器加入 new-api-new_new-api-network、不映射宿主端口，所以走服务名
  assert.equal(plugin.meta.baseUrl, BASE)
  assert.deepEqual(plugin.meta.models, [
    'grok-1.5-video-6s',
    'grok-1.5-video-10s',
    'grok-1.5-video-15s',
    'omni-fast',
    'omni-v2v',
    'mj_fast_imagine',
  ])
  assert.deepEqual(Object.keys(plugin.meta.usageSchema), ['calls', 'seconds'])
})

test('★ Seedance 有意不收编：面板发的是 /v1/video/generations，不是宿主协议路径', () => {
  // 宿主协议绑定表里 `openai_video` 的 create 只有 POST /v1/videos；
  // `/v1/video/generations` 不在任何协议的绑定里，type 61 渠道接不住。
  // 这条断言是**故意**的：将来要收编它，得先改 App 的 endpoint。
  assert.ok(!plugin.meta.models.includes(SEEDANCE))
  assert.throws(() => decode({ prompt: 'p' }, SEEDANCE), /Unsupported model/)
})

test('★ 每个 usageExample 都要带齐所有声明的用量 key（宿主上传校验，少了直接拒收）', () => {
  const keys = Object.keys(plugin.meta.usageSchema)
  for (const example of plugin.meta.usageExamples) {
    for (const key of keys) {
      assert.ok(Object.prototype.hasOwnProperty.call(example.facts, key), `${example.label} 缺 ${key}`)
    }
  }
})

test('★ 字段原样透传 —— 换插件的唯一理由', () => {
  const intent = decode({
    prompt: '街头回头',
    ratio: '9:16',
    aspect_ratio: '9:16',
    resolution: '720p',
    duration: 10,
    size: '1280x720',
    images: ['https://api.jiucaihezi.studio/media/creation/a.png'],
  })
  const body = intent.requestBody
  assert.equal(body.ratio, '9:16')
  assert.equal(body.aspect_ratio, '9:16')
  assert.equal(body.resolution, '720p')
  assert.equal(body.duration, 10)
  assert.equal(body.size, '1280x720')
  assert.deepEqual(body.images, ['https://api.jiucaihezi.studio/media/creation/a.png'])
  assert.equal(intent.action, 'image_to_video')
})

test('action 按模型与参考素材推导', () => {
  assert.equal(decode({ prompt: 'p' }).action, 'text_to_video')
  assert.equal(decode({ prompt: 'p', images: ['https://a/1.png'] }).action, 'image_to_video')
  assert.equal(decode({ prompt: 'p', image: 'https://a/1.png' }).action, 'image_to_video')
  assert.equal(decode({ prompt: 'p', reference_images: ['https://a/1.png'] }).action, 'image_to_video')
  // omni-v2v 的参考是视频
  assert.equal(decode({ prompt: 'p', video_url: 'https://a/1.mp4' }, 'omni-v2v').action, 'image_to_video')
  // MJ 是图片任务
  assert.equal(decode({ prompt: 'p' }, MJ).action, 'text_to_image')
  assert.equal(decode({ prompt: 'p', images: ['https://a/1.png'] }, MJ).action, 'image_to_image')
  // 空数组不算参考素材
  assert.equal(decode({ prompt: 'p', images: [] }).action, 'text_to_video')
})

test('校验失败同步抛错（宿主回 400，不建任务不扣费）', () => {
  assert.throws(
    () => plugin.protocols.openai_video.decodeRequest({ model: GROK, body: { kind: 'multipart', fields: {} } }),
    /JSON body required/,
  )
  assert.throws(
    () => plugin.protocols.openai_video.decodeRequest({ model: GROK, body: { kind: 'json', value: [] } }),
    /request body must be an object/,
  )
  assert.throws(() => decode({ prompt: 'p' }, 'grok-1.5-video-20s'), /Unsupported model/)
  assert.throws(() => decode({ prompt: '   ' }), /prompt is required/)
})

test('上游三件套：POST /v1/videos、渠道密钥、模型换成渠道映射后的名', () => {
  const requestBody = { model: GROK, prompt: 'p', ratio: '4:3' }
  const ctx = {
    baseUrl: BASE,
    apiKey: 'zx-key',
    model: GROK,
    upstreamModel: GROK,
    requestBody,
    action: 'text_to_video',
  }

  const submit = plugin.buildSubmitRequest(ctx)
  assert.equal(submit.url, `${BASE}/v1/videos`)
  assert.equal(submit.method, 'POST')
  assert.equal(submit.headers.Authorization, 'Bearer zx-key')
  assert.equal(submit.body.model, GROK)
  assert.notEqual(submit.body, requestBody)
  assert.equal(requestBody.model, GROK)

  assert.equal(plugin.buildSubmitRequest({ ...ctx, upstreamModel: undefined }).body.model, GROK)

  const query = plugin.buildQueryRequest({ ...ctx, taskId: 'zx_task_1' })
  assert.equal(query.url, `${BASE}/v1/videos/zx_task_1`)
  assert.equal(query.method, 'GET')
  assert.equal(query.headers.Authorization, 'Bearer zx-key')
})

test('parseSubmitResponse 取适配器任务号', () => {
  const body = { id: '1234567890', task_id: '1234567890', object: 'video', status: 'processing' }
  assert.deepEqual(plugin.parseSubmitResponse({}, { statusCode: 200, body }), {
    taskId: '1234567890',
    taskData: body,
  })
  assert.throws(() => plugin.parseSubmitResponse({}, { statusCode: 200, body: {} }), /did not return a task id/)
})

test('状态映射：三种上游形状都被适配器归一化成 processing / completed / failed', () => {
  assert.equal(plugin.parseTaskResult({}, { status: 'processing' }).status, 'IN_PROGRESS')
  assert.equal(plugin.parseTaskResult({}, { status: 'completed' }).status, 'SUCCESS')
  assert.equal(plugin.parseTaskResult({}, { status: 'failed' }).status, 'FAILURE')
  assert.match(
    plugin.parseTaskResult({}, { status: 'failed', error: { code: 'TASK_FAILED', message: '上游 500' } }).reason,
    /上游 500/,
  )
  // 不认识的不能当 IN_PROGRESS，否则任务永远不失败、永远占额度
  assert.equal(plugin.parseTaskResult({}, { status: '神秘状态' }).status, 'UNKNOWN')
  assert.equal(plugin.parseTaskResult({}, {}).status, 'UNKNOWN')
})

test('Grok 成片是上游绝对直链 → 直接报 url', () => {
  const body = {
    id: '1234567890',
    object: 'video',
    model: GROK,
    status: 'completed',
    video_url: 'https://img-api.zxcode.vip/videos/a.mp4',
  }
  assert.equal(plugin.parseTaskResult({}, body).url, 'https://img-api.zxcode.vip/videos/a.mp4')

  const view = render({ task_id: 'zx_task_1', status: 'SUCCESS', progress: '100%', created_at: 1759300000, data: body })
  assert.equal(view.video_url, 'https://img-api.zxcode.vip/videos/a.mp4')
  assert.equal(view.status, 'completed')
  assert.equal(view.progress, 100)
  assert.equal(view.task_id, undefined)
})

test('★ Omni 的成片是相对路径 + 上游任务号，绝不能透给客户端', () => {
  const body = {
    id: '1234567890',
    task_id: '1234567890',
    object: 'video',
    model: OMNI,
    status: 'completed',
    video_url: '/v1/videos/1234567890/content',
  }
  // 相对路径不是成品地址，不能当 url 报出去
  assert.equal(plugin.parseTaskResult({}, body).url, undefined)
  const view = render({ task_id: 'zx_task_1', status: 'SUCCESS', progress: '100%', created_at: 1, data: body })
  assert.equal(view.video_url, undefined)
  assert.ok(!JSON.stringify(view).includes('1234567890'))
  // 宿主注入了它自己的 artifact 地址就用它
  const injected = render(
    { task_id: 'zx_task_1', status: 'SUCCESS', progress: '100%', created_at: 1, data: body },
    { artifacts: { video: { url: '/v1/videos/zx_task_1/content' } } },
  )
  assert.equal(injected.video_url, '/v1/videos/zx_task_1/content')
})

test('MJ 是图片任务：成图走 url + metadata.url', () => {
  const body = {
    id: '999',
    object: 'video',
    model: MJ,
    status: 'completed',
    progress: 100,
    metadata: { url: 'https://zxai.work/mj/xxx.png' },
  }
  assert.equal(plugin.parseTaskResult({}, body).url, 'https://zxai.work/mj/xxx.png')
  const view = render({ task_id: 'zx_task_mj', status: 'SUCCESS', progress: '100%', created_at: 1, data: body })
  assert.equal(view.object, 'image')
  assert.equal(view.url, 'https://zxai.work/mj/xxx.png')
  assert.deepEqual(view.metadata, { url: 'https://zxai.work/mj/xxx.png' })
})

test('失败时带出原因', () => {
  const view = render({
    task_id: 'zx_task_1',
    status: 'FAILURE',
    progress: '0',
    created_at: 1,
    data: { status: 'failed', error: { code: 'TASK_FAILED', message: '上游拒绝' } },
  })
  assert.equal(view.status, 'failed')
  assert.equal(view.error, '上游拒绝')
})

test('artifact：SUCCESS 才给，且图片任务给 image', () => {
  assert.deepEqual(plugin.listArtifacts({ status: 'IN_PROGRESS', data: {} }), [])
  assert.deepEqual(plugin.listArtifacts({ status: 'SUCCESS', data: { model: GROK } }), [
    { key: 'video', type: 'video', mimeType: 'video/mp4' },
  ])
  assert.deepEqual(plugin.listArtifacts({ status: 'SUCCESS', data: { model: OMNI } }), [
    { key: 'video', type: 'video', mimeType: 'video/mp4' },
  ])
  assert.deepEqual(plugin.listArtifacts({ status: 'SUCCESS', data: { model: MJ } }), [
    { key: 'image', type: 'image', mimeType: 'image/png' },
  ])
})

test('buildContentRequest：绝对直链走 credentialless，相对路径才打回适配器', () => {
  const base = {
    baseUrl: BASE,
    apiKey: 'zx-key',
    artifactKey: 'video',
    upstreamTaskId: '1234567890',
    clientRequest: { method: 'GET' },
  }

  // Grok / Seedance：上游公开直链，宿主只放 GET/HEAD、不带插件头
  const direct = plugin.buildContentRequest({
    ...base,
    data: { model: GROK, video_url: 'https://img-api.zxcode.vip/videos/a.mp4' },
  })
  assert.deepEqual(direct, {
    url: 'https://img-api.zxcode.vip/videos/a.mp4',
    method: 'GET',
    credentialless: true,
  })

  // MJ 成图同样是公开直链
  const image = plugin.buildContentRequest({
    ...base,
    artifactKey: 'image',
    data: { model: MJ, metadata: { url: 'https://zxai.work/mj/xxx.png' } },
  })
  assert.equal(image.credentialless, true)
  assert.equal(image.url, 'https://zxai.work/mj/xxx.png')

  // Omni：适配器那个带 Key 的代理口，透传客户端方法（GET/HEAD）
  const proxied = plugin.buildContentRequest({
    ...base,
    data: { model: OMNI, video_url: '/v1/videos/1234567890/content' },
  })
  assert.equal(proxied.url, `${BASE}/v1/videos/1234567890/content`)
  assert.equal(proxied.headers.Authorization, 'Bearer zx-key')
  assert.equal(proxied.credentialless, undefined)
  assert.equal(
    plugin.buildContentRequest({
      ...base,
      clientRequest: { method: 'HEAD' },
      data: { model: OMNI, video_url: '/v1/videos/1234567890/content' },
    }).method,
    'HEAD',
  )

  assert.throws(() => plugin.buildContentRequest({ ...base, artifactKey: 'audio' }), /artifact_not_found/)
  // 图片 artifact 拿不到图片地址时不能退化成视频代理
  assert.throws(
    () => plugin.buildContentRequest({ ...base, artifactKey: 'image', data: { model: MJ } }),
    /artifact_not_found/,
  )
})

test('用量：Grok 从模型名读秒，Omni 读请求时长，MJ 没有时长', () => {
  // Grok 的时长写在模型名里，即便请求体带了别的 duration 也不影响上游产出
  assert.deepEqual(plugin.extractUsage({ model: 'grok-1.5-video-6s', requestBody: { model: 'grok-1.5-video-6s' } }), { calls: 1, seconds: 6 })
  assert.deepEqual(plugin.extractUsage({ model: GROK, requestBody: { duration: 99 } }), { calls: 1, seconds: 10 })
  assert.deepEqual(plugin.extractUsage({ model: 'grok-1.5-video-15s', requestBody: {} }), { calls: 1, seconds: 15 })

  assert.deepEqual(plugin.extractUsage({ model: OMNI, requestBody: { duration: 10 } }), { calls: 1, seconds: 10 })
  assert.deepEqual(plugin.extractUsage({ model: OMNI, requestBody: {} }), { calls: 1, seconds: 10 })
  assert.deepEqual(plugin.extractUsage({ model: 'omni-v2v', requestBody: { seconds: '10' } }), { calls: 1, seconds: 10 })

  // 图片任务：没有时长，定价必须用 u("calls")，用秒会真的扣 0
  assert.deepEqual(plugin.extractUsage({ model: MJ, requestBody: {} }), { calls: 1, seconds: 0 })

  // 映射后按上游名读时长：ctx.upstreamModel 优先
  assert.deepEqual(plugin.extractUsage({ model: 'grok-别名', upstreamModel: GROK, requestBody: {} }), { calls: 1, seconds: 10 })
  assert.deepEqual(plugin.extractUsage({}), { calls: 1, seconds: 0 })
})

test('完成时只回 calls，让 seconds 保留提交时的值', () => {
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, { status: 'completed' }), { calls: 1 })
})
