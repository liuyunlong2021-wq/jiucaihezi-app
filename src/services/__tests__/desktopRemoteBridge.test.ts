import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DesktopRemoteHost } from '@/services/desktopRemoteHost'
import { __desktopRemoteBridgeForTests, bindDesktopRemoteRuntime } from '@/services/desktopRemoteBridge'
import { desktopRemoteEventCursor, nextDesktopRemoteEventSeq } from '@/services/desktopRemoteEventSeq'
import {
  desktopConversationContext,
  desktopConversationRuns,
  desktopRemoteSyncError,
  desktopRemoteOfficialHistoryReady,
  createDesktopConversationHost,
  memoryRunKey,
  readDesktopConversationSession,
  setDesktopConversationSelection,
  startDesktopConversationPublisher,
  type MemoryRun,
} from '@/services/desktopConversationRuntime'

const context = {
  projectName: '项目 A', conversationTitle: '对话 A', conversationId: 'a', sessionId: 'jc-v1-a',
}

test('Desktop bridge dispatches the minimal protocol through the existing Host', async () => {
  const calls: string[] = []
  const host = new DesktopRemoteHost({
    getContext: () => context,
    readSession: async sessionId => ({ sessionId, gatewayEpoch: 'epoch-1', seq: 0, turns: [] }),
    sendMessage: async text => { calls.push(`send:${text}`); return { runId: 'run-1' } },
    stopRun: async () => { calls.push('stop'); return 'stopped' },
    respondApproval: async (id, decision) => { calls.push(`approval:${id}:${decision}`) },
    subscribe: () => () => undefined,
  })
  const request = (type: string, payload: Record<string, unknown> = {}) => ({
    requestId: crypto.randomUUID(), type, payload, deviceId: 'iphone-1',
  })

  assert.deepEqual(await __desktopRemoteBridgeForTests.dispatch(host, request('context.get')), context)
  assert.deepEqual(
    await __desktopRemoteBridgeForTests.dispatch(host, request('session.read', { sessionId: context.sessionId })),
    { sessionId: context.sessionId, gatewayEpoch: 'epoch-1', seq: 0, turns: [] },
  )
  assert.deepEqual(
    await __desktopRemoteBridgeForTests.dispatch(host, request('session.attach', { sessionId: context.sessionId })),
    { sessionId: context.sessionId, ...desktopRemoteEventCursor(context.sessionId),
      snapshot: { sessionId: context.sessionId, gatewayEpoch: 'epoch-1', seq: 0, turns: [] } },
  )
  assert.deepEqual(
    await __desktopRemoteBridgeForTests.dispatch(host, request('session.subscribe', { sessionId: context.sessionId })),
    { subscribed: true, sessionId: context.sessionId },
  )
  assert.deepEqual(
    await __desktopRemoteBridgeForTests.dispatch(host, request('message.send', { sessionId: context.sessionId, text: '继续', commandId: 'cmd-basic' })),
    { accepted: true, runId: 'run-1' },
  )
  await __desktopRemoteBridgeForTests.dispatch(host, request('run.stop', { sessionId: context.sessionId }))
  await __desktopRemoteBridgeForTests.dispatch(host, request('approval.respond', {
    sessionId: context.sessionId, approvalId: 'approval-1', decision: 'approve',
  }))
  assert.deepEqual(calls, ['send:继续', 'stop', 'approval:approval-1:approve'])
})

test('Desktop bridge rejects another Session and unsupported protocol messages', async () => {
  const host = new DesktopRemoteHost({
    getContext: () => context,
    readSession: async () => ({ turns: [] }),
    sendMessage: async () => undefined,
    stopRun: async () => 'idle',
    respondApproval: async () => undefined,
    subscribe: () => () => undefined,
  })
  await assert.rejects(() => __desktopRemoteBridgeForTests.dispatch(host, {
    requestId: 'r1', type: 'session.read', payload: { sessionId: 'jc-v1-b' }, deviceId: 'iphone-1',
  }), /SESSION_NOT_CURRENT/)
  await assert.rejects(() => __desktopRemoteBridgeForTests.dispatch(host, {
    requestId: 'r2', type: 'project.delete', payload: {}, deviceId: 'iphone-1',
  }), /UNSUPPORTED_MESSAGE/)
})

