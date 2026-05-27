import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEFAULT_API_BASE_URL,
  API_ACCOUNT_CACHE_KEY,
  API_KEY_STORAGE_KEY,
  buildGatewayHeaders,
  clearLegacyAuthStorage,
  extractGatewaySessionToken,
  extractGatewayUserPayload,
  inferGatewayModelCapability,
  loadCachedGatewayAccount,
  normalizeGatewayModels,
  normalizeGatewayTopupOrder,
  normalizeGatewayUser,
  setGatewaySessionToken,
} from '../../services/newApiClient'

function withLocalStorage(values: Record<string, string>, fn: () => void) {
  const store = new Map<string, string>(Object.entries(values))
  const previous = (globalThis as any).localStorage
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
  try {
    fn()
  } finally {
    ;(globalThis as any).localStorage = previous
  }
}

test('Gateway base URL is the formal production gateway', () => {
  assert.equal(DEFAULT_API_BASE_URL, 'https://api.jiucaihezi.studio')
})

test('buildGatewayHeaders sends bearer session token and desktop session header', () => {
  withLocalStorage({ [API_KEY_STORAGE_KEY]: 'session_123' }, () => {
    assert.deepEqual(buildGatewayHeaders(), {
      Authorization: 'Bearer session_123',
      'X-JC-Session': 'session_123',
    })
  })
})

test('setGatewaySessionToken clears empty token', () => {
  withLocalStorage({ [API_KEY_STORAGE_KEY]: 'old' }, () => {
    setGatewaySessionToken('')
    assert.deepEqual(buildGatewayHeaders(), {})
  })
})

test('clearLegacyAuthStorage removes stale web key and routing mode storage', () => {
  withLocalStorage({
    jcApiKey: 'sk-old',
    jcMemberAccessToken: 'member-old',
    jcUserAccessToken: 'user-old',
    jcProviderMode: 'member',
    jcUserMode: 'performance',
  }, () => {
    clearLegacyAuthStorage()
    assert.equal((globalThis as any).localStorage.getItem('jcApiKey'), null)
    assert.equal((globalThis as any).localStorage.getItem('jcMemberAccessToken'), null)
    assert.equal((globalThis as any).localStorage.getItem('jcUserAccessToken'), null)
    assert.equal((globalThis as any).localStorage.getItem('jcProviderMode'), null)
    assert.equal((globalThis as any).localStorage.getItem('jcUserMode'), null)
  })
})

test('loadCachedGatewayAccount ignores stale member cache without Gateway session token', () => {
  withLocalStorage({
    [API_ACCOUNT_CACHE_KEY]: JSON.stringify({ id: 'u-old', username: '旧会员', isMember: true }),
  }, () => {
    assert.equal(loadCachedGatewayAccount(), null)
  })
})

test('loadCachedGatewayAccount restores member cache only with Gateway session token', () => {
  withLocalStorage({
    [API_KEY_STORAGE_KEY]: 'session-ok',
    [API_ACCOUNT_CACHE_KEY]: JSON.stringify({ id: 'u-old', username: '旧会员', isMember: true }),
  }, () => {
    assert.equal(loadCachedGatewayAccount()?.isMember, true)
  })
})

test('extractGatewaySessionToken accepts gateway, web and nested token aliases', () => {
  assert.equal(extractGatewaySessionToken({ sessionToken: 'sess_top' }), 'sess_top')
  assert.equal(extractGatewaySessionToken({ session_token: 'sess_snake' }), 'sess_snake')
  assert.equal(extractGatewaySessionToken({ token: 'token_top' }), 'token_top')
  assert.equal(extractGatewaySessionToken({ accessToken: 'access_top' }), 'access_top')
  assert.equal(extractGatewaySessionToken({ data: { sessionToken: 'sess_data' } }), 'sess_data')
  assert.equal(extractGatewaySessionToken({ data: { session: { id: 'sess_obj' } } }), 'sess_obj')
})

test('extractGatewayUserPayload prefers explicit user/account payloads before wrappers', () => {
  assert.deepEqual(extractGatewayUserPayload({ user: { id: 'u1' }, data: { id: 'wrong' } }), { id: 'u1' })
  assert.deepEqual(extractGatewayUserPayload({ data: { account: { id: 'u2' } } }), { id: 'u2' })
  assert.deepEqual(extractGatewayUserPayload({ data: { user: { id: 'u3' } } }), { id: 'u3' })
  assert.deepEqual(extractGatewayUserPayload({ data: { id: 'u4' } }), { id: 'u4' })
})

