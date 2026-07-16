import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { useOpenCodeSyncStore } from '../openCodeSyncStore'

test('sync store applies global bridge envelopes without filtering inactive sessions', () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()

  store.applyServerEvent({
    directory: '/project',
    payload: {
      id: 'message.updated:1',
      type: 'message.updated',
      properties: {
        sessionID: 'ses_background',
        info: {
          id: 'msg_background',
          sessionID: 'ses_background',
          role: 'user',
          time: { created: 1 },
          agent: 'plan',
          model: { providerID: 'jiucaihezi', modelID: 'model' },
        },
      },
    } as any,
  })

  assert.equal(store.state.messages.ses_background?.[0]?.id, 'msg_background')
})

test('sync store active status is derived from the active official session', () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.setActiveSession('ses_1')
  store.applyServerEvent({
    directory: '/project',
    payload: {
      id: 'session.status:1',
      type: 'session.status',
      properties: { sessionID: 'ses_1', status: { type: 'busy' } },
    } as any,
  })

  assert.equal(store.isStreaming, true)
  store.setActiveSession('ses_2')
  assert.equal(store.isStreaming, false)
})

test('ensureSession creates one official session and uses its id directly', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let creates = 0
  const created = {
    id: 'ses_created', slug: 'created', projectID: 'project_1', directory: '/project',
    title: '你好', version: '1.17.18', time: { created: 1, updated: 1 },
  }
  store.registerClient('/project', {
    session: {
      create: async () => {
        creates++
        return { data: created }
      },
    },
  } as any)

  const first = await store.ensureSession({ directory: '/project', title: '你好' })
  const second = await store.ensureSession({ directory: '/project', title: '不会再创建' })

  assert.equal(first, 'ses_created')
  assert.equal(second, 'ses_created')
  assert.equal(store.activeSessionId, 'ses_created')
  assert.equal(creates, 1)
})

test('concurrent empty-draft ensureSession calls share one in-flight create', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let creates = 0
  let deletes = 0
  let resolveCreate!: (value: unknown) => void
  const pendingCreate = new Promise(resolve => { resolveCreate = resolve })
  store.registerClient('/project', { session: {
    create: async () => {
      creates++
      return pendingCreate
    },
    delete: async () => {
      deletes++
      return { data: true }
    },
  } } as any)

  const first = store.ensureSessionWithOwnership({ directory: '/project', title: '第一条' })
  const second = store.ensureSessionWithOwnership({ directory: '/project', title: '第二条' })
  assert.equal(creates, 1)
  resolveCreate({ data: {
    id: 'ses_shared', directory: '/project', title: '第一条', time: { created: 1, updated: 1 },
  } })

  const [owner, joiner] = await Promise.all([first, second])
  assert.equal(owner.sessionID, 'ses_shared')
  assert.equal(owner.created, true)
  assert.ok(owner.cleanupToken)
  assert.deepEqual(joiner, { sessionID: 'ses_shared', created: false })
  assert.equal(await store.cleanupCreatedSessionIfExclusive('ses_shared', owner.cleanupToken!), false)
  assert.equal(deletes, 0)
  assert.equal(await store.ensureSession({ directory: '/project', title: '第三条' }), 'ses_shared')
  assert.deepEqual(await store.ensureSessionWithOwnership({ directory: '/project', title: '第四条' }), {
    sessionID: 'ses_shared', created: false,
  })
  assert.equal(store.activeSessionId, 'ses_shared')
})

test('exclusive session reservation can clean an unused created session', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let deletes = 0
  store.registerClient('/project', { session: {
    create: async () => ({ data: {
      id: 'ses_exclusive', directory: '/project', time: { created: 1, updated: 1 },
    } }),
    delete: async () => {
      deletes++
      return { data: true }
    },
  } } as any)

  const result = await store.ensureSessionWithOwnership({ directory: '/project', title: '独占' })

  assert.equal(result.created, true)
  assert.ok(result.cleanupToken)
  assert.equal(await store.cleanupCreatedSessionIfExclusive(result.sessionID, result.cleanupToken!), true)
  assert.equal(deletes, 1)
  assert.equal(store.activeSessionId, '')
})

test('active text reuse invalidates an earlier exclusive cleanup reservation', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let deletes = 0
  store.registerClient('/project', { session: {
    create: async () => ({ data: {
      id: 'ses_text_shared', directory: '/project', time: { created: 1, updated: 1 },
    } }),
    delete: async () => {
      deletes++
      return { data: true }
    },
  } } as any)
  const mediaOwner = await store.ensureSessionWithOwnership({ directory: '/project', title: '媒体' })

  assert.equal(await store.ensureSession({ directory: '/project', title: '文本加入' }), 'ses_text_shared')
  assert.equal(await store.cleanupCreatedSessionIfExclusive(mediaOwner.sessionID, mediaOwner.cleanupToken!), false)
  assert.equal(deletes, 0)
})

test('bootstrap does not overwrite a newer session event with an older response', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolveList!: (value: unknown) => void
  const pending = new Promise(resolve => { resolveList = resolve })
  store.registerClient('/project', {
    session: { list: async () => pending },
  } as any)

  const boot = store.bootstrapDirectory('/project')
  store.applyServerEvent({
    directory: '/project',
    payload: {
      id: 'session.updated:1', type: 'session.updated', properties: {
        sessionID: 'ses_1',
        info: {
          id: 'ses_1', slug: 'one', projectID: 'project_1', directory: '/project',
          title: '事件里的新标题', version: '1.17.18', time: { created: 1, updated: 2 },
        },
      },
    } as any,
  })
  resolveList({ data: [{
    id: 'ses_1', slug: 'one', projectID: 'project_1', directory: '/project',
    title: '快照里的旧标题', version: '1.17.18', time: { created: 1, updated: 1 },
  }] })
  await boot

  assert.equal(store.state.sessionInfo.ses_1?.title, '事件里的新标题')
})

test('openSession loads messages todo and diff once and reuses the cache', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let messageCalls = 0
  store.registerClient('/project', {
    session: {
      get: async () => ({ data: {
        id: 'ses_1', slug: 'one', projectID: 'project_1', directory: '/project',
        title: '会话', version: '1.17.18', time: { created: 1, updated: 1 },
      } }),
      messages: async () => {
        messageCalls++
        return { data: [{
          info: {
            id: 'msg_1', sessionID: 'ses_1', role: 'user', time: { created: 1 },
            agent: 'plan', model: { providerID: 'jiucaihezi', modelID: 'model' },
          },
          parts: [{ id: 'prt_1', sessionID: 'ses_1', messageID: 'msg_1', type: 'text', text: '你好' }],
        }] }
      },
      todo: async () => ({ data: [{ content: '创作', status: 'pending', priority: 'high' }] }),
      diff: async () => ({ data: [{ file: 'a.md', additions: 1, deletions: 0 }] }),
    },
  } as any)

  await store.openSession('/project', 'ses_1')
  await store.openSession('/project', 'ses_1')

  assert.equal(messageCalls, 1)
  assert.equal(store.state.messages.ses_1?.[0]?.id, 'msg_1')
  assert.equal((store.state.parts.msg_1?.[0] as any).text, '你好')
  assert.equal(store.state.todos.ses_1?.[0]?.content, '创作')
  assert.equal(store.state.sessionDiff.ses_1?.[0]?.file, 'a.md')
})

