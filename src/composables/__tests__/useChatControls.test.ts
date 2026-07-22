import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, watch } from 'vue'

import { useChat } from '../useChat'
import { useOpenCodeSyncStore } from '@/stores/openCodeSyncStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useAgentStore } from '@/stores/agentStore'
import { initDB } from '@/utils/idb'
import { __resetApiKeyMemoryCacheForTests } from '@/services/newApiClient'
import { buildCreativeContext } from '@/runtime/direct/creativeMemory'

function installWebChatStorage() {
  const values = new Map([['jcApiKey', 'sk-web-save-test-12345678901234567890']])
  const previousWindow = (globalThis as any).window
  const previousStorage = (globalThis as any).localStorage
  ;(globalThis as any).window = {}
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
  __resetApiKeyMemoryCacheForTests(values.get('jcApiKey') || '')
  return () => {
    __resetApiKeyMemoryCacheForTests('')
    ;(globalThis as any).window = previousWindow
    ;(globalThis as any).localStorage = previousStorage
  }
}

function installWebTextModel() {
  const agentStore = useAgentStore()
  agentStore.availableModels = [{
    id: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra',
    providerId: 'jiucaihezi',
    capability: 'text',
  }]
  agentStore.currentModel = 'gpt-5.6-terra'
}

test('OpenCode empty sync snapshots preserve already visible messages', () => {
  const source = readFileSync('src/composables/useChat.ts', 'utf8')
  const projection = source.slice(
    source.indexOf('() => [openCodeSyncStore.activeSessionId'),
    source.indexOf("watch(() => openCodeSyncStore.activePermissions"),
  )
  assert.match(projection, /replaceMessagesPreservingPrompt\(/)
  assert.doesNotMatch(projection, /messages\.value = \[\s*\.\.\.\(sessionID \? projected/)
})

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

  assert.match(chat.sessionCommandNotice.value, /韭菜盒子权限回复失败/)
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
  assert.match(result.error || '', /当前没有可压缩的上下文/)
  assert.match(chat.sessionCommandNotice.value, /当前没有可压缩的上下文/)
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
  assert.match(result.error || '', /当前没有可压缩的上下文/)
  assert.match(chat.sessionCommandNotice.value, /当前没有可压缩的上下文/)
  assert.equal(chat.activeOpenCodeSessionId.value, 'session_system_only')
})

test('Desktop delete action delegates to the Sync Store exactly once', async () => {
  setActivePinia(createPinia())
  const syncStore = useOpenCodeSyncStore()
  let deletes = 0
  syncStore.registerClient('/project', { session: {
    delete: async () => {
      deletes++
      return { data: true }
    },
  } } as any)
  syncStore.applyServerEvent({ directory: '/project', payload: { type: 'session.created', properties: { info: {
    id: 'ses_delete_once', directory: '/project', time: { created: 1, updated: 1 },
  } } } as any })
  syncStore.setActiveDirectory('/project')
  syncStore.setActiveSession('ses_delete_once')
  const chat = useChat()
  chat.loadMessages([
    { id: 'msg_delete_once', role: 'user', content: '删除我', timestamp: 1 },
  ], { openCodeSessionId: 'ses_delete_once' } as any)

  const result = await chat.runOpenCodeSessionAction('delete')

  assert.equal(result.ok, true)
  assert.equal(deletes, 1)
  assert.equal(syncStore.activeSessionId, '')
})

test('desktop local model enters OpenCode plan/build mode instead of direct engine', () => {
  const source = readFileSync(join(process.cwd(), 'src/composables/useChat.ts'), 'utf8')
  // ponytail: direct 已删除（SDD app-opencode-only），本地模型统一走 OpenCode 文/武
  assert.doesNotMatch(source, /sendDirectLocalModelMessage/)
  assert.doesNotMatch(source, /'direct'/)
  assert.match(source, /setPhase\('sending', '韭菜盒子正在连接'\)/)
})

test('Desktop projects the user message before awaiting OpenCode connection', () => {
  const source = readFileSync(join(process.cwd(), 'src/composables/useChat.ts'), 'utf8')
  const desktopSend = source.slice(source.indexOf('async function sendMessage'), source.indexOf('function stopStream'))
  const optimistic = desktopSend.indexOf('pendingDesktopMessages.value.push')
  const connect = desktopSend.indexOf('await openCodeSyncStore.ensureConnected')

  assert.ok(optimistic >= 0)
  assert.ok(connect > optimistic)
  assert.match(desktopSend, /messageID:\s*desktopMessageID/)
})

test('Desktop plan/build follows the official prompt contract without deprecated tools overrides', () => {
  const source = readFileSync(join(process.cwd(), 'src/composables/useChat.ts'), 'utf8')
  const desktopSend = source.slice(source.indexOf('async function sendMessage'), source.indexOf('function stopStream'))

  assert.match(desktopSend, /\n\s+agent,\n/)
  assert.doesNotMatch(desktopSend, /openCodeTools/)
  assert.doesNotMatch(desktopSend, /tools:/)
})

// ponytail: desktop direct cloud test removed (SDD app-opencode-only)

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
  const webCloud = readFileSync(join(process.cwd(), 'src/composables/web/chatCloud.ts'), 'utf8')

  assert.match(webCloud, /currentMessages\.push\(webAssistantMsg\)/)
  assert.match(webCloud, /webAssistantMsg = currentMessages\[currentMessages\.length - 1\]/)
})

