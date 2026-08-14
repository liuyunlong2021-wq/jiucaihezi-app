import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildCreationRunPlan,
  validateCreationModelSpec,
} from '../creationMediaPlan'
import {
  CREATION_MODEL_REGISTRY,
  creationModelFamily,
  displayModelPrice,
  getCreationModelSpec,
  listCreationPanelModels,
  listCreationModels,
} from '../creationModelRegistry'
import type { CreationModelSpec } from '../creationMediaTypes'

test('listCreationModels excludes jina-search and filters by source', () => {
  const all = listCreationModels({ source: 'all' })
  const direct = listCreationModels({ source: 'newapi-direct' })
  const runninghub = listCreationModels({ source: 'runninghub' })

  assert.equal(all.some(model => model.id.includes('jina') || model.model === 'jina-search'), false)
  assert.ok(direct.length > 0)
  assert.ok(runninghub.length > 0)
  assert.equal(direct.every(model => model.source === 'newapi-direct'), true)
  assert.equal(runninghub.every(model => model.source === 'runninghub'), true)
})

test('registry keeps current direct, RunningHub and generic AI App entries', () => {
  const ids = new Set(CREATION_MODEL_REGISTRY.map(model => model.id))
  const requiredIds = [
    'gpt-image-2-1k',
    'gpt-image-2-低质量',
    'gpt-image-2-中质量',
    'gpt-image-2-vip',
    'gpt-image-2-官方',
    'newapi/trump/seedance-2.0',
    'newapi/kik/doubao-seedance-2',
    'newapi/kik/doubao-seedance-2-0-fast-260128',
    'newapi/kik/doubao-seedance-2-mini',
    'runninghub/api/rh-gpt2-image',
    'runninghub/api/rh-gpt2-text',
    'runninghub/api/z-image-turbo',
    'runninghub/api/rh-image-v2',
    'runninghub/api/rh-pro-image',
    'runninghub/api/rh-video-v31-fast',
    'runninghub/api/rh-grok-text-video',
    'runninghub/api/rh-grok-image-video',
    'newapi/zx/grok-1.5-video-6s',
    'newapi/zx/grok-1.5-video-10s',
    'newapi/zx/grok-1.5-video-15s',
    'runninghub/api/rh-seedance2-mini',
    'runninghub/api/rh-seedance2-fast',
    'runninghub/api/rh-seedance2',
    'runninghub/api/rh-suno-v55-single',
    'runninghub/api/rh-suno-v55-custom',
    'runninghub/api/rh-suno-lyrics',
    'runninghub/api/rh-3d-text',
    'runninghub/api/rh-3d-image',
    'runninghub/aiapp/rh-aiapp',
  ]

  for (const id of requiredIds) {
    assert.equal(ids.has(id), true, id)
  }
  for (const retiredId of [
    'newapi/volcengine/doubao-seedance-2-0-260128',
    'runninghub/aiapp/rh-aiapp-fast-digital-human',
    'runninghub/aiapp/rh-aiapp-digital-human',
    'runninghub/aiapp/rh-aiapp-director',
    'runninghub/aiapp/rh-aiapp-voice-clone',
    'runninghub/aiapp/rh-aiapp-voice-design',
    'runninghub/api/rh-grok-image-text',
    'runninghub/api/rh-grok-image-image',
  ]) {
    assert.equal(ids.has(retiredId), false, retiredId)
  }
})

