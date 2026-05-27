import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assertMediaModelExecutable, generateAudio, generateVideo } from '../media-generation'



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
  assert.doesNotThrow(() => assertMediaModelExecutable('nano-banana-2k', 'image'))
  assert.doesNotThrow(() => assertMediaModelExecutable('nano-banana-4k', 'image'))
  assert.doesNotThrow(() => assertMediaModelExecutable('grok-video-3', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('veo3.1-fast', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('seedance-2-0', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('seedance-2-0-pro', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-mimic', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-digital-human-fast', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-digital-human', 'video'))
  assert.doesNotThrow(() => assertMediaModelExecutable('suno_music', 'audio'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-voice-clone', 'audio'))
  assert.doesNotThrow(() => assertMediaModelExecutable('rh-voice-design', 'audio'))

  assert.throws(() => assertMediaModelExecutable('gpt-image-2', 'video'), /不支持/)
  assert.throws(() => assertMediaModelExecutable('grok-video-3', 'image'), /不支持/)
  assert.throws(() => assertMediaModelExecutable('suno_music', 'video'), /不支持/)
})

test('media generation API requires member access before network execution', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  let fetchCount = 0
  globalThis.fetch = async () => {
    fetchCount += 1
    return Response.json({ data: [{ url: 'https://cdn.example.com/result.png' }] })
  }
  

  try {
    await assert.rejects(
      () => generateVideo({ model: 'grok-video-3', prompt: 'blocked' }),
      /会员功能/,
    )
    assert.equal(fetchCount, 0)
  } finally {
    
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('RunningHub video workflows upload local data URLs through Gateway creation tasks and poll task results', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.endsWith('/api/creations/uploads')) {
      assert.equal(init?.method, 'POST')
      assert.ok(init?.body instanceof FormData)
      return Response.json({ success: true, url: `https://cdn.example.com/upload-${calls.filter(call => call.url.endsWith('/api/creations/uploads')).length}.png` })
    }
    if (url.endsWith('/api/creations/tasks')) {
      assert.equal(init?.method, 'POST')
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.channel, 'runninghub')
      assert.equal(body.model, 'rh-mimic')
      assert.equal(body.payload.nodeInfoList[0].fieldValue, 'https://cdn.example.com/upload-1.png')
      assert.equal(body.payload.nodeInfoList[1].fieldValue, 'https://cdn.example.com/upload-2.png')
      return Response.json({ success: true, taskId: 'rh_task_001', status: 'pending' })
    }
    if (url.endsWith('/api/creations/tasks/rh_task_001')) {
      return Response.json({ taskId: 'rh_task_001', status: 'success', upstream: { data: { url: 'https://cdn.example.com/result.mp4' } } })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const result = await generateVideo({
      model: 'rh-mimic',
      prompt: '动作说明',
      imageUrl: 'data:image/png;base64,aGVsbG8=',
      videoUrl: 'data:video/mp4;base64,aGVsbG8=',
      text: '挥手',
      width: 480,
      height: 832,
    })
    assert.equal(result.url, 'https://cdn.example.com/result.mp4')
    assert.equal(result.taskId, 'rh_task_001')
    assert.equal(result.pollUrl, '/api/creations/tasks/rh_task_001')
    assert.equal(calls.filter(call => call.url.endsWith('/api/creations/uploads')).length, 2)
  } finally {
    
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('RunningHub audio workflows poll Gateway creation tasks instead of requiring synchronous URLs', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/creations/uploads')) {
      return Response.json({ success: true, url: 'https://cdn.example.com/reference.wav' })
    }
    if (url.endsWith('/api/creations/tasks')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.channel, 'runninghub')
      assert.equal(body.model, 'rh-voice-clone')
      assert.equal(body.payload.nodeInfoList[0].fieldValue, 'https://cdn.example.com/reference.wav')
      return Response.json({ success: true, taskId: 'rh_audio_001', status: 'pending' })
    }
    if (url.endsWith('/api/creations/tasks/rh_audio_001')) {
      return Response.json({ taskId: 'rh_audio_001', status: 'completed', upstream: { output: { audio: { url: 'https://cdn.example.com/result.wav' } } } })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const result = await generateAudio({
      model: 'rh-voice-clone',
      prompt: '',
      audioUrl: 'data:audio/wav;base64,aGVsbG8=',
      refText: '参考文字',
      text: '输出文字',
      language: '中文',
    })
    assert.equal(result.url, 'https://cdn.example.com/result.wav')
    assert.equal(result.taskId, 'rh_audio_001')
    assert.equal(result.pollUrl, '/api/creations/tasks/rh_audio_001')
  } finally {
    
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('Grok Video 3 submits text-only prompts to RunningHub text-to-video route', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  const submitted: any[] = []
  
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/creations/tasks')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.channel, 'runninghub')
      assert.equal(body.taskType, 'grok-video')
      assert.equal(body.meta.route, '/openapi/v2/rhart-video-g/text-to-video')
      assert.equal(body.payload.prompt, 'video')
      assert.equal(body.payload.imageUrls, undefined)
      return Response.json({ success: true, taskId: 'grok_video_001', status: 'pending' })
    }
    if (url.endsWith('/api/creations/tasks/grok_video_001')) {
      return Response.json({ status: 'completed', upstream: { results: [{ url: 'https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/grok.mp4' }] } })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const video = await generateVideo({
      model: 'grok-video-3',
      prompt: 'video',
      onSubmitted: payload => submitted.push(payload),
    })
    assert.equal(video.url, 'https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/grok.mp4')
    assert.deepEqual(submitted.shift(), {
      taskId: 'grok_video_001',
      pollUrl: '/api/creations/tasks/grok_video_001',
      pollKind: 'video',
    })
  } finally {
    
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('Grok Video 3 uploads local reference images before RunningHub image-to-video submit', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/creations/uploads')) {
      assert.ok(init?.body instanceof FormData)
      return Response.json({ success: true, url: 'https://cdn.jiucaihezi.studio/uploaded.png' })
    }
    if (url.endsWith('/api/creations/tasks')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.meta.route, '/openapi/v2/rhart-video-g/image-to-video')
      assert.deepEqual(body.payload.imageUrls, ['https://cdn.jiucaihezi.studio/uploaded.png'])
      return Response.json({ success: true, taskId: 'grok_image_video_001', status: 'pending' })
    }
    if (url.endsWith('/api/creations/tasks/grok_image_video_001')) {
      return Response.json({ status: 'success', results: [{ url: 'https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/grok-image.mp4' }] })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const video = await generateVideo({
      model: 'grok-video-3',
      prompt: 'image video',
      imageUrl: 'data:image/png;base64,aGVsbG8=',
    })
    assert.equal(video.url, 'https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/grok-image.mp4')
  } finally {
    
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('Seedance 2.0 submits through the direct Seedance proxy with image_file fields', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  const submitted: any[] = []
  
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/api/creations/uploads')) {
      return Response.json({ success: true, url: 'https://cdn.jiucaihezi.studio/seedance-ref.png' })
    }
    if (url.endsWith('/api/seedance/v1/videos')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'seedance-2-0-pro')
      assert.equal(body.prompt, 'seedance prompt')
      assert.equal(body.duration, 8)
      assert.equal(body.ratio, '9:16')
      assert.equal(body.resolution, '720p')
      assert.equal(body.image_file_1, 'https://cdn.jiucaihezi.studio/seedance-ref.png')
      assert.equal(body.images, undefined)
      return Response.json({ code: 102, status: 'queued', task_id: 'seedance_task_001', progress: { message: '已接收' } })
    }
    if (url.endsWith('/api/seedance/v1/videos/seedance_task_001')) {
      return Response.json({ code: 200, status: 'succeeded', task_id: 'seedance_task_001', url: 'https://cdn.sd2.mengfactory.cn/sd2/result-assets/video.mp4' })
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
    const video = await generateVideo({
      model: 'seedance-2-0-pro',
      prompt: 'seedance prompt',
      aspectRatio: '9:16',
      resolution: '720p',
      duration: 8,
      imageUrl: 'data:image/png;base64,aGVsbG8=',
      onSubmitted: payload => submitted.push(payload),
    })
    assert.equal(video.url, 'https://cdn.sd2.mengfactory.cn/sd2/result-assets/video.mp4')
    assert.deepEqual(submitted.shift(), {
      taskId: 'seedance_task_001',
      pollUrl: '/api/seedance/v1/videos/seedance_task_001',
      pollKind: 'video',
    })

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
