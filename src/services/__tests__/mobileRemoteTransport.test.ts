import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  MOBILE_REMOTE_CLOSED_EVENT,
  MOBILE_REMOTE_EVENT,
  parsePairingOffer,
  shouldAutoReconnect,
} from '@/services/mobileRemoteTransport'
import { createPairingRegistry } from '@/services/desktopRemoteProtocol'

test('只有配过对但不在线时才自动重连', () => {
  assert.equal(shouldAutoReconnect({ paired: true, connected: false }), true)
  assert.equal(shouldAutoReconnect({ paired: true, connected: true }), false)
  assert.equal(shouldAutoReconnect({ paired: false, connected: false }), false)
  assert.equal(shouldAutoReconnect(null), false)
})

const offer = {
  version: 1,
  address: '192.168.1.7:49152',
  desktopPublicKey: 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cX',
  offerId: 'offer-1',
  expiresAt: 1_800_000_000_000,
}

test('解析二维码时只接受本协议的五个字段', () => {
  assert.deepEqual(parsePairingOffer(JSON.stringify(offer)), offer)

  assert.throws(() => parsePairingOffer('not json'), /PAIRING_OFFER_INVALID/)
  assert.throws(() => parsePairingOffer(''), /PAIRING_OFFER_INVALID/)
  assert.throws(
    () => parsePairingOffer(JSON.stringify({ ...offer, version: 2 })),
    /PAIRING_OFFER_INVALID/,
  )
  // 多带字段的码一律拒绝：二维码里不能夹带凭证、路径或私钥（合同 §8.2）。
  assert.throws(
    () => parsePairingOffer(JSON.stringify({ ...offer, apiKey: 'sk-secret' })),
    /PAIRING_OFFER_INVALID/,
  )
  assert.throws(
    () => parsePairingOffer(JSON.stringify({ ...offer, address: '' })),
    /PAIRING_OFFER_INVALID/,
  )
})

test('手机端每条命令都登记在 ACL 与 Rust 处理器里，事件名与 Rust 常量一致', () => {
  const transport = readFileSync('src/services/mobileRemoteTransport.ts', 'utf8')
  const acl = readFileSync('src-tauri/permissions/app-commands.json', 'utf8')
  const rust = readFileSync('src-tauri/src/commands/remote_client.rs', 'utf8')
  const lib = readFileSync('src-tauri/src/lib.rs', 'utf8')

  const commands = [...transport.matchAll(/invoke(?:<[^>]*>)?\(\s*'([a-z_]+)'/g)].map(match => match[1])
  assert.deepEqual(commands.sort(), [
    'mobile_remote_connect',
    'mobile_remote_disconnect',
    'mobile_remote_pair',
    'mobile_remote_request',
    'mobile_remote_status',
  ])

  // 漏登 ACL 的命令会在真机上静默报 command not found，这里提前拦下。
  for (const command of commands) {
    assert.match(acl, new RegExp(`"${command}"`), `${command} 未登记 ACL`)
    assert.match(lib, new RegExp(`commands::remote_client::${command},`), `${command} 未注册处理器`)
  }

  assert.match(rust, new RegExp(`MOBILE_EVENT_NAME: &str = "${MOBILE_REMOTE_EVENT}"`))
  assert.match(rust, new RegExp(`MOBILE_CLOSED_EVENT_NAME: &str = "${MOBILE_REMOTE_CLOSED_EVENT}"`))
})

test('桌面生成的配对信息能被手机端解析（二维码与粘贴通道共用同一份 offer）', () => {
  // 设置页把 QR 内容写成 JSON.stringify(offer)，粘贴通道用同一串；
  // 桌面侧多一个字段就会让 parsePairingOffer 拒绝，这里提前拦下。
  const registry = createPairingRegistry({ now: () => 1_000, randomId: () => 'offer-1' })
  const created = registry.createOffer('192.168.1.16:61997', 'Zm9vYmFyYmF6cXV4')

  assert.deepEqual(parsePairingOffer(JSON.stringify(created)), created)
})
