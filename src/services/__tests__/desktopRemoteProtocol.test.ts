import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createPairingRegistry,
  createRemoteRateLimiter,
  parseRemoteEnvelope,
  remoteAuditEntry,
  type RemotePairingOffer,
} from '@/services/desktopRemoteProtocol'

const device = { deviceId: 'iphone-1', name: 'iPhone', publicKey: 'mobile-public-key' }

function fixedRegistry() {
  let id = 0
  return createPairingRegistry({
    now: () => 1_000,
    randomId: () => `random-${++id}`,
  })
}

test('remote pairing requires an unexpired one-time offer and Desktop approval', () => {
  const registry = fixedRegistry()
  const offer = registry.createOffer('wss://192.168.1.2:9527', 'desktop-public-key')

  registry.requestPairing(offer, device)
  assert.throws(() => registry.deviceCredential(device.deviceId), { message: /PAIRING_NOT_APPROVED/ })
  assert.throws(() => registry.requestPairing(offer, device), { message: /PAIRING_OFFER_USED/ })

  const credential = registry.approvePairing(offer.offerId)
  assert.equal(credential.deviceId, device.deviceId)
  assert.equal(registry.authenticate(credential.deviceId, credential.token), true)
})

test('remote pairing rejects expired and tampered offers', () => {
  let now = 1_000
  let id = 0
  const registry = createPairingRegistry({ now: () => now, randomId: () => `random-${++id}` })
  const offer = registry.createOffer('wss://192.168.1.2:9527', 'desktop-public-key')

  const tampered: RemotePairingOffer = { ...offer, address: 'wss://attacker.invalid' }
  assert.throws(() => registry.requestPairing(tampered, device), { message: /PAIRING_OFFER_INVALID/ })

  now = offer.expiresAt + 1
  assert.throws(() => registry.requestPairing(offer, device), { message: /PAIRING_OFFER_EXPIRED/ })
})

test('remote pairing cannot be approved after expiry or explicit rejection', () => {
  let now = 1_000
  let id = 0
  const registry = createPairingRegistry({ now: () => now, randomId: () => `random-${++id}` })
  const expired = registry.createOffer('wss://192.168.1.2:9527', 'desktop-public-key')
  registry.requestPairing(expired, device)
  now = expired.expiresAt + 1
  assert.throws(() => registry.approvePairing(expired.offerId), { message: /PAIRING_OFFER_EXPIRED/ })

  now = 1_000
  const rejected = registry.createOffer('wss://192.168.1.2:9527', 'desktop-public-key')
  registry.requestPairing(rejected, device)
  registry.rejectPairing(rejected.offerId)
  assert.throws(() => registry.approvePairing(rejected.offerId), { message: /PAIRING_REQUEST_NOT_FOUND/ })
})

test('revoked remote devices cannot authenticate again', () => {
  const registry = fixedRegistry()
  const offer = registry.createOffer('wss://192.168.1.2:9527', 'desktop-public-key')
  registry.requestPairing(offer, device)
  const credential = registry.approvePairing(offer.offerId)

  registry.revokeDevice(device.deviceId)
  assert.equal(registry.authenticate(credential.deviceId, credential.token), false)
})

test('remote envelopes reject replay, oversized frames, and unknown messages', () => {
  const seen = new Set<string>()
  const envelope = JSON.stringify({
    version: 1,
    requestId: 'request-1',
    type: 'context.get',
    sentAt: 1_000,
    payload: {},
  })

  assert.equal(parseRemoteEnvelope(envelope, { now: 1_000, seenRequestIds: seen }).type, 'context.get')
  assert.throws(
    () => parseRemoteEnvelope(envelope, { now: 1_000, seenRequestIds: seen }),
    { message: /REPLAYED_REQUEST/ },
  )
  assert.throws(
    () => parseRemoteEnvelope(JSON.stringify({
      version: 1, requestId: 'request-2', type: 'unknown', sentAt: 1_000, payload: {},
    }), { now: 1_000 }),
    { message: /UNSUPPORTED_MESSAGE/ },
  )
  assert.throws(
    () => parseRemoteEnvelope(envelope.padEnd(1025, ' '), { now: 1_000, maxBytes: 1024 }),
    { message: /FRAME_TOO_LARGE/ },
  )
  assert.throws(
    () => parseRemoteEnvelope(JSON.stringify({
      version: 1, requestId: '../secret', type: 'context.get', sentAt: 1_000, payload: {},
    }), { now: 1_000 }),
    { message: /INVALID_REQUEST_ID/ },
  )
})

test('切换当前对话的 context.changed 是协议消息而不是未知类型', () => {
  const envelope = parseRemoteEnvelope(JSON.stringify({
    version: 1,
    requestId: 'context-1',
    type: 'context.changed',
    sentAt: 1_000,
    payload: { projectName: '项目 A', conversationTitle: '对话 B', conversationId: 'b', sessionId: 'jc-v1-b' },
  }), { now: 1_000 })

  assert.equal(envelope.type, 'context.changed')
})

test('remote rate limits are isolated per device and reset after the fixed window', () => {
  let now = 1_000
  const limiter = createRemoteRateLimiter({ limit: 2, windowMs: 1_000, now: () => now })
  limiter.assertAllowed('iphone-1')
  limiter.assertAllowed('iphone-1')
  assert.throws(() => limiter.assertAllowed('iphone-1'), { message: /RATE_LIMITED/ })
  assert.doesNotThrow(() => limiter.assertAllowed('iphone-2'))
  now = 2_001
  assert.doesNotThrow(() => limiter.assertAllowed('iphone-1'))
})

test('remote audit entries expose metadata only, never message or credential bodies', () => {
  const entry = remoteAuditEntry({
    type: 'message.send',
    requestId: 'request-1',
    deviceId: 'iphone-1',
    status: 'accepted',
  })
  assert.deepEqual(entry, {
    type: 'message.send',
    requestId: 'request-1',
    deviceId: 'iphone-1',
    status: 'accepted',
  })
  assert.doesNotMatch(JSON.stringify(entry), /prompt|payload|token|path|tool/i)
})
