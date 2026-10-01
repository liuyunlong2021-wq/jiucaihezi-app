// 夹具：把 boluo-minimax-adapter/src/main.py 的字段契约锁在插件上。
// 事实源是那个适配器（2026-10-01 逐条搬过来），这里只断言插件的对外行为。
// 跑法：node --test newapi-plugins/__tests__/boluo.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

import * as plugin from '../boluo.plugin.js'

const LEGACY = 'minimax_h3_image_audio_to_video_v2_15s'
const ENHANCED = 'minimax_h3_zm_u24'

function decode(value, model = LEGACY) {
  return plugin.protocols.openai_video.decodeRequest({
    model,
    body: { kind: 'json', value: { model, ...value } },
  })
}

test('meta 声明与适配器一致', () => {
  assert.equal(plugin.meta.apiVersion, 1)
  assert.equal(plugin.meta.key, 'boluo')
  assert.equal(plugin.meta.fetchMode, 'per_task')
  assert.equal(plugin.meta.baseUrl, 'https://aimanplay.cn')
  assert.deepEqual(plugin.meta.protocols, ['openai_video'])
  // 面板发的就是裸模型名（creationModelRegistry 的 model 字段），不需要渠道映射
  assert.deepEqual(plugin.meta.models, [LEGACY, ENHANCED])
  assert.deepEqual(Object.keys(plugin.meta.usageSchema), ['seconds'])
})

test('参考素材摊成 ref_image_N / ref_audio_N，prompt 与时长原样', () => {
  const intent = decode({
    prompt: '  猫回头看  ',
    duration: 3,
    resolution: '768p竖',
    images: ['https://api.jiucaihezi.studio/media/creation/a.png', 'https://api.jiucaihezi.studio/media/creation/b.png'],
    audios: ['https://api.jiucaihezi.studio/media/creation/c.mp3'],
  })
  assert.equal(intent.kind, 'submit')
  assert.equal(intent.action, 'image_to_video')
  assert.deepEqual(intent.requestBody, {
    model: LEGACY,
    prompt: '猫回头看',
    duration: 3,
    resolution: '768p竖',
    ref_image_0: 'https://api.jiucaihezi.studio/media/creation/a.png',
    ref_image_1: 'https://api.jiucaihezi.studio/media/creation/b.png',
    ref_audio_0: 'https://api.jiucaihezi.studio/media/creation/c.mp3',
  })
})

test('单数 image / 单元素数组都收', () => {
  const single = decode({ prompt: 'p', image: 'https://a/1.png' })
  assert.equal(single.requestBody.ref_image_0, 'https://a/1.png')
  const one = decode({ prompt: 'p', images: ['https://a/1.png'] })
  assert.equal(one.requestBody.ref_image_0, 'https://a/1.png')
})

test('duration 缺省按模型默认值（旧版 15 / 增强版 5），seconds 同义', () => {
  assert.equal(decode({ prompt: 'p' }).requestBody.duration, 15)
  assert.equal(decode({ prompt: 'p' }, ENHANCED).requestBody.duration, 5)
  assert.equal(decode({ prompt: 'p', seconds: 7 }).requestBody.duration, 7)
  // 显式 null 与不传同义
  assert.equal(decode({ prompt: 'p', duration: null }).requestBody.duration, 15)
})

test('方向以 resolution 为准；没给 resolution 才用 ratio 推导', () => {
  assert.equal(decode({ prompt: 'p', aspect_ratio: '9:16' }).requestBody.resolution, '768p竖')
  assert.equal(decode({ prompt: 'p', ratio: '16:9' }).requestBody.resolution, '768p横')
  assert.equal(decode({ prompt: 'p' }).requestBody.resolution, '768p竖')
  // 增强版才有 1:1
  assert.equal(decode({ prompt: 'p', ratio: '1:1' }, ENHANCED).requestBody.resolution, '768p(1:1)')
})

test('校验失败全是同步抛错（宿主回 400，不占额度）', () => {
  const cases = [
    [{ prompt: 'p' }, 'other-model', /Unsupported model/],
    [{}, LEGACY, /prompt is required/],
    [{ prompt: 'p', duration: 16 }, LEGACY, /duration must be from 1 to 15/],
    [{ prompt: 'p', duration: 0 }, LEGACY, /duration must be from 1 to 15/],
    [{ prompt: 'p', duration: true }, LEGACY, /duration must be from 1 to 15/],
    [{ prompt: 'p', resolution: '1080p竖' }, LEGACY, /Unsupported resolution/],
    [{ prompt: 'p', resolution: '768p(1:1)' }, LEGACY, /Unsupported resolution/],
    // 给了 resolution 又与 ratio 矛盾：不能让客户端拿到方向不对的视频
    [{ prompt: 'p', resolution: '768p竖', aspect_ratio: '16:9' }, LEGACY, /conflicts with aspect_ratio/],
    [{ prompt: 'p', images: ['ftp://a/1.png'] }, LEGACY, /reference media must be a URL/],
    [{ prompt: 'p', images: Array.from({ length: 10 }, (_, i) => `https://a/${i}.png`) }, LEGACY, /At most 9 reference images/],
    [{ prompt: 'p', audios: Array.from({ length: 4 }, (_, i) => `https://a/${i}.mp3`) }, LEGACY, /At most 3 reference audios/],
    [{ prompt: 'p', seed: -1 }, LEGACY, /seed must be a non-negative integer/],
    [{ prompt: 'p', seed: 1.5 }, LEGACY, /seed must be a non-negative integer/],
    [{ prompt: 'x'.repeat(12001) }, LEGACY, /at most 12000 characters/],
  ]
  for (const [value, model, pattern] of cases) {
    assert.throws(() => decode(value, model), pattern, JSON.stringify(value).slice(0, 80))
  }
  // 非 JSON body 也拒
  assert.throws(
    () => plugin.protocols.openai_video.decodeRequest({ model: LEGACY, body: { kind: 'multipart', fields: {} } }),
    /JSON body required/,
  )
})

