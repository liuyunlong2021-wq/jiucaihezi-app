import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('WorkspaceLayout passes reactive gateway member state into ActivityRail', () => {
  const source = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')

  assert.equal(source.includes('isCloudLoggedIn'), true)
  assert.equal(source.includes('const isMember = computed'), true)
  assert.equal(source.includes('isCloudLoggedIn()'), true)
  assert.equal(source.includes(':is-member="isMember"'), true)
})

test('WorkspaceLayout gates creation, canvas and warehouses by membership', () => {
  const source = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')

  assert.equal(source.includes('lockedPanels'), true)
  assert.equal(source.includes('membership-required'), true)
  assert.equal(source.includes("rightPanel.value = 'settings'"), true)
  assert.equal(source.includes("emitEvent('membership-required'"), true)
  assert.equal(source.includes("emitEvent('auth-required'"), false)
})

test('WorkspaceLayout keeps the session file tree visible for non-members', () => {
  const source = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')
  const fileTreeSource = readFileSync(join(process.cwd(), 'src/components/filetree/FileTreePanel.vue'), 'utf8')

  assert.equal(source.includes('isFileTreeVisible'), true)
  assert.equal(source.includes('!isFileTreeVisible ?'), true)
  assert.equal(source.includes('v-show="isFileTreeVisible"'), true)
  assert.equal(source.includes(':is-member="isMember"'), true)
  assert.equal(source.includes('isAuthenticated.value && !isFileTreeCollapsed.value'), false)
  assert.equal(fileTreeSource.includes("{ key: 'history', icon: 'chat', label: '会话' }"), true)
  assert.equal(fileTreeSource.includes('...(props.isMember ? ['), true)
  assert.equal(fileTreeSource.includes("return tab === 'history' || props.isMember"), true)
})

test('FileTreePanel hides file mutations in history-only mode for non-members', () => {
  const fileTreeSource = readFileSync(join(process.cwd(), 'src/components/filetree/FileTreePanel.vue'), 'utf8')

  assert.equal(fileTreeSource.includes('const isHistoryOnlyMode = computed'), true)
  assert.equal(fileTreeSource.includes('if (isHistoryOnlyMode.value) return'), true)
  assert.equal(fileTreeSource.includes('v-if="!isHistoryOnlyMode" class="fp-tool-btn"'), true)
  assert.equal(fileTreeSource.includes('<template v-if="!isHistoryOnlyMode">'), true)
  assert.equal(fileTreeSource.includes('非会员可双击恢复会话'), true)
})

test('FileTreePanel keeps history menu manual and opens sessions in the editor', () => {
  const fileTreeSource = readFileSync(join(process.cwd(), 'src/components/filetree/FileTreePanel.vue'), 'utf8')
  const historyMenuStart = fileTreeSource.indexOf('<template v-if="activeTab === \'history\'">')
  const historyMenuEnd = fileTreeSource.indexOf('<template v-else-if="activeTab === \'knowledge\'">')
  const historyMenu = fileTreeSource.slice(historyMenuStart, historyMenuEnd)

  assert.ok(historyMenuStart > -1)
  assert.ok(historyMenuEnd > historyMenuStart)
  assert.equal(historyMenu.includes('在编辑区打开'), true)
  assert.equal(historyMenu.includes('提炼知识'), false)
  assert.equal(historyMenu.includes('Distill'), false)
  assert.equal(historyMenu.includes('AI 分析对话'), false)
  assert.equal(fileTreeSource.includes('formatSessionForEditor'), true)
  assert.equal(fileTreeSource.includes('sessionStore.loadSessionMessages'), true)
  assert.equal(fileTreeSource.includes('选择模式'), true)
  assert.equal(fileTreeSource.includes('已选 {{ selectedIds.size }}'), true)
})

