import test from 'node:test'
import assert from 'node:assert/strict'
import * as plugin from '../fk.plugin.js'

test('FK current six models and resolution-specific H3 usage', () => {
  const ids = plugin.meta.models.filter(id => id.startsWith('ft-video-'))
  assert.equal(ids.length, 6)
  const model = 'ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746'
  for (const resolution of ['480p', '768p', '1080p']) {
    const intent = plugin.protocols.openai_video.decodeRequest({ model, body: { kind: 'json', value: { prompt: 'p', duration: 5, resolution } } })
    const ctx = { model, requestBody: intent.requestBody }
    assert.equal(plugin.extractUsage(ctx)['seconds_' + resolution], 5)
    assert.equal(plugin.extractUsageOnComplete(ctx, {}, { duration: 7, resolution })['seconds_' + resolution], 7)
  }
  const model933 = 'ft-video-v1-43644108aaba72b7cbad4cd322737f6c'
  const decode = value => plugin.protocols.openai_video.decodeRequest({ model: model933, body: { kind: 'json', value: { prompt: 'p', duration: 4, resolution: '480p', ratio: '21:9', ...value } } })
  const intent = decode({})
  assert.equal(plugin.extractUsage({ model: model933, requestBody: intent.requestBody }).calls, 1)
  assert.throws(() => decode({ resolution: '720p' }))
  assert.throws(() => decode({ duration: 3 }))
})

test('FK mapping covers every current public name and rejects retired names', async () => {
  const { readFileSync } = await import('node:fs')
  const mapping = JSON.parse(readFileSync(new URL('../fk-video-model-mapping.json', import.meta.url)))
  assert.equal(Object.keys(mapping).length, 6)
  assert.deepEqual(plugin.meta.models.filter(id => id.startsWith('ft-video-')).sort(), Object.values(mapping).sort())
  for (const [name, model] of Object.entries(mapping)) {
    const resolution = name.includes('(933)') || name.includes('480-720p') ? '480p' : name.includes('H3') ? '768p' : '720p'
    const value = { prompt: 'p', duration: name.startsWith('XN2') ? 15 : 5, resolution }
    const intent = plugin.protocols.openai_video.decodeRequest({ model: name, body: { kind: 'json', value } })
    assert.equal(intent.requestBody.model, model)
    const request = plugin.buildSubmitRequest({ model: name, requestBody: intent.requestBody, baseUrl: plugin.meta.baseUrl, apiKey: 'fixture' })
    assert.equal(request.body.model, model)
    assert.equal(request.headers['X-Public-Model-Ids'], '1')
  }
  for (const model of ['特价渠道 Seedance 2.5 满血 720p', '特价渠道 Seedance 2.5 满血 720p（可过真人）', '长期特惠 Seedance 2.5 满血 720p']) {
    assert.throws(() => plugin.protocols.openai_video.decodeRequest({ model, body: { kind: 'json', value: { prompt: 'p', duration: 30 } } }), /Unsupported/)
  }
})

test('FK all six pricing expressions charge only the relevant settled usage', async () => {
  const { readFileSync } = await import('node:fs')
  const pricing = JSON.parse(readFileSync(new URL('../fk-pricing.json', import.meta.url)))
  const mapping = JSON.parse(readFileSync(new URL('../fk-video-model-mapping.json', import.meta.url)))
  assert.deepEqual(pricing.models.map(row => row.model).sort(), Object.keys(mapping).sort())
  for (const row of pricing.models) {
    assert.equal(row.upstreamModel, mapping[row.model])
    const cost = facts => Function('u', 'tier', `return (${row.expression})`)(key => facts[key] || 0, (_, value) => value)
    if (row.salePriceCnyPerRequest) {
      assert.equal(cost({ calls: 1, seconds: 15 }), 2)
    } else if (typeof row.salePriceCnyPerSecond === 'object') {
      for (const [resolution, price] of Object.entries(row.salePriceCnyPerSecond)) {
        assert.equal(cost({ ['seconds_' + resolution]: 10, seconds: 10, calls: 0 }), 10 * price)
      }
    } else {
      assert.equal(cost({ seconds: 5 }), 5)
      assert.equal(cost({ seconds: 0, upstream_cost_yuan: 3.89, video_reference_tokens: 123456 }), 3.89)
    }
    assert.equal(cost({}), 0)
  }
})
