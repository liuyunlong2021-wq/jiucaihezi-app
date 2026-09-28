import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MobileRemoteClient, type MobileRemoteTransport } from '@/services/mobileRemoteClient'

const context = {
  projectName: '项目 A', conversationTitle: '对话 A', conversationId: 'a', sessionId: 'jc-v1-a',
}

const snapshot = {
  sessionId: 'jc-v1-a',
  gatewayEpoch: 'epoch-1',
  seq: 0,
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
    'session.attach': payload => ({
      sessionId: payload.sessionId, gatewayEpoch: snapshot.gatewayEpoch, seq: snapshot.seq,
      snapshot: { ...snapshot },
    }),
    'session.read': () => ({ ...snapshot }),
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
      gatewayEpoch: 'epoch-1',
      seq,
      turns: [{ id: 't1', role: 'assistant', content: `第 ${seq} 版`, createdAt: 1 }],
      streamingText: '',
      run: { state: 'idle', steps: [], approval: null },
      ...overrides,
    },
  }
}

test('手机发送后立即显示待发送消息，不等待 Desktop 回执或推送', async () => {
  let release!: (value: unknown) => void
  const waiting = new Promise<unknown>(resolve => { release = resolve })
  const { client } = connectedClient({ 'message.send': () => waiting })
  await client.connect()

  const sending = client.sendMessage('手机上的新任务')
  assert.deepEqual(
    (client.view as unknown as { pendingMessages?: Array<{ content: string; state: string }> }).pendingMessages
      ?.map(message => ({ content: message.content, state: message.state })),
    [{ content: '手机上的新任务', state: 'sending' }],
  )
  release({ accepted: true, runId: 'run-1' })
  await sending
  assert.equal(client.view.pendingMessages[0]?.state, 'accepted')
  assert.equal(client.view.pendingMessages[0]?.runId, 'run-1')
})

test('纯工具轮即使没有助手正文，也投影临时用户轮次与执行步骤', async () => {
  const { client, emit } = connectedClient({
    'session.attach': () => ({ sessionId: context.sessionId, gatewayEpoch: 'epoch-1', seq: 0,
      snapshot: { ...snapshot, pendingTurn: { id: 'pending-tool', role: 'user', content: '整理项目' },
        run: { runId: 'pending-tool', state: 'running', status: '正在读取文件',
          steps: [{ id: 'tool-1', label: '读取文件', state: 'running' }], approval: null } } }),
  })
  await client.connect()
  assert.equal(client.view.pendingTurn?.content, '整理项目')
  assert.equal(client.view.run.steps[0]?.label, '读取文件')
  emit(sessionEvent(1, { pendingTurn: null, run: { runId: 'pending-tool', state: 'done',
    steps: [{ id: 'tool-1', label: '读取文件', state: 'done' }], approval: null } }))
  assert.equal(client.view.pendingTurn, null)
  assert.equal(client.view.run.steps[0]?.state, 'done')
  client.disconnect()
})

test('同一对话重连保留未确认命令，不把它误判为新草稿', async () => {
  const { client } = connectedClient({
    'message.send': () => { throw new Error('REMOTE_CONNECTION_CLOSED') },
  })
  await client.connect()
  await assert.rejects(() => client.sendMessage('继续刚才的任务'), /REMOTE_CONNECTION_CLOSED/)
  const commandId = client.view.pendingMessages[0]?.commandId
  client.handleTransportClosed()
  await client.connect()
  assert.equal(client.view.pendingMessages[0]?.commandId, commandId)
  assert.equal(client.view.pendingMessages[0]?.state, 'unconfirmed')
})

test('官方历史出现本次用户轮次后移除本地待发送气泡', async () => {
  const { client, emit } = connectedClient({
    'message.send': () => ({ accepted: true, runId: 'run-1' }),
    'session.read': () => ({ ...snapshot, seq: 1, turns: [
      ...snapshot.turns,
      { id: 'official-user-2', role: 'user', content: '继续', createdAt: 2 },
    ] }),
  })
  await client.connect()
  await client.sendMessage('继续')
  assert.equal(client.view.pendingMessages.length, 1)
  emit(sessionEvent(1, { run: { state: 'done', steps: [], approval: null } }))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(client.view.pendingMessages.length, 0)
})

