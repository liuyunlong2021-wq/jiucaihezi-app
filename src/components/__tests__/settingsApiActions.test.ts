import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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
  assert.equal(tabsBlock.includes("labelKey: 'rail.navCreation'"), true)
  assert.equal(source.includes('webHiddenTabs'), true)
  assert.equal(source.includes("key: 'review'"), false)
  assert.equal(source.includes('!isWebRuntime.value || !webHiddenTabs.has(tab.key)'), true)
  assert.equal(source.includes('v-if="!(isWebRuntime && active === \'review\')"'), false)
})

test('ActivityRail starts with Chat and keeps the requested text-tab order', () => {
  const railSource = readFileSync(join(process.cwd(), 'src/components/rail/ActivityRail.vue'), 'utf8')
  const layoutSource = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')
  const i18nSource = readFileSync(join(process.cwd(), 'src/i18n/index.ts'), 'utf8')
  const tabsStart = railSource.indexOf('const allTabs = [')
  const tabsEnd = railSource.indexOf('const tabs = computed')
  const tabsBlock = railSource.slice(tabsStart, tabsEnd)

  assert.ok(tabsBlock.indexOf("key: 'chat'") < tabsBlock.indexOf("key: 'ecommerce'"))
  assert.ok(tabsBlock.indexOf("key: 'ecommerce'") < tabsBlock.indexOf("key: 'editor'"))
  assert.ok(tabsBlock.indexOf("key: 'editor'") < tabsBlock.indexOf("key: 'creation'"))
  assert.ok(tabsBlock.indexOf("key: 'creation'") < tabsBlock.indexOf("key: 'files'"))
  assert.equal(railSource.includes('class="ab-main-tab"'), true)
  assert.equal(railSource.includes('ab-tab-label'), true)
  assert.equal(railSource.includes('border-radius: 50%;'), true)
  assert.equal(i18nSource.includes("navChat: '对话'"), true)
  assert.equal(i18nSource.includes("navChat: 'Chat'"), true)
  assert.equal(layoutSource.includes("const rightPanel = ref<string>('')"), true)
  assert.match(layoutSource, /if \(mode === 'chat'\) \{[\s\S]*?ecommerceWorkbenchStore\.setSurface\('collaboration'\)/)
  assert.equal(layoutSource.includes("isEcommerceWorkbench ? 'ecommerce' : (rightPanel || 'chat')"), true)
})

test('editor and creation mount once while the file column opens without a width transition', () => {
  const source = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')
  const fileTreeStyle = source.match(/\.ws-filetree\s*\{[^}]*\}/)?.[0] || ''

  assert.equal(source.includes('const editorMounted = ref(false)'), true)
  assert.equal(source.includes('const creationMounted = ref(false)'), true)
  assert.equal(source.includes('function ensurePanelMounted(mode: string)'), true)
  assert.equal(source.includes('<EditorPanel v-if="editorMounted" v-show="rightPanel === \'editor\' && isMember" />'), true)
  assert.equal(source.includes('<CreationPanel v-if="creationMounted" v-show="rightPanel === \'creation\' && creationEnabled" />'), true)
  assert.equal(fileTreeStyle.includes('transition:'), false)
})

test('SettingsPanel keeps developer-only OpenCode upgrade commands out of user settings', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')

  assert.equal(source.includes('OPENCODE_RUNTIME_INFO.version'), false)
  assert.equal(source.includes('pnpm opencode:update && pnpm tauri:build'), false)
})

