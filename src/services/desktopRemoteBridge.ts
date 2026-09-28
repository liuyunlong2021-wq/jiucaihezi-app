import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { DesktopRemoteHost } from './desktopRemoteHost'
import { RemoteProtocolError } from './desktopRemoteProtocol'
import { desktopRemoteEventCursor } from './desktopRemoteEventSeq'
import { isTauriRuntime } from '@/utils/tauriEnv'

export type RemoteBridgeStatus = {
  listening: boolean
  address?: string
  publicKey: string
  devices: Array<{ deviceId: string; name: string }>
}

export type RemotePairingOffer = {
  version: 1
  address: string
  desktopPublicKey: string
  offerId: string
  expiresAt: number
}

export type RemotePairingRequest = {
  offerId: string
  deviceId: string
  name: string
}

type RemoteRequest = {
  requestId: string
  type: string
  payload: Record<string, unknown>
  deviceId: string
}

function requiredString(payload: Record<string, unknown>, key: string, max = 20_000) {
  const value = String(payload[key] || '')
  if (!value.trim() || value.length > max) throw new Error(`INVALID_${key.toUpperCase()}`)
  return value
}

async function dispatch(host: DesktopRemoteHost | undefined, request: RemoteRequest) {
  const payload = request.payload || {}
  if (request.type === 'gateway.health') return {
    gatewayEpoch: desktopRemoteEventCursor('').gatewayEpoch,
    runtimeAvailable: Boolean(host),
  }
  if (!host) throw new RemoteProtocolError('RUNTIME_UNAVAILABLE')
  if (request.type === 'context.get') return host.context()
  if (request.type === 'session.attach') {
    const sessionId = requiredString(payload, 'sessionId', 200)
    // Rust 已先绑定订阅；读取官方历史期间发生的事件必须高于这条基线，交给 Mobile 重放。
    let cursor = desktopRemoteEventCursor(sessionId)
    let snapshot = await host.readSession(sessionId) as Record<string, unknown>
    if (desktopRemoteEventCursor(sessionId).seq !== cursor.seq) {
      // 常见的一次性竞态直接重读；持续流式时仍用重读前基线，让已缓存事件补齐。
      cursor = desktopRemoteEventCursor(sessionId)
      snapshot = await host.readSession(sessionId) as Record<string, unknown>
    }
    return { sessionId, ...cursor, snapshot }
  }
  if (request.type === 'session.read') return await host.readSession(requiredString(payload, 'sessionId', 200))
  if (request.type === 'session.subscribe') {
    const sessionId = requiredString(payload, 'sessionId', 200)
    if (sessionId !== host.context().sessionId) throw new Error('SESSION_NOT_CURRENT')
    return { subscribed: true, sessionId }
  }
  if (request.type === 'message.send') {
    const sessionId = requiredString(payload, 'sessionId', 200)
    const text = requiredString(payload, 'text')
    const commandId = requiredString(payload, 'commandId', 128)
    const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([sessionId, text])))
    const digest = Array.from(new Uint8Array(digestBytes), byte => byte.toString(16).padStart(2, '0')).join('')
    const key = `${request.deviceId}\0${commandId}`
    const existing = commandLedger.get(key)
    if (existing) {
      if (existing.digest !== digest) throw new RemoteProtocolError('COMMAND_ID_CONFLICT')
      return await existing.result
    }
    const result = host.sendMessage(sessionId, text).then(receipt => ({ accepted: true, runId: receipt.runId }))
    commandLedger.set(key, { digest, result })
    return await result
  }
  if (request.type === 'run.stop') return { state: await host.stopRun(requiredString(payload, 'sessionId', 200)) }
  if (request.type === 'approval.respond') {
    const decision = requiredString(payload, 'decision', 16)
    if (decision !== 'approve' && decision !== 'reject' && decision !== 'always') throw new Error('APPROVAL_DECISION_INVALID')
    await host.respondApproval(
      requiredString(payload, 'sessionId', 200),
      requiredString(payload, 'approvalId', 200),
      decision,
    )
    return { accepted: true }
  }
  throw new Error('UNSUPPORTED_MESSAGE')
}

let activeHost: DesktopRemoteHost | undefined
let listenerReady: Promise<void> | undefined
const commandLedger = new Map<string, { digest: string; result: Promise<{ accepted: boolean; runId: string }> }>()

/**
 * 桥接处理器在**进程内只注册一次**，且始终响应「最新的 host」。
 *
 * 之前每次组件挂载都 `listen` 一个新监听器：组件重挂（开发期 HMR、切视图）会把旧实例
 * 留在事件上，而旧实例的闭包读的是旧组件状态 —— 对话为空 —— 它可能抢先用空
 * sessionId 回给手机，手机就报「电脑上还没有打开任何对话」（2026-09-27 真机，
 * 电脑上明明开着对话）。
 */
export async function startDesktopRemoteGateway(): Promise<void> {
  if (!isTauriRuntime()) return
  listenerReady ??= listen<RemoteRequest>('desktop-remote:request', event => {
    const request = event.payload
    void dispatch(activeHost, request).then(
      result => invoke('remote_bridge_complete', { requestId: request.requestId, result }),
      error => invoke('remote_bridge_complete', {
        requestId: request.requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  }).then(() => undefined).catch(error => {
    listenerReady = undefined
    throw error
  })
  await listenerReady
}

/** The runtime binding outlives a workbench view; a remount replaces it with the latest view. */
export async function bindDesktopRemoteRuntime(host: DesktopRemoteHost): Promise<void> {
  if (!isTauriRuntime()) return
  activeHost = host
  await startDesktopRemoteGateway()
}

export async function publishDesktopRemoteEvent(sessionId: string, event: unknown) {
  if (!isTauriRuntime()) return
  await invoke('remote_bridge_publish', { sessionId, event })
}

export const remoteBridgeStatus = () => invoke<RemoteBridgeStatus>('remote_bridge_status')
export const startRemoteBridge = () => invoke<RemoteBridgeStatus>('remote_bridge_start')
export const stopRemoteBridge = () => invoke<RemoteBridgeStatus>('remote_bridge_stop')
export const createRemotePairingOffer = () => invoke<RemotePairingOffer>('remote_pairing_offer')
export const approveRemotePairing = (offerId: string) => invoke('remote_pairing_approve', { offerId })
export const rejectRemotePairing = (offerId: string) => invoke('remote_pairing_reject', { offerId })
export const revokeRemoteDevice = (deviceId: string) => invoke('remote_device_revoke', { deviceId })
export const listenRemotePairingRequests = (handler: (request: RemotePairingRequest) => void) =>
  listen<RemotePairingRequest>('desktop-remote:pairing-request', event => handler(event.payload))

export const __desktopRemoteBridgeForTests = { dispatch }
