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
  await assert.rejects(() => host.readSession('jc-v1-conversation-b'), /SESSION_NOT_CURRENT/)

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
