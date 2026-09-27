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
  assert.doesNotMatch(session, /attachment|attachments|mention|selectMention|@文件|@影音|@排版|persistentAttachments/)
})

test('待审批动作的三个决定都接到当前审批项的精确 ID', () => {
  const session = source('src/mobile/MobileSessionView.vue')

  assert.match(session, /<ToolApprovalStrip[\s\S]*:message="approval\.message"/)
  assert.match(session, /@reject="\$emit\('approve', approval\.id, 'reject'\)"/)
  assert.match(session, /@once="\$emit\('approve', approval\.id, 'approve'\)"/)
  assert.match(session, /@always="\$emit\('approve', approval\.id, 'always'\)"/)
})

test('扫码只取二维码，并交给协议的 offer 解析器', () => {
  const remote = source('src/mobile/useMobileRemote.ts')

  assert.match(remote, /scan\(\{\s*formats:\s*\[Format\.QRCode\]\s*\}\)/)
  assert.match(remote, /parsePairingOffer\(result\.content\)/)
  // 不能绕开协议解析直接 JSON.parse 二维码内容。
  assert.doesNotMatch(remote, /JSON\.parse\(result\.content\)/)
})

test('通道断开由传输层通知客户端进入离线，不猜任务结果', () => {
  const remote = source('src/mobile/useMobileRemote.ts')

  assert.match(remote, /createTauriMobileTransport\(\{\s*onClosed:\s*\(\)\s*=>\s*onClosed\.value\?\.\(\)\s*\}\)/)
  assert.match(remote, /onClosed\.value = \(\) => client\.handleTransportClosed\(\)/)
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
  assert.match(remote, /const send = \(text: string\) => client\.sendMessage\(text\)/)
  assert.match(remote, /const stop = \(\) => client\.stopRun\(\)/)
  assert.match(remote, /const respondApproval = \(approvalId: string, decision: MobileRemoteApprovalDecision\)/)
})
