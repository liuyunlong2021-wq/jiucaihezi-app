import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { initDB } from '../../utils/idb'
import { useSessionStore } from '../sessionStore'
import { useOpenCodeSyncStore } from '../openCodeSyncStore'
import type { ChatMessage } from '../../composables/useChat'

function installWebStorage() {
  const store = new Map<string, string>()
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
  return {
    id,
    role,
    content,
    createdAt: Date.now(),
  }
}

test('web session history persists, restores, switches, and deletes direct sessions', async () => {
  const storage = installWebStorage()
  try {
    await initDB()
    setActivePinia(createPinia())
    const store = useSessionStore()
    const sessionId = store.startNewSession('Web 第一轮')
    const messages = [
      message('user_1', 'user', 'Web 第一轮'),
      message('assistant_1', 'assistant', '第一轮回复'),
    ]

    await store.saveSession(sessionId, '', messages)
    assert.equal(store.sessions.some(session => session.id === sessionId), true)
    await store.linkOpenCodeSession(sessionId, 'ses_open_code_1')
    assert.equal(store.sessions.find(session => session.id === sessionId)?.openCodeSessionId, 'ses_open_code_1')
    assert.equal(storage.get('jc_active_session'), sessionId)

    setActivePinia(createPinia())
    const restoredStore = useSessionStore()
    await restoredStore.loadAllSessions()
    assert.equal(restoredStore.sessions.some(session => session.id === sessionId), true)
    assert.deepEqual(
      (await restoredStore.loadSessionMessages(sessionId)).map(item => item.content),
      ['Web 第一轮', '第一轮回复'],
    )

    const secondSessionId = restoredStore.startNewSession('Web 第二轮')
    restoredStore.switchSession(sessionId)
    assert.equal(restoredStore.activeSessionId, sessionId)
    assert.equal(storage.get('jc_active_session'), sessionId)
    restoredStore.switchSession('')
    assert.equal(restoredStore.activeSessionId, '')
    assert.equal(storage.get('jc_active_session'), null)
    restoredStore.switchSession(sessionId)

    await restoredStore.deleteSession(sessionId)
    assert.equal(restoredStore.activeSessionId, '')
    assert.equal(storage.get('jc_active_session'), null)
    assert.deepEqual(await restoredStore.loadSessionMessages(sessionId), [])
    assert.equal(restoredStore.sessions.some(session => session.id === secondSessionId), false)
  } finally {
    storage.restore()
  }
})

test('desktop session deletion delegates to OpenCode and does not touch IndexedDB history', { concurrency: false }, async () => {
  const storage = installWebStorage()
  ;(globalThis as any).window = { __TAURI_INTERNALS__: {} }
  try {
    setActivePinia(createPinia())
    const store = useSessionStore()
    const syncStore = useOpenCodeSyncStore()
    let deleted = 0
    syncStore.registerClient('/project', { session: {
      delete: async () => {
        deleted++
        return { data: true }
      },
    } } as any)
    syncStore.applyServerEvent({ directory: '/project', payload: { type: 'session.created', properties: { info: {
      id: 'ses_desktop', directory: '/project', time: { created: 1, updated: 1 },
    } } } as any })
    store.setCurrentProjectDir('/project')
    store.switchSession('ses_desktop')

    await store.deleteSession('ses_desktop')

    assert.equal(deleted, 1)
    assert.equal(store.activeSessionId, '')
    assert.equal(syncStore.activeSessionId, '')
  } finally {
    storage.restore()
  }
})
