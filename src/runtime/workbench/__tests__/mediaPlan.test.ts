import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MEDIA_PLAN_POLICY,
  buildMediaPlanPolicy,
  getMediaPlanEditorControls,
  parseMediaPlan,
  updateMediaPlanParameters,
  validateMediaPlan,
} from '../mediaPlan'
import {
  clearMediaModelAvailability,
  setMediaModelAvailability,
} from '@/data/mediaModelCapabilities'

test('media plan parser accepts one fenced image plan', () => {
  const plan = parseMediaPlan([
    '方案如下：',
    '```jc-media-plan',
    JSON.stringify({
      kind: 'image',
      title: '精华液主图',
      prompt: '白色台面上的精华液产品摄影',
      modelId: 'newapi/t8/gpt-image-2',
      ratio: '1:1',
      resolution: '2k',
      referenceIds: ['ref_product'],
    }),
    '```',
  ].join('\n'))

  assert.deepEqual(plan, {
    kind: 'image',
    title: '精华液主图',
    prompt: '白色台面上的精华液产品摄影',
    modelId: 'newapi/t8/gpt-image-2',
    ratio: '1:1',
    resolution: '2k',
    referenceIds: ['ref_product'],
  })
})

test('model-authored plans cannot inject media paths or URLs', () => {
  assert.throws(
    () =>
      parseMediaPlan(
        [
          '```jc-media-plan',
          JSON.stringify({
            kind: 'video',
            title: '错误引用',
            prompt: '生成视频',
            modelId: 'newapi/zx/grok-1.5-video-6s',
            referenceImages: ['file:///Users/example/private.png'],
          }),
          '```',
        ].join('\n'),
      ),
    /referenceImages.*不能由模型提供/,
  )
})

test('native media planning does not require a bundled Skill', () => {
  assert.doesNotMatch(MEDIA_PLAN_POLICY, /jc-instant-create/)
})

test('native media policy is generated from the executable Creation registry', () => {
  const policy = buildMediaPlanPolicy('本轮可用参考素材：ref_recent | image | 最近生成图')

  assert.match(policy, /newapi\/zx\/grok-1\.5-video-6s/)
  assert.match(policy, /参考图 0-1/)
  assert.match(policy, /价格 0\.8/)
  assert.match(policy, /ref_recent/)
  assert.doesNotMatch(policy, /newapi\/t8\/grok-video-3(?:\s|\||$)/)
})

test('native media planning excludes models disabled by live availability', () => {
  setMediaModelAvailability([{ id: 'gpt-image-2', status: 'disabled' }])
  try {
    const policy = buildMediaPlanPolicy()
    assert.doesNotMatch(policy, /newapi\/t8\/gpt-image-2(?:\s|\||$)/)
    assert.throws(
      () =>
        validateMediaPlan({
          kind: 'image',
          title: '已下线模型',
          prompt: '生成图片',
          modelId: 'newapi/t8/gpt-image-2',
        }),
      /当前不可用/,
    )
  } finally {
    clearMediaModelAvailability()
  }
})

test('media plan parser rejects prose or incomplete plans', () => {
  assert.throws(() => parseMediaPlan('只有一段提示词，没有计划块'), /媒体计划/)
  assert.throws(() => parseMediaPlan('```jc-media-plan\n{"kind":"image","title":"主图","modelId":"newapi/t8/gpt-image-2"}\n```'), /prompt/)
})

test('media plan validator only permits registered image models and their declared options', () => {
  const valid = {
    kind: 'image' as const,
    title: '精华液主图',
    prompt: '白色台面上的精华液产品摄影',
    modelId: 'newapi/t8/gpt-image-2',
    ratio: '1:1',
    resolution: '2k',
  }

  assert.doesNotThrow(() => validateMediaPlan(valid))
  assert.throws(() => validateMediaPlan({ ...valid, modelId: 'made-up-model' }), /未注册/)
  assert.throws(() => validateMediaPlan({ ...valid, ratio: '100:1' }), /比例不支持/)
  assert.throws(() => validateMediaPlan({ ...valid, resolution: '8k' }), /分辨率不支持/)
})

test('accepts the fixed GPT Image 2 official handoff with a user-selected ratio', () => {
  const plan = {
    kind: 'image' as const,
    title: '商品图复刻',
    prompt: '保留用户产品图中的包装和文字，生成电商主图。',
    modelId: 'runninghub/api/rh-gpt2-official',
    ratio: '3:4',
    referenceImages: ['data:image/png;base64,product'],
  }

  assert.doesNotThrow(() => validateMediaPlan(plan))
})

test('accepts a registered video plan and rejects unsupported task kinds', () => {
  const video = parseMediaPlan([
    '```jc-media-plan',
    JSON.stringify({
      kind: 'video',
      title: '海边短片',
      prompt: '清晨海边的缓慢推进镜头',
      modelId: 'runninghub/api/rh-grok-text-video',
      duration: 8,
    }),
    '```',
  ].join('\n'))
  assert.doesNotThrow(() => validateMediaPlan(video))
  assert.throws(() => validateMediaPlan({ ...video, kind: 'image' }), /类型与模型不匹配/)
  assert.throws(() => parseMediaPlan('```jc-media-plan\n{"kind":"audio"}\n```'), /只支持/)
})

test('media plan editor uses compatible registry models and normalizes changed model parameters', () => {
  const plan = {
    kind: 'video' as const,
    title: '月球短片',
    prompt: '让旗帜随风摆动',
    modelId: 'newapi/zx/grok-1.5-video-6s',
    ratio: '16:9',
    duration: 6,
    referenceImages: ['data:image/png;base64,aGVsbG8='],
  }

  const controls = getMediaPlanEditorControls(plan)
  assert.equal(controls.models.some(model => model.value === 'newapi/zx/grok-1.5-video-6s'), true)
  assert.equal(controls.models.some(model => model.value === 'newapi/t8/gpt-image-2'), false)

  const unresolvedControls = getMediaPlanEditorControls({
    ...plan,
    referenceImages: undefined,
    mediaReferences: [{
      id: 'ref_recent',
      kind: 'image',
      source: 'task',
      label: '最近生成图',
      value: plan.referenceImages[0],
      explicit: false,
      locator: { type: 'task', taskId: 'task_image_1' },
    }],
  })
  assert.equal(
    unresolvedControls.models.some(model => model.value === 'runninghub/api/rh-grok-text-video'),
    false,
  )

  const updated = updateMediaPlanParameters(plan, {
    modelId: 'newapi/zx/grok-1.5-video-10s',
  })
  assert.equal(updated.modelId, 'newapi/zx/grok-1.5-video-10s')
  assert.equal(updated.ratio, '16:9')
  assert.equal(updated.duration, 10)
  assert.deepEqual(updated.referenceImages, plan.referenceImages)
  assert.doesNotThrow(() => validateMediaPlan(updated))
})