test('newDraft clears only the active session identity', () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.setActiveSession('ses_1')
  store.state.messages.ses_1 = [{ id: 'msg_1', sessionID: 'ses_1' } as any]

  store.newDraft()

  assert.equal(store.activeSessionId, '')
  assert.equal(store.state.messages.ses_1?.[0]?.id, 'msg_1')
})

test('deleteSession uses the registered directory client and projects the official deletion', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  const calls: any[] = []
  store.registerClient('/project', { session: {
    delete: async (input: any) => {
      calls.push(input)
      return { data: true }
    },
  } } as any)
  store.applyServerEvent({ directory: '/project', payload: { type: 'session.created', properties: { info: {
    id: 'ses_delete', directory: '/project', time: { created: 1, updated: 1 },
  } } } as any })
  store.setActiveDirectory('/project')
  store.setActiveSession('ses_delete')
  store.state.messages.ses_delete = [{ id: 'msg_delete', sessionID: 'ses_delete' } as any]

  await store.deleteSession('ses_delete')

  assert.deepEqual(calls, [{ sessionID: 'ses_delete', directory: '/project' }])
  assert.equal(store.state.sessionInfo.ses_delete, undefined)
  assert.equal(store.state.messages.ses_delete, undefined)
  assert.equal(store.activeSessionId, '')
})

test('deleteSession coalesces in-flight deletes, no-ops tombstones, and rejects unknown ids', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let deletes = 0
  let resolveDelete!: (value: unknown) => void
  const pendingDelete = new Promise(resolve => { resolveDelete = resolve })
  store.registerClient('/project', { session: {
    delete: async () => {
      deletes++
      return pendingDelete
    },
  } } as any)
  const info = { id: 'ses_coalesced', directory: '/project', time: { created: 1, updated: 1 } }
  store.applyServerEvent({ directory: '/project', payload: { type: 'session.created', properties: { info } } as any })

  const first = store.deleteSession('ses_coalesced')
  const second = store.deleteSession('ses_coalesced')
  assert.equal(deletes, 1)
  resolveDelete({ data: true })
  await Promise.all([first, second])
  await store.deleteSession('ses_coalesced')
  assert.equal(deletes, 1)
  await assert.rejects(() => store.deleteSession('ses_unknown'), /未知|不存在/)
  assert.equal(deletes, 1)
})

test('deleteSession treats an HTTP rejection as success after the official delete event', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  const info = { id: 'ses_event_won', directory: '/project', time: { created: 1, updated: 1 } }
  store.registerClient('/project', { session: {
    delete: async () => {
      store.applyServerEvent({ directory: '/project', payload: { type: 'session.deleted', properties: { info } } as any })
      throw new Error('delete response lost')
    },
  } } as any)
  store.applyServerEvent({ directory: '/project', payload: { type: 'session.created', properties: { info } } as any })
  store.setActiveDirectory('/project')
  store.setActiveSession('ses_event_won')

  await store.deleteSession('ses_event_won')

  assert.equal(store.activeSessionId, '')
  assert.equal(store.state.sessionInfo.ses_event_won, undefined)
})

test('deleted session tombstones ignore late update and create events until reconnect', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  const info = { id: 'ses_deleted_late', directory: '/project', title: '原会话', time: { created: 1, updated: 1 } }
  store.registerClient('/project', { session: {
    delete: async () => {
      store.applyServerEvent({ directory: '/project', payload: { type: 'session.deleted', properties: { info } } as any })
      store.applyServerEvent({ directory: '/project', payload: { type: 'session.updated', properties: {
        info: { ...info, title: '迟到更新', time: { created: 1, updated: 2 } },
      } } as any })
      assert.equal(store.state.sessionInfo.ses_deleted_late, undefined)
      return { data: true }
    },
  } } as any)
  store.applyServerEvent({ directory: '/project', payload: { type: 'session.created', properties: { info } } as any })

  await store.deleteSession('ses_deleted_late')
  store.applyServerEvent({ directory: '/project', payload: { type: 'session.created', properties: {
    info: { ...info, title: '迟到创建', time: { created: 1, updated: 3 } },
  } } as any })

  assert.equal(store.state.sessionInfo.ses_deleted_late, undefined)
  assert.deepEqual(store.sessionsForDirectory('/project'), [])
})

test('active projections expose existing Vue chat and dock contracts from one session', () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.setActiveSession('ses_1')
  store.state.messages.ses_1 = [{
    id: 'msg_1', sessionID: 'ses_1', role: 'user', time: { created: 1 },
    agent: 'plan', model: { providerID: 'jiucaihezi', modelID: 'model' },
  } as any]
  store.state.parts.msg_1 = [{
    id: 'prt_1', sessionID: 'ses_1', messageID: 'msg_1', type: 'text', text: '你好',
  } as any]
  store.state.permissions.ses_1 = [{ id: 'per_1', sessionID: 'ses_1' }]
  store.state.questions.ses_1 = [{ id: 'que_1', sessionID: 'ses_1' }]
  store.state.todos.ses_1 = [{ content: '创作', status: 'pending', priority: 'high' }]
  store.state.sessionDiff.ses_1 = [{ file: 'a.md', additions: 1, deletions: 0 }]

  assert.equal(store.chatMessages[0]?.content, '你好')
  assert.equal(store.activePermissions[0]?.id, 'per_1')
  assert.equal(store.activeQuestions[0]?.id, 'que_1')
  assert.equal(store.activeTodos[0]?.content, '创作')
  assert.equal(store.activeDiffs[0]?.file, 'a.md')

  store.setActiveSession('ses_2')
  assert.deepEqual(store.chatMessages, [])
  assert.deepEqual(store.activePermissions, [])
})