test('实时推送不能冒充官方历史提前清掉待确认消息', async () => {
  let reads = 0
  const bridge = fakeTransport({
    'context.get': () => context,
    'session.attach': () => ({ sessionId: context.sessionId, gatewayEpoch: 'epoch-1', seq: 0, snapshot }),
    'message.send': () => ({ accepted: true, runId: 'run-1' }),
    'session.read': () => {
      reads += 1
      return { ...snapshot, seq: 1,
        turns: reads === 1 ? snapshot.turns : [...snapshot.turns, { id: 'official-user', role: 'user', content: '继续' }],
        run: { runId: 'run-1', state: 'done', steps: [], approval: null } }
    },
  })
  const client = new MobileRemoteClient(bridge.transport, { refreshMs: 5 })
  await client.connect()
  await client.sendMessage('继续')
  bridge.emit(sessionEvent(1, { turns: [...snapshot.turns, { id: 'optimistic-user', role: 'user', content: '继续' }],
    run: { runId: 'run-1', state: 'done', steps: [], approval: null } }))
  assert.equal(client.view.pendingMessages[0]?.state, 'accepted', '推送不是官方 Session，不能清除 pending')
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.ok(reads >= 2, '官方历史暂时落后时继续补读')
  assert.equal(client.view.pendingMessages.length, 0)
  client.disconnect()
})

test('已确认命令即使没有推送，也主动补读到 Desktop 最终结果', async () => {
  let reads = 0
  const bridge = fakeTransport({
    'context.get': () => context,
    'session.attach': () => ({
      sessionId: context.sessionId, gatewayEpoch: snapshot.gatewayEpoch, seq: 0, snapshot,
    }),
    'session.read': () => {
      reads += 1
      return {
        ...snapshot,
        turns: [...snapshot.turns,
          { id: 'u2', role: 'user', content: '继续', createdAt: 2 },
          { id: 'a2', role: 'assistant', content: '任务完成', createdAt: 3 }],
        run: { runId: 'run-1', state: 'done', steps: [], approval: null },
      }
    },
    'message.send': () => ({ accepted: true, runId: 'run-1' }),
  })
  const client = new MobileRemoteClient(bridge.transport, { refreshMs: 5 })
  await client.connect()
  await client.sendMessage('继续')
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.ok(reads >= 1)
  assert.equal(client.view.turns.at(-1)?.content, '任务完成')
  assert.equal(client.view.run.state, 'done')
  assert.equal(client.view.pendingMessages.length, 0)
  client.disconnect()
})

test('手机空闲时即使完全丢失 Desktop 主动任务的推送，也会补读到结果', async () => {
  let reads = 0
  const bridge = fakeTransport({
    'context.get': () => context,
    'session.attach': () => ({ sessionId: context.sessionId, gatewayEpoch: 'epoch-1', seq: 0, snapshot }),
    'session.read': () => {
      reads += 1
      return { ...snapshot, seq: 1, turns: [...snapshot.turns,
        { id: 'desktop-user', role: 'user', content: '电脑发起的任务' },
        { id: 'desktop-result', role: 'assistant', content: '电脑已完成' }],
        run: { state: 'done', steps: [], approval: null } }
    },
  })
  const client = new MobileRemoteClient(bridge.transport, { refreshMs: 5 })
  await client.connect()
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.ok(reads > 0, '空闲时也要有低频兜底补读')
  assert.equal(client.view.turns.at(-1)?.content, '电脑已完成')
  client.disconnect()
})

