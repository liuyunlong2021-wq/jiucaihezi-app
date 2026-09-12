import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildCreationRunPlan } from '@/runtime/creation/creationMediaPlan'
import { getCreationModelSpec } from '@/runtime/creation/creationModelRegistry'
import { buildCurrentCreationParams, cpState, switchModel, switchTask } from '../useCreation'

const LEGACY = 'newapi/boluo/minimax_h3_image_audio_to_video_v2_15s'
const ENHANCED = 'newapi/boluo/minimax_h3_zm_u24'

/**
 * 菠萝两个模型的方向完全写在 resolution 后缀里（竖/横/(1:1)），没有比例参数。
 * 界面上残留的比例一旦跟着请求发出去，上游会按它改写画幅，所以必须一个都不带。
 */
test('菠萝两个模型只发分辨率，不发任何比例字段', () => {
  for (const model of [LEGACY, ENHANCED]) {
    switchTask('video')
    switchModel(model)
    cpState.ar = '16:9' // 界面/历史残留的比例，正好与下面这个分辨率矛盾
    cpState.res = '768p竖'

    const params = buildCurrentCreationParams()
    assert.equal('ratio' in params, false, model)
    assert.equal('aspectRatio' in params, false, model)
    assert.equal('aspect_ratio' in params, false, model)
    assert.equal(params.resolution, '768p竖', model)
  }
})

test('菠萝两个模型至少需要一张参考图，且计划里只带分辨率', () => {
  // 增强版多两个 1:1 档位，旧版只有四个竖/横档
  for (const [model, resolution] of [[LEGACY, '768p竖'], [ENHANCED, '768p(1:1)']] as const) {
    const spec = getCreationModelSpec(model)
    assert.equal(spec?.files?.images?.min, 1, model)
    assert.equal(spec?.fields.some(field => field.key === 'ratio'), false, model)

    assert.throws(
      () => buildCreationRunPlan({ modelId: model, params: { prompt: 'x', resolution } }),
      /参考图至少需要 1 个/,
      model,
    )

    const plan = buildCreationRunPlan({
      modelId: model,
      params: { prompt: 'x', resolution, images: ['https://a.example/1.png'] },
    })
    assert.equal(plan.debug.normalizedParams.resolution, resolution, model)
    assert.equal('aspect_ratio' in plan.debug.normalizedParams, false, model)
    assert.equal('ratio' in plan.debug.normalizedParams, false, model)
  }
})

test('仍然带比例字段的模型行为不变', () => {
  switchTask('video')
  switchModel('newapi/xiaoyi/kling-video-v3')
  cpState.ar = '9:16'

  const params = buildCurrentCreationParams()
  assert.equal(params.aspect_ratio, '9:16')
  assert.equal(params.ratio, '9:16')
  assert.equal(params.aspectRatio, '9:16')
})