test('normalizeGatewayUser accepts account/data aliases and maps quota to flowers', () => {
  const user = normalizeGatewayUser({
    account: { id: 'u1', username: '盒子', quota: 5000000, mode: 'fast', modeLabel: '高性能模式' },
    membership: { isMember: true, expiresAt: '2026-06-01' },
  })

  assert.equal(user.id, 'u1')
  assert.equal(user.username, '盒子')
  assert.equal(user.balanceFlowers, 10)
  assert.equal(user.quota, 5000000)
  assert.equal(user.isMember, true)
})

test('normalizeGatewayUser prefers balance_flowers and supports nested data', () => {
  const user = normalizeGatewayUser({
    data: {
      user_id: 'u2',
      email: 'a@example.com',
      balance_flowers: 321,
      quota: 123456,
      membership: { is_member: false },
    },
  })

  assert.equal(user.id, 'u2')
  assert.equal(user.username, 'a@example.com')
  assert.equal(user.balanceFlowers, 321)
  assert.equal(user.quota, 123456)
  assert.equal(user.isMember, false)
})

test('normalizeGatewayUser removes legacy account routing labels from desktop account state', () => {
  const user = normalizeGatewayUser({
    account: { id: 'u-mode', username: '模式旧值', mode: 'performance', modeLabel: '高性能模式' },
  })

  assert.equal('mode' in user, false)
  assert.equal('modeLabel' in user, false)
})

test('normalizeGatewayUser preserves web membership fields and aliases', () => {
  const user = normalizeGatewayUser({
    account: {
      id: 'u4',
      username: '会员用户',
      is_member: true,
      membership: {
        is_member: true,
        member_until: '2026-06-24T00:00:00.000Z',
        plan_title: '月度会员',
      },
    },
  })

  assert.equal(user.isMember, true)
  assert.deepEqual(user.membership, {
    isMember: true,
    source: undefined,
    planTitle: '月度会员',
    memberUntil: '2026-06-24T00:00:00.000Z',
  })
})

test('normalizeGatewayUser exposes invite and request fields used by the user center', () => {
  const user = normalizeGatewayUser({
    data: {
      id: 'u5',
      username: '邀请用户',
      aff_code: 'aff_123456',
      request_count: 27,
      plan: 'web',
      balance_flowers: 880,
    },
  })

  assert.equal(user.affCode, 'aff_123456')
  assert.equal(user.aff_code, 'aff_123456')
  assert.equal(user.requestCount, 27)
  assert.equal(user.plan, 'web')
})

test('normalizeGatewayTopupOrder exposes QR and pay URLs from Xunhu pay payload', () => {
  const order = normalizeGatewayTopupOrder({
    data: {
      order_id: 'topup_1',
      pay_payload: {
        url_qrcode: 'https://pay.example/qr.png',
        url: 'https://pay.example/link',
      },
    },
  })

  assert.equal(order.order_id, 'topup_1')
  assert.equal(order.qr_url, 'https://pay.example/qr.png')
  assert.equal(order.pay_url, 'https://pay.example/link')
})

test('normalizeGatewayTopupOrder maps Gateway payment contract and legacy scan fields', () => {
  const order = normalizeGatewayTopupOrder({
    data: {
      order_id: 'topup_scan',
      payment: {
        scan_url: 'alipays://platformapi/startapp?order=123',
        pay_url: 'https://cashier.example/order/123',
      },
      pay_payload: {
        data: {
          code_url: 'https://pay.example/code/123',
        },
      },
    },
  })

  assert.equal(order.order_id, 'topup_scan')
  assert.equal(order.payment?.scan_url, 'alipays://platformapi/startapp?order=123')
  assert.equal(order.payment?.pay_url, 'https://cashier.example/order/123')
  assert.equal(order.scan_url, 'alipays://platformapi/startapp?order=123')
  assert.equal(order.scanUrl, 'alipays://platformapi/startapp?order=123')
  assert.equal(order.pay_url, 'https://cashier.example/order/123')
  assert.equal(order.qr_url, 'alipays://platformapi/startapp?order=123')
})

