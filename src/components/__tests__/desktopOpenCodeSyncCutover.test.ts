import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = process.cwd()
const chatPanel = readFileSync(join(root, 'src/components/chat/ChatPanel.vue'), 'utf8')
const app = readFileSync(join(root, 'src/App.vue'), 'utf8')
const sessionStore = readFileSync(join(root, 'src/stores/sessionStore.ts'), 'utf8')
const useChat = readFileSync(join(root, 'src/composables/useChat.ts'), 'utf8')
const fileTree = readFileSync(join(root, 'src/components/filetree/FileTreePanel.vue'), 'utf8')
const agentStore = readFileSync(join(root, 'src/stores/agentStore.ts'), 'utf8')
const reviewPanel = readFileSync(join(root, 'src/components/chat/ReviewPanel.vue'), 'utf8')
const providerProjection = readFileSync(join(root, 'src/opencodeClient/providerProjection.ts'), 'utf8')

test('Desktop send path delegates to the OpenCode sync store', () => {
  assert.match(useChat, /openCodeSyncStore\.submitPrompt\(/)
  assert.match(useChat, /openCodeSyncStore\.waitForReady\(/)
})

test('Desktop @ data sources initialize their setup dependencies first', () => {
  assert.ok(
    chatPanel.indexOf('const isCreativeMode') < chatPanel.indexOf('const agentList'),
    'agentList must not read isCreativeMode during its temporal dead zone',
  )
  assert.ok(
    chatPanel.indexOf('const selectedProjectDir') < chatPanel.indexOf('const recentFiles'),
    'recentFiles must not read selectedProjectDir during its temporal dead zone',
  )
  assert.ok(
    chatPanel.indexOf('const projectFiles') < chatPanel.indexOf('const atItems'),
    'atItems must not read projectFiles during its temporal dead zone',
  )
})

test('Desktop @ results stay filterable by their display label after project search', () => {
  const mentionList = chatPanel.slice(
    chatPanel.indexOf('} = useFilteredList<AtOption>({'),
    chatPanel.indexOf('// ─── / useFilteredList'),
  )
  assert.match(mentionList, /filterKeys:\s*\['display'\]/)
})

test('Desktop prompt hot path does not initialize the OpenCode runtime', () => {
  const desktopSend = useChat.slice(
    useChat.indexOf('if (isTauriRuntime()) {', useChat.indexOf('async function sendMessage')),
    useChat.indexOf('function stopStream()'),
  )

  assert.doesNotMatch(desktopSend, /projectStoredNewApiForOpenCode|ensureConnected|openSession|bootstrapDirectory|updateSessionPermission/)
  assert.match(desktopSend, /openCodeSyncStore\.waitForReady\(/)
  assert.match(desktopSend, /openCodeSyncStore\.ensureSession\(/)
  assert.match(desktopSend, /openCodeSyncStore\.submitPrompt\(/)
})

test('dao mode bypasses OpenCode and uses the empty-tool direct path', () => {
  const modeProjection = chatPanel.slice(
    chatPanel.indexOf('const currentDesktopOpenCodeAgent'),
    chatPanel.indexOf('function selectAgentMode'),
  )
  assert.match(modeProjection, /computed<'build' \| 'plan' \| undefined>/)
  assert.match(modeProjection, /mode === 'build' \|\| mode === 'plan'/)
  assert.match(chatPanel, /selectAgentMode\('dao'\)/)
  assert.match(chatPanel, /<span>道<\/span>/)
  assert.match(chatPanel, /chatMode: agentMode\.value/)
  assert.match(useChat, /const isDaoDirectMode = options\.chatMode === 'dao'/)
  const daoBranch = useChat.slice(
    useChat.indexOf("const isDaoDirectMode = options.chatMode === 'dao'"),
    useChat.indexOf('if (isTauriRuntime()) {', useChat.indexOf("const isDaoDirectMode = options.chatMode === 'dao'")),
  )
  assert.match(daoBranch, /if \(!isTauriRuntime\(\) \|\| isDaoDirectMode\) \{[\s\S]*sendWebCloudMessage\(/)
  assert.doesNotMatch(daoBranch, /openCodeSyncStore/)
  assert.doesNotMatch(providerProjection, /DAO_AGENT_PROMPT|\bdao:\s*\{/)
})

test('dao mode never starts OpenCode catalog or session hydration work', () => {
  const commands = chatPanel.slice(
    chatPanel.indexOf('async function refreshOpenCodeCommands'),
    chatPanel.indexOf('function currentOpenCodeCommandOptions'),
  )
  assert.match(commands, /if \(isCreativeMode\.value \|\| isDaoMode\.value\) return/)
  assert.match(chatPanel, /isTauriRuntime\(\) && !isCreativeMode\.value && !isDaoMode\.value/)
  assert.match(chatPanel, /if \(session\?\.openCodeSessionId && !isDaoMode\.value\)/)
})

test('creative mode has separate session routing and never enters the OpenCode send path', () => {
  assert.match(chatPanel, /useChatModeStore/)
  assert.match(chatPanel, /useCreativeSessionStore/)
  assert.match(chatPanel, /selectAgentMode\('creative'\)/)
  const send = chatPanel.slice(
    chatPanel.indexOf('async function handleSend('),
    chatPanel.indexOf('// ─── P0-1: 原地编辑 user 消息'),
  )
  const creativeGuard = send.indexOf('if (isCreativeMode.value && !isMediaModel')
  assert.ok(creativeGuard >= 0 && creativeGuard < send.indexOf('sendMessage('))
  assert.doesNotMatch(chatPanel, /chatMode: isTauriRuntime\(\) \? agentMode\.value : undefined/)
  assert.match(fileTree, /useCreativeSessionStore/)
  assert.match(fileTree, /isCreativeMode/)
})

test('creative send pins its local message array while the active-session watcher hydrates history', () => {
  assert.match(chatPanel, /let pendingCreativeSessionId = ''/)
  assert.match(chatPanel, /let pendingCreativeMessages: ChatMessage\[\] \| null = null/)
  assert.match(chatPanel, /let pendingCreativeRunId = 0/)
  assert.match(chatPanel, /let nextCreativeRunId = 0/)
  assert.match(
    chatPanel,
    /const isPendingActiveCreativeSession =\s+sessionId === pendingCreativeSessionId[\s\S]*messages\.value === pendingCreativeMessages/,
  )
  assert.match(chatPanel, /if \(!creative \|\| isPendingActiveCreativeSession\) return/)
  const send = chatPanel.slice(chatPanel.indexOf('if (isCreativeMode.value && !isMediaModel'), chatPanel.indexOf('// ─── 媒体模型拦截'))
  assert.match(send, /const creativeSessionId = currentSessionId/)
  assert.match(send, /const creativeRunId = \+\+nextCreativeRunId/)
  assert.match(send, /const creativeMessages = messages\.value/)
  assert.match(send, /pendingCreativeSessionId = creativeSessionId/)
  assert.match(send, /pendingCreativeRunId = creativeRunId/)
  assert.match(send, /await creativeSessionStore\.saveSession\(creativeSessionId, creativeMessages\)/)
  assert.match(send, /messages:\s*creativeMessages/)
  assert.match(send, /projectMemoryFiles:\s*createDesktopProjectTextFiles\(selectedProjectDir\.value\)/)
  assert.doesNotMatch(send, /memory:|createDesktopCreativeMemoryFiles|\.raw\/sessions|jcses_/)
  assert.doesNotMatch(send, /buildCreativeHandsPrompt|JC-手脚/)
  assert.match(send, /creativeMessages\.push\(\{[\s\S]*role: 'tool'/)
  assert.match(send, /finally \{[\s\S]*await creativeSessionStore\.saveSession\(creativeSessionId, creativeMessages\)[\s\S]*pendingCreativeRunId === creativeRunId/)
  assert.match(send, /creativeSessionStore\.activeSessionId === creativeSessionId[\s\S]*messages\.value !== creativeMessages[\s\S]*loadMessages\(creativeMessages/)
})

test('creative send persists a reactive visible pair before activating a fresh session', () => {
  const send = chatPanel.slice(chatPanel.indexOf('if (isCreativeMode.value && !isMediaModel'), chatPanel.indexOf('// ─── 媒体模型拦截'))
  const createId = send.indexOf('creativeSessionStore.createPendingSession()')
  const appendPair = send.indexOf('creativeMessages.push(userMessage, assistantMessage)')
  const initialSave = send.indexOf('await creativeSessionStore.saveSession(creativeSessionId, creativeMessages)')
  const activate = send.indexOf('creativeSessionStore.switchSession(creativeSessionId)')

  assert.ok(createId >= 0 && createId < appendPair && appendPair < initialSave && initialSave < activate)
  assert.match(send, /const reactiveAssistantMessage = creativeMessages\[creativeMessages\.length - 1\]!/)
  assert.doesNotMatch(send, /const reactiveAssistantMessage = assistantMessage/)
})

test('creative new conversation never invokes an OpenCode session action', () => {
  const startNew = chatPanel.slice(chatPanel.indexOf('function startNew()'), chatPanel.indexOf('// 切换模型'))
  assert.match(startNew, /if \(isCreativeMode\.value\) \{[\s\S]*void startNewCreativeSession\(\)[\s\S]*return/)

  const sessionAction = chatPanel.slice(
    chatPanel.indexOf('async function runSessionAction'),
    chatPanel.indexOf('function openSlashCommandPalette'),
  )
  const creativeGuard = sessionAction.indexOf('if (isCreativeMode.value)')
  const openCodeAction = sessionAction.indexOf('runOpenCodeSessionAction')
  assert.ok(creativeGuard >= 0 && creativeGuard < openCodeAction)
  assert.match(sessionAction.slice(creativeGuard, openCodeAction), /await startNewCreativeSession\(\)[\s\S]*return/)
  assert.doesNotMatch(sessionAction.slice(creativeGuard, openCodeAction), /clearMessages\(/)
})

test('App does not connect OpenCode while the selected mode is creative or dao', () => {
  const lifecycle = app.slice(
    app.indexOf('async function switchOpenCodeProject'),
    app.indexOf('function queueOpenCodeProjectSwitch'),
  )
  const creativeGuard = lifecycle.indexOf("chatModeStore.mode === 'creative' || chatModeStore.mode === 'dao'")
  const connect = lifecycle.indexOf('await openCodeSyncStore.ensureConnected')
  assert.ok(creativeGuard >= 0 && creativeGuard < connect)
})

test('creative and dao modes load Gateway models without starting OpenCode', () => {
  assert.match(chatPanel, /agentStore\.fetchModels\(\{ shouldSkipOpenCode: \(\) => isCreativeMode\.value \|\| isDaoMode\.value \}\)/)
  assert.match(agentStore, /async function fetchModels\(options: \{ skipOpenCode\?: boolean; shouldSkipOpenCode\?: \(\) => boolean \} = \{\}\)/)
  assert.match(agentStore, /const shouldSkipOpenCode = \(\) => Boolean\(options\.skipOpenCode \|\| options\.shouldSkipOpenCode\?\.\(\)\)/)
  const modelFetch = agentStore.slice(agentStore.indexOf('async function fetchModels'), agentStore.indexOf('const initialResolvedModel'))
  const gatewayFetch = modelFetch.indexOf('gatewayCatalog = await gatewayWithRetry()')
  const ensure = modelFetch.indexOf('ensureOpenCodeServer')
  assert.ok(gatewayFetch >= 0 && gatewayFetch < ensure)
  assert.match(modelFetch.slice(gatewayFetch, ensure), /if \(!shouldSkipOpenCode\(\)\) \{[\s\S]*projectStoredNewApiForOpenCode/)
})

test('shared OpenCode command setup rechecks creative mode after config projection', () => {
  const commandSetup = useChat.slice(useChat.indexOf('async function ensureOpenCodeCommandSession'), useChat.indexOf('async function syncAfterCommand'))
  assert.match(commandSetup, /if \(isTauriRuntime\(\) && chatModeStore\.mode === 'creative'\) throw new Error\('创模式不使用本机会话内核'\)/)
  const projection = commandSetup.indexOf('const projectedConfig = await projectStoredNewApiForOpenCode')
  const ensure = commandSetup.indexOf('const handle = await ensureOpenCodeServer')
  assert.ok(projection >= 0 && projection < ensure)
  assert.match(commandSetup.slice(projection, ensure), /if \(isTauriRuntime\(\) && chatModeStore\.mode === 'creative'\) throw new Error\('创模式不使用本机会话内核'\)/)
})

test('shared Desktop send abandons an OpenCode request when the mode becomes creative', () => {
  assert.match(useChat, /const isCreativeDesktopMode = \(\) => isTauriRuntime\(\) && chatModeStore\.mode === 'creative'/)
  const desktopSend = useChat.slice(
    useChat.indexOf('if (isTauriRuntime()) {', useChat.indexOf('async function sendMessage')),
    useChat.indexOf('function stopStream()'),
  )
  const guard = desktopSend.indexOf('if (isCreativeDesktopMode())')
  const ready = desktopSend.indexOf('await openCodeSyncStore.waitForReady')
  assert.ok(guard >= 0 && guard < ready)
  assert.doesNotMatch(desktopSend, /projectStoredNewApiForOpenCode|ensureConnected/)
})

test('entering creative mode clears shared OpenCode history before creative-session hydration', () => {
  const transition = chatPanel.slice(
    chatPanel.indexOf('watch(\n  isCreativeMode'),
    chatPanel.indexOf('// 切换对话时加载历史消息'),
  )
  assert.match(chatPanel, /function beginCreativeSessionHydration\(\) \{[\s\S]*currentSessionId = ''[\s\S]*sessionHydrating\.value = true[\s\S]*loadMessages\(\[], \{ agentId: '', skillContent: '' \}\)/)
  assert.match(transition, /if \(!creative\) return[\s\S]*beginCreativeSessionHydration\(\)/)
  assert.match(transition, /\{ flush: 'sync' \}/)
  assert.match(
    chatPanel,
    /watch\(\s+\(\) => creativeSessionStore\.currentProjectId,\s+\(\) => \{[\s\S]*if \(isCreativeMode\.value\) beginCreativeSessionHydration\(\)[\s\S]*\},\s+\{ flush: 'sync' \},?\s+\)/,
  )
})

test('creative and dao startup do not refresh the OpenCode catalog', () => {
  const mounted = chatPanel.slice(chatPanel.lastIndexOf('onMounted(async () => {'), chatPanel.indexOf('// ─── 拖拽上传'))
  assert.match(mounted, /if \(isTauriRuntime\(\) && !isCreativeMode\.value && !isDaoMode\.value\) \{[\s\S]*refreshOpenCodeSkills\(\)[\s\S]*refreshOpenCodeCommands\(\)/)

  const skills = chatPanel.slice(chatPanel.indexOf('async function refreshOpenCodeSkills'), chatPanel.indexOf('async function refreshOpenCodeCommands'))
  const commands = chatPanel.slice(chatPanel.indexOf('async function refreshOpenCodeCommands'), chatPanel.indexOf('function currentOpenCodeCommandOptions'))
  assert.match(skills, /await refreshProductSkillCatalog\(\)/)
  assert.match(skills, /if \(isDaoMode\.value\) \{[\s\S]*return/)
  assert.match(skills, /if \(isCreativeMode\.value\) \{[\s\S]*return/)
  assert.doesNotMatch(skills, /listOpenCodeSkills/)
  assert.match(chatPanel, /mergeCreativeSkillCatalog\(skillsManageStore\.centralSkills, builtInSkills\.value\)/)
  assert.match(commands, /if \(isCreativeMode\.value \|\| isDaoMode\.value\) return/)
  const commandsBeforeConnect = commands.slice(commands.indexOf('const projectedConfig = await'), commands.indexOf('const handle = await ensureOpenCodeServer'))
  assert.match(commandsBeforeConnect, /if \(isCreativeMode\.value \|\| isDaoMode\.value\) return/)
})

test('creative message actions and composer commands do not fall through to OpenCode', () => {
  const actionSlices = [
    ['regenerateAssistantMessage', 'sendMessage'],
    ['forkMessage', 'openCodeSyncStore.newDraft'],
    ['submitShellCommand', 'runShellCommand'],
  ] as const
  for (const [name, openCodeCall] of actionSlices) {
    const start = chatPanel.indexOf(`async function ${name}`)
    const end = chatPanel.indexOf('\n}\n', start) + 2
    const action = chatPanel.slice(start, end)
    const creativeGuard = action.indexOf('if (isCreativeMode.value)')
    const openCode = action.indexOf(openCodeCall)
    assert.ok(creativeGuard >= 0 && creativeGuard < openCode, `${name} must return before ${openCodeCall}`)
    assert.match(action.slice(creativeGuard, openCode), /return/)
  }

  const retry = chatPanel.slice(chatPanel.indexOf('async function retryMessage'), chatPanel.indexOf('async function invalidateConversationMessages'))
  assert.match(retry, /if \(isCreativeMode\.value\) \{[\s\S]*await handleSend\(\{[\s\S]*images: msg\.images,[\s\S]*files: msg\.files,/)
  assert.doesNotMatch(retry, /创模式请在输入框中重新发送该需求/)

  const slash = chatPanel.slice(chatPanel.indexOf('function handleSlashSelect'), chatPanel.lastIndexOf('onMounted(async () => {'))
  assert.match(slash, /cmd\.id === 'clear'[\s\S]*isCreativeMode\.value[\s\S]*startNewCreativeSession/)
  assert.match(slash, /cmd\.id === 'new-session'[\s\S]*isCreativeMode\.value[\s\S]*startNewCreativeSession/)
})

test('creative and dao modes hide stale OpenCode docks and prevent Review from fetching OpenCode VCS data', () => {
  assert.match(chatPanel, /v-if="!isCreativeMode && turnDiffs\.length > 0"/)
  assert.match(chatPanel, /<PermissionDock\s+v-if="!isWebRuntime && !isCreativeMode && !isDaoMode"/)
  assert.match(chatPanel, /<QuestionDock\s+v-if="!isWebRuntime && !isCreativeMode && !isDaoMode"/)
  assert.match(chatPanel, /<TodoDock v-if="!isWebRuntime && !isCreativeMode && !isDaoMode"/)
  assert.match(chatPanel, /<RevertDock\s+v-if="!isWebRuntime && !isCreativeMode && !isDaoMode"/)
  assert.match(chatPanel, /<FollowupDock\s+v-if="!isWebRuntime && !isCreativeMode && !isDaoMode"/)
  assert.match(chatPanel, /function scrollToDiffReview\(\) \{\s*if \(isCreativeMode\.value \|\| isDaoMode\.value\) return/)
  assert.match(reviewPanel, /useChatModeStore/)
  assert.match(reviewPanel, /if \(chatModeStore\.mode === 'creative' \|\| chatModeStore\.mode === 'dao'\) return[\s\S]*fetchVcsInfo\(\)/)
})

test('ChatPanel opens official sessions directly and does not link local ids', () => {
  assert.match(chatPanel, /openCodeSyncStore\.openSession\(/)
  assert.doesNotMatch(chatPanel, /sessionStore\.linkOpenCodeSession\(/)
  assert.doesNotMatch(chatPanel, /sessionStore\.saveSessionPreview\(/)
})

test('Desktop history reserves OpenCode sessions for plan and build, leaving dao local', () => {
  assert.match(sessionStore, /const usesOpenCodeSessions = \(\) => isTauriRuntime\(\) && chatModeStore\.mode !== 'dao'/)
  assert.match(sessionStore, /if \(usesOpenCodeSessions\(\)\)[\s\S]*openCodeSyncStore\.sessionsForDirectory/)
  assert.match(sessionStore, /if \(usesOpenCodeSessions\(\)\)[\s\S]*openCodeSyncStore\.newDraft\(\)/)
})

test('dao mode loads and persists its local transcript without OpenCode metadata', () => {
  assert.match(chatPanel, /const sessionLoadPromise = isTauriRuntime\(\) && chatModeStore\.mode !== 'dao'\s*\? Promise\.resolve\(\)\s*:\s*sessionStore\.loadAllSessions\(\)/)
  const restore = chatPanel.slice(chatPanel.indexOf('async function restoreActiveSession'), chatPanel.indexOf('// ─── P0-4'))
  assert.match(restore, /if \(!isWebRuntime\.value && !isDaoMode\.value\) return/)
  const persist = chatPanel.slice(chatPanel.indexOf('async function persistCurrentSession'), chatPanel.indexOf('async function flushCurrentSessionPersist'))
  assert.match(persist, /openCodeSessionId: isDaoMode\.value \? undefined : getActiveOpenCodeSessionId\(\) \|\| undefined/)
})

test('dao composer does not expose project, agent, or Skill references', () => {
  const slash = chatPanel.slice(chatPanel.indexOf('const slashCommands'), chatPanel.indexOf('// ─── @ 数据源：agent'))
  assert.match(slash, /if \(isDaoMode\.value\) return \[\]/)
  const atItems = chatPanel.slice(chatPanel.indexOf('const atItems'), chatPanel.indexOf('const atKey'))
  assert.match(atItems, /if \(isDaoMode\.value\) return \[\]/)
  const atSelect = chatPanel.slice(chatPanel.indexOf('function handleAtSelect'), chatPanel.indexOf('// ─── \/ 选中'))
  assert.match(atSelect, /if \(isDaoMode\.value\) return/)
  const slashSelect = chatPanel.slice(chatPanel.indexOf('function handleSlashSelect'), chatPanel.indexOf('onMounted(async () => {'))
  assert.match(slashSelect, /if \(isDaoMode\.value\) return/)
})

test('dao send skips project-pill resolution and product send hooks', () => {
  const send = chatPanel.slice(chatPanel.indexOf('async function handleSend('), chatPanel.indexOf('// ─── P0-1: 原地编辑 user 消息'))
  assert.match(send, /if \(!options && !isWebRuntime\.value && !isDaoMode\.value\) \{[\s\S]*resolveOpenCodeComposerParts/)
  assert.match(send, /if \(!options && !isDaoMode\.value && !\(await addPastedProjectMediaReferences\(plainText\)\)\) return/)
  const hook = send.slice(send.indexOf('let finalSendText'), send.indexOf('const sendPromise'))
  assert.match(hook, /if \(!isDaoMode\.value\) \{[\s\S]*triggerChatSendBefore/)
  assert.match(send, /lastAssistantMsg && !isDaoMode\.value[\s\S]*triggerChatReceiveAfter/)
})

test('dao mode keeps a project-independent local transcript and removes process-only UI', () => {
  const enterDao = chatPanel.slice(chatPanel.indexOf('async function enterDaoMode'), chatPanel.indexOf('onBeforeUnmount(() => {'))
  assert.match(enterDao, /sessionStore\.setCurrentProjectDir\(''\)/)
  assert.match(enterDao, /settleCreativeToolApproval\('reject'\)/)
  assert.match(enterDao, /const sessionId = daoSessionId \|\| sessionStore\.startNewSession/)
  const projection = chatPanel.slice(chatPanel.indexOf('function projectDaoTranscript'), chatPanel.indexOf('async function enterDaoMode'))
  assert.match(projection, /!message\.isMediaTask/)
  assert.doesNotMatch(projection, /files: message\.files/)
  const media = chatPanel.slice(chatPanel.indexOf('const desktopMediaMessages'), chatPanel.indexOf('const displayMessages'))
  assert.match(media, /if \(isWebRuntime\.value \|\| isDaoMode\.value\) return \[\]/)
  assert.match(chatPanel, /v-if="pendingCreativeToolApproval && !isDaoMode"/)
  assert.match(app, /if \(chatModeStore\.mode === 'dao'\) sessionStore\.setCurrentProjectDir\(''\)/)
})

test('Desktop dao to creative projects only the visible transcript into a creative session', () => {
  const selectMode = chatPanel.slice(chatPanel.indexOf('function selectAgentMode'), chatPanel.indexOf('const shellCommandText'))
  assert.match(selectMode, /mode === 'creative' && isDaoMode\.value && !isWebRuntime\.value/)
  assert.match(selectMode, /enterCreativeModeFromDao\(messages\.value\)/)
  const transition = chatPanel.slice(chatPanel.indexOf('async function enterCreativeModeFromDao'), chatPanel.indexOf('onBeforeUnmount(() => {'))
  assert.match(transition, /const transcript = projectDaoTranscript\(source\)/)
  assert.match(transition, /creativeSessionStore\.createPendingSession\(\)/)
  assert.match(transition, /await creativeSessionStore\.saveSession\(sessionId, transcript\)/)
  assert.match(transition, /creativeSessionStore\.switchSession\(sessionId\)/)
})

test('Desktop session opening restores the valid OpenCode model and variant', () => {
  const sessionWatcher = chatPanel.slice(
    chatPanel.indexOf('watch(\n  () => sessionStore.activeSessionId'),
    chatPanel.indexOf('// Web 端首次发消息时创建本地 session'),
  )

  assert.match(sessionWatcher, /await openCodeSyncStore\.openSession\(directory, newId\)[\s\S]*restoreOpenCodeSessionModel\(newId\)/)
  assert.match(chatPanel, /function restoreOpenCodeSessionModel\([\s\S]*agentStore\.setModel[\s\S]*setModelVariant/)
})

test('Desktop session selection loads the official session before any local history guard', () => {
  const sessionWatcher = chatPanel.slice(
    chatPanel.indexOf('watch(\n  () => sessionStore.activeSessionId'),
    chatPanel.indexOf('// Web 端首次发消息时创建本地 session'),
  )
  const desktopLoad = sessionWatcher.indexOf('await openCodeSyncStore.openSession(directory, newId)')
  const legacyGuard = sessionWatcher.indexOf('if (newId === currentSessionId) return')

  assert.ok(desktopLoad >= 0)
  assert.ok(legacyGuard > desktopLoad)
  assert.match(sessionWatcher, /requestId !== sessionLoadRequestId \|\| sessionStore\.activeSessionId !== newId/)
})

test('Desktop chat no longer contains the legacy per-run OpenCode event kernel', () => {
  assert.doesNotMatch(useChat, /subscribeOpenCodeEvents/)
  assert.doesNotMatch(useChat, /getOpenCodeSessionStatusWithTimeout/)
  assert.doesNotMatch(useChat, /lastLocalSessionId/)
  assert.doesNotMatch(useChat, /stopOpenCodeServer/)
})

test('ChatPanel restores the submitted text when Desktop prompt submission fails', () => {
  assert.match(chatPanel, /try\s*\{\s*await sendPromise\s*\}\s*catch/)
  assert.match(chatPanel, /setEditorText\(composerRef\.value, finalSendText\)/)
})

test('Desktop permission and question replies use the active Sync Store session', () => {
  assert.match(useChat, /const sessionID = currentOpenCodeSessionID\(\)/)
  assert.match(useChat, /sessionID: request\?\.sessionID \|\| sessionID/)
})

test('Desktop session rename reuses the Sync Store directory client', () => {
  const renameHandler = chatPanel.slice(
    chatPanel.indexOf("onEvent('rename-open-code-session'"),
    chatPanel.indexOf('onBeforeUnmount(offRenameOpenCodeSession)'),
  )
  assert.match(renameHandler, /openCodeSyncStore\.renameSession\(sessionId, title\)/)
  assert.doesNotMatch(renameHandler, /ensureOpenCodeServer/)
  assert.doesNotMatch(renameHandler, /createJiucaiOpenCodeClient/)
})

test('App exclusively owns Desktop project connection and restores the saved session', () => {
  assert.match(app, /await openCodeSyncStore\.abortActiveSession\(\)/)
  assert.match(app, /await openCodeSyncStore\.ensureConnected/)
  assert.match(app, /await openCodeSyncStore\.openSession\(targetDirectory, restoredSessionId\)/)
  assert.doesNotMatch(chatPanel, /watch\(_projectDir/)
  assert.doesNotMatch(chatPanel, /openCodeSyncStore\.bootstrapDirectory/)
  assert.doesNotMatch(chatPanel, /openCodeSyncStore\.connect/)
  assert.doesNotMatch(sessionStore, /openCodeSyncStore\.bootstrapDirectory/)
})

test('project switching keeps abort-connect-restore order and recovers after a failed switch', () => {
  const lifecycle = app.slice(
    app.indexOf('async function switchOpenCodeProject'),
    app.indexOf('onMounted('),
  )
  const abortGuard = lifecycle.indexOf('openCodeSyncStore.activeSessionId')
  const abort = lifecycle.indexOf('await openCodeSyncStore.abortActiveSession()')
  const clear = lifecycle.indexOf('openCodeSyncStore.newDraft()')
  const connect = lifecycle.indexOf('await openCodeSyncStore.ensureConnected')
  const restore = lifecycle.indexOf('await openCodeSyncStore.openSession(targetDirectory, restoredSessionId)')
  assert.ok(abortGuard >= 0 && abortGuard < abort && abort < clear && clear < connect && connect < restore)
  assert.doesNotMatch(lifecycle.slice(abortGuard, abort), /isStreaming/)
  assert.match(lifecycle, /catch \(error\)[\s\S]*openCodeSyncStore\.newDraft\(\)/)
  assert.match(lifecycle, /projectSwitch = projectSwitch\.catch\(\(\) => \{\}\)\.then/)
})

test('Desktop stop always delegates to the active Sync Store client', () => {
  const stop = useChat.slice(useChat.indexOf('function stopStream()'), useChat.indexOf('async function clearMessages'))
  assert.match(stop, /openCodeSyncStore\.abortActiveSession\(\)/)
  assert.doesNotMatch(stop, /lastActiveClient/)
  assert.doesNotMatch(stop, /setActiveOpenCodeSessionId\(''\)/)
})

test('permission cards are removed only by permission.replied projection', () => {
  const respond = useChat.slice(useChat.indexOf('async function respondPermission'), useChat.indexOf('async function replyQuestion'))
  assert.doesNotMatch(respond, /pendingPermissions\.value = removeById/)
  assert.match(useChat, /openCodeSyncStore\.activePermissions/)
})

test('Desktop send lets the Sync Store exclusively own session routing', () => {
  const desktopSend = useChat.slice(
    useChat.indexOf('if (isTauriRuntime()) {', useChat.indexOf('async function sendMessage')),
    useChat.indexOf('function stopStream()'),
  )
  assert.match(desktopSend, /openCodeSyncStore\.waitForReady\(/)
  assert.match(desktopSend, /openCodeSyncStore\.submitPrompt\(/)
  assert.doesNotMatch(desktopSend, /ensureOpenCodeServer|createJiucaiOpenCodeClient|openCodeSyncStore\.connect|registerClient|setActiveDirectory|setActiveSession|updateOpenCodeSessionPermission|projectStoredNewApiForOpenCode|openSession|bootstrapDirectory|updateSessionPermission/)
  assert.match(desktopSend, /buildFixedSkillSystemInstruction\(openCodeSkillName\)/)
  assert.match(desktopSend, /toOpenCodeModelProjection/)
})

test('Desktop Skill permission updates follow Skill and session lifecycle, not prompt submission', () => {
  const skillSelection = chatPanel.slice(
    chatPanel.indexOf('function selectOpenCodeSkill'),
    chatPanel.indexOf('async function refreshOpenCodeSkills'),
  )

  assert.match(skillSelection, /syncOpenCodeSkillPermission\(\)/)
  assert.match(chatPanel, /function syncOpenCodeSkillPermission\([\s\S]*openCodeSyncStore\.updateSessionPermission/)
})

test('Desktop composer sends extracted pills as structured OpenCode context and restores them after a rejected submit', () => {
  const handleSend = chatPanel.slice(
    chatPanel.indexOf('async function handleSend('),
    chatPanel.indexOf('// Web 端首次发消息时创建本地 session'),
  )

  assert.match(handleSend, /const composerPills = options \? \[\] : extractPills\(editor!\)/)
  assert.match(handleSend, /const hasComposerParts = composerPills\.length > 0/)
  assert.match(chatPanel, /openCodeComposerParts,/)
  assert.match(handleSend, /const composerSnapshot = options \? '' : editor!\.innerHTML/)
  assert.match(chatPanel, /composerRef\.value\.innerHTML = composerSnapshot/)
})

test('Desktop timeline uses the local visible message projection in dao mode', () => {
  assert.doesNotMatch(useChat, /pendingDesktopMessages/)
  assert.match(
    chatPanel,
    /const desktopTimelineMessages = computed\(\(\) =>\s*!isWebRuntime\.value && !isCreativeMode\.value && !isDaoMode\.value\s*\? mergeVisibleTimeline\(openCodeSyncStore\.chatMessages, messages\.value\)\s*:\s*messages\.value/,
  )
  assert.match(chatPanel, /:messages="desktopTimelineMessages"/)
})

test('Desktop interactive replies use Store-owned active-directory methods', () => {
  for (const name of ['respondPermission', 'replyQuestion', 'rejectQuestion']) {
    const start = useChat.indexOf(`async function ${name}`)
    const end = useChat.indexOf('\n  }', start)
    const fn = useChat.slice(start, end)
    assert.doesNotMatch(fn, /getActiveOpenCodeClient|activeOpenCodeDirectory/)
  }
  assert.match(useChat, /openCodeSyncStore\.replyPermission\(/)
  assert.match(useChat, /openCodeSyncStore\.replyQuestion\(/)
  assert.match(useChat, /openCodeSyncStore\.rejectQuestion\(/)
})

test('Desktop media tasks stay outside OpenCode text messages and local session persistence', () => {
  const mediaSend = chatPanel.slice(
    chatPanel.indexOf('// ─── 媒体模型拦截'),
    chatPanel.indexOf('// Web 端首次发消息时创建本地 session'),
  )
  assert.match(chatPanel, /mediaTaskStore\.chatTasksFor\(/)
  assert.match(mediaSend, /sessionId: mediaSessionId/)
  assert.match(mediaSend, /directory: mediaDirectory/)
  assert.doesNotMatch(mediaSend, /if \(!currentSessionId\) \{\s*currentSessionId = sessionStore\.startNewSession/)
  assert.match(mediaSend, /if \(isWebRuntime\.value\) \{[\s\S]*content: `\[MEDIA_TASK:\$\{taskId\}\]`/)
})

test('first Desktop media submission creates an official session container before persisting the task', () => {
  const mediaSend = chatPanel.slice(
    chatPanel.indexOf('// ─── 媒体模型拦截'),
    chatPanel.indexOf('// Web 端首次发消息时创建本地 session'),
  )
  const connect = mediaSend.indexOf('await openCodeSyncStore.ensureConnected(')
  const ensureSession = mediaSend.indexOf('await openCodeSyncStore.ensureSessionWithOwnership(')
  const mirrorSession = mediaSend.indexOf('sessionStore.switchSession(mediaSessionId)')
  const submitTask = mediaSend.indexOf('await mediaTaskStore.submitTask({')
  assert.ok(connect >= 0 && connect < ensureSession && ensureSession < mirrorSession && mirrorSession < submitTask)
  assert.match(mediaSend, /title: text/)
  assert.match(mediaSend, /sessionId: mediaSessionId/)
  assert.match(mediaSend, /directory: mediaDirectory/)
})

test('Desktop media submission is guarded and removes only a newly created container on task failure', () => {
  const mediaSend = chatPanel.slice(
    chatPanel.indexOf('// ─── 媒体模型拦截'),
    chatPanel.indexOf('// Web 端首次发消息时创建本地 session'),
  )
  assert.match(chatPanel, /let mediaSubmitPending = false/)
  const handleSend = chatPanel.slice(
    chatPanel.indexOf('async function handleSend('),
    chatPanel.indexOf('// Web 端首次发消息时创建本地 session'),
  )
  const pendingGuard = handleSend.indexOf('if (pendingMediaType && isMember.value && mediaSubmitPending) return')
  for (const mutation of ["editor!.textContent = ''", 'replyTarget.value = null', 'referenceFiles.value = []', 'fileUploader.value?.clearAll()']) {
    assert.ok(pendingGuard >= 0 && pendingGuard < handleSend.indexOf(mutation), `${mutation} must follow pending guard`)
  }
  assert.match(mediaSend, /if \(mediaSubmitPending\) return[\s\S]*mediaSubmitPending = true[\s\S]*finally \{\s*mediaSubmitPending = false\s*\}/)
  assert.match(mediaSend, /openCodeSyncStore\.ensureSessionWithOwnership\(/)
  assert.match(mediaSend, /mediaSessionId = sessionResult\.sessionID[\s\S]*mediaCleanupToken = sessionResult\.cleanupToken/)
  assert.doesNotMatch(mediaSend, /mediaSessionCreated = !\(openCodeSyncStore\.activeDirectory/)
  const failed = mediaSend.slice(mediaSend.indexOf('} catch (error) {'))
  assert.match(
    failed,
    /if \(mediaSessionId && mediaCleanupToken\)[\s\S]*openCodeSyncStore\.cleanupCreatedSessionIfExclusive\(\s+mediaSessionId,\s+mediaCleanupToken,?\s+\)[\s\S]*if \(cleaned\)[\s\S]*sessionStore\.switchSession\(''\)/,
  )
  assert.doesNotMatch(failed, /openCodeSyncStore\.deleteSession\(mediaSessionId\)/)
  assert.match(failed, /setLocalCommandNotice\(\s+`媒体任务提交失败/)
})

test('ChatPanel does not issue a second Desktop session delete after the action succeeds', () => {
  const sessionAction = chatPanel.slice(
    chatPanel.indexOf('async function runSessionAction'),
    chatPanel.indexOf('function openSlashCommandPalette'),
  )
  assert.doesNotMatch(sessionAction, /sessionStore\.deleteSession\(/)
  assert.match(sessionAction, /action === 'delete'[\s\S]*sessionStore\.switchSession\(''\)/)
})

test('App invalidates pending project work on newer intent and unmount', () => {
  assert.match(app, /let projectSwitchGeneration = 0/)
  assert.match(app, /let disposed = false/)
  assert.match(app, /const isCurrent = \(\) => !disposed && generation === projectSwitchGeneration/)
  assert.match(app, /ensureConnected\(\{[\s\S]*isCurrent/)
  assert.match(app, /if \(!isCurrent\(\)\) return/)
  assert.match(app, /projectStore\.projectDir\.value === targetDirectory\s*&& !openCodeSyncStore\.activeSessionId/)
  assert.match(app, /onBeforeUnmount\(\(\) => \{[\s\S]*disposed = true[\s\S]*projectSwitchGeneration\+\+[\s\S]*disconnect\(\)/)
})
