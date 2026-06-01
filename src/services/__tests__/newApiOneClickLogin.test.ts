import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ONE_CLICK_LOGIN_INTENT_STORAGE_KEY,
  buildNewApiSignInUrl,
  buildOneClickLoginReturnUrl,
  buildProductionOneClickLoginUrl,
  consumeOneClickLoginRetryFlag,
  createAutoGroupApiKey,
  isProductionWorkbenchOrigin,
} from '../newApiOneClickLogin'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createMemoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => Array.from(data.keys())[index] ?? null,
    removeItem: key => { data.delete(key) },
    setItem: (key, value) => { data.set(key, String(value)) },
  }
}

test('createAutoGroupApiKey creates an auto-group token and resolves its real key', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} })
    if (String(url).endsWith('/api/token/')) {
      return jsonResponse(200, { success: true, data: { id: 42 } })
    }
    return jsonResponse(200, { success: true, data: { key: 'abc12345678901234567890' } })
  }

  const result = await createAutoGroupApiKey({ fetcher, now: new Date('2026-06-01T12:00:00Z') })

  assert.deepEqual(result, { status: 'ok', apiKey: 'sk-abc12345678901234567890' })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'https://api.jiucaihezi.studio/api/token/')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.credentials, 'include')
  const createBody = JSON.parse(String(calls[0].init.body))
  assert.match(createBody.name, /^jiucaihezi-studio-20260601120000-[a-z0-9]{8,16}$/)
  delete createBody.name
  assert.deepEqual(createBody, {
    remain_quota: 0,
    expired_time: -1,
    unlimited_quota: true,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
    group: 'auto',
    cross_group_retry: true,
  })
  assert.equal(calls[1].url, 'https://api.jiucaihezi.studio/api/token/42/key')
})

test('createAutoGroupApiKey treats unauthorized as needs-login', async () => {
  const result = await createAutoGroupApiKey({
    fetcher: async () => jsonResponse(401, { success: false, message: 'Unauthorized' }),
  })

  assert.deepEqual(result, { status: 'needs-login' })
})

test('createAutoGroupApiKey resolves token id by name when create response omits id', async () => {
  const calls: string[] = []
  let createdTokenName = ''
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
    const textUrl = String(url)
    calls.push(textUrl)
    if (textUrl.endsWith('/api/token/')) {
      createdTokenName = JSON.parse(String(init?.body || '{}')).name
      return jsonResponse(200, { success: true, message: '创建成功' })
    }
    if (textUrl.includes('/api/token/search?')) {
      return jsonResponse(200, {
        success: true,
        data: [
          { id: 77, name: createdTokenName },
        ],
      })
    }
    return jsonResponse(200, { success: true, data: { key: 'abc12345678901234567890' } })
  }

  const result = await createAutoGroupApiKey({ fetcher, now: new Date('2026-06-01T12:00:00Z') })

  assert.deepEqual(result, { status: 'ok', apiKey: 'sk-abc12345678901234567890' })
  assert.match(createdTokenName, /^jiucaihezi-studio-20260601120000-[a-z0-9]{8,16}$/)
  assert.equal(calls[1], `https://api.jiucaihezi.studio/api/token/search?keyword=${createdTokenName}&p=1&page_size=10`)
  assert.equal(calls[2], 'https://api.jiucaihezi.studio/api/token/77/key')
})

test('buildOneClickLoginReturnUrl adds a retry flag without preserving callback keys', () => {
  const storage = createMemoryStorage()
  const result = buildOneClickLoginReturnUrl(
    'https://jiucaihezi.studio/?key=sk-old12345678901234567890&x=1#/settings',
    storage,
  )
  const url = new URL(result)
  const intent = JSON.parse(String(storage.getItem(ONE_CLICK_LOGIN_INTENT_STORAGE_KEY)))

  assert.equal(url.origin, 'https://jiucaihezi.studio')
  assert.equal(url.searchParams.get('key'), null)
  assert.equal(url.searchParams.get('x'), '1')
  assert.equal(url.searchParams.get('jcOneClickLogin'), '1')
  assert.equal(url.searchParams.get('state'), intent.nonce)
  assert.equal(typeof intent.nonce, 'string')
  assert.ok(intent.nonce.length >= 16)
})

test('buildNewApiSignInUrl carries the workbench return url', () => {
  assert.equal(
    buildNewApiSignInUrl('https://jiucaihezi.studio/?jcOneClickLogin=1&state=abc'),
    'https://api.jiucaihezi.studio/sign-in?redirect=https%3A%2F%2Fjiucaihezi.studio%2F%3FjcOneClickLogin%3D1%26state%3Dabc',
  )
})

test('isProductionWorkbenchOrigin only allows deployed workbench origins for web cookie login', () => {
  assert.equal(isProductionWorkbenchOrigin('https://jiucaihezi.studio/'), true)
  assert.equal(isProductionWorkbenchOrigin('https://www.jiucaihezi.studio/'), true)
  assert.equal(isProductionWorkbenchOrigin('http://localhost:4173/'), false)
  assert.equal(isProductionWorkbenchOrigin('file:///Users/by3/dist/index.html'), false)
  assert.equal(isProductionWorkbenchOrigin('https://preview.example.pages.dev/'), false)
})

test('buildProductionOneClickLoginUrl points local previews to the deployed workbench without unsafe cross-origin retry', () => {
  assert.equal(
    buildProductionOneClickLoginUrl(),
    'https://jiucaihezi.studio/',
  )
})

test('consumeOneClickLoginRetryFlag requires the stored one-click state', () => {
  const storage = createMemoryStorage()
  storage.setItem(ONE_CLICK_LOGIN_INTENT_STORAGE_KEY, JSON.stringify({ nonce: 'state-1', createdAt: Date.now() }))
  let replaced = ''

  assert.equal(
    consumeOneClickLoginRetryFlag(
      'https://jiucaihezi.studio/?jcOneClickLogin=1&state=state-1&x=1',
      storage,
      url => { replaced = url },
    ),
    true,
  )
  assert.equal(replaced, '/?x=1')
  assert.equal(storage.getItem(ONE_CLICK_LOGIN_INTENT_STORAGE_KEY), null)
})

test('consumeOneClickLoginRetryFlag strips but ignores forged retry flags', () => {
  const storage = createMemoryStorage()
  let replaced = ''

  assert.equal(
    consumeOneClickLoginRetryFlag(
      'https://jiucaihezi.studio/?jcOneClickLogin=1&state=attacker&x=1',
      storage,
      url => { replaced = url },
    ),
    false,
  )
  assert.equal(replaced, '/?x=1')
})
