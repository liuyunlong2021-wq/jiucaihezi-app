import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = process.cwd()
const chatPanel = readFileSync(join(root, 'src/components/chat/ChatPanel.vue'), 'utf8')
const app = readFileSync(join(root, 'src/App.vue'), 'utf8')
const sessionStore = readFileSync(join(root, 'src/stores/sessionStore.ts'), 'utf8')
const useChat = readFileSync(join(root, 'src/composables/useChat.ts'), 'utf8')

test('Desktop send path delegates to the OpenCode sync store', () => {
  assert.match(useChat, /openCodeSyncStore\.submitPrompt\(/)
  assert.match(useChat, /openCodeSyncStore\.ensureConnected\(/)
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

test('Desktop projection clears stale messages when the active session is cleared', () => {
  const projection = useChat.slice(
    useChat.indexOf('() => [openCodeSyncStore.activeSessionId'),
    useChat.indexOf('watch(() => openCodeSyncStore.activePermissions'),
  )
  assert.match(projection, /if \(!sessionID\) messages\.value = \[\]/)
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
