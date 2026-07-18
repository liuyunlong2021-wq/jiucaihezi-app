import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildMediaPlanSubmission } from '../mediaPlanBridge'

test('media plan bridge materializes an image plan through the existing creation run plan', () => {
  const submission = buildMediaPlanSubmission({
    kind: 'image',
    title: '精华液主图',
    prompt: '白色台面上的精华液产品摄影',
    modelId: 'newapi/t8/gpt-image-2',
    ratio: '1:1',
    resolution: '2k',
    referenceImages: ['data:image/png;base64,AA=='],
  })

  assert.equal(submission.type, 'image')
  assert.equal(submission.model, 'gpt-image-2')
  assert.equal(submission.plan.modelId, 'newapi/t8/gpt-image-2')
  assert.equal(submission.plan.debug.referenceImageCount, 1)
  assert.equal(submission.source, 'creation')
})

test('media plan bridge never materializes an invalid plan', () => {
  assert.throws(() => buildMediaPlanSubmission({
    kind: 'image', title: '错误', prompt: 'test', modelId: 'not-real',
  }), /未注册/)
})

test('media plan bridge sends the product image and selected ratio to GPT Image 2 official', () => {
  const submission = buildMediaPlanSubmission({
    kind: 'image',
    title: '商品图复刻',
    prompt: '保留产品包装，复刻参考图的画面语言。',
    modelId: 'runninghub/api/rh-gpt2-official',
    ratio: '3:4',
    referenceImages: ['data:image/png;base64,product'],
  })

  assert.equal(submission.model, 'rh-gpt2-official')
  assert.equal(submission.plan.debug.referenceImageCount, 1)
  assert.equal(submission.plan.debug.normalizedParams.aspectRatio, '3:4')
  assert.equal(submission.plan.debug.normalizedParams.resolution, '1k')
})
