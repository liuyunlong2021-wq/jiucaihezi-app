import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('SettingsPanel keeps requested API action order with one-click login first', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')
  const firstActionsStart = source.indexOf('<div class="sp-api-actions primary">')
  const firstActionsEnd = source.indexOf('<label class="sp-label">API Key</label>')
  const secondActionsStart = source.indexOf('<div class="sp-api-actions secondary">')
  const secondActionsEnd = source.indexOf('<button class="sp-save-btn"')

  assert.ok(firstActionsStart > -1)
  assert.ok(firstActionsEnd > firstActionsStart)
  assert.ok(secondActionsStart > firstActionsEnd)
  assert.ok(secondActionsEnd > secondActionsStart)

  const firstActions = source.slice(firstActionsStart, firstActionsEnd)
  assert.ok(firstActions.indexOf('一键登录') < firstActions.indexOf('下载APP'))
  assert.ok(firstActions.indexOf('下载APP') < firstActions.indexOf('充值'))
  assert.ok(firstActions.indexOf('充值') < firstActions.indexOf('使用日志'))

  const secondActions = source.slice(secondActionsStart, secondActionsEnd)
  assert.ok(secondActions.indexOf('获取 Key') < secondActions.indexOf('邀请赚米'))
  assert.ok(secondActions.indexOf('邀请赚米') < secondActions.indexOf('白嫖签到'))
})

test('SettingsPanel one-click login opens NewAPI and callback key only pre-fills the input', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')
  const pendingKeyStart = source.indexOf('const pendingKey = popPendingApiKey()')
  const saveSettingsStart = source.indexOf('async function saveSettings()')
  const pendingKeyBlock = source.slice(pendingKeyStart, saveSettingsStart)
  const oneClickStart = source.indexOf('function oneClickLogin()')
  const oneClickEnd = source.indexOf('function downloadApp()')
  const oneClickBlock = source.slice(oneClickStart, oneClickEnd)

  assert.equal(source.includes('function oneClickLogin()'), true)
  assert.equal(oneClickBlock.includes("window.location.href = 'https://api.jiucaihezi.studio/'"), true)
  assert.equal(oneClickBlock.includes('openExternal('), false)
  assert.equal(source.includes('popPendingApiKey()'), true)
  assert.equal(source.includes("saveStatus.value = '✅ 已自动填入 API Key，请点击保存设置完成启用'"), true)
  assert.equal(pendingKeyBlock.includes('apiKey.value = pendingKey'), true)
  assert.equal(pendingKeyBlock.includes('setApiKey('), false)
  assert.equal(pendingKeyBlock.includes('saveSettings()'), false)
})