test('attach 读取中发生事件时重读投影，不把旧历史当作新基线', async () => {
  const sessionId = 'jc-v1-attach-race'
  let reads = 0
  let finishRead: (() => void) | undefined
  const reading = new Promise<void>(resolve => { finishRead = resolve })
  const host = new DesktopRemoteHost({
    getContext: () => ({ ...context, sessionId }),
    readSession: async () => {
      reads += 1
      if (reads === 1) {
        await reading
        return { sessionId, ...desktopRemoteEventCursor(sessionId), turns: [{ id: 'old', role: 'assistant', content: '旧历史' }] }
      }
      return { sessionId, ...desktopRemoteEventCursor(sessionId), turns: [{ id: 'new', role: 'assistant', content: '新历史' }] }
    },
    sendMessage: async () => undefined,
    stopRun: async () => 'idle',
    respondApproval: async () => undefined,
    subscribe: () => () => undefined,
  })
  const before = desktopRemoteEventCursor(sessionId)
  const attaching = __desktopRemoteBridgeForTests.dispatch(host, {
    requestId: 'attach-race', type: 'session.attach', payload: { sessionId }, deviceId: 'iphone-1',
  })
  nextDesktopRemoteEventSeq(sessionId)
  finishRead?.()
  const result = await attaching as { seq: number; snapshot: { seq: number; turns: Array<{ content: string }> } }
  assert.equal(reads, 2)
  assert.equal(result.seq, before.seq + 1)
  assert.equal(result.snapshot.seq, result.seq)
  assert.equal(result.snapshot.turns[0]?.content, '新历史')
})

test('持续流式事件不让 attach 无限重读，最后一次读取期间的事件留给手机重放', async () => {
  const sessionId = 'jc-v1-attach-stream'
  let reads = 0
  const host = new DesktopRemoteHost({
    getContext: () => ({ ...context, sessionId }),
    readSession: async () => {
      reads += 1
      nextDesktopRemoteEventSeq(sessionId)
      return { sessionId, ...desktopRemoteEventCursor(sessionId), turns: [] }
    },
    sendMessage: async () => undefined,
    stopRun: async () => 'idle',
    respondApproval: async () => undefined,
    subscribe: () => () => undefined,
  })
  const result = await __desktopRemoteBridgeForTests.dispatch(host, {
    requestId: 'attach-stream', type: 'session.attach', payload: { sessionId }, deviceId: 'iphone-1',
  }) as { seq: number; snapshot: { seq: number } }
  assert.equal(reads, 2)
  assert.equal(result.seq, desktopRemoteEventCursor(sessionId).seq - 1)
  assert.equal(result.snapshot.seq, result.seq + 1, '快照自己的游标不能被较早的 attach 基线覆盖')
})

