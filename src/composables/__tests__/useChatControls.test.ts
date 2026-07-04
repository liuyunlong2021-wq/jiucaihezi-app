import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

test('desktop local model uses OpenCode in plan/build mode and direct engine only in direct chat', () => {
  const source = readFileSync(join(process.cwd(), 'src/composables/useChat.ts'), 'utf8')
  const localBranchStart = source.indexOf("if (isLocalModelProviderId(selectedProviderId) && options.chatMode !== 'build' && options.chatMode !== 'plan')")
  const openCodeBranchStart = source.indexOf("setPhase('thinking', '正在连接 OpenCode')")

  assert.ok(localBranchStart > -1)
  assert.ok(openCodeBranchStart > localBranchStart)
  assert.equal(source.includes('sendDirectLocalModelMessage(options, runId, controller)'), true)
  assert.equal(source.includes('/api/chat'), true)
  assert.equal(source.includes('readOllamaChatStream'), true)
})

test('desktop direct cloud mode sends through shared direct engine before OpenCode runtime', () => {
  const source = readFileSync(join(process.cwd(), 'src/composables/useChat.ts'), 'utf8')
  const directBranchStart = source.indexOf("if (options.chatMode === 'direct')")
  const openCodeBranchStart = source.indexOf("setPhase('thinking', '正在连接 OpenCode')")

  assert.ok(directBranchStart > -1)
  assert.ok(openCodeBranchStart > directBranchStart)
  assert.equal(source.includes('sendDesktopDirectCloudMessage(options, runId, controller)'), true)
  assert.equal(source.includes('runDirectChatCompletion({'), true)
})

test('web cloud send reuses caller session id instead of switching sessions mid-stream', () => {
  const source = readFileSync(join(process.cwd(), 'src/composables/useChat.ts'), 'utf8')
  const webBranch = source.slice(
    source.indexOf('if (!isTauriRuntime()) {'),
    source.indexOf('const agentStore = useAgentStore()', source.indexOf('if (!isTauriRuntime()) {')),
  )

  assert.match(webBranch, /sessionId\s*=\s*String\(options\.sessionId \|\| ''\)\.trim\(\) \|\| ensureCloudConversation\(text\)/)
  assert.doesNotMatch(webBranch, /sessionId\s*=\s*ensureCloudConversation\(text\)/)
})

test('web cloud stream mutates the reactive assistant message stored in messages', () => {
  const source = readFileSync(join(process.cwd(), 'src/composables/useChat.ts'), 'utf8')
  const webBranch = source.slice(
    source.indexOf('if (!isTauriRuntime()) {'),
    source.indexOf('const agentStore = useAgentStore()', source.indexOf('if (!isTauriRuntime()) {')),
  )

  assert.match(webBranch, /messages\.value\.push\(assistantMsg\)\s+const webAssistantMsg = messages\.value\[messages\.value\.length - 1\]/)
  assert.match(webBranch, /sendWebCloudMessage\(options, runId, controller, webAssistantMsg, setPhase, activeRunId, messages\.value\)/)
  assert.doesNotMatch(webBranch, /sendWebCloudMessage\(options, runId, controller, assistantMsg/)
})
