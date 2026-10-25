import assert from 'node:assert/strict'
import { test } from 'node:test'

import { catalog as fkCatalog } from '../../../../newapi-plugins/fk.plugin.js'
import { buildCreationRunPlan, usesNewApiContentEndpoint } from '../creationMediaPlan'
import { creationModelFamily, displayModelPrice, getCreationModelSpec, listCreationModels } from '../creationModelRegistry'
import { applyRemoteCatalog, parsePluginCatalogModel, restoreRemoteCatalog } from '../remoteCreationCatalog'
import { getMediaModel } from '@/data/mediaModelCapabilities'
import { normalizeCreationModelAvailability } from '@/services/creationModelAvailability'

const NEW_ID = 'ft-video-v1-00000000000000000000000000000001'
const NEW_NAME = '测试新型号 Seedance 9 720p'

function fkVideoIds() {
  return listCreationModels({ task: 'video' }).filter(model => model.id.startsWith('newapi/fk/')).map(model => model.id)
}

function remote(models: unknown[]) {
  return models.map(spec => ({ id: (spec as { name: string }).name, status: 'enabled', spec }))
}

function withChannel(model: Record<string, unknown>) {
  return { ...model, channel: 'fk' }
}

const NEW_MODEL = withChannel({
  name: NEW_NAME, upstream: NEW_ID, task: 'video', group: 'FK · 新系列',
  ratios: ['16:9', '9:16'], resolutions: ['720p'], duration: { values: [10, 20], default: 10 },
  refs: { images: 4, videos: 0, audios: 1 }, billing: 'request', price: '¥7/次',
})

test('内置 FK 视频条目全部由插件目录生成', () => {
  restoreRemoteCatalog(null)
  assert.deepEqual(fkVideoIds(), fkCatalog.models.map(model => `newapi/fk/${model.upstream}`))
  for (const model of fkCatalog.models) {
    const spec = getCreationModelSpec(`newapi/fk/${model.upstream}`)!
    assert.equal(spec.model, model.name)
    assert.equal(spec.label, model.name)
    assert.equal(spec.price, model.price)
    assert.equal(creationModelFamily(spec), model.group)
    assert.deepEqual(spec.capabilities.ratios, model.ratios)
    assert.deepEqual(spec.capabilities.resolutions, model.resolutions)
    assert.equal(spec.files?.images?.max, model.refs.images)
    assert.equal(spec.files?.videos?.max || 0, model.refs.videos)
    assert.equal(spec.files?.audios?.max || 0, model.refs.audios)
    const executable = getMediaModel(model.upstream)!
    assert.equal(executable.model, model.name)
    assert.equal(executable.fields.find(field => field.key === 'duration')?.defaultValue, model.duration.default)
    assert.equal(usesNewApiContentEndpoint({ model: model.name }), true)
  }
})

test('目录型号校验严格，非法、非视频或未知渠道一律忽略', () => {
  assert.ok(parsePluginCatalogModel(NEW_MODEL))
  const bad = [
    { ...NEW_MODEL, channel: 'yihong' },
    { ...NEW_MODEL, task: 'image' },
    { ...NEW_MODEL, upstream: '' },
    { ...NEW_MODEL, ratios: [] },
    { ...NEW_MODEL, ratios: [1] },
    { ...NEW_MODEL, duration: { min: 30, max: 4, default: 4 } },
    { ...NEW_MODEL, duration: { values: [10], default: 99 } },
    { ...NEW_MODEL, refs: { images: -1, videos: 0, audios: 0 } },
    { ...NEW_MODEL, refs: { images: 1e9, videos: 0, audios: 0 } },
    { ...NEW_MODEL, billing: 'free' },
    { ...NEW_MODEL, name: 'x'.repeat(200) },
    null,
    'string',
  ]
  for (const item of bad) assert.equal(parsePluginCatalogModel(item), undefined, JSON.stringify(item))
})

test('下发的目录替换 FK 视频条目：新增可执行、下架消失、价格与分组跟随', () => {
  const kept = withChannel(fkCatalog.models[0])
  const repriced = withChannel({ ...fkCatalog.models[1], price: '¥9/秒' })
  assert.equal(applyRemoteCatalog(remote([kept, repriced, NEW_MODEL])), true)

  assert.deepEqual(fkVideoIds(), [kept, repriced, NEW_MODEL].map(model => `newapi/fk/${model.upstream}`))
  assert.equal(getCreationModelSpec(`newapi/fk/${fkCatalog.models[2].upstream}`), undefined)
  assert.equal(getMediaModel(fkCatalog.models[2].upstream), undefined)
  assert.equal(getCreationModelSpec(`newapi/fk/${repriced.upstream}`)!.price, '¥9/秒')
  assert.equal(displayModelPrice(getCreationModelSpec(`newapi/fk/${repriced.upstream}`)!), '9/秒')

  const spec = getCreationModelSpec(`newapi/fk/${NEW_ID}`)!
  assert.equal(creationModelFamily(spec), 'FK · 新系列')
  assert.deepEqual(spec.capabilities.duration, { allowedValues: [10, 20] })
  assert.equal(getMediaModel(NEW_ID)!.model, NEW_NAME)
  assert.equal(usesNewApiContentEndpoint({ model: NEW_NAME }), true)
  const plan = buildCreationRunPlan({ modelId: spec.id, params: { prompt: 'p', duration: 20, resolution: '720p', ratio: '9:16' } })
  assert.equal(plan.model, NEW_NAME)
  assert.equal(plan.endpoint, '/v1/videos')
  assert.throws(() => buildCreationRunPlan({ modelId: spec.id, params: { prompt: 'p', duration: 15, resolution: '720p', ratio: '9:16' } }))

  assert.equal(applyRemoteCatalog(remote([kept, repriced, NEW_MODEL])), false, '内容未变不重复刷新')
})

test('无有效目录时保留现状，冲突名不覆盖非目录模型，可从缓存恢复', () => {
  const before = fkVideoIds()
  assert.equal(applyRemoteCatalog([{ id: 'x', status: 'enabled' }]), false)
  assert.equal(applyRemoteCatalog(remote([{ ...NEW_MODEL, channel: 'unknown' }])), false)
  assert.deepEqual(fkVideoIds(), before)

  const clash = withChannel({ ...NEW_MODEL, name: 'yh-minimax H3', upstream: 'ft-video-v1-clash' })
  applyRemoteCatalog(remote([NEW_MODEL, clash]))
  assert.equal(getCreationModelSpec('newapi/fk/ft-video-v1-clash'), undefined)
  assert.equal(getCreationModelSpec('newapi/yihong/yh-minimax H3')?.model, 'yh-minimax H3')

  const stored = new Map<string, string>()
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) }
  applyRemoteCatalog(remote([NEW_MODEL]), storage)
  restoreRemoteCatalog(null)
  assert.equal(getCreationModelSpec(`newapi/fk/${NEW_ID}`), undefined)
  restoreRemoteCatalog(storage)
  assert.equal(getCreationModelSpec(`newapi/fk/${NEW_ID}`)?.model, NEW_NAME)
  restoreRemoteCatalog(null)
  assert.deepEqual(fkVideoIds(), fkCatalog.models.map(model => `newapi/fk/${model.upstream}`))
})

test('可用性响应保留目录规格', () => {
  const [item] = normalizeCreationModelAvailability({ data: { models: [{ id: NEW_NAME, status: 'enabled', spec: NEW_MODEL }] } })
  assert.deepEqual(item!.spec, NEW_MODEL)
})
