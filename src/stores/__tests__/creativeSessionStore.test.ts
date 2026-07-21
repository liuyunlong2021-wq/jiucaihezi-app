import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { initDB } from '../../utils/idb'
import { getRecord } from '../../utils/idb'
import { useChatModeStore } from '../chatModeStore'
import { useCreativeSessionStore } from '../creativeSessionStore'
import { useProjectStore } from '../projectStore'
import type { ChatMessage } from '../../composables/useChat'

function installWebStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const previousLocalStorage = (globalThis as any).localStorage
  const previousWindow = (globalThis as any).window
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
  ;(globalThis as any).window = {}
  return {
    restore() {
      ;(globalThis as any).localStorage = previousLocalStorage
      ;(globalThis as any).window = previousWindow
    },
    get(key: string) {
      return store.get(key) ?? null
    },
  }
}

function message(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return { id, role, content, createdAt: Date.now() }
}

test('chat mode preserves creative and migrates legacy direct to plan', () => {
  const storage = installWebStorage({ jc_agent_mode: 'direct' })
  try {
    setActivePinia(createPinia())
    const legacyStore = useChatModeStore()
    assert.equal(legacyStore.mode, 'plan')

    legacyStore.setMode('creative')
    assert.equal(storage.get('jc_agent_mode'), 'creative')

    setActivePinia(createPinia())
    assert.equal(useChatModeStore().mode, 'creative')
  } finally {
    storage.restore()
  }
})

test('chat mode preserves the existing build default when storage has no valid mode', () => {
  const storage = installWebStorage({ jc_agent_mode: 'unexpected' })
  try {
    setActivePinia(createPinia())
    assert.equal(useChatModeStore().mode, 'build')
  } finally {
    storage.restore()
  }
})

test('chat mode stays usable when the runtime does not expose the Storage API', () => {
  const previousLocalStorage = (globalThis as any).localStorage
  ;(globalThis as any).localStorage = {}
  try {
    setActivePinia(createPinia())
    const chatModeStore = useChatModeStore()

    assert.equal(chatModeStore.mode, 'build')
    chatModeStore.setMode('creative')
    assert.equal(chatModeStore.mode, 'creative')
  } finally {
    ;(globalThis as any).localStorage = previousLocalStorage
  }
})

test('creative sessions stay project-scoped and never create OpenCode session ids', async () => {
  const storage = installWebStorage()
  try {
    await initDB()
    setActivePinia(createPinia())
    const projectStore = useProjectStore()
    const creativeStore = useCreativeSessionStore()
    projectStore.selectWebProject({ id: 'project-a', name: '项目 A' })

    const sessionId = creativeStore.startNewSession()
    await creativeStore.saveSession(sessionId, [
      message('user_1', 'user', '写入 Wiki'),
      message('assistant_1', 'assistant', '已写入'),
    ])

    assert.equal(sessionId.startsWith('ses_'), false)
    assert.equal(creativeStore.projectSessions.length, 1)
    assert.equal(creativeStore.projectSessions[0]?.projectId, 'project-a')
    assert.equal((await getRecord('conversations', sessionId) as any)?.scopeKey, 'creative')
    assert.equal(storage.get('jc_creative_active_session:project-a'), sessionId)

    projectStore.selectWebProject({ id: 'project-b', name: '项目 B' })
    assert.equal(creativeStore.projectSessions.length, 0)
    assert.equal(creativeStore.activeSessionId, '')
  } finally {
    storage.restore()
  }
})

test('creative session keeps its original project when a later save races with project switching', async () => {
  const storage = installWebStorage()
  try {
    await initDB()
    setActivePinia(createPinia())
    const projectStore = useProjectStore()
    const creativeStore = useCreativeSessionStore()
    projectStore.selectWebProject({ id: 'project-a', name: '项目 A' })

    const sessionId = creativeStore.startNewSession()
    projectStore.selectWebProject({ id: 'project-b', name: '项目 B' })
    await creativeStore.saveSession(sessionId, [
      message('user_a', 'user', '项目 A 的对话'),
      message('assistant_a', 'assistant', '项目 A 的回复'),
    ])

    assert.equal((await getRecord('conversations', sessionId) as any)?.projectId, 'project-a')
  } finally {
    storage.restore()
  }
})

