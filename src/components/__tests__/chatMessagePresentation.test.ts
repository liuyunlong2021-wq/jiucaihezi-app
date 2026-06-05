import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const messageBubble = readFileSync('src/components/chat/MessageBubble.vue', 'utf8')
const messageReferences = readFileSync('src/components/chat/MessageReferences.vue', 'utf8')
const chatPanel = readFileSync('src/components/chat/ChatPanel.vue', 'utf8')
const messageToolSummary = readFileSync('src/components/chat/MessageToolSummary.vue', 'utf8')
const agentStatusBar = readFileSync('src/components/chat/AgentStatusBar.vue', 'utf8')
const chatScrollNav = readFileSync('src/components/chat/ChatScrollNav.vue', 'utf8')
const useChat = readFileSync('src/composables/useChat.ts', 'utf8')
const markdownDisplayPolicy = readFileSync('src/components/chat/display/markdownDisplayPolicy.ts', 'utf8')

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

test('message display uses the unified display model and text warning component', () => {
  assert.match(messageBubble, /buildMessageDisplayModel/)
  assert.match(messageBubble, /MessageTextWarning/)
  assert.match(messageBubble, /layout-\$\{displayModel\.value\.layout\}/)
})

test('knowledge and search references are collapsed instead of leading the reading flow', () => {
  assert.match(messageBubble, /MessageReferences/)
  assert.match(messageReferences, /<details v-if="showSearchReferences" class="msg-search-refs">/)
  assert.match(messageReferences, /<summary class="msg-search-refs-title">搜索引用/)
  assert.match(messageReferences, /<details v-if="showKnowledgeReferences" class="msg-search-refs msg-knowledge-refs">/)
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
  assert.match(markdownDisplayPolicy, /<span class="mso" aria-hidden="true">content_copy<\/span>/)
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
  assert.match(messageBubble, /await writeClipboardText\(props\.content\)/)
  assert.match(messageBubble, /await writeClipboardText\(code\)/)
})

test('desktop app exposes a native clipboard command for reliable copy', () => {
  const tauriLib = readFileSync('src-tauri/src/lib.rs', 'utf8')
  assert.match(tauriLib, /fn write_clipboard_text\(/)
  assert.match(tauriLib, /Stdio::piped\(\)/)
  assert.match(tauriLib, /pbcopy/)
  assert.match(tauriLib, /write_clipboard_text,/)
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

test('streaming text uses progressive reveal and rAF commit without touching tool call parsing', () => {
  assert.match(useChat, /createProgressiveStreamSmoother/)
  assert.match(useChat, /createStreamCommitScheduler/)
  assert.match(useChat, /const STREAM_UI_FLUSH_INTERVAL_MS = 28/)
  assert.match(useChat, /const replySmoother = createProgressiveStreamSmoother\(/)
  assert.match(useChat, /const replyCommitScheduler = createStreamCommitScheduler<string>/)
  assert.match(useChat, /replySmoother\.flush\(\)/)
  assert.match(useChat, /replyCommitScheduler\.flush\(\)/)
  assert.match(useChat, /onToolCallDelta\(buildToolCalls\(toolCallAccum\)\)/)
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
  assert.match(chatPanel, /:continuation-parts="continuationChildrenByParent\.get\(msg\.id\)"/)
  assert.match(chatPanel, /getContinuationTailMessage/)
  assert.match(chatPanel, /collectContinuationThreadIds/)
  assert.match(messageBubble, /ContinuationPart\[\]/)
  assert.match(messageBubble, /:finish-reason="part\.finishReason"/)
  assert.match(messageBubble, /class="msg-continuation-group"/)
})

test('message display owns base bubble styling instead of relying on parent scoped css', () => {
  assert.match(messageBubble, /\.msg-bubble\s*\{[\s\S]*max-width:\s*85%;/)
  assert.match(messageBubble, /\.msg\.user\s+\.msg-bubble\s*\{[\s\S]*background:/)
  assert.match(messageBubble, /\.msg\.assistant\s+\.msg-bubble\s*\{[\s\S]*background:/)
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
  assert.match(messageBubble, /v-if="\(toolCalls && toolCalls\.length\) \|\| officeDownloadFiles\.length \|\| latestToolResult"/)
  assert.match(messageBubble, /:tool-result="latestToolResult"/)
  assert.match(chatPanel, /buildLatestToolResultByAssistantId/)
  assert.match(chatPanel, /latestToolResultByAssistantId\.get\(message\.id\)/)
  assert.doesNotMatch(chatPanel, /pendingToolResults/)
})

test('phase 0 guard keeps streaming rendering separate from final markdown rendering', () => {
  assert.match(messageBubble, /isStreamingMessage/)
  assert.match(messageBubble, /renderStreamingText/)
  assert.match(messageBubble, /isStreamingMessage\s*\?\s*renderStreamingText\(props\.content\)\s*:\s*renderMessageMarkdown\(props\.content,\s*props\.role\)/)
  assert.match(chatPanel, /:is-streaming-message="isAssistantStreamingMessage\(msg\)"/)
})

test('phase 0 guard keeps execution boundaries out of the conversation experience layer', () => {
  assert.match(useChat, /onToolCallDelta\(buildToolCalls\(toolCallAccum\)\)/)
  assert.match(useChat, /msg\.content = result\.finishReason === 'length'[\s\S]*: result\.fullText/)
  assert.match(chatPanel, /isContextBoundaryDisplayMessage/)
  assert.match(chatPanel, /if \(m\.role === 'system'\) return isContextBoundaryDisplayMessage\(m\)/)
  assert.match(chatPanel, /if \(m\.role === 'tool'\) return false/)
})

test('smart auto-scroll is scheduled through requestAnimationFrame and exposed to ChatPanel', () => {
  assert.match(chatScrollNav, /function scheduleAutoScrollIfNeeded\(\)/)
  assert.match(chatScrollNav, /requestAnimationFrame/)
  assert.match(chatScrollNav, /isNearBottom\(el\)/)
  assert.match(chatScrollNav, /shouldAutoScrollAfterContentChange/)
  assert.match(chatScrollNav, /defineExpose\(\{ autoScrollIfNeeded, scheduleAutoScrollIfNeeded/)
  assert.match(chatPanel, /scrollNav\.value\?\.scheduleAutoScrollIfNeeded\(\)/)
  assert.doesNotMatch(chatPanel, /scrollNav\.value\?\.autoScrollIfNeeded\(\)/)
})

test('floating message navigation does not block selecting the native message scrollbar', () => {
  assert.match(chatScrollNav, /\.scroll-nav-rail\s*\{[\s\S]*pointer-events:\s*none;/)
  assert.match(chatScrollNav, /\.scroll-btn\s*\{[\s\S]*pointer-events:\s*auto;/)
  assert.match(chatScrollNav, /right:\s*44px;/)
  assert.doesNotMatch(chatScrollNav, /right:\s*4px;/)
})

test('tool summaries and composer expose terminal states without looking stuck', () => {
  assert.match(messageToolSummary, /status-cancelled/)
  assert.match(messageToolSummary, /model\.status === 'cancelled'/)
  assert.match(chatPanel, /aria-label="停止生成"/)
  assert.match(chatPanel, /aria-label="发送消息"/)
  assert.match(chatPanel, /:aria-busy="isStreaming"/)
})
