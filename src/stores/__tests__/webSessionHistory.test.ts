import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { initDB } from '../../utils/idb'
import { useSessionStore } from '../sessionStore'
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
