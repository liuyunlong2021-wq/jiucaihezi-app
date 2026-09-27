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
  let unlisteners: UnlistenFn[] = []
  return {
    async request({ type, payload }) {
      return await invoke('mobile_remote_request', {
        requestId: crypto.randomUUID(),
        messageType: type,
        payload,
      })
    },
    subscribe(listener) {
      unlisteners = []
      void listen<unknown>(MOBILE_REMOTE_EVENT, event => listener(event.payload))
        .then(unlisten => { unlisteners.push(unlisten) })
      void listen<unknown>(MOBILE_REMOTE_CLOSED_EVENT, () => { options.onClosed?.() })
        .then(unlisten => { unlisteners.push(unlisten) })
      return () => {
        for (const unlisten of unlisteners) unlisten()
        unlisteners = []
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