test('removed defaults stay absent and model metadata drives family and fee labels', () => {
  assert.equal(getCreationModelSpec('runninghub/api/rh-gpt2-official'), undefined)
  assert.equal(creationModelFamily(getCreationModelSpec('gpt-image-2-中质量')!), 'GPT Image')
  assert.equal(creationModelFamily(getCreationModelSpec('runninghub/api/rh-gpt2-image')!), 'GPT Image')
  assert.equal(creationModelFamily(getCreationModelSpec('runninghub/api/rh-gpt2-text')!), 'GPT Image')
  assert.equal(creationModelFamily(getCreationModelSpec('gemini-3-pro-image-preview')!), 'Banana')
  assert.equal(creationModelFamily(getCreationModelSpec('runninghub/api/rh-seedance2-mini-image')!), 'Seedance 2.0 Mini')
  assert.equal(creationModelFamily(getCreationModelSpec('runninghub/api/rh-seedance2-fast-text')!), 'Seedance 2.0 Fast')
  assert.equal(creationModelFamily(getCreationModelSpec('runninghub/api/rh-seedance2-image')!), 'Seedance 2.0')
  assert.equal(displayModelPrice(getCreationModelSpec('gemini-3-pro-image-preview')!), '0.2/张')
  assert.equal(displayModelPrice(getCreationModelSpec('runninghub/api/rh-3d-image')!), '6.6/次')
})

test('every registry model has a valid route contract and can produce a run plan summary', () => {
  for (const spec of CREATION_MODEL_REGISTRY) {
    // 跳过 broken 模型 — validateCreationModelSpec 会对其抛出异常
    if (spec.contractStatus === 'broken') continue

    validateCreationModelSpec(spec)
    assert.ok(spec.source)
    assert.ok(spec.route)
    assert.ok(spec.upstreamFamily)
    assert.ok(spec.apiStyle)
    assert.ok(spec.contractStatus)
    assert.ok(spec.capabilities.officialAbilityTypes.length > 0, spec.id)
    assert.ok(spec.capabilities.adapterAbilityTypes.length > 0, spec.id)
    if (spec.id === 'runninghub/aiapp/rh-aiapp') {
      assert.equal(spec.contractStatus, 'partial')
      assert.deepEqual(spec.fields, [])
      continue
    }
    assert.ok(spec.fields.length > 0, spec.id)

    const plan = buildCreationRunPlan({
      modelId: spec.id,
      params: sampleParamsFor(spec),
    })
    assert.equal(plan.usesRhAdapter, spec.route === 'runninghub-adapter', spec.id)
    assert.ok(plan.submitSummary.length > 0, spec.id)
  }
})

test('model lookup prefers exact ids and resolves aliases', () => {
  assert.equal(getCreationModelSpec('gpt-image-2-中质量')?.model, 'gpt-image-2-中质量')
  assert.equal(getCreationModelSpec('gpt-image-2')?.id, 'gpt-image-2-低质量')
  assert.equal(getCreationModelSpec('runninghub/aiapp/rh-aiapp')?.model, 'rh-aiapp')
  assert.equal(getCreationModelSpec('runninghub/aiapp/rh-aiapp-fast-digital-human'), undefined)
  assert.equal(getCreationModelSpec('rh-digital-human-fast'), undefined)
  assert.equal(getCreationModelSpec('nonexistent-model-id'), undefined)
})

test('KIK Seedance models expose provider resolutions and multimodal references', () => {
  const full = getCreationModelSpec('newapi/kik/doubao-seedance-2')!
  const fast = getCreationModelSpec('newapi/kik/doubao-seedance-2-0-fast-260128')!
  const mini = getCreationModelSpec('newapi/kik/doubao-seedance-2-mini')!
  assert.deepEqual(full.capabilities.resolutions, ['480p', '720p', '1080p', '4k'])
  assert.deepEqual(fast.capabilities.resolutions, ['480p', '720p'])
  assert.deepEqual(mini.capabilities.resolutions, ['480p', '720p'])
  assert.deepEqual(full.capabilities.inputModalities, ['text', 'image', 'video', 'audio'])
  assert.equal(displayModelPrice(mini), '按 Token')
})

