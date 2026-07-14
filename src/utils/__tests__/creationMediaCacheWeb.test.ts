import assert from 'node:assert/strict'
import { test } from 'node:test'

import { useProjectStore } from '@/stores/projectStore'
import { cacheCreationMediaResult } from '../creationMediaCache'
import { webProjectFiles } from '../webProjectFiles'

test('Web creation media stays usable when active project persistence fails', { concurrency: false }, async () => {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const originalAddMedia = webProjectFiles.addMedia
  projectStore.webProjectId.value = 'missing-project'
  webProjectFiles.addMedia = async () => { throw new Error('Web 项目不存在') }

  try {
    const result = await cacheCreationMediaResult({
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
