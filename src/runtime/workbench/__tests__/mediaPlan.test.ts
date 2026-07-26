import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MEDIA_PLAN_POLICY,
  buildMediaPlanPolicy,
  getMediaPlanEditorControls,
  parseMediaPlan,
  parseMediaPlans,
  replaceMediaPlanModelId,
  stripMediaPlanBlocks,
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
    modelId: 'runninghub/api/rh-gpt2-official',
    usesProductDefaultModel: true,
    ratio: '1:1',
    resolution: '2k',
    referenceIds: ['ref_product'],
  })
})

test('media plan parser accepts multiple independent plans in one fenced array', () => {
  const content = [
    '已按三张参考图分别规划：',
    '```jc-media-plan',
    JSON.stringify([
      {
        kind: 'video', title: '镜头一', prompt: '第一个镜头',
        modelId: 'runninghub/api/rh-grok-image-video',
        referenceIds: ['ref_input_1'], ratio: '16:9', duration: 6,
      },
      {
        kind: 'video', title: '镜头二', prompt: '第二个镜头',
        modelId: 'runninghub/api/rh-grok-image-video',
        referenceIds: ['ref_input_2'], ratio: '16:9', duration: 6,
      },
      {
        kind: 'video', title: '镜头三', prompt: '第三个镜头',
        modelId: 'runninghub/api/rh-grok-image-video',
        referenceIds: ['ref_input_3'], ratio: '16:9', duration: 6,
      },
    ]),
    '```',
  ].join('\n')

  const plans = parseMediaPlans(content)
  assert.equal(plans.length, 3)
  assert.deepEqual(plans.map(plan => plan.title), ['镜头一', '镜头二', '镜头三'])
  assert.deepEqual(plans.map(plan => plan.referenceIds), [['ref_input_1'], ['ref_input_2'], ['ref_input_3']])
  assert.equal(stripMediaPlanBlocks(content), '已按三张参考图分别规划：')
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
            modelId: 'test-video-model',
            referenceImages: ['file:///Users/example/private.png'],
          }),
          '```',
        ].join('\n'),
      ),
    /referenceImages.*不能由模型提供/,
  )
})

test('model-free plans use the product defaults for images and text-to-video', () => {
  const image = parseMediaPlan('```jc-media-plan\n' + JSON.stringify({
    kind: 'image', title: '品牌主图', prompt: '极简科技产品摄影',
  }) + '\n```')
  const video = parseMediaPlan('```jc-media-plan\n' + JSON.stringify({
    kind: 'video', title: '品牌短片', prompt: '镜头缓慢推进',
  }) + '\n```')

  assert.equal(image.modelId, 'runninghub/api/rh-gpt2-official')
  assert.equal(video.modelId, 'runninghub/api/rh-seedance2-text')
})

test('a model-selected Fast video is normalized to the standard Seedance default before user adjustment', () => {
  const plan = parseMediaPlan('```jc-media-plan\n' + JSON.stringify({
    kind: 'video', title: '品牌短片', prompt: '镜头缓慢推进',
    modelId: 'runninghub/api/rh-seedance2-fast-text',
  }) + '\n```')

  assert.equal(plan.modelId, 'runninghub/api/rh-seedance2-text')
  assert.equal(plan.usesProductDefaultModel, true)
})

test('media plan display is rewritten to the application-selected model', () => {
  const content = '```jc-media-plan\n' + JSON.stringify({
    kind: 'video', title: '品牌短片', prompt: '镜头缓慢推进',
    modelId: 'runninghub/api/rh-seedance2-fast-text',
  }) + '\n```'

  assert.match(
    replaceMediaPlanModelId(content, 'runninghub/api/rh-seedance2-text'),
    /"modelId": "runninghub\/api\/rh-seedance2-text"/,
  )
})

test('choosing a model in the confirmation card stops default-model refinement', () => {
  const plan = parseMediaPlan('```jc-media-plan\n' + JSON.stringify({
    kind: 'video', title: '品牌短片', prompt: '镜头缓慢推进',
  }) + '\n```')

  const updated = updateMediaPlanParameters(plan, {
    modelId: 'runninghub/api/rh-ltx23-text-video',
  })

  assert.equal(updated.modelId, 'runninghub/api/rh-ltx23-text-video')
  assert.equal(updated.usesProductDefaultModel, undefined)
})

test('native media planning does not require a bundled Skill', () => {
  assert.doesNotMatch(MEDIA_PLAN_POLICY, /jc-instant-create/)
  assert.match(MEDIA_PLAN_POLICY, /prompt 必须原样使用，不得擅自扩写、润色或替换/)
})

test('native media policy is generated from the executable Creation registry', () => {
  const policy = buildMediaPlanPolicy('本轮可用参考素材：ref_recent | image | 最近生成图')

  assert.match(policy, /应用当前可执行媒体模型/)
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

test('accepts registered video and audio plans', () => {
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

  const audio = parseMediaPlan('```jc-media-plan\n' + JSON.stringify({
    kind: 'audio',
    title: '主题曲',
    prompt: '一首轻快的中文流行歌',
    modelId: 'runninghub/api/rh-suno-v55-single',
  }) + '\n```')
  assert.equal(audio.kind, 'audio')
  assert.doesNotThrow(() => validateMediaPlan(audio))
})

test('3D media plans select text or image Hunyuan models from references', () => {
  const text = parseMediaPlan('```jc-media-plan\n' + JSON.stringify({
    kind: 'model3d', title: '钥匙模型', prompt: '一把旧铜钥匙',
  }) + '\n```')
  assert.equal(text.modelId, 'runninghub/api/rh-3d-text')
  assert.doesNotThrow(() => validateMediaPlan(text))

  const withImage = {
    ...text,
    referenceImages: ['data:image/png;base64,front'],
    modelId: 'runninghub/api/rh-3d-image',
  }
  assert.doesNotThrow(() => validateMediaPlan(withImage))
  assert.equal(getMediaPlanEditorControls(withImage).models.length, 1)
})

test('media plan editor uses compatible registry models and normalizes changed model parameters', () => {
  const plan = {
    kind: 'image' as const,
    title: '精华液主图',
    prompt: '白色台面上的精华液产品摄影',
    modelId: 'newapi/t8/gpt-image-2',
    ratio: '16:9',
    resolution: '2k',
  }

  const controls = getMediaPlanEditorControls(plan)
  assert.equal(controls.models.some(model => model.value === 'newapi/t8/gpt-image-2'), true)

  const updated = updateMediaPlanParameters(plan, {
    ratio: '100:1',
  })
  assert.equal(updated.modelId, 'newapi/t8/gpt-image-2')
  assert.equal(updated.ratio, '1:1')
  assert.equal(updated.resolution, '2k')
  assert.doesNotThrow(() => validateMediaPlan(updated))
})

test('media plan editor keeps the user in control of the final prompt and disambiguates duplicate models', () => {
  const plan = {
    kind: 'video' as const,
    title: '推进镜头',
    prompt: '专业扩写版本',
    modelId: 'newapi/zx/veo-3.1-fast-generate-preview',
    referenceImages: ['data:image/jpeg;base64,reference'],
  }

  const updated = updateMediaPlanParameters(plan, { prompt: '镜头推进' })
  const veoFast = getMediaPlanEditorControls(updated).models
    .filter(model => model.label.startsWith('Veo 3.1 Fast'))

  assert.equal(updated.prompt, '镜头推进')
  assert.deepEqual(veoFast.map(model => model.label), [
    'Veo 3.1 Fast · 直连',
    'Veo 3.1 Fast · RunningHub',
  ])
})
