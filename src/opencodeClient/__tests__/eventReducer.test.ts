import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyOpenCodeEvent, createOpenCodeSyncState } from '../eventReducer'

const directory = '/project'

function session(id: string, title = id) {
  return {
    id,
    slug: id,
    projectID: 'project_1',
    directory,
    title,
    version: '1.17.18',
    time: { created: 1, updated: 1 },
  }
}

function event(type: string, properties: Record<string, unknown>) {
  return { id: `${type}:1`, type, properties } as any
}

test('session lifecycle updates the directory list and session cache by official id', () => {
  const state = createOpenCodeSyncState()
  applyOpenCodeEvent(state, directory, event('session.created', { sessionID: 'ses_b', info: session('ses_b') }))
  applyOpenCodeEvent(state, directory, event('session.created', { sessionID: 'ses_a', info: session('ses_a') }))
  applyOpenCodeEvent(state, directory, event('session.updated', { sessionID: 'ses_a', info: session('ses_a', '你好') }))

  assert.deepEqual(state.sessionsByDirectory[directory].map(item => item.id), ['ses_a', 'ses_b'])
  assert.equal(state.sessionInfo.ses_a?.title, '你好')

  applyOpenCodeEvent(state, directory, event('session.deleted', { sessionID: 'ses_a', info: session('ses_a') }))
  assert.deepEqual(state.sessionsByDirectory[directory].map(item => item.id), ['ses_b'])
  assert.equal(state.sessionInfo.ses_a, undefined)
})

test('message part and delta events build one ordered session timeline', () => {
  const state = createOpenCodeSyncState()
  const user = {
    id: 'msg_1',
    sessionID: 'ses_1',
    role: 'user',
    time: { created: 1 },
    agent: 'plan',
    model: { providerID: 'jiucaihezi', modelID: 'model' },
  }
  const part = {
    id: 'prt_1',
    sessionID: 'ses_1',
    messageID: 'msg_1',
    type: 'text',
    text: '你',
  }

  applyOpenCodeEvent(state, directory, event('message.updated', { sessionID: 'ses_1', info: user }))
  applyOpenCodeEvent(state, directory, event('message.part.updated', { sessionID: 'ses_1', part, time: 1 }))
  applyOpenCodeEvent(state, directory, event('message.part.delta', {
    sessionID: 'ses_1', messageID: 'msg_1', partID: 'prt_1', field: 'text', delta: '好',
  }))
  applyOpenCodeEvent(state, directory, event('session.status', {
    sessionID: 'ses_1', status: { type: 'busy' },
  }))

  assert.deepEqual(state.messages.ses_1?.map(message => message.id), ['msg_1'])
  assert.equal((state.parts.msg_1?.[0] as any).text, '你好')
  assert.equal(state.sessionStatus.ses_1?.type, 'busy')

  applyOpenCodeEvent(state, directory, event('session.status', {
    sessionID: 'ses_1', status: { type: 'idle' },
  }))
  assert.equal(state.sessionStatus.ses_1?.type, 'idle')
})

test('part updates without a known parent message do not create visible orphans', () => {
  const state = createOpenCodeSyncState()
  applyOpenCodeEvent(state, directory, event('message.part.updated', {
    sessionID: 'ses_1',
    part: { id: 'prt_orphan', sessionID: 'ses_1', messageID: 'msg_missing', type: 'text', text: 'bad' },
    time: 1,
  }))

  assert.equal(state.parts.msg_missing, undefined)
})

test('events for inactive sessions remain isolated and available', () => {
  const state = createOpenCodeSyncState()
  for (const id of ['ses_1', 'ses_2']) {
    applyOpenCodeEvent(state, directory, event('message.updated', {
      sessionID: id,
      info: { id: `msg_${id}`, sessionID: id, role: 'user', time: { created: 1 }, agent: 'plan', model: {} },
    }))
  }

  assert.equal(state.messages.ses_1?.[0]?.id, 'msg_ses_1')
  assert.equal(state.messages.ses_2?.[0]?.id, 'msg_ses_2')
})

