import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as plugin from '../fk.plugin.js'

const source = readFileSync(new URL('../fk.plugin.js', import.meta.url), 'utf8')
const mapping = JSON.parse(readFileSync(new URL('../fk-video-model-mapping.json', import.meta.url), 'utf8'))

function decode(model, value) {
  return plugin.protocols.openai_video.decodeRequest({ model: model.name, body: { kind: 'json', value: { prompt: 'p', ...value } } })
}

function base(model) {
  return { ratio: model.ratios[0], resolution: model.resolutions[0], duration: model.duration.default }
}

test('FK 面板目录是标记包裹的纯 JSON，可不执行插件代码读取', () => {
  const match = /\/\*jc-catalog\*\/([\s\S]*?)\/\*end-jc-catalog\*\//.exec(source)
  assert.ok(match, 'catalog markers missing')
  assert.deepEqual(JSON.parse(match[1]), plugin.catalog)
  assert.equal(plugin.catalog.schema, 'jc-catalog-v1')
})

test('FK 目录与公开名映射、插件白名单逐字一致', () => {
  const models = plugin.catalog.models
  assert.deepEqual(Object.fromEntries(models.map(model => [model.name, model.upstream])), mapping)
  assert.deepEqual(plugin.meta.models.filter(id => id.startsWith('ft-video-')).sort(), models.map(model => model.upstream).sort())
  for (const model of models) assert.ok(plugin.meta.models.includes(model.name), model.name)
})

test('FK 按次型号默认时长取该型号最大值', () => {
  // 按次收费与时长无关，面板默认给最长时长（用户 2026-10-29 确认）。
  for (const model of plugin.catalog.models.filter(item => item.billing === 'request')) {
    const max = model.duration.values ? Math.max(...model.duration.values) : model.duration.max
    assert.equal(model.duration.default, max, model.name)
  }
})

test('FK 插件校验完全由目录推导', () => {
  for (const model of plugin.catalog.models) {
    const intent = decode(model, base(model))
    assert.equal(intent.requestBody.model, model.upstream, model.name)
    const usage = plugin.extractUsage({ model: model.name, requestBody: intent.requestBody })
    // 按次但多画质定价的型号按画质各计一次调用（calls_720p / calls_1080p），不再置 calls。
    const tiered = model.billing === 'request' && model.resolutions.length > 1
    assert.equal(usage.calls, model.billing === 'request' && !tiered ? 1 : 0, model.name)
    if (tiered) assert.equal(usage['calls_' + model.resolutions[0]], 1, model.name)

    for (const ratio of model.ratios) decode(model, { ...base(model), ratio })
    for (const resolution of model.resolutions) decode(model, { ...base(model), resolution })
    for (const ratio of ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].filter(item => !model.ratios.includes(item))) {
      assert.throws(() => decode(model, { ...base(model), ratio }), /ratio/, `${model.name} ${ratio}`)
    }
    assert.throws(() => decode(model, { ...base(model), resolution: '2k' }), /resolution/)

    const durations = model.duration.values || [model.duration.min, model.duration.max]
    for (const duration of durations) decode(model, { ...base(model), duration })
    const outside = model.duration.values ? [Math.min(...durations) - 1, Math.max(...durations) + 1] : [model.duration.min - 1, model.duration.max + 1]
    for (const duration of outside) assert.throws(() => decode(model, { ...base(model), duration }), /duration/, `${model.name} ${duration}`)

    for (const [field, key] of [['imageUrls', 'images'], ['videoUrls', 'videos'], ['audioUrls', 'audios']]) {
      const max = model.refs[key]
      if (max) decode(model, { ...base(model), [field]: Array(max).fill('https://a/r') })
      assert.throws(() => decode(model, { ...base(model), [field]: Array(max + 1).fill('https://a/r') }), new RegExp(key))
    }
    if (model.promptMax) assert.throws(() => decode(model, { ...base(model), prompt: 'x'.repeat(model.promptMax + 1) }), /prompt/)
  }
})
