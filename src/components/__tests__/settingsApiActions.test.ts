import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  __resetApiKeyMemoryCacheForTests,
  extractGatewayApiKey,
  gatewayLogin,
  getApiKey,
  initApiKey,
  setApiKey,
} from '../../services/newApiClient'

test('settings account area uses the cloud login box users approved', () => {
  const settingsSource = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')
  const loginBoxSource = readFileSync(join(process.cwd(), 'src/components/auth/JcCloudLoginBox.vue'), 'utf8')

  assert.equal(settingsSource.includes('<JcCloudLoginBox'), true)
  assert.equal(settingsSource.includes(':login="loginWithGateway"'), true)
  assert.equal(settingsSource.includes('@login-success="handleCloudLoginSuccess"'), true)

  const primaryStart = loginBoxSource.indexOf('<div class="jc-login-actions primary">')
  const primaryEnd = loginBoxSource.indexOf('<div v-if="loggedIn')
  const secondaryStart = loginBoxSource.indexOf('<div class="jc-login-actions secondary">')
  const secondaryEnd = loginBoxSource.indexOf('<button class="jc-login-save"')

  assert.ok(primaryStart > -1)
  assert.ok(primaryEnd > primaryStart)
  assert.ok(secondaryStart > primaryEnd)
  assert.ok(secondaryEnd > secondaryStart)

  const primary = loginBoxSource.slice(primaryStart, primaryEnd)
  assert.ok(primary.indexOf('一键登录') < primary.indexOf('下载APP'))
  assert.ok(primary.indexOf('下载APP') < primary.indexOf('充值'))
  assert.ok(primary.indexOf('充值') < primary.indexOf('使用日志'))

  const secondary = loginBoxSource.slice(secondaryStart, secondaryEnd)
  assert.ok(secondary.indexOf('获取 Key') < secondary.indexOf('邀请赚米'))
  assert.ok(secondary.indexOf('邀请赚米') < secondary.indexOf('白嫖签到'))
})

test('gateway login extracts api key and persists it for web reloads', async () => {
  const previousFetch = globalThis.fetch
  const previousStorage = (globalThis as any).localStorage
  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
  globalThis.fetch = (async () => new Response(JSON.stringify({
    success: true,
    api_key: 'sk-login-123456789012345678901234',
    base_url: 'https://api.jiucaihezi.studio/v1',
    user: { id: 'u1', username: 'alice' },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as typeof fetch

  try {
    __resetApiKeyMemoryCacheForTests('')
    const result = await gatewayLogin({ username: 'alice', password: 'secret' })
    assert.equal(result.apiKey, 'sk-login-123456789012345678901234')
    assert.equal(getApiKey(), 'sk-login-123456789012345678901234')
    assert.equal(store.get('jcApiKey'), 'sk-login-123456789012345678901234')

    __resetApiKeyMemoryCacheForTests('')
    assert.equal(await initApiKey(), 'sk-login-123456789012345678901234')

    await setApiKey('')
    assert.equal(store.get('jcApiKey'), undefined)
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    ;(globalThis as any).localStorage = previousStorage
  }
})

test('extractGatewayApiKey accepts common gateway response aliases', () => {
  assert.equal(extractGatewayApiKey({ api_key: 'sk-top' }), 'sk-top')
  assert.equal(extractGatewayApiKey({ data: { apiKey: 'sk-nested' } }), 'sk-nested')
  assert.equal(extractGatewayApiKey({ data: { key: 'sk-key' } }), 'sk-key')
})