test('电脑切换对话的推送丢失后，空闲补读会重新获取当前对话', async () => {
  const next = { ...context, conversationId: 'b', sessionId: 'jc-v1-b', conversationTitle: '对话 B' }
  let current = context
  const bridge = fakeTransport({
    'context.get': () => current,
    'session.attach': payload => ({ sessionId: payload.sessionId, gatewayEpoch: 'epoch-1', seq: 0,
      snapshot: { ...snapshot, sessionId: payload.sessionId,
        turns: [{ id: `turn-${current.conversationId}`, role: 'assistant', content: current.conversationTitle }] } }),
    'session.read': payload => {
      if (payload.sessionId !== current.sessionId) throw new Error('SESSION_NOT_CURRENT')
      return { ...snapshot, sessionId: current.sessionId,
        turns: [{ id: `turn-${current.conversationId}`, role: 'assistant', content: current.conversationTitle }] }
    },
  })
  const client = new MobileRemoteClient(bridge.transport, { refreshMs: 5 })
  await client.connect()
  current = next // 故意不发送 context.changed
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(client.view.context?.sessionId, next.sessionId)
  assert.equal(client.view.turns[0]?.content, '对话 B')
  assert.deepEqual(bridge.types().filter(type => type === 'message.send'), [], '恢复上下文不能重发副作用命令')
  client.disconnect()
})

test('电脑关闭当前对话且通知丢失时，手机等待下一对话而不留在失效 Session', async () => {
  const next = { ...context, conversationId: 'b', sessionId: 'jc-v1-b', conversationTitle: '对话 B' }
  let current: typeof context | null = context
  const bridge = fakeTransport({
    'context.get': () => current || {},
    'session.attach': payload => ({ sessionId: payload.sessionId, gatewayEpoch: 'epoch-1', seq: 0,
      snapshot: { ...snapshot, sessionId: payload.sessionId } }),
    'session.read': payload => {
      if (payload.sessionId !== current?.sessionId) throw new Error('SESSION_NOT_CURRENT')
      return { ...snapshot, sessionId: current.sessionId }
    },
  })
  const client = new MobileRemoteClient(bridge.transport, { refreshMs: 5, contextRetryMs: 5 })
  await client.connect()
  current = null // 故意不发送 context.changed
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(client.view.state, 'connecting')
  current = next
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(client.view.state, 'connected')
  assert.equal(client.view.context?.sessionId, next.sessionId)
  client.disconnect()
})

test('电脑主动通知当前无对话时，手机等待新对话而不尝试 attach 空 Session', async () => {
  let current = context
  const next = { ...context, conversationId: 'b', sessionId: 'jc-v1-b', conversationTitle: '对话 B' }
  const bridge = fakeTransport({
    'context.get': () => current,
    'session.attach': payload => {
      if (!payload.sessionId) throw new Error('SESSION_NOT_CURRENT')
      return { sessionId: payload.sessionId, gatewayEpoch: 'epoch-1', seq: 0,
        snapshot: { ...snapshot, sessionId: payload.sessionId } }
    },
  })
  const client = new MobileRemoteClient(bridge.transport, { contextRetryMs: 5 })
  await client.connect()
  const attachedBefore = bridge.types().filter(type => type === 'session.attach').length
  bridge.emit({ type: 'context.changed', payload: { ...context, conversationId: '', sessionId: '' } })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(client.view.state, 'connecting')
  assert.equal(bridge.types().filter(type => type === 'session.attach').length, attachedBefore)
  current = next
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(client.view.context?.sessionId, next.sessionId)
  assert.equal(client.view.state, 'connected')
  client.disconnect()
})

test('实时事件断档时重新读取权威快照，不把缺口后的事件直接覆盖屏幕', async () => {
  let reads = 0
  const { client, emit } = connectedClient({
    'session.read': () => {
      reads += 1
      return {
        ...snapshot,
        seq: 3,
        turns: [{ id: 'recovered', role: 'assistant', content: '权威恢复结果', createdAt: 2 }],
      }
    },
  })
  await client.connect()
  emit(sessionEvent(1))
  emit(sessionEvent(3))
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.equal(reads, 1)
  assert.equal(client.view.turns[0]?.content, '权威恢复结果')
})

test('终态事件后补读官方历史，避免页面卸载时事件携带旧轮次', async () => {
  const { client, emit, types } = connectedClient({
    'session.read': () => ({ ...snapshot, seq: 1,
      turns: [...snapshot.turns, { id: 'final', role: 'assistant', content: '官方最终结果' }],
      run: { state: 'done', steps: [], approval: null },
    }),
  })
  await client.connect()
  emit(sessionEvent(1, {
    turns: snapshot.turns,
    run: { state: 'done', steps: [], approval: null },
  }))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.ok(types().includes('session.read'))
  assert.equal(client.view.turns.at(-1)?.content, '官方最终结果')
})

