import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { getCloudRequiredMessage } from '../../../services/newApiAuth'

function source(path: string): string {
  return readFileSync(path, 'utf8')
}

// 账号登录只建立云端身份与同步会话；模型调用 Key 完全由用户手动提供。
// 这组合同测试锁住两件事：登录不再获取 Key、抄配置只能用已有 Key。
test('一键登录不再获取或保存模型调用 Key', () => {
  const loginBox = source('src/components/auth/JcCloudLoginBox.vue')
  const settings = source('src/components/memory/MemorySettings.vue')
  const client = source('src/services/newApiClient.ts')

  assert.doesNotMatch(loginBox, /apiKeyDraft\.value = result\.apiKey/)
  assert.doesNotMatch(settings, /setApiKey\(result\.apiKey\)/)
  assert.doesNotMatch(client, /await setApiKey\(apiKey\)/)
  // 同步会话仍然必须保存，否则云端同步会断。
  assert.match(client, /await setGatewaySessionToken\(syncSession\)/)
})

test('一键抄配置只使用已有 Key，不再自动创建 Key', () => {
  const loginBox = source('src/components/auth/JcCloudLoginBox.vue')

  assert.doesNotMatch(loginBox, /createAutoGroupApiKey/)
  assert.doesNotMatch(loginBox, /newApiOneClickLogin/)
  assert.match(loginBox, /请先填写并保存 API Key/)
})

test('桌面端不再用登录状态收起 Key 输入', () => {
  const loginBox = source('src/components/auth/JcCloudLoginBox.vue')

  assert.doesNotMatch(loginBox, /已登录，可直接使用/)
  // Key 是唯一调用前提。桌面端若按 loggedIn 收起输入框，用户会以为「登录了就能用」。
  assert.match(loginBox, /v-if="accountOnly && loggedIn && !advancedOpen && !apiKeyDraft"/)
  assert.doesNotMatch(loginBox, /v-if="loggedIn && !advancedOpen && !apiKeyDraft"/)
})

test('桌面端「一键登录」换成占位的「多端同步」并标灰', () => {
  const loginBox = source('src/components/auth/JcCloudLoginBox.vue')

  // 桌面端不提供登录入口：现在填 Key 就能用，登录位留给以后的多端同步。
  assert.match(loginBox, /<span>多端同步<\/span>/)
  assert.match(loginBox, /class="jc-login-link jc-login-sync"[^>]*disabled/s)
  // 手机端账号页冻结，登录入口必须保留。
  assert.match(loginBox, /v-else class="jc-login-link jc-login-primary"/)
})

test('云端必需文案只指向 Key，不提账号登录', () => {
  for (const kind of ['chat', 'files', 'media']) {
    const message = getCloudRequiredMessage(kind)
    assert.match(message, /管理密钥/)
    assert.match(message, /本地模型/)
    assert.doesNotMatch(message, /账号登录/)
    assert.doesNotMatch(message, /一键登录/)
  }
})