test('normalizeGatewayTopupOrder maps top-level QR image fields', () => {
  const order = normalizeGatewayTopupOrder({
    data: {
      order_id: 'topup_top_level_qr',
      url_qrcode: 'https://pay.example/top-level-qr.png',
    },
  })

  assert.equal(order.order_id, 'topup_top_level_qr')
  assert.equal(order.payment?.qr_image_url, 'https://pay.example/top-level-qr.png')
  assert.equal(order.url_qrcode, 'https://pay.example/top-level-qr.png')
  assert.equal(order.qr_url, 'https://pay.example/top-level-qr.png')
})

test('normalizeGatewayTopupOrder maps payment QR image fields', () => {
  const order = normalizeGatewayTopupOrder({
    data: {
      order_id: 'topup_payment_qr',
      payment: {
        qr_image_url: 'https://pay.example/payment-qr.png',
        pay_url: 'https://pay.example/payment-page',
      },
    },
  })

  assert.equal(order.order_id, 'topup_payment_qr')
  assert.equal(order.payment?.qr_image_url, 'https://pay.example/payment-qr.png')
  assert.equal(order.url_qrcode, 'https://pay.example/payment-qr.png')
  assert.equal(order.pay_url, 'https://pay.example/payment-page')
})

test('normalizeGatewayTopupOrder keeps pay-url-only orders actionable', () => {
  const order = normalizeGatewayTopupOrder({
    data: {
      order_id: 'topup_pay_url_only',
      pay_payload: {
        url: 'https://pay.example/url-only',
      },
    },
  })

  assert.equal(order.order_id, 'topup_pay_url_only')
  assert.equal(order.pay_url, 'https://pay.example/url-only')
  assert.equal(order.qr_url, undefined)
  assert.equal(order.payment?.pay_url, 'https://pay.example/url-only')
})

test('normalizeGatewayModels maps gateway items to product model entries', () => {
  const models = normalizeGatewayModels({
    items: [
      { id: 'gpt-5.5', name: 'GPT-5.5', channel: 'newapi', taskTypes: ['chat'] },
      { id: 'gpt-image-2', name: 'GPT Image', taskTypes: ['image'] },
      { id: 'grok-video-3', name: 'Grok Video', taskTypes: ['video'] },
    ],
  })

  assert.deepEqual(models.map(item => [item.id, item.label, item.providerId, item.capability]), [
    ['gpt-5.5', 'GPT-5.5', 'jiucaihezi', 'text'],
    ['gpt-image-2', 'GPT Image', 'jiucaihezi', 'image'],
    ['grok-video-3', 'Grok Video', 'jiucaihezi', 'video'],
  ])
})

test('normalizeGatewayModels filters removed media model ids while keeping approved media ids', () => {
  const models = normalizeGatewayModels({
    items: [
      { id: 'seedance-2.0-fast', name: 'Seedance', taskTypes: ['video'] },
      { id: 'grok-4.2-image', name: 'Grok Image 4.2', taskTypes: ['image'] },
      { id: 'grok-4.1-image', name: 'Grok Image 4.1', taskTypes: ['image'] },
      { id: 'nano-banana', name: 'Nano Banana', taskTypes: ['image'] },
      { id: 'nano-banana-hd', name: 'Nano Banana HD', taskTypes: ['image'] },
      { id: 'nano-banana-2k', name: 'Nano Banana 2K', taskTypes: ['image'] },
      { id: 'nano-banana-4k', name: 'Nano Banana 4K', taskTypes: ['image'] },
    ],
  })

  assert.deepEqual(models.map(item => item.id), [
    'nano-banana-2k',
    'nano-banana-4k',
  ])
})

test('inferGatewayModelCapability uses task type, channel and id signals', () => {
  assert.equal(inferGatewayModelCapability('unknown', ['image'], ''), 'image')
  assert.equal(inferGatewayModelCapability('unknown', [], 'grok-video'), 'video')
  assert.equal(inferGatewayModelCapability('voice-model', [], ''), 'audio')
  assert.equal(inferGatewayModelCapability('claude-sonnet', [], 'newapi'), 'text')
})
