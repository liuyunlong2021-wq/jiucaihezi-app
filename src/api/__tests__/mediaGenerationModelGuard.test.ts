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
  assert.throws(() => assertMediaModelExecutable('veo3.1-fast', 'video'), /不可用|重新选择/)
  assert.throws(() => assertMediaModelExecutable('seedance-2-0', 'video'), /不可用|重新选择/)
  assert.throws(() => assertMediaModelExecutable('seedance-2-0-pro', 'video'), /不可用|重新选择/)
  assert.throws(() => assertMediaModelExecutable('rh-mimic', 'video'), /不可用|重新选择/)
  assert.throws(() => assertMediaModelExecutable('rh-digital-human-fast', 'video'), /不可用|重新选择/)
  assert.throws(() => assertMediaModelExecutable('rh-digital-human', 'video'), /不可用|重新选择/)
  assert.doesNotThrow(() => assertMediaModelExecutable('suno_music', 'audio'))
  assert.throws(() => assertMediaModelExecutable('rh-voice-clone', 'audio'), /不可用|重新选择/)
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

test('disabled RunningHub audio workflows are rejected before network execution', async () => {
  const restoreStorage = await installGatewaySession()
  const previousFetch = globalThis.fetch
  let fetchCount = 0
  
  globalThis.fetch = async () => {
    fetchCount += 1
    return Response.json({ id: 'unexpected' })
  }

  try {
    await assert.rejects(
      () => generateAudio({
        model: 'rh-voice-clone',
        prompt: '',
        audioUrl: 'data:audio/wav;base64,aGVsbG8=',
        refText: '参考文字',
        text: '输出文字',
        language: '中文',
      }),
      /不可用|重新选择/,
    )
    assert.equal(fetchCount, 0)
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
      assert.equal(body.model, 'grok-video-3')
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
      assert.equal(body.model, 'grok-video-3')
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
