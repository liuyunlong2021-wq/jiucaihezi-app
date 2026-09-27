import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { DesktopRemoteHost } from './desktopRemoteHost'
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

async function dispatch(host: DesktopRemoteHost, request: RemoteRequest) {
  const payload = request.payload || {}
  if (request.type === 'context.get') return host.context()
  if (request.type === 'session.read') return await host.readSession(requiredString(payload, 'sessionId', 200))
  if (request.type === 'session.subscribe') {
    const sessionId = requiredString(payload, 'sessionId', 200)
    if (sessionId !== host.context().sessionId) throw new Error('SESSION_NOT_CURRENT')
    return { subscribed: true, sessionId }
  }
  if (request.type === 'message.send') {
    await host.sendMessage(requiredString(payload, 'sessionId', 200), requiredString(payload, 'text'))
    return { accepted: true }
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
let stopListening: UnlistenFn | undefined

/**
 * 桥接处理器在**进程内只注册一次**，且始终响应「最新的 host」。
 *
 * 之前每次组件挂载都 `listen` 一个新监听器：组件重挂（开发期 HMR、切视图）会把旧实例
 * 留在事件上，而旧实例的闭包读的是旧组件状态 —— 对话为空 —— 它可能抢先用空
 * sessionId 回给手机，手机就报「电脑上还没有打开任何对话」（2026-09-27 真机，
 * 电脑上明明开着对话）。
 */
export async function registerDesktopRemoteBridge(host: DesktopRemoteHost): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined
  activeHost = host
  stopListening ??= await listen<RemoteRequest>('desktop-remote:request', event => {
    const request = event.payload
    const target = activeHost
    if (!target) return
    void dispatch(target, request).then(
      result => invoke('remote_bridge_complete', { requestId: request.requestId, result }),
      error => invoke('remote_bridge_complete', {
        requestId: request.requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  })
  return () => {
    if (activeHost === host) activeHost = undefined
  }
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