test('GPT Image 2 routes send exact model names and expose only their supported resolutions', () => {
  const spec = getCreationModelSpec('gpt-image-2-中质量')
  const plan = buildCreationRunPlan({
    modelId: 'gpt-image-2-中质量',
    params: {
      prompt: '商品图',
      ratio: '1:1',
      images: ['data:image/png;base64,test'],
    },
  })

  assert.equal(spec?.model, 'gpt-image-2-中质量')
  assert.equal(plan.model, 'gpt-image-2-中质量')
  assert.equal(plan.source, 'newapi-direct')
  assert.equal(plan.route, 'newapi-direct')
  assert.equal(plan.usesRhAdapter, false)
  assert.equal(plan.endpoint, '/v1/videos')
  assert.equal(plan.apiStyle, 'xiaoyi-image-task')
  assert.equal(plan.pollKind, 'newapi-task')
  for (const [modelId, resolutions, price] of [
    ['gpt-image-2-1k', ['1k'], '0.08/张'],
    ['gpt-image-2-低质量', ['1k', '2k', '4k'], '0.1/张'],
    ['gpt-image-2-中质量', ['1k', '2k', '4k'], '0.15/张'],
    ['gpt-image-2-vip', ['1k', '2k', '4k'], '0.2/张'],
    ['gpt-image-2-官方', ['1k', '2k', '4k'], '0.25/张'],
  ]) {
    const route = getCreationModelSpec(modelId)!
    assert.equal(route.model, modelId)
    assert.deepEqual(route.capabilities.resolutions, resolutions)
    assert.equal(displayModelPrice(route), price)
  }
})

test('Gemini image models use the Xiaoyi async task contract', () => {
  for (const [modelId, model, price] of [
    ['gemini-3.1-flash-image-preview', 'gemini-3.1-flash-image-preview', 0.1],
    ['gemini-3-pro-image-preview', 'gemini-3-pro-image-preview', 0.2],
  ] as const) {
    const spec = getCreationModelSpec(modelId)
    const textOnly = buildCreationRunPlan({ modelId, params: { prompt: '一张产品图' } })
    const withImage = buildCreationRunPlan({ modelId, params: { prompt: '修改产品图', images: ['https://example.com/ref.png'] } })

    assert.equal(spec?.price, price)
    assert.equal(textOnly.model, model)
    assert.equal(textOnly.endpoint, '/v1/videos')
    assert.equal(textOnly.apiStyle, 'xiaoyi-image-task')
    assert.equal(textOnly.pollKind, 'newapi-task')
    assert.equal(textOnly.debug.normalizedParams.size, 'auto')
    assert.deepEqual(spec?.capabilities.resolutions, ['1k', '2k'])
    assert.deepEqual(spec?.capabilities.ratios, [])
    assert.equal(spec?.fields.some(field => field.key === 'ratio'), false)
    assert.equal(withImage.endpoint, '/v1/videos')
    assert.equal(withImage.apiStyle, 'xiaoyi-image-task')
    assert.equal(withImage.assetFlow, 'newapi-upload')
  }

  assert.throws(
    () => buildCreationRunPlan({ modelId: 'gemini-3-pro-image-preview', params: { prompt: '错误分辨率', resolution: '4k' } }),
    /分辨率.*不支持/,
  )
})

test('legacy GPT Image 2 plans keep their 2K contract through the low-quality route', () => {
  const plan = buildCreationRunPlan({
    modelId: 'gpt-image-2',
    params: { prompt: '历史任务', resolution: '2k' },
  })

  assert.equal(plan.modelId, 'gpt-image-2-低质量')
  assert.equal(plan.model, 'gpt-image-2-低质量')
  assert.equal(plan.debug.normalizedParams.resolution, '2k')
})

