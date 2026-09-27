import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MobileRemoteClient, type MobileRemoteTransport } from '@/services/mobileRemoteClient'

const context = {
  projectName: '项目 A', conversationTitle: '对话 A', conversationId: 'a', sessionId: 'jc-v1-a',
}

const snapshot = {
  sessionId: 'jc-v1-a',
  turns: [{ id: 't1', role: 'user', content: '你好', createdAt: 1 }],
  process: {},
  reasoning: {},
}

function fakeTransport(requests: Record<string, (payload: Record<string, unknown>) => unknown>) {
  const calls: Array<{ type: string; payload: Record<string, unknown> }> = []
  let push: ((message: unknown) => void) | undefined
  const transport: MobileRemoteTransport = {
    async request(input) {
      calls.push(input)
      const handler = requests[input.type]
      if (!handler) throw new Error('UNSUPPORTED_MESSAGE')
      return await handler(input.payload)
    },
    subscribe(listener) { push = listener; return () => { push = undefined } },
  }
  return {
    transport,
    calls,
    types: () => calls.map(call => call.type),
    emit: (message: unknown) => push?.(message),
  }
}

function connectedClient(extra: Record<string, (payload: Record<string, unknown>) => unknown> = {}) {
  const bridge = fakeTransport({
    'context.get': () => ({ ...context }),
    'session.read': () => ({ ...snapshot }),
    'session.subscribe': payload => ({ subscribed: true, sessionId: payload.sessionId }),
    ...extra,
  })
  return { ...bridge, client: new MobileRemoteClient(bridge.transport) }
}

function sessionEvent(seq: number, overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    requestId: `event-${seq}`,
    type: 'session.event',
    sentAt: Date.now(),
    payload: {
      sessionId: context.sessionId,
      seq,
      turns: [{ id: 't1', role: 'assistant', content: `第 ${seq} 版`, createdAt: 1 }],
      streamingText: '',
      run: { state: 'idle', steps: [], approval: null },
      ...overrides,
    },
  }
}

test('连接按 context.get → session.read → session.subscribe 建立当前 Session', async () => {
  const { client, types } = connectedClient()

  await client.connect()

  assert.deepEqual(types(), ['context.get', 'session.read', 'session.subscribe'])
  assert.deepEqual(client.view.context, context)
  assert.deepEqual(client.view.turns, snapshot.turns)
  assert.equal(client.view.lastSeq, 0)
  assert.equal(client.view.state, 'connected')
})

test('连接失败时进入离线态而不是假装已连接', async () => {
  const bridge = fakeTransport({
    'context.get': () => { throw new Error('AUTH_INVALID') },
  })
  const client = new MobileRemoteClient(bridge.transport)

  await assert.rejects(() => client.connect(), /AUTH_INVALID/)
  assert.equal(client.view.state, 'offline')
  assert.equal(client.view.context, null)
})

test('message.send 在未取得回执时不能自动重发', async () => {
  let attempts = 0
  const { client, calls } = connectedClient({
    'message.send': () => { attempts += 1; throw new Error('REMOTE_CONNECTION_CLOSED') },
  })
  await client.connect()

  await assert.rejects(() => client.sendMessage('继续'), /REMOTE_CONNECTION_CLOSED/)

  assert.equal(attempts, 1)
  assert.deepEqual(calls.filter(call => call.type === 'message.send').map(call => call.payload), [
    { sessionId: context.sessionId, text: '继续' },
  ])
})

test('空文本和未连接时拒绝发送，不触达 Desktop', async () => {
  const { client, calls } = connectedClient()
  await assert.rejects(() => client.sendMessage('继续'), /REMOTE_NOT_CONNECTED/)

  await client.connect()
  await assert.rejects(() => client.sendMessage('   '), /MESSAGE_EMPTY/)

  assert.equal(calls.filter(call => call.type === 'message.send').length, 0)
})

test('重复或倒序的 session.event 被忽略', async () => {
  const { client, emit } = connectedClient()
  await client.connect()

  emit(sessionEvent(2))
  assert.equal(client.view.turns[0]?.content, '第 2 版')
  assert.equal(client.view.lastSeq, 2)

  emit(sessionEvent(2, { turns: [{ id: 't1', role: 'assistant', content: '重复', createdAt: 1 }] }))
  assert.equal(client.view.turns[0]?.content, '第 2 版')

  emit(sessionEvent(1, { turns: [{ id: 't1', role: 'assistant', content: '旧事件', createdAt: 1 }] }))
  assert.equal(client.view.turns[0]?.content, '第 2 版')
  assert.equal(client.view.lastSeq, 2)
})

