import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, watch } from 'vue'

import { useChat } from '../useChat'

test('clearMessages resets chat state without inserting a local context boundary marker', async () => {
  setActivePinia(createPinia())
  const chat = useChat()

  chat.loadMessages([
    { id: 'user_1', role: 'user', content: '旧问题', timestamp: 1 },
    { id: 'assistant_1', role: 'assistant', content: '旧回答', timestamp: 2 },
  ])

  await chat.clearMessages()

  assert.equal(chat.messages.value.length, 0)
  assert.equal('clearContextBoundary' in chat, false)
  assert.equal(chat.messages.value.some(message => String(message.content || '').includes('[上下文已清除]')), false)
})

test('permission reply failures keep the request path explicit with a visible notice', async () => {
  setActivePinia(createPinia())
  const chat = useChat()

  chat.loadMessages([], { openCodeSessionId: 'session_requires_desktop' } as any)

  await chat.respondPermission('permission_1', 'once')

  assert.match(chat.sessionCommandNotice.value, /OpenCode 权限回复失败/)
})

test('active OpenCode session id is a reactive chat control state', async () => {
  setActivePinia(createPinia())
  const chat = useChat()
  const observed: string[] = []
  const stop = watch(chat.activeOpenCodeSessionId, value => observed.push(value))

  try {
    chat.loadMessages([], { openCodeSessionId: 'session_reactive_1' } as any)
    await nextTick()
    assert.equal(chat.activeOpenCodeSessionId.value, 'session_reactive_1')
    assert.deepEqual(observed, ['session_reactive_1'])

    await chat.clearMessages()
    await nextTick()
    assert.equal(chat.activeOpenCodeSessionId.value, '')
    assert.deepEqual(observed, ['session_reactive_1', ''])
  } finally {
    stop()
  }
})

test('compact session action is rejected locally when no OpenCode context is active', async () => {
  setActivePinia(createPinia())
  const chat = useChat()
  chat.loadMessages([
    { id: 'user_local_1', role: 'user', content: '需要压缩吗', timestamp: 1 },
  ])

  const result = await chat.runOpenCodeSessionAction('compact')

  assert.equal(result.ok, false)
  assert.match(result.error || '', /当前没有可压缩的 OpenCode 上下文/)
  assert.match(chat.sessionCommandNotice.value, /当前没有可压缩的 OpenCode 上下文/)
  assert.equal(chat.activeOpenCodeSessionId.value, '')
})

test('compact session action is rejected locally when active OpenCode session has no user-visible messages', async () => {
  setActivePinia(createPinia())
  const chat = useChat()
  chat.loadMessages([
    { id: 'system_only_1', role: 'system', content: 'internal state', timestamp: 1 },
  ], { openCodeSessionId: 'session_system_only' } as any)

  const result = await chat.runOpenCodeSessionAction('compact')

  assert.equal(result.ok, false)
  assert.match(result.error || '', /当前没有可压缩的 OpenCode 上下文/)
  assert.match(chat.sessionCommandNotice.value, /当前没有可压缩的 OpenCode 上下文/)
  assert.equal(chat.activeOpenCodeSessionId.value, 'session_system_only')
})