test('Veo 3.1 preview models use the verified OpenAI video contract', () => {
  for (const [modelId, model, price] of [
    ['newapi/zx/veo-3.1-generate-preview', 'veo-3.1-generate-preview', 0.2],
    ['newapi/zx/veo-3.1-fast-generate-preview', 'veo-3.1-fast-generate-preview', 0.1],
  ] as const) {
    const spec = getCreationModelSpec(modelId)
    const textOnly = buildCreationRunPlan({ modelId, params: { prompt: '一段产品视频', duration: 4, resolution: '720p', ratio: '16:9' } })
    const withImage = buildCreationRunPlan({ modelId, params: { prompt: '让产品动起来', duration: 4, resolution: '720p', ratio: '16:9', images: ['https://example.com/ref.jpg'] } })

    assert.equal(spec?.price, price)
    assert.equal(textOnly.model, model)
    assert.equal(textOnly.apiStyle, 'openai-videos')
    assert.equal(textOnly.endpoint, '/v1/videos')
    assert.equal(textOnly.pollKind, 'newapi-task')
    assert.equal(textOnly.mode, 'text-to-video')
    assert.equal(withImage.mode, 'image-to-video')
    assert.equal(withImage.debug.referenceImageCount, 1)
  }
})

test('ZX Grok fixed-duration aliases support text and single-image video', () => {
  for (const seconds of [6, 10, 15] as const) {
    const modelId = `newapi/zx/grok-1.5-video-${seconds}s`
    const textOnly = buildCreationRunPlan({ modelId, params: { prompt: '一个大西瓜超人救火', duration: seconds } })
    const withImage = buildCreationRunPlan({
      modelId,
      params: { prompt: '一个大西瓜超人救火', duration: seconds, images: ['https://example.com/ref.jpg'] },
    })

    assert.equal(textOnly.model, `grok-1.5-video-${seconds}s`)
    assert.equal(textOnly.endpoint, '/v1/videos')
    assert.equal(textOnly.pollKind, 'newapi-task')
    assert.equal(textOnly.usesRhAdapter, false)
    assert.equal(textOnly.mode, 'text-to-video')
    assert.equal(withImage.mode, 'image-to-video')
    assert.equal(withImage.debug.referenceImageCount, 1)
  }
})

test('direct GPT Image 2 plan uses the Xiaoyi async task fields', () => {
  const plan = buildCreationRunPlan({
    modelId: 'gpt-image-2-中质量',
    params: {
      prompt: '一张电影感海报',
      ratio: '16:9',
      resolution: '2k',
      images: ['local-ref.png'],
    },
  })

  assert.equal(plan.source, 'newapi-direct')
  assert.equal(plan.route, 'newapi-direct')
  assert.equal(plan.upstreamFamily, 'openai-compatible')
  assert.equal(plan.usesRhAdapter, false)
  assert.equal(plan.debug.normalizedParams.size, '2048x1152')
  assert.equal('aspectRatio' in plan.debug.normalizedParams, false)
  assert.equal(plan.debug.normalizedParams.resolution, '2k')
  assert.match(plan.submitSummary, /直连/)
  assert.match(plan.submitSummary, /OpenAI-compatible/)
  assert.match(plan.submitSummary, /size=2048x1152/)
})

test('direct GPT Image 2 shows the configured group price', () => {
  assert.equal(getCreationModelSpec('gpt-image-2-中质量')?.price, 0.15)
})

test('direct GPT Image 2 uses one Xiaoyi async contract with and without a reference image', () => {
  const textOnly = buildCreationRunPlan({
    modelId: 'gpt-image-2-中质量',
    params: {
      prompt: '一张电影感海报',
      ratio: '16:9',
      resolution: '2k',
    },
  })
  const withImage = buildCreationRunPlan({
    modelId: 'gpt-image-2-中质量',
    params: {
      prompt: '改成电影感海报',
      ratio: '16:9',
      resolution: '2k',
      imageUrl: 'https://example.com/ref.png',
    },
  })

  assert.equal(textOnly.endpoint, '/v1/videos')
  assert.equal(textOnly.apiStyle, 'xiaoyi-image-task')
  assert.equal(textOnly.mode, 'text-to-image')
  assert.equal(textOnly.assetFlow, 'none')
  assert.equal(withImage.endpoint, '/v1/videos')
  assert.equal(withImage.apiStyle, 'xiaoyi-image-task')
  assert.equal(withImage.mode, 'image-to-image')
  assert.equal(withImage.assetFlow, 'newapi-upload')
  assert.equal(withImage.debug.referenceImageCount, 1)
})