test('submitPrompt adds one optimistic user message and reuses its ids in promptAsync', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  const calls: any[] = []
  store.registerClient('/project', {
    session: {
      create: async () => ({ data: {
        id: 'ses_1', slug: 'one', projectID: 'project_1', directory: '/project',
        title: '你好', version: '1.17.18', time: { created: 1, updated: 1 },
      } }),
      promptAsync: async (input: unknown) => {
        calls.push(input)
        return { data: undefined }
      },
    },
  } as any)

  const result = await store.submitPrompt({
    directory: '/project',
    title: '你好',
    text: '你好',
    agent: 'plan',
    model: { providerID: 'jiucaihezi', modelID: 'model' },
    parts: [{ type: 'text', text: '你好' }],
  })

  assert.match(result.messageID, /^msg_/)
  assert.equal(store.chatMessages[0]?.content, '你好')
  assert.equal(store.isStreaming, true)
  assert.equal(calls[0].messageID, result.messageID)
  assert.equal(calls[0].parts[0].id, store.state.parts[result.messageID]?.[0]?.id)
})

test('submitPrompt reuses a caller-created message id for pre-session optimistic UI', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let submitted: any
  store.registerClient('/project', {
    session: {
      promptAsync: async (input: unknown) => { submitted = input },
    },
  } as any)
  store.setActiveDirectory('/project')
  store.applyServerEvent({ directory: '/project', payload: { type: 'session.created', properties: { info: {
    id: 'ses_1', directory: '/project', time: {},
  } } } as any })
  store.setActiveSession('ses_1')

  const result = await store.submitPrompt({
    sessionID: 'ses_1', directory: '/project', text: '你好', title: '你好', agent: 'plan',
    model: { providerID: 'local-ollama', modelID: 'qwen3.6:35b-a3b' },
    messageID: 'msg_precreated',
    tools: { '*': false },
    parts: [{ id: 'prt_precreated', type: 'text', text: '你好' }],
  })

  assert.equal(result.messageID, 'msg_precreated')
  assert.equal(submitted.messageID, 'msg_precreated')
  assert.deepEqual(submitted.tools, { '*': false })
})

test('submitPrompt rolls back its optimistic message when promptAsync fails', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.registerClient('/project', {
    session: {
      create: async () => ({ data: {
        id: 'ses_1', slug: 'one', projectID: 'project_1', directory: '/project',
        title: '失败', version: '1.17.18', time: { created: 1, updated: 1 },
      } }),
      promptAsync: async () => { throw new Error('provider failed') },
    },
  } as any)

  await assert.rejects(() => store.submitPrompt({
    directory: '/project',
    title: '失败',
    text: '失败',
    agent: 'build',
    model: { providerID: 'jiucaihezi', modelID: 'model' },
    parts: [{ type: 'text', text: '失败' }],
  }), /provider failed/)

  assert.deepEqual(store.chatMessages, [])
  assert.equal(store.isStreaming, false)
})

test('connect starts one bridge per server and routes its events into the store', () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let starts = 0
  let handler: ((event: any) => void) | undefined
  const bridge = {
    start: () => { starts++; return Promise.resolve() },
    stop: () => {},
    dispose: () => {},
    subscribe: (next: (event: any) => void) => { handler = next; return () => {} },
  }
  const handle = {
    running: true,
    url: 'http://127.0.0.1:4096',
    authorization: 'Basic token',
    directory: '/project',
  }

  store.connect(handle, { globalClient: {} as any, directoryClient: {} as any, bridge: bridge as any })
  store.connect(handle, { globalClient: {} as any, directoryClient: {} as any, bridge: bridge as any })
  handler?.({
    directory: '/project',
    payload: {
      type: 'session.status',
      properties: { sessionID: 'ses_1', status: { type: 'busy' } },
    },
  })

  assert.equal(starts, 1)
  assert.equal(store.connected, true)
  assert.equal(store.state.sessionStatus.ses_1?.type, 'busy')
})

test('server.connected reconciles active status interactions and session without starting another bridge', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let starts = 0
  let lists = 0
  let messages = 0
  let handler: ((event: any) => void) | undefined
  const client = { session: {
    list: async () => { lists++; return { data: [] } },
    status: async () => ({ data: { ses_1: { type: 'busy' } } }),
    get: async () => ({ data: { id: 'ses_1', directory: '/project', time: { created: 1, updated: 1 } } }),
    messages: async () => { messages++; return { data: [] } },
    todo: async () => ({ data: [] }),
    diff: async () => ({ data: [] }),
  }, permission: {
    list: async () => ({ data: [{ id: 'per_1', sessionID: 'ses_1' }] }),
  }, question: {
    list: async () => ({ data: [{ id: 'que_1', sessionID: 'ses_1', questions: [] }] }),
  } } as any
  const bridge = {
    start: () => { starts++; return Promise.resolve() }, dispose: () => {},
    subscribe: (next: (event: any) => void) => { handler = next; return () => {} },
  }
  const handle = { running: true, url: 'http://127.0.0.1:4096', authorization: 'Basic token', directory: '/project' }
  store.connect(handle, { globalClient: {} as any, directoryClient: client, bridge: bridge as any })
  store.setActiveSession('ses_1')
  handler?.({ directory: 'global', payload: { type: 'server.connected', properties: {} } })
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.equal(starts, 1)
  assert.equal(lists, 1)
  assert.equal(messages, 1)
  assert.equal(store.state.sessionStatus.ses_1?.type, 'busy')
  assert.equal(store.state.permissions.ses_1?.[0]?.id, 'per_1')
  assert.equal(store.state.questions.ses_1?.[0]?.id, 'que_1')
})

test('prompt failure preserves a message confirmed by server events', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.registerClient('/project', { session: {
    create: async () => ({ data: { id: 'ses_1', directory: '/project', time: { created: 1, updated: 1 } } }),
    promptAsync: async (input: any) => {
      store.applyServerEvent({ directory: '/project', payload: { type: 'message.updated', properties: {
        info: { id: input.messageID, sessionID: 'ses_1', role: 'user', time: { created: 1 }, agent: 'plan', model: {} },
      } } as any })
      throw new Error('response lost')
    },
  } } as any)

  await assert.rejects(() => store.submitPrompt({
    directory: '/project', text: 'kept', agent: 'plan', model: { providerID: 'p', modelID: 'm' },
    parts: [{ type: 'text', text: 'kept' }],
  }), /response lost/)
  assert.equal(store.state.messages.ses_1?.length, 1)
})