test('MCP extensions live in Settings after local models, not in Tool Warehouse', () => {
  const settingsSource = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')
  const layoutSource = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')
  const railSource = readFileSync(join(process.cwd(), 'src/components/rail/ActivityRail.vue'), 'utf8')
  const mcpManager = readFileSync(join(process.cwd(), 'src/components/mcp/McpManagerPanel.vue'), 'utf8')
  const mcpCatalog = readFileSync(join(process.cwd(), 'src/data/mcpCatalog.ts'), 'utf8')

  assert.equal(settingsSource.includes("import McpManagerPanel from '@/components/mcp/McpManagerPanel.vue'"), true)
  assert.equal(settingsSource.includes('showMcpExtensions'), true)
  assert.equal(settingsSource.includes("'open-mcp-extensions'"), true)
  assert.equal(settingsSource.includes('MCP 扩展'), true)
  assert.ok(settingsSource.indexOf('<!-- MCP 扩展 -->') > settingsSource.indexOf('<!-- 本地模型 -->'))
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

test('product has no Tool Warehouse or recommended-tool runtime', () => {
  const root = process.cwd()
  const layoutSource = readFileSync(join(root, 'src/layouts/WorkspaceLayout.vue'), 'utf8')
  const railSource = readFileSync(join(root, 'src/components/rail/ActivityRail.vue'), 'utf8')
  const githubSkillCard = readFileSync(join(root, 'src/components/skills/GitHubSkillCard.vue'), 'utf8')
  const toolCommands = readFileSync(join(root, 'src-tauri/src/commands/tools.rs'), 'utf8')
  const appCommands = readFileSync(join(root, 'src-tauri/src/lib.rs'), 'utf8')
  const archive = readFileSync(join(root, 'docs/wiki/开发/工具仓库推荐清单归档.md'), 'utf8')

  assert.equal(existsSync(join(root, 'src/components/tools/ToolWarehousePanel.vue')), false)
  assert.equal(existsSync(join(root, 'src/data/githubTools.json')), false)
  assert.equal(existsSync(join(root, 'src/data/vaultTemplates.ts')), false)
  assert.equal(existsSync(join(root, 'src/utils/vaultScaffold.ts')), false)
  assert.equal(layoutSource.includes('ToolWarehousePanel'), false)
  assert.equal(layoutSource.includes("'tools'"), false)
  assert.equal(railSource.includes("key: 'tools'"), false)
  assert.equal(githubSkillCard.includes('check_tool_installed'), false)
  assert.equal(githubSkillCard.includes('check_opencode_plugin'), false)
  assert.equal(toolCommands.includes('pub fn check_tool_installed'), false)
  assert.equal(toolCommands.includes('pub fn check_opencode_plugin'), false)
  assert.equal(toolCommands.includes('pub fn check_all_tools'), false)
  assert.equal(appCommands.includes('commands::tools::check_tool_installed'), false)
  assert.equal(appCommands.includes('commands::tools::check_opencode_plugin'), false)
  assert.equal(appCommands.includes('commands::tools::check_all_tools'), false)
  assert.equal(appCommands.includes('commands::dev::scaffold_vault'), false)
  assert.match(archive, /19 项/)
  assert.match(archive, /yt-dlp/)
  assert.match(archive, /电子书下载宝库/)
})

test('plugins live in Settings after MCP, not in a standalone workspace panel', () => {
  const settingsSource = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')
  const layoutSource = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')
  const pluginPanel = readFileSync(join(process.cwd(), 'src/components/plugins/PluginPanel.vue'), 'utf8')
  const pluginStore = readFileSync(join(process.cwd(), 'src/stores/pluginStore.ts'), 'utf8')

  assert.equal(settingsSource.includes("import PluginPanel from '@/components/plugins/PluginPanel.vue'"), true)
  assert.equal(settingsSource.includes('showPluginManager'), true)
  assert.ok(settingsSource.indexOf('<!-- 插件 -->') > settingsSource.indexOf('<!-- MCP 扩展 -->'))
  assert.equal(layoutSource.includes("import PluginPanel from '@/components/plugins/PluginPanel.vue'"), false)
  assert.equal(layoutSource.includes("rightPanel === 'plugins'"), false)
  assert.equal(pluginPanel.includes('工具仓库推荐'), false)
  assert.equal(pluginStore.includes("@/data/pluginCatalog"), true)
})

test('Skill Warehouse and review live in Settings around MCP and plugins', () => {
  const settingsSource = readFileSync(join(process.cwd(), 'src/components/settings/SettingsPanel.vue'), 'utf8')
  const layoutSource = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')
  const railSource = readFileSync(join(process.cwd(), 'src/components/rail/ActivityRail.vue'), 'utf8')

  assert.equal(settingsSource.includes("import CentralSkillsPanel from '@/components/skills/CentralSkillsPanel.vue'"), true)
  assert.equal(settingsSource.includes("import ReviewPanel from '@/components/chat/ReviewPanel.vue'"), true)
  assert.equal(settingsSource.includes('showSkillsManager'), true)
  assert.equal(settingsSource.includes('showReviewPanel'), true)
  assert.ok(settingsSource.indexOf('<!-- Skill 仓库 -->') > settingsSource.indexOf('<!-- 本地模型 -->'))
  assert.ok(settingsSource.indexOf('<!-- Skill 仓库 -->') < settingsSource.indexOf('<!-- MCP 扩展 -->'))
  assert.ok(settingsSource.indexOf('<!-- 变更审查 -->') > settingsSource.indexOf('<!-- 插件 -->'))
  assert.equal(layoutSource.includes("import CentralSkillsPanel from '@/components/skills/CentralSkillsPanel.vue'"), false)
  assert.equal(layoutSource.includes("import ReviewPanel from '@/components/chat/ReviewPanel.vue'"), false)
  assert.equal(layoutSource.includes("rightPanel === 'skills'"), false)
  assert.equal(layoutSource.includes("rightPanel === 'review'"), false)
  assert.equal(railSource.includes("key: 'skills'"), false)
  assert.equal(railSource.includes("key: 'review'"), false)
})

test('Ecommerce workbench exposes a direct Chat entry in its header', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/workbench/EcommerceWorkbench.vue'), 'utf8')
  const header = source.slice(source.indexOf('<header class="ecom-header">'), source.indexOf('</header>'))

  assert.match(header, /<span>对话<\/span>/)
  assert.match(header, /@click="openCollaboration"/)
  assert.match(source, /function openCollaboration\(\) \{\s*workbenchStore\.setSurface\('collaboration'\)/)
})

test('plugin cards keep their install action visible in narrow settings panels', () => {
  const pluginPanel = readFileSync(join(process.cwd(), 'src/components/plugins/PluginPanel.vue'), 'utf8')

  assert.equal(pluginPanel.includes('flex: 0 0 auto;'), true)
  assert.equal(pluginPanel.includes('overflow-wrap: anywhere;'), true)
  assert.equal(pluginPanel.includes('white-space: normal;'), true)
  assert.equal(pluginPanel.includes('--jc-accent'), false)
  assert.equal(pluginPanel.includes('--jc-bg-tertiary'), false)
  assert.equal(pluginPanel.includes('--jc-text-secondary'), false)
})

test('ActivityRail renders help as a single Chinese glyph', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/rail/ActivityRail.vue'), 'utf8')

  assert.equal(source.includes('<span class="ab-help-glyph">帮</span>'), true)
  assert.equal(source.includes('ab-help-text'), false)
  assert.equal(source.includes('<span class="mso">help</span>'), false)
})