test('RunningHub GPT2 image plan uses aspectRatio and resolution through RH adapter', () => {
  const plan = buildCreationRunPlan({
    modelId: 'runninghub/api/rh-gpt2-image',
    params: {
      prompt: '保留人物姿势，改成赛博城市',
      ratio: '16:9',
      resolution: '2k',
      images: ['local-ref.png'],
    },
  })

  assert.equal(plan.source, 'runninghub')
  assert.equal(plan.route, 'runninghub-adapter')
  assert.equal(plan.upstreamFamily, 'runninghub')
  assert.equal(plan.usesRhAdapter, true)
  assert.equal(plan.debug.normalizedParams.aspectRatio, '16:9')
  assert.equal(plan.debug.normalizedParams.resolution, '2k')
  assert.equal('size' in plan.debug.normalizedParams, false)
  assert.match(plan.submitSummary, /RunningHub/)
  assert.match(plan.submitSummary, /aspectRatio=16:9/)
  assert.match(plan.submitSummary, /resolution=2k/)
})

test('RunningHub Z Image Turbo plan uses RH adapter and preserves LoRA parameters', () => {
  const plan = buildCreationRunPlan({
    modelId: 'runninghub/api/z-image-turbo',
    params: {
      prompt: '一张品牌海报',
      ratio: '9:16',
      lora: 'Z-Image _ 清纯高颜值_脸模版V1.0.safetensors',
      lora_strength: 1,
      outputFormat: 'png',
    },
  })

  assert.equal(plan.source, 'runninghub')
  assert.equal(plan.route, 'runninghub-adapter')
  assert.equal(plan.upstreamFamily, 'runninghub')
  assert.equal(plan.model, 'z-image-turbo')
  assert.equal(plan.usesRhAdapter, true)
  assert.equal(plan.debug.normalizedParams.aspectRatio, '9:16')
  assert.equal(plan.debug.normalizedParams.lora, 'Z-Image _ 清纯高颜值_脸模版V1.0.safetensors')
  assert.equal(plan.debug.normalizedParams.lora_strength, 1)
  assert.equal(plan.debug.normalizedParams.outputFormat, 'png')
  assert.equal('size' in plan.debug.normalizedParams, false)
})

test('RunningHub audio and generic AI App plans do not receive image ratio defaults', () => {
  const audio = buildCreationRunPlan({
    modelId: 'runninghub/api/rh-suno-v55-single',
    params: {
      prompt: '温暖的流行歌曲',
      title: '春天',
    },
  })
  const aiApp = buildCreationRunPlan({
    modelId: 'runninghub/aiapp/rh-aiapp',
    params: {
      webappId: '12345',
      billingModel: 'rh-aiapp-fast-digital-human',
      outputType: 'video',
      '3:audio': 'https://example.com/voice.mp3',
      '4:image': 'https://example.com/person.png',
    },
  })

  assert.equal('aspectRatio' in audio.debug.normalizedParams, false)
  assert.equal('resolution' in audio.debug.normalizedParams, false)
  assert.doesNotMatch(audio.submitSummary, /aspectRatio|resolution/)
  assert.equal('aspectRatio' in aiApp.debug.normalizedParams, false)
  assert.equal('resolution' in aiApp.debug.normalizedParams, false)
  assert.equal(aiApp.debug.normalizedParams['3:audio'], 'https://example.com/voice.mp3')
  assert.equal(aiApp.debug.normalizedParams['4:image'], 'https://example.com/person.png')
})