test('prompt failure preserves confirmed parts and removes only unconfirmed parts', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.registerClient('/project', { session: {
    create: async () => ({ data: { id: 'ses_1', directory: '/project', time: { created: 1, updated: 1 } } }),
    promptAsync: async (input: any) => {
      store.applyServerEvent({ directory: '/project', payload: { type: 'message.part.updated', properties: { part: {
        id: input.parts[0].id, messageID: input.messageID, sessionID: 'ses_1', type: 'text', text: 'confirmed',
      } } } as any })
      throw new Error('response lost')
    },
  } } as any)

  await assert.rejects(() => store.submitPrompt({
    directory: '/project', text: 'mixed', agent: 'plan', model: { providerID: 'p', modelID: 'm' },
    parts: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }],
  }), /response lost/)
  const messageID = store.state.messages.ses_1?.[0]?.id ?? ''
  assert.equal(store.state.parts[messageID]?.length, 1)
  assert.equal((store.state.parts[messageID]?.[0] as any)?.text, 'confirmed')
})

test('active sessions are never reused across directories', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  for (const directory of ['/one', '/two']) store.registerClient(directory, { session: {
    create: async () => ({ data: { id: `ses_${directory.slice(1)}`, directory, time: { created: 1, updated: 1 } } }),
  } } as any)

  assert.equal(await store.ensureSession({ directory: '/one' }), 'ses_one')
  assert.equal(await store.ensureSession({ directory: '/two' }), 'ses_two')
})

test('session error records diagnostics while session status remains the busy truth', () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.setActiveSession('ses_1')
  store.applyServerEvent({ directory: '/project', payload: { type: 'session.status', properties: {
    sessionID: 'ses_1', status: { type: 'busy' },
  } } as any })
  store.applyServerEvent({ directory: '/project', payload: { type: 'session.error', properties: {
    sessionID: 'ses_1', error: { name: 'ProviderError' },
  } } as any })

  assert.equal(store.isStreaming, true)
  assert.equal(store.state.sessionStatus.ses_1?.type, 'busy')
})

test('openSession snapshots cannot overwrite newer session todo or diff events', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolve!: (value: any) => void
  let gets = 0
  const pending = new Promise(value => { resolve = value })
  store.registerClient('/project', { session: {
    get: async () => { gets++; return pending }, messages: async () => ({ data: [] }),
    todo: async () => ({ data: [{ content: 'old' }] }), diff: async () => ({ data: [{ file: 'old' }] }),
  } } as any)
  const opening = store.openSession('/project', 'ses_1')
  store.applyServerEvent({ directory: '/project', payload: { type: 'session.updated', properties: {
    info: { id: 'ses_1', directory: '/project', title: 'new', time: { created: 1, updated: 2 } },
  } } as any })
  store.applyServerEvent({ directory: '/project', payload: { type: 'todo.updated', properties: {
    sessionID: 'ses_1', todos: [{ content: 'new' }],
  } } as any })
  store.applyServerEvent({ directory: '/project', payload: { type: 'session.diff', properties: {
    sessionID: 'ses_1', diff: [{ file: 'new' }],
  } } as any })
  resolve({ data: { id: 'ses_1', directory: '/project', title: 'old', time: { created: 1, updated: 1 } } })
  await opening

  assert.equal(store.state.sessionInfo.ses_1?.title, 'new')
  assert.equal(store.state.todos.ses_1?.[0]?.content, 'new')
  assert.equal(store.state.sessionDiff.ses_1?.[0]?.file, 'new')
})

test('archiving the active session clears its identity and allows cache reload', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.setActiveDirectory('/project')
  store.setActiveSession('ses_1')
  store.state.messages.ses_1 = [{ id: 'msg_1', sessionID: 'ses_1' } as any]
  store.applyServerEvent({ directory: '/project', payload: { type: 'session.updated', properties: { info: {
    id: 'ses_1', directory: '/project', time: { created: 1, updated: 2, archived: 2 },
  } } } as any })

  assert.equal(store.activeSessionId, '')
  assert.equal(store.state.messages.ses_1, undefined)
})

test('reconnect does not restore stale active refs after switching directories', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  store.registerClient('/old', { session: {
    list: async () => { await pending; return { data: [] } }, status: async () => ({ data: {} }),
    get: async () => ({ data: { id: 'ses_old', directory: '/old', time: {} } }),
    messages: async () => ({ data: [] }), todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  }, permission: { list: async () => ({ data: [] }) }, question: { list: async () => ({ data: [] }) } } as any)
  store.setActiveDirectory('/old')
  store.setActiveSession('ses_old')
  store.applyServerEvent({ directory: 'global', payload: { type: 'server.connected', properties: {} } as any })
  store.setActiveDirectory('/new')
  release()
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.equal(store.activeDirectory, '/new')
  assert.equal(store.activeSessionId, '')
})

test('deleted session tombstone prevents an in-flight snapshot from reviving caches', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolve!: (value: any) => void
  const pending = new Promise(value => { resolve = value })
  store.registerClient('/project', { session: {
    get: async () => pending, messages: async () => ({ data: [{ info: { id: 'msg_1', sessionID: 'ses_1' }, parts: [] }] }),
    todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  } } as any)
  const opening = store.openSession('/project', 'ses_1')
  store.applyServerEvent({ directory: '/project', payload: { type: 'session.deleted', properties: {
    info: { id: 'ses_1', directory: '/project', time: {} },
  } } as any })
  resolve({ data: { id: 'ses_1', directory: '/project', time: {} } })
  await opening

  assert.equal(store.state.sessionInfo.ses_1, undefined)
  assert.equal(store.state.messages.ses_1, undefined)
})

test('unchanged openSession replaces stale cached parts with the HTTP snapshot', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.state.parts.msg_1 = [{ id: 'prt_1', sessionID: 'ses_1', messageID: 'msg_1', type: 'text', text: 'stale' } as any]
  store.registerClient('/project', { session: {
    get: async () => ({ data: { id: 'ses_1', directory: '/project', time: {} } }),
    messages: async () => ({ data: [{
      info: { id: 'msg_1', sessionID: 'ses_1' },
      parts: [{ id: 'prt_1', sessionID: 'ses_1', messageID: 'msg_1', type: 'text', text: 'fresh' }],
    }] }), todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  } } as any)
  await store.openSession('/project', 'ses_1')
  assert.equal((store.state.parts.msg_1?.[0] as any)?.text, 'fresh')
})

test('setActiveSession rejects a session owned by another active directory', () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.state.sessionInfo.ses_other = { id: 'ses_other', directory: '/other' } as any
  store.setActiveDirectory('/project')
  store.setActiveSession('ses_other')
  assert.equal(store.activeSessionId, '')
})

