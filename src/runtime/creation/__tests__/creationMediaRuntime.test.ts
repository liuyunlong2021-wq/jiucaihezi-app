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

test('P3 direct GPT Image 2 runtime uses the Xiaoyi async task contract', () => {
  const plan = buildCreationRunPlan({
    modelId: 'gpt-image-2-中质量',
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
  assert.equal(request.endpoint, '/v1/videos')
  assert.equal(request.pollKind, 'newapi-task')
  assert.equal(request.usesRhAdapter, false)
  assert.equal(request.imageParams?.size, '2048x1152')
  assert.equal(request.imageParams?.responseFormat, 'b64_json')
  assert.equal((request.imageParams as any)?.aspectRatio, undefined)
  assert.equal((request.imageParams as any)?.resolution, '2k')
})

test('direct GPT Image 2 submits and polls its Xiaoyi task through NewAPI', { concurrency: false }, async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/videos') && init?.method === 'POST') {
      assert.equal(init.body instanceof FormData, true)
      const body = init.body as FormData
      assert.equal(body.get('model'), 'gpt-image-2-中质量')
      assert.equal(body.get('prompt'), '把手表改成黄色')
      assert.equal(body.get('size'), '2048x1152')
      assert.equal(body.get('seconds'), '1')
      assert.equal(body.get('image') instanceof Blob, true)
      return Response.json({ id: 'task_xiaoyi_gpt', status: 'processing' })
    }
    if (url.endsWith('/v1/videos/task_xiaoyi_gpt')) {
      return Response.json({ status: 'completed', metadata: { url: 'https://cdn.example.test/gpt.png' } })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'gpt-image-2-中质量',
      params: {
        prompt: '把手表改成黄色',
        ratio: '16:9',
        resolution: '2k',
        images: ['data:image/png;base64,aGVsbG8='],
      },
    })
    const result = await withImmediateTimers(() => executeCreationSubmitRequest(buildCreationSubmitRequest(plan)))
    assert.equal(result.url, 'https://cdn.example.test/gpt.png')
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('Gemini image submits the Xiaoyi async task with its resolution', { concurrency: false }, async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/videos') && init?.method === 'POST') {
      const body = init.body as FormData
      assert.equal(body.get('model'), 'gemini-3-pro-image-preview')
      assert.equal(body.get('size'), 'auto')
      assert.equal(body.get('resolution'), '2k')
      assert.equal(body.get('seconds'), '1')
      return Response.json({ id: 'task_xiaoyi_gemini', status: 'processing' })
    }
    if (url.endsWith('/v1/videos/task_xiaoyi_gemini')) {
      return Response.json({ status: 'completed', metadata: { url: 'https://cdn.example.test/gemini.png' } })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'gemini-3-pro-image-preview',
      params: { prompt: '一张产品图', resolution: '2k' },
    })
    const result = await withImmediateTimers(() => executeCreationSubmitRequest(buildCreationSubmitRequest(plan)))
    assert.equal(result.type, 'image')
    assert.equal(result.url, 'https://cdn.example.test/gemini.png')
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('Veo Creation Runtime reuses the verified multipart and public-task result contract', { concurrency: false }, async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  const resultUrl = 'https://api.jiucaihezi.studio/v1/videos/task_veo_runtime/content'

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/videos') && init?.method === 'POST') {
      assert.ok(init.body instanceof FormData)
      assert.equal(init.body.get('model'), 'veo-3.1-fast-generate-preview')
      assert.equal(init.body.get('seconds'), '4')
      assert.ok(init.body.get('input_reference') instanceof Blob)
      return Response.json({ id: 'task_veo_runtime', status: 'queued' })
    }
    if (url.endsWith('/v1/videos/task_veo_runtime')) {
      return Response.json({ id: 'task_veo_runtime', status: 'completed' })
    }
    if (url.endsWith('/v1/video/generations/task_veo_runtime')) {
      return Response.json({ code: 'success', data: { result_url: resultUrl } })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'newapi/zx/veo-3.1-fast-generate-preview',
      params: {
        prompt: '让画面动起来',
        ratio: '16:9',
        resolution: '720p',
        duration: 4,
        images: ['data:image/png;base64,aGVsbG8='],
      },
    })
    const result = await withImmediateTimers(() => executeCreationSubmitRequest(buildCreationSubmitRequest(plan)))
    assert.equal(result.url, resultUrl)
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