test('Desktop LAN listener is user-started and uses Noise instead of plaintext business frames', () => {
  const rust = readFileSync('src-tauri/src/commands/remote_bridge.rs', 'utf8')
  const lib = readFileSync('src-tauri/src/lib.rs', 'utf8')
  const settings = readFileSync('src/components/memory/DesktopRemoteSettings.vue', 'utf8')
  assert.match(rust, /Noise_XX_25519_ChaChaPoly_BLAKE2s/)
  assert.match(rust, /TcpListener::bind\("0\.0\.0\.0:0"\)/)
  assert.doesNotMatch(lib, /remote_bridge::start\(/)
  assert.match(settings, /默认关闭/)
  assert.match(settings, /startRemoteBridge/)
  assert.match(settings, /approveRemotePairing/)
})

test('Desktop remote treats a catalog-only new conversation as an empty lazy Harness session', () => {
  const runtime = readFileSync('src/services/desktopConversationRuntime.ts', 'utf8')
  assert.match(runtime, /listDeepSeekHarnessSessions/)
  assert.match(runtime, /if \(!deepSeekSessionExists\(sessions, selected\.conversationId\)\)/)
  assert.match(runtime, /snapshot \? desktopRemoteTurns\(deepSeekSessionTurns\(snapshot\)\) : \[\]/)
})

test('a stale official Session does not finalize a repeated remote prompt or a pure tool round', () => {
  const sentAt = '2026-09-28T12:00:00.000Z'
  const event = (seq: number, time: number) => ({ seq, type: 'user/message', time, data: {
    id: `user-${seq}`, source: { kind: 'user' }, content: [{ type: 'text', text: '整理项目' }],
  } })
  const old = { session: { id: 'jc-v1-a' }, events: [event(1, Date.parse(sentAt) - 60_000)] }
  const current = { session: { id: 'jc-v1-a' }, events: [...old.events, event(2, Date.parse(sentAt) + 1000)] }
  assert.equal(desktopRemoteOfficialHistoryReady(old, 1, '整理项目', sentAt), false)
  assert.equal(desktopRemoteOfficialHistoryReady(old, 0, '整理项目', sentAt), false,
    '页面旧历史不完整时，不能把更早的同文消息误认成本次')
  assert.equal(desktopRemoteOfficialHistoryReady(current, 1, '整理项目', sentAt), true,
    '纯工具轮没有 assistant 正文，也必须能由官方 user/message 证明同步完成')
})

test('application-owned selection remains readable without a workbench view and rejects another session', async () => {
  setDesktopConversationSelection({
    projectName: '项目 A', conversationTitle: '对话 A', conversationId: 'a',
    owner: '/project', resourcePath: 'chat-a', modelId: 'model-a', fileAccessEnabled: false, turns: [],
  })
  try {
    assert.deepEqual(desktopConversationContext(), context)
    await assert.rejects(() => readDesktopConversationSession('jc-v1-b'), /SESSION_NOT_CURRENT/)
  } finally {
    setDesktopConversationSelection(null)
  }
})

test('app-level Host starts and finishes the same remote run after the workbench view is gone', async () => {
  let finish!: (reply: string) => void
  const execution = new Promise<string>(resolve => { finish = resolve })
  const key = memoryRunKey('/project', 'chat-a')
  setDesktopConversationSelection({
    projectName: '项目 A', conversationTitle: '对话 A', conversationId: 'a',
    owner: '/project', resourcePath: 'chat-a', modelId: 'model-a', fileAccessEnabled: false, turns: [],
  })
  try {
    const host = createDesktopConversationHost(async () => await execution)
    const receipt = await host.sendMessage(context.sessionId, '手机发来的任务')
    assert.ok(receipt.runId)
    const run = desktopConversationRuns.get(key)
    assert.equal(run?.userTurn?.content, '手机发来的任务')
    // 页面已经没有订阅者；应用级 selection 和 run 仍然有效。
    finish('电脑完成')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(run?.phase, 'done')
    assert.equal(run?.streamingText, '电脑完成')
  } finally {
    desktopConversationRuns.delete(key)
    setDesktopConversationSelection(null)
  }
})

test('app-level Host shares busy, stop and approval with the Desktop run without a view', async () => {
  let finish!: (reply: string) => void
  const execution = new Promise<string>(resolve => { finish = resolve })
  const key = memoryRunKey('/project', 'chat-a')
  setDesktopConversationSelection({
    projectName: '项目 A', conversationTitle: '对话 A', conversationId: 'a',
    owner: '/project', resourcePath: 'chat-a', modelId: 'model-a', fileAccessEnabled: false, turns: [],
  })
  try {
    const host = createDesktopConversationHost(async () => await execution)
    await host.sendMessage(context.sessionId, '执行工具')
    await assert.rejects(() => host.sendMessage(context.sessionId, '并发消息'), /SESSION_BUSY/)
    const run = desktopConversationRuns.get(key)!
    let approved = ''
    run.approval = { id: 'approval-1', message: '允许执行？', resolve: decision => { approved = decision } }
    await host.respondApproval(context.sessionId, 'approval-1', 'approve')
    assert.equal(approved, 'once')
    await assert.rejects(() => host.respondApproval(context.sessionId, 'approval-1', 'approve'), /APPROVAL_NOT_FOUND/)
    assert.equal(await host.stopRun(context.sessionId), 'stopped')
    assert.equal(run.controller.signal.aborted, true)
    finish('停止后迟到的结果')
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(run.phase, 'stopped', '迟到的完成不能把已停止任务改回 done')
  } finally {
    desktopConversationRuns.delete(key)
    setDesktopConversationSelection(null)
  }
})

test('Desktop app binds the remote Host before the workbench view exists', () => {
  const app = readFileSync('src/App.vue', 'utf8')
  const workbench = readFileSync('src/components/memory/MemoryWorkbench.vue', 'utf8')
  assert.match(app, /bindDesktopRemoteRuntime\(createDesktopConversationHost\(\)\)/)
  assert.doesNotMatch(workbench, /createDesktopRemoteHost\(|bindDesktopRemoteRuntime\(/)
  assert.match(workbench, /watch\(desktopRemoteCompleted, completed =>/)
})

test('application publisher sends run progress after the workbench view is gone', async () => {
  const previousWindow = globalThis.window
  const published: Array<{ sessionId?: string; event?: { type?: string; payload?: { run?: { status?: string } } } }> = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: { invoke: async (command: string, args?: typeof published[number]) => {
      if (command === 'remote_bridge_publish' && args) published.push(args)
    } } },
  })
  const key = memoryRunKey('/project', 'chat-a')
  const stop = startDesktopConversationPublisher()
  try {
    setDesktopConversationSelection({
      projectName: '项目 A', conversationTitle: '对话 A', conversationId: 'a',
      owner: '/project', resourcePath: 'chat-a', modelId: 'model-a', fileAccessEnabled: false, turns: [],
    })
    desktopConversationRuns.set(key, {
      runId: 'run-1', phase: 'running', status: '正在思考', error: '', streamingText: '', steps: [],
      userTurn: null, approval: null,
    } as MemoryRun)
    desktopConversationRuns.get(key)!.status = '正在执行工具'
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.ok(published.some(item => item.sessionId === context.sessionId
      && item.event?.type === 'session.event'
      && item.event.payload?.run?.status === '正在执行工具'))
  } finally {
    stop()
    setDesktopConversationSelection(null)
    desktopConversationRuns.delete(key)
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
  }
})

test('application publisher keeps a failed mobile sync visible to Desktop', async () => {
  const previousWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: { invoke: async () => { throw new Error('connection closed') } } },
  })
  setDesktopConversationSelection({
    projectName: '项目 A', conversationTitle: '对话 A', conversationId: 'a',
    owner: '/project', resourcePath: 'chat-a', modelId: 'model-a', fileAccessEnabled: false, turns: [],
  })
  const stop = startDesktopConversationPublisher()
  try {
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.match(desktopRemoteSyncError.value, /手机状态同步失败.*connection closed/)
    assert.match(readFileSync('src/components/memory/MemoryWorkbench.vue', 'utf8'), /displayedError = computed\([^\n]*desktopRemoteSyncError\.value/)
  } finally {
    stop()
    desktopRemoteSyncError.value = ''
    setDesktopConversationSelection(null)
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
  }
})