test('reconnect retains directory-wide status and interactions for inactive sessions', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let handler: ((event: any) => void) | undefined
  const client = { session: {
    list: async () => ({ data: [
      { id: 'ses_1', directory: '/project', time: {} },
      { id: 'ses_2', directory: '/project', time: {} },
    ] }),
    status: async () => ({ data: { ses_1: { type: 'idle' }, ses_2: { type: 'busy' } } }),
    get: async () => ({ data: { id: 'ses_1', directory: '/project', time: {} } }),
    messages: async () => ({ data: [] }), todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  }, permission: { list: async () => ({ data: [{ id: 'per_2', sessionID: 'ses_2' }] }) },
  question: { list: async () => ({ data: [{ id: 'que_2', sessionID: 'ses_2', questions: [] }] }) } } as any
  const bridge = { start: async () => {}, dispose: () => {}, subscribe: (next: (event: any) => void) => {
    handler = next; return () => {}
  } }
  store.connect({ running: true, url: 'http://localhost', authorization: 'token', directory: '/project' }, {
    globalClient: {} as any, directoryClient: client, bridge: bridge as any,
  })
  store.setActiveSession('ses_1')
  handler?.({ directory: 'global', payload: { type: 'server.connected', properties: {} } })
  await new Promise(resolve => setTimeout(resolve, 0))
  store.setActiveSession('ses_2')

  assert.equal(store.state.sessionStatus.ses_2?.type, 'busy')
  assert.equal(store.activePermissions[0]?.id, 'per_2')
  assert.equal(store.activeQuestions[0]?.id, 'que_2')
})

test('openSession rejects a session from another directory without changing active state or caches', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.setActiveDirectory('/project')
  store.registerClient('/project', { session: {
    get: async () => ({ data: { id: 'ses_other', directory: '/other', time: {} } }),
    messages: async () => ({ data: [{ info: { id: 'msg_bad', sessionID: 'ses_other' }, parts: [] }] }),
    todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  } } as any)

  await assert.rejects(() => store.openSession('/project', 'ses_other'), /目录不匹配/)
  assert.equal(store.activeDirectory, '/project')
  assert.equal(store.activeSessionId, '')
  assert.equal(store.state.sessionInfo.ses_other, undefined)
  assert.equal(store.state.messages.ses_other, undefined)
})

test('openSession evicts an archived snapshot so ensureSession creates a replacement', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let creates = 0
  store.registerClient('/project', { session: {
    get: async () => ({ data: { id: 'ses_old', directory: '/project', time: { archived: 2 } } }),
    messages: async () => ({ data: [] }), todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
    create: async () => { creates++; return { data: { id: 'ses_new', directory: '/project', time: {} } } },
  } } as any)
  store.state.sessionInfo.ses_old = { id: 'ses_old', directory: '/project', time: {} } as any
  store.state.messages.ses_old = [{ id: 'msg_old', sessionID: 'ses_old' } as any]

  await store.openSession('/project', 'ses_old')
  const replacement = await store.ensureSession({ directory: '/project' })

  assert.equal(store.state.sessionInfo.ses_old, undefined)
  assert.equal(store.state.messages.ses_old, undefined)
  assert.equal(store.activeSessionId, 'ses_new')
  assert.equal(replacement, 'ses_new')
  assert.equal(creates, 1)
})

test('out-of-order openSession navigation cannot let an older request reclaim active routing', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolveA!: (value: any) => void
  let resolveB!: (value: any) => void
  const a = new Promise(value => { resolveA = value })
  const b = new Promise(value => { resolveB = value })
  store.registerClient('/project', { session: {
    get: async ({ sessionID }: any) => sessionID === 'ses_a' ? a : b,
    messages: async ({ sessionID }: any) => ({ data: [{ info: { id: `msg_${sessionID}`, sessionID }, parts: [] }] }),
    todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  } } as any)
  const openingA = store.openSession('/project', 'ses_a')
  const openingB = store.openSession('/project', 'ses_b')
  resolveA({ data: { id: 'ses_a', directory: '/project', time: {} } })
  await new Promise(resolve => setTimeout(resolve, 0))
  resolveB({ data: { id: 'ses_b', directory: '/project', time: {} } })
  await Promise.all([openingA, openingB])

  assert.equal(store.activeSessionId, 'ses_b')
})

test('newDraft prevents an older openSession request from restoring active routing', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolve!: (value: any) => void
  const pending = new Promise(value => { resolve = value })
  store.registerClient('/project', { session: {
    get: async () => pending, messages: async () => ({ data: [] }),
    todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  } } as any)
  const opening = store.openSession('/project', 'ses_old')
  store.newDraft()
  resolve({ data: { id: 'ses_old', directory: '/project', time: {} } })
  await opening

  assert.equal(store.activeSessionId, '')
})

test('authoritative bootstrap evicts sessions omitted while disconnected', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.state.sessionsByDirectory['/project'] = [
    { id: 'ses_kept', directory: '/project', time: {} },
    { id: 'ses_gone', directory: '/project', time: {} },
  ] as any
  store.state.sessionInfo.ses_gone = { id: 'ses_gone', directory: '/project', time: {} } as any
  store.state.messages.ses_gone = [{ id: 'msg_gone', sessionID: 'ses_gone' } as any]
  store.registerClient('/project', { session: {
    list: async () => ({ data: [{ id: 'ses_kept', directory: '/project', time: {} }] }),
  } } as any)

  await store.bootstrapDirectory('/project')

  assert.equal(store.state.sessionInfo.ses_gone, undefined)
  assert.equal(store.state.messages.ses_gone, undefined)
  assert.deepEqual(store.state.sessionsByDirectory['/project'].map(item => item.id), ['ses_kept'])
})

test('coalesced openSession calls share pending navigation and activate the session', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolve!: (value: any) => void
  let gets = 0
  const pending = new Promise(value => { resolve = value })
  store.registerClient('/project', { session: {
    get: async () => { gets++; return pending }, messages: async () => ({ data: [] }),
    todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  } } as any)
  const first = store.openSession('/project', 'ses_same')
  const second = store.openSession('/project', 'ses_same')
  resolve({ data: { id: 'ses_same', directory: '/project', time: {} } })
  await Promise.all([first, second])

  assert.equal(gets, 1)
  assert.equal(store.activeDirectory, '/project')
  assert.equal(store.activeSessionId, 'ses_same')
})

test('disconnect invalidates an in-flight openSession response', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolve!: (value: any) => void
  const pending = new Promise(value => { resolve = value })
  store.registerClient('/project', { session: {
    get: async () => pending, messages: async () => ({ data: [] }), todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  } } as any)
  const opening = store.openSession('/project', 'ses_stale')
  store.disconnect()
  resolve({ data: { id: 'ses_stale', directory: '/project', time: {} } })
  await opening
  assert.equal(store.state.sessionInfo.ses_stale, undefined)
})

