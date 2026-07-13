import assert from 'node:assert/strict'
import { test } from 'node:test'

import { __resetApiKeyMemoryCacheForTests } from '@/services/newApiClient'
import { buildCreationRunPlan } from '../creationMediaPlan'
import {
  buildCreationSubmitRequest,
  executeCreationSubmitRequest,
} from '../creationMediaRuntime'
import { getCreationModelSpec } from '../creationModelRegistry'

async function installGatewaySession() {
  __resetApiKeyMemoryCacheForTests('session-cloud')
  return async () => {
    __resetApiKeyMemoryCacheForTests('')
  }
}

async function withImmediateTimers<T>(fn: () => Promise<T>): Promise<T> {
  const previousSetTimeout = globalThis.setTimeout
  ;(globalThis as any).setTimeout = (handler: (...args: unknown[]) => void, _timeout?: number, ...args: unknown[]) => {
    queueMicrotask(() => handler(...args))
    return 0
  }
  try {
    return await fn()
  } finally {
    globalThis.setTimeout = previousSetTimeout
  }
}

test('P3 direct GPT Image 2 runtime uses RunPlan size contract without RH adapter fields', () => {
  const plan = buildCreationRunPlan({
    modelId: 'newapi/t8/gpt-image-2',
    params: {
      prompt: '一张产品主图',
      ratio: '16:9',
      resolution: '2k',
      images: ['https://cdn.jiucaihezi.studio/input.png'],
    },
  })

  const request = buildCreationSubmitRequest(plan)

  assert.equal(request.runtime, 'newapi-direct')
  assert.equal(request.taskType, 'image')
  assert.equal(request.endpoint, '/v1/images/edits')
  assert.equal(request.pollKind, 'newapi-task')
  assert.equal(request.usesRhAdapter, false)
  assert.equal(request.imageParams?.size, '2048x1152')
  assert.equal((request.imageParams as any)?.aspectRatio, undefined)
  assert.equal((request.imageParams as any)?.resolution, undefined)
})