test('其他 Session 的事件被过滤，不会串进当前对话', async () => {
  const { client, emit } = connectedClient()
  await client.connect()

  emit(sessionEvent(5, { sessionId: 'jc-v1-b' }))
  emit(sessionEvent(6, {
    sessionId: 'jc-v1-b',
    turns: [{ id: 'x', role: 'assistant', content: '别的对话', createdAt: 1 }],
  }))

  assert.deepEqual(client.view.turns, snapshot.turns)
  assert.equal(client.view.lastSeq, 0)
})

test('Desktop 切换对话时清空旧投影并重新读取新 Session', async () => {
  const nextContext = {
    projectName: '项目 A', conversationTitle: '对话 B', conversationId: 'b', sessionId: 'jc-v1-b',
  }
  let readSessionId = ''
  const bridge = fakeTransport({
    'context.get': () => ({ ...context }),
    'session.read': payload => {
      readSessionId = String(payload.sessionId)
      return { sessionId: payload.sessionId, turns: [{ id: 'tb', role: 'user', content: '新对话', createdAt: 2 }] }
    },
    'session.subscribe': payload => ({ subscribed: true, sessionId: payload.sessionId }),
  })
  const client = new MobileRemoteClient(bridge.transport)
  await client.connect()
  bridge.emit(sessionEvent(3))
  assert.equal(client.view.turns[0]?.content, '第 3 版')

  bridge.emit({
    version: 1, requestId: 'context-4', type: 'context.changed', sentAt: Date.now(), payload: nextContext,
  })
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.deepEqual(client.view.context, nextContext)
  assert.equal(readSessionId, 'jc-v1-b')
  assert.deepEqual(client.view.turns, [{ id: 'tb', role: 'user', content: '新对话', createdAt: 2 }])
  assert.equal(client.view.lastSeq, 0)

  bridge.emit(sessionEvent(9))
  assert.deepEqual(client.view.turns, [{ id: 'tb', role: 'user', content: '新对话', createdAt: 2 }])
})

test('未知入站消息不会破坏客户端状态', async () => {
  const { client, emit } = connectedClient()
  await client.connect()

  emit({ version: 1, requestId: 'x', type: 'project.delete', sentAt: Date.now(), payload: {} })
  emit(null)
  emit({ version: 1, requestId: 'y', type: 'session.event', sentAt: Date.now(), payload: { sessionId: context.sessionId } })

  assert.equal(client.view.state, 'connected')
  assert.deepEqual(client.view.turns, snapshot.turns)
})

test('断开后迟到的推送不再改变视图', async () => {
  const { client, emit } = connectedClient()
  await client.connect()
  emit(sessionEvent(4))
  assert.equal(client.view.lastSeq, 4)

  client.disconnect()
  emit(sessionEvent(5))

  assert.equal(client.view.state, 'offline')
  assert.equal(client.view.lastSeq, 4)
})

test('通道断开只置离线，不动已有投影也不猜结果', async () => {
  const { client, emit } = connectedClient()
  await client.connect()
  emit(sessionEvent(4))

  client.handleTransportClosed()

  assert.equal(client.view.state, 'offline')
  assert.equal(client.view.lastSeq, 4)
  assert.deepEqual(client.view.context, context)
  assert.equal(client.view.run.state, 'idle')

  emit(sessionEvent(6))
  assert.equal(client.view.lastSeq, 4)
})

test('停止与审批只透传当前 Session 的精确决定', async () => {
  const { client, calls } = connectedClient({
    'run.stop': () => ({ state: 'stopped' }),
    'approval.respond': () => ({ accepted: true }),
  })
  await client.connect()

  await client.stopRun()
  await client.respondApproval('approval-1', 'approve')
  await assert.rejects(() => client.respondApproval('', 'approve'), /APPROVAL_NOT_FOUND/)

  const sideEffects = calls.filter(call => call.type === 'run.stop' || call.type === 'approval.respond')
  assert.deepEqual(sideEffects.map(call => call.type), ['run.stop', 'approval.respond'])
  assert.deepEqual(sideEffects[1].payload, {
    sessionId: context.sessionId, approvalId: 'approval-1', decision: 'approve',
  })
})