test('unrelated status events do not skip todo and diff snapshots', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolve!: (value: any) => void
  const pending = new Promise(value => { resolve = value })
  store.registerClient('/project', { session: {
    get: async () => ({ data: { id: 'ses_1', directory: '/project', time: {} } }),
    messages: async () => pending, todo: async () => ({ data: [{ content: 'fresh' }] }), diff: async () => ({ data: [{ file: 'fresh' }] }),
  } } as any)
  const opening = store.openSession('/project', 'ses_1')
  store.applyServerEvent({ directory: '/project', payload: { type: 'session.status', properties: { sessionID: 'ses_1', status: { type: 'busy' } } } as any })
  resolve({ data: [] })
  await opening
  assert.equal(store.state.todos.ses_1?.[0]?.content, 'fresh')
  assert.equal(store.state.sessionDiff.ses_1?.[0]?.file, 'fresh')
})

test('reconnect question snapshot cannot overwrite a newer SSE question', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolveQuestions!: (value: any) => void
  let handler: ((event: any) => void) | undefined
  const questions = new Promise(value => { resolveQuestions = value })
  const client = { session: {
    list: async () => ({ data: [{ id: 'ses_1', directory: '/project', time: {} }] }),
    status: async () => ({ data: {} }), get: async () => ({ data: { id: 'ses_1', directory: '/project', time: {} } }),
    messages: async () => ({ data: [] }), todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  }, permission: { list: async () => ({ data: [] }) }, question: { list: async () => questions } } as any
  const bridge = { start: async () => {}, dispose: () => {}, subscribe: (next: (event: any) => void) => { handler = next; return () => {} } }
  store.connect({ running: true, url: 'http://localhost', authorization: 'token', directory: '/project' }, {
    globalClient: {} as any, directoryClient: client, bridge: bridge as any,
  })
  store.setActiveSession('ses_1')
  handler?.({ directory: 'global', payload: { type: 'server.connected', properties: {} } })
  store.applyServerEvent({ directory: '/project', payload: { type: 'question.asked', properties: {
    id: 'que_new', sessionID: 'ses_1', questions: [],
  } } as any })
  resolveQuestions({ data: [] })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(store.state.questions.ses_1?.[0]?.id, 'que_new')
})

test('opening a loaded session is the latest intent over a pending session', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolveB!: (value: any) => void
  const b = new Promise(value => { resolveB = value })
  store.registerClient('/project', { session: {
    get: async ({ sessionID }: any) => sessionID === 'ses_b' ? b : ({ data: { id: 'ses_a', directory: '/project', time: {} } }),
    messages: async () => ({ data: [] }), todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  } } as any)
  await store.openSession('/project', 'ses_a')
  const openingB = store.openSession('/project', 'ses_b')
  await store.openSession('/project', 'ses_a')
  resolveB({ data: { id: 'ses_b', directory: '/project', time: {} } })
  await openingB
  assert.equal(store.activeSessionId, 'ses_a')
})

test('authoritative message snapshot removes orphan parts for missing messages', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.state.parts.msg_orphan = [{ id: 'prt_orphan', messageID: 'msg_orphan', sessionID: 'ses_1', type: 'text' } as any]
  store.registerClient('/project', { session: {
    get: async () => ({ data: { id: 'ses_1', directory: '/project', time: {} } }), messages: async () => ({ data: [] }),
    todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  } } as any)
  await store.openSession('/project', 'ses_1')
  assert.equal(store.state.parts.msg_orphan, undefined)
})

test('reconcile ignores old server snapshots when server changes during bootstrap', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolveList!: (value: any) => void
  let handler: ((event: any) => void) | undefined
  const list = new Promise(value => { resolveList = value })
  const oldClient = { session: {
    list: async () => list, status: async () => ({ data: { ses_1: { type: 'busy' } } }),
    get: async () => ({ data: { id: 'ses_1', directory: '/project', time: {} } }), messages: async () => ({ data: [] }),
    todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  }, permission: { list: async () => ({ data: [] }) }, question: { list: async () => ({ data: [] }) } } as any
  const bridge = { start: async () => {}, dispose: () => {}, subscribe: (next: (event: any) => void) => { handler = next; return () => {} } }
  store.connect({ running: true, url: 'http://old', authorization: 'old', directory: '/project' }, {
    globalClient: {} as any, directoryClient: oldClient, bridge: bridge as any,
  })
  store.setActiveSession('ses_1')
  handler?.({ directory: 'global', payload: { type: 'server.connected', properties: {} } })
  store.connect({ running: true, url: 'http://new', authorization: 'new', directory: '/project' }, {
    globalClient: {} as any, directoryClient: {} as any, bridge: bridge as any,
  })
  resolveList({ data: [] })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(store.state.sessionStatus.ses_1, undefined)
})

test('disconnect clears loaded session fast paths so reconnect reloads from server', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let gets = 0
  const client = { session: {
    get: async () => { gets++; return { data: { id: 'ses_1', directory: '/project', time: {} } } },
    messages: async () => ({ data: [] }), todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  } } as any
  store.registerClient('/project', client)
  await store.openSession('/project', 'ses_1')
  store.disconnect()
  store.registerClient('/project', client)
  await store.openSession('/project', 'ses_1')
  assert.equal(gets, 2)
})

test('pending session as latest cross-directory intent activates when it completes', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolveA!: (value: any) => void
  const a = new Promise(value => { resolveA = value })
  const base = (directory: string) => ({ session: {
    get: async ({ sessionID }: any) => sessionID === 'ses_a' ? a : ({ data: { id: 'ses_b', directory, time: {} } }),
    messages: async () => ({ data: [] }), todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  } }) as any
  store.registerClient('/one', base('/one'))
  store.registerClient('/two', base('/two'))
  await store.openSession('/two', 'ses_b')
  const firstA = store.openSession('/one', 'ses_a')
  await store.openSession('/two', 'ses_b')
  const finalA = store.openSession('/one', 'ses_a')
  resolveA({ data: { id: 'ses_a', directory: '/one', time: {} } })
  await Promise.all([firstA, finalA])
  assert.equal(store.activeDirectory, '/one')
  assert.equal(store.activeSessionId, 'ses_a')
})