test('seed 合法时原样转发', () => {
  assert.equal(decode({ prompt: 'p', seed: 0 }).requestBody.seed, 0)
  assert.equal(decode({ prompt: 'p', seed: 42 }).requestBody.seed, 42)
})

test('提交/轮询/取片都打同一个上游，密钥走渠道', () => {
  const ctx = { baseUrl: 'https://aimanplay.cn', apiKey: 'sk-test', model: LEGACY, requestBody: { model: LEGACY, prompt: 'p' }, action: 'image_to_video' }
  const submit = plugin.buildSubmitRequest(ctx)
  assert.equal(submit.url, 'https://aimanplay.cn/v1/videos')
  assert.equal(submit.method, 'POST')
  assert.equal(submit.headers.Authorization, 'Bearer sk-test')
  assert.deepEqual(submit.body, ctx.requestBody)

  const query = plugin.buildQueryRequest({ ...ctx, taskId: 'abc123' })
  assert.equal(query.url, 'https://aimanplay.cn/v1/videos/abc123')
  assert.equal(query.headers.Authorization, 'Bearer sk-test')

  const content = plugin.buildContentRequest({ ...ctx, artifactKey: 'video', upstreamTaskId: 'abc123', clientRequest: { method: 'GET' } })
  assert.equal(content.url, 'https://aimanplay.cn/v1/videos/abc123/content')
  assert.equal(content.headers.Authorization, 'Bearer sk-test')
  assert.throws(() => plugin.buildContentRequest({ ...ctx, artifactKey: 'poster', upstreamTaskId: 'abc123', clientRequest: { method: 'GET' } }), /artifact_not_found/)
})

test('parseSubmitResponse 取上游任务号', () => {
  assert.deepEqual(plugin.parseSubmitResponse({}, { statusCode: 200, body: { id: 'deadbeef', status: 'queued' } }), {
    taskId: 'deadbeef',
    taskData: { id: 'deadbeef', status: 'queued' },
  })
  assert.throws(() => plugin.parseSubmitResponse({}, { statusCode: 200, body: { status: 'queued' } }), /did not return a task ID/)
})

test('状态映射：queued/in_progress/completed/failed + 不认识的算 UNKNOWN', () => {
  // 上游枚举见 docs/wiki/运维/菠萝MiniMaxapi.md：queued / in_progress / completed / failed（另有兼容值 unknown）
  assert.equal(plugin.parseTaskResult({}, { status: 'queued' }).status, 'SUBMITTED')
  assert.equal(plugin.parseTaskResult({}, { status: 'in_progress' }).status, 'IN_PROGRESS')
  assert.equal(plugin.parseTaskResult({}, { status: 'completed' }).status, 'SUCCESS')
  const failed = plugin.parseTaskResult({}, { status: 'failed', error: { message: 'unsafe content' } })
  assert.equal(failed.status, 'FAILURE')
  assert.equal(failed.reason, 'unsafe content')
  // unknown 是上游的兼容值：不能当 IN_PROGRESS（宿主会把误报的终态当轮询失败）
  assert.equal(plugin.parseTaskResult({}, { status: 'unknown' }).status, 'UNKNOWN')
  assert.equal(plugin.parseTaskResult({}, {}).status, 'UNKNOWN')
  assert.equal(plugin.parseTaskResult({}, { status: '莫名其妙' }).status, 'UNKNOWN')
})

test('成片只在 SUCCESS 时挂 artifact', () => {
  assert.deepEqual(plugin.listArtifacts({ status: 'SUCCESS' }), [{ key: 'video', type: 'video', mimeType: 'video/mp4' }])
  assert.deepEqual(plugin.listArtifacts({ status: 'IN_PROGRESS' }), [])
})

test('用量：预留用请求时长，结算用上游实际时长', () => {
  assert.deepEqual(plugin.extractUsage({ requestBody: { duration: 3 } }), { seconds: 3 })
  assert.deepEqual(plugin.extractUsage({ requestBody: {} }), { seconds: 5 })
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, { duration: 12 }), { seconds: 12 })
  assert.equal(plugin.extractUsageOnComplete({}, {}, null), null)
})

test('render 输出 OpenAI video 形状', () => {
  const view = plugin.protocols.openai_video.render({}, { task_id: 'task_x', status: 'SUCCESS', progress: '100%', created_at: 1 })
  assert.equal(view.id, 'task_x')
  assert.equal(view.object, 'video')
  assert.equal(view.status, 'completed')
})
