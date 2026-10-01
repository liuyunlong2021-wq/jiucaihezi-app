// 夹具：锁住 shanhai 插件的对外行为。
// 存在理由与 comfy / dola 同一条：面板的画幅、分辨率、时长都在 TaskSubmitReq 白名单之外，
// 走旧渠道会被整段丢掉，适配器只能落回自己的默认值。
// 跑法：node --test newapi-plugins/__tests__/shanhai.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

import * as plugin from '../shanhai.plugin.js'

const MODEL = '海seedance2.5'
const UPSTREAM_MODEL = 'oc-model-r5cfh8'
const BASE = 'http://shanhai-adapter:8795'

function decode(value, model = MODEL) {
  return plugin.protocols.openai_video.decodeRequest({
    model,
    body: { kind: 'json', value: { model, ...value } },
  })
}

test('meta 对齐适配器与面板注册', () => {
  assert.equal(plugin.meta.apiVersion, 1)
  assert.equal(plugin.meta.key, 'shanhai')
  assert.equal(plugin.meta.version, '0.1.0')
  assert.equal(plugin.meta.fetchMode, 'per_task')
  assert.deepEqual(plugin.meta.protocols, ['openai_video'])
  // 适配器容器加入 new-api-new_new-api-network、不映射宿主端口，所以走服务名
  assert.equal(plugin.meta.baseUrl, BASE)
  // 面板发公开名；渠道配了 model_mapping 时插件看到上游 id —— 两种都必须在表里
  assert.ok(plugin.meta.models.includes(MODEL))
  assert.ok(plugin.meta.models.includes(UPSTREAM_MODEL))
  assert.deepEqual(Object.keys(plugin.meta.usageSchema), ['calls', 'seconds'])
})

test('★ 每个 usageExample 都要带齐所有声明的用量 key（宿主上传校验，少了直接拒收）', () => {
  const keys = Object.keys(plugin.meta.usageSchema)
  for (const example of plugin.meta.usageExamples) {
    for (const key of keys) {
      assert.ok(Object.prototype.hasOwnProperty.call(example.facts, key), `${example.label} 缺 ${key}`)
    }
  }
})

test('★ 画幅 / 分辨率 / 时长原样透传 —— 换插件的唯一理由', () => {
  const intent = decode({
    prompt: '人物回头',
    ratio: '9:16',
    aspect_ratio: '9:16',
    resolution: '720p',
    duration: 30,
    images: ['https://api.jiucaihezi.studio/media/creation/a.png'],
  })
  const body = intent.requestBody
  assert.equal(body.ratio, '9:16')
  assert.equal(body.aspect_ratio, '9:16')
  assert.equal(body.resolution, '720p')
  assert.equal(body.duration, 30)
  assert.deepEqual(body.images, ['https://api.jiucaihezi.studio/media/creation/a.png'])
  assert.equal(intent.action, 'image_to_video')
})

test('音频参考不做静默丢弃（适配器回 422），插件不拦也不改', () => {
  const audios = ['https://api.jiucaihezi.studio/media/creation/a.mp3']
  assert.deepEqual(decode({ prompt: 'p', audios }).requestBody.audios, audios)
})

test('action 只看有没有参考图', () => {
  assert.equal(decode({ prompt: 'p', ratio: '16:9' }).action, 'text_to_video')
  assert.equal(decode({ prompt: 'p', ratio: '16:9', images: ['https://a/1.png'] }).action, 'image_to_video')
  assert.equal(decode({ prompt: 'p', ratio: '16:9', image: 'https://a/1.png' }).action, 'image_to_video')
  assert.equal(decode({ prompt: 'p', ratio: '16:9', imageUrls: ['https://a/1.png'] }).action, 'image_to_video')
  // 空数组不算参考图
  assert.equal(decode({ prompt: 'p', ratio: '16:9', images: [] }).action, 'text_to_video')
})

test('校验失败同步抛错（宿主回 400，不建任务不扣费）', () => {
  assert.throws(
    () => plugin.protocols.openai_video.decodeRequest({ model: MODEL, body: { kind: 'multipart', fields: {} } }),
    /JSON body required/,
  )
  assert.throws(
    () => plugin.protocols.openai_video.decodeRequest({ model: MODEL, body: { kind: 'json', value: [] } }),
    /request body must be an object/,
  )
  assert.throws(() => decode({ prompt: 'p' }, '海别的模型'), /Unsupported model/)
  assert.throws(() => decode({ prompt: '   ', ratio: '16:9' }), /prompt is required/)
})

