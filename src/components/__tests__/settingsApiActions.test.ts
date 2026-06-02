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

test('SettingsPanel one-click login opens a Studio login dialog without NewAPI web redirects', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')
  const oneClickStart = source.indexOf('async function oneClickLogin()')
  const oneClickEnd = source.indexOf('function downloadApp()')
  const oneClickBlock = source.slice(oneClickStart, oneClickEnd)

  assert.equal(source.includes('async function oneClickLogin()'), true)
  assert.equal(source.includes('gatewayLogin'), true)
  assert.equal(source.includes('loginDialogOpen'), true)
  assert.equal(source.includes('handleGatewayLogin'), true)
  assert.equal(source.includes('已登录，可直接使用'), true)
  assert.equal(source.includes('高级：使用自己的 API Key'), true)
  assert.equal(oneClickBlock.includes('loginDialogOpen.value = true'), true)
  assert.equal(oneClickBlock.includes('window.location.href'), false)
  assert.equal(oneClickBlock.includes('openExternal('), false)
})

test('SettingsPanel login dialog keeps registration as an external NewAPI account action', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')

  assert.equal(source.includes('function openRegisterPage()'), true)
  assert.equal(source.includes('注册账号'), true)
  assert.equal(source.includes("openExternal('https://api.jiucaihezi.studio/sign-up')"), true)
  assert.equal(source.includes('gatewayRegister('), false)
})

test('desktop integration no longer injects NewAPI auto-key creation flow', () => {
  const tauriSource = readFileSync(join(process.cwd(), 'src-tauri/src/lib.rs'), 'utf8')

  assert.equal(tauriSource.includes('function autoCreateDesktopApiKey()'), false)
  assert.equal(tauriSource.includes('jcDesktopState'), false)
  assert.equal(tauriSource.includes("fetch('/api/token/'"), false)
  assert.equal(tauriSource.includes("tauri://localhost/index.html"), false)
})

test('ActivityRail hides Canvas and Creation until those surfaces are production-ready', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/rail/ActivityRail.vue'), 'utf8')
  const tabsStart = source.indexOf('const tabs = [')
  const tabsEnd = source.indexOf('const bottomTabs = [')
  const tabsBlock = source.slice(tabsStart, tabsEnd)

  assert.ok(tabsStart > -1)
  assert.ok(tabsEnd > tabsStart)
  assert.equal(tabsBlock.includes("key: 'canvas'"), false)
  assert.equal(tabsBlock.includes("key: 'creation'"), false)
})
