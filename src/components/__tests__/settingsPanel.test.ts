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

test('SettingsPanel only refreshes model list from explicit save or cloud login success', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')
  const saveStart = source.indexOf('async function saveSettings()')
  const loginStart = source.indexOf('async function loginWithGateway(')
  const loginSuccessStart = source.indexOf('async function handleCloudLoginSuccess(')
  const downloadStart = source.indexOf('function downloadApp()')

  assert.ok(saveStart > -1)
  assert.ok(loginStart > saveStart)
  assert.ok(loginSuccessStart > loginStart)
  assert.ok(downloadStart > loginSuccessStart)
  assert.equal(source.slice(saveStart, loginStart).includes('fetchModels'), true)
  assert.equal(source.slice(loginStart, loginSuccessStart).includes('fetchModels'), false)
  assert.equal(source.slice(loginSuccessStart, downloadStart).includes('fetchModels'), true)
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

test('SettingsPanel keeps Ollama local model copy compact', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')

  assert.equal(source.includes('连接本机 Ollama 后，已安装模型会直接出现在对话框上方的模型选择器里。'), false)
  assert.equal(source.includes('Ollama 默认不需要 API Key，也不需要填写地址。先安装 Ollama 和模型，再点击连接即可。'), false)
  assert.equal(source.includes('可在对话框模型选择器中选择'), false)
  assert.equal(source.includes('已识别 ${installedLocalModelCount} 个模型'), true)
})

test('SettingsPanel can disable media enhancement and revoke cross-model consent', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')

  assert.equal(source.includes('jcCreativeMediaEnhancementEnabled'), true)
  assert.equal(source.includes('jcCreativeMediaSpecialistConsent'), true)
  assert.equal(source.includes('智能媒体增强'), true)
  assert.equal(source.includes('撤回跨模型授权'), true)
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
