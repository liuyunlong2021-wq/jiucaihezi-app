import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { DesktopRemoteHost } from '@/services/desktopRemoteHost'
import { __desktopRemoteBridgeForTests } from '@/services/desktopRemoteBridge'

const context = {
  projectName: '项目 A', conversationTitle: '对话 A', conversationId: 'a', sessionId: 'jc-v1-a',
}

test('Desktop bridge dispatches the minimal protocol through the existing Host', async () => {
  const calls: string[] = []
  const host = new DesktopRemoteHost({
    getContext: () => context,
    readSession: async sessionId => ({ sessionId, turns: [] }),
    sendMessage: async text => { calls.push(`send:${text}`) },
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
    { sessionId: context.sessionId, turns: [] },
  )
  assert.deepEqual(
    await __desktopRemoteBridgeForTests.dispatch(host, request('session.subscribe', { sessionId: context.sessionId })),
    { subscribed: true, sessionId: context.sessionId },
  )
  await __desktopRemoteBridgeForTests.dispatch(host, request('message.send', { sessionId: context.sessionId, text: '继续' }))
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