test('overlapping reconnects apply only the latest status snapshot', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  const resolvers: Array<(value: any) => void> = []
  let handler: ((event: any) => void) | undefined
  const client = { session: {
    list: async () => ({ data: [{ id: 'ses_1', directory: '/project', time: {} }] }),
    status: async () => new Promise(value => resolvers.push(value)),
    get: async () => ({ data: { id: 'ses_1', directory: '/project', time: {} } }), messages: async () => ({ data: [] }),
    todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  }, permission: { list: async () => ({ data: [] }) }, question: { list: async () => ({ data: [] }) } } as any
  const bridge = { start: async () => {}, dispose: () => {}, subscribe: (next: (event: any) => void) => { handler = next; return () => {} } }
  store.connect({ running: true, url: 'http://server', authorization: 'token', directory: '/project' }, {
    globalClient: {} as any, directoryClient: client, bridge: bridge as any,
  })
  store.setActiveSession('ses_1')
  handler?.({ directory: 'global', payload: { type: 'server.connected', properties: {} } })
  handler?.({ directory: 'global', payload: { type: 'server.connected', properties: {} } })
  resolvers[1]?.({ data: { ses_1: { type: 'idle' } } })
  await new Promise(resolve => setTimeout(resolve, 0))
  resolvers[0]?.({ data: { ses_1: { type: 'busy' } } })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(store.state.sessionStatus.ses_1?.type, 'idle')
})

test('directory switch during session creation prevents stale prompt submission', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolveCreate!: (value: any) => void
  let prompts = 0
  store.registerClient('/old', { session: {
    create: async () => new Promise(value => { resolveCreate = value }), promptAsync: async () => { prompts++ },
  } } as any)
  const submitting = store.submitPrompt({ directory: '/old', text: 'x', agent: 'plan', model: { providerID: 'p', modelID: 'm' }, parts: [{ type: 'text', text: 'x' }] })
  store.setActiveDirectory('/new')
  resolveCreate({ data: { id: 'ses_old', directory: '/old', time: {} } })
  await assert.rejects(() => submitting, /已切换/)
  assert.equal(prompts, 0)
  assert.equal(store.activeDirectory, '/new')
})

test('removed confirmed optimistic content rolls back when prompt request fails', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.registerClient('/project', { session: {
    create: async () => ({ data: { id: 'ses_1', directory: '/project', time: {} } }),
    promptAsync: async (input: any) => {
      store.applyServerEvent({ directory: '/project', payload: { type: 'message.updated', properties: { info: {
        id: input.messageID, sessionID: 'ses_1', role: 'user', time: {}, agent: 'plan', model: {},
      } } } as any })
      store.applyServerEvent({ directory: '/project', payload: { type: 'message.removed', properties: {
        sessionID: 'ses_1', messageID: input.messageID,
      } } as any })
      throw new Error('failed')
    },
  } } as any)
  await assert.rejects(() => store.submitPrompt({
    directory: '/project', text: 'x', agent: 'plan', model: { providerID: 'p', modelID: 'm' }, parts: [{ type: 'text', text: 'x' }],
  }), /failed/)
  assert.equal(store.isStreaming, false)
  assert.deepEqual(store.state.messages.ses_1, [])
})

test('restored busy session abort uses the registered current-directory client', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  const calls: any[] = []
  const client = { session: {
    abort: async (input: any) => { calls.push(input) },
  } } as any
  store.registerClient('/project', client)
  store.setActiveDirectory('/project')
  store.setActiveSession('ses_restored')
  assert.equal(store.state.sessionStatus.ses_restored, undefined)

  await store.abortActiveSession()

  assert.deepEqual(calls, [{ sessionID: 'ses_restored', directory: '/project' }])
  assert.equal(store.activeSessionId, 'ses_restored')
})

test('clearing an old session leaves no cross-directory active identity during a switch', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  store.setActiveDirectory('/old')
  store.setActiveSession('ses_old')

  store.newDraft()
  store.setActiveDirectory('/new')

  assert.equal(store.activeDirectory, '/new')
  assert.equal(store.activeSessionId, '')
})

test('an invalid saved session cannot become active in the new directory', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  const client = { session: {
    get: async () => ({ data: undefined }),
    messages: async () => ({ data: [] }),
    todo: async () => ({ data: [] }),
    diff: async () => ({ data: [] }),
  } } as any
  store.registerClient('/new', client)
  store.setActiveDirectory('/new')

  await assert.rejects(store.openSession('/new', 'ses_missing'), /不存在/)
  assert.equal(store.activeSessionId, '')
})

test('session rename uses its registered directory client without reconnecting', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  const calls: any[] = []
  const client = { session: {
    update: async (input: any) => { calls.push(input) },
  } } as any
  store.registerClient('/project', client)
  store.setActiveDirectory('/project')

  await store.renameSession('ses_rename', '新标题')

  assert.deepEqual(calls, [{ sessionID: 'ses_rename', title: '新标题', directory: '/project' }])
})

test('cancelled ensureConnected never creates a bridge after its server await resolves', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolveServer!: (handle: any) => void
  const server = new Promise(resolve => { resolveServer = resolve })
  let current = true
  let bridgeStarts = 0
  const pending = store.ensureConnected(
    { config: {}, directory: '/project', isCurrent: () => current },
    {
      ensureServer: async () => server,
      connectDependencies: {
        globalClient: {} as any,
        directoryClient: { session: { list: async () => ({ data: [] }) } } as any,
        bridge: { start: async () => { bridgeStarts++ }, dispose: () => {}, subscribe: () => () => {} } as any,
      },
    },
  )
  current = false
  resolveServer({ running: true, url: 'http://server', authorization: 'token', directory: '/project' })

  await pending

  assert.equal(store.connected, false)
  assert.equal(bridgeStarts, 0)
})

test('an old bridge late rejection cannot overwrite the current connection error', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let rejectOld!: (error: Error) => void
  const oldStart = new Promise<void>((_, reject) => { rejectOld = reject })
  const oldBridge = { start: () => oldStart, dispose: () => {}, subscribe: () => () => {} }
  const newBridge = { start: async () => {}, dispose: () => {}, subscribe: () => () => {} }
  store.connect({ running: true, url: 'http://old', authorization: 'old', directory: '/project' }, {
    globalClient: {} as any, directoryClient: {} as any, bridge: oldBridge as any,
  })
  store.connect({ running: true, url: 'http://new', authorization: 'new', directory: '/project' }, {
    globalClient: {} as any, directoryClient: {} as any, bridge: newBridge as any,
  })

  rejectOld(new Error('old bridge failed late'))
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.equal(store.connectionError, '')
  assert.equal(store.serverKey, 'http://new|new')
})

test('session permission updates use the registered directory client', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  const calls: any[] = []
  store.registerClient('/project', {
    session: { update: async (input: any) => { calls.push(input) } },
  } as any)

  await store.updateSessionPermission('/project', 'ses_1', [{ permission: 'read', pattern: '*' }])

  assert.deepEqual(calls, [{ sessionID: 'ses_1', permission: [{ permission: 'read', pattern: '*' }], directory: '/project' }])
})

