import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'

const source = (path: string) => readFileSync(path, 'utf8')
const mobileFiles = () => readdirSync('src/mobile', { withFileTypes: true })
  .filter(entry => entry.isFile() && /\.(vue|ts)$/.test(entry.name))
  .map(entry => `src/mobile/${entry.name}`)

test('控制器只发纯文字：没有附件、@ 提及或文件引用入口', () => {
  const session = source('src/mobile/MobileSessionView.vue')

  assert.match(session, /<textarea/)
  assert.match(session, /emit\('send', text\)/)
  // 合同 §7.2 / §12.2：首期不上传附件、不引用文件、不打开 @ 能力。
  assert.doesNotMatch(session, /attachment|attachments|mention|selectMention|permissionLabel|@影音|@排版|persistentAttachments/)
})

test('待审批动作的三个决定都接到当前审批项的精确 ID', () => {
  const session = source('src/mobile/MobileSessionView.vue')

  assert.match(session, /<ToolApprovalStrip[\s\S]*:message="approval\.message"/)
  assert.match(session, /@reject="\$emit\('approve', approval\.id, 'reject'\)"/)
  assert.match(session, /@once="\$emit\('approve', approval\.id, 'approve'\)"/)
  assert.match(session, /@always="\$emit\('approve', approval\.id, 'always'\)"/)
})

test('纯工具轮结束后仍显示执行步骤，不能只在运行中显示', () => {
  const session = source('src/mobile/MobileSessionView.vue')
  assert.match(session, /<ul v-if="view\.run\.steps\.length" class="steps">/)
})

test('桌面发起的临时轮次显示在手机且不重复手机自己的 pending', () => {
  const session = source('src/mobile/MobileSessionView.vue')
  assert.match(session, /v-if="remotePendingTurn"/)
  assert.match(session, /props\.view\.pendingMessages\.some\(message => message\.runId && message\.runId === props\.view\.run\.runId/)
})

test('已连电脑但没有当前对话时，手机明确提示等待而非引导重复配对', () => {
  const controller = source('src/mobile/MobileController.vue')
  const pairing = source('src/mobile/MobilePairingView.vue')
  assert.match(controller, /:waiting-for-conversation="view\.state === 'connecting' && Boolean\(status\?\.connected\)"/)
  assert.match(pairing, /等待电脑打开对话/)
  assert.match(pairing, /v-if="!status\?\.connected" class="primary"/)
})

test('传输已连接但会话尚未进入时提供重试，不再诱导扫码或粘贴配对', () => {
  const pairing = source('src/mobile/MobilePairingView.vue')
  const remote = source('src/mobile/useMobileRemote.ts')
  assert.match(pairing, /status\?\.paired && \(!status\?\.connected \|\| !waitingForConversation\)[\s\S]*重新进入当前对话/)
  assert.match(pairing, /<details v-if="!status\?\.connected" class="fallback">/)
  assert.match(remote, /if \(next\.connected\) error\.value = ''/)
})

test('扫码与粘贴都只把内容交给协议的 offer 解析器', () => {
  const remote = source('src/mobile/useMobileRemote.ts')

  assert.match(remote, /scan\(\{\s*formats:\s*\[Format\.QRCode\]\s*\}\)/)
  assert.match(remote, /pairWithOfferText\(result\.content\)/)
  assert.match(remote, /const offer = parsePairingOffer\(text\)/)
  // 不能绕开协议解析直接 JSON.parse 二维码内容。
  assert.doesNotMatch(remote, /JSON\.parse/)
})

test('扫码先申请相机权限，粘贴配对不触碰相机', () => {
  const remote = source('src/mobile/useMobileRemote.ts')
  const capabilities = source('src-tauri/capabilities/mobile.json')
  assert.match(remote, /requestPermissions\(\)/)
  assert.ok(remote.indexOf('requestPermissions()') < remote.indexOf('scan({ formats: [Format.QRCode] })'))
  assert.match(remote, /const pairByText = \(text: string\) => run\(\(\) => pairWithOfferText\(text\)\)/)
  assert.match(capabilities, /barcode-scanner:allow-request-permissions/)
})

test('通道断开由传输层通知客户端进入离线，不猜任务结果', () => {
  const remote = source('src/mobile/useMobileRemote.ts')

  assert.match(remote, /createTauriMobileTransport\(\{\s*onClosed:\s*\(\)\s*=>\s*onClosed\.value\?\.\(\)\s*\}\)/)
  assert.match(remote, /onClosed\.value = \(\) => \{\s*client\.handleTransportClosed\(\)/)
})

test('断开后刷新状态，回到前台自动重连', () => {
  const remote = source('src/mobile/useMobileRemote.ts')

  // 断开后不重拉状态，Rust 侧就还会说「已连接」，界面既看不到真相也没有重连入口。
  assert.match(remote, /handleTransportClosed\(\)[\s\S]{0,80}refreshStatus\(\)/)
  assert.match(remote, /document\.addEventListener\('visibilitychange'/)
  assert.match(remote, /shouldAutoReconnect\(next\)/)
  assert.match(remote, /else if \(next\.connected && view\.value\.state === 'connected'\) await client\.refresh\(\)/)
})

test('控制器不导入工作台运行时、Harness、模型或密钥', () => {
  const forbidden = /@app-root|deepSeekHarness|memoryChat|agentStore|runtime\/memory|runtime\/creation|runtime\/tools|mcpBridge|mcpStore|newApiClient|desktopRemoteBridge|desktopRemoteHost|@\/components\/memory|@\/stores/
  const files = mobileFiles()

  assert.ok(files.length >= 5, '控制器文件应当都在 src/mobile 下')
  for (const file of files) {
    assert.doesNotMatch(source(file), forbidden, `${file} 引入了桌面侧运行时`)
  }
})

test('控制器对外只有只读投影与三条控制动作', () => {
  const remote = source('src/mobile/useMobileRemote.ts')

  // §12.1：不新建对话、不选模型、不装 Skill、不配 MCP。
  assert.doesNotMatch(remote, /startNewConversation|selectModel|installSkill|mcp|apiKey/i)
  assert.match(remote, /const send = \(text: string\) => run\(\(\) => client\.sendMessage\(text\)\)/)
  assert.match(remote, /const stop = \(\) => run\(\(\) => client\.stopRun\(\)\)/)
  assert.match(remote, /const respondApproval = \(approvalId: string, decision: MobileRemoteApprovalDecision\)/)
})
