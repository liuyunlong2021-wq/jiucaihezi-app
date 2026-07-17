import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const messageBubble = readFileSync('src/components/chat/MessageBubble.vue', 'utf8')
const fileTreePanel = readFileSync('src/components/filetree/FileTreePanel.vue', 'utf8')
const messageReferences = readFileSync('src/components/chat/MessageReferences.vue', 'utf8')
const chatPanel = readFileSync('src/components/chat/ChatPanel.vue', 'utf8')
const messageToolSummary = readFileSync('src/components/chat/MessageToolSummary.vue', 'utf8')
const skillPickerBar = readFileSync('src/components/chat/SkillPickerBar.vue', 'utf8')
const openCodePartList = readFileSync('src/components/chat/OpenCodePartList.vue', 'utf8')
const permissionDock = readFileSync('src/components/chat/PermissionDock.vue', 'utf8')
const questionDock = readFileSync('src/components/chat/QuestionDock.vue', 'utf8')
const todoDock = readFileSync('src/components/chat/TodoDock.vue', 'utf8')
const revertDock = readFileSync('src/components/chat/RevertDock.vue', 'utf8')
const followupDock = readFileSync('src/components/chat/FollowupDock.vue', 'utf8')
const reviewPanel = readFileSync('src/components/chat/ReviewPanel.vue', 'utf8')
const diffReviewSource = readFileSync('src/opencodeClient/diffReview.ts', 'utf8')
const sessionShareNotice = readFileSync('src/components/chat/SessionShareNotice.vue', 'utf8')
const agentStatusBar = readFileSync('src/components/chat/AgentStatusBar.vue', 'utf8')
const chatScrollNav = readFileSync('src/components/chat/ChatScrollNav.vue', 'utf8')
const toolPickerBar = readFileSync('src/components/chat/ToolPickerBar.vue', 'utf8')
const toolWarehousePanel = readFileSync('src/components/tools/ToolWarehousePanel.vue', 'utf8')
const workspaceLayout = readFileSync('src/layouts/WorkspaceLayout.vue', 'utf8')
const editorPanel = readFileSync('src/components/editor/EditorPanel.vue', 'utf8')
const i18nIndex = readFileSync('src/i18n/index.ts', 'utf8')
const useChat = readFileSync('src/composables/useChat.ts', 'utf8')
const chatCloud = readFileSync('src/composables/web/chatCloud.ts', 'utf8')
const creativeChat = readFileSync('src/composables/creativeChat.ts', 'utf8')
const webDirectEngine = readFileSync('src/composables/web/webDirectEngine.ts', 'utf8')
const directMessageBuilder = readFileSync('src/utils/directMessageBuilder.ts', 'utf8')
const agentStoreSource = readFileSync('src/stores/agentStore.ts', 'utf8')
const timelineRows = readFileSync('src/opencodeClient/timelineRows.ts', 'utf8')
const interactiveBridge = readFileSync('src/opencodeClient/interactive.ts', 'utf8')
const openCodeCatalog = readFileSync('src/opencodeClient/catalog.ts', 'utf8')
const toolConnectionAdapter = readFileSync('src/runtime/connection/toolConnectionAdapter.ts', 'utf8')
const markdownDisplayPolicy = readFileSync('src/components/chat/display/markdownDisplayPolicy.ts', 'utf8')
const kbCommandPresets = readFileSync('src/data/kbCommandPresets.ts', 'utf8')
const mainEntry = readFileSync('src/main.ts', 'utf8')
const indexHtml = readFileSync('index.html', 'utf8')
const tauriDefaultCapability = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8'))
const composerCommandSource = chatPanel.slice(
  chatPanel.indexOf('const baseComposerCommands'),
  chatPanel.indexOf('const inputText = ref'),
)

test('brand splash renders pure logo animation without text or spinner on startup', () => {
  assert.match(mainEntry, /__JC_APP_BUILD_ID__/)
  assert.match(mainEntry, /__JC_APP_MOUNTED__\s*=\s*true/)
  assert.match(indexHtml, /jc-boot-screen/)
  assert.match(indexHtml, /jc-boot-in/)
  assert.match(indexHtml, /jc-boot-fade-out/)
  assert.doesNotMatch(indexHtml, /启动超时|加载中|Loading|spinner/)
})

test('chat messages use layout instead of visible user identity chrome', () => {
  assert.match(messageBubble, /v-if="showMeta"/)
  assert.doesNotMatch(messageBubble, /role === 'user' \? '你'/)
  assert.doesNotMatch(messageBubble, /role === 'user' \? 'person'/)
})

