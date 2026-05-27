import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('SettingsPanel hides the legacy account routing tier selector', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')

  assert.equal(source.includes('setAccountMode'), false)
  assert.equal(source.includes('modeOptions'), false)
  assert.equal(source.includes('settings.normalMode'), false)
  assert.equal(source.includes('settings.performanceMode'), false)
  assert.equal(source.includes('高性能模式'), false)
})

test('SettingsPanel login path never shows legacy recognized-model status', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')

  assert.equal(source.includes('登录成功，已识别'), false)
  assert.equal(source.includes('账号和模型已同步'), false)
  assert.equal(source.includes('agentStore.availableModels.length'), false)
})

test('SettingsPanel keeps model fetching out of account login and refresh flows', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')
  const submitStart = source.indexOf('async function submitAccount()')
  const sendCodeStart = source.indexOf('async function sendVerificationCode()')
  const refreshStart = source.indexOf('async function refreshAccount()')
  const signinStart = source.indexOf('async function goSignin()')

  assert.ok(submitStart > -1)
  assert.ok(sendCodeStart > submitStart)
  assert.ok(refreshStart > -1)
  assert.ok(signinStart > refreshStart)
  assert.equal(source.slice(submitStart, sendCodeStart).includes('fetchModels'), false)
  assert.equal(source.slice(refreshStart, signinStart).includes('fetchModels'), false)
  assert.equal(source.includes('fetchModels'), false)
})

test('SettingsPanel keeps web-aligned membership status and confirmation UI', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')

  assert.equal(source.includes('membershipPlanTitle'), true)
  assert.equal(source.includes('sp-member-plan'), true)
  assert.equal(source.includes('membershipUntilText'), true)
  assert.equal(source.includes('membershipActionLabel'), true)
  assert.equal(source.includes('const isMember = computed(() => Boolean(isCloudLoggedIn()))'), true)
  assert.equal(source.includes('showMembershipConfirm'), true)
  assert.equal(source.includes('settings.memberUntil'), true)
  assert.equal(source.includes('settings.openMembership'), true)
  assert.equal(source.includes('settings.membershipCost'), true)
  assert.equal(source.includes('sp-level-crown'), true)
  assert.equal(source.includes('sp-modal-mask'), true)
})

test('SettingsPanel includes web-aligned account tools and registration verification code', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')

  assert.equal(source.includes('login: account'), true)
  assert.equal(source.includes('email: registerEmail.value.trim() || account'), false)
  assert.equal(source.includes('payload.email = registerEmail.value.trim() || account'), true)
  assert.equal(source.includes('sendVerificationCode'), true)
  assert.equal(source.includes('verificationCode'), true)
  assert.equal(source.includes('activeUserTool'), true)
  assert.equal(source.includes('topupPresets'), true)
  assert.equal(source.includes('topupMethod'), true)
  assert.equal(source.includes('goInvite'), true)
  assert.equal(source.includes('submitRedeemCode'), true)
  assert.equal(source.includes('goUsageLogs'), true)
  assert.equal(source.includes('sp-topup-grid'), true)
  assert.equal(source.includes('sp-log-table'), true)
  assert.equal(source.includes('sp-invite-box'), true)
  assert.equal(source.includes('sp-redeem-row'), true)
})

test('SettingsPanel keeps desktop Ollama controls below cloud account tools', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')
  const topupIndex = source.indexOf('sp-topup')
  const localIndex = source.indexOf('<!-- 本地模型 -->')

  assert.ok(topupIndex > -1)
  assert.ok(localIndex > -1)
  assert.ok(localIndex > topupIndex)
})

test('SettingsPanel only shows non-chat desktop utilities to members', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')

  assert.equal(source.includes('v-if="isMember" class="sp-section sp-local-section"'), true)
  assert.equal(source.includes('v-if="isMember" class="sp-section sp-data-migration-section"'), true)
  assert.equal(source.includes('v-if="gatewayStore.isAuthenticated" class="sp-section sp-local-section"'), false)
})

test('SettingsPanel renders Gateway-standard payment QR states instead of raw text only', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')

  assert.equal(source.includes('payment.qr_image_url'), true)
  assert.equal(source.includes('payment.scan_url'), true)
  assert.equal(source.includes('topupDisplayQrUrl'), true)
  assert.equal(source.includes('buildQrCodeSvgDataUrl'), true)
  assert.equal(source.includes('api.qrserver.com'), false)
  assert.equal(source.includes('topupNoQrText'), true)
  assert.equal(source.includes('@click="openTopupPayLink"'), true)
  assert.equal(source.includes(':src="topupDisplayQrUrl"'), true)
})
