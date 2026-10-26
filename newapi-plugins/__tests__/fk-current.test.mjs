import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as plugin from '../fk.plugin.js'

// 2026-10-26 用户提供的 FK 当前五个视频型号与售价。
const H3 = 'ft-video-v1-1eb6d53a32efa02adf7ae338f3239628'
const REAL = 'ft-video-v1-99d13a482c1f6f0e71db1e36c4154b70'
const SPECIAL = 'ft-video-v1-43644108aaba72b7cbad4cd322737f6c'
const decode = (model, value) => plugin.protocols.openai_video.decodeRequest({ model, body: { kind: 'json', value: { prompt: 'p', ...value } } })

test('FK 当前五个视频型号，H3 四档画质分别计量', () => {
  assert.equal(plugin.meta.models.filter(id => id.startsWith('ft-video-')).length, 5)
  for (const resolution of ['480p', '720p', '768p', '1080p']) {
    const intent = decode(H3, { duration: 5, resolution, ratio: '9:16' })
    const ctx = { model: H3, requestBody: intent.requestBody }
    assert.equal(plugin.extractUsage(ctx)['seconds_' + resolution], 5)
    assert.equal(plugin.extractUsageOnComplete(ctx, {}, { duration: 7, resolution })['seconds_' + resolution], 7)
  }
  assert.deepEqual(plugin.catalog.models.find(model => model.upstream === H3).refs, { images: 9, videos: 1, audios: 3 })
  assert.equal(plugin.extractUsage({ model: SPECIAL, requestBody: decode(SPECIAL, { duration: 4, resolution: '480p', ratio: '21:9' }).requestBody }).calls, 1)
  assert.throws(() => decode(SPECIAL, { duration: 4, resolution: '720p' }))
  const usage = plugin.extractUsage({ model: REAL, requestBody: decode(REAL, { duration: 30 }).requestBody })
  assert.equal(usage.calls, 1)
  assert.equal(usage.seconds, 0)
  for (const duration of [15, 29]) assert.throws(() => decode(REAL, { duration }), /duration/)
})

test('FK 映射覆盖全部公开名，已下架名称拒绝提交', () => {
  const mapping = JSON.parse(readFileSync(new URL('../fk-video-model-mapping.json', import.meta.url)))
  assert.deepEqual(Object.keys(mapping), ['特价渠道 MiniMax H3 480p-1080p', '特价渠道 Seedance 2.5 满血 720p（可过真人）', 'Seedance 2.5 满血 480-720p', 'XN2-Seedance 2.5 满血 480-720p', '特价渠道 Seedance 2.0 满血 480p (933)'])
  for (const [name, model] of Object.entries(mapping)) {
    const item = plugin.catalog.models.find(entry => entry.name === name)
    const intent = decode(name, { duration: item.duration.default, resolution: item.resolutions[0], ratio: item.ratios[0] })
    const request = plugin.buildSubmitRequest({ model: name, requestBody: intent.requestBody, baseUrl: plugin.meta.baseUrl, apiKey: 'fixture' })
    assert.equal(request.body.model, model)
    assert.equal(request.headers['X-Public-Model-Ids'], '1')
  }
  for (const model of ['Wan 3.0 720-1080p', '官方渠道-Seedance 2.5 满血 720p', '长期特惠 Seedance 2.5 满血 720p']) {
    assert.throws(() => decode(model, { duration: 30 }), /Unsupported/)
  }
})

test('FK 五个计费表达式按用户售价收费', () => {
  const pricing = JSON.parse(readFileSync(new URL('../fk-pricing.json', import.meta.url)))
  const mapping = JSON.parse(readFileSync(new URL('../fk-video-model-mapping.json', import.meta.url)))
  assert.deepEqual(pricing.models.map(row => row.model), Object.keys(mapping))
  const sale = {
    '特价渠道 MiniMax H3 480p-1080p': { '480p': 0.06, '720p': 0.07, '768p': 0.07, '1080p': 0.25 },
    '特价渠道 Seedance 2.5 满血 720p（可过真人）': { calls: 5 },
    'Seedance 2.5 满血 480-720p': { '480p': 0.4, '720p': 0.5 },
    'XN2-Seedance 2.5 满血 480-720p': { '480p': 0.4, '720p': 0.5 },
    '特价渠道 Seedance 2.0 满血 480p (933)': { calls: 2 },
  }
  for (const row of pricing.models) {
    assert.equal(row.upstreamModel, mapping[row.model])
    const cost = facts => Function('u', 'tier', `return (${row.expression})`)(key => facts[key] || 0, (_, value) => value)
    for (const [key, price] of Object.entries(sale[row.model])) {
      if (key === 'calls') assert.equal(cost({ calls: 1, seconds: 30 }), price)
      else assert.ok(Math.abs(cost({ ['seconds_' + key]: 10, seconds: 10, calls: 0 }) - 10 * price) < 1e-9, row.model + key)
    }
    assert.equal(cost({}), 0)
  }
})