test('message action rows stay visible and use hover only for emphasis', () => {
  const actionRowBlock = messageBubble.match(/\.msg-action-row\s*\{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(actionRowBlock, /opacity:\s*\.72;/)
  assert.doesNotMatch(actionRowBlock, /opacity:\s*0;/)
  assert.match(messageBubble, /\.msg:hover\s+\.msg-action-row/)
  assert.match(messageBubble, /\.msg:focus-within\s+\.msg-action-row/)
  const parentActionRowBlock = chatPanel.match(/\.msg-action-row\s*\{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(parentActionRowBlock, /opacity:\s*\.72;/)
  assert.doesNotMatch(parentActionRowBlock, /opacity:\s*0;/)
})

test('streaming indicator is visible while the latest message is from the user', () => {
  assert.match(chatPanel, /isStreaming && \([^\n]*messages\[messages\.length - 1\]\?\.role === 'user'/)
})

test('chat scrollbar keeps a VS Code-sized drag target without replacing native scrolling', () => {
  assert.match(chatPanel, /\.cp-messages\s*\{[\s\S]*scrollbar-gutter:\s*stable;/)
  assert.match(chatPanel, /\.cp-messages::\-webkit-scrollbar\s*\{\s*width:\s*18px;/)
  assert.match(chatPanel, /\.cp-messages::\-webkit-scrollbar-track\s*\{[\s\S]*background:\s*transparent;/)
  assert.match(chatPanel, /\.cp-messages::\-webkit-scrollbar-thumb\s*\{[\s\S]*border:\s*3px solid transparent;/)
})

test('message display uses the unified display model and text warning component', () => {
  assert.match(messageBubble, /buildMessageDisplayModel/)
  assert.match(messageBubble, /MessageTextWarning/)
  assert.match(messageBubble, /layout-\$\{displayModel\.value\.layout\}/)
})

test('search references are collapsed instead of leading the reading flow', () => {
  assert.match(messageBubble, /MessageReferences/)
  assert.match(messageReferences, /<details v-if="showSearchReferences" class="msg-search-refs">/)
  assert.match(messageReferences, /<summary class="msg-search-refs-title">搜索引用/)
  assert.doesNotMatch(messageReferences, /showKnowledgeReferences/)
  assert.doesNotMatch(messageReferences, /msg-knowledge-refs/)
  assert.ok(
    messageBubble.indexOf('<MessageReferences')
      > messageBubble.indexOf('class="msg-body"'),
    'references should render after the answer body',
  )
})

test('assistant prose layout makes long answers read like documents instead of heavy cards', () => {
  assert.match(messageBubble, /\.msg\.layout-assistant-prose\s+\.msg-bubble\s*\{[\s\S]*max-width:\s*820px;/)
  assert.match(messageBubble, /\.msg\.layout-assistant-prose\s+\.msg-bubble\s*\{[\s\S]*background:\s*transparent;/)
  assert.match(messageBubble, /\.msg\.layout-assistant-prose\s+\.msg-bubble\s*\{[\s\S]*line-height:\s*1\.76;/)
  assert.match(messageBubble, /\.msg\.layout-assistant-prose\s+:deep\(\.msg-body p\)\s*\{[\s\S]*margin:\s*0 0 \.78em;/)
  assert.match(messageBubble, /\.msg\.layout-assistant-prose\s+:deep\(\.msg-body h2\)\s*\{[\s\S]*margin-top:\s*1\.35em;/)
  assert.match(messageBubble, /\.msg\.layout-assistant-prose\s+:deep\(\.msg-body li\)\s*\{[\s\S]*margin:\s*\.28em 0;/)
})

test('code blocks and tables are contained like professional answer artifacts', () => {
  assert.match(messageBubble, /renderMessageMarkdown/)
  assert.match(markdownDisplayPolicy, /class="md-table-wrap"/)
  assert.match(markdownDisplayPolicy, /aria-label="复制代码"/)
  assert.match(markdownDisplayPolicy, /<span aria-hidden="true">📋<\/span>/)
  assert.match(messageBubble, /:deep\(\.md-code\)\s*\{[\s\S]*max-width:\s*100%;/)
  assert.match(messageBubble, /:deep\(\.md-code pre\)\s*\{[\s\S]*overflow-x:\s*auto;/)
  assert.match(messageBubble, /:deep\(\.md-table-wrap\)\s*\{[\s\S]*overflow-x:\s*auto;/)
  assert.match(messageBubble, /:deep\(\.md-table-wrap table\)\s*\{[\s\S]*min-width:\s*520px;/)
  assert.match(messageBubble, /:deep\(\.md-table-wrap td\)\s*\{[\s\S]*max-width:\s*320px;/)
})

test('message copy actions prefer native desktop clipboard before WebView fallbacks', () => {
  assert.match(messageBubble, /async function writeClipboardText\(/)
  assert.match(messageBubble, /isTauriRuntime\(\)/)
  assert.match(messageBubble, /invoke\('write_clipboard_text'/)
  assert.match(messageBubble, /navigator\.clipboard\?\.writeText/)
  assert.match(messageBubble, /document\.execCommand\('copy'\)/)
  assert.match(messageBubble, /const text = copyableMessageText\(\)/)
  assert.match(messageBubble, /await writeClipboardText\(text\)/)
  assert.match(messageBubble, /await writeClipboardText\(code\)/)
})

test('message copy falls back to rendered OpenCode part summaries when markdown content is empty', () => {
  assert.match(messageBubble, /summarizeOpenCodePart/)
  assert.match(messageBubble, /function copyableMessageText\(/)
  assert.match(messageBubble, /props\.openCodeParts/)
  assert.match(messageBubble, /part\.result/)
  assert.match(messageBubble, /props\.reasoningContent/)
  assert.match(messageBubble, /copyableMessageText\(\)/)
})

test('desktop app exposes a native clipboard command for reliable copy', () => {
  const tauriLib = readFileSync('src-tauri/src/lib.rs', 'utf8')
  const clipboardCommand = readFileSync('src-tauri/src/commands/clipboard.rs', 'utf8')
  assert.match(clipboardCommand, /pub fn write_clipboard_text\(/)
  assert.match(clipboardCommand, /arboard::Clipboard/)
  assert.match(tauriLib, /commands::clipboard::write_clipboard_text,/)
})

test('tool calls render as a quiet summary with folded details and file rows', () => {
  assert.match(messageBubble, /MessageToolSummary/)
  assert.doesNotMatch(messageBubble, /ToolCallCard/)
  assert.match(messageToolSummary, /class="tool-summary"/)
  assert.match(messageToolSummary, /aria-expanded="showDetails"/)
  assert.match(messageToolSummary, /v-if="showDetails && toolCalls && toolCalls\.length"/)
  assert.match(messageToolSummary, /class="tool-file-list"/)
  assert.match(messageToolSummary, /status-succeeded/)
  assert.match(messageToolSummary, /status-failed/)
})

test('agent status bar does not keep a completed run visually stuck on screen', () => {
  assert.match(agentStatusBar, /const visible = ref\(false\)/)
  assert.match(agentStatusBar, /phase === 'done'/)
  assert.match(agentStatusBar, /setTimeout\(\(\) => \{ visible\.value = false \}/)
  assert.match(agentStatusBar, /v-if="visible"/)
})

test('OpenCode streaming is event-driven instead of waiting for prompt completion', () => {
  assert.match(useChat, /openCodeSyncStore\.submitPrompt/)
  assert.match(useChat, /buildOpenCodePromptParts/)
  assert.match(useChat, /const desktopParts = isTauriRuntime\(\)[\s\S]*buildOpenCodePromptParts\(\{/)
  assert.match(useChat, /parts:\s*desktopParts/)
  assert.match(useChat, /openCodeSyncStore\.isStreaming/)
  assert.doesNotMatch(useChat, /subscribeOpenCodeEvents/)
  assert.doesNotMatch(useChat, /getOpenCodeSessionStatusWithTimeout/)
})

test('Web chat falls back to cloud completions without starting the desktop OpenCode kernel', () => {
  assert.match(useChat, /import \{ isTauriRuntime \} from '@\/utils\/tauriEnv'/)
  assert.match(useChat, /sendWebCloudMessage\(options,\s*runId,\s*controller,\s*assistantMsg,\s*setPhase,\s*\(\) => activeRunId,\s*messages\.value\)/)
  assert.match(useChat, /if \(!isTauriRuntime\(\)\) \{[\s\S]*await sendWebCloudMessage\([\s\S]*return/)
  assert.match(chatCloud, /async function sendWebCloudMessage/)
  assert.match(chatCloud, /resolveApiConfig\(\{[\s\S]*forceCloud:\s*true/)
  assert.match(chatCloud, /\/v1\/chat\/completions/)
  assert.match(chatCloud, /stream:\s*true/)
  assert.match(chatCloud, /buildDirectMessages\(\{/)
  assert.match(chatCloud, /runDirectChatCompletion\(\{/)
  assert.match(chatCloud, /buildCreativeHandsPrompt\(\{[\s\S]*sessionId:/)
  assert.match(chatCloud, /Web 云端对话失败/)
  assert.doesNotMatch(chatCloud, /if \(!getApiKey\(\)\)/)
})

test('Web direct tools use the same live tool trail as creative mode', () => {
  assert.match(chatCloud, /let directRoundText = ''/)
  assert.match(chatCloud, /onText:\s*text\s*=>\s*\{\s*directRoundText = text\s*;?\s*webAssistantMsg\.content = text\s*;?\s*\}/)
  assert.match(chatCloud, /onToolCalls:\s*calls\s*=>\s*\{\s*webAssistantMsg\.content = ''\s*;?\s*webAssistantMsg\.toolCalls = \[\.\.\.\(webAssistantMsg\.toolCalls \|\| \[\]\), \.\.\.calls\]/)
  assert.match(chatCloud, /webAssistantMsg\.toolProgress\s*=\s*\[\.\.\.\(webAssistantMsg\.toolProgress \|\| \[\]\)/)
  assert.match(chatCloud, /webAssistantMsg\.toolProgress\s*=\s*\(webAssistantMsg\.toolProgress \|\| \[\]\)\.map/)
  assert.match(chatCloud, /role:\s*'tool', content:\s*result\.content,[\s\S]*toolCallId:\s*call\.id, toolName:\s*call\.function\.name/)
})

test('creative mode asks through its own current-run tool approval strip', () => {
  assert.match(chatPanel, /confirmTool:\s*async call\s*=>/)
  assert.match(chatPanel, /creativeToolApprovalMessage\(call\)/)
  assert.match(chatPanel, /pendingCreativeToolApproval\.value\s*=/)
})

test('direct chats pass a complete tool step list into the shared summary UI', () => {
  assert.match(chatPanel, /reactiveAssistantMessage\.toolProgress\s*=\s*\[\.\.\.\(reactiveAssistantMessage\.toolProgress \|\| \[\]\)/)
  assert.match(chatPanel, /reactiveAssistantMessage\.toolProgress\s*=\s*\(reactiveAssistantMessage\.toolProgress \|\| \[\]\)\.map/)
  assert.match(messageBubble, /toolProgress\?:\s*ToolProgress\[\]/)
  assert.match(messageBubble, /:steps="toolProgress"/)
  assert.match(messageToolSummary, /steps\?:\s*ToolDisplayStep\[\]/)
  assert.match(messageToolSummary, /model\.status !== 'succeeded' \|\| showDetails/)
  assert.doesNotMatch(chatPanel, /onToolCall:\s*call\s*=>\s*\{\s*reactiveAssistantMessage\.content = ''/)
  assert.match(chatPanel, /\[reactiveAssistantMessage\.content, failure\]\.filter\(Boolean\)\.join\('\\n\\n'\)/)
})

test('failed direct-tool steps are individually expandable with their real result', () => {
  assert.match(messageToolSummary, /expandedStepIds/)
  assert.match(messageToolSummary, /toggleStep\(step\.toolCallId\)/)
  assert.match(messageToolSummary, /失败原因/)
  assert.match(messageToolSummary, /命令输出/)
  assert.match(messageToolSummary, /step\.result/)
})

test('creative final text uses the shared message renderer after the tool loop completes', () => {
  assert.doesNotMatch(chatPanel, /createProgressiveStreamReveal|revealCreativeFinalText|fallback = setTimeout/)
  assert.match(chatPanel, /onText:\s*value\s*=>\s*\{\s*reactiveAssistantMessage\.content = value\s*\}/)
  assert.match(messageBubble, /const pacedContent = usePacedValue/)
  assert.match(creativeChat, /input\.onText\(result\.text \|\| roundText \|\| '模型没有返回内容。'\)/)
  assert.doesNotMatch(creativeChat, /await input\.onText/)
})

test('Web cloud chat carries user images as OpenAI-compatible image_url parts', () => {
  assert.match(chatCloud, /images:\s*options\.images/)
  assert.match(chatCloud, /visionModel,/)
  assert.match(directMessageBuilder, /type:\s*'image_url'/)
  assert.match(directMessageBuilder, /parts\.push\(\{ type:\s*'image_url', image_url:\s*\{ url \} \}\)/)
  assert.match(webDirectEngine, /readChatCompletionResponse/)
})

test('Web Skill mode reads built-in SKILL.md files instead of injecting OpenCode tool instructions', () => {
  assert.match(chatPanel, /const webBuiltInSkills = computed<OpenCodeSkillOption\[\]>/)
  assert.match(chatPanel, /agentStore\.getPresetSkills\(\)/)
  assert.match(chatPanel, /if \(!isTauriRuntime\(\)\) \{[\s\S]*openCodeSkillError\.value = ''[\s\S]*return/)
  assert.match(chatPanel, /:web-mode="!isTauriRuntime\(\)"/)
  assert.match(skillPickerBar, /dist\/skills 已随站点上传/)
  assert.match(chatCloud, /resolveWebSkillSystemPrompt/)
  assert.match(chatCloud, /\.\.\.agentStore\.loadSkills\(\), \.\.\.agentStore\.getPresetSkills\(\)/)
  assert.doesNotMatch(useChat, /const systemPrompt = \[[\s\S]{0,160}buildFixedSkillSystemInstruction\(skillName\)/)
})

test('long output continuation is visually grouped instead of shown as separate chat turns', () => {
  assert.match(useChat, /continuationParentId\?: string/)
  assert.match(useChat, /_continuationParentId\?: string/)
  assert.match(useChat, /continuationParentId:\s*options\._continuationParentId/)
  assert.match(useChat, /isContinuationPrompt\?: boolean/)
  assert.match(useChat, /_isContinuationPrompt\?: boolean/)
  assert.match(useChat, /isContinuationPrompt:\s*options\._isContinuationPrompt/)
  assert.match(chatPanel, /_continuationParentId:\s*messageId/)
  assert.match(chatPanel, /_isContinuationPrompt:\s*true/)
  assert.match(chatPanel, /continuationChildrenByParent/)
  assert.match(chatPanel, /:continuation-parts="continuationChildrenByParent\.get\([^\"]+\.id\)"/)
  assert.match(chatPanel, /getContinuationTailMessage/)
  assert.match(chatPanel, /collectContinuationThreadIds/)
  assert.match(messageBubble, /ContinuationPart\[\]/)
  assert.match(messageBubble, /:finish-reason="part\.finishReason"/)
  assert.match(messageBubble, /class="msg-continuation-group"/)
})

test('references open through safe external navigation instead of raw target blank links', () => {
  assert.match(messageReferences, /openExternal/)
  assert.match(messageReferences, /safeSearchResults/)
  assert.match(messageReferences, /isSafeSearchReferenceUrl/)
  assert.doesNotMatch(messageReferences, /target="_blank"/)
})

test('tool summary receives running state and latest tool result evidence', () => {
  assert.match(messageBubble, /isToolRunning/)
  assert.match(messageBubble, /latestToolResult/)
  assert.match(messageBubble, /:is-running="isToolRunning"/)
  assert.match(messageBubble, /!hasOpenCodeNonTextParts && \(\(toolCalls && toolCalls\.length\) \|\| officeDownloadFiles\.length \|\| latestToolResult\)/)
  assert.match(messageBubble, /:tool-result="latestToolResult"/)
  assert.match(chatPanel, /buildLatestToolResultByAssistantId/)
  assert.match(chatPanel, /latestToolResultByAssistantId\.get\(message\.id\)/)
  assert.doesNotMatch(chatPanel, /pendingToolResults/)
})

test('file tree refreshes through the compact three-tab loader', () => {
  assert.match(fileTreePanel, /async function loadTab\(\)/)
  assert.match(fileTreePanel, /if \(activeTab\.value === 'history'\)/)
  assert.match(fileTreePanel, /await fileStore\.loadByCategory\(activeTab\.value\)/)
  assert.match(fileTreePanel, /onEvent\('refresh-file-list'[\s\S]*void loadTab\(\)/)
  assert.match(fileTreePanel, /@click="loadTab"/)
})

test('message bubble coerces message content before trim-dependent UI checks', () => {
  assert.match(messageBubble, /const normalizedContent = computed\(\(\) => \{[\s\S]*return String\(props\.content \|\| ''\)[\s\S]*\}\)/)
  assert.doesNotMatch(messageBubble, /props\.content\.trim\(\)/)
})

test('manual compact waits for official OpenCode context sync before claiming completion', () => {
  assert.match(useChat, /await compactOpenCodeSession\(client/)
  assert.match(useChat, /await waitOpenCodeSessionIdle\(client,\s*\{ sessionID,\s*directory:\s*effectiveDir \}\)/)
  assert.match(useChat, /waitForOpenCodeCompactionSync\(client,\s*sessionID,\s*beforeUsage\)/)
  assert.match(useChat, /invalidateOpenCodeSessionContextUsage\(sessionID\)/)
  assert.match(useChat, /latestUsage\.messageCount < beforeUsage\.messageCount \|\| latestUsage\.total < beforeUsage\.total/)
  assert.doesNotMatch(useChat, /countOpenCodeCompactionMessages\(latestMessages\)/)
  assert.doesNotMatch(useChat, /\| 'summarize'/)
  assert.doesNotMatch(useChat, /summarizeOpenCodeSession/)
  assert.match(useChat, /notifyOpenCodeRun\('OpenCode 压缩上下文等待同步'/)
  assert.match(useChat, /OpenCode 上下文已压缩/)
  assert.match(useChat, /已发起 OpenCode 上下文压缩，等待官方上下文同步/)
  assert.doesNotMatch(useChat, /已请求 OpenCode 压缩上下文/)
})

test('OpenCode P4 notifications cover session actions slash commands and shell results', () => {
  assert.match(useChat, /function notifyOpenCodeRun/)
  assert.match(useChat, /function notifyOpenCodeSessionAction/)
  assert.match(useChat, /function notifyOpenCodeSlashCommand/)
  assert.match(useChat, /function notifyOpenCodeShellCommand/)
  assert.match(useChat, /notifyOpenCodeSessionAction\(action, true, sessionCommandNotice\.value\)/)
  assert.match(useChat, /notifyOpenCodeSessionAction\(action, false, detail\)/)
  assert.match(useChat, /notifyOpenCodeSlashCommand\(command, true\)/)
  assert.match(useChat, /notifyOpenCodeSlashCommand\(command, false, detail\)/)
  assert.match(useChat, /notifyOpenCodeShellCommand\(true\)/)
  assert.match(useChat, /notifyOpenCodeShellCommand\(false\)/)
  assert.match(useChat, /OpenCode Shell 已完成/)
  assert.match(useChat, /Shell 命令执行失败/)
  assert.doesNotMatch(useChat, /notifyOpenCodeShellCommand\(true, raw\)/)
  assert.doesNotMatch(useChat, /notifyOpenCodeShellCommand\(false, detail\)/)
  assert.doesNotMatch(useChat, /notifyOpenCodeRun\('OpenCode Shell 已完成', raw\)/)
})

test('OpenCode undo rejects local generated ids before calling official revert', () => {
  assert.match(useChat, /function isLocalGeneratedMessageId\(id: string\)/)
  assert.match(useChat, /await latestOpenCodeUserMessageId\(client\)/)
  assert.match(useChat, /!isLocalGeneratedMessageId\(message\.id\)/)
  assert.match(useChat, /没有可撤销的 OpenCode 用户消息/)
})

test('smart auto-scroll is throttled per frame and exposed to ChatPanel', () => {
  assert.match(chatScrollNav, /function scheduleAutoScrollIfNeeded\(\)/)
  assert.match(chatScrollNav, /autoScrollTimer = setTimeout\(\(\) => \{/)
  assert.match(chatScrollNav, /\}, 16\)/)
  assert.match(chatScrollNav, /function nearBottom\(el: HTMLElement/)
  assert.match(chatScrollNav, /nearBottom\(el, 10\)/)
  assert.match(chatScrollNav, /stickyScrollBottom/)
  assert.match(chatScrollNav, /settling/)
  assert.match(chatScrollNav, /window\.setTimeout\(\(\) => \{ settling = false \}, 300\)/)
  assert.match(chatScrollNav, /closest\('\[data-scrollable\]'\)/)
  assert.match(chatScrollNav, /programmaticScrollTimer/)
  assert.match(chatScrollNav, /function startStickyFollow\(\)/)
  assert.match(chatScrollNav, /MutationObserver/)
  assert.match(chatScrollNav, /ResizeObserver/)
  assert.match(chatScrollNav, /observeMessageElements/)
  assert.match(chatScrollNav, /if \(stickyScrollBottom\.value\) scrollToBottomNow\(\)/)
  assert.match(chatScrollNav, /defineExpose\(\{/)
  assert.match(chatScrollNav, /scheduleAutoScrollIfNeeded/)
  assert.match(chatScrollNav, /startStickyFollow/)
  assert.match(chatScrollNav, /scrollToBottom/)
  assert.match(chatScrollNav, /stickyScrollBottom/)
  assert.match(chatScrollNav, /showScrollToBottom/)
  assert.match(chatPanel, /scrollNav\.value\?\.scheduleAutoScrollIfNeeded\(\)/)
  assert.match(chatPanel, /scrollNav\.value\?\.startStickyFollow\(\)/)
  assert.match(markdownDisplayPolicy, /data-scrollable="true"/)
  assert.match(openCodePartList, /data-scrollable="true"/)
})

test('tool summaries and composer expose terminal states without looking stuck', () => {
  assert.match(messageToolSummary, /status-cancelled/)
  assert.match(messageToolSummary, /model\.status === 'cancelled'/)
  assert.match(chatPanel, /aria-label="停止生成"/)
  assert.match(chatPanel, /aria-label="发送消息"/)
  assert.match(chatPanel, /:aria-busy="isStreaming"/)
})

test('OpenCode structured parts make messages visible without polluting markdown body', () => {
  assert.match(chatPanel, /m\.openCodeParts && m\.openCodeParts\.some/)
  assert.match(messageBubble, /hasMarkdownBody/)
  assert.match(messageBubble, /v-else-if="hasMarkdownBody/)
  assert.doesNotMatch(messageBubble, /v-else-if="!\(role === 'tool' && officeDownloadFiles\.length\)"/)
})

test('ChatPanel renders OpenCode assistant messages through timeline rows', () => {
  assert.match(chatPanel, /buildOpenCodeTimelineRows/)
  assert.match(chatPanel, /function openCodeRowsForMessage/)
  assert.match(chatPanel, /row\.type === 'assistant-part'/)
  assert.match(chatPanel, /:open-code-parts="row\.parts"/)
  assert.match(chatPanel, /row\.type === 'system-event'/)
  assert.match(chatPanel, /cp-opencode-system/)
  assert.match(chatPanel, /row\.type === 'thinking'/)
  assert.match(chatPanel, /row\.type === 'error'/)
})

test('session switching prefetches linked OpenCode sessions and uses cached official history', () => {
  assert.match(chatPanel, /prefetchOpenCodeSession/)
  assert.match(chatPanel, /listOpenCodeChatMessages/)
  assert.match(chatPanel, /session\?\.openCodeSessionId/)
  assert.match(chatPanel, /preferCache:\s*true/)
  assert.match(chatPanel, /openCodeHistory\.length \? openCodeHistory : history/)
})

test('OpenCode docks follow official above-composer ordering', () => {
  const order = [
    '<PermissionDock',
    '<QuestionDock',
    '<TodoDock',
    '<RevertDock',
    '<FollowupDock',
    '<SessionShareNotice',
  ].map(token => chatPanel.indexOf(token))

  assert.ok(order.every(index => index >= 0), 'all official docks should be mounted in ChatPanel')
  assert.deepEqual([...order].sort((a, b) => a - b), order)
})

test('Web direct hides desktop OpenCode review and interaction docks', () => {
  assert.match(chatPanel, /<PermissionDock v-if="!isWebRuntime && !isCreativeMode"/)
  assert.match(chatPanel, /<QuestionDock v-if="!isWebRuntime && !isCreativeMode"/)
  assert.match(chatPanel, /<TodoDock v-if="!isWebRuntime && !isCreativeMode"/)
  assert.match(chatPanel, /<RevertDock\s+v-if="!isWebRuntime && !isCreativeMode"/)
  assert.match(chatPanel, /<FollowupDock\s+v-if="!isWebRuntime && !isCreativeMode"/)
  assert.match(chatPanel, /<SessionShareNotice v-if="!isWebRuntime && !isCreativeMode && sessionShareUrl"/)
  assert.doesNotMatch(chatPanel, /<DiffReviewDock/)
  assert.match(chatPanel, /if \(isTauriRuntime\(\) && !isCreativeMode\.value\) \{[\s\S]*void refreshOpenCodeSkills\(\)[\s\S]*void refreshOpenCodeCommands\(\)[\s\S]*\}/)
})

test('OpenCode context tools use a dedicated official-style grouped carrier', () => {
  assert.match(timelineRows, /type:\s*'context-group'/)
  assert.match(chatPanel, /row\.type === 'context-group'/)
  assert.match(openCodePartList, /context-group/)
  assert.match(openCodePartList, /opencode-context-group/)
  assert.match(openCodePartList, /contextSummary/)
  assert.match(openCodePartList, /const contextParts = computed/)
  assert.match(openCodePartList, /data-component="context-tool-group-trigger"/)
  assert.match(openCodePartList, /data-component="context-tool-group-list"/)
  assert.match(openCodePartList, /data-component="tool-trigger"/)
  assert.match(openCodePartList, /data-slot="basic-tool-tool-title"/)
  assert.match(openCodePartList, /detailText\(part\)/)
})

test('OpenCode tool parts expose official default-open rules and error-card carrier', () => {
  assert.match(timelineRows, /openCodePartDefaultOpen/)
  assert.match(openCodePartList, /shellToolPartsExpanded/)
  assert.match(openCodePartList, /editToolPartsExpanded/)
  assert.match(openCodePartList, /opencode-tool-error-card/)
  assert.match(openCodePartList, /copyErrorDetail/)
  assert.match(openCodePartList, /part\.status === 'error'/)
})

test('command presets expose a settings tab for beginner slash commands', () => {
  assert.match(kbCommandPresets, /'设置'/)
  for (const command of ['/new', '/share', '/unshare', '/undo', '/redo', '/compact', '/fork', '/open', '/terminal', '/mcp', '/workspace']) {
    assert.match(kbCommandPresets, new RegExp(`template: '${command.replace('/', '\\/')}'`))
  }
  assert.match(kbCommandPresets, /新建会话/)
  assert.match(kbCommandPresets, /压缩上下文/)
  assert.match(kbCommandPresets, /切换终端面板/)
})

test('composer input keeps text clear of action buttons and hides empty statusline', () => {
  assert.doesNotMatch(chatPanel, /padding:\s*8px 162px 8px 12px/)
  assert.doesNotMatch(chatPanel, /padding:\s*3px 88px 3px 0/)
  assert.match(chatPanel, /\.cp-input-wrap\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;/)
  assert.match(chatPanel, /\.cp-input-actions\s*\{[\s\S]*position:\s*static;[\s\S]*justify-content:\s*space-between;/)
  assert.match(chatPanel, /\.cp-input-wrap textarea\s*\{[\s\S]*padding:\s*0;/)
  assert.doesNotMatch(chatPanel, /:token-usage="openCodeContextUsage"/)
  assert.match(agentStatusBar, /const hasContent = computed/)
  assert.match(agentStatusBar, /<div v-if="hasContent" class="agent-status"/)
})

test('OpenCode P4 terminal shell parts render as rich terminal output', () => {
  const shellDisplay = readFileSync('src/opencodeClient/shellDisplay.ts', 'utf8')
  assert.match(openCodePartList, /from '@\/opencodeClient\/shellDisplay'/)
  assert.match(openCodePartList, /const isShellPart = isOpenCodeShellPart/)
  assert.match(shellDisplay, /export function isOpenCodeShellPart/)
  assert.match(shellDisplay, /part\.type === 'shell'/)
  assert.match(shellDisplay, /toolName === 'bash' \|\| toolName === 'shell'/)
  assert.match(shellDisplay, /export function shellDisplayCommand/)
  assert.match(shellDisplay, /export function shellDisplayStdout/)
  assert.match(shellDisplay, /export function shellDisplayStderr/)
  assert.match(shellDisplay, /export function shellDisplayErrorText/)
  assert.match(shellDisplay, /export function shellDisplayExitLabel/)
  assert.match(shellDisplay, /export function shellDisplayDurationLabel/)
  assert.match(shellDisplay, /export function shellDisplayDetail/)
  assert.match(shellDisplay, /safeOpenCodeJsonSummary\(value, 3000\)/)
  assert.match(openCodePartList, /class="opencode-terminal"/)
  assert.match(openCodePartList, /class="opencode-terminal-command"/)
  assert.match(openCodePartList, />stdout</)
  assert.match(openCodePartList, />stderr</)
  assert.match(openCodePartList, /暂无 shell 输出/)
  assert.match(openCodePartList, /const shellDetail = shellDisplayDetail/)
  assert.match(openCodePartList, /isShellPart\(part\) \? shellDetail\(part\)/)
})

test('OpenCode P2 advanced commands are local UI carriers with source labels', () => {
  assert.match(openCodeCatalog, /listOpenCodeCommands/)
  assert.match(openCodeCatalog, /commandApi\.list/)
  assert.match(chatPanel, /listOpenCodeCommands/)
  assert.match(chatPanel, /openCodeCustomCommands/)
  assert.match(chatPanel, /refreshOpenCodeCommands/)
  assert.match(chatPanel, /label: '外部工具扩展'/)
  assert.match(chatPanel, /source: 'External tools'/)
  assert.match(chatPanel, /label: '打开项目文件'/)
  assert.match(chatPanel, /source: 'Custom file\.open'/)
  assert.match(chatPanel, /label: '添加选区上下文'/)
  assert.match(chatPanel, /source: 'Custom context\.addSelection'/)
  assert.match(chatPanel, /label: 'Terminal 面板'/)
  assert.match(chatPanel, /source: 'Local UI terminal\.toggle'/)
  assert.match(chatPanel, /label: '新建 Terminal'/)
  assert.match(chatPanel, /source: 'Local UI terminal\.new'/)
  assert.match(chatPanel, /label: 'Skill 命令'/)
  assert.match(chatPanel, /Skill \/ 外部工具 \/ Custom/)
  assert.match(chatPanel, /cp-composer-command-error/)
  assert.match(chatPanel, /label: '归档'/)
  assert.match(chatPanel, /runLocalOpenCodeUiCommand\(command\)/)
  assert.match(chatPanel, /command === 'mcp'/)
  assert.match(chatPanel, /command === 'terminal' \|\| command === 'terminal\.toggle'/)
  assert.match(chatPanel, /command === 'open' \|\| command === 'file\.open'/)
  assert.match(chatPanel, /command === 'context' \|\| command === 'selection' \|\| command === 'context\.addselection'/)
  assert.ok(
    chatPanel.indexOf('if (runLocalOpenCodeUiCommand(command)) return') < chatPanel.indexOf('await runSlashCommand(text, options)'),
    'local P2 UI commands should be intercepted before server slash execution',
  )
})

test('OpenCode task tool renders as a Subtask child-session carrier', () => {
  assert.match(openCodePartList, /isSubtaskPart/)
  assert.match(openCodePartList, /part\.type === 'subtask'/)
  assert.match(openCodePartList, /part\.toolName === 'task'/)
  assert.match(openCodePartList, /Subtask \/ 子任务/)
  assert.match(openCodePartList, /打开子任务会话/)
  assert.match(openCodePartList, /subtaskSessionId/)
  assert.match(messageBubble, /@open-subtask="emit\('openSubtask', \$event\)"/)
  assert.match(chatPanel, /@open-subtask="openSubtaskSession"/)
  assert.match(chatPanel, /async function openSubtaskSession/)
  assert.match(chatPanel, /await openCodeSyncStore\.openSession\(directory, sessionId\)/)
  assert.match(chatPanel, /currentSessionId = sessionId/)
  assert.match(chatPanel, /sessionStore\.switchSession\(sessionId\)/)
  assert.doesNotMatch(chatPanel, /待 OpenCode session 路由接入/)
})

test('OpenCode P2 model menu stays model-only without variant UI copy', () => {
  assert.doesNotMatch(chatPanel, /cp-model-variant-cycle/)
  assert.doesNotMatch(chatPanel, /cp-model-label">切换 Variant \/ 变体/)
  assert.doesNotMatch(chatPanel, /model\.variant\.cycle/)
  assert.doesNotMatch(chatPanel, /cycleModelVariant/)
  assert.doesNotMatch(chatPanel, /均衡/)
  assert.doesNotMatch(chatPanel, /深度/)
})

test('OpenCode permission and question docks await parent async handlers before re-enabling actions', () => {
  assert.match(permissionDock, /onDecide\?:/)
  assert.match(permissionDock, /await props\.onDecide/)
  assert.doesNotMatch(permissionDock, /await emit\('decide'/)
  assert.match(questionDock, /onReply\?:/)
  assert.match(questionDock, /onReject\?:/)
  assert.match(questionDock, /await props\.onReply/)
  assert.match(questionDock, /await props\.onReject/)
  assert.doesNotMatch(questionDock, /await emit\('reply'/)
})

test('OpenCode P3 shortcuts follow official keybinds and avoid extra main buttons', () => {
  assert.match(chatPanel, /resolveOpenCodeP3KeyAction/)
  assert.match(chatPanel, /function onGlobalKeydown/)
  assert.match(chatPanel, /isTextInput,/)
  assert.match(chatPanel, /isTauriRuntime: isTauriRuntime\(\)/)
  assert.match(chatPanel, /hasActiveEditorFile: Boolean\(activeEditorFileId\.value\)/)
  assert.match(chatPanel, /action === 'focus-input'/)
  assert.match(chatPanel, /action === 'message-previous'/)
  assert.match(chatPanel, /action === 'message-next'/)
  assert.match(chatPanel, /action === 'toggle-file-tree'/)
  assert.match(chatPanel, /action === 'close-tab'/)
  assert.match(chatPanel, /window\.addEventListener\('keydown', onGlobalKeydown\)/)
  assert.match(chatPanel, /window\.removeEventListener\('keydown', onGlobalKeydown\)/)
  assert.doesNotMatch(chatPanel, /title="聚焦输入"/)
  assert.doesNotMatch(chatPanel, /agent\.cycle \/ agent\.cycle\.reverse 使用同一个 Agent 菜单承载/)
})

test('OpenCode share results use an actionable copy and open carrier', () => {
  assert.match(useChat, /sessionShareUrl/)
  assert.match(useChat, /sessionShareUrl\.value = shared\?\./)
  assert.match(chatPanel, /<SessionShareNotice v-if="!isWebRuntime && !isCreativeMode && sessionShareUrl" :url="sessionShareUrl"/)
  assert.match(sessionShareNotice, /copyShareUrl/)
  assert.match(sessionShareNotice, /openShareUrl/)
  assert.match(sessionShareNotice, /write_clipboard_text/)
  assert.match(sessionShareNotice, /openExternal/)
})

test('OpenCode redo and RevertDock follow official revert boundary semantics', () => {
  assert.match(useChat, /refreshRevertItemsAfterRestored/)
  assert.match(useChat, /restoreOpenCodeRevertBoundary/)
  assert.match(useChat, /nextUserMessageIdAfter/)
  assert.match(useChat, /const startIndex = users\.findIndex\(message => message\.id === revertMessageID\)/)
  assert.match(useChat, /const index = users\.findIndex\(message => message\.id === messageID\)/)
  assert.match(useChat, /await revertOpenCodeSessionMessage\(client, \{ \.\.\.location, messageID: nextMessageID \}\)/)
  assert.match(useChat, /await unrevertOpenCodeSession\(client, location\)/)
  assert.match(useChat, /await restoreOpenCodeRevertBoundary\(client,\s*\{ sessionID,\s*directory:\s*effectiveDir \}, itemId\)/)
  assert.doesNotMatch(useChat, /message\.id > restoreMessageID/)
  assert.doesNotMatch(useChat, /message\.id >= revertMessageID/)
})

test('OpenCode P4 review diff panel exposes file and hunk level review carriers', () => {
  assert.match(reviewPanel, /buildDiffReviewModel/)
  assert.match(reviewPanel, /vcsBranchDiffs/)
  assert.match(reviewPanel, /审查 \{\{ reviewCount \}\}/)
  assert.match(reviewPanel, /Git changes/)
  assert.match(reviewPanel, /Branch changes/)
  assert.match(reviewPanel, />统一</)
  assert.match(reviewPanel, />拆分</)
  assert.match(reviewPanel, /全部展开/)
  assert.doesNotMatch(reviewPanel, /接受|回滚|应用|拒绝/)
  assert.match(diffReviewSource, /export function buildDiffReviewModel/)
  assert.match(diffReviewSource, /parsePatchHunks/)
  assert.match(diffReviewSource, /DiffReviewLineKind = 'add' \| 'del' \| 'context' \| 'meta'/)
})

test('OpenCode session switching clears stale share and command notice UI state', () => {
  assert.match(
    useChat,
    /function loadMessages\(history: ChatMessage\[\], _baseline\?: RuntimeContextBaseline\)[\s\S]*sessionShareUrl\.value = ''[\s\S]*sessionCommandNotice\.value = ''[\s\S]*resetToolState\(\)/,
  )
})

test('desktop mode selector exposes plan build and creative without changing Web direct-only behavior', () => {
  assert.match(chatPanel, /useChatModeStore/)
  assert.match(chatPanel, /agentModeLabel = computed\(\(\) => agentMode\.value === 'creative' \? '创'/)
  assert.match(chatPanel, /selectAgentMode\('build'\)/)
  assert.match(chatPanel, /selectAgentMode\('plan'\)/)
  assert.match(chatPanel, /selectAgentMode\('creative'\)/)
  assert.doesNotMatch(chatPanel, /selectAgentMode\('direct'\)/)
  assert.match(chatPanel, /const currentDesktopOpenCodeAgent = computed<'build' \| 'plan' \| undefined>/)
  assert.match(chatPanel, /openCodeAgent: currentDesktopOpenCodeAgent\.value/)
  assert.match(chatPanel, /chatMode: currentDesktopOpenCodeAgent\.value/)
  assert.match(chatPanel, /!isWebRuntime\.value && !hasAttachments && sendText\.startsWith\('\/'\)/)
  assert.match(chatPanel, /!isWebRuntime\.value && !hasAttachments && sendText\.startsWith\('!'\)/)
  assert.match(chatPanel, /v-if="showShellCommandMenu && !isWebRuntime"/)
  assert.doesNotMatch(chatPanel, /agentMode !== 'direct'/)
})

test('creative tool approval is an in-app three-action strip for the current run', () => {
  assert.match(chatPanel, /pendingCreativeToolApproval/)
  assert.match(chatPanel, /终端附件|读取视频信息并截取视频画面/)
  assert.match(chatPanel, />始终允许</)
  assert.match(chatPanel, />允许</)
  assert.match(chatPanel, />拒绝</)
  assert.match(chatPanel, /creativeToolAlwaysAllowed\s*=\s*true/)
})

// ponytail: direct mode tests removed (SDD app-opencode-only)

test('OpenCode user messages render only the official non-synthetic text part with footer actions', () => {
  assert.match(messageBubble, /const userTextPart = computed/)
  assert.match(messageBubble, /p\.type === 'text' && !\(p as any\)\.synthetic/)
  assert.match(messageBubble, /role === 'user' && userTextPart\.value\?\.text/)
  assert.match(messageBubble, /data-component="user-message"/)
  assert.match(messageBubble, /data-slot="user-message-body"/)
  assert.match(messageBubble, /data-slot="user-message-text"/)
  assert.match(messageBubble, /data-slot="user-message-copy-wrapper"/)
  assert.match(messageBubble, /data-slot="user-message-meta"/)
  assert.match(messageBubble, /data-slot="user-message-meta-tail"/)
  assert.match(messageBubble, /userMetaHead/)
  assert.match(messageBubble, /title="重置到此点"/)
  assert.match(messageBubble, /title="复制消息"/)
})

test('OpenCode assistant text parts render with official message-part DOM slots', () => {
  assert.match(messageBubble, /data-component="assistant-message"/)
  assert.match(messageBubble, /data-component="text-part"/)
  assert.match(messageBubble, /data-slot="text-part-body"/)
  assert.match(messageBubble, /data-slot="text-part-copy-wrapper"/)
  assert.match(messageBubble, /data-slot="text-part-meta"/)
})

test('OpenCode project workspace does not declare legacy vault mount fs scopes', () => {
  const permissions = tauriDefaultCapability.permissions as any[]
  assert.equal(JSON.stringify(permissions).includes('.jiucaihezi-vaults/current'), false)
})

test('OpenCode skill tool part has a first-class Skill loaded card', () => {
  assert.match(openCodePartList, /isSkillToolPart/)
  assert.match(openCodePartList, /skillToolName/)
  assert.match(openCodePartList, /已加载 Skill：/)
  assert.match(openCodePartList, /OpenCode 官方 skill tool 已返回 SKILL\.md 内容/)
  assert.match(openCodePartList, /Skill 加载失败，请检查名称、权限或扫描路径/)
})