test('attach 读快照期间产生的事件不会落入订阅空窗', async () => {
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const bridge = fakeTransport({
    'context.get': () => context,
    'session.attach': async () => {
      queueMicrotask(() => bridge.emit(sessionEvent(1)))
      await waiting
      return { sessionId: context.sessionId, gatewayEpoch: 'epoch-1', seq: 0, snapshot }
    },
  })
  const client = new MobileRemoteClient(bridge.transport)
  const connecting = client.connect()
  await new Promise(resolve => setTimeout(resolve, 0))
  release()
  await connecting
  assert.equal(client.view.turns[0]?.content, '第 1 版')
  assert.equal(client.view.lastSeq, 1)
  assert.deepEqual(bridge.types(), ['context.get', 'session.attach'])
})

test('attach 快照已包含较新事件时，缓存的旧全量事件不能覆盖它', async () => {
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const bridge = fakeTransport({
    'context.get': () => context,
    'session.attach': async () => {
      queueMicrotask(() => {
        bridge.emit(sessionEvent(1, { turns: [{ id: 'old', role: 'assistant', content: '旧投影' }] }))
        bridge.emit(sessionEvent(2, { turns: [{ id: 'also-old', role: 'assistant', content: '旧推送' }] }))
      })
      await waiting
      return { sessionId: context.sessionId, gatewayEpoch: 'epoch-1', seq: 1,
        snapshot: { ...snapshot, seq: 2, turns: [{ id: 'new', role: 'assistant', content: '权威新快照' }] } }
    },
  })
  const client = new MobileRemoteClient(bridge.transport)
  const connecting = client.connect()
  await new Promise(resolve => setTimeout(resolve, 0))
  release()
  await connecting
  assert.equal(client.view.lastSeq, 2)
  assert.equal(client.view.turns[0]?.content, '权威新快照')
  client.disconnect()
})

test('手机端事件监听注册完成前不得发送 attach', async () => {
  let ready!: (unsubscribe: () => void) => void
  const listenerReady = new Promise<() => void>(resolve => { ready = resolve })
  const calls: string[] = []
  const transport = {
    subscribe: () => listenerReady,
    request: async ({ type }: { type: string }) => {
      calls.push(type)
      if (type === 'context.get') return context
      if (type === 'session.attach') return {
        sessionId: context.sessionId, gatewayEpoch: 'epoch-1', seq: 0, snapshot,
      }
      throw new Error('UNSUPPORTED_MESSAGE')
    },
  } as unknown as MobileRemoteTransport
  const client = new MobileRemoteClient(transport)
  const connecting = client.connect()
  await Promise.resolve()
  assert.deepEqual(calls, [], '监听未就绪时不能启动请求')
  ready(() => undefined)
  await connecting
  assert.deepEqual(calls, ['context.get', 'session.attach'])
})

test('旧补读晚于重连 attach 返回时，不覆盖新快照', async () => {
  let startOldRead!: () => void
  let finishOldRead!: () => void
  const oldReadStarted = new Promise<void>(resolve => { startOldRead = resolve })
  const oldRead = new Promise<unknown>(resolve => {
    finishOldRead = () => resolve({ ...snapshot, turns: [{ id: 'old', role: 'assistant', content: '旧结果' }] })
  })
  let attaches = 0
  const bridge = fakeTransport({
    'context.get': () => context,
    'session.attach': () => {
      attaches += 1
      return { sessionId: context.sessionId, gatewayEpoch: 'epoch-1', seq: attaches - 1,
        snapshot: attaches === 1 ? snapshot : {
          ...snapshot,
          turns: [
            { id: 'new-user', role: 'user', content: '继续' },
            { id: 'new', role: 'assistant', content: '重连后的新结果' },
          ],
          run: { state: 'done', steps: [], approval: null },
        } }
    },
    'session.read': () => { startOldRead(); return oldRead },
    'message.send': () => ({ accepted: true, runId: 'run-1' }),
  })
  const client = new MobileRemoteClient(bridge.transport, { refreshMs: 1 })
  await client.connect()
  await client.sendMessage('继续')
  await oldReadStarted
  await client.connect()
  finishOldRead()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(client.view.turns.at(-1)?.content, '重连后的新结果')
  client.disconnect()
})

