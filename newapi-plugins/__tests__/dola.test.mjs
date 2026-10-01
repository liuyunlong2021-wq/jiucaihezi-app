// 夹具：锁住 dola 插件的对外行为。
// 存在理由和 comfy 一样：面板把 ratio 发在顶层，NewAPI 的 TaskSubmitReq 白名单里没有它，
// 适配器只能落回自己的 16:9 兜底 —— 主力线路一直在丢画幅。插件通道里 body 由插件决定。
// 跑法：node --test newapi-plugins/__tests__/dola.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

import * as plugin from '../dola.plugin.js'

const MODEL = 'dola-seedance2.5'
const BASE = 'http://dola-seedance-adapter:8789'

function decode(value, model = MODEL) {
  return plugin.protocols.openai_video.decodeRequest({
    model,
    body: { kind: 'json', value: { model, ...value } },
  })
}

test('meta 对齐适配器与面板注册', () => {
  assert.equal(plugin.meta.apiVersion, 1)
  assert.equal(plugin.meta.key, 'dola')
  assert.equal(plugin.meta.fetchMode, 'per_task')
  // 适配器容器加入 new-api-new_new-api-network、不映射宿主端口，所以走服务名
  assert.equal(plugin.meta.baseUrl, BASE)
  assert.deepEqual(plugin.meta.protocols, ['openai_video'])
  // 面板 body 的 model（creationModelRegistry 里 newapi/dola/seedance2.5）
  assert.deepEqual(plugin.meta.models, [MODEL])
  assert.deepEqual(Object.keys(plugin.meta.usageSchema), ['seconds'])
})

test('★ 画幅原样透传 —— 换插件的唯一理由', () => {
  const value = {
    prompt: '人物回头',
    ratio: '9:16',
    aspect_ratio: '9:16',
    duration: 30,
    resolution: '720p',
    images: ['https://api.jiucaihezi.studio/media/creation/a.png'],
  }
  const intent = decode(value)
  // 面板同时发 ratio 与 aspect_ratio（buildDirectVideoBody 通用尾段），两个都不在白名单里
  assert.equal(intent.requestBody.ratio, '9:16')
  assert.equal(intent.requestBody.aspect_ratio, '9:16')
  assert.deepEqual(intent.requestBody.images, value.images)
  assert.equal(intent.requestBody.duration, 30)
  assert.equal(intent.action, 'image_to_video')
})

test('action 只看有没有参考图', () => {
  assert.equal(decode({ prompt: 'p', ratio: '16:9' }).action, 'text_to_video')
  assert.equal(decode({ prompt: 'p', ratio: '16:9', image: 'https://a/1.png' }).action, 'image_to_video')
  // 面板单图时同时发 image 与 imageUrl
  assert.equal(decode({ prompt: 'p', ratio: '16:9', imageUrl: 'https://a/1.png' }).action, 'image_to_video')
  assert.equal(decode({ prompt: 'p', ratio: '16:9', imageUrls: ['https://a/1.png', 'https://a/2.png'] }).action, 'image_to_video')
  // 空数组不算参考图
  assert.equal(decode({ prompt: 'p', ratio: '16:9', images: [] }).action, 'text_to_video')
})

test('校验失败同步抛错（宿主回 400，不占额度）', () => {
  assert.throws(() => plugin.protocols.openai_video.decodeRequest({ model: MODEL, body: { kind: 'multipart', fields: {} } }), /JSON body required/)
  assert.throws(() => plugin.protocols.openai_video.decodeRequest({ model: MODEL, body: { kind: 'json', value: [] } }), /request body must be an object/)
  assert.throws(() => decode({ prompt: 'p' }, 'dola-别的模型'), /Unsupported model/)
  assert.throws(() => decode({ prompt: '   ', ratio: '16:9' }), /prompt is required/)
})

test('上游三件套：POST /v1/videos、渠道密钥、模型换成渠道映射后的名', () => {
  const requestBody = { model: MODEL, prompt: 'p', ratio: '4:3' }
  const ctx = {
    baseUrl: BASE,
    apiKey: 'dola-user-token',
    model: MODEL,
    upstreamModel: MODEL,
    requestBody,
    action: 'text_to_video',
  }

  const submit = plugin.buildSubmitRequest(ctx)
  assert.equal(submit.url, `${BASE}/v1/videos`)
  assert.equal(submit.method, 'POST')
  assert.equal(submit.headers.Authorization, 'Bearer dola-user-token')
  assert.equal(submit.body.model, MODEL)
  // 适配器把收到的 Bearer 原样转给上游，所以渠道密钥就是 Dola 用户令牌
  assert.notEqual(submit.body, requestBody)
  assert.equal(requestBody.model, MODEL)

  const unmapped = plugin.buildSubmitRequest({ ...ctx, upstreamModel: undefined })
  assert.equal(unmapped.body.model, MODEL)

  const query = plugin.buildQueryRequest({ ...ctx, taskId: 'task_20261001_dola' })
  assert.equal(query.url, `${BASE}/v1/videos/task_20261001_dola`)
  assert.equal(query.method, 'GET')
  assert.equal(query.headers.Authorization, 'Bearer dola-user-token')
})

