import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { DesktopRemoteHost, type DesktopRemoteEvent } from '@/services/desktopRemoteHost'

const context = {
  projectName: '项目 A',
  conversationTitle: '对话 A',
  conversationId: 'conversation-a',
  sessionId: 'jc-v1-conversation-a',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}

test('Desktop remote context exposes display identity without local paths or configuration', () => {
  const host = new DesktopRemoteHost({
    getContext: () => context,
    readSession: async () => ({ turns: [] }),
    sendMessage: async () => undefined,
    stopRun: async () => 'idle',
    respondApproval: async () => undefined,
    subscribe: () => () => undefined,
  })

  assert.deepEqual(host.context(), context)
  assert.doesNotMatch(JSON.stringify(host.context()), /owner|cwd|path|apiKey|provider/i)
})

test('Desktop remote host reads only the current Session and filters other Session events', async () => {
  let listener: ((event: DesktopRemoteEvent) => void) | undefined
  const host = new DesktopRemoteHost({
    getContext: () => context,
    readSession: async sessionId => ({ sessionId }),
    sendMessage: async () => undefined,
    stopRun: async () => 'idle',
    respondApproval: async () => undefined,
    subscribe: next => {
      listener = next
      return () => { listener = undefined }
    },
  })

  assert.deepEqual(await host.readSession(context.sessionId), { sessionId: context.sessionId })
  await assert.rejects(() => host.readSession('jc-v1-conversation-b'), /SESSION_NOT_FOUND/)

  const received: DesktopRemoteEvent[] = []
  const unsubscribe = host.subscribeSession(context.sessionId, event => received.push(event))
  listener?.({ sessionId: 'jc-v1-conversation-b', seq: 1, type: 'assistant.message', payload: 'wrong' })
  listener?.({ sessionId: context.sessionId, seq: 2, type: 'assistant.message', payload: 'right' })
  unsubscribe()
  assert.deepEqual(received.map(event => event.payload), ['right'])
})

test('Desktop remote host shares one busy guard and never queues a second send', async () => {
  const first = deferred<void>()
  const sent: string[] = []
  const host = new DesktopRemoteHost({
    getContext: () => context,
    readSession: async () => ({ turns: [] }),
    sendMessage: async text => {
      sent.push(text)
      await first.promise
      return { runId: 'run-1' }
    },
    stopRun: async () => 'idle',
    respondApproval: async () => undefined,
    subscribe: () => () => undefined,
  })

  const running = host.sendMessage(context.sessionId, '第一条')
  await assert.rejects(() => host.sendMessage(context.sessionId, '第二条'), /SESSION_BUSY/)
  first.resolve()
  await running
  assert.deepEqual(sent, ['第一条'])
})

test('Desktop remote host delegates stop and exact approval without starting Harness', async () => {
  const calls: string[] = []
  const host = new DesktopRemoteHost({
    getContext: () => context,
    readSession: async () => ({ turns: [] }),
    sendMessage: async () => undefined,
    stopRun: async () => { calls.push('stop'); return 'stopped' },
    respondApproval: async (approvalId, decision) => { calls.push(`${approvalId}:${decision}`) },
    subscribe: () => () => undefined,
  })

  assert.equal(await host.stopRun(context.sessionId), 'stopped')
  await host.respondApproval(context.sessionId, 'approval-1', 'approve')
  assert.deepEqual(calls, ['stop', 'approval-1:approve'])

  const source = readFileSync('src/services/desktopRemoteHost.ts', 'utf8')
  assert.doesNotMatch(source, /deepSeekHarness|runDeepSeekHarness|apiKey|provider/i)
})