test('Desktop Gateway epoch 改变时不用旧序号判断新事件', async () => {
  let reads = 0
  const { client, emit } = connectedClient({
    'session.read': () => {
      reads += 1
      return {
        ...snapshot, gatewayEpoch: 'epoch-2', seq: 1,
        turns: [{ id: 'new-epoch', role: 'assistant', content: '重启后的结果', createdAt: 2 }],
      }
    },
  })
  await client.connect()
  emit(sessionEvent(1))
  emit(sessionEvent(1, { gatewayEpoch: 'epoch-2', turns: [
    { id: 'untrusted', role: 'assistant', content: '不直接覆盖', createdAt: 2 },
  ] }))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(reads, 1)
  assert.equal(client.view.turns[0]?.content, '重启后的结果')
  assert.equal(client.view.lastSeq, 1)
})

test('连接按 context.get → session.attach 建立当前 Session', async () => {
  const { client, types } = connectedClient()

  await client.connect()

  assert.deepEqual(types(), ['context.get', 'session.attach'])
  assert.deepEqual(client.view.context, context)
  assert.deepEqual(client.view.turns, snapshot.turns)
  assert.equal(client.view.lastSeq, 0)
  assert.equal(client.view.state, 'connected')
})

test('重新读取 Session 时恢复尚未持久化的运行状态和流式内容', async () => {
  const { client } = connectedClient({
    'session.attach': () => ({
      sessionId: context.sessionId, gatewayEpoch: snapshot.gatewayEpoch, seq: 0,
      snapshot: {
        ...snapshot,
        streamingText: '电脑正在处理',
        run: { state: 'running', status: '正在执行工具', steps: [{ id: 'step-1', label: '读取文件', state: 'running' }], approval: null },
      },
    }),
  })
  await client.connect()
  assert.equal(client.view.streamingText, '电脑正在处理')
  assert.equal(client.view.run.state, 'running')
  assert.equal(client.view.run.steps[0]?.label, '读取文件')
})

test('回到前台时重新 attach，即使连接从未断开也恢复最新结果', async () => {
  let attaches = 0
  const { client, types } = connectedClient({
    'session.attach': () => {
      attaches += 1
      return { sessionId: context.sessionId, gatewayEpoch: 'epoch-1', seq: attaches,
        snapshot: { ...snapshot, turns: [{ id: `turn-${attaches}`, role: 'assistant', content: `第 ${attaches} 次快照` }] } }
    },
  })
  await client.connect()
  await client.refresh()
  assert.equal(attaches, 2)
  assert.equal(client.view.turns[0]?.content, '第 2 次快照')
  assert.deepEqual(types(), ['context.get', 'session.attach', 'context.get', 'session.attach'])
})

