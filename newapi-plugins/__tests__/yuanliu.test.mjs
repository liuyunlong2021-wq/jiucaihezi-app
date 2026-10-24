import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as plugin from '../yuanliu.plugin.js'

const mapping = JSON.parse(readFileSync('newapi-plugins/yuanliu-model-mapping.json', 'utf8'))
const MODELS = Object.keys(mapping)
const DURATION = {
  'Seedance 2.5(HD)': 30,
  'Seedance 2.5 480p (QN-10)': 5,
  'Seedance2.0(HD)': 10,
  'Seedance2.5full (LJ-04)': 5,
  'Wan3.0视频Prime官渠稳定(WP-01)': 5,
  'Wan3.0官渠(WP-02)': 5,
}
const url = 'https://example.com/ref.png?sig=keep'
const decode = (model, fields = {}) => plugin.protocols.openai_video.decodeRequest({
  model,
  body: { kind: 'json', value: Object.freeze({ model, prompt: 'p', duration: DURATION[model], ...fields }) },
})
const submit = (model, fields = {}) => plugin.buildSubmitRequest({
  model,
  baseUrl: plugin.meta.baseUrl,
  requestBody: decode(model, fields).requestBody,
})

test('公开模型名映射上游 ID，素材上限与时长档位按型号校验', () => {
  assert.equal(plugin.meta.version, '0.2.0')
  assert.deepEqual([...plugin.meta.models].sort(), [...MODELS].sort())
  assert.deepEqual(Object.keys(plugin.meta.usageSchema).sort(), ['calls', 'resolution', 'seconds'])
  for (const [publicName, upstream] of Object.entries(mapping)) {
    assert.equal(submit(publicName).body.model, upstream)
    assert.equal(submit(publicName, { ratio: '9:16' }).body.aspect_ratio, '9:16')
  }

  assert.throws(() => decode('Seedance 2.5(HD)', { images: Array(31).fill(url) }), /at most 30/)
  assert.throws(() => decode('Seedance 2.5(HD)', { duration: 10 }), /30-30/)
  assert.throws(() => decode('Seedance2.0(HD)', { images: Array(10).fill(url) }), /at most 9/)
  assert.throws(() => decode('Seedance 2.5 480p (QN-10)', { videos: [url] }), /at most 0/)
  assert.throws(() => decode('Seedance 2.5 480p (QN-10)', { duration: 3 }), /4-30/)
  assert.throws(() => decode('Seedance2.0(HD)', { duration: 9 }), /10-15/)
  assert.throws(() => decode('Seedance2.5full (LJ-04)', { duration: 31 }), /5-30/)
  assert.throws(() => decode('Wan3.0官渠(WP-02)', { duration: 1 }), /2-30/)
  assert.throws(() => decode('Seedance2.5full (LJ-04)', { ratio: '2:1' }), /aspect_ratio must be one of/)
  assert.doesNotThrow(() => decode('Seedance 2.5 480p (QN-10)', { audios: Array(10).fill(url), duration: 30 }))
  assert.throws(() => decode('yl_seedance-2-5_0fab2f1b1f10'), /Unsupported model/)
})

test('Wan 3.0 画质缺省 480p，非法画质拒绝', () => {
  for (const model of ['Wan3.0视频Prime官渠稳定(WP-01)', 'Wan3.0官渠(WP-02)']) {
    assert.equal(submit(model).body.resolution, '480p')
    assert.equal(submit(model, { resolution: '1080P' }).body.resolution, '1080p')
    assert.throws(() => decode(model, { resolution: '768p' }), /resolution must be one of/)
    assert.equal(submit(model, { videos: Array(5).fill(url), audios: Array(5).fill(url) }).body.videos.length, 5)
  }
})

test('按次型号报 calls，按秒型号报 seconds 与画质', () => {
  assert.deepEqual(plugin.extractUsage({ model: 'Seedance 2.5 480p (QN-10)', requestBody: { duration: 12 } }), { calls: 1, seconds: 0, resolution: '480p' })
  assert.deepEqual(plugin.extractUsage({ model: 'Seedance2.5full (LJ-04)', requestBody: { duration: 12 } }), { calls: 1, seconds: 12, resolution: '480p' })
  const wan = { model: 'Wan3.0视频Prime官渠稳定(WP-01)', requestBody: { duration: 8, resolution: '720P' } }
  assert.deepEqual(plugin.extractUsage(wan), { calls: 1, seconds: 8, resolution: '720p' })
  assert.deepEqual(plugin.extractUsageOnComplete(wan, {}, { duration: 8 }), { calls: 1, seconds: 8, resolution: '720p' })
  assert.deepEqual(plugin.extractUsageOnComplete(wan, {}, {}), { calls: 1, seconds: 8, resolution: '720p' })
})

test('定价清单与插件六型号一致，按次用 calls、按秒用 seconds', () => {
  const pricing = JSON.parse(readFileSync('newapi-plugins/yuanliu-pricing.json', 'utf8'))
  assert.deepEqual(pricing.models.map((item) => item.model).sort(), [...plugin.meta.models].sort())
  for (const item of pricing.models) {
    assert.equal(item.upstreamModel, mapping[item.model])
    if (item.unit === '次') assert.match(item.expression, /u\("calls"\) \* [\d.]+/)
    else assert.match(item.expression, /u\("seconds"\) \* [\d.]+/)
  }
})