test('message.send only acknowledges a concrete Desktop run', async () => {
  const host = new DesktopRemoteHost({
    getContext: () => context,
    readSession: async () => ({ turns: [] }),
    sendMessage: async () => undefined,
    stopRun: async () => 'idle',
    respondApproval: async () => undefined,
    subscribe: () => () => undefined,
  })
  await assert.rejects(() => __desktopRemoteBridgeForTests.dispatch(host, {
    requestId: 'send-1', type: 'message.send',
    payload: { sessionId: context.sessionId, text: '继续', commandId: 'command-1' },
    deviceId: 'iphone-1',
  }), /RUN_NOT_STARTED/, '没有建立 run 时不能回 accepted')
})

test('同一设备同一 commandId 只建立一个 run，换正文则拒绝', async () => {
  let sends = 0
  const host = new DesktopRemoteHost({
    getContext: () => context,
    readSession: async () => ({ turns: [] }),
    sendMessage: async () => ({ runId: `run-${++sends}` }),
    stopRun: async () => 'idle',
    respondApproval: async () => undefined,
    subscribe: () => () => undefined,
  })
  const request = (text: string) => ({
    requestId: crypto.randomUUID(), type: 'message.send', deviceId: 'iphone-idempotent',
    payload: { sessionId: context.sessionId, text, commandId: 'cmd-repeat' },
  })
  const first = await __desktopRemoteBridgeForTests.dispatch(host, request('继续'))
  assert.deepEqual(await __desktopRemoteBridgeForTests.dispatch(host, request('继续')), first)
  assert.equal(sends, 1)
  await assert.rejects(() => __desktopRemoteBridgeForTests.dispatch(host, request('另一条')), /COMMAND_ID_CONFLICT/)
  assert.equal(sends, 1)
})