test('direct GPT Image 2 edit submits selected canvas images as multipart files', { concurrency: false }, async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.match(String(input), /\/v1\/images\/edits$/)
    assert.equal(init?.body instanceof FormData, true)
    const body = init?.body as FormData
    assert.equal(body.get('model'), 'gpt-image-2')
    assert.equal(body.get('prompt'), '把手表改成黄色')
    assert.equal(body.get('size'), '2048x1152')
    assert.equal(body.get('image') instanceof Blob, true)
    return Response.json({ data: [{ url: 'https://webstatic.aiproxy.vip/output/gpt-edit.png' }] })
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'newapi/t8/gpt-image-2',
      params: {
        prompt: '把手表改成黄色',
        ratio: '16:9',
        resolution: '2k',
        images: ['data:image/png;base64,aGVsbG8='],
      },
    })
    const result = await executeCreationSubmitRequest(buildCreationSubmitRequest(plan))
    assert.equal(result.url, 'https://webstatic.aiproxy.vip/output/gpt-edit.png')
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('P4 RunningHub GPT2 runtime preserves RH aspectRatio and polls via rh-adapter task route', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/images/generations')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-gpt2-image')
      assert.equal(body.prompt, '保留人物，改成赛博都市')
      assert.equal(body.extra_fields?.aspectRatio, '16:9')
      assert.equal(body.extra_fields?.aspect_ratio, '16:9')
      assert.equal(body.extra_fields?.ratio, '16:9')
      assert.equal(body.extra_fields?.resolution, '2k')
      assert.deepEqual(body.images, ['https://cdn.jiucaihezi.studio/input.png'])
      return Response.json({ task_id: 'rh_gpt2_runtime_001', status: 'processing' })
    }
    if (url.endsWith('/rh/tasks/rh_gpt2_runtime_001')) {
      return Response.json({ task_id: 'rh_gpt2_runtime_001', status: 'success', url: 'https://webstatic.aiproxy.vip/output/rh-gpt2-runtime.png' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'runninghub/api/rh-gpt2-image',
      params: {
        prompt: '保留人物，改成赛博都市',
        aspectRatio: '16:9',
        resolution: '2k',
        images: ['https://cdn.jiucaihezi.studio/input.png'],
      },
    })

    const request = buildCreationSubmitRequest(plan)

    assert.equal(request.runtime, 'runninghub-adapter')
    assert.equal(request.taskType, 'image')
    assert.equal(request.endpoint, '/v1/images/generations')

    const result = await withImmediateTimers(() => executeCreationSubmitRequest(request))
    assert.equal(result.url, 'https://webstatic.aiproxy.vip/output/rh-gpt2-runtime.png')
    assert.equal(result.taskId, 'rh_gpt2_runtime_001')
    assert.equal(result.pollUrl, '/rh/tasks/rh_gpt2_runtime_001')
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('RunningHub image edit sends canvas data directly to the RH adapter', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  const image = 'data:image/png;base64,aGVsbG8='

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    assert.notEqual(url.endsWith('/api/creations/uploads'), true)
    if (url.endsWith('/v1/images/generations')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.deepEqual(body.images, [image])
      return Response.json({ task_id: 'rh_canvas_data_001', status: 'processing' })
    }
    if (url.endsWith('/rh/tasks/rh_canvas_data_001')) {
      return Response.json({ status: 'success', url: 'https://webstatic.aiproxy.vip/output/rh-canvas-data.png' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'runninghub/api/rh-flux-klein-edit',
      params: { prompt: '改成 3d 风格', aspectRatio: '9:16', images: [image] },
    })
    const result = await withImmediateTimers(() => executeCreationSubmitRequest(buildCreationSubmitRequest(plan)))
    assert.equal(result.url, 'https://webstatic.aiproxy.vip/output/rh-canvas-data.png')
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('RunningHub Z Image Turbo runtime submits LoRA payload through RH adapter route', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/images/generations')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'z-image-turbo')
      assert.equal(body.prompt, '一张品牌海报')
      assert.equal(body.extra_fields?.aspectRatio, '9:16')
      assert.equal(body.extra_fields?.lora, 'Z-Image _ 清纯高颜值_脸模版V1.0.safetensors')
      assert.equal(body.extra_fields?.lora_strength, 1)
      assert.equal(body.extra_fields?.outputFormat, 'png')
      assert.deepEqual(body.extra_fields, {
        aspectRatio: '9:16',
        aspect_ratio: '9:16',
        ratio: '9:16',
        resolution: '1k',
        lora: 'Z-Image _ 清纯高颜值_脸模版V1.0.safetensors',
        lora_strength: 1,
        outputFormat: 'png',
      })
      assert.equal(body.size, undefined)
      return Response.json({ task_id: 'z_image_runtime_001', status: 'processing' })
    }
    if (url.endsWith('/rh/tasks/z_image_runtime_001')) {
      return Response.json({ task_id: 'z_image_runtime_001', status: 'success', url: 'https://webstatic.aiproxy.vip/output/z-image.png' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'runninghub/api/z-image-turbo',
      params: {
        prompt: '一张品牌海报',
        aspectRatio: '9:16',
        lora: 'Z-Image _ 清纯高颜值_脸模版V1.0.safetensors',
        lora_strength: 1,
        outputFormat: 'png',
      },
    })

    const request = buildCreationSubmitRequest(plan)

    assert.equal(request.runtime, 'runninghub-adapter')
    assert.equal(request.taskType, 'image')
    assert.equal(request.imageParams?.lora, 'Z-Image _ 清纯高颜值_脸模版V1.0.safetensors')
    assert.equal(request.imageParams?.outputFormat, 'png')

    const result = await withImmediateTimers(() => executeCreationSubmitRequest(request))
    assert.equal(result.url, 'https://webstatic.aiproxy.vip/output/z-image.png')
    assert.equal(result.taskId, 'z_image_runtime_001')
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('P4 RunningHub AI App digital-human runtime uses nodeInfoList and ai_app task polling', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/videos')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-aiapp-fast-digital-human')
      assert.equal(body.prompt, 'AI App workflow')
      assert.deepEqual(body.nodeInfoList, [
        { nodeId: '3', fieldName: 'audio', fieldValue: 'https://cdn.jiucaihezi.studio/voice.mp3', description: 'audio' },
        { nodeId: '4', fieldName: 'image', fieldValue: 'https://cdn.jiucaihezi.studio/person.png', description: 'image' },
        { nodeId: '10', fieldName: 'value', fieldValue: '832', description: 'value' },
      ])
      return Response.json({ task_id: 'rh_aiapp_runtime_001', status: 'processing', ai_app: true })
    }
    if (url.endsWith('/rh/tasks/rh_aiapp_runtime_001?ai_app=true')) {
      return Response.json({ task_id: 'rh_aiapp_runtime_001', status: 'success', url: 'https://webstatic.aiproxy.vip/output/rh-aiapp-runtime.mp4' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'runninghub/aiapp/rh-aiapp-fast-digital-human',
      params: {
        image: 'https://cdn.jiucaihezi.studio/person.png',
        audio: 'https://cdn.jiucaihezi.studio/voice.mp3',
        value: 832,
      },
    })

    const request = buildCreationSubmitRequest(plan)

    assert.equal(request.runtime, 'runninghub-adapter')
    assert.equal(request.taskType, 'video')
    assert.equal(request.endpoint, '/v1/videos')

    const result = await withImmediateTimers(() => executeCreationSubmitRequest(request))
    assert.equal(result.url, 'https://webstatic.aiproxy.vip/output/rh-aiapp-runtime.mp4')
    assert.equal(result.taskId, 'rh_aiapp_runtime_001')
    assert.equal(result.pollUrl, '/rh/tasks/rh_aiapp_runtime_001?ai_app=true')
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('P4 RunningHub AI App voice-clone runtime preserves workflow timing and transcript fields', async () => {
  const plan = buildCreationRunPlan({
    modelId: 'runninghub/aiapp/rh-aiapp-voice-clone',
    params: {
      prompt: '声音克隆任务',
      audio: 'https://cdn.jiucaihezi.studio/reference.mp3',
      start_time: '0:00',
      end_time: '0:11',
      ref_text: '参考音频文字内容',
      text: '输出音频文字内容',
      language: '中文',
    },
  })

  const request = buildCreationSubmitRequest(plan)

  assert.equal(request.runtime, 'runninghub-adapter')
  assert.equal(request.taskType, 'audio')
  assert.equal(request.audioParams?.startTime, '0:00')
  assert.equal(request.audioParams?.endTime, '0:11')
  assert.equal(request.audioParams?.refText, '参考音频文字内容')
  assert.equal(request.audioParams?.text, '输出音频文字内容')
  assert.equal(request.audioParams?.language, '中文')
})

test('P4 RunningHub AI App director runtime preserves image video action and frame size fields', async () => {
  const plan = buildCreationRunPlan({
    modelId: 'runninghub/aiapp/rh-aiapp-director',
    params: {
      prompt: '导演模式',
      image: 'https://cdn.jiucaihezi.studio/actor.png',
      video: 'https://cdn.jiucaihezi.studio/motion.mp4',
      text: '女人在跳舞',
      width: 480,
      height: 832,
    },
  })

  const request = buildCreationSubmitRequest(plan)

  assert.equal(request.runtime, 'runninghub-adapter')
  assert.equal(request.taskType, 'video')
  assert.equal(request.videoParams?.imageUrl, 'https://cdn.jiucaihezi.studio/actor.png')
  assert.equal(request.videoParams?.videoUrl, 'https://cdn.jiucaihezi.studio/motion.mp4')
  assert.equal(request.videoParams?.text, '女人在跳舞')
  assert.equal(request.videoParams?.width, 480)
  assert.equal(request.videoParams?.height, 832)
})

test('P5 smoke RH Seedance runtime submits through rh-adapter task polling', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/videos')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-seedance2-fast')
      assert.equal(body.prompt, '海边人物转身')
      assert.equal(body.aspectRatio, '16:9')
      assert.equal(body.resolution, '720p')
      assert.equal(body.duration, '6')
      assert.deepEqual(body.images, ['https://cdn.jiucaihezi.studio/rh-seedance.png'])
      return Response.json({ task_id: 'rh_seedance_001', status: 'processing' })
    }
    if (url.endsWith('/rh/tasks/rh_seedance_001')) {
      return Response.json({ status: 'success', url: 'https://webstatic.aiproxy.vip/output/rh-seedance.mp4' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'runninghub/api/rh-seedance2-fast',
      params: {
        prompt: '海边人物转身',
        aspectRatio: '16:9',
        resolution: '720p',
        duration: 6,
        images: ['https://cdn.jiucaihezi.studio/rh-seedance.png'],
      },
    })
    const request = buildCreationSubmitRequest(plan)

    assert.equal(request.runtime, 'runninghub-adapter')
    assert.equal(request.usesRhAdapter, true)

    const result = await withImmediateTimers(() => executeCreationSubmitRequest(request))
    assert.equal(result.url, 'https://webstatic.aiproxy.vip/output/rh-seedance.mp4')
    assert.equal(result.pollUrl, '/rh/tasks/rh_seedance_001')
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('P5 smoke RH Grok runtime submits text video through rh-adapter task polling', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/videos')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-grok-text-video')
      assert.equal(body.prompt, '机械城市升起')
      assert.equal(body.duration, '6')
      return Response.json({ task_id: 'rh_grok_001', status: 'processing' })
    }
    if (url.endsWith('/rh/tasks/rh_grok_001')) {
      return Response.json({ status: 'success', url: 'https://webstatic.aiproxy.vip/output/rh-grok.mp4' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'runninghub/api/rh-grok-text-video',
      params: {
        prompt: '机械城市升起',
        duration: 6,
      },
    })
    const request = buildCreationSubmitRequest(plan)

    assert.equal(request.runtime, 'runninghub-adapter')
    const result = await withImmediateTimers(() => executeCreationSubmitRequest(request))
    assert.equal(result.url, 'https://webstatic.aiproxy.vip/output/rh-grok.mp4')
    assert.equal(result.pollUrl, '/rh/tasks/rh_grok_001')
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('P5 smoke RH Suno single returns audio result through rh-adapter polling', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/audio/speech')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-suno-v55-single')
      assert.equal(body.extra_fields?.title, '清晨')
      assert.equal(body.extra_fields?.description, '温暖的民谣')
      assert.equal(body.extra_fields?.make_instrumental, 'false')
      return Response.json({ task_id: 'rh_suno_single_001', status: 'processing' })
    }
    if (url.endsWith('/rh/tasks/rh_suno_single_001')) {
      return Response.json({ status: 'success', results: [{ url: 'https://webstatic.aiproxy.vip/output/rh-suno.mp3' }] })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'runninghub/api/rh-suno-v55-single',
      params: {
        prompt: '温暖的民谣',
        title: '清晨',
        make_instrumental: false,
      },
    })
    const request = buildCreationSubmitRequest(plan)

    assert.equal(request.runtime, 'runninghub-adapter')
    const result = await withImmediateTimers(() => executeCreationSubmitRequest(request))
    assert.equal(result.type, 'audio')
    assert.equal(result.url, 'https://webstatic.aiproxy.vip/output/rh-suno.mp3')
    assert.equal(result.pollUrl, '/rh/tasks/rh_suno_single_001')
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('P5 smoke RH lyrics returns text result through rh-adapter polling', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/audio/speech')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-suno-lyrics')
      assert.equal(body.prompt, '成长后的平静')
      return Response.json({ task_id: 'rh_lyrics_001', status: 'processing' })
    }
    if (url.endsWith('/rh/tasks/rh_lyrics_001')) {
      return Response.json({
        status: 'success',
        results: [{ outputType: 'txt', text: 'Title: 平静之后\\n[Verse]\\n我走过风雨' }],
      })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'runninghub/api/rh-suno-lyrics',
      params: { prompt: '成长后的平静' },
    })
    const request = buildCreationSubmitRequest(plan)

    assert.equal(request.runtime, 'runninghub-adapter')
    const result = await withImmediateTimers(() => executeCreationSubmitRequest(request))
    assert.equal(result.type, 'text')
    assert.equal(result.text, 'Title: 平静之后\n[Verse]\n我走过风雨')
    assert.equal(result.pollUrl, '/rh/tasks/rh_lyrics_001')
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