test('回前台时先核对 Desktop 当前对话，再 attach，不能重读旧会话', async () => {
  const next = { ...context, conversationId: 'b', sessionId: 'jc-v1-b', conversationTitle: '对话 B' }
  let current = context
  const bridge = fakeTransport({
    'context.get': () => current,
    'session.attach': payload => ({ sessionId: payload.sessionId, gatewayEpoch: 'epoch-1', seq: 0,
      snapshot: { ...snapshot, sessionId: payload.sessionId,
        turns: [{ id: `turn-${current.conversationId}`, role: 'assistant', content: current.conversationTitle }] } }),
  })
  const client = new MobileRemoteClient(bridge.transport)
  await client.connect()
  current = next
  await client.refresh()
  assert.equal(client.view.context?.sessionId, next.sessionId)
  assert.equal(client.view.turns[0]?.content, '对话 B')
  assert.deepEqual(bridge.types(), ['context.get', 'session.attach', 'context.get', 'session.attach'])
  client.disconnect()
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
  const sends = calls.filter(call => call.type === 'message.send').map(call => call.payload)
  assert.equal(sends.length, 1)
  assert.equal(sends[0]?.sessionId, context.sessionId)
  assert.equal(sends[0]?.text, '继续')
  assert.match(String(sends[0]?.commandId), /^[a-f0-9-]{36}$/)
  assert.equal(client.view.pendingMessages[0]?.state, 'unconfirmed')
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

  emit(sessionEvent(1))
  assert.equal(client.view.turns[0]?.content, '第 1 版')
  assert.equal(client.view.lastSeq, 1)

  emit(sessionEvent(1, { turns: [{ id: 't1', role: 'assistant', content: '重复', createdAt: 1 }] }))
  assert.equal(client.view.turns[0]?.content, '第 1 版')

  emit(sessionEvent(0, { turns: [{ id: 't1', role: 'assistant', content: '旧事件', createdAt: 1 }] }))
  assert.equal(client.view.turns[0]?.content, '第 1 版')
  assert.equal(client.view.lastSeq, 1)
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
    'session.attach': payload => {
      readSessionId = String(payload.sessionId)
      return { sessionId: payload.sessionId, gatewayEpoch: 'epoch-1', seq: 0,
        snapshot: { sessionId: payload.sessionId, turns: [{ id: 'tb', role: 'user', content: '新对话', createdAt: 2 }] } }
    },
  })
  const client = new MobileRemoteClient(bridge.transport)
  await client.connect()
  bridge.emit(sessionEvent(1))
  assert.equal(client.view.turns[0]?.content, '第 1 版')

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
  emit(sessionEvent(1))
  assert.equal(client.view.lastSeq, 1)

  client.disconnect()
  emit(sessionEvent(2))

  assert.equal(client.view.state, 'offline')
  assert.equal(client.view.lastSeq, 1)
})

test('通道断开只置离线，不动已有投影也不猜结果', async () => {
  const { client, emit } = connectedClient()
  await client.connect()
  emit(sessionEvent(1))

  client.handleTransportClosed()

  assert.equal(client.view.state, 'offline')
  assert.equal(client.view.lastSeq, 1)
  assert.deepEqual(client.view.context, context)
  assert.equal(client.view.run.state, 'idle')

  emit(sessionEvent(2))
  assert.equal(client.view.lastSeq, 1)
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

test('电脑上没有打开对话时保持等待，等 context.changed 自动进入', async () => {
  const bridge = fakeTransport({
    'context.get': () => {
      throw 'INVALID_CONTEXT'
    },
    'session.attach': payload => ({ sessionId: payload.sessionId, gatewayEpoch: 'epoch-1', seq: 0, snapshot: { ...snapshot } }),
  })
  const client = new MobileRemoteClient(bridge.transport)

  const failure = await client.connect().then(() => null, error => error)
  assert.match(String(failure), /^INVALID_CONTEXT/)
  // 关键：不能就此离线 —— 离线状态下连 context.changed 都会被忽略，手机永远进不去。
  assert.equal(client.view.state, 'connecting')

  // 用户在电脑上打开了一个对话 → 电脑广播 context.changed（合同 §10.5）
  bridge.emit({
    version: 1,
    requestId: 'ctx-1',
    type: 'context.changed',
    sentAt: Date.now(),
    payload: { ...context },
  })
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.equal(client.view.state, 'connected')
  assert.deepEqual(client.view.turns, snapshot.turns)
  assert.ok(bridge.types().includes('session.attach'), '进入对话要重新订阅当前会话')
  client.disconnect()
})

test('电脑上还没有对话时定时重试，电脑一开对话就自己进入', async () => {
  let attempts = 0
  const bridge = fakeTransport({
    'context.get': () => {
      attempts += 1
      // 前两次电脑上确实没有活动对话（context.sessionId 为空），第三次才打开。
      if (attempts < 3) throw 'INVALID_CONTEXT'
      return { ...context }
    },
    'session.attach': payload => ({ sessionId: payload.sessionId, gatewayEpoch: 'epoch-1', seq: 0, snapshot: { ...snapshot } }),
  })
  const client = new MobileRemoteClient(bridge.transport, { contextRetryMs: 5 })

  const failure = await client.connect().then(() => null, error => error)
  assert.match(String(failure), /^INVALID_CONTEXT/)
  await new Promise(resolve => setTimeout(resolve, 80))

  assert.equal(client.view.state, 'connected')
  assert.deepEqual(client.view.turns, snapshot.turns)
  client.disconnect()
})
