// 夹具：锁住 rh 插件的对外行为。
// 与 comfy/dola 同构：插件只做代理，rh-adapter 仍是执行器。
// RH 特有的两件事：
//   ① 适配器用**自己环境变量里的** RUNNINGHUB_API_KEY，不看调用方 Authorization；
//   ② 面板靠 `rh_task_id` 直连适配器轮询（extractTaskId 优先读它），所以 render 必须
//      把适配器的任务号放在 `rh_task_id` 上，而不是 `task_id`（宿主要删 legacy task_id）。
// 跑法：node --test newapi-plugins/__tests__/rh.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

import * as plugin from '../rh.plugin.js'

const BASE = 'http://rh-adapter:8789'
const VIDEO = 'rh-seedance2-image'
const IMAGE = 'rh-pro-image'

function decode(value, { model = VIDEO, protocol = 'openai_video' } = {}) {
  return plugin.protocols[protocol].decodeRequest({
    protocol,
    model,
    body: { kind: 'json', value: { model, ...value } },
  })
}

test('meta 对齐适配器与面板注册', () => {
  assert.equal(plugin.meta.apiVersion, 1)
  assert.equal(plugin.meta.key, 'rh')
  assert.equal(plugin.meta.fetchMode, 'per_task')
  assert.equal(plugin.meta.baseUrl, BASE)
  assert.deepEqual(plugin.meta.protocols, ['openai_video', 'openai_image'])
  // RH 旧 Custom Channel 是「按次计费」，所以保留 calls；seconds 供视频 / AI App 按秒计费
  assert.deepEqual(Object.keys(plugin.meta.usageSchema), ['calls', 'seconds'])
  assert.equal(plugin.meta.usageSchema.calls.unit, 'count')
  assert.equal(plugin.meta.usageSchema.seconds.unit, 'second')
})

test('★ 画幅 / 分辨率 / extra_fields 原样透传 —— 换插件的理由', () => {
  const value = {
    prompt: '海边回头',
    aspectRatio: '9:16',
    aspect_ratio: '9:16',
    ratio: '9:16',
    resolution: '1080p',
    duration: '5',
    images: ['https://api.jiucaihezi.studio/media/creation/a.png'],
    extra_fields: { lora: 'x', lora_strength: 0.8 },
    metadata: { rh_aiapp: { version: 1, webappId: 'w', nodeInfoList: [] } },
  }
  const intent = decode(value)
  // 旧链路里 aspectRatio / extra_fields / metadata 都会被 TaskSubmitReq 吃掉
  assert.equal(intent.requestBody.aspectRatio, '9:16')
  assert.equal(intent.requestBody.resolution, '1080p')
  assert.equal(intent.requestBody.extra_fields.lora, 'x')
  assert.deepEqual(intent.requestBody.metadata.rh_aiapp, value.metadata.rh_aiapp)
  assert.deepEqual(intent.requestBody.images, value.images)
  assert.equal(intent.action, 'video')
})

test('按模型定模态：图片走 images、视频走 videos', () => {
  assert.equal(decode({ prompt: 'p' }, { model: IMAGE, protocol: 'openai_image' }).action, 'image')
  assert.equal(decode({ prompt: 'p' }, { model: VIDEO }).action, 'video')
  // 模态取自模型表，不依赖 ctx.protocol —— 两个协议共用一个 decoder
  assert.equal(decode({ prompt: 'p' }, { model: IMAGE, protocol: 'openai_video' }).action, 'image')
})

test('不收音频、也不收与本机 comfy 撞名的模型', () => {
  // 音频链路的 App endpoint 是 /v1/audio/speech，宿主没有音频协议 → 留给旧渠道
  for (const model of ['rh-suno-v55-single', 'rh-speech-hd', 'rh-music', 'rh-voice-clone', 'rh-aiapp-voice-clone', 'rh-aiapp-voice-design']) {
    assert.throws(() => decode({ prompt: 'p' }, { model }), /Unsupported model/)
  }
  // z-image-turbo 同时也是本机 comfy 的模型名，收进来会截胡那条链路
  assert.throws(() => decode({ prompt: 'p' }, { model: 'z-image-turbo' }), /Unsupported model/)
  assert.equal(plugin.meta.models.includes('z-image-turbo'), false)
})

test('校验失败同步抛错（宿主回 400，不占额度）', () => {
  assert.throws(() => plugin.protocols.openai_video.decodeRequest({ model: VIDEO, body: { kind: 'multipart', fields: {} } }), /JSON body required/)
  assert.throws(() => plugin.protocols.openai_video.decodeRequest({ model: VIDEO, body: { kind: 'json', value: [] } }), /request body must be an object/)
  assert.throws(() => decode({ prompt: '   ' }), /prompt is required/)
})

