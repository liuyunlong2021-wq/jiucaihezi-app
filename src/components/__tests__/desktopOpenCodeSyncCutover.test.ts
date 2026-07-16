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

test('Desktop send path delegates to the OpenCode sync store', () => {
  assert.match(useChat, /openCodeSyncStore\.submitPrompt\(/)
  assert.match(useChat, /openCodeSyncStore\.ensureConnected\(/)
})

test('creative mode has separate session routing and never enters the OpenCode send path', () => {
  assert.match(chatPanel, /useChatModeStore/)
  assert.match(chatPanel, /useCreativeSessionStore/)
  assert.match(chatPanel, /selectAgentMode\('creative'\)/)
  const send = chatPanel.slice(chatPanel.indexOf('async function handleSend()'), chatPanel.indexOf('// ─── P0-1: 原地编辑 user 消息'))
  const creativeGuard = send.indexOf('if (isCreativeMode.value)')
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
  assert.match(chatPanel, /const isPendingActiveCreativeSession = sessionId === pendingCreativeSessionId[\s\S]*messages\.value === pendingCreativeMessages/)
  assert.match(chatPanel, /if \(!creative \|\| isPendingActiveCreativeSession\) return/)
  const send = chatPanel.slice(chatPanel.indexOf('if (isCreativeMode.value && !isMediaModel'), chatPanel.indexOf('// ─── 媒体模型拦截'))
  assert.match(send, /const creativeSessionId = currentSessionId/)
  assert.match(send, /const creativeRunId = \+\+nextCreativeRunId/)
  assert.match(send, /const creativeMessages = messages\.value/)
  assert.match(send, /pendingCreativeSessionId = creativeSessionId/)
  assert.match(send, /pendingCreativeRunId = creativeRunId/)
  assert.match(send, /await creativeSessionStore\.saveSession\(creativeSessionId, creativeMessages\)/)
  assert.match(send, /messages:\s*creativeMessages/)
  assert.match(send, /memory:\s*\{[\s\S]*sessionId:\s*creativeSessionId[\s\S]*turnId:\s*userMessage\.id/)
  assert.match(send, /createDesktopCreativeMemoryFiles\(selectedProjectDir\.value\)/)
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

test('App does not connect OpenCode while the selected mode is creative', () => {
  const lifecycle = app.slice(
    app.indexOf('async function switchOpenCodeProject'),
    app.indexOf('function queueOpenCodeProjectSwitch'),
  )
  const creativeGuard = lifecycle.indexOf("chatModeStore.mode === 'creative'")
  const connect = lifecycle.indexOf('await openCodeSyncStore.ensureConnected')
  assert.ok(creativeGuard >= 0 && creativeGuard < connect)
})

test('creative mode loads Gateway models without starting OpenCode', () => {
  assert.match(chatPanel, /agentStore\.fetchModels\(\{ shouldSkipOpenCode: \(\) => isCreativeMode\.value \}\)/)
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
  const projection = desktopSend.indexOf('const projectedConfig = await projectStoredNewApiForOpenCode')
  const connect = desktopSend.indexOf('const handle = await openCodeSyncStore.ensureConnected')
  assert.ok(projection >= 0 && projection < connect)
  assert.match(desktopSend.slice(projection, connect), /if \(isCreativeDesktopMode\(\)\) \{[\s\S]*return/)
})

test('entering creative mode clears shared OpenCode history before creative-session hydration', () => {
  const transition = chatPanel.slice(chatPanel.indexOf('watch(isCreativeMode'), chatPanel.indexOf("watch(() => sessionStore.activeSessionId"))
  assert.match(chatPanel, /function beginCreativeSessionHydration\(\) \{[\s\S]*currentSessionId = ''[\s\S]*sessionHydrating\.value = true[\s\S]*loadMessages\(\[], \{ agentId: '', skillContent: '' \}\)/)
  assert.match(transition, /if \(!creative\) return[\s\S]*beginCreativeSessionHydration\(\)/)
  assert.match(transition, /\{ flush: 'sync' \}/)
  assert.match(chatPanel, /watch\(\(\) => creativeSessionStore\.currentProjectId, \(\) => \{[\s\S]*if \(isCreativeMode\.value\) beginCreativeSessionHydration\(\)[\s\S]*\}, \{ flush: 'sync' \}\)/)
})

test('creative startup refreshes only the two product Skill sources, never the OpenCode catalog', () => {
  const mounted = chatPanel.slice(chatPanel.lastIndexOf('onMounted(async () => {'), chatPanel.indexOf('// ─── 拖拽上传'))
  assert.match(mounted, /if \(isTauriRuntime\(\) && !isCreativeMode\.value\) \{[\s\S]*refreshOpenCodeSkills\(\)[\s\S]*refreshOpenCodeCommands\(\)/)

  const skills = chatPanel.slice(chatPanel.indexOf('async function refreshOpenCodeSkills'), chatPanel.indexOf('async function refreshOpenCodeCommands'))
  const commands = chatPanel.slice(chatPanel.indexOf('async function refreshOpenCodeCommands'), chatPanel.indexOf('function currentOpenCodeCommandOptions'))
  assert.match(skills, /await refreshProductSkillCatalog\(\)/)
  assert.match(skills, /if \(isCreativeMode\.value\) \{[\s\S]*return/)
  assert.doesNotMatch(skills, /listOpenCodeSkills/)
  assert.match(chatPanel, /mergeCreativeSkillCatalog\(skillsManageStore\.centralSkills, builtInSkills\.value\)/)
  assert.match(commands, /if \(isCreativeMode\.value\) return/)
  const commandsBeforeConnect = commands.slice(commands.indexOf('const projectedConfig = await'), commands.indexOf('const handle = await ensureOpenCodeServer'))
  assert.match(commandsBeforeConnect, /if \(isCreativeMode\.value\) return/)
})

test('creative message actions and composer commands do not fall through to OpenCode', () => {
  const actionSlices = [
    ['continueAssistantMessage', 'sendMessage'],
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
  assert.match(retry, /if \(isCreativeMode\.value\) \{[\s\S]*return/)

  const slash = chatPanel.slice(chatPanel.indexOf('function handleSlashSelect'), chatPanel.lastIndexOf('onMounted(async () => {'))
  assert.match(slash, /cmd\.id === 'clear'[\s\S]*isCreativeMode\.value[\s\S]*startNewCreativeSession/)
  assert.match(slash, /cmd\.id === 'new-session'[\s\S]*isCreativeMode\.value[\s\S]*startNewCreativeSession/)
})

test('creative mode hides stale OpenCode docks and prevents Review from fetching OpenCode VCS data', () => {
  assert.match(chatPanel, /v-if="!isCreativeMode && turnDiffs\.length > 0"/)
  assert.match(chatPanel, /<PermissionDock v-if="!isWebRuntime && !isCreativeMode"/)
  assert.match(chatPanel, /<QuestionDock v-if="!isWebRuntime && !isCreativeMode"/)
  assert.match(chatPanel, /<TodoDock v-if="!isWebRuntime && !isCreativeMode"/)
  assert.match(chatPanel, /<RevertDock\s+v-if="!isWebRuntime && !isCreativeMode"/)
  assert.match(chatPanel, /<FollowupDock\s+v-if="!isWebRuntime && !isCreativeMode"/)
  assert.match(chatPanel, /function scrollToDiffReview\(\) \{\s*if \(isCreativeMode\.value\) return/)
  assert.match(reviewPanel, /useChatModeStore/)
  assert.match(reviewPanel, /if \(chatModeStore\.mode === 'creative'\) return[\s\S]*fetchVcsInfo\(\)/)
})

test('ChatPanel opens official sessions directly and does not link local ids', () => {
  assert.match(chatPanel, /openCodeSyncStore\.openSession\(/)
  assert.doesNotMatch(chatPanel, /sessionStore\.linkOpenCodeSession\(/)
  assert.doesNotMatch(chatPanel, /sessionStore\.saveSessionPreview\(/)
})

test('Desktop history projects OpenCode sessions instead of local IndexedDB ids', () => {
  assert.match(sessionStore, /isTauriRuntime\(\)[\s\S]*openCodeSyncStore\.sessionsForDirectory/)
  assert.match(sessionStore, /if \(isTauriRuntime\(\)\)[\s\S]*openCodeSyncStore\.newDraft\(\)/)
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

test('Desktop send lets the Sync Store exclusively own connection and session routing', () => {
  const desktopSend = useChat.slice(
    useChat.indexOf('if (isTauriRuntime()) {', useChat.indexOf('async function sendMessage')),
    useChat.indexOf('function stopStream()'),
  )
  assert.match(desktopSend, /openCodeSyncStore\.ensureConnected\(/)
  assert.match(desktopSend, /openCodeSyncStore\.updateSessionPermission\(/)
  assert.match(desktopSend, /openCodeSyncStore\.submitPrompt\(/)
  assert.doesNotMatch(desktopSend, /ensureOpenCodeServer|createJiucaiOpenCodeClient|openCodeSyncStore\.connect|registerClient|setActiveDirectory|setActiveSession|updateOpenCodeSessionPermission/)
  assert.match(desktopSend, /buildFixedSkillSystemInstruction\(openCodeSkillName\)/)
  assert.match(desktopSend, /toOpenCodeModelProjection/)
})

test('Desktop projection clears stale messages while retaining only pending submissions', () => {
  const projection = useChat.slice(
    useChat.indexOf('() => [openCodeSyncStore.activeSessionId'),
    useChat.indexOf('watch(() => openCodeSyncStore.activePermissions'),
  )
  assert.match(projection, /pendingDesktopMessages\.value = pendingDesktopMessages\.value\.filter/)
  assert.match(projection, /\.\.\.\(sessionID \? projected\.map/)
  assert.match(projection, /\.\.\.pendingDesktopMessages\.value/)
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
  const handleSend = chatPanel.slice(chatPanel.indexOf('async function handleSend()'), chatPanel.indexOf('// Web 端首次发消息时创建本地 session'))
  const pendingGuard = handleSend.indexOf('if (pendingMediaType && isMember.value && mediaSubmitPending) return')
  for (const mutation of ["editor.textContent = ''", 'replyTarget.value = null', 'referenceFiles.value = []', 'fileUploader.value?.clearAll()']) {
    assert.ok(pendingGuard >= 0 && pendingGuard < handleSend.indexOf(mutation), `${mutation} must follow pending guard`)
  }
  assert.match(mediaSend, /if \(mediaSubmitPending\) return[\s\S]*mediaSubmitPending = true[\s\S]*finally \{\s*mediaSubmitPending = false\s*\}/)
  assert.match(mediaSend, /openCodeSyncStore\.ensureSessionWithOwnership\(/)
  assert.match(mediaSend, /mediaSessionId = sessionResult\.sessionID[\s\S]*mediaCleanupToken = sessionResult\.cleanupToken/)
  assert.doesNotMatch(mediaSend, /mediaSessionCreated = !\(openCodeSyncStore\.activeDirectory/)
  const failed = mediaSend.slice(mediaSend.indexOf('} catch (error) {'))
  assert.match(failed, /if \(mediaSessionId && mediaCleanupToken\)[\s\S]*openCodeSyncStore\.cleanupCreatedSessionIfExclusive\(mediaSessionId, mediaCleanupToken\)[\s\S]*if \(cleaned\)[\s\S]*sessionStore\.switchSession\(''\)/)
  assert.doesNotMatch(failed, /openCodeSyncStore\.deleteSession\(mediaSessionId\)/)
  assert.match(failed, /setLocalCommandNotice\(`媒体任务提交失败/)
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
