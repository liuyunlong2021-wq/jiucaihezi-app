import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('SettingsPanel keeps requested API action order with one-click login first', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')
  const loginSource = readFileSync(join(process.cwd(), 'src/components/auth/JcCloudLoginBox.vue'), 'utf8')
  const firstActionsStart = loginSource.indexOf('<div class="jc-login-actions primary">')
  const firstActionsEnd = loginSource.indexOf('<label class="jc-login-label">API Key</label>')
  const secondActionsStart = loginSource.indexOf('<div class="jc-login-actions secondary">')
  const secondActionsEnd = loginSource.indexOf('<button class="jc-login-save"')

  assert.ok(firstActionsStart > -1)
  assert.ok(firstActionsEnd > firstActionsStart)
  assert.ok(secondActionsStart > firstActionsEnd)
  assert.ok(secondActionsEnd > secondActionsStart)
  assert.equal(source.includes('<JcCloudLoginBox'), true)

  const firstActions = loginSource.slice(firstActionsStart, firstActionsEnd)
  assert.ok(firstActions.indexOf('一键登录') < firstActions.indexOf('下载APP'))
  assert.ok(firstActions.indexOf('下载APP') < firstActions.indexOf('充值'))
  assert.ok(firstActions.indexOf('充值') < firstActions.indexOf('使用日志'))

  const secondActions = loginSource.slice(secondActionsStart, secondActionsEnd)
  assert.ok(secondActions.indexOf('一键抄配置') < secondActions.indexOf('管理密钥'))
  assert.ok(secondActions.indexOf('管理密钥') < secondActions.indexOf('邀请赚米'))
  assert.ok(secondActions.indexOf('邀请赚米') < secondActions.indexOf('白嫖签到'))
})

test('SettingsPanel one-click login opens the account password dialog', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')
  const loginSource = readFileSync(join(process.cwd(), 'src/components/auth/JcCloudLoginBox.vue'), 'utf8')
  const openDialogStart = loginSource.indexOf('function openLoginDialog()')
  const openDialogEnd = loginSource.indexOf('function closeLoginDialog()')
  const openDialogBlock = loginSource.slice(openDialogStart, openDialogEnd)

  assert.equal(source.includes('beginDesktopBrowserLogin'), false)
  assert.equal(source.includes('handleCloudLoginSuccess'), true)
  assert.equal(source.includes('gatewayLogin'), true)
  assert.equal(source.includes(':login="loginWithGateway"'), true)
  assert.equal(source.includes(':browser-login='), false)
  assert.equal(loginSource.includes('loginDialogOpen'), true)
  assert.equal(loginSource.includes('submitLogin'), true)
  assert.equal(loginSource.includes('browserLogin'), true)
  assert.equal(loginSource.includes('已登录，可直接使用'), true)
  assert.equal(loginSource.includes('高级：使用自己的 API Key'), true)
  assert.equal(openDialogBlock.includes('loginDialogOpen.value = true'), true)
  assert.equal(openDialogBlock.includes('window.location.href'), false)
  assert.equal(openDialogBlock.includes('openExternal('), false)
})

test('SettingsPanel login dialog keeps registration as an external NewAPI account action', () => {
  const loginSource = readFileSync(join(process.cwd(), 'src/components/auth/JcCloudLoginBox.vue'), 'utf8')

  assert.equal(loginSource.includes('注册账号'), true)
  assert.equal(loginSource.includes("open(`${normalizedApiBase}/sign-up`)"), true)
  assert.equal(loginSource.includes('gatewayRegister('), false)
})

test('desktop integration no longer injects NewAPI auto-key creation flow', () => {
  const tauriSource = readFileSync(join(process.cwd(), 'src-tauri/src/lib.rs'), 'utf8')

  assert.equal(tauriSource.includes('function autoCreateDesktopApiKey()'), false)
  assert.equal(tauriSource.includes('jcDesktopState'), false)
  assert.equal(tauriSource.includes("fetch('/api/token/'"), false)
  assert.equal(tauriSource.includes("tauri://localhost/index.html"), false)
})