test('上游三件套：POST /v1/videos、渠道密钥、模型换成渠道映射后的名', () => {
  const requestBody = { model: MODEL, prompt: 'p', ratio: '4:3' }
  const ctx = {
    baseUrl: BASE,
    apiKey: 'shanhai-oc-live-key',
    model: MODEL,
    upstreamModel: UPSTREAM_MODEL,
    requestBody,
    action: 'text_to_video',
  }

  const submit = plugin.buildSubmitRequest(ctx)
  assert.equal(submit.url, `${BASE}/v1/videos`)
  assert.equal(submit.method, 'POST')
  assert.equal(submit.headers.Authorization, 'Bearer shanhai-oc-live-key')
  assert.equal(submit.body.model, UPSTREAM_MODEL)
  // 不改入参，也不与入参共享同一个对象
  assert.notEqual(submit.body, requestBody)
  assert.equal(requestBody.model, MODEL)

  // 没配模型映射时退回公开名（适配器自己也有别名表）
  assert.equal(plugin.buildSubmitRequest({ ...ctx, upstreamModel: undefined }).body.model, MODEL)

  const query = plugin.buildQueryRequest({ ...ctx, taskId: 'task_20261001_shanhai' })
  assert.equal(query.url, `${BASE}/v1/videos/task_20261001_shanhai`)
  assert.equal(query.method, 'GET')
  assert.equal(query.headers.Authorization, 'Bearer shanhai-oc-live-key')
})

test('parseSubmitResponse 取适配器任务号', () => {
  const body = { id: '8f0c1d2e', task_id: '8f0c1d2e', object: 'video', status: 'processing' }
  assert.deepEqual(plugin.parseSubmitResponse({}, { statusCode: 200, body }), {
    taskId: '8f0c1d2e',
    taskData: body,
  })
  assert.throws(() => plugin.parseSubmitResponse({}, { statusCode: 200, body: { status: 'processing' } }), /did not return a task id/)
})

test('状态映射：适配器只回 processing / completed / failed', () => {
  assert.equal(plugin.parseTaskResult({}, { status: 'processing' }).status, 'IN_PROGRESS')
  assert.equal(plugin.parseTaskResult({}, { status: 'completed' }).status, 'SUCCESS')
  assert.equal(plugin.parseTaskResult({}, { status: 'failed' }).status, 'FAILURE')
  // 适配器上游是 queued/running/succeeded，归一化后本该是上面三种；留着别名只是兜底
  assert.equal(plugin.parseTaskResult({}, { status: 'queued' }).status, 'QUEUED')
  assert.equal(plugin.parseTaskResult({}, { status: 'succeeded' }).status, 'SUCCESS')

  // 失败原因：适配器把 message 同时写在 fail_reason 与 error.message 上，两个都认
  assert.match(plugin.parseTaskResult({}, { status: 'failed', fail_reason: '额度不足' }).reason, /额度不足/)
  assert.match(
    plugin.parseTaskResult({}, { status: 'failed', error: { code: 'TASK_FAILED', message: '上游 500' } }).reason,
    /上游 500/,
  )

  // 不认识的不能当 IN_PROGRESS，否则任务永远不失败、永远占额度
  assert.equal(plugin.parseTaskResult({}, { status: '神秘状态' }).status, 'UNKNOWN')
  assert.equal(plugin.parseTaskResult({}, {}).status, 'UNKNOWN')
})

test('★ render 不透上游任务号，也不透那个相对成片路径', () => {
  const view = plugin.protocols.openai_video.render({}, {
    task_id: 'task_20261001_shanhai',
    status: 'SUCCESS',
    progress: '100%',
    created_at: 1759300000,
    // 适配器快照：id/task_id 是**上游**任务号，video_url 是 `/v1/videos/{上游号}/content`
    data: {
      id: '8f0c1d2e',
      task_id: '8f0c1d2e',
      status: 'completed',
      video_url: '/v1/videos/8f0c1d2e/content',
    },
  })
  assert.equal(view.id, 'task_20261001_shanhai')
  assert.equal(view.object, 'video')
  assert.equal(view.status, 'completed')
  assert.equal(view.progress, 100)
  assert.equal(view.created_at, 1759300000)
  // 成片由宿主的 artifact 通道下发；上游相对路径 + 上游任务号都不能出去
  assert.equal(view.video_url, undefined)
  assert.equal(view.task_id, undefined)
  assert.ok(!JSON.stringify(view).includes('8f0c1d2e'))
})