test('Hunyuan 3D plans preserve the verified v3.1 parameters', () => {
  const text = buildCreationRunPlan({
    modelId: 'runninghub/api/rh-3d-text',
    params: { prompt: '一把旧铜钥匙' },
  })
  const image = buildCreationRunPlan({
    modelId: 'runninghub/api/rh-3d-image',
    params: {
      images: ['front.png', 'left.png'],
      faceCount: 800000,
      enablePbr: true,
      generateType: 'Geometry',
    },
  })

  assert.equal(text.task, 'model3d')
  assert.equal(text.mode, 'text-to-3d')
  assert.equal(text.price, 4.8)
  assert.equal(text.endpoint, '/v1/videos')
  assert.equal(text.debug.normalizedParams.faceCount, 500000)
  assert.equal(text.debug.normalizedParams.enablePbr, false)
  assert.equal(text.debug.normalizedParams.generateType, 'Normal')
  assert.equal(image.mode, 'image-to-3d')
  assert.equal(image.price, 6.6)
  assert.deepEqual(image.debug.normalizedParams.images, ['front.png', 'left.png'])
  assert.equal(image.debug.normalizedParams.faceCount, 800000)
  assert.equal(image.debug.normalizedParams.enablePbr, true)
  assert.equal(image.debug.normalizedParams.generateType, 'Geometry')
})

test('generic RunningHub AI App plans preserve dynamic workflow params', () => {
  const aiApp = buildCreationRunPlan({
    modelId: 'runninghub/aiapp/rh-aiapp',
    params: {
      webappId: '12345',
      billingModel: 'rh-aiapp-fast-digital-human',
      outputType: 'video',
      '3:audio': 'https://example.com/voice.wav',
      '4:image': 'https://example.com/actor.png',
      '10:value': 832,
    },
  })

  assert.equal(aiApp.debug.normalizedParams.webappId, '12345')
  assert.equal(aiApp.debug.normalizedParams.billingModel, 'rh-aiapp-fast-digital-human')
  assert.equal(aiApp.task, 'video')
  assert.equal(aiApp.debug.normalizedParams['3:audio'], 'https://example.com/voice.wav')
  assert.equal(aiApp.debug.normalizedParams['4:image'], 'https://example.com/actor.png')
  assert.equal(aiApp.debug.normalizedParams['10:value'], 832)
})

test('generic AI App plans route by the server-declared output type', () => {
  for (const outputType of ['image', 'audio', 'video'] as const) {
    const plan = buildCreationRunPlan({
      modelId: 'runninghub/aiapp/rh-aiapp',
      params: {
        webappId: '12345',
        billingModel: `rh-custom-${outputType}`,
        outputType,
        '1:text': 'hello',
      },
    })
    assert.equal(plan.task, outputType)
    assert.equal(plan.endpoint, outputType === 'image'
      ? '/v1/images/generations'
      : outputType === 'audio' ? '/v1/audio/speech' : '/v1/videos')
  }
  assert.throws(
    () => buildCreationRunPlan({
      modelId: 'runninghub/aiapp/rh-aiapp',
      params: { webappId: '12345', billingModel: 'rh-custom', '1:text': 'hello' },
    }),
    /输出类型/,
  )
})

test('generic AI App plan dedupes singular and plural media references', () => {
  const plan = buildCreationRunPlan({
    modelId: 'runninghub/aiapp/rh-aiapp',
    params: {
      images: ['https://example.com/actor.png'],
      image: ['https://example.com/actor.png'],
      audios: ['https://example.com/voice.mp3'],
      audio: 'https://example.com/voice.mp3',
      outputType: 'video',
      value: 832,
    },
  })

  assert.equal(plan.debug.referenceImageCount, 1)
  assert.equal(plan.debug.referenceAudioCount, 1)
})

test('generic AI App registry leaves workflow fields to runtime discovery', () => {
  const aiApp = getCreationModelSpec('runninghub/aiapp/rh-aiapp')

  assert.equal(aiApp?.task, 'ai-app')
  assert.equal(aiApp?.mode, 'workflow')
  assert.equal(aiApp?.apiStyle, 'rh-aiapp')
  assert.equal(aiApp?.contractStatus, 'partial')
  assert.deepEqual(aiApp?.fields, [])
})

