export const REMOTE_PROTOCOL_VERSION = 1 as const
export const REMOTE_PAIRING_TTL_MS = 5 * 60 * 1000

const REMOTE_MESSAGE_TYPES = new Set([
  'gateway.health',
  'context.get',
  'session.read',
  'session.attach',
  'session.subscribe',
  'message.send',
  'run.stop',
  'approval.respond',
  'context.changed',
  'session.snapshot',
  'session.event',
  'run.state',
  'ping',
  'pong',
])

export type RemoteEnvelope = {
  version: typeof REMOTE_PROTOCOL_VERSION
  requestId: string
  type: string
  sentAt: number
  payload: unknown
}

export type RemotePairingOffer = {
  version: typeof REMOTE_PROTOCOL_VERSION
  address: string
  desktopPublicKey: string
  offerId: string
  expiresAt: number
}

type RemoteDevice = {
  deviceId: string
  name: string
  publicKey: string
}

type PairingRecord = {
  offer: RemotePairingOffer
  device?: RemoteDevice
  credential?: { deviceId: string; token: string }
  used: boolean
}

export class RemoteProtocolError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'RemoteProtocolError'
  }
}

export function createPairingRegistry(options: {
  now?: () => number
  randomId?: () => string
} = {}) {
  const now = options.now ?? Date.now
  const randomId = options.randomId ?? (() => crypto.randomUUID())
  const offers = new Map<string, PairingRecord>()
  const credentials = new Map<string, string>()

  function createOffer(address: string, desktopPublicKey: string): RemotePairingOffer {
    const offer: RemotePairingOffer = {
      version: REMOTE_PROTOCOL_VERSION,
      address,
      desktopPublicKey,
      offerId: randomId(),
      expiresAt: now() + REMOTE_PAIRING_TTL_MS,
    }
    offers.set(offer.offerId, { offer, used: false })
    return offer
  }

  function requestPairing(presented: RemotePairingOffer, device: RemoteDevice) {
    const record = offers.get(presented.offerId)
    if (!record
      || record.offer.version !== presented.version
      || record.offer.address !== presented.address
      || record.offer.desktopPublicKey !== presented.desktopPublicKey
      || record.offer.expiresAt !== presented.expiresAt)
      throw new RemoteProtocolError('PAIRING_OFFER_INVALID')
    if (now() > record.offer.expiresAt) throw new RemoteProtocolError('PAIRING_OFFER_EXPIRED')
    if (record.used) throw new RemoteProtocolError('PAIRING_OFFER_USED')
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(device.deviceId)
      || !device.name.trim()
      || device.name.length > 128
      || !device.publicKey
      || device.publicKey.length > 4096)
      throw new RemoteProtocolError('PAIRING_DEVICE_INVALID')
    record.used = true
    record.device = { ...device }
  }

  function approvePairing(offerId: string) {
    const record = offers.get(offerId)
    if (!record?.device) throw new RemoteProtocolError('PAIRING_REQUEST_NOT_FOUND')
    if (now() > record.offer.expiresAt) throw new RemoteProtocolError('PAIRING_OFFER_EXPIRED')
    if (record.credential) throw new RemoteProtocolError('PAIRING_ALREADY_APPROVED')
    const credential = { deviceId: record.device.deviceId, token: randomId() }
    record.credential = credential
    credentials.set(credential.deviceId, credential.token)
    return { ...credential }
  }

  function deviceCredential(deviceId: string) {
    const record = [...offers.values()].find(item => item.device?.deviceId === deviceId)
    if (!record?.credential) throw new RemoteProtocolError('PAIRING_NOT_APPROVED')
    return { ...record.credential }
  }

  return {
    createOffer,
    requestPairing,
    approvePairing,
    rejectPairing: (offerId: string) => { offers.delete(offerId) },
    deviceCredential,
    authenticate: (deviceId: string, token: string) => credentials.get(deviceId) === token,
    revokeDevice: (deviceId: string) => { credentials.delete(deviceId) },
  }
}

export function parseRemoteEnvelope(raw: string, options: {
  now?: number
  maxBytes?: number
  maxClockSkewMs?: number
  seenRequestIds?: Set<string>
} = {}): RemoteEnvelope {
  if (new TextEncoder().encode(raw).byteLength > (options.maxBytes ?? 64 * 1024))
    throw new RemoteProtocolError('FRAME_TOO_LARGE')

  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new RemoteProtocolError('INVALID_MESSAGE') }
  if (!parsed || typeof parsed !== 'object') throw new RemoteProtocolError('INVALID_MESSAGE')
  const value = parsed as Partial<RemoteEnvelope>
  if (value.version !== REMOTE_PROTOCOL_VERSION) throw new RemoteProtocolError('UNSUPPORTED_VERSION')
  if (typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.requestId))
    throw new RemoteProtocolError('INVALID_REQUEST_ID')
  if (typeof value.type !== 'string' || !REMOTE_MESSAGE_TYPES.has(value.type))
    throw new RemoteProtocolError('UNSUPPORTED_MESSAGE')
  if (typeof value.sentAt !== 'number' || !Number.isFinite(value.sentAt))
    throw new RemoteProtocolError('INVALID_TIMESTAMP')
  if (Math.abs((options.now ?? Date.now()) - value.sentAt) > (options.maxClockSkewMs ?? 5 * 60 * 1000))
    throw new RemoteProtocolError('STALE_MESSAGE')
  if (options.seenRequestIds?.has(value.requestId)) throw new RemoteProtocolError('REPLAYED_REQUEST')
  options.seenRequestIds?.add(value.requestId)
  return value as RemoteEnvelope
}

export function createRemoteRateLimiter(options: {
  limit: number
  windowMs: number
  now?: () => number
}) {
  const now = options.now ?? Date.now
  const windows = new Map<string, { startedAt: number; count: number }>()
  return {
    assertAllowed(deviceId: string) {
      const current = now()
      let window = windows.get(deviceId)
      if (!window || current - window.startedAt >= options.windowMs) {
        window = { startedAt: current, count: 0 }
        windows.set(deviceId, window)
      }
      if (window.count >= options.limit) throw new RemoteProtocolError('RATE_LIMITED')
      window.count += 1
    },
  }
}

export function remoteAuditEntry(entry: {
  type: string
  requestId: string
  deviceId: string
  status: string
}) {
  return { ...entry }
}