test('Web HTTP failure persists its final assistant state and keeps earlier complete turns after reload', { concurrency: false }, async () => {
  const restoreStorage = installWebChatStorage()
  const previousFetch = globalThis.fetch
  try {
    await initDB()
    setActivePinia(createPinia())
    installWebTextModel()
    const sessionStore = useSessionStore()
    const sessionId = sessionStore.startNewSession('正常问题')
    const normalMessages = [
      { id: 'u-normal', role: 'user' as const, content: '正常问题', timestamp: 1 },
      { id: 'a-normal', role: 'assistant' as const, content: '正常回答', finishReason: 'stop', timestamp: 2 },
    ]
    await sessionStore.saveSession(sessionId, '', normalMessages)
    const chat = useChat()
    chat.loadMessages(normalMessages)
    globalThis.fetch = async input => String(input).includes('/skills/index.json')
      ? new Response('[]', { headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ error: { message: 'upstream rejected' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })

    await assert.rejects(
      () => chat.sendMessage('失败附件问题', {
        sessionId,
        modelId: 'gpt-5.6-terra',
        modelProviderId: 'jiucaihezi',
      }),
      /API 500.*upstream rejected/,
    )

    setActivePinia(createPinia())
    const restored = await useSessionStore().loadSessionMessages(sessionId)
    assert.equal(restored.at(-1)?.finishReason, 'web_cloud_http_error')
    const context = buildCreativeContext({
      messages: [...restored, { id: 'u-next', role: 'user', content: '下一轮纯文字' }],
      modelId: 'gpt-5.6-terra',
      contextWindow: 10_000,
      reservedTokens: 1_000,
    })
    assert.deepEqual(context.messages.map(message => message.id), ['u-normal', 'a-normal', 'u-next'])
  } finally {
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('Web abort persists the final abort assistant state', { concurrency: false }, async () => {
  const restoreStorage = installWebChatStorage()
  const previousFetch = globalThis.fetch
  try {
    await initDB()
    setActivePinia(createPinia())
    installWebTextModel()
    const sessionStore = useSessionStore()
    const sessionId = sessionStore.startNewSession('取消问题')
    const chat = useChat()
    let markCompletionStarted!: () => void
    const completionStarted = new Promise<void>(resolve => { markCompletionStarted = resolve })
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('/skills/index.json')) return new Response('[]', { headers: { 'content-type': 'application/json' } })
      markCompletionStarted()
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    }

    const sending = chat.sendMessage('等待后取消', {
      sessionId,
      modelId: 'gpt-5.6-terra',
      modelProviderId: 'jiucaihezi',
    })
    await completionStarted
    chat.stopStream()
    await assert.rejects(() => sending, /Aborted/)

    setActivePinia(createPinia())
    const restored = await useSessionStore().loadSessionMessages(sessionId)
    assert.equal(restored.at(-1)?.finishReason, 'abort')
  } finally {
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('Web success saves once and snapshot failure does not replace the original HTTP error', { concurrency: false }, async () => {
  const restoreStorage = installWebChatStorage()
  const previousFetch = globalThis.fetch
  try {
    await initDB()
    setActivePinia(createPinia())
    installWebTextModel()
    const sessionStore = useSessionStore()
    const sessionId = sessionStore.startNewSession('保存次数')
    let saves = 0
    const originalSave = sessionStore.saveSession.bind(sessionStore)
    sessionStore.saveSession = async (...args) => {
      saves += 1
      return await originalSave(...args)
    }
    globalThis.fetch = async input => String(input).includes('/skills/index.json')
      ? new Response('[]', { headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ choices: [{ message: { content: '成功回答' }, finish_reason: 'stop' }] }), {
          headers: { 'content-type': 'application/json' },
        })
    await useChat().sendMessage('成功问题', { sessionId, modelId: 'gpt-5.6-terra', modelProviderId: 'jiucaihezi' })
    assert.equal(saves, 1)

    sessionStore.saveSession = async () => { throw new Error('snapshot failed') }
    sessionStore.saveSessionPreview = async () => { throw new Error('preview failed') }
    globalThis.fetch = async input => String(input).includes('/skills/index.json')
      ? new Response('[]', { headers: { 'content-type': 'application/json' } })
      : new Response(JSON.stringify({ error: { message: 'original upstream failure' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
    await assert.rejects(
      () => useChat().sendMessage('失败但保存也失败', { sessionId, modelId: 'gpt-5.6-terra', modelProviderId: 'jiucaihezi' }),
      /API 500.*original upstream failure/,
    )
  } finally {
    globalThis.fetch = previousFetch
    restoreStorage()
  }
})

test('Desktop projection clears visible messages when the Sync Store active session is cleared', async () => {
  const runtime = globalThis as any
  const previousWindow = runtime.window
  runtime.window = { ...(previousWindow || {}), isTauri: true }
  try {
    setActivePinia(createPinia())
    const store = useOpenCodeSyncStore()
    const chat = useChat()
    store.setActiveDirectory('/project')
    store.setActiveSession('ses_1')
    store.state.messages.ses_1 = [{
      id: 'msg_1', sessionID: 'ses_1', role: 'user', time: { created: 1 },
      agent: 'plan', model: { providerID: 'jiucaihezi', modelID: 'model' },
    } as any]
    store.state.parts.msg_1 = [{
      id: 'part_1', sessionID: 'ses_1', messageID: 'msg_1', type: 'text', text: '旧消息',
    } as any]
    await nextTick()
    assert.equal(chat.messages.value.length, 1)

    store.newDraft()
    await nextTick()

    assert.deepEqual(chat.messages.value, [])
  } finally {
    runtime.window = previousWindow
  }
})
