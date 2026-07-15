import assert from 'node:assert/strict'
import { test } from 'node:test'

import { useProjectStore } from '@/stores/projectStore'
import * as creationMediaCache from '../creationMediaCache'
import { webProjectFiles } from '../webProjectFiles'

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
    assert.match(path, /^jc-media\/images\/.+_mtask_webp\.webp$/)
  } finally {
    globalThis.fetch = previousFetch
  }
})