test('ActivityRail exposes the canvas-backed Creation panel without a duplicate Canvas tab', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/rail/ActivityRail.vue'), 'utf8')
  const tabsStart = source.indexOf('const allTabs = [')
  const tabsEnd = source.indexOf('const bottomTabs = [')
  const tabsBlock = source.slice(tabsStart, tabsEnd)

  assert.ok(tabsStart > -1)
  assert.ok(tabsEnd > tabsStart)
  assert.equal(tabsBlock.includes("key: 'canvas'"), false)
  assert.equal(tabsBlock.includes("key: 'creation'"), true)
  assert.equal(tabsBlock.includes("labelKey: 'rail.creation'"), true)
  assert.equal(source.includes('webHiddenTabs'), true)
  assert.equal(source.includes("'review'"), true)
  assert.equal(source.includes('!isWebRuntime.value || !webHiddenTabs.has(tab.key)'), true)
  assert.equal(source.includes('v-if="!(isWebRuntime && active === \'review\')"'), false)
})

test('SettingsPanel keeps developer-only OpenCode upgrade commands out of user settings', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')

  assert.equal(source.includes('OPENCODE_RUNTIME_INFO.version'), false)
  assert.equal(source.includes('pnpm opencode:update && pnpm tauri:build'), false)
})

test('MCP extensions live in Settings after local models, not in Tool Warehouse', () => {
  const settingsSource = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')
  const warehouseSource = readFileSync(join(process.cwd(), 'src/components/tools/ToolWarehousePanel.vue'), 'utf8')
  const layoutSource = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')
  const railSource = readFileSync(join(process.cwd(), 'src/components/rail/ActivityRail.vue'), 'utf8')
  const mcpManager = readFileSync(join(process.cwd(), 'src/components/mcp/McpManagerPanel.vue'), 'utf8')
  const mcpCatalog = readFileSync(join(process.cwd(), 'src/data/mcpCatalog.ts'), 'utf8')

  assert.equal(settingsSource.includes("import McpManagerPanel from '@/components/mcp/McpManagerPanel.vue'"), true)
  assert.equal(settingsSource.includes('showMcpExtensions'), true)
  assert.equal(settingsSource.includes("'open-mcp-extensions'"), true)
  assert.equal(settingsSource.includes('MCP 扩展'), true)
  assert.ok(settingsSource.indexOf('<!-- MCP 扩展 -->') > settingsSource.indexOf('<!-- 本地模型 -->'))
  assert.equal(warehouseSource.includes("import McpManagerPanel from '@/components/mcp/McpManagerPanel.vue'"), false)
  assert.equal(warehouseSource.includes("import ObsidianSetupWizard from '@/components/tools/ObsidianSetupWizard.vue'"), false)
  assert.equal(warehouseSource.includes('external_tool_extensions'), false)
  assert.equal(warehouseSource.includes('showObsidianWizard'), false)
  assert.equal(railSource.includes("key: 'mcp'"), false)
  assert.equal(layoutSource.includes("import McpManagerPanel from '@/components/mcp/McpManagerPanel.vue'"), false)
  assert.equal(layoutSource.includes("rightPanel === 'mcp'"), false)
  assert.equal(layoutSource.includes("mobilePanel === 'mcp'"), false)
  assert.equal(mcpManager.includes('OpenCodeMcpStatusCard'), false)
  assert.equal(mcpManager.includes('OpenCode 官方状态'), false)
  assert.equal(mcpManager.includes('<h3>外部工具扩展</h3>'), false)
  assert.equal(mcpManager.includes('连接外部系统提供的工具。安装不等于暴露给模型，启用后才进入工具池。'), false)
  assert.equal(mcpManager.includes('可添加扩展'), true)
  assert.equal(mcpManager.includes('搜索 MCP'), false)
  assert.equal(mcpCatalog.includes("id: 'github'"), true)
  assert.equal(mcpCatalog.includes("id: 'obsidian'"), true)
  assert.equal(mcpCatalog.includes('obsidian-mcp-server@3.2.9'), true)
  assert.equal(mcpCatalog.includes('opencode-official'), false)
  assert.equal(mcpCatalog.includes('skill-seekers'), false)
  assert.equal(mcpCatalog.includes("id: 'notion'"), false)
  assert.equal(mcpCatalog.includes("id: 'linear'"), false)
  assert.equal(mcpCatalog.includes("id: 'slack'"), false)
  assert.equal(mcpCatalog.includes("id: 'filesystem'"), false)
})

test('ActivityRail renders help as a single Chinese glyph', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/rail/ActivityRail.vue'), 'utf8')

  assert.equal(source.includes('<span class="ab-help-glyph">帮</span>'), true)
  assert.equal(source.includes('ab-help-text'), false)
  assert.equal(source.includes('<span class="mso">help</span>'), false)
})
