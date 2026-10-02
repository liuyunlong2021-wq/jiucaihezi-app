// 夹具：锁住 lingdong 插件的对外行为。
// 存在理由与 comfy / dola / shanhai 同一条：面板的画幅、分辨率、时长都在旧渠道
// `TaskSubmitReq` 白名单之外，走旧渠道会被整段丢掉，上游只能落回自己的默认值。
// 跑法：node --test newapi-plugins/__tests__/lingdong.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as plugin from '../lingdong.plugin.js'

const CVK = 'cvk'
const HAI = '满血-480p'
const S480 = 'cvk-2.5-480'
const S720 = 'cvk-2.5-720'
const S1080 = 'cvk-2.5-1080'
const BASE = 'https://www.lingdongapi.com'

function decode(value, model = S720) {
  return plugin.protocols.openai_video.decodeRequest({
    model,
    body: { kind: 'json', value: { model, ...value } },
  })
}

function ctx(extra = {}) {
  return {
    model: S720,
    upstreamModel: S720,
    upstreamTaskId: 'task_lingdong_1',
    apiKey: 'lingdong-key',
    baseUrl: BASE,
    requestBody: { model: S720, prompt: '人物回头' },
    clientRequest: { method: 'GET' },
    ...extra,
  }
}

test('meta 对齐面板注册与渠道：5 个模型名逐字一致，无任何本地服务依赖', () => {
  assert.equal(plugin.meta.apiVersion, 1)
  assert.equal(plugin.meta.key, 'lingdong')
  assert.equal(plugin.meta.version, '0.1.0')
  assert.equal(plugin.meta.fetchMode, 'per_task')
  assert.deepEqual(plugin.meta.protocols, ['openai_video'])
  // 这条线直连厂商，baseUrl 是公网域名 —— 没有适配器、没有隧道
  assert.equal(plugin.meta.baseUrl, BASE)
  assert.deepEqual(plugin.meta.models, [CVK, HAI, S480, S720, S1080])
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

test('decodeRequest：只认 5 个模型、prompt 必填、按有无参考图定 action', () => {
  assert.equal(decode({ prompt: '海边' }, CVK).action, 'text_to_video')
  assert.equal(
    decode({ prompt: '海边', images: ['https://api.jiucaihezi.studio/media/creation/a.png'] }).action,
    'image_to_video',
  )
  // 兼容单图与别名
  assert.equal(decode({ prompt: '海边', image: 'https://x.test/a.png' }).action, 'image_to_video')
  assert.equal(decode({ prompt: '海边', imageUrl: 'https://x.test/a.png' }).action, 'image_to_video')
  // 空数组不算有参考图
  assert.equal(decode({ prompt: '海边', images: [] }).action, 'text_to_video')

  assert.throws(() => decode({ prompt: '海边' }, 'cvk-9.9'), /Unsupported model/)
  assert.throws(() => decode({ prompt: '   ' }), /prompt is required/)
  assert.throws(
    () => plugin.protocols.openai_video.decodeRequest({ model: CVK, body: { kind: 'multipart' } }),
    /JSON body required/,
  )
  assert.throws(
    () => plugin.protocols.openai_video.decodeRequest({ model: CVK, body: { kind: 'json', value: [] } }),
    /must be an object/,
  )
})

test('★ 画幅 / 分辨率 / 时长原样送到上游，且只发文档字段（面板残留字段一律丢掉）', () => {
  const intent = decode({
    prompt: '人物回头',
    ratio: '9:16',
    resolution: '720p',
    duration: 30,
    images: ['https://api.jiucaihezi.studio/media/creation/a.png'],
    // 面板会残留别的模型的字段（历史上 `resolution: '2k'` 打断过另一条线路）
    size: '1024x1024',
    mode: 'whatever',
    seconds: 99,
    metadata: { channel: 'x' },
    n: 4,
  })
  const request = plugin.buildSubmitRequest(ctx({ requestBody: intent.requestBody, action: intent.action }))
  assert.equal(request.url, `${BASE}/v1/videos`)
  assert.equal(request.method, 'POST')
  assert.equal(request.headers.Authorization, 'Bearer lingdong-key')
  assert.equal(request.action, 'image_to_video')
  assert.deepEqual(request.body, {
    model: S720,
    prompt: '人物回头',
    images: ['https://api.jiucaihezi.studio/media/creation/a.png'],
    ratio: '9:16',
    resolution: '720p',
    duration: 30,
    watermark: false,
  })
})

test('提交体：无参考图不发 images；缺时长不发 duration；渠道映射优先用上游 id', () => {
  const request = plugin.buildSubmitRequest(
    ctx({
      model: CVK,
      upstreamModel: undefined,
      action: 'text_to_video',
      requestBody: { model: CVK, prompt: '海边' },
    }),
  )
  assert.deepEqual(request.body, { model: CVK, prompt: '海边', watermark: false })
  assert.equal(request.action, 'text_to_video')

  // 渠道配了 model_mapping 时发上游 id
  const mapped = plugin.buildSubmitRequest(ctx({ upstreamModel: 'lingdong-upstream-id' }))
  assert.equal(mapped.body.model, 'lingdong-upstream-id')

  // 兼容 aspect_ratio 别名；duration 转成数字（`"10"` 也收）
  const alias = plugin.buildSubmitRequest(ctx({ requestBody: { model: S480, prompt: 'x', aspect_ratio: '1:1', duration: '10' } }))
  assert.equal(alias.body.ratio, '1:1')
  assert.equal(alias.body.duration, 10)
})

test('parseSubmitResponse：id / task_id 两种都认', () => {
  const body = { id: 'task_lingdong_1', status: 'processing' }
  assert.deepEqual(plugin.parseSubmitResponse({}, { statusCode: 200, body }), {
    taskId: 'task_lingdong_1',
    taskData: body,
  })
  assert.equal(
    plugin.parseSubmitResponse({}, { statusCode: 200, body: { task_id: 'task_lingdong_2' } }).taskId,
    'task_lingdong_2',
  )
  assert.throws(() => plugin.parseSubmitResponse({}, { statusCode: 200, body: { status: 'processing' } }), /did not return a task id/)
})

test('查询与成片路径跟宿主协议绑定逐字对齐', () => {
  const query = plugin.buildQueryRequest(ctx({ taskId: 'task_lingdong_1' }))
  assert.equal(query.url, `${BASE}/v1/videos/task_lingdong_1`)
  assert.equal(query.method, 'GET')
  assert.equal(query.headers.Authorization, 'Bearer lingdong-key')

  // 灵动对 /content 原生支持 HEAD 与 Range，客户端用什么方法就透什么
  const head = plugin.buildContentRequest(ctx({ artifactKey: 'video', clientRequest: { method: 'HEAD' } }))
  assert.equal(head.url, `${BASE}/v1/videos/task_lingdong_1/content`)
  assert.equal(head.method, 'HEAD')
  assert.equal(head.headers.Authorization, 'Bearer lingdong-key')
  assert.throws(
    () => plugin.buildContentRequest(ctx({ artifactKey: 'poster' })),
    /artifact_not_found/,
  )
})

test('状态映射：processing / completed / failed + 不认识的算 UNKNOWN', () => {
  assert.equal(plugin.parseTaskResult({}, { status: 'processing', progress: 45 }).status, 'IN_PROGRESS')
  assert.equal(plugin.parseTaskResult({}, { status: 'queued' }).status, 'QUEUED')
  assert.equal(plugin.parseTaskResult({}, { status: 'completed' }).status, 'SUCCESS')
  assert.equal(plugin.parseTaskResult({}, { status: 'succeeded' }).status, 'SUCCESS')
  const failed = plugin.parseTaskResult({}, { status: 'failed', error: { message: '灵动资源不足' } })
  assert.equal(failed.status, 'FAILURE')
  assert.match(failed.reason, /灵动资源不足/)
  assert.equal(plugin.parseTaskResult({}, { status: 'cancelled' }).status, 'FAILURE')
  assert.equal(plugin.parseTaskResult({}, {}).status, 'UNKNOWN')
  assert.equal(plugin.parseTaskResult({}, { status: '神秘状态' }).status, 'UNKNOWN')
})

test('成片只在 SUCCESS 时挂 artifact', () => {
  assert.deepEqual(plugin.listArtifacts({ status: 'SUCCESS' }), [
    { key: 'video', type: 'video', mimeType: 'video/mp4' },
  ])
  assert.deepEqual(plugin.listArtifacts({ status: 'IN_PROGRESS' }), [])
})

test('用量：两个口径都给值 —— 按次模型看 calls，按秒模型看 seconds', () => {
  assert.deepEqual(plugin.extractUsage({ requestBody: { duration: 30 } }), { calls: 1, seconds: 30 })
  assert.deepEqual(plugin.extractUsage({ requestBody: { seconds: 12 } }), { calls: 1, seconds: 12 })
  // 面板必带 duration；真没带时按 10 秒预留（官方插件默认值），不报 0 也不按上限多扣
  assert.deepEqual(plugin.extractUsage({ requestBody: {} }), { calls: 1, seconds: 10 })
  // 补全事实逐 key 覆盖，没给的 key 保留提交值 —— 所以只回确定的 calls
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, { status: 'completed' }), { calls: 1 })
})