test('unactivated creative session keeps its creation project when saved after a project switch', async () => {
  const storage = installWebStorage()
  try {
    await initDB()
    setActivePinia(createPinia())
    const projectStore = useProjectStore()
    const creativeStore = useCreativeSessionStore()
    projectStore.selectWebProject({ id: 'project-pending-a', name: '项目 A' })

    const sessionId = creativeStore.createPendingSession()
    projectStore.selectWebProject({ id: 'project-pending-b', name: '项目 B' })
    await creativeStore.saveSession(sessionId, [
      message('user_pending', 'user', '项目 A 的新会话'),
      message('assistant_pending', 'assistant', '已保存'),
    ])

    assert.equal((await getRecord('conversations', sessionId) as any)?.projectId, 'project-pending-a')
  } finally {
    storage.restore()
  }
})

test('creative session persistence strips transient media bytes but keeps attachment metadata', async () => {
  const storage = installWebStorage()
  try {
    await initDB()
    setActivePinia(createPinia())
    const projectStore = useProjectStore()
    const creativeStore = useCreativeSessionStore()
    projectStore.selectWebProject({ id: 'project-media', name: '媒体项目' })
    const sessionId = creativeStore.startNewSession()
    await creativeStore.saveSession(sessionId, [{
      id: 'user_media',
      role: 'user',
      content: '分析图片',
      timestamp: Date.now(),
      images: ['data:image/png;base64,AAA', 'blob:temporary', 'https://example.com/image.png'],
      attachments: [{
        id: 'asset-1',
        name: 'image.png',
        mime: 'image/png',
        size: 3,
        kind: 'image',
        source: 'upload',
      }],
    }])

    const stored = await getRecord('messages', sessionId) as any
    assert.deepEqual(stored.items[0].images, ['https://example.com/image.png'])
    assert.equal(stored.items[0].attachments[0].name, 'image.png')
    assert.equal(JSON.stringify(stored).includes('base64,AAA'), false)
  } finally {
    storage.restore()
  }
})

test('creative session persistence strips transient bytes nested inside media plans', async () => {
  const storage = installWebStorage()
  try {
    await initDB()
    setActivePinia(createPinia())
    const projectStore = useProjectStore()
    const creativeStore = useCreativeSessionStore()
    projectStore.selectWebProject({ id: 'project-media-plan', name: '媒体计划项目' })
    const sessionId = creativeStore.startNewSession()
    await creativeStore.saveSession(sessionId, [{
      id: 'assistant_media_plan',
      role: 'assistant',
      content: '媒体计划',
      timestamp: Date.now(),
      mediaPlan: {
        kind: 'video',
        title: '测试计划',
        prompt: '生成视频',
        modelId: 'runninghub/api/rh-seedance2',
        referenceImages: ['data:image/png;base64,IMAGE', 'https://example.com/image.png'],
        referenceVideos: ['blob:temporary-video', 'https://example.com/video.mp4'],
        mediaReferences: [{
          id: 'ref-upload',
          kind: 'image',
          source: 'attachment',
          label: 'upload.png',
          value: 'data:image/png;base64,NESTED',
          explicit: true,
          locator: { type: 'attachment', messageId: 'user_media', index: 0 },
        }],
      },
    }])

    const stored = await getRecord('messages', sessionId) as any
    const plan = stored.items[0].mediaPlan
    assert.deepEqual(plan.referenceImages, ['https://example.com/image.png'])
    assert.deepEqual(plan.referenceVideos, ['https://example.com/video.mp4'])
    assert.equal('value' in plan.mediaReferences[0], false)
    assert.equal(plan.mediaReferences[0].id, 'ref-upload')
    assert.equal(plan.mediaReferences[0].locator.messageId, 'user_media')
    assert.equal(JSON.stringify(stored).includes('base64,'), false)
    assert.equal(JSON.stringify(stored).includes('blob:'), false)
  } finally {
    storage.restore()
  }
})