test('WorkspaceLayout blocks switch-panel events and template mounts for non-members', () => {
  const source = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')

  assert.equal(source.includes('function openMemberPanel'), true)
  assert.equal(source.includes('openMemberPanel(panel)'), true)
  assert.equal(source.includes("rightPanel === 'create' && isMember"), true)
  assert.equal(source.includes("rightPanel === 'agents' && isMember"), true)
  assert.equal(source.includes("rightPanel === 'tools' && isMember"), true)
  assert.equal(source.includes("rightPanel === 'editor' && isMember"), true)
  assert.equal(source.includes("rightPanel === 'creation' && isMember"), true)
})

test('WorkspaceLayout defaults non-member desktop users to the account panel instead of blank right space', () => {
  const source = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')

  assert.equal(source.includes("rightPanel.value = 'settings'"), true)
  assert.equal(source.includes('if (!member && rightPanel.value !== \'settings\')'), true)
  assert.equal(source.includes("const rightPanel = ref<string>('settings')"), true)
  assert.equal(source.includes("if (!isMember.value && mode === 'settings')"), true)
})

test('WorkspaceLayout does not couple account login state to model synchronization', () => {
  const source = readFileSync(join(process.cwd(), 'src/layouts/WorkspaceLayout.vue'), 'utf8')

  assert.equal(source.includes('fetchModels'), false)
  assert.equal(source.includes('isAuthenticated'), false)
  assert.equal(source.includes('storeToRefs'), false)
})

test('ChatPanel hides and bypasses skill and knowledge controls for non-members', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/chat/ChatPanel.vue'), 'utf8')

  assert.equal(source.includes('isCloudLoggedIn'), true)
  assert.equal(source.includes('const isMember = computed'), true)
  assert.equal(source.includes('pendingInvoke'), false)
  assert.equal(source.includes('function handleConfirmChain'), false)
  assert.equal(source.includes('routeMessage('), false)
  assert.equal(source.includes('<SkillPickerBar v-if="isMember"'), true)
  assert.equal(source.includes('<VaultPickerBar v-if="isMember"'), true)
  assert.equal(source.includes('agentId: isMember.value ?'), true)
  assert.equal(source.includes('vaultId: isMember.value ?'), true)
  assert.equal(source.includes('if (mediaType && isMember.value)'), true)
  assert.equal(source.includes('resolveTextModelSelection(agentStore.currentModel'), true)
  assert.equal(source.includes('modelId: chatModelId'), true)
  assert.equal(source.includes('const memberAttachedFiles = isMember.value ? attachedFiles : []'), true)
  assert.equal(source.includes('if (!isMember.value) return'), true)
  assert.equal(source.includes('<FileUploader v-if="isMember" ref="fileUploader"'), true)
  assert.equal(source.includes('@paste="isMember && fileUploader?.handlePaste($event)"'), true)
})

test('ChatPanel keeps structured media workflows in creation panels instead of inline chat submission', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/chat/ChatPanel.vue'), 'utf8')

  assert.equal(source.includes('function requiresCreationPanelMediaModel'), true)
  assert.equal(source.includes('requiresCreationPanelMediaModel(currentModelId)'), true)
  assert.equal(source.includes('创作面板或画布'), true)
  assert.equal(source.includes('structuredMediaMsgId'), true)
})

test('ChatPanel catches inline media task failures and keeps the conversation readable', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/chat/ChatPanel.vue'), 'utf8')

  assert.equal(source.includes('mediaTaskErrorMsgId'), true)
  assert.equal(source.includes('mediaTaskStore.submitTask'), true)
  assert.equal(source.includes('媒体任务提交失败'), true)
  assert.equal(source.includes('catch (error)'), true)
})