test('★ 源码里不许出现宿主静态检查封的语法（实测 ".async" 会直接拒收上传）', () => {
  // 报错原文：unsupported plugin syntax ".async": plugins must be synchronous and cannot import modules
  // 宿主按关键字扫整份源码 —— 连注释里出现都算，所以这些写法一律不出现。
  const source = readFileSync(fileURLToPath(new URL('../lingdong.plugin.js', import.meta.url)), 'utf8')
  const banned = ['.async', 'async function', 'await ', 'import ', 'require(', 'import(']
  for (const token of banned) {
    assert.equal(source.includes(token), false, `插件源码里出现了宿主封的语法：${token}`)
  }
})

test('render 输出宿主形状且不泄露厂商地址与渠道 Key', () => {
  const view = plugin.protocols.openai_video.render(
    { artifacts: { video: { url: '/v1/videos/task_x/content' } } },
    { task_id: 'task_x', status: 'SUCCESS', progress: '100%', created_at: 1 },
  )
  assert.equal(view.id, 'task_x')
  assert.equal(view.object, 'video')
  assert.equal(view.status, 'completed')
  assert.equal(view.video_url, '/v1/videos/task_x/content')
  const text = JSON.stringify(view)
  assert.equal(text.includes('lingdongapi.com'), false)
  assert.equal(text.includes('lingdong-key'), false)
})