test('RunPlan blocks invalid required fields, file counts, select options and number ranges', () => {
  assert.throws(
    () => buildCreationRunPlan({ modelId: 'gpt-image-2-中质量', params: { ratio: '16:9' } }),
    /缺少必填字段.*提示词/,
  )
  assert.throws(
    () => buildCreationRunPlan({ modelId: 'gpt-image-2-1k', params: { prompt: '错误分辨率', resolution: '2k' } }),
    /分辨率.*不支持/,
  )
  assert.throws(
    () => buildCreationRunPlan({
      modelId: 'runninghub/api/rh-gpt2-image',
      params: { prompt: '缺少参考图', ratio: '16:9', resolution: '2k' },
    }),
    /参考图.*至少需要 1/,
  )
  assert.throws(
    () => buildCreationRunPlan({
      modelId: 'runninghub/api/rh-gpt2-image',
      params: { prompt: '错误分辨率', images: ['a.png'], resolution: '8k' },
    }),
    /分辨率.*不支持/,
  )
  assert.throws(
    () => buildCreationRunPlan({
      modelId: 'runninghub/api/rh-video-v31-fast',
      params: { prompt: '运镜视频', duration: 6 },
    }),
    /时长.*不支持/,
  )
})

test('WorldRouter Trump Seedance uses native async task endpoint (broken — check spec directly)', () => {
  // 该模型当前标记为 broken，不能通过 buildCreationRunPlan 构建 plan
  // 直接检查 spec 的 endpoint 和 apiStyle
  const spec = getCreationModelSpec('newapi/trump/seedance-2.0')
  assert.ok(spec, 'spec should exist')
  assert.equal(spec.contractStatus, 'broken')
  assert.equal(spec.endpoint, '/api/v3/contents/generations/tasks')
  assert.equal(spec.apiStyle, 'seedance-task')
})

test('validateCreationModelSpec rejects apiStyle contracts that do not match their route family', () => {
  const runninghubSpec = {
    ...getCreationModelSpec('runninghub/api/rh-gpt2-image')!,
    apiStyle: 'newapi-task' as const,
  } satisfies CreationModelSpec
  const directSpec = {
    ...getCreationModelSpec('gpt-image-2-中质量')!,
    apiStyle: 'rh-standard' as const,
  } satisfies CreationModelSpec

  assert.throws(() => validateCreationModelSpec(runninghubSpec), /runninghub-adapter route requires RH apiStyle/)
  assert.throws(() => validateCreationModelSpec(directSpec), /newapi-direct route does not allow RH apiStyle/)
})

test('invalid route and source combinations are rejected before runtime dispatch', () => {
  const badSpec: CreationModelSpec = {
    ...getCreationModelSpec('gpt-image-2-中质量')!,
    id: 'bad/direct-through-rh',
    route: 'runninghub-adapter',
  }

  assert.throws(() => validateCreationModelSpec(badSpec), /runninghub-adapter.*source.*runninghub/)
})

test('partial contracts produce plan warnings instead of silent submits', () => {
  const partial = buildCreationRunPlan({
    modelId: 'runninghub/aiapp/rh-aiapp',
    params: {
      webappId: '12345',
      billingModel: 'rh-aiapp-fast-digital-human',
      outputType: 'video',
      '3:audio': 'voice.mp3',
    },
  })
  assert.equal(partial.contractStatus, 'partial')
  assert.ok((partial.warnings || []).length > 0)
  assert.match((partial.warnings || []).join('\n'), /nodeInfoList|部分核对/)

  const verified = buildCreationRunPlan({
    modelId: 'gpt-image-2-中质量',
    params: {
      prompt: '一张产品图',
      ratio: '1:1',
      resolution: '2k',
    },
  })
  assert.equal(verified.warnings, undefined)
})