test('M2：电脑登记过的非当前对话可读、可发、可停、可审批，依赖收到的是这个对话的 sessionId', async () => {
  const calls: string[] = []
  const background = 'jc-v1-conversation-b'
  const host = new DesktopRemoteHost({
    getContext: () => context,
    hasSession: sessionId => sessionId === background,
    readSession: async sessionId => ({ sessionId }),
    sendMessage: async (text, sessionId) => { calls.push(`send:${sessionId}:${text}`); return { runId: 'run-b' } },
    stopRun: async sessionId => { calls.push(`stop:${sessionId}`); return 'stopped' },
    respondApproval: async (approvalId, decision, sessionId) => { calls.push(`approval:${sessionId}:${approvalId}:${decision}`) },
    isBusy: () => false,
    subscribe: () => () => undefined,
  })
  assert.deepEqual(await host.readSession(background), { sessionId: background })
  assert.deepEqual(await host.sendMessage(background, '后台任务'), { runId: 'run-b' })
  await host.respondApproval(background, 'approval-b', 'approve')
  assert.equal(await host.stopRun(background), 'stopped')
  assert.deepEqual(calls, [
    `send:${background}:后台任务`, `approval:${background}:approval-b:approve`, `stop:${background}`,
  ])
})

test('M2：电脑没登记过的对话一律拒绝，读、发、停、审批、订阅都不放行', async () => {
  const host = new DesktopRemoteHost({
    getContext: () => context,
    hasSession: () => false,
    readSession: async () => { throw new Error('不该读取') },
    sendMessage: async () => { throw new Error('不该发送') },
    stopRun: async () => { throw new Error('不该停止') },
    respondApproval: async () => { throw new Error('不该审批') },
    subscribe: () => () => undefined,
  })
  const unknown = 'jc-v1-somewhere-else'
  await assert.rejects(() => host.readSession(unknown), /SESSION_NOT_FOUND/)
  await assert.rejects(() => host.sendMessage(unknown, '你好'), /SESSION_NOT_FOUND/)
  await assert.rejects(() => host.stopRun(unknown), /SESSION_NOT_FOUND/)
  await assert.rejects(() => host.respondApproval(unknown, 'a', 'approve'), /SESSION_NOT_FOUND/)
  assert.throws(() => host.subscribeSession(unknown, () => undefined), /SESSION_NOT_FOUND/)
})

test('M2：忙锁按对话分开——A 在发送时 B 照样能发，同一对话的第二条仍是 SESSION_BUSY', async () => {
  const first = deferred<void>()
  const background = 'jc-v1-conversation-b'
  const host = new DesktopRemoteHost({
    getContext: () => context,
    hasSession: sessionId => sessionId === background,
    readSession: async () => ({ turns: [] }),
    sendMessage: async (_text, sessionId) => {
      if (sessionId === context.sessionId) await first.promise
      return { runId: `run-${sessionId}` }
    },
    stopRun: async () => 'idle',
    respondApproval: async () => undefined,
    subscribe: () => () => undefined,
  })
  const runningA = host.sendMessage(context.sessionId, 'A 的任务')
  await assert.rejects(() => host.sendMessage(context.sessionId, 'A 的第二条'), /SESSION_BUSY/)
  assert.deepEqual(await host.sendMessage(background, 'B 的任务'), { runId: `run-${background}` })
  first.resolve()
  await runningA
})

test('M2：订阅后台对话只收这个对话的事件', () => {
  let listener: ((event: DesktopRemoteEvent) => void) | undefined
  const background = 'jc-v1-conversation-b'
  const host = new DesktopRemoteHost({
    getContext: () => context,
    hasSession: sessionId => sessionId === background,
    readSession: async () => ({}),
    sendMessage: async () => undefined,
    stopRun: async () => 'idle',
    respondApproval: async () => undefined,
    subscribe: next => { listener = next; return () => { listener = undefined } },
  })
  const received: unknown[] = []
  const stop = host.subscribeSession(background, event => received.push(event.payload))
  listener?.({ sessionId: context.sessionId, seq: 1, type: 'session.event', payload: 'A' })
  listener?.({ sessionId: background, seq: 1, type: 'session.event', payload: 'B' })
  stop()
  assert.deepEqual(received, ['B'])
})