test('上游三件套：按模态选路径、渠道密钥、模型换成渠道映射后的名', () => {
  const requestBody = { model: VIDEO, prompt: 'p', aspectRatio: '9:16' }
  const ctx = {
    baseUrl: BASE,
    apiKey: 'rh-channel-key',
    model: VIDEO,
    upstreamModel: VIDEO,
    requestBody,
    action: 'video',
  }

  const submit = plugin.buildSubmitRequest(ctx)
  assert.equal(submit.url, `${BASE}/v1/videos`)
  assert.equal(submit.method, 'POST')
  assert.equal(submit.headers.Authorization, 'Bearer rh-channel-key')
  assert.equal(submit.body.aspectRatio, '9:16')
  assert.notEqual(submit.body, requestBody)
  assert.equal(requestBody.model, VIDEO)

  const image = plugin.buildSubmitRequest({ ...ctx, action: 'image' })
  assert.equal(image.url, `${BASE}/v1/images/generations`)

  // 没配渠道映射时退回对外名，不能变成 undefined
  assert.equal(plugin.buildSubmitRequest({ ...ctx, upstreamModel: undefined }).body.model, VIDEO)

  // 轮询走适配器**专为 NewAPI 准备**的 Sora 兼容路径
  const query = plugin.buildQueryRequest({ ...ctx, taskId: 'global:2013508786110730241' })
  assert.equal(query.url, `${BASE}/v1/videos/global%3A2013508786110730241`)
  assert.equal(query.method, 'GET')
})

test('parseSubmitResponse 取适配器任务号（task_id 优先，也认 id）', () => {
  assert.deepEqual(plugin.parseSubmitResponse({}, { statusCode: 200, body: { task_id: '2080000000000000001', status: 'processing' } }), {
    taskId: '2080000000000000001',
    taskData: { task_id: '2080000000000000001', status: 'processing' },
  })
  assert.equal(plugin.parseSubmitResponse({}, { statusCode: 200, body: { id: '2080000000000000002' } }).taskId, '2080000000000000002')
  assert.throws(() => plugin.parseSubmitResponse({}, { statusCode: 200, body: { status: 'processing' } }), /did not return a task id/)
})

test('状态映射：适配器已把上游大写翻成 completed/failed/processing', () => {
  assert.equal(plugin.parseTaskResult({}, { status: 'completed', url: 'https://cdn/x.mp4' }).status, 'SUCCESS')
  assert.equal(plugin.parseTaskResult({}, { status: 'completed', url: 'https://cdn/x.mp4' }).url, 'https://cdn/x.mp4')
  assert.equal(plugin.parseTaskResult({}, { status: 'processing' }).status, 'IN_PROGRESS')
  const failed = plugin.parseTaskResult({}, { status: 'failed', error: { message: '工作流节点报错', code: 'TASK_FAILED' } })
  assert.equal(failed.status, 'FAILURE')
  assert.match(failed.reason, /工作流节点报错/)
  // 不认识的不能当 IN_PROGRESS，否则任务永远不失败、永远占额度
  assert.equal(plugin.parseTaskResult({}, { status: '神秘状态' }).status, 'UNKNOWN')
  assert.equal(plugin.parseTaskResult({}, {}).status, 'UNKNOWN')
})

test('render(video) 把任务号放在 rh_task_id 上 —— 面板靠它直连适配器轮询', () => {
  const view = plugin.protocols.openai_video.render({}, {
    task_id: 'task_20261001_rh',
    status: 'SUCCESS',
    progress: 100,
    created_at: 1759300000,
    data: { task_id: '2013508786110730241', taskId: '2013508786110730241', status: 'completed', url: 'https://rh-images.cos/x.mp4' },
  })
  assert.equal(view.rh_task_id, '2013508786110730241')
  assert.equal(view.url, 'https://rh-images.cos/x.mp4')
  assert.equal(view.status, 'completed')
  // id 是宿主交给客户端的公开号（宿主会覆盖），上游号只走 rh_task_id
  assert.equal(view.id, 'task_20261001_rh')
  // legacy task_id 会被宿主删掉，所以绝不能依赖它
  assert.equal(view.task_id, undefined)
})

test('render(video) 的失败与进行中', () => {
  const failed = plugin.protocols.openai_video.render({}, {
    task_id: 'task_x',
    status: 'FAILURE',
    data: { status: 'failed', error: { message: '工作流节点报错' } },
  })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error, '工作流节点报错')

  const running = plugin.protocols.openai_video.render({}, { task_id: 'task_x', status: 'IN_PROGRESS', progress: 0 })
  assert.equal(running.status, 'processing')
  assert.equal(running.rh_task_id, undefined)
})

test('render(image) 给 OpenAI ImageResponse 形状，且同样带 rh_task_id', () => {
  const done = plugin.protocols.openai_image.render({}, {
    task_id: 'task_x',
    status: 'SUCCESS',
    created_at: 1759300000,
    data: { task_id: '2080000000000000001', status: 'completed', url: 'https://rh-images.cos/x.png' },
  })
  assert.deepEqual(done.data, [{ url: 'https://rh-images.cos/x.png' }])
  assert.equal(done.created, 1759300000)
  assert.equal(done.rh_task_id, '2080000000000000001')

  // 未完成时 data 为空，但任务号必须已经给出去（面板要拿去轮询）
  const pending = plugin.protocols.openai_image.render({}, {
    task_id: 'task_x',
    status: 'IN_PROGRESS',
    data: { task_id: '2080000000000000001', status: 'processing' },
  })
  assert.deepEqual(pending.data, [])
  assert.equal(pending.rh_task_id, '2080000000000000001')
})