test('useChat treats tools, skills and knowledge as member-only while preserving plain chat', () => {
  const source = readFileSync(join(process.cwd(), 'src/composables/useChat.ts'), 'utf8')

  assert.equal(source.includes('isCloudLoggedIn'), true)
  assert.equal(source.includes('const gatewayStore = isCloudLoggedIn()'), true)
  assert.equal(source.includes('const isMemberAccount = isCloudLoggedIn()'), true)
  assert.equal(source.includes('const allowLocalModel = isMemberAccount'), true)
  assert.equal(source.includes('const requestedLocalMlx = allowLocalModel &&'), true)
  assert.equal(source.includes('const requestedLocalOllama = allowLocalModel &&'), true)
  assert.equal(source.includes('canExecuteToolCall(call.function.name'), true)
  assert.equal(source.includes('effectiveLocalToolsEnabled'), true)
  assert.equal(source.includes('allowAnonymous: !isCloudLoggedIn() && !options.agentId && !options.vaultId && !hasAttachments'), true)
  assert.equal(source.includes('options.agentId || options.vaultId || effectiveLocalToolsEnabled'), true)
  assert.equal(source.includes('getCloudRequiredMessage(options.agentId ? \'skill\''), true)
  assert.equal(source.includes('hasAttachments && !isCloudLoggedIn()'), true)
  assert.equal(source.includes('getCloudRequiredMessage(\'files\')'), true)
})

test('FileTreePanel protects member-only mutation handlers at function boundaries', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/filetree/FileTreePanel.vue'), 'utf8')

  assert.equal(source.includes('function requireMemberAction'), true)
  for (const name of [
    'deleteSelected',
    'handleUpload',
    'triggerVaultImport',
    'handleVaultImportFile',
    'createNewCanvas',
    'createNewDoc',
    'pasteFromClipboard',
    'exportAllTexts',
    'mergeSelected',
    'handleSkillUpload',
    'runVaultHealthCheckMenu',
    'exportVaultMenu',
    'organizeKnowledgeMenu',
    'sendToChat',
  ]) {
    const index = source.indexOf(`function ${name}`) >= 0
      ? source.indexOf(`function ${name}`)
      : source.indexOf(`async function ${name}`)
    assert.ok(index >= 0, `${name} exists`)
    assert.ok(source.slice(index, index + 260).includes('requireMemberAction()'), `${name} has member guard`)
  }
})

test('member-only panels protect their own action handlers', () => {
  const panels = [
    {
      path: 'src/components/brain/BrainPanel.vue',
      names: [
        'addTextMaterial',
        'handleFileUpload',
        'buildKnowledgeGraph',
        'runOrganizeAndCompile',
        'runCompile',
        'runFeedback',
        'applySelected',
        'queryGraph',
        'injectGraphToChat',
      ],
    },
    {
      path: 'src/components/agents/SkillCreatorChat.vue',
      names: [
        'sendMessage',
        'saveSkill',
        'stopStreaming',
        'onKeydown',
      ],
    },
    {
      path: 'src/components/tools/ToolWarehousePanel.vue',
      names: [
        'chooseDevProject',
        'clearDevProject',
        'toggleLocalTools',
        'runTool',
      ],
    },
  ]

  for (const panel of panels) {
    const source = readFileSync(join(process.cwd(), panel.path), 'utf8')
    assert.equal(source.includes('isMember?: boolean'), true, `${panel.path} accepts member prop`)
    assert.equal(source.includes('function requireMemberAction'), true, `${panel.path} defines member guard`)
    for (const name of panel.names) {
      const index = source.indexOf(`function ${name}`) >= 0
        ? source.indexOf(`function ${name}`)
        : source.indexOf(`async function ${name}`)
      assert.ok(index >= 0, `${name} exists in ${panel.path}`)
      assert.ok(source.slice(index, index + 280).includes('requireMemberAction()'), `${name} has member guard`)
    }
  }
})

test('knowledge UI does not surface frontend performance-tier guidance', () => {
  const sources = [
    'src/components/chat/VaultPickerBar.vue',
    'src/components/vault/VaultWizard.vue',
  ].map(path => readFileSync(join(process.cwd(), path), 'utf8')).join('\n')

  for (const forbidden of [
    'inferModelTier',
    'showModelWarning',
    '模型 tier',
    '当前模型较轻量',
    '强力模型',
    'Claude Opus',
    'GPT-5.4/5.5',
  ]) {
    assert.equal(sources.includes(forbidden), false, `knowledge UI contains ${forbidden}`)
  }
})
