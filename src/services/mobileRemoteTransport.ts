import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { MobileRemoteTransport } from './mobileRemoteClient'

/** 二维码内容。只允许这些字段，多一个字段就说明不是本协议发的码。 */
export type RemotePairingOffer = {
  version: 1
  address: string
  desktopPublicKey: string
  offerId: string
  expiresAt: number
}

export type MobileRemoteStatus = {
  paired: boolean
  connected: boolean
  deviceId?: string
  address?: string
}

export const MOBILE_REMOTE_EVENT = 'mobile-remote:event'
export const MOBILE_REMOTE_CLOSED_EVENT = 'mobile-remote:closed'

/**
 * 回到前台后该不该自动重连：配过对、但当前不在线。
 *
 * 手机切后台会被系统挂起，socket 随之失效（合同 §13.6 要求这时能自己回来）。
 * 没配过对时不做任何事——不能替用户发起配对。
 */
export function shouldAutoReconnect(status: MobileRemoteStatus | null | undefined): boolean {
  return Boolean(status?.paired) && !status?.connected
}

/**
 * 二维码里不能含长期凭证、API Key、项目路径或 Desktop 私钥（合同 §8.2），
 * 因此这里只解析五个展示/连接必需的字段，发现多余内容一律拒绝。
 */
export function parsePairingOffer(raw: string): RemotePairingOffer {
  let parsed: unknown
  try {
    parsed = JSON.parse(String(raw || ''))
  } catch {
    throw new Error('PAIRING_OFFER_INVALID')
  }
  const offer = parsed as Record<string, unknown> | null
  if (!offer || typeof offer !== 'object') throw new Error('PAIRING_OFFER_INVALID')
  if (Object.keys(offer).sort().join(',') !== 'address,desktopPublicKey,expiresAt,offerId,version')
    throw new Error('PAIRING_OFFER_INVALID')
  if (offer.version !== 1
    || typeof offer.address !== 'string' || !offer.address.trim()
    || typeof offer.desktopPublicKey !== 'string' || !offer.desktopPublicKey.trim()
    || typeof offer.offerId !== 'string' || !offer.offerId.trim()
    || typeof offer.expiresAt !== 'number' || !Number.isFinite(offer.expiresAt))
    throw new Error('PAIRING_OFFER_INVALID')
  return {
    version: 1,
    address: String(offer.address).trim(),
    desktopPublicKey: String(offer.desktopPublicKey).trim(),
    offerId: String(offer.offerId).trim(),
    expiresAt: offer.expiresAt,
  }
}

/** Rust 侧只回状态与错误码，凭证（token、设备私钥）不经过 WebView。 */
export function createTauriMobileTransport(options: { onClosed?: () => void } = {}): MobileRemoteTransport {
  return {
    async request({ type, payload }) {
      return await invoke('mobile_remote_request', {
        requestId: crypto.randomUUID(),
        messageType: type,
        payload,
      })
    },
    async subscribe(listener) {
      const eventUnlisten: UnlistenFn = await listen<unknown>(MOBILE_REMOTE_EVENT, event => listener(event.payload))
      try {
        const closedUnlisten: UnlistenFn = await listen<unknown>(MOBILE_REMOTE_CLOSED_EVENT, () => { options.onClosed?.() })
        return () => {
          void eventUnlisten()
          void closedUnlisten()
        }
      } catch (cause) {
        void eventUnlisten()
        throw cause
      }
    },
  }
}

export const mobileRemoteStatus = () => invoke<MobileRemoteStatus>('mobile_remote_status')

export const pairMobileRemote = (offer: RemotePairingOffer, deviceName: string) =>
  invoke<MobileRemoteStatus>('mobile_remote_pair', {
    address: offer.address,
    offerId: offer.offerId,
    desktopPublicKey: offer.desktopPublicKey,
    deviceName,
  })

export const connectMobileRemote = (address?: string) =>
  invoke<MobileRemoteStatus>('mobile_remote_connect', { address })

export const disconnectMobileRemote = () => invoke<MobileRemoteStatus>('mobile_remote_disconnect')