test('render：宿主注入了 artifact 地址就用它；失败带上原因', () => {
  const view = plugin.protocols.openai_video.render(
    { artifacts: { video: { url: '/v1/videos/task_20261001_shanhai/content' } } },
    {
      task_id: 'task_20261001_shanhai',
      status: 'FAILURE',
      progress: '0',
      created_at: 1759300000,
      data: { status: 'failed', fail_reason: '上游超时' },
    },
  )
  assert.equal(view.video_url, '/v1/videos/task_20261001_shanhai/content')
  assert.equal(view.status, 'failed')
  assert.equal(view.error, '上游超时')
})

test('未完成时状态不是 completed', () => {
  const view = plugin.protocols.openai_video.render({}, {
    task_id: 'task_1',
    status: 'IN_PROGRESS',
    progress: '0',
    created_at: 1,
    data: { status: 'processing' },
  })
  assert.equal(view.status, 'in_progress')
  // 宿主认不出的状态不能瞎报：既不是 completed 也不是 failed
  const unknown = plugin.protocols.openai_video.render({}, { task_id: 'task_1', status: '???', progress: '0', created_at: 1 })
  assert.equal(unknown.status, 'unknown')
})

test('artifact：只在 SUCCESS 给 video，且打回适配器的带 Key 代理口', () => {
  assert.deepEqual(plugin.listArtifacts({ status: 'SUCCESS' }), [
    { key: 'video', type: 'video', mimeType: 'video/mp4' },
  ])
  assert.deepEqual(plugin.listArtifacts({ status: 'IN_PROGRESS' }), [])
  assert.deepEqual(plugin.listArtifacts({ status: 'FAILURE' }), [])

  const request = plugin.buildContentRequest({
    baseUrl: BASE,
    apiKey: 'shanhai-oc-live-key',
    artifactKey: 'video',
    upstreamTaskId: '8f0c1d2e',
    clientRequest: { method: 'GET' },
  })
  assert.equal(request.url, `${BASE}/v1/videos/8f0c1d2e/content`)
  assert.equal(request.method, 'GET')
  // 山海成片必须带 Key 才能取 → 不能标 credentialless
  assert.equal(request.headers.Authorization, 'Bearer shanhai-oc-live-key')
  assert.equal(request.credentialless, undefined)

  // 客户端要 HEAD 就透 HEAD（适配器 /content 支持 Range 与 HEAD）
  assert.equal(
    plugin.buildContentRequest({
      baseUrl: BASE,
      apiKey: 'k',
      artifactKey: 'video',
      upstreamTaskId: '8f0c1d2e',
      clientRequest: { method: 'HEAD' },
    }).method,
    'HEAD',
  )
  assert.throws(
    () => plugin.buildContentRequest({ artifactKey: 'image', upstreamTaskId: 'x', clientRequest: { method: 'GET' } }),
    /artifact_not_found/,
  )
})

test('用量：按请求时长报秒，缺省/越界都回落到 30 秒档', () => {
  assert.deepEqual(plugin.extractUsage({ requestBody: { duration: 30 } }), { calls: 1, seconds: 30 })
  assert.deepEqual(plugin.extractUsage({ requestBody: { seconds: 5 } }), { calls: 1, seconds: 5 })
  // 面板的时长字段是 number；字符串也得认
  assert.deepEqual(plugin.extractUsage({ requestBody: { duration: '10' } }), { calls: 1, seconds: 10 })
  // 没有时长 / 非法 / 越界 → 回落到面板唯一允许的那一档，报 0 会静默扣不到钱
  assert.deepEqual(plugin.extractUsage({ requestBody: {} }), { calls: 1, seconds: 30 })
  assert.deepEqual(plugin.extractUsage({ requestBody: { duration: 0 } }), { calls: 1, seconds: 30 })
  assert.deepEqual(plugin.extractUsage({ requestBody: { duration: 4000 } }), { calls: 1, seconds: 30 })
  assert.deepEqual(plugin.extractUsage({ requestBody: { duration: 'x' } }), { calls: 1, seconds: 30 })
  assert.deepEqual(plugin.extractUsage({}), { calls: 1, seconds: 30 })
})

test('完成时只回 calls，让 seconds 保留提交时的值', () => {
  // 宿主的补全是逐 key 覆盖：没给的 key 保留提交快照，所以不能在这里回 0
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, { status: 'completed' }), { calls: 1 })
})