// ── P6: 端点路由专项测试 ──

test('RH 图片模型提交 URL 必须是 /v1/images/generations', () => {
  // rh-gpt2-text 是文生图，不需要参考图
  const plan = buildCreationRunPlan({
    modelId: 'runninghub/api/rh-gpt2-text',
    params: { prompt: 'test' },
  })
  const request = buildCreationSubmitRequest(plan)
  assert.equal(request.runtime, 'runninghub-adapter')
  assert.equal(request.taskType, 'image')
  assert.equal(request.endpoint, '/v1/images/generations')
})

test('RH 视频模型提交 URL 必须是 /v1/videos', () => {
  const plan = buildCreationRunPlan({
    modelId: 'runninghub/api/rh-grok-text-video',
    params: { prompt: 'test' },
  })
  const request = buildCreationSubmitRequest(plan)
  assert.equal(request.runtime, 'runninghub-adapter')
  assert.equal(request.taskType, 'video')
  assert.equal(request.endpoint, '/v1/videos')
})

test('RH 音频模型提交 URL 必须是 /v1/audio/speech', () => {
  const plan = buildCreationRunPlan({
    modelId: 'runninghub/api/rh-suno-v55-single',
    params: { prompt: 'test' },
  })
  const request = buildCreationSubmitRequest(plan)
  assert.equal(request.runtime, 'runninghub-adapter')
  assert.equal(request.taskType, 'audio')
  assert.equal(request.endpoint, '/v1/audio/speech')
})