test('P2 panel model view is sourced from CreationModelSpec and RunPlan summary', () => {
  const items = listCreationPanelModels({ task: 'image', source: 'all' })
  const gpt = items.find(item => item.id === 'gpt-image-2-中质量')
  const rh = items.find(item => item.id === 'runninghub/api/rh-gpt2-image')
  const zImage = items.find(item => item.id === 'runninghub/api/z-image-turbo')

  assert.ok(gpt)
  assert.ok(rh)
  assert.ok(zImage)
  assert.equal(gpt.source, 'newapi-direct')
  assert.equal(rh.source, 'runninghub')
  assert.equal(zImage.source, 'runninghub')
  assert.ok(gpt.fields.some(field => field.key === 'prompt'))
  assert.ok(rh.fields.some(field => field.key === 'aspectRatio'))
  assert.ok(zImage.fields.some(field => field.key === 'outputFormat'))
  assert.match(gpt.submitSummaryPreview, /直连/)
  assert.match(rh.submitSummaryPreview, /RunningHub/)
  assert.match(zImage.submitSummaryPreview, /RunningHub/)
})

test('panel model labels distinguish GPT Image 2 routing tiers', () => {
  const items = listCreationPanelModels({ task: 'image', source: 'all' })
  const gpt = items.find(item => item.id === 'gpt-image-2-中质量')
  const rh = items.find(item => item.id === 'runninghub/api/rh-gpt2-image')
  const zImage = items.find(item => item.id === 'runninghub/api/z-image-turbo')

  assert.equal(gpt?.label, 'GPT Image 2 中质量')
  assert.equal(rh?.label, 'GPT2.0 图生图')
  assert.equal(zImage?.label, 'Z Image Turbo')
  for (const item of items) {
    assert.doesNotMatch(item.label, /·\s*(T8|RunningHub|NewAPI|直连|RH)/, item.id)
  }
})

test('Seed Audio creation model uses the Chinese label, minute price, and three audio references', () => {
  const spec = getCreationModelSpec('seed-audio-1.0')!
  assert.equal(spec.label, '豆包音频生成1.0')
  assert.equal(spec.price, '1.2元/分钟')
  assert.deepEqual(spec.files?.audios, { min: 0, max: 3 })
  assert.deepEqual(spec.capabilities.inputModalities, ['text', 'audio'])
})

function sampleParamsFor(spec: CreationModelSpec): Record<string, unknown> {
  const params: Record<string, unknown> = {
    prompt: '测试提示词',
    ratio: spec.capabilities.ratios?.includes('16:9') ? '16:9' : undefined,
    resolution: spec.capabilities.resolutions?.[0],
    duration: spec.capabilities.duration?.allowedValues?.[0] || spec.capabilities.duration?.min,
    title: '测试标题',
    tags: 'pop',
    value: 832,
  }
  if (spec.files?.images?.min) params.images = Array.from({ length: spec.files.images.min }, (_, index) => `image-${index}.png`)
  if (spec.files?.videos?.min) params.videos = Array.from({ length: spec.files.videos.min }, (_, index) => `video-${index}.mp4`)
  if (spec.files?.audios?.min) params.audios = Array.from({ length: spec.files.audios.min }, (_, index) => `audio-${index}.mp3`)
  for (const field of spec.fields) {
    if (field.required && params[field.key] === undefined) {
      if (field.kind === 'image' && !params.images) params[field.key] = 'image.png'
      else if (field.kind === 'audio' && !params.audios) params[field.key] = 'audio.mp3'
      else if (field.kind === 'video' && !params.videos) params[field.key] = 'video.mp4'
      else if (field.kind === 'number') params[field.key] = field.defaultValue ?? field.min ?? 1
      else if (!['image', 'audio', 'video'].includes(field.kind)) params[field.key] = field.defaultValue ?? '测试值'
    }
  }
  return params
}
