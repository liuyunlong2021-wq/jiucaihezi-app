// 夹具：锁住 t8-mj 插件的对外行为（直连 T8，无适配器）。
// 跑法：node --test newapi-plugins/__tests__/t8-mj.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'

import * as plugin from '../t8-mj.plugin.js'

const MJ = 'mj_relax_imagine'
const BASE = 'https://ai.t8star.org'
const KEY = ['Bearer', 't8-key'].join(' ')

function decode(value, model = MJ) {
  return plugin.protocols.openai_video.decodeRequest({
    model,
    body: { kind: 'json', value: { model, ...value } },
  })
}

function decodeForm(fields, files = []) {
  return plugin.protocols.openai_video.decodeRequest({
    model: MJ,
    body: { kind: 'multipart', fields, files },
  })
}

test('meta：直连 T8，不需要任何部署', () => {
  assert.equal(plugin.meta.apiVersion, 1)
  assert.equal(plugin.meta.key, 't8-mj')
  assert.equal(plugin.meta.version, '0.3.0')
  assert.equal(plugin.meta.fetchMode, 'per_task')
  assert.deepEqual(plugin.meta.protocols, ['openai_video'])
  assert.equal(plugin.meta.baseUrl, BASE)
  assert.doesNotMatch(plugin.meta.baseUrl, /adapter|8789|localhost/)
  assert.deepEqual(plugin.meta.models, [MJ])
  assert.deepEqual(Object.keys(plugin.meta.usageSchema), ['calls'])
})

test('★ 每个 usageExample 都要带齐所有声明的用量 key（宿主上传校验，少了直接拒收）', () => {
  const keys = Object.keys(plugin.meta.usageSchema)
  for (const example of plugin.meta.usageExamples) {
    for (const key of keys) {
      assert.ok(Object.prototype.hasOwnProperty.call(example.facts, key), `${example.label} 缺 ${key}`)
    }
  }
})

test('提交地址是 T8 的 mj-relax，不是适配器也不是 /v1/videos', () => {
  const submit = plugin.buildSubmitRequest({
    baseUrl: BASE,
    apiKey: 't8-key',
    model: MJ,
    requestBody: { model: MJ, prompt: '一个中国美女' },
    action: 'text_to_image',
  })
  assert.equal(submit.url, 'https://ai.t8star.org/mj-relax/mj/submit/imagine')
  assert.equal(submit.method, 'POST')
  assert.equal(submit.headers.Authorization, KEY)
  // 上游只认这两个字段
  assert.deepEqual(submit.body, { prompt: '一个中国美女', base64Array: [] })
})

test('★ 渠道 Base URL 被忽略：填了过期内网地址也照样打 T8', () => {
  for (const baseUrl of ['', 'http://t8-mj-adapter:8789', 'https://ai.t8star.org///', 'http://example.invalid']) {
    const submit = plugin.buildSubmitRequest({
      baseUrl,
      apiKey: 't8-key',
      model: MJ,
      requestBody: { model: MJ, prompt: 'p' },
      action: 'text_to_image',
    })
    assert.equal(submit.url, 'https://ai.t8star.org/mj-relax/mj/submit/imagine', baseUrl)

    const query = plugin.buildQueryRequest({ baseUrl, apiKey: 't8-key', taskId: '1' })
    assert.equal(query.url, 'https://ai.t8star.org/mj-relax/mj/task/1/fetch', baseUrl)
  }
})

test('查询走 T8 的 /mj-relax/mj/task/{id}/fetch', () => {
  const query = plugin.buildQueryRequest({ baseUrl: BASE, apiKey: 't8-key', taskId: '1320098173412546' })
  assert.equal(query.url, 'https://ai.t8star.org/mj-relax/mj/task/1320098173412546/fetch')
  assert.equal(query.method, 'GET')
  assert.equal(query.headers.Authorization, KEY)
})

test('★ 面板发的是 multipart（无参考图）—— 必须接受', () => {
  const intent = decodeForm({
    model: [MJ],
    prompt: ['一个中国美女'],
    seconds: ['1'],
    response_format: ['url'],
  })
  assert.equal(intent.action, 'text_to_image')
  assert.deepEqual(intent.requestBody, { model: MJ, prompt: '一个中国美女', ratio: '' })
})

test('★ 比例拼成 --ar：面板选 16:9 → 提示词追加一次，自己写过就不重复', () => {
  const withRatio = decodeForm({ model: [MJ], prompt: ['一个中国美女'], ratio: ['16:9'] })
  const submit = plugin.buildSubmitRequest({
    baseUrl: BASE,
    apiKey: 't8-key',
    model: MJ,
    requestBody: withRatio.requestBody,
    action: withRatio.action,
  })
  assert.deepEqual(submit.body, { prompt: '一个中国美女 --ar 16:9', base64Array: [] })

  // 用户自己在提示词里写了 --ar，就不再追加
  const manual = decodeForm({ model: [MJ], prompt: ['一个中国美女 --ar 9:16'], ratio: ['16:9'] })
  const manualSubmit = plugin.buildSubmitRequest({
    baseUrl: BASE,
    apiKey: 't8-key',
    model: MJ,
    requestBody: manual.requestBody,
    action: manual.action,
  })
  assert.deepEqual(manualSubmit.body, { prompt: '一个中国美女 --ar 9:16', base64Array: [] })

  // 没有比例就原样发
  const none = decodeForm({ model: [MJ], prompt: ['一个中国美女'] })
  const noneSubmit = plugin.buildSubmitRequest({
    baseUrl: BASE,
    apiKey: 't8-key',
    model: MJ,
    requestBody: none.requestBody,
    action: none.action,
  })
  assert.deepEqual(noneSubmit.body, { prompt: '一个中国美女', base64Array: [] })

  // 比例只认 W:H，别让任意 MJ 参数借这个字段混进来
  assert.throws(() => decodeForm({ model: [MJ], prompt: ['p'], ratio: ['16:9 --v 7'] }), /Unsupported ratio/)
})