test('RH 视频返回 task_id 后 pollUrl 必须是 /rh/tasks/{task_id}', () => {
  const plan = buildCreationRunPlan({
    modelId: 'runninghub/api/rh-video-v31-fast',
    params: { prompt: 'test' },
  })
  const request = buildCreationSubmitRequest(plan)
  assert.equal(request.runtime, 'runninghub-adapter')
  assert.equal(request.taskType, 'video')
  assert.equal(request.endpoint, '/v1/videos')
  assert.equal(request.pollKind, 'rh-task')
  assert.equal(request.usesRhAdapter, true)
})

test('z-image-turbo 保留且作为 RH 图片模型可执行', () => {
  const plan = buildCreationRunPlan({
    modelId: 'runninghub/api/z-image-turbo',
    params: { prompt: 'test' },
  })
  const request = buildCreationSubmitRequest(plan)
  assert.equal(request.runtime, 'runninghub-adapter')
  assert.equal(request.taskType, 'image')
  assert.equal(request.endpoint, '/v1/images/generations')
  assert.equal(request.usesRhAdapter, true)
  assert.equal(request.plan.contractStatus, 'verified')
})

test('不可用的非 RH 视频模型 contractStatus 不为 verified（通过 spec 直接检查）', () => {
  // broken 模型会触发 validateCreationModelSpec 抛出异常，
  // 直接检查 spec 的 contractStatus 而非通过 buildCreationRunPlan
  const brokenIds = [
    'newapi/t8/grok-video-3-fast',
    'newapi/t8/veo3.1-fast',
    'newapi/trump/seedance-2.0',
    'newapi/trump/seedance-2.0-fast',
  ]
  for (const modelId of brokenIds) {
    const spec = getCreationModelSpec(modelId)
    assert.ok(spec, `${modelId} spec should exist`)
    assert.equal(spec.contractStatus, 'broken', `${modelId} should be broken`)
  }
})
