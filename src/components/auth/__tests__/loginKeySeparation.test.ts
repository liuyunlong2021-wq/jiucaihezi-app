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

test('已登录不再等同于可直接使用云端模型', () => {
  const loginBox = source('src/components/auth/JcCloudLoginBox.vue')

  assert.doesNotMatch(loginBox, /已登录，可直接使用/)
  assert.match(loginBox, /云端同步/)
})

test('云端必需文案把账号登录和模型调用 Key 分开', () => {
  for (const kind of ['chat', 'files', 'media']) {
    const message = getCloudRequiredMessage(kind)
    assert.match(message, /账号登录/)
    assert.match(message, /云端同步/)
    assert.match(message, /管理密钥/)
    assert.match(message, /本地模型/)
    assert.doesNotMatch(message, /一键登录生成 Key/)
  }
})