test('a late older ensure intent cannot replace the newer server or continue into session creation', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolveA!: (handle: any) => void
  const serverA = new Promise(resolve => { resolveA = resolve })
  let createsA = 0
  const clientA = { session: {
    list: async () => ({ data: [] }),
    create: async () => {
      createsA++
      return { data: { id: 'ses_a', directory: '/a', time: {} } }
    },
  } } as any
  const clientB = { session: {
    list: async () => ({ data: [] }),
    update: async () => {},
  } } as any
  const bridge = () => ({ start: async () => {}, dispose: () => {}, subscribe: () => () => {} }) as any
  const flowA = store.ensureConnected(
    { config: {}, directory: '/a' },
    {
      ensureServer: async () => serverA,
      connectDependencies: { globalClient: {} as any, directoryClient: clientA, bridge: bridge() },
    },
  ).then(() => store.ensureSession({ directory: '/a', title: 'A' }))
  await store.ensureConnected(
    { config: {}, directory: '/b' },
    {
      ensureServer: async () => ({ running: true, url: 'http://b', authorization: 'b', directory: '/b' }),
      connectDependencies: { globalClient: {} as any, directoryClient: clientB, bridge: bridge() },
    },
  )

  resolveA({ running: true, url: 'http://a', authorization: 'a', directory: '/a' })

  await assert.rejects(flowA, /连接请求已失效/)
  assert.equal(store.serverKey, 'http://b|b')
  assert.equal(store.activeDirectory, '/b')
  assert.equal(createsA, 0)
  await store.updateSessionPermission('/b', 'ses_b', [])
  await assert.rejects(store.updateSessionPermission('/a', 'ses_a', []), /未注册/)
})

test('same-directory concurrent ensure calls share one daemon result and both continue their tails', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let resolveServer!: (handle: any) => void
  const server = new Promise(resolve => { resolveServer = resolve })
  let daemonCalls = 0
  let appRestoreTail = 0
  let sendTail = 0
  const ensureServer = async () => {
    daemonCalls++
    return server
  }
  const client = { session: { list: async () => ({ data: [] }) } } as any
  const bridge = { start: async () => {}, dispose: () => {}, subscribe: () => () => {} } as any
  const dependencies = {
    ensureServer,
    connectDependencies: { globalClient: {} as any, directoryClient: client, bridge },
  }
  const app = store.ensureConnected(
    { config: { provider: 'same' }, directory: ' /project ', isCurrent: () => true },
    dependencies,
  ).then(() => { appRestoreTail++ })
  const send = store.ensureConnected(
    { config: { provider: 'same' }, directory: '/project' },
    dependencies,
  ).then(() => { sendTail++ })

  resolveServer({ running: true, url: 'http://same', authorization: 'same', directory: '/project' })
  await Promise.all([app, send])

  assert.equal(daemonCalls, 1)
  assert.equal(appRestoreTail, 1)
  assert.equal(sendTail, 1)
  assert.equal(store.serverKey, 'http://same|same')
  assert.equal(store.activeDirectory, '/project')
})

test('interactive replies after directory restore use only the active directory client', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  const oldCalls: string[] = []
  const newCalls: string[] = []
  const makeClient = (calls: string[]) => ({
    permission: {
      reply: async () => { calls.push('permission') },
    },
    question: {
      reply: async () => { calls.push('question-reply') },
      reject: async () => { calls.push('question-reject') },
    },
  }) as any
  store.registerClient('/old', makeClient(oldCalls))
  store.registerClient('/new', makeClient(newCalls))
  store.setActiveDirectory('/new')
  store.state.sessionInfo.ses_new = { id: 'ses_new', directory: '/new', time: {} } as any
  store.setActiveSession('ses_new')
  store.state.permissions.ses_new = [{ id: 'per_new', sessionID: 'ses_new' } as any]
  store.state.questions.ses_new = [{ id: 'que_new', sessionID: 'ses_new', questions: [] } as any]

  await store.replyPermission({ sessionID: 'ses_new', requestID: 'per_new', reply: 'once' })
  await store.replyQuestion({ sessionID: 'ses_new', requestID: 'que_new', answers: [['ok']] })
  await store.rejectQuestion({ sessionID: 'ses_new', requestID: 'que_new' })

  assert.deepEqual(oldCalls, [])
  assert.deepEqual(newCalls, ['permission', 'question-reply', 'question-reject'])
  await assert.rejects(
    store.replyPermission({ sessionID: 'ses_old', requestID: 'per_new', reply: 'once' }),
    /当前活动会话|请求不存在/,
  )
})

test('submitPrompt uses a supplied validated session without ensuring again', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  let creates = 0
  let prompts = 0
  store.registerClient('/project', { session: {
    create: async () => { creates++; return { data: { id: 'ses_1', directory: '/project', time: {} } } },
    promptAsync: async () => { prompts++ },
  } } as any)
  const sessionID = await store.ensureSession({ directory: '/project' })
  await store.submitPrompt({ sessionID, directory: '/project', text: 'x', agent: 'plan', model: { providerID: 'p', modelID: 'm' }, parts: [{ type: 'text', text: 'x' }] })
  assert.equal(creates, 1)
  assert.equal(prompts, 1)
})

test('server.connected starts a fresh bootstrap instead of reusing an older pending list', async () => {
  setActivePinia(createPinia())
  const store = useOpenCodeSyncStore()
  const lists: Array<(value: any) => void> = []
  let handler: ((event: any) => void) | undefined
  const client = { session: {
    list: async () => new Promise(value => lists.push(value)), status: async () => ({ data: {} }),
    get: async () => ({ data: { id: 'ses_new', directory: '/project', time: {} } }), messages: async () => ({ data: [] }),
    todo: async () => ({ data: [] }), diff: async () => ({ data: [] }),
  }, permission: { list: async () => ({ data: [] }) }, question: { list: async () => ({ data: [] }) } } as any
  const bridge = { start: async () => {}, dispose: () => {}, subscribe: (next: (event: any) => void) => { handler = next; return () => {} } }
  store.connect({ running: true, url: 'http://server', authorization: 'token', directory: '/project' }, {
    globalClient: {} as any, directoryClient: client, bridge: bridge as any,
  })
  const old = store.bootstrapDirectory('/project')
  handler?.({ directory: 'global', payload: { type: 'server.connected', properties: {} } })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(lists.length, 2)
  lists[1]?.({ data: [{ id: 'ses_new', directory: '/project', time: {} }] })
  await new Promise(resolve => setTimeout(resolve, 0))
  lists[0]?.({ data: [{ id: 'ses_old', directory: '/project', time: {} }] })
  await old
  assert.deepEqual(store.state.sessionsByDirectory['/project']?.map(item => item.id), ['ses_new'])
})