test('AI App 一起接：nodeInfoList / webappId 原样到位', () => {
  const nodeInfoList = [
    { nodeId: '39', fieldName: 'image', fieldType: 'IMAGE', fieldValue: 'https://api.jiucaihezi.studio/media/creation/a.png' },
    { nodeId: '65', fieldName: 'index', fieldType: 'LIST', fieldValue: '1' },
  ]
  const intent = decode({
    prompt: 'AI App workflow',
    webappId: '2029950473750454274',
    nodeInfoList,
    extra_fields: { webappId: '2029950473750454274', nodeInfoList },
    metadata: { rh_aiapp: { version: 1, webappId: '2029950473750454274', nodeInfoList } },
  }, { model: 'rh-aiapp' })
  assert.equal(plugin.meta.models.includes('rh-aiapp'), true)
  assert.equal(intent.action, 'video')
  assert.deepEqual(intent.requestBody.nodeInfoList, nodeInfoList)
  assert.equal(intent.requestBody.metadata.rh_aiapp.version, 1)
  // 媒体还是公网 URL —— 换成 RH fileName 令牌是**适配器**的活（插件不需要下载能力）
  assert.match(intent.requestBody.nodeInfoList[0].fieldValue, /^https:/)
})

test('查询口分两种：AI App 用 ?ai_app=true，标准链路用 /v1/videos/{id}', () => {
  const base = { baseUrl: BASE, apiKey: 'k', taskId: '2013508786110730241' }
  assert.equal(plugin.buildQueryRequest({ ...base, model: 'rh-aiapp' }).url, `${BASE}/tasks/2013508786110730241?ai_app=true`)
  assert.equal(plugin.buildQueryRequest({ ...base, model: 'rh-aiapp-director' }).url, `${BASE}/tasks/2013508786110730241?ai_app=true`)
  assert.equal(plugin.buildQueryRequest({ ...base, model: VIDEO }).url, `${BASE}/v1/videos/2013508786110730241`)
})

test('render 透传 ai_app，面板才会带 ?ai_app=true 去直连适配器', () => {
  const app = plugin.protocols.openai_video.render({}, {
    task_id: 'task_x',
    status: 'IN_PROGRESS',
    data: { task_id: '2013508786110730241', status: 'processing', ai_app: true },
  })
  assert.equal(app.ai_app, true)
  assert.equal(app.rh_task_id, '2013508786110730241')
  // 标准链路的快照没有这个字段，不能凭空造
  const standard = plugin.protocols.openai_video.render({}, { task_id: 'task_x', status: 'IN_PROGRESS', data: { task_id: '1' } })
  assert.equal(standard.ai_app, undefined)
})

test('artifact hooks：宿主强制要求，成片直取 RH 公有 COS 地址', () => {
  // 声明了 openai_video 却不导出 listArtifacts 的插件会被宿主拒收（实测）
  assert.deepEqual(plugin.listArtifacts({ status: 'SUCCESS' }), [{ key: 'video', type: 'video', mimeType: 'video/mp4' }])
  assert.deepEqual(plugin.listArtifacts({ status: 'FAILURE' }), [])

  const req = plugin.buildContentRequest({
    artifactKey: 'video',
    clientRequest: { method: 'HEAD' },
    data: { status: 'completed', url: 'https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/x.mp4' },
  })
  assert.equal(req.url, 'https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/x.mp4')
  assert.equal(req.method, 'HEAD')
  assert.equal(req.credentialless, true)

  assert.throws(() => plugin.buildContentRequest({ artifactKey: 'poster', clientRequest: { method: 'GET' }, data: {} }), /artifact_not_found/)
  assert.throws(() => plugin.buildContentRequest({ artifactKey: 'video', clientRequest: { method: 'GET' }, data: {} }), /artifact_not_found/)
})

test('用量：按次恒为 1，带时长的请求另报 seconds（rh-aiapp 按秒计费就靠它）', () => {
  // 视频 / AI App：body 里有 duration
  assert.deepEqual(plugin.extractUsage({ requestBody: { prompt: 'p', duration: 5 } }), { calls: 1, seconds: 5 })
  assert.deepEqual(plugin.extractUsage({ requestBody: { prompt: 'p', duration: '5' } }), { calls: 1, seconds: 5 })
  // 图片类没有时长 → 不报 seconds（那些模型的表达式要用 u("calls")）
  assert.deepEqual(plugin.extractUsage({ requestBody: { prompt: 'p' } }), { calls: 1 })
  // 超范围宁可不报，也不能上报一个非法值
  assert.deepEqual(plugin.extractUsage({ requestBody: { prompt: 'p', duration: 99999 } }), { calls: 1 })
  // 完结钩子只回 calls：宿主按 key 覆盖，没回的 seconds 保留提交值
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, { status: 'completed' }), { calls: 1 })
})
