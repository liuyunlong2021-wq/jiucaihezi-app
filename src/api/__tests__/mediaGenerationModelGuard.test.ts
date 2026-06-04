import assert from 'node:assert/strict'
import { test } from 'node:test'

import { __resetApiKeyMemoryCacheForTests } from '../../services/newApiClient'
import { clearMediaModelAvailability, setMediaModelAvailability } from '../../data/mediaModelCapabilities'
import { assertMediaModelExecutable, generateAudio, generateImage, generateVideo } from '../media-generation'

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


test('media generation API rejects removed and stale model ids before execution', () => {
  for (const id of ['nano-banana', 'nano-banana-hd', 'grok-4.2-image', 'grok-4.1-image']) {
    assert.throws(() => assertMediaModelExecutable(id, 'image'), /不可用|重新选择/)
  }

  for (const id of ['seedance-2.0-fast', 'doubao-seedance-1-0-pro-250528']) {
    assert.throws(() => assertMediaModelExecutable(id, 'video'), /不可用|重新选择/)
  }

  assert.throws(() => assertMediaModelExecutable('unknown-video-model', 'video'), /不可用|重新选择/)
})

test('media generation API allows only approved models for each execution kind', () => {
  assert.doesNotThrow(() => assertMediaModelExecutable('gpt-image-2', 'image'))
  assert.throws(() => assertMediaModelExecutable('nano-banana-2k', 'image'), /不可用|重新选择/)
  assert.doesNotThrow(() => assertMediaModelExecutable('nano-banana-4k', 'image'))
  assert.doesNotThrow(() => assertMediaModelExecutable('nano-banana-pro-4k', 'image'))
  assert.doesNotThrow(() => assertMediaModelExecutable('grok-video-3', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-grok-text-video', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-grok-image-video', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-seedance2-text-video', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-seedance2-image-video', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-seedance2-multimodal-video', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-video-v31-fast', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-aiapp-fast-digital-human', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-aiapp-digital-human', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-aiapp-director', 'video'))
  assert.throws(() => assertMediaModelExecutable('rh-seedance2', 'video'), /不可用|重新选择/)
  assert.throws(() => assertMediaModelExecutable('rh-kling-v30-pro', 'video'), /不可用|重新选择/)
  assert.throws(() => assertMediaModelExecutable('rh-veo-31-fast', 'video'), /不可用|重新选择/)
  assert.throws(() => assertMediaModelExecutable('rh-veo-31-pro', 'video'), /不可用|重新选择/)
  assert.throws(() => assertMediaModelExecutable('veo3.1-fast', 'video'), /不可用|重新选择/)
  assert.throws(() => assertMediaModelExecutable('seedance-2-0', 'video'), /不可用|重新选择/)
  assert.throws(() => assertMediaModelExecutable('seedance-2-0-pro', 'video'), /不可用|重新选择/)
  assert.throws(() => assertMediaModelExecutable('rh-mimic', 'video'), /不可用|重新选择/)
  assert.throws(() => assertMediaModelExecutable('rh-digital-human-fast', 'video'), /不可用|重新选择/)
  assert.throws(() => assertMediaModelExecutable('rh-digital-human', 'video'), /不可用|重新选择/)
  assert.doesNotThrow(() => assertMediaModelExecutable('suno_music', 'audio'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-voice-clone', 'audio'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-speech-hd', 'audio'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-speech-turbo', 'audio'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-music', 'audio'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-aiapp-voice-clone', 'audio'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-aiapp-voice-design', 'audio'))
  assert.throws(() => assertMediaModelExecutable('rh-voice-design', 'audio'), /不可用|重新选择/)

  assert.throws(() => assertMediaModelExecutable('gpt-image-2', 'video'), /不支持/)
  assert.throws(() => assertMediaModelExecutable('grok-video-3', 'image'), /不支持/)
  assert.throws(() => assertMediaModelExecutable('suno_music', 'video'), /不支持/)
})

test('media generation API rejects backend-disabled runtime availability before execution', () => {
  try {
    setMediaModelAvailability([
      { id: 'grok-video-3', status: 'disabled', reason: '模型维护中' },
    ])

    assert.throws(() => assertMediaModelExecutable('grok-video-3', 'video'), /模型维护中|暂不可用|重新选择/)
  } finally {
    clearMediaModelAvailability()
  }
})

test('media generation API requires login before network execution', async () => {
  __resetApiKeyMemoryCacheForTests('')
  const previousFetch = globalThis.fetch
  let fetchCount = 0
  globalThis.fetch = async () => {
    fetchCount += 1
    return Response.json({ data: [{ url: 'https://cdn.example.com/result.png' }] })
  }


  try {
    await assert.rejects(
      () => generateVideo({ model: 'grok-video-3', prompt: 'blocked' }),
      /登录/,
    )
    assert.equal(fetchCount, 0)
  } finally {

    globalThis.fetch = previousFetch
  }
})

test('disabled RunningHub video workflows are rejected before network execution', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  let fetchCount = 0

  globalThis.fetch = async () => {
    fetchCount += 1
    return Response.json({ id: 'unexpected' })
  }

  try {
    await assert.rejects(
      () => generateVideo({
        model: 'rh-mimic',
        prompt: '动作说明',
        imageUrl: 'data:image/png;base64,aGVsbG8=',
        videoUrl: 'data:video/mp4;base64,aGVsbG8=',
        text: '挥手',
        width: 480,
        height: 832,
      }),
      /不可用|重新选择/,
    )
    assert.equal(fetchCount, 0)
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('RunningHub voice clone submits flat speech params and polls via rh-adapter task endpoint', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  const submitted: any[] = []

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/audio/speech')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-voice-clone')
      assert.equal(body.prompt, '输出文字')
      assert.equal(body.audio_url, 'https://cdn.example.com/ref.wav')
      assert.equal(body.audio, 'https://cdn.example.com/ref.wav')
      assert.equal(body.start_time, undefined)
      assert.equal(body.end_time, undefined)
      assert.equal(body.ref_text, undefined)
      assert.equal(body.text, '输出文字')
      assert.equal(body.language, 'Chinese')
      assert.equal(body.nodeInfoList, undefined)
      return Response.json({ task_id: 'voice_task_001', status: 'processing' })
    }
    if (url.endsWith('/rh/tasks/voice_task_001')) {
      return Response.json({ task_id: 'voice_task_001', status: 'success', url: 'https://webstatic.aiproxy.vip/output/voice.mp3' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const audio = await withImmediateTimers(() => generateAudio({
        model: 'rh-voice-clone',
        prompt: '',
        audioUrl: 'https://cdn.example.com/ref.wav',
        startTime: '0:01',
        endTime: '0:09',
        refText: '参考文字',
        text: '输出文字',
        language: 'Chinese',
        onSubmitted: payload => submitted.push(payload),
      }))
    assert.equal(audio.url, 'https://webstatic.aiproxy.vip/output/voice.mp3')
    assert.equal(audio.taskId, 'voice_task_001')
    assert.equal(audio.pollUrl, '/rh/tasks/voice_task_001')
    assert.deepEqual(submitted.shift(), {
      taskId: 'voice_task_001',
      pollUrl: '/rh/tasks/voice_task_001',
      pollKind: 'audio',
    })
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('RunningHub speech and music models submit to audio speech endpoint and poll via rh-adapter', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  const submitted: any[] = []
  const seenModels: string[] = []

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/audio/speech')) {
      const body = JSON.parse(String(init?.body || '{}'))
      seenModels.push(body.model)
      assert.equal(body.prompt, `prompt for ${body.model}`)
      assert.equal(body.language, body.model === 'rh-music' ? undefined : '中文')
      assert.equal(body.audio_url, undefined)
      assert.equal(body.nodeInfoList, undefined)
      return Response.json({ task_id: `${body.model}_task`, status: 'processing' })
    }
    const match = url.match(/\/rh\/tasks\/([^/?]+)$/)
    if (match) {
      return Response.json({ task_id: match[1], status: 'success', url: `https://webstatic.aiproxy.vip/output/${match[1]}.mp3` })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    for (const model of ['rh-speech-hd', 'rh-speech-turbo', 'rh-music']) {
      const audio = await withImmediateTimers(() => generateAudio({
        model,
        prompt: `prompt for ${model}`,
        language: model === 'rh-music' ? undefined : '中文',
        onSubmitted: payload => submitted.push(payload),
      }))
      assert.equal(audio.pollUrl, `/rh/tasks/${model}_task`)
      assert.equal(audio.url, `https://webstatic.aiproxy.vip/output/${model}_task.mp3`)
    }
    assert.deepEqual(seenModels, ['rh-speech-hd', 'rh-speech-turbo', 'rh-music'])
    assert.deepEqual(submitted.map(item => item.pollUrl), [
      '/rh/tasks/rh-speech-hd_task',
      '/rh/tasks/rh-speech-turbo_task',
      '/rh/tasks/rh-music_task',
    ])
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('RunningHub image models do not send pixel dimensions as RH resolution', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/images/generations')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-pro-image')
      assert.equal(body.size, undefined)
      assert.equal(body.resolution, '1k')
      return Response.json({ data: [{ url: 'https://webstatic.aiproxy.vip/output/rh-pro.png' }] })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const result = await generateImage({
      model: 'rh-pro-image',
      prompt: 'image',
      size: '1024x1536',
      resolution: '1024x1536',
    })
    assert.equal(result.url, 'https://webstatic.aiproxy.vip/output/rh-pro.png')
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('new RunningHub image and video models submit through NewAPI and poll via rh-adapter tasks', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  const submitted: any[] = []
  const submittedModels: string[] = []

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/images/generations')) {
      const body = JSON.parse(String(init?.body || '{}'))
      submittedModels.push(body.model)
      assert.equal(body.model, 'rh-image-v2')
      assert.equal(body.ratio, '1:1')
      assert.equal(body.aspect_ratio, '1:1')
      assert.equal(body.resolution, '2k')
      return Response.json({ task_id: 'rh_image_v2_task', status: 'processing' })
    }
    if (url.endsWith('/v1/videos')) {
      const body = JSON.parse(String(init?.body || '{}'))
      submittedModels.push(body.model)
      assert.ok(['rh-seedance2-text-video', 'rh-seedance2-image-video', 'rh-seedance2-multimodal-video'].includes(body.model))
      assert.equal(body.ratio, 'adaptive')
      assert.equal(body.aspect_ratio, 'adaptive')
      return Response.json({ task_id: `${body.model}_task`, status: 'processing' })
    }
    const match = url.match(/\/rh\/tasks\/([^/?]+)$/)
    if (match) {
      return Response.json({ task_id: match[1], status: 'success', url: `https://webstatic.aiproxy.vip/output/${match[1]}.mp4` })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const image = await withImmediateTimers(() => generateImage({
      model: 'rh-image-v2',
      prompt: 'image',
      aspectRatio: '1:1',
      resolution: '2k',
      onSubmitted: payload => submitted.push(payload),
    }))
    assert.equal(image.pollUrl, '/rh/tasks/rh_image_v2_task')

    for (const model of ['rh-seedance2-text-video', 'rh-seedance2-image-video', 'rh-seedance2-multimodal-video']) {
      const video = await withImmediateTimers(() => generateVideo({
        model,
        prompt: 'video',
        aspectRatio: 'adaptive',
        onSubmitted: payload => submitted.push(payload),
      }))
      assert.equal(video.pollUrl, `/rh/tasks/${model}_task`)
    }

    assert.deepEqual(submittedModels, ['rh-image-v2', 'rh-seedance2-text-video', 'rh-seedance2-image-video', 'rh-seedance2-multimodal-video'])
    assert.deepEqual(submitted.map(item => item.pollUrl), [
      '/rh/tasks/rh_image_v2_task',
      '/rh/tasks/rh-seedance2-text-video_task',
      '/rh/tasks/rh-seedance2-image-video_task',
      '/rh/tasks/rh-seedance2-multimodal-video_task',
    ])
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('Nano Banana 4K visible model id submits the available upstream Pro 4K model', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/images/generations')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'nano-banana-pro-4k')
      return Response.json({ data: [{ url: 'https://webstatic.aiproxy.vip/output/nano-pro-4k.png' }] })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const result = await generateImage({
      model: 'nano-banana-4k',
      prompt: 'image',
      aspectRatio: '1:1',
    })
    assert.equal(result.url, 'https://webstatic.aiproxy.vip/output/nano-pro-4k.png')
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('Grok Video 3 maps text-only prompts to the supported RunningHub text model', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  const submitted: any[] = []

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/videos')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-grok-text-video')
      assert.equal(body.prompt, 'video')
      assert.equal(body.duration, '10')
      assert.equal(body.images, undefined)
      return Response.json({ task_id: 'grok_video_001', status: 'processing' })
    }
    if (url.endsWith('/rh/tasks/grok_video_001')) {
      return Response.json({ task_id: 'grok_video_001', status: 'success', url: 'https://webstatic.aiproxy.vip/output/grok.mp4' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const video = await withImmediateTimers(() => generateVideo({
      model: 'grok-video-3',
      prompt: 'video',
      duration: 10,
      onSubmitted: payload => submitted.push(payload),
    }))
    assert.equal(video.url, 'https://webstatic.aiproxy.vip/output/grok.mp4')
    assert.equal(video.taskId, 'grok_video_001')
    assert.equal(video.pollUrl, '/rh/tasks/grok_video_001')
    assert.deepEqual(submitted.shift(), {
      taskId: 'grok_video_001',
      pollUrl: '/rh/tasks/grok_video_001',
      pollKind: 'video',
    })
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('Grok Video 3 maps reference images to the supported RunningHub image model', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/videos')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-grok-image-video')
      assert.deepEqual(body.images, ['https://cdn.jiucaihezi.studio/uploaded.png'])
      return Response.json({ task_id: 'grok_image_video_001', status: 'processing' })
    }
    if (url.endsWith('/rh/tasks/grok_image_video_001')) {
      return Response.json({ task_id: 'grok_image_video_001', status: 'success', url: 'https://webstatic.aiproxy.vip/output/grok-image.mp4' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const video = await withImmediateTimers(() => generateVideo({
      model: 'grok-video-3',
      prompt: 'image video',
      imageUrl: 'https://cdn.jiucaihezi.studio/uploaded.png',
    }))
    assert.equal(video.url, 'https://webstatic.aiproxy.vip/output/grok-image.mp4')
    assert.equal(video.taskId, 'grok_image_video_001')
    assert.equal(video.pollUrl, '/rh/tasks/grok_image_video_001')
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('RunningHub GPT2 image submits through standard RH task polling', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  const submitted: any[] = []

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/images/generations')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-gpt2-image')
      assert.equal(body.images?.[0], 'https://cdn.jiucaihezi.studio/input.png')
      assert.equal(body.resolution, '1k')
      return Response.json({ task_id: 'gpt2_image_001', status: 'processing' })
    }
    if (url.endsWith('/rh/tasks/gpt2_image_001')) {
      return Response.json({ task_id: 'gpt2_image_001', status: 'success', url: 'https://webstatic.aiproxy.vip/output/gpt2.png' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const image = await withImmediateTimers(() => generateImage({
      model: 'rh-gpt2-image',
      prompt: 'gpt2 image',
      image: 'https://cdn.jiucaihezi.studio/input.png',
      onSubmitted: payload => submitted.push(payload),
    }))
    assert.equal(image.url, 'https://webstatic.aiproxy.vip/output/gpt2.png')
    assert.equal(image.pollUrl, '/rh/tasks/gpt2_image_001')

    assert.deepEqual(submitted.shift(), {
      taskId: 'gpt2_image_001',
      pollUrl: '/rh/tasks/gpt2_image_001',
      pollKind: 'image',
    })
    assert.equal(submitted.length, 0)
  } finally {

    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('RunningHub official AI App video submissions send documented nodeInfoList', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  const submitted: any[] = []

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/videos')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-aiapp-director')
      assert.deepEqual(body.nodeInfoList, [
        { nodeId: '57', fieldName: 'image', fieldValue: 'data:image/png;base64,aGVsbG8=', description: '你想让谁演' },
        { nodeId: '997', fieldName: 'video', fieldValue: 'data:video/mp4;base64,aGVsbG8=', description: '你想让她/他演啥' },
        { nodeId: '1019', fieldName: 'text', fieldValue: '女人在跳舞', description: '简单说下动作是啥' },
        { nodeId: '999', fieldName: 'value', fieldValue: '480', description: '宽（竖屏不用动，横屏换下数字）' },
        { nodeId: '1000', fieldName: 'value', fieldValue: '832', description: '高（竖屏不用动，横屏换下数字）' },
      ])
      return Response.json({ task_id: 'director_ai_app_001', status: 'processing', ai_app: true })
    }
    if (url.endsWith('/rh/tasks/director_ai_app_001?ai_app=true')) {
      return Response.json({ task_id: 'director_ai_app_001', status: 'success', url: 'https://webstatic.aiproxy.vip/output/director.mp4' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const video = await withImmediateTimers(() => generateVideo({
      model: 'rh-aiapp-director',
      prompt: '',
      imageUrl: 'data:image/png;base64,aGVsbG8=',
      videoUrl: 'data:video/mp4;base64,aGVsbG8=',
      text: '女人在跳舞',
      width: 480,
      height: 832,
      onSubmitted: payload => submitted.push(payload),
    }))
    assert.equal(video.url, 'https://webstatic.aiproxy.vip/output/director.mp4')
    assert.equal(video.pollUrl, '/rh/tasks/director_ai_app_001?ai_app=true')
    assert.deepEqual(submitted.shift(), {
      taskId: 'director_ai_app_001',
      pollUrl: '/rh/tasks/director_ai_app_001?ai_app=true',
      pollKind: 'video',
    })
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('RunningHub official AI App audio submissions send documented nodeInfoList', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  const submitted: any[] = []

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/audio/speech')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-aiapp-voice-design')
      assert.equal(body.nodeInfoList[0].nodeId, '12')
      assert.equal(body.nodeInfoList[0].fieldName, '语言')
      assert.equal(body.nodeInfoList[0].fieldValue, '中文')
      assert.equal(body.nodeInfoList[1].nodeId, '14')
      assert.equal(body.nodeInfoList[1].fieldValue, '测试文稿')
      assert.equal(body.nodeInfoList[2].nodeId, '15')
      assert.equal(body.nodeInfoList[2].fieldValue, '清亮有活力')
      return Response.json({ task_id: 'voice_design_ai_app_001', status: 'processing', ai_app: true })
    }
    if (url.endsWith('/rh/tasks/voice_design_ai_app_001?ai_app=true')) {
      return Response.json({ task_id: 'voice_design_ai_app_001', status: 'success', url: 'https://webstatic.aiproxy.vip/output/voice.wav' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const audio = await withImmediateTimers(() => generateAudio({
      model: 'rh-aiapp-voice-design',
      prompt: '',
      text: '测试文稿',
      voicePrompt: '清亮有活力',
      language: '中文',
      onSubmitted: payload => submitted.push(payload),
    }))
    assert.equal(audio.url, 'https://webstatic.aiproxy.vip/output/voice.wav')
    assert.equal(audio.pollUrl, '/rh/tasks/voice_design_ai_app_001?ai_app=true')
    assert.deepEqual(submitted.shift(), {
      taskId: 'voice_design_ai_app_001',
      pollUrl: '/rh/tasks/voice_design_ai_app_001?ai_app=true',
      pollKind: 'audio',
    })
  } finally {
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('disabled Seedance proxy model is rejected while Suno still submits and polls', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  const submitted: any[] = []
  let seedanceFetchCount = 0

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/seedance/') || url.endsWith('/api/creations/uploads')) {
      seedanceFetchCount += 1
      return Response.json({ id: 'unexpected' })
    }
    if (url.endsWith('/suno/submit/music')) {
      return Response.json({ task_id: 'suno_task_001' })
    }
    if (url.endsWith('/suno/fetch/suno_task_001')) {
      return Response.json([{ status: 'complete', audio_url: 'https://cdn.example.com/song.mp3' }])
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    await assert.rejects(
      () => generateVideo({
        model: 'seedance-2-0-pro',
        prompt: 'seedance prompt',
        aspectRatio: '9:16',
        resolution: '720p',
        duration: 8,
        imageUrl: 'data:image/png;base64,aGVsbG8=',
        onSubmitted: payload => submitted.push(payload),
      }),
      /不可用|重新选择/,
    )
    assert.equal(seedanceFetchCount, 0)

    const audio = await generateAudio({
      model: 'suno_music',
      prompt: 'song',
      onSubmitted: payload => submitted.push(payload),
    })
    assert.equal(audio.url, 'https://cdn.example.com/song.mp3')
    assert.deepEqual(submitted.shift(), {
      taskId: 'suno_task_001',
      pollUrl: '/suno/fetch/suno_task_001',
      pollKind: 'audio',
    })
  } finally {

    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})