test('parseSubmitResponse 取适配器任务号', () => {
  const body = { id: '0123456789abcdef', task_id: '0123456789abcdef', object: 'video', status: 'queued' }
  assert.deepEqual(plugin.parseSubmitResponse({}, { statusCode: 200, body }), {
    taskId: '0123456789abcdef',
    taskData: body,
  })
  assert.throws(() => plugin.parseSubmitResponse({}, { statusCode: 200, body: { status: 'queued' } }), /did not return a task id/)
})

test('状态映射：适配器只回 queued/processing/completed/failed', () => {
  assert.equal(plugin.parseTaskResult({}, { status: 'queued' }).status, 'QUEUED')
  assert.equal(plugin.parseTaskResult({}, { status: 'processing' }).status, 'IN_PROGRESS')
  assert.equal(plugin.parseTaskResult({}, { status: 'completed' }).status, 'SUCCESS')
  // 上游改写过的 succeeded 也认（适配器会把 succeeded 翻成 completed，但别把两者都堵死）
  assert.equal(plugin.parseTaskResult({}, { status: 'succeeded' }).status, 'SUCCESS')

  const failed = plugin.parseTaskResult({}, { status: 'failed', error: '任务失败请重试' })
  assert.equal(failed.status, 'FAILURE')
  assert.match(failed.reason, /任务失败请重试/)

  // 上游 spec 说 processing 时 query_notice 可能非空 —— 那不是失败
  assert.equal(plugin.parseTaskResult({}, { status: 'processing', error: '' }).status, 'IN_PROGRESS')
  // 不认识的不能当 IN_PROGRESS，否则任务永远不失败、永远占额度
  assert.equal(plugin.parseTaskResult({}, { status: '神秘状态' }).status, 'UNKNOWN')
  assert.equal(plugin.parseTaskResult({}, {}).status, 'UNKNOWN')
})

test('成功时把成片地址报成 url', () => {
  const result = plugin.parseTaskResult({}, { status: 'completed', video_url: 'https://media.example.com/a.mp4' })
  assert.equal(result.url, 'https://media.example.com/a.mp4')
  // 未完成时不能给地址
  assert.equal(plugin.parseTaskResult({}, { status: 'processing' }).url, undefined)
})

test('render 只给面板要的字段，不泄漏上游任务号', () => {
  const view = plugin.protocols.openai_video.render({}, {
    task_id: 'task_20261001_dola',
    status: 'SUCCESS',
    progress: '100%',
    created_at: 1759300000,
    // 适配器快照：id/task_id 是**上游**任务号，绝不能再往外带
    data: { id: '0123456789abcdef', task_id: '0123456789abcdef', status: 'completed', video_url: 'https://media.example.com/a.mp4' },
  })
  assert.equal(view.id, 'task_20261001_dola')
  assert.equal(view.object, 'video')
  assert.equal(view.status, 'completed')
  // 面板靠 extractMediaUrl 读到的就是 video_url（与旧 type 1 渠道同形）
  assert.equal(view.video_url, 'https://media.example.com/a.mp4')
  assert.equal(view.task_id, undefined)
  assert.equal(JSON.stringify(view).includes('0123456789abcdef'), false)
  // 上游任务号在 data 里，panel 的 extractTaskId 会优先读 data.data.task_id —— 不能有 data
  assert.equal(view.data, undefined)
})

test('render 的失败与进行中', () => {
  const failed = plugin.protocols.openai_video.render({}, { task_id: 'task_x', status: 'FAILURE', data: { error: '任务失败请重试' } })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error, '任务失败请重试')

  const running = plugin.protocols.openai_video.render({}, { task_id: 'task_x', status: 'IN_PROGRESS', progress: '50%' })
  assert.equal(running.status, 'in_progress')
  assert.equal(running.progress, 50)
})

test('不导出 artifact hooks（有意决策）', () => {
  // 适配器没有 /content 路由，成片地址是上游公开免签 URL（规格原文：别把 Bearer 附上去），
  // 面板对 newapi-task 也不走 /content（usesNewApiContentEndpoint 为 false）。
  // 所以成片走 render 直出 video_url，与旧 type 1 渠道完全同形 —— 补 artifact 只会多一条死路。
  assert.equal('listArtifacts' in plugin, false)
  assert.equal('buildContentRequest' in plugin, false)
})

test('用量：上游只有 30 秒一档，事实就是 30', () => {
  // 规格原文：seconds 只支持 "30"；适配器把 "30" 写死，面板 duration 也只放开 30
  assert.deepEqual(plugin.extractUsage({ requestBody: { duration: 30 } }), { seconds: 30 })
  assert.deepEqual(plugin.extractUsage({ requestBody: {} }), { seconds: 30 })
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, { status: 'completed' }), { seconds: 30 })
  // 预先授权与结算同值，杜绝「估 5 秒、扣 30 秒」的差额
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, null), { seconds: 30 })
})
