import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as plugin from '../yuanliu.plugin.js'

const source = readFileSync(new URL('../yuanliu.plugin.js', import.meta.url), 'utf8')
const mapping = JSON.parse(readFileSync(new URL('../yuanliu-model-mapping.json', import.meta.url), 'utf8'))
const pricing = JSON.parse(readFileSync(new URL('../yuanliu-pricing.json', import.meta.url), 'utf8'))
const models = plugin.catalog.models

// 2026-10-26 用户提供的源流模型中心截图与售价。
const EXPECTED = {
  'Seedance 2.5(HD)': { upstream: 'yl_seedance-2-5_6caffaca7390', refs: [10, 0, 0], res: ['720p'], duration: [10, 30], billing: 'request' },
  'Seedance 2.5 (LJ-02)': { upstream: 'yl_g7zy_seedance_v2_5_s', refs: [30, 0, 0], res: ['720p'], duration: [5, 30], billing: 'second' },
  'Seedance 2.5 720p (QN-12)': { upstream: 'yl_pp_mj_sd25_30010', refs: [30, 0, 10], res: ['480p', '720p', '1080p'], duration: [4, 30], billing: 'second' },
  'Seedance 2.5 (RK-02)': { upstream: 'yl_cm_73', refs: [30, 10, 10], res: ['480p', '720p'], duration: [4, 30], billing: 'second' },
  'Seedance2.0 720P (YC-02)': { upstream: 'yl_zh_tt_sedanco_2_0_720', refs: [9, 3, 3], res: ['720p'], duration: [5, 15], billing: 'second' },
  'Seedance2.0(HD)': { upstream: 'yl_seedance-2-0_ba0687ff09f2', refs: [9, 0, 0], res: ['720p'], values: [10, 15], billing: 'request' },
}

const decode = (model, fields = {}) => plugin.protocols.openai_video.decodeRequest({
  model: model.name,
  body: { kind: 'json', value: Object.freeze({ model: model.name, prompt: 'p', duration: model.duration.default, ...fields }) },
})
const submit = (model, fields = {}) => plugin.buildSubmitRequest({
  model: model.name,
  baseUrl: plugin.meta.baseUrl,
  apiKey: 'fixture',
  requestBody: decode(model, fields).requestBody,
})

test('源流面板目录是标记包裹的纯 JSON，六型号与截图规格一致', () => {
  const match = /\/\*jc-catalog\*\/([\s\S]*?)\/\*end-jc-catalog\*\//.exec(source)
  assert.ok(match, 'catalog markers missing')
  assert.deepEqual(JSON.parse(match[1]), plugin.catalog)
  assert.equal(plugin.meta.version, '0.3.0')
  assert.deepEqual(models.map(model => model.name), Object.keys(EXPECTED))
  for (const model of models) {
    const expected = EXPECTED[model.name]
    assert.equal(model.upstream, expected.upstream, model.name)
    assert.deepEqual([model.refs.images, model.refs.videos, model.refs.audios], expected.refs, model.name)
    assert.deepEqual(model.resolutions, expected.res, model.name)
    assert.equal(model.billing, expected.billing, model.name)
    if (expected.values) assert.deepEqual(model.duration.values, expected.values, model.name)
    else assert.deepEqual([model.duration.min, model.duration.max], expected.duration, model.name)
    assert.equal(model.group, '源流 AI')
  }
  assert.deepEqual(Object.fromEntries(models.map(model => [model.name, model.upstream])), mapping)
  assert.deepEqual([...plugin.meta.models].sort(), [...Object.keys(mapping)].sort())
})

test('插件校验由目录推导：比例、画质、时长、素材上限', () => {
  for (const model of models) {
    const base = { aspect_ratio: model.ratios[0], resolution: model.resolutions[0] }
    for (const ratio of model.ratios) decode(model, { ...base, aspect_ratio: ratio })
    for (const resolution of model.resolutions) decode(model, { ...base, resolution })
    assert.throws(() => decode(model, { ...base, aspect_ratio: '5:4' }), /aspect_ratio/)
    assert.throws(() => decode(model, { ...base, resolution: '2k' }), /resolution/)
    const durations = model.duration.values || [model.duration.min, model.duration.max]
    for (const duration of durations) decode(model, { ...base, duration })
    for (const duration of [Math.min(...durations) - 1, Math.max(...durations) + 1]) {
      assert.throws(() => decode(model, { ...base, duration }), /duration/, `${model.name} ${duration}`)
    }
    if (model.duration.values) assert.throws(() => decode(model, { ...base, duration: 12 }), /duration/)
    for (const kind of ['images', 'videos', 'audios']) {
      const max = model.refs[kind]
      if (max) decode(model, { ...base, [kind]: Array(max).fill('https://a/r') })
      assert.throws(() => decode(model, { ...base, [kind]: Array(max + 1).fill('https://a/r') }), new RegExp(kind))
    }
  }
})

test('提交使用上游 ID，带上画幅与画质；按次报 calls、按秒报 seconds', () => {
  for (const model of models) {
    const request = submit(model, { aspect_ratio: model.ratios.at(-1), resolution: model.resolutions.at(-1), client_request_id: 'r1' })
    assert.equal(request.url, plugin.meta.baseUrl + '/v1/videos')
    assert.equal(request.body.model, model.upstream)
    assert.equal(request.body.aspect_ratio, model.ratios.at(-1))
    assert.equal(request.body.resolution, model.resolutions.at(-1))
    assert.equal(request.body.client_request_id, 'r1')
    const usage = plugin.extractUsage({ model: model.name, requestBody: decode(model, { resolution: model.resolutions.at(-1) }).requestBody })
    assert.equal(usage.calls, 1)
    assert.equal(usage.seconds, model.billing === 'second' ? model.duration.default : 0)
    assert.equal(usage.resolution, model.resolutions.at(-1))
  }
})

test('定价清单与目录一致，表达式按用户售价收费', () => {
  assert.deepEqual(pricing.models.map(row => row.model), models.map(model => model.name))
  const price = (row, facts) => Function('u', 'tier', `return (${row.expression})`)(key => facts[key] ?? 0, (_, value) => value)
  const sale = {
    'Seedance 2.5(HD)': { calls: 6 },
    'Seedance 2.5 (LJ-02)': { '720p': 0.5 },
    'Seedance 2.5 720p (QN-12)': { '480p': 0.6, '720p': 0.6, '1080p': 1 },
    'Seedance 2.5 (RK-02)': { '480p': 0.6, '720p': 0.8 },
    'Seedance2.0 720P (YC-02)': { '720p': 0.4 },
    'Seedance2.0(HD)': { calls: 4 },
  }
  for (const row of pricing.models) {
    assert.equal(row.upstreamModel, mapping[row.model])
    for (const [key, value] of Object.entries(sale[row.model])) {
      if (key === 'calls') assert.equal(price(row, { calls: 1, seconds: 0, resolution: '720p' }), value)
      else assert.equal(price(row, { calls: 1, seconds: 10, resolution: key }), 10 * value, `${row.model} ${key}`)
    }
  }
})
