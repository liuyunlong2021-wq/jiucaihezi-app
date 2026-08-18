import assert from 'node:assert/strict'
import { test } from 'node:test'

import { useProjectStore } from '@/stores/projectStore'
import * as creationMediaCache from '../creationMediaCache'
import { buildMediaFilename } from '../mediaFilename'
import { webProjectFiles } from '../webProjectFiles'
import { __resetApiKeyMemoryCacheForTests } from '@/services/newApiClient'

test('creation media filenames use a cleaned semantic prompt and six task characters', () => {
  assert.equal(
    buildMediaFilename({
      summary: ' 雨后旧上海：男主下车 ',
      prompt: '生成一张完全不同的内容',
      taskId: 'canvas-task-91c8af',
      extension: 'png',
    }),
    '雨后旧上海_男主下车_91c8af.png',
  )
  assert.equal(
    buildMediaFilename({
      prompt: '请生成一张 横向16:9，根据参考图，参考图1，简要总结：雨后旧上海车站男主下车',
      taskId: 'canvas-task-91c8af',
      extension: 'png',
    }),
    '雨后旧上海车站男主下车_91c8af.png',
  )
  assert.equal(
    buildMediaFilename({ model: 'gpt-image-2-官方', taskId: 'task_123456789', extension: '.webp' }),
    'gpt-image-2-官方_456789.webp',
  )
})

test('Web creation media stays usable when active project persistence fails', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const originalAddMedia = webProjectFiles.addMedia
  projectStore.webProjectId.value = 'missing-project'
  webProjectFiles.addMedia = async () => { throw new Error('Web 项目不存在') }

  try {
    const result = await creationMediaCache.cacheCreationMediaResult({
      url: 'https://example.com/result.png',
      type: 'image',
      prompt: '测试图片',
      taskId: 'task-1',
    })

    assert.equal(result?.ref, 'https://example.com/result.png')
    assert.equal(result?.file.content, '')
    assert.equal(result?.file.metadata?.originalUrl, 'https://example.com/result.png')
  } finally {
    projectStore.webProjectId.value = originalProjectId
    webProjectFiles.addMedia = originalAddMedia
  }
})

test('Web creation media helpers preserve response MIME when building a deterministic project path', { concurrency: false }, async () => {
  const previousFetch = globalThis.fetch
  const fetchCreationMediaBlob = (creationMediaCache as Record<string, unknown>).fetchCreationMediaBlob
  const webCreationMediaProjectPath = (creationMediaCache as Record<string, unknown>).webCreationMediaProjectPath

  globalThis.fetch = async (input: RequestInfo | URL) => {
    assert.equal(String(input), 'https://webstatic.aiproxy.vip/output/content-type.webp')
    return new Response(new Blob(['webp-body'], { type: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'image/webp; charset=binary' },
    })
  }

  try {
    assert.equal(typeof fetchCreationMediaBlob, 'function')
    assert.equal(typeof webCreationMediaProjectPath, 'function')
    if (typeof fetchCreationMediaBlob !== 'function' || typeof webCreationMediaProjectPath !== 'function') return

    const result = await (fetchCreationMediaBlob as (url: string, type: 'image' | 'video' | 'audio') => Promise<{ blob: Blob; mimeType: string }>)(
      'https://webstatic.aiproxy.vip/output/content-type.webp',
      'image',
    )
    const path = (webCreationMediaProjectPath as (params: {
      type: 'image' | 'video' | 'audio'
      prompt?: string
      model?: string
      taskId?: string
      mimeType?: string
    }) => string)({
      type: 'image', prompt: '内容类型/优先', taskId: 'mtask_webp', mimeType: result.mimeType,
    })

    assert.equal(result.mimeType, 'image/webp')
    assert.equal(result.blob.type, 'image/webp')
    assert.equal(path, 'jc-media/images/内容类型_优先_skwebp.webp')
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('Web creation media accepts large trusted data URLs only when explicitly allowed', { concurrency: false }, async () => {
  const previousFetch = globalThis.fetch
  const dataUrl = `data:image/png;base64,${'A'.repeat(12 * 1024 * 1024)}`
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 })
  }

  try {
    await assert.rejects(() => creationMediaCache.fetchCreationMediaBlob(dataUrl, 'image'), /媒体地址不安全/)
    const result = await creationMediaCache.fetchCreationMediaBlob(dataUrl, 'image', true)
    assert.equal(result.mimeType, 'image/png')
    assert.equal(calls, 1)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('3D creation results keep their model file extension in the project', () => {
  const path = creationMediaCache.webCreationMediaProjectPath({
    type: 'model3d',
    prompt: '角色模型',
    taskId: 'mtask_3d',
    mimeType: 'application/octet-stream',
    sourceUrl: 'https://example.com/output/character.glb?token=short-lived',
  })

  assert.equal(path, 'jc-media/models/角色模型_task3d.glb')
})

test('Web media download authenticates only Jiucaihezi API result URLs', { concurrency: false }, async () => {
  const previousFetch = globalThis.fetch
  const calls: Array<{ url: string; authorization?: string }> = []
  __resetApiKeyMemoryCacheForTests('media-token')
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({ url: String(input), authorization: headers.get('authorization') || undefined })
    return new Response(new Blob(['video'], { type: 'video/mp4' }), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    })
  }

  try {
    await creationMediaCache.fetchCreationMediaBlob(
      'https://api.jiucaihezi.studio/v1/videos/task_veo/content',
      'video',
    )
    await creationMediaCache.fetchCreationMediaBlob(
      'https://tian-shu.net/v1/videos/task_omni/content',
      'video',
    )
    await creationMediaCache.fetchCreationMediaBlob('https://cdn.example.com/video.mp4', 'video')
    assert.deepEqual(calls, [
      { url: 'https://api.jiucaihezi.studio/v1/videos/task_veo/content', authorization: 'Bearer media-token' },
      { url: 'https://tian-shu.net/v1/videos/task_omni/content', authorization: 'Bearer media-token' },
      { url: 'https://cdn.example.com/video.mp4', authorization: undefined },
    ])
  } finally {
    __resetApiKeyMemoryCacheForTests()
    globalThis.fetch = previousFetch
  }
})

test('Desktop media download headers authenticate only Jiucaihezi API result URLs', () => {
  __resetApiKeyMemoryCacheForTests('desktop-media-token')
  try {
    assert.deepEqual(
      creationMediaCache.creationResultRequestHeaders(
        'https://api.jiucaihezi.studio/v1/videos/task_veo/content',
      ),
      { Authorization: 'Bearer desktop-media-token' },
    )
    assert.equal(
      creationMediaCache.creationResultRequestHeaders('https://cdn.example.com/video.mp4'),
      undefined,
    )
    assert.deepEqual(
      creationMediaCache.creationResultRequestHeaders(
        'https://tian-shu.net/v1/videos/task_omni/content',
      ),
      { Authorization: 'Bearer desktop-media-token' },
    )
  } finally {
    __resetApiKeyMemoryCacheForTests()
  }
})
