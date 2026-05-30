import assert from 'node:assert/strict'
import { test } from 'node:test'

import { __resetApiKeyMemoryCacheForTests } from '../../services/newApiClient'
import { assertMediaModelExecutable, generateAudio, generateImage, generateVideo } from '../media-generation'

async function installGatewaySession() {
  __resetApiKeyMemoryCacheForTests('session-cloud')
  return async () => {
    __resetApiKeyMemoryCacheForTests('')
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

test('RunningHub video workflows submit through NewAPI and return poll metadata', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/videos')) {
      assert.equal(init?.method, 'POST')
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-mimic')
      assert.equal(body.nodeInfoList[0].fieldValue, 'data:image/png;base64,aGVsbG8=')
      assert.equal(body.nodeInfoList[1].fieldValue, 'data:video/mp4;base64,aGVsbG8=')
      return Response.json({ id: 'rh_task_001', status: 'pending' })
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
    assert.equal(result.url, '')
    assert.equal(result.taskId, 'rh_task_001')
    assert.equal(result.pollUrl, '/v1/videos/rh_task_001')
  } finally {
    
    globalThis.fetch = previousFetch
    await restoreStorage()
  }
})

test('RunningHub audio workflows poll NewAPI task results instead of requiring synchronous URLs', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/v1/audio/generations')) {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.equal(body.model, 'rh-voice-clone')
      assert.equal(body.nodeInfoList[0].fieldValue, 'data:audio/wav;base64,aGVsbG8=')
      return Response.json({ id: 'rh_audio_001', status: 'pending' })
    }
    if (url.endsWith('/v1/audio/generations/rh_audio_001')) {
      return Response.json({ taskId: 'rh_audio_001', status: 'completed', output: { audio: { url: 'https://cdn.example.com/result.wav' } } })
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
    assert.equal(result.pollUrl, '/v1/audio/generations/rh_audio_001')
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
      assert.equal(body.size, '1024x1536')
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
      assert.equal(body.images, undefined)
      return Response.json({ id: 'grok_video_001', status: 'pending' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const video = await generateVideo({
      model: 'grok-video-3',
      prompt: 'video',
      onSubmitted: payload => submitted.push(payload),
    })
    assert.equal(video.url, '')
    assert.equal(video.taskId, 'grok_video_001')
    assert.equal(video.pollUrl, '/v1/videos/grok_video_001')
    assert.deepEqual(submitted.shift(), {
      taskId: 'grok_video_001',
      pollUrl: '/v1/videos/grok_video_001',
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
      return Response.json({ id: 'grok_image_video_001', status: 'pending' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }

  try {
    const video = await generateVideo({
      model: 'grok-video-3',
      prompt: 'image video',
      imageUrl: 'https://cdn.jiucaihezi.studio/uploaded.png',
    })
    assert.equal(video.url, '')
    assert.equal(video.taskId, 'grok_image_video_001')
    assert.equal(video.pollUrl, '/v1/videos/grok_image_video_001')
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
