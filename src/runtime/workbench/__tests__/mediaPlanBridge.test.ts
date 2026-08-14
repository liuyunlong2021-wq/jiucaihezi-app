import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildMediaPlanSubmission,
  preparePublicMediaPlan,
} from '../mediaPlanBridge'

test('media plan bridge materializes an image plan through the existing creation run plan', () => {
  const submission = buildMediaPlanSubmission({
    kind: 'image',
    title: '精华液主图',
    prompt: '白色台面上的精华液产品摄影',
    modelId: 'gpt-image-2',
    ratio: '1:1',
    resolution: '2k',
    referenceImages: ['data:image/png;base64,AA=='],
  })

  assert.equal(submission.type, 'image')
  assert.equal(submission.model, 'gpt-image-2-低质量')
  assert.equal(submission.plan.modelId, 'gpt-image-2-低质量')
  assert.equal(submission.plan.debug.referenceImageCount, 1)
  assert.equal(submission.source, 'creation')
})

test('media plan bridge never materializes an invalid plan', () => {
  assert.throws(() => buildMediaPlanSubmission({
    kind: 'image', title: '错误', prompt: 'test', modelId: 'not-real',
  }), /未注册/)
})

test('public media contract refreshes app-owned references before creating the existing submission', async () => {
  const result = await preparePublicMediaPlan({
    owner: 'project-one',
    plan: {
      kind: 'video',
      title: '人物转身',
      prompt: '让人物缓慢转身',
      modelId: 'runninghub/api/rh-seedance2-image',
      mediaOwner: 'project-one',
      mediaReferences: [{
        id: 'ref_project',
        kind: 'image',
        source: 'project',
        label: '人物.png',
        value: 'stale-value',
        explicit: true,
        locator: {
          type: 'project',
          runtime: 'web',
          owner: 'project-one',
          path: 'images/人物.png',
        },
      }],
    },
    resolvers: {
      readProject: async locator => `project://${locator.owner}/${locator.path}`,
      readTask: async () => '',
    },
  })

  assert.deepEqual(result.plan.referenceImages, ['project://project-one/images/人物.png'])
  assert.deepEqual(result.submission.referenceImages, result.plan.referenceImages)
  assert.equal(result.submission.plan.mode, 'image-to-video')
})

test('public media contract rejects a media plan from another project before submission', async () => {
  await assert.rejects(
    () => preparePublicMediaPlan({
      owner: 'project-two',
      plan: {
        kind: 'image',
        title: '跨项目计划',
        prompt: '生成图片',
        modelId: 'runninghub/api/rh-gpt2-image',
        mediaOwner: 'project-one',
      },
    }),
    /参考素材属于其他项目/,
  )
})

test('public media contract submits current-turn attachment references without a project reader', async () => {
  const image = 'data:image/png;base64,attachment'
  const result = await preparePublicMediaPlan({
    owner: 'project-a',
    plan: {
      kind: 'image',
      title: '参考图改造',
      prompt: '保持角色，改变视角',
      modelId: 'runninghub/api/rh-gpt2-image',
      mediaOwner: 'project-a',
      referenceImages: [image],
      mediaReferences: [{
        id: 'ref_attachment',
        kind: 'image',
        source: 'attachment',
        label: '角色图',
        value: image,
        explicit: true,
        locator: { type: 'attachment', messageId: 'turn-1', index: 0 },
      }],
    },
  })

  assert.deepEqual(result.submission.referenceImages, [image])
  assert.equal(result.submission.plan.mode, 'image-to-image')
})

test('media plan bridge sends the product image and selected ratio to RunningHub GPT Image 2', () => {
  const submission = buildMediaPlanSubmission({
    kind: 'image',
    title: '商品图复刻',
    prompt: '保留产品包装，复刻参考图的画面语言。',
    modelId: 'runninghub/api/rh-gpt2-image',
    ratio: '3:4',
    referenceImages: ['data:image/png;base64,product'],
  })

  assert.equal(submission.model, 'rh-gpt2-image')
  assert.equal(submission.plan.debug.referenceImageCount, 1)
  assert.equal(submission.plan.debug.normalizedParams.aspectRatio, '3:4')
  assert.equal(submission.plan.debug.normalizedParams.resolution, '1k')
})

test('media plan bridge reuses the creation contract for video', () => {
  const video = buildMediaPlanSubmission({
    kind: 'video',
    title: '海边短片',
    prompt: '清晨海边的缓慢推进镜头',
    modelId: 'runninghub/api/rh-grok-text-video',
    duration: 8,
  })
  assert.equal(video.type, 'video')
  assert.equal(video.videoParams?.duration, 8)
  assert.equal(video.source, 'creation')
})

test('media plan bridge reuses the creation contract for audio', () => {
  const audio = buildMediaPlanSubmission({
    kind: 'audio',
    title: '主题曲',
    prompt: '一首轻快的中文流行歌',
    modelId: 'runninghub/api/rh-suno-v55-single',
  })
  assert.equal(audio.type, 'audio')
  assert.equal(audio.audioParams?.prompt, '一首轻快的中文流行歌')
  assert.equal(audio.source, 'creation')
})

test('media plan bridge sends ordered references to Hunyuan image-to-3D', () => {
  const model3d = buildMediaPlanSubmission({
    kind: 'model3d',
    title: '角色模型',
    prompt: '根据多视图生成角色模型',
    modelId: 'runninghub/api/rh-3d-image',
    referenceImages: ['front', 'left'],
  })
  assert.equal(model3d.type, 'model3d')
  assert.deepEqual(model3d.referenceImages, ['front', 'left'])
  assert.deepEqual(model3d.videoParams?.imageUrls, ['front', 'left'])
  assert.equal(model3d.plan.task, 'model3d')
})