test('工作台页面卸载后，应用级 Gateway 仍能接受手机命令', async () => {
  const previousWindow = globalThis.window
  const responses: Array<{ requestId: string; result?: unknown; error?: string }> = []
  let nativeListener: ((event: { payload: unknown }) => void) | undefined
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        transformCallback: (callback: typeof nativeListener) => { nativeListener = callback; return 1 },
        invoke: async (command: string, args?: Record<string, unknown>) => {
          if (command === 'plugin:event|listen') return 1
          if (command === 'remote_bridge_complete') responses.push(args as typeof responses[number])
          return undefined
        },
      },
    },
  })
  const host = new DesktopRemoteHost({
    getContext: () => context,
    readSession: async () => ({ turns: [] }),
    sendMessage: async () => ({ runId: 'run-after-unmount' }),
    stopRun: async () => 'idle',
    respondApproval: async () => undefined,
    subscribe: () => () => undefined,
  })
  try {
    await bindDesktopRemoteRuntime(host)
    nativeListener?.({ payload: {
      requestId: 'health-after-unmount', type: 'gateway.health', payload: {}, deviceId: 'iphone-1',
    } })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(responses[0]?.requestId, 'health-after-unmount')
    assert.equal((responses[0]?.result as { runtimeAvailable?: boolean })?.runtimeAvailable, true)
    assert.equal(typeof (responses[0]?.result as { gatewayEpoch?: string })?.gatewayEpoch, 'string')
    nativeListener?.({ payload: {
      requestId: 'send-after-unmount', type: 'message.send',
      payload: { sessionId: context.sessionId, text: '继续', commandId: 'cmd-after-unmount' },
      deviceId: 'iphone-1',
    } })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(responses[1]?.result, { accepted: true, runId: 'run-after-unmount' })
    const nextContext = { ...context, conversationId: 'b', sessionId: 'jc-v1-b' }
    await bindDesktopRemoteRuntime(new DesktopRemoteHost({
      getContext: () => nextContext,
      readSession: async () => ({ turns: [] }),
      sendMessage: async () => ({ runId: 'run-new-page' }),
      stopRun: async () => 'idle',
      respondApproval: async () => undefined,
      subscribe: () => () => undefined,
    }))
    nativeListener?.({ payload: {
      requestId: 'context-after-remount', type: 'context.get', payload: {}, deviceId: 'iphone-1',
    } })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(responses[2]?.result, nextContext, '页面重挂后应改用新视图的当前对话')
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow })
  }
})