test('Hunyuan image-to-3D reuses RH async submission and returns a 3D result', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  const images = ['https://cdn.jiucaihezi.studio/front.png', 'https://cdn.jiucaihezi.studio/left.png']

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/videos')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-3d-image')
      assert.deepEqual(body.images, images)
      assert.equal(body.extra_fields.faceCount, 500000)
      assert.equal(body.extra_fields.enablePbr, false)
      assert.equal(body.extra_fields.generateType, 'Normal')
      return Response.json({ task_id: 'rh_3d_runtime_001', status: 'processing' })
    }
    if (url.endsWith('/rh/tasks/rh_3d_runtime_001')) {
      return Response.json({ status: 'success', url: 'https://webstatic.aiproxy.vip/output/model.glb' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'runninghub/api/rh-3d-image',
      params: { images },
    })
    const request = buildCreationSubmitRequest(plan)
    assert.equal(request.taskType, 'video')
    const result = await withImmediateTimers(() => executeCreationSubmitRequest(request))
    assert.equal(result.type, 'model3d')
    assert.equal(result.url, 'https://webstatic.aiproxy.vip/output/model.glb')
    assert.equal(result.pollUrl, '/rh/tasks/rh_3d_runtime_001')
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

test('generic RunningHub AI App runtime uses dynamic nodeInfoList and ai_app polling', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/videos')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-aiapp-fast-digital-human')
      assert.equal(body.prompt, 'AI App workflow')
      assert.deepEqual(body.nodeInfoList, [
        { nodeId: '3', fieldName: 'audio', fieldValue: 'https://cdn.jiucaihezi.studio/voice.mp3' },
        { nodeId: '4', fieldName: 'image', fieldValue: 'https://cdn.jiucaihezi.studio/person.png' },
        { nodeId: '10', fieldName: 'value', fieldValue: '832' },
      ])
      assert.deepEqual(body.extra_fields, { webappId: '12345' })
      return Response.json({ task_id: 'rh_aiapp_runtime_001', status: 'processing', ai_app: true })
    }
    if (url.endsWith('/rh/tasks/rh_aiapp_runtime_001?ai_app=true')) {
      return Response.json({ task_id: 'rh_aiapp_runtime_001', status: 'success', url: 'https://webstatic.aiproxy.vip/output/rh-aiapp-runtime.mp4' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'runninghub/aiapp/rh-aiapp',
      params: {
        webappId: '12345',
        billingModel: 'rh-aiapp-fast-digital-human',
        outputType: 'video',
        '3:audio': 'https://cdn.jiucaihezi.studio/voice.mp3',
        '4:image': 'https://cdn.jiucaihezi.studio/person.png',
        '10:value': 832,
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

test('generic RunningHub image and audio AI Apps use their existing media runtimes', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/images/generations')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-custom-image')
      assert.deepEqual(body.nodeInfoList, [{ nodeId: '1', fieldName: 'text', fieldValue: 'poster' }])
      assert.deepEqual(body.extra_fields, { webappId: 'image-app' })
      return Response.json({ task_id: 'rh_aiapp_image', status: 'processing', ai_app: true })
    }
    if (url.endsWith('/v1/audio/speech')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-custom-audio')
      assert.deepEqual(body.nodeInfoList, [{ nodeId: '2', fieldName: 'text', fieldValue: 'hello' }])
      assert.deepEqual(body.extra_fields, { webappId: 'audio-app' })
      assert.match(body.voice, /^__rh_nodeinfo__/)
      return Response.json({ task_id: 'rh_aiapp_audio', status: 'processing', ai_app: true })
    }
    if (url.endsWith('/rh/tasks/rh_aiapp_image?ai_app=true')) {
      return Response.json({ status: 'success', url: 'https://example.com/result.png' })
    }
    if (url.endsWith('/rh/tasks/rh_aiapp_audio?ai_app=true')) {
      return Response.json({ status: 'success', results: [{ url: 'https://example.com/result.mp3' }] })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    for (const outputType of ['image', 'audio'] as const) {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/aiapp/rh-aiapp',
        params: {
          webappId: `${outputType}-app`,
          billingModel: `rh-custom-${outputType}`,
          outputType,
          [`${outputType === 'image' ? 1 : 2}:text`]: outputType === 'image' ? 'poster' : 'hello',
        },
      })
      const request = buildCreationSubmitRequest(plan)
      assert.equal(request.taskType, outputType)
      const result = await withImmediateTimers(() => executeCreationSubmitRequest(request))
      assert.equal(result.type, outputType)
    }
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
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
      assert.equal(body.input, '温暖的民谣')
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
      assert.equal(body.input, '成长后的平静')
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

test('Seed Audio submits up to three reference audios and returns synchronous MP3', { concurrency: false }, async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.match(String(input), /\/v1\/audio\/speech$/)
    const body = JSON.parse(String(init?.body))
    assert.equal(body.model, 'seed-audio-1.0')
    assert.equal(body.input, '按参考声音生成')
    assert.deepEqual(body.metadata.references, [
      { audio_data: 'YQ==' },
      { audio_data: 'Yg==' },
      { audio_data: 'Yw==' },
    ])
    return new Response(new Uint8Array([0x49, 0x44, 0x33]), {
      headers: { 'Content-Type': 'audio/mpeg' },
    })
  }

  try {
    const plan = buildCreationRunPlan({
      modelId: 'seed-audio-1.0',
      params: {
        prompt: '按参考声音生成',
        audios: [
          'data:audio/mpeg;base64,YQ==',
          'data:audio/mpeg;base64,Yg==',
          'data:audio/mpeg;base64,Yw==',
        ],
      },
    })
    const result = await executeCreationSubmitRequest(buildCreationSubmitRequest(plan))
    assert.equal(result.type, 'audio')
    assert.equal(result.url, 'data:audio/mpeg;base64,SUQz')
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
    'newapi/trump/seedance-2.0',
    'newapi/trump/seedance-2.0-fast',
  ]
  for (const modelId of brokenIds) {
    const spec = getCreationModelSpec(modelId)
    assert.ok(spec, `${modelId} spec should exist`)
    assert.equal(spec.contractStatus, 'broken', `${modelId} should be broken`)
  }
})