test('参考图明确拒绝，避免上游静默丢图', () => {
  assert.throws(
    () => decodeForm({ model: [MJ], prompt: ['p'] }, [{ ref: 'file-1', filename: 'reference.png' }]),
    /只支持文生图/,
  )
  assert.throws(() => decode({ prompt: 'p', image: 'data:image/png;base64,aGVsbG8=' }), /只支持文生图/)
})

test('白名单只有 relax：fast 属于 ZX 渠道', () => {
  assert.throws(() => decode({ prompt: 'p' }, 'mj_fast_imagine'), /Unsupported model/)
  assert.throws(() => decode({ prompt: 'p' }, 'seedance-2.5'), /Unsupported model/)
  assert.throws(() => decode({ prompt: '   ' }), /prompt is required/)
  assert.throws(
    () => plugin.protocols.openai_video.decodeRequest({ model: MJ, body: { kind: 'xml', value: {} } }),
    /JSON or multipart image request required/,
  )
})

test('提交响应：code=1 且带 result 才算受理', () => {
  assert.deepEqual(plugin.parseSubmitResponse({}, { statusCode: 200, body: { code: 1, result: '1320098173412546' } }), {
    taskId: '1320098173412546',
    taskData: { id: '1320098173412546', status: 'SUBMITTED' },
  })
  // 22 = 排队中，没有 result，不能当成功
  assert.throws(
    () => plugin.parseSubmitResponse({}, { statusCode: 200, body: { code: 22, description: '排队中' } }),
    /排队中/,
  )
  assert.throws(
    () => plugin.parseSubmitResponse({}, { statusCode: 200, body: { code: 3, description: '额度不足' } }),
    /额度不足/,
  )
})

test('状态映射用 MJ 自己的词', () => {
  for (const [raw, expected] of [
    ['NOT_START', 'QUEUED'],
    ['SUBMITTED', 'QUEUED'],
    ['MODAL', 'IN_PROGRESS'],
    ['IN_PROGRESS', 'IN_PROGRESS'],
    ['SUCCESS', 'SUCCESS'],
    ['FAILURE', 'FAILURE'],
  ]) {
    const body = raw === 'SUCCESS' ? { status: raw, imageUrl: 'https://img.innk.cc/a.png' } : { status: raw }
    assert.equal(plugin.parseTaskResult({}, body).status, expected, raw)
  }
  assert.equal(plugin.parseTaskResult({}, {}).status, 'UNKNOWN')
  assert.equal(plugin.parseTaskResult({}, { status: '神秘状态' }).status, 'UNKNOWN')
})

test('成图取 imageUrl；缺失即失败，不空转成功', () => {
  const done = plugin.parseTaskResult({}, { status: 'SUCCESS', imageUrl: 'https://img.innk.cc/a.png' })
  assert.equal(done.status, 'SUCCESS')
  assert.equal(done.url, 'https://img.innk.cc/a.png')

  const broken = plugin.parseTaskResult({}, { status: 'SUCCESS' })
  assert.equal(broken.status, 'FAILURE')
  assert.match(broken.reason, /without imageUrl/)

  const failed = plugin.parseTaskResult({}, { status: 'FAILURE', failReason: '任务被拦截' })
  assert.equal(failed.status, 'FAILURE')
  assert.equal(failed.reason, '任务被拦截')
})

test('render / listArtifacts / buildContentRequest 都把成图当 image', () => {
  const data = { status: 'SUCCESS', imageUrl: 'https://img.innk.cc/a.png' }
  const task = { task_id: '1', status: 'SUCCESS', progress: '100%', created_at: 1759300000, data }
  const view = plugin.protocols.openai_video.render({}, task)
  assert.equal(view.object, 'image')
  assert.equal(view.url, 'https://img.innk.cc/a.png')
  assert.deepEqual(view.metadata, { url: 'https://img.innk.cc/a.png' })

  assert.deepEqual(plugin.listArtifacts(task), [{ key: 'image', type: 'image', mimeType: 'image/png' }])
  assert.deepEqual(plugin.listArtifacts({ status: 'IN_PROGRESS', data }), [])

  const request = plugin.buildContentRequest({ data, artifactKey: 'image', clientRequest: { method: 'GET' } })
  assert.equal(request.url, 'https://img.innk.cc/a.png')
  assert.equal(request.credentialless, true)
  assert.throws(() => plugin.buildContentRequest({ data, artifactKey: 'video', clientRequest: { method: 'GET' } }), /artifact_not_found/)
})

test('失败任务渲染出错误，不在成功态写地址', () => {
  const task = {
    task_id: '1',
    status: 'FAILURE',
    progress: '0%',
    created_at: 1759300000,
    data: { status: 'FAILURE', failReason: '任务被拦截' },
  }
  const view = plugin.protocols.openai_video.render({}, task)
  assert.equal(view.url, undefined)
  assert.equal(view.error, '任务被拦截')
})

test('用量恒为一次调用（按张计费）', () => {
  assert.deepEqual(plugin.extractUsage({ model: MJ, requestBody: { prompt: 'p' } }), { calls: 1 })
  assert.deepEqual(plugin.extractUsageOnComplete({}, {}, {}), { calls: 1 })
})