test('permission question todo and diff events update session-scoped state', () => {
  const state = createOpenCodeSyncState()
  applyOpenCodeEvent(state, directory, event('permission.v2.asked', {
    id: 'per_1', sessionID: 'ses_1', action: 'read', resources: ['/tmp/a'],
  }))
  applyOpenCodeEvent(state, directory, event('question.v2.asked', {
    id: 'que_1', sessionID: 'ses_1', questions: [{ question: '继续吗？', header: '确认', options: [] }],
  }))
  applyOpenCodeEvent(state, directory, event('todo.updated', {
    sessionID: 'ses_1', todos: [{ content: '写作', status: 'pending', priority: 'high' }],
  }))
  applyOpenCodeEvent(state, directory, event('session.diff', {
    sessionID: 'ses_1', diff: [{ file: 'a.md', additions: 1, deletions: 0 }],
  }))

  assert.equal(state.permissions.ses_1?.[0]?.id, 'per_1')
  assert.equal(state.questions.ses_1?.[0]?.id, 'que_1')
  assert.equal(state.todos.ses_1?.[0]?.content, '写作')
  assert.equal(state.sessionDiff.ses_1?.[0]?.file, 'a.md')

  applyOpenCodeEvent(state, directory, event('permission.v2.replied', {
    sessionID: 'ses_1', requestID: 'per_1', reply: 'once',
  }))
  applyOpenCodeEvent(state, directory, event('question.v2.rejected', {
    sessionID: 'ses_1', requestID: 'que_1',
  }))
  assert.deepEqual(state.permissions.ses_1, [])
  assert.deepEqual(state.questions.ses_1, [])
})

test('message and part removal events delete their cached state', () => {
  const state = createOpenCodeSyncState()
  applyOpenCodeEvent(state, directory, event('message.updated', {
    sessionID: 'ses_1',
    info: { id: 'msg_1', sessionID: 'ses_1', role: 'user', time: { created: 1 }, agent: 'plan', model: {} },
  }))
  applyOpenCodeEvent(state, directory, event('message.part.updated', {
    sessionID: 'ses_1',
    part: { id: 'prt_1', sessionID: 'ses_1', messageID: 'msg_1', type: 'text', text: '你好' },
    time: 1,
  }))
  applyOpenCodeEvent(state, directory, event('message.part.removed', {
    sessionID: 'ses_1', messageID: 'msg_1', partID: 'prt_1',
  }))
  assert.equal(state.parts.msg_1, undefined)

  applyOpenCodeEvent(state, directory, event('message.removed', {
    sessionID: 'ses_1', messageID: 'msg_1',
  }))
  assert.deepEqual(state.messages.ses_1, [])
})

test('standard question events add and remove requests', () => {
  const state = createOpenCodeSyncState()
  applyOpenCodeEvent(state, directory, event('question.asked', {
    id: 'que_1', sessionID: 'ses_1', questions: [],
  }))
  assert.equal(state.questions.ses_1?.[0]?.id, 'que_1')

  applyOpenCodeEvent(state, directory, event('question.replied', {
    sessionID: 'ses_1', requestID: 'que_1', answers: [],
  }))
  assert.deepEqual(state.questions.ses_1, [])
})

test('session error is represented separately from idle status', () => {
  const state = createOpenCodeSyncState()
  applyOpenCodeEvent(state, directory, event('session.status', {
    sessionID: 'ses_1', status: { type: 'busy' },
  }))
  applyOpenCodeEvent(state, directory, event('session.error', {
    sessionID: 'ses_1', error: { name: 'ProviderError', data: { message: 'failed' } },
  }))

  assert.equal(state.sessionStatus.ses_1?.type, 'busy')
  assert.equal((state.sessionErrors.ses_1 as any)?.name, 'ProviderError')
})

test('archiving a session evicts all session caches', () => {
  const state = createOpenCodeSyncState()
  applyOpenCodeEvent(state, directory, event('session.created', { info: session('ses_1') }))
  state.messages.ses_1 = [{ id: 'msg_1', sessionID: 'ses_1' } as any]
  state.parts.msg_1 = [{ id: 'prt_1', messageID: 'msg_1', sessionID: 'ses_1', type: 'text' } as any]
  state.todos.ses_1 = []
  state.sessionDiff.ses_1 = []

  applyOpenCodeEvent(state, directory, event('session.updated', {
    info: { ...session('ses_1'), time: { created: 1, updated: 2, archived: 2 } },
  }))

  assert.deepEqual(state.sessionsByDirectory[directory], [])
  assert.equal(state.sessionInfo.ses_1, undefined)
  assert.equal(state.messages.ses_1, undefined)
  assert.equal(state.parts.msg_1, undefined)
})
