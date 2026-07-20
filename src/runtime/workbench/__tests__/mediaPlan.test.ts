import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseMediaPlan, validateMediaPlan } from '../mediaPlan'

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
      referenceImages: ['jc-media/images/serum.png'],
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
    referenceImages: ['jc-media/images/serum.png'],
  })
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
