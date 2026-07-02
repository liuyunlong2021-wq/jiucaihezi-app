/**
 * composables/useChat.ts — Wave 1 OpenCode facade
 *
 * The old hand-written chat kernel is intentionally disconnected here.
 * This module keeps the existing UI contract alive until Wave 2 wires
 * ChatPanel to OpenCode through src/opencodeClient/*.
 */
import { readonly, ref } from 'vue'
import type { OfficeDownloadFile } from '@/utils/officeDownloads'
import type { RunTraceSummary } from '@/utils/runTrace'
import type { RuntimeCapabilityTier } from '@/utils/runtimeCapabilities'
import { resolveWebSkillSystemPrompt } from '@/utils/skillContentResolver'
import { buildDirectMessages } from '@/utils/directMessageBuilder'
import { useAgentStore } from '@/stores/agentStore'
import {
  buildChatCompletionExtras,
  buildHeaders,
  getAssistantMessageContent,
  resolveApiConfig,
} from '@/utils/api'
import {
  isLocalModelProviderId,
  resolveModelProviderId,
  supportsVision,
} from '@/utils/providerConfig'
import { isTauriRuntime } from '@/utils/tauriEnv'
import {
  ensureCloudConversation,
  saveCloudSnapshot,
  sendWebCloudMessage,
} from './chatCloud'
import {
  runDirectChatCompletion,
  type DirectChatCompletionRequest,
} from '@/runtime/direct/directEngine'
import { ensureOpenCodeServer } from '@/opencodeClient/daemon'
import { createJiucaiOpenCodeClient } from '@/opencodeClient/client'
import { projectStoredNewApiForOpenCode, toOpenCodeModelProjection } from '@/opencodeClient/providerProjection'
import { subscribeOpenCodeEvents } from '@/opencodeClient/eventBridge'
import {
  getOpenCodeRunErrorDetail,
  isOpenCodeRunCompleteEvent,
  isOpenCodeRunErrorEvent,
  normalizeOpenCodeSessionStatus,
} from '@/opencodeClient/runEvents'
import {
  abortOpenCodeSession,
  buildOpenCodePromptParts,
  createOpenCodeSession,
  fireOpenCodePrompt,
  getOpenCodeSessionStatus,
  getOpenCodeStatusType,
  getOpenCodeSessionStatusWithTimeout,
  listOpenCodeChatMessages,
  updateOpenCodeSessionModel,
  updateOpenCodeSessionPermission,
} from '@/opencodeClient/session'
import { buildFixedSkillSystemInstruction, buildSkillPermissionScope } from '@/opencodeClient/skillScope'
import {
  applyOpenCodePartDelta,
  upsertOpenCodePart,
  type OpenCodeRenderablePart,
} from '@/opencodeClient/timelineRows'
import {
  listOpenCodeTodos,
  normalizePermissionRequest,
  normalizeQuestionRequest,
  rejectOpenCodeQuestion,
  replyOpenCodePermission,
  replyOpenCodeQuestion,
  type OpenCodePermissionReply,
  type OpenCodePermissionRequest,
  type OpenCodeQuestionRequest,
  type OpenCodeTodo,
} from '@/opencodeClient/interactive'
import {
  getOpenCodeSessionContextUsage,
  invalidateOpenCodeSessionContextUsage,
  type OpenCodeContextUsage,
} from '@/opencodeClient/catalog'
import {
  archiveOpenCodeSession,
  compactOpenCodeSession,
  deleteOpenCodeSession,
  fetchOpenCodeVcsDiff,
  forkOpenCodeSession,
  listOpenCodeSessionDiff,
  revertOpenCodeSessionMessage,
  runOpenCodeShellCommand,
  runOpenCodeSlashCommand,
  shareOpenCodeSession,
  unshareOpenCodeSession,
  unrevertOpenCodeSession,
  waitOpenCodeSessionIdle,
} from '@/opencodeClient/sessionCommands'
import type { OpenCodeServerHandle } from '@/opencodeClient/types'
import { emitEvent } from '@/utils/eventBus'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  agentId?: string
  agentName?: string
  modelId?: string
  modelProviderId?: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  toolName?: string
  officeDownloadFiles?: OfficeDownloadFile[]
  images?: string[]
  files?: Array<{ name: string; content: string }>
  finishReason?: string
  reasoningContent?: string
  isMediaTask?: boolean
  mediaTaskId?: string
  searchResults?: { title: string; url: string; snippet: string }[]
  traceSummary?: RunTraceSummary
  continuationContext?: {
    runtimeSegmentId: string
    runId: string
    contextPlanId: string
  }
  continuationParentId?: string
  isContinuationPrompt?: boolean
  openCodeParts?: OpenCodeRenderablePart[]
  /** Per-turn diffs from the last user message summary (official OpenCode: UserMessage.summary.diffs) */
  summaryDiffs?: OpenCodeDiffFile[]
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ToolProgress {
  toolCallId: string
  name: string
  phase: 'start' | 'executing' | 'result'
  args: string
  result: string | null
  isError: boolean
  startedAtMs: number
  finishedAtMs: number | null
}

export type AgentPhase =
  | 'idle'
  | 'sending'
  | 'thinking'
  | 'tool'
  | 'replying'
  | 'cancelling'
  | 'done'
  | 'error'

export interface SendMessageOptions {
  systemPrompt?: string
  agentId?: string
  agentName?: string
  skillName?: string
  sessionId?: string
  images?: string[]
  files?: Array<{ name: string; content: string }>
  modelId?: string
  modelProviderId?: string
  chatMode?: 'build' | 'plan' | 'direct'
  openCodeAgent?: string
  openCodeTools?: Record<string, boolean>
  openCodeProjectDir?: string
  capabilityTier?: RuntimeCapabilityTier
  connectionSource?: 'plain' | 'manual' | 'superpower' | 'skill' | 'tool'
  _continuationParentId?: string
  _isContinuationPrompt?: boolean
  _parallel?: boolean
  _skipUserMessageInsert?: boolean
}

export type OpenCodeSessionAction =
  | 'new'
  | 'compact'
  | 'undo'
  | 'redo'
  | 'fork'
  | 'share'
  | 'unshare'
  | 'archive'
  | 'delete'
  | 'diff'

export interface OpenCodeDiffFile {
  file?: string
  patch?: string
  additions?: number
  deletions?: number
  status?: string
}

export interface OpenCodeRevertItem {
  id: string
  text: string
}

export interface OpenCodeFollowupItem {
  id: string
  text: string
}

export interface OpenCodeSessionActionResult {
  action: OpenCodeSessionAction
  ok: boolean
  sessionID?: string
  forkedSessionID?: string
  deletedSessionID?: string
  error?: string
}

interface RuntimeContextBaseline {
  agentId?: string | null
  skillContent?: string | null
  openCodeSessionId?: string
}

const messages = ref<ChatMessage[]>([])

// 对齐官方 event-reducer.ts:19 — message.part.updated 跳过这些 part 类型 (D0-002)
const SKIP_PART_UPDATE_TYPES = new Set(['patch', 'step-start', 'step-finish'])
const isStreaming = ref(false)
const abortController = ref<AbortController | null>(null)
const agentPhase = ref<AgentPhase>('idle')
const agentDetail = ref('')
const currentToolProgress = ref<ToolProgress | null>(null)
const toolHistory = ref<ToolProgress[]>([])
const pendingPermissions = ref<OpenCodePermissionRequest[]>([])
const pendingQuestions = ref<OpenCodeQuestionRequest[]>([])
const sessionTodos = ref<OpenCodeTodo[]>([])
const openCodeContextUsage = ref<OpenCodeContextUsage | null>(null)
const sessionDiffs = ref<OpenCodeDiffFile[]>([])
/** Per-turn diffs extracted from the last user message's summary.diffs (official: turnDiffs) */
const turnDiffs = ref<OpenCodeDiffFile[]>([])
/** VCS (git) diff from /vcs/diff endpoint */
const vcsDiffs = ref<OpenCodeDiffFile[]>([])
/** VCS branch diff (mode=branch) */
const vcsBranchDiffs = ref<OpenCodeDiffFile[]>([])
/** VCS info (branch name etc) */
const vcsInfo = ref<{ branch?: string; default_branch?: string } | null>(null)
const sessionCommandNotice = ref('')
const sessionShareUrl = ref('')
const sessionRevertItems = ref<OpenCodeRevertItem[]>([])
const restoringRevertId = ref('')
const sessionFollowups = ref<OpenCodeFollowupItem[]>([])
const sendingFollowupId = ref('')

let activeRunId = 0
let testDeps: Record<string, unknown> | null = null
let activeOpenCodeSessionId = ''
const activeOpenCodeSessionIdRef = ref('')
let activeOpenCodeDirectory = ''
// ponytail: 跟踪 active session 当前模型，切模型时 update session 而非重建（保上下文）
let activeOpenCodeSessionModelId = ''
// 跟踪本地 session ID，变了 = 新建对话 → 清 OpenCode session（防上下文泄露）
let lastLocalSessionId = ''

function setActiveOpenCodeSessionId(sessionId: string) {
  if (sessionId && sessionId !== activeOpenCodeSessionId) {
    // session 切换：清理旧 session 的 pending 权限（approved 规则集保留，对齐官方 session-scoped）
    pendingPermissions.value = []
  }
  if (!sessionId) activeOpenCodeSessionModelId = ''
  activeOpenCodeSessionId = sessionId
  activeOpenCodeSessionIdRef.value = sessionId
}

interface StreamingToolState {
  callId: string
  name: string
  input: string
  startedAtMs: number
}

interface StreamingPartState {
  type: string
  text: string
}


function createMessageId(role: string): string {
  return `${role}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function setPhase(phase: AgentPhase, detail = '') {
  agentPhase.value = phase
  agentDetail.value = detail
}

async function notifyOpenCodeRun(title: string, body: string): Promise<void> {
  try {
    const mod = await import('@tauri-apps/plugin-notification')
    const granted = await mod.isPermissionGranted() || await mod.requestPermission() === 'granted'
    if (granted) mod.sendNotification({ title, body })
  } catch {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }
}

function openCodeSessionActionLabel(action: OpenCodeSessionAction): string {
  const labels: Record<OpenCodeSessionAction, string> = {
    new: '新建会话',
    compact: '压缩上下文',
    undo: '撤销',
    redo: '重做',
    fork: 'Fork',
    share: '分享',
    unshare: '取消分享',
    archive: '归档',
    delete: '删除',
    diff: 'Diff',
  }
  return labels[action] || action
}

function notifyOpenCodeSessionAction(action: OpenCodeSessionAction, ok: boolean, detail = '') {
  const label = openCodeSessionActionLabel(action)
  const title = ok ? `OpenCode ${label}已完成` : `OpenCode ${label}失败`
  void notifyOpenCodeRun(title, detail || (ok ? '命令已完成' : '命令执行失败'))
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function resolveOpenCodeDirectory(handle: OpenCodeServerHandle, projectDir?: string): string {
  return String(handle.directory || projectDir || '').trim()
}

function notifyOpenCodeSlashCommand(command: string, ok: boolean, detail = '') {
  const clean = String(command || '').replace(/[^\w.-]/g, '').slice(0, 40) || 'command'
  void notifyOpenCodeRun(
    ok ? 'OpenCode 命令已完成' : 'OpenCode 命令失败',
    detail || `/${clean} ${ok ? '已完成' : '执行失败'}`,
  )
}

function notifyOpenCodeShellCommand(ok: boolean) {
  void notifyOpenCodeRun(
    ok ? 'OpenCode Shell 已完成' : 'OpenCode Shell 失败',
    ok ? 'Shell 命令已完成' : 'Shell 命令执行失败',
  )
}

function beginRun(): number {
  activeRunId += 1
  return activeRunId
}

function cancelCurrentRun() {
  activeRunId += 1
  abortController.value?.abort()
  abortController.value = null
  isStreaming.value = false
  currentToolProgress.value = null
  // abort 时清理旧 run 的 pending 权限（对齐官方 cancel() → 清理子任务后 set idle）
  pendingPermissions.value = []
}

function resetToolState() {
  toolHistory.value = []
  currentToolProgress.value = null
  // 对齐官方：权限不清空——approved 规则集是 session-scoped，用户决策应保留
  // pendingPermissions 由 permission.replied 事件或 respondPermission 主动清理
  pendingQuestions.value = []
  sessionTodos.value = []
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  if (!item.id) return items
  const next = [...items]
  const index = next.findIndex(existing => existing.id === item.id)
  if (index >= 0) next[index] = item
  else next.push(item)
  return next.sort((a, b) => a.id.localeCompare(b.id))
}

function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter(item => item.id !== id)
}

function applyOpenCodeSessionStatus(properties: Record<string, any>) {
  const status = normalizeOpenCodeSessionStatus(properties)
  if (status === 'busy') {
    setPhase('replying', 'OpenCode 正在运行')
    return
  }
  if (status === 'retry') {
    setPhase('thinking', 'OpenCode 正在重试')
    return
  }
  if (status === 'error') {
    setPhase('error', getOpenCodeRunErrorDetail('session.status', properties))
  }
}

function safeJson(value: unknown, maxLength = 1600): string {
  if (typeof value === 'string') return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
  try {
    const text = JSON.stringify(value ?? {}, null, 2)
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
  } catch {
    return String(value)
  }
}

function chatContentToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item
      if (item?.type === 'text') return String(item.text || '')
      if (item?.type === 'image_url') return '[图片]'
      return safeJson(item, 600)
    }).filter(Boolean).join('\n')
  }
  return safeJson(value, 1200)
}



async function readOpenAiCompatibleStream(response: Response, onText: (text: string) => void): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    const data = await response.json()
    const text = chatContentToText(getAssistantMessageContent(data)).trim()
    onText(text)
    return text
  }
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''
  let streamDone = false
  try {
    while (!streamDone) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw) continue
        if (raw === '[DONE]') {
          streamDone = true
          break
        }
        try {
          const parsed = JSON.parse(raw)
          const delta = String(parsed?.choices?.[0]?.delta?.content || parsed?.choices?.[0]?.delta?.reasoning_content || '')
          if (delta) {
            accumulated += delta
            onText(accumulated)
          }
        } catch {
          // Ignore keep-alive or provider-specific non-JSON stream rows.
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  return accumulated.trim()
}

async function readOllamaChatStream(response: Response, onText: (text: string) => void): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    const data = await response.json()
    const text = String(data?.message?.content || data?.response || '').trim()
    onText(text)
    return text
  }
  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const raw = line.trim()
        if (!raw) continue
        try {
          const parsed = JSON.parse(raw)
          const delta = String(parsed?.message?.content || parsed?.response || '')
          if (delta) {
            accumulated += delta
            onText(accumulated)
          }
          if (parsed?.done) return accumulated.trim()
        } catch {
          // Ollama streams newline-delimited JSON; malformed partial rows are ignored until the next chunk.
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  return accumulated.trim()
}

function appendUniqueToolCall(message: ChatMessage, callId: string, name: string, args: string) {
  const toolCalls = message.toolCalls || []
  const index = toolCalls.findIndex(call => call.id === callId)
  const nextCall: ToolCall = {
    id: callId,
    type: 'function',
    function: { name, arguments: args },
  }
  if (index >= 0) {
    message.toolCalls = toolCalls.map((call, idx) => idx === index ? nextCall : call)
  } else {
    message.toolCalls = [...toolCalls, nextCall]
  }
}

function toolContentSummary(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map((item: any) => {
    if (item?.type === 'text') return item.text || ''
    if (item?.type === 'file') return `[文件] ${item.name || item.mime || safeJson(item.source, 240)}`
    return safeJson(item, 360)
  }).filter(Boolean).join('\n')
}

function resolveToolResultFromState(state: any): string {
  if (!state) return ''
  if (state.status === 'error') return safeJson(state.error || state.result || state.content || '工具执行失败')
  if ('result' in state && state.result !== undefined) return safeJson(state.result)
  if (typeof state.output === 'string' && state.output.trim()) return state.output
  return toolContentSummary(state.content) || (state.structured && Object.keys(state.structured).length ? safeJson(state.structured) : '')
}

function upsertToolResultMessage(assistantId: string, callId: string, name: string, content: string, isError: boolean) {
  const id = `${assistantId}__tool__${callId}`
  const existing = messages.value.find(message => message.id === id)
  if (existing) {
    existing.content = content
    existing.finishReason = isError ? 'tool_error' : 'tool_complete'
    return
  }
  messages.value.push({
    id,
    role: 'tool',
    content,
    timestamp: Date.now(),
    toolCallId: callId,
    toolName: name,
    finishReason: isError ? 'tool_error' : 'tool_complete',
  })
}

  /** Official: extract per-turn diffs from last user message's summary.diffs */
  function extractTurnDiffsFromMessages() {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const msg = messages.value[i]
      if (msg.role === 'user' && msg.summaryDiffs && msg.summaryDiffs.length > 0) {
        turnDiffs.value = msg.summaryDiffs
        return
      }
    }
    // Fall back to session diffs if no per-turn diffs found
    turnDiffs.value = sessionDiffs.value.length > 0 ? sessionDiffs.value : []
  }

function replaceMessagesPreservingPrompt(sessionMessages: ChatMessage[], fallbackMessages: ChatMessage[]) {
  if (!sessionMessages.length) {
    messages.value = fallbackMessages
    return
  }
  messages.value = sessionMessages
  // Extract per-turn diffs from the last user message's summary
  extractTurnDiffsFromMessages()
}

function promptPreview(message: ChatMessage | undefined): string {
  const text = String(message?.content || '').replace(/\s+/g, ' ').trim()
  if (text) return text.slice(0, 120)
  if (message?.files?.length) return `[文件] ${message.files.map(file => file.name).join(', ')}`
  if (message?.images?.length) return `[图片] ${message.images.length} 张`
  return '用户消息'
}

function refreshRevertItems(revertMessageID?: string) {
  if (!revertMessageID) {
    sessionRevertItems.value = []
    return
  }
  const users = messages.value.filter(message => message.role === 'user')
  const startIndex = users.findIndex(message => message.id === revertMessageID)
  const items = (startIndex >= 0 ? users.slice(startIndex) : [])
    .map(message => ({ id: message.id, text: promptPreview(message) }))
  sessionRevertItems.value = items
}

function nextUserMessageIdAfter(messageID: string): string | undefined {
  const users = messages.value.filter(message => message.role === 'user')
  const index = users.findIndex(message => message.id === messageID)
  return index >= 0 ? users[index + 1]?.id : undefined
}

function refreshRevertItemsAfterRestored(restoredMessageID: string) {
  refreshRevertItems(nextUserMessageIdAfter(restoredMessageID))
}

async function restoreOpenCodeRevertBoundary(
  client: ReturnType<typeof createJiucaiOpenCodeClient>,
  location: { sessionID: string; directory?: string },
  restoreMessageID: string,
) {
  if (!restoreMessageID) {
    await unrevertOpenCodeSession(client, location)
    return
  }
  const nextMessageID = nextUserMessageIdAfter(restoreMessageID)
  if (nextMessageID) await revertOpenCodeSessionMessage(client, { ...location, messageID: nextMessageID })
  else await unrevertOpenCodeSession(client, location)
}

function addFollowup(text: string) {
  const clean = String(text || '').trim()
  if (!clean) return
  if (sessionFollowups.value.some(item => item.text === clean)) return
  sessionFollowups.value = [
    ...sessionFollowups.value,
    { id: createMessageId('followup'), text: clean },
  ].slice(-5)
}

function applyTextPartToMessage(message: ChatMessage, partId: string, text: string, partStates: Map<string, StreamingPartState>) {
  const previous = partStates.get(partId)
  if (!previous) {
    partStates.set(partId, { type: 'text', text })
    message.content += text
    return
  }
  if (previous.type !== 'text') {
    previous.type = 'text'
    previous.text = text
    message.content += text
    return
  }
  if (text === previous.text) return
  if (text.startsWith(previous.text)) {
    message.content += text.slice(previous.text.length)
  } else {
    const index = message.content.lastIndexOf(previous.text)
    message.content = index >= 0
      ? `${message.content.slice(0, index)}${text}${message.content.slice(index + previous.text.length)}`
      : `${message.content}${text}`
  }
  previous.text = text
}

function applyReasoningPartToMessage(message: ChatMessage, partId: string, text: string, partStates: Map<string, StreamingPartState>) {
  const previous = partStates.get(partId)
  if (!previous || previous.type !== 'reasoning') {
    partStates.set(partId, { type: 'reasoning', text })
    message.reasoningContent = `${message.reasoningContent || ''}${text}`
    return
  }
  if (text === previous.text) return
  if (text.startsWith(previous.text)) {
    message.reasoningContent = `${message.reasoningContent || ''}${text.slice(previous.text.length)}`
  } else {
    message.reasoningContent = text
  }
  previous.text = text
}

function openCodeMessageRole(info: any): ChatMessage['role'] | '' {
  const kind = String(info?.role || info?.type || '')
  if (kind === 'assistant') return 'assistant'
  if (kind === 'user') return 'user'
  if (kind === 'system') return 'system'
  if (kind === 'tool' || kind === 'shell') return 'tool'
  return ''
}

export function __setUseChatTestDeps(deps: Record<string, unknown> | null): void {
  const env = (import.meta as any).env
  const nodeEnv = (globalThis as any).process?.env
  const allowed = Boolean(env?.DEV || env?.VITEST || nodeEnv?.NODE_ENV === 'test' || nodeEnv?.VITEST)
  if (!allowed) throw new Error('__setUseChatTestDeps is only available in dev/test builds')
  testDeps = deps
}

export function __getUseChatTestDeps(): Record<string, unknown> | null {
  return testDeps
}

export function useChat() {
  async function getActiveOpenCodeClient(projectDir?: string) {
    const agentStore = useAgentStore()
    const requestedDir = projectDir || activeOpenCodeDirectory
    const projectedConfig = await projectStoredNewApiForOpenCode({
      currentModel: agentStore.currentModel,
      models: agentStore.availableModels,
    })
    const handle = await ensureOpenCodeServer({ config: projectedConfig, directory: requestedDir || undefined })
    const effectiveDir = resolveOpenCodeDirectory(handle, requestedDir)
    activeOpenCodeDirectory = effectiveDir
    return createJiucaiOpenCodeClient(handle, effectiveDir || undefined)
  }

  // ─── 权限系统（对齐官方 OpenCode） ───
  // 官方模型：always 回复 → approved 规则集（session-scoped 内存，重启失效）
  // 官方 App 端：binary autoAccept toggle → 自动回复 once
  const approvedPermissions = ref<Array<{ permission: string; pattern: string; action: 'allow' | 'deny' }>>([])
  const autoAcceptPermissions = ref(false)

  function matchApprovedPermission(permission: string, patterns: string[], action: 'allow' | 'deny'): boolean {
    // 对齐官方 evaluate()：last-match-wins，在 approved 规则集中查找指定 action
    return patterns.some(pattern =>
      approvedPermissions.value.some(
        rule => rule.action === action &&
          wildcardMatch(rule.permission, permission) &&
          wildcardMatch(rule.pattern, pattern)
      )
    )
  }

  function wildcardMatch(pattern: string, value: string): boolean {
    if (pattern === '*' || pattern === value) return true
    if (pattern.endsWith('*') && value.startsWith(pattern.slice(0, -1))) return true
    return false
  }

  async function respondPermission(requestID: string, reply: OpenCodePermissionReply) {
    if (!activeOpenCodeSessionId) return
    const request = pendingPermissions.value.find(item => item.id === requestID)
    // 对齐官方：规则同步写入（在 await 之前），避免快速连续 permission.asked 的竞态
    if ((reply === 'always' || reply === 'reject') && request) {
      for (const pattern of request.patterns) {
        approvedPermissions.value.push({
          permission: request.permission,
          pattern,
          action: reply === 'always' ? 'allow' : 'deny',
        })
      }
    }
    pendingPermissions.value = removeById(pendingPermissions.value, requestID)
    try {
      const client = await getActiveOpenCodeClient()
      await replyOpenCodePermission(client, {
        sessionID: request?.sessionID || activeOpenCodeSessionId,
        requestID,
        reply,
        directory: activeOpenCodeDirectory,
      })
      sessionCommandNotice.value = ''
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      sessionCommandNotice.value = `OpenCode 权限回复失败：${detail}`
    }
  }

  async function replyQuestion(requestID: string, answers: string[][]) {
    if (!activeOpenCodeSessionId) return
    const request = pendingQuestions.value.find(item => item.id === requestID)
    const client = await getActiveOpenCodeClient()
    await replyOpenCodeQuestion(client, {
      sessionID: request?.sessionID || activeOpenCodeSessionId,
      requestID,
      answers,
      directory: activeOpenCodeDirectory,
    })
    pendingQuestions.value = removeById(pendingQuestions.value, requestID)
  }

  async function rejectQuestion(requestID: string) {
    if (!activeOpenCodeSessionId) return
    const request = pendingQuestions.value.find(item => item.id === requestID)
    const client = await getActiveOpenCodeClient()
    await rejectOpenCodeQuestion(client, {
      sessionID: request?.sessionID || activeOpenCodeSessionId,
      requestID,
      directory: activeOpenCodeDirectory,
    })
    pendingQuestions.value = removeById(pendingQuestions.value, requestID)
  }

  async function ensureOpenCodeCommandSession(options: SendMessageOptions = {}) {
    const agentStore = useAgentStore()
    const projectedConfig = await projectStoredNewApiForOpenCode({
      currentModel: options.modelId || agentStore.currentModel,
      models: agentStore.availableModels,
    })
    const projectDir = options.openCodeProjectDir || ''
    const handle = await ensureOpenCodeServer({ config: projectedConfig, directory: projectDir || undefined })
    const effectiveDir = resolveOpenCodeDirectory(handle, projectDir)
    if (activeOpenCodeDirectory && effectiveDir !== activeOpenCodeDirectory) {
      setActiveOpenCodeSessionId('')
    }
    activeOpenCodeDirectory = effectiveDir
    const client = createJiucaiOpenCodeClient(handle, effectiveDir || undefined)
    const modelId = options.modelId || agentStore.currentModel
    const model = toOpenCodeModelProjection(modelId)
    if (!activeOpenCodeSessionId) {
      const session = await createOpenCodeSession(client, {
        directory: effectiveDir,
        title: 'OpenCode 命令',
        agent: options.openCodeAgent,
        model,
        metadata: {
          jiucaiheziSessionId: options.sessionId,
          jiucaiheziAgentId: options.agentId,
        },
      }) as { id?: string }
      setActiveOpenCodeSessionId(String(session.id || ''))
    }
    if (!activeOpenCodeSessionId) throw new Error('OpenCode session 创建失败。')
    return { client, handle, sessionID: activeOpenCodeSessionId, model, effectiveDir }
  }

  async function syncAfterCommand(client: Awaited<ReturnType<typeof ensureOpenCodeCommandSession>>['client']) {
    if (!activeOpenCodeSessionId) return
    const agentStore = useAgentStore()
    const nextMessages = await listOpenCodeChatMessages(client, activeOpenCodeSessionId, { directory: activeOpenCodeDirectory })
    replaceMessagesPreservingPrompt(nextMessages, messages.value)
    invalidateOpenCodeSessionContextUsage(activeOpenCodeSessionId)
    openCodeContextUsage.value = await getOpenCodeSessionContextUsage(
      client,
      activeOpenCodeSessionId,
      agentStore.availableModels,
      { directory: activeOpenCodeDirectory },
    )
  }

  async function waitForOpenCodeCompactionSync(
    client: Awaited<ReturnType<typeof ensureOpenCodeCommandSession>>['client'],
    sessionID: string,
    beforeUsage: OpenCodeContextUsage | null,
  ): Promise<{ usage: OpenCodeContextUsage; messages: ChatMessage[]; confirmed: boolean }> {
    const agentStore = useAgentStore()
    let latestUsage: OpenCodeContextUsage | null = null
    let latestMessages: ChatMessage[] = []
    const deadline = Date.now() + 8_000
    while (Date.now() < deadline) {
      invalidateOpenCodeSessionContextUsage(sessionID)
      latestUsage = await getOpenCodeSessionContextUsage(client, sessionID, agentStore.availableModels, { directory: activeOpenCodeDirectory })
      latestMessages = await listOpenCodeChatMessages(client, sessionID, { directory: activeOpenCodeDirectory })
      const usageDropped = beforeUsage
        ? latestUsage.messageCount < beforeUsage.messageCount || latestUsage.total < beforeUsage.total
        : latestUsage.messageCount > 0
      if (usageDropped) {
        return { usage: latestUsage, messages: latestMessages, confirmed: true }
      }
      await delay(400)
    }
    if (!latestUsage) {
      invalidateOpenCodeSessionContextUsage(sessionID)
      latestUsage = await getOpenCodeSessionContextUsage(client, sessionID, agentStore.availableModels, { directory: activeOpenCodeDirectory })
    }
    if (!latestMessages.length) latestMessages = await listOpenCodeChatMessages(client, sessionID, { directory: activeOpenCodeDirectory })
    return { usage: latestUsage, messages: latestMessages, confirmed: false }
  }

  function isLocalGeneratedMessageId(id: string): boolean {
    return /^(user|assistant|system|tool)_[a-z0-9]+_[a-z0-9]+$/i.test(id)
  }

  async function latestOpenCodeUserMessageId(client?: Awaited<ReturnType<typeof ensureOpenCodeCommandSession>>['client']): Promise<string> {
    if (client && activeOpenCodeSessionId) {
      try {
        const nextMessages = await listOpenCodeChatMessages(client, activeOpenCodeSessionId, { directory: activeOpenCodeDirectory })
        replaceMessagesPreservingPrompt(nextMessages, messages.value)
      } catch {
        // Fall back to the current local projection; the guard below still rejects local ids.
      }
    }
    for (let index = messages.value.length - 1; index >= 0; index -= 1) {
      const message = messages.value[index]
      if (message.role === 'user' && message.id && !isLocalGeneratedMessageId(message.id)) return message.id
    }
    return ''
  }

  function resetActiveOpenCodeSessionState() {
    setActiveOpenCodeSessionId('')
    openCodeContextUsage.value = null
    sessionDiffs.value = []
    turnDiffs.value = []
    vcsDiffs.value = []
    vcsBranchDiffs.value = []
    vcsInfo.value = null
    sessionShareUrl.value = ''
    sessionRevertItems.value = []
    sessionFollowups.value = []
    resetToolState()
  }

  async function runOpenCodeSessionAction(action: OpenCodeSessionAction, options: SendMessageOptions = {}): Promise<OpenCodeSessionActionResult> {
    if (action === 'compact' && (
      !activeOpenCodeSessionId
      || !messages.value.some(message => message.role !== 'system')
    )) {
      const detail = '当前没有可压缩的 OpenCode 上下文。'
      sessionCommandNotice.value = detail
      sessionShareUrl.value = ''
      return { action, ok: false, error: detail }
    }
    try {
      isStreaming.value = true
      sessionCommandNotice.value = ''
      sessionShareUrl.value = ''
      if (action === 'new') {
        cancelCurrentRun()
        messages.value = []
        resetActiveOpenCodeSessionState()
        sessionCommandNotice.value = '已新建 OpenCode 会话'
        setPhase('idle')
        notifyOpenCodeSessionAction(action, true, sessionCommandNotice.value)
        return { action, ok: true }
      }
      const { client, sessionID, effectiveDir } = await ensureOpenCodeCommandSession(options)
      const location = { directory: effectiveDir }
      if (action === 'fork') {
        const forked = await forkOpenCodeSession(client, { sessionID, ...location }) as any
        const forkedSessionID = String(forked?.id || '')
        if (!forkedSessionID) throw new Error('OpenCode fork 没有返回新会话 ID。')
        setActiveOpenCodeSessionId(forkedSessionID)
        await syncAfterCommand(client)
        sessionCommandNotice.value = `已 fork：${forkedSessionID}`
        notifyOpenCodeSessionAction(action, true, sessionCommandNotice.value)
        return { action, ok: true, sessionID, forkedSessionID }
      } else if (action === 'compact') {
        const agentStore = useAgentStore()
        invalidateOpenCodeSessionContextUsage(sessionID)
        const beforeUsage = await getOpenCodeSessionContextUsage(client, sessionID, agentStore.availableModels, { directory: effectiveDir })
        await compactOpenCodeSession(client, {
          sessionID,
          directory: effectiveDir,
        })
        await waitOpenCodeSessionIdle(client, { sessionID, directory: effectiveDir })
        const compactSync = await waitForOpenCodeCompactionSync(client, sessionID, beforeUsage)
        replaceMessagesPreservingPrompt(compactSync.messages, messages.value)
        openCodeContextUsage.value = compactSync.usage
        sessionCommandNotice.value = compactSync.confirmed
          ? 'OpenCode 上下文已压缩'
          : '已发起 OpenCode 上下文压缩，等待官方上下文同步'
        if (compactSync.confirmed) notifyOpenCodeSessionAction(action, true, sessionCommandNotice.value)
        else void notifyOpenCodeRun('OpenCode 压缩上下文等待同步', sessionCommandNotice.value)
        return { action, ok: true, sessionID }
      } else if (action === 'undo') {
        const messageID = await latestOpenCodeUserMessageId(client)
        if (!messageID) throw new Error('没有可撤销的 OpenCode 用户消息。')
        await revertOpenCodeSessionMessage(client, { sessionID, ...location, messageID })
        sessionCommandNotice.value = '已撤销上轮'
        await syncAfterCommand(client)
        refreshRevertItems(messageID)
        notifyOpenCodeSessionAction(action, true, sessionCommandNotice.value)
        return { action, ok: true, sessionID }
      } else if (action === 'redo') {
        restoringRevertId.value = sessionRevertItems.value[0]?.id || ''
        const restoreMessageID = sessionRevertItems.value[0]?.id || ''
        await restoreOpenCodeRevertBoundary(client, { sessionID, ...location }, restoreMessageID)
        sessionCommandNotice.value = '已重做上轮'
        await syncAfterCommand(client)
        if (restoreMessageID) refreshRevertItemsAfterRestored(restoreMessageID)
        else refreshRevertItems()
        restoringRevertId.value = ''
        notifyOpenCodeSessionAction(action, true, sessionCommandNotice.value)
        return { action, ok: true, sessionID }
      } else if (action === 'share') {
        const shared = await shareOpenCodeSession(client, { sessionID, ...location }) as any
        sessionShareUrl.value = shared?.share?.url || ''
        sessionCommandNotice.value = sessionShareUrl.value ? '已生成分享链接' : 'OpenCode 已完成分享请求'
        notifyOpenCodeSessionAction(action, true, sessionCommandNotice.value)
        return { action, ok: true, sessionID }
      } else if (action === 'unshare') {
        await unshareOpenCodeSession(client, { sessionID, ...location })
        sessionShareUrl.value = ''
        sessionCommandNotice.value = '已取消分享'
        notifyOpenCodeSessionAction(action, true, sessionCommandNotice.value)
        return { action, ok: true, sessionID }
      } else if (action === 'archive') {
        await archiveOpenCodeSession(client, { sessionID, ...location })
        sessionCommandNotice.value = '已归档 OpenCode 会话'
        notifyOpenCodeSessionAction(action, true, sessionCommandNotice.value)
        return { action, ok: true, sessionID }
      } else if (action === 'delete') {
        await deleteOpenCodeSession(client, { sessionID, ...location })
        resetActiveOpenCodeSessionState()
        sessionCommandNotice.value = '已删除 OpenCode 会话'
        messages.value = []
        notifyOpenCodeSessionAction(action, true, sessionCommandNotice.value)
        return { action, ok: true, sessionID, deletedSessionID: sessionID }
      } else if (action === 'diff') {
        sessionDiffs.value = await listOpenCodeSessionDiff(client, { sessionID, ...location })
        sessionCommandNotice.value = sessionDiffs.value.length ? '已拉取 OpenCode diff' : '当前没有文件变更'
        notifyOpenCodeSessionAction(action, true, sessionCommandNotice.value)
        return { action, ok: true, sessionID }
      }
    } catch (error: any) {
      const detail = error?.message || String(error)
      sessionCommandNotice.value = detail
      setPhase('error', detail)
      restoringRevertId.value = ''
      notifyOpenCodeSessionAction(action, false, detail)
      return { action, ok: false, error: detail }
    } finally {
      isStreaming.value = false
    }
    return { action, ok: true }
  }

  /** Official: auto-fetch session diffs when Review Panel opens (sync().session.diff(id)) */
  async function fetchSessionDiffs() {
    if (!activeOpenCodeSessionId) return
    try {
      const { client, sessionID, effectiveDir } = await ensureOpenCodeCommandSession({})
      const diffs = await listOpenCodeSessionDiff(client, { sessionID, directory: effectiveDir })
      sessionDiffs.value = diffs
      // Also extract turn-level diffs from the last user message
      extractTurnDiffsFromMessages()
      return diffs
    } catch {
      // Silently fail; diffs may not be available yet
    }
    return []
  }

  /** Official: fetch VCS (git) info + diffs via v2 SDK (vcs.get + vcs.diff) */
  async function fetchVcsInfo() {
    try {
      const { client, effectiveDir } = await ensureOpenCodeCommandSession({})
      // Fetch branch info (independent from diff)
      try {
        const result = await (client as any).vcs?.get()
        if (result?.data) {
          vcsInfo.value = { branch: result.data.branch, default_branch: result.data.default_branch }
        }
      } catch {
        vcsInfo.value = null
      }
      // Fetch git working tree diff + branch diff
      try {
        const [gitDiffs, branchDiffs] = await Promise.all([
          fetchOpenCodeVcsDiff(client, { directory: effectiveDir, mode: 'git', context: 3 }),
          fetchOpenCodeVcsDiff(client, { directory: effectiveDir, mode: 'branch', context: 3 }),
        ])
        vcsDiffs.value = gitDiffs
        vcsBranchDiffs.value = branchDiffs
      } catch {
        vcsDiffs.value = []
        vcsBranchDiffs.value = []
      }
    } catch {
      // ensureOpenCodeCommandSession failed — reset all
      vcsInfo.value = null
      vcsDiffs.value = []
      vcsBranchDiffs.value = []
    }
  }

  async function runSlashCommand(text: string, options: SendMessageOptions = {}) {
    const raw = String(text || '').trim()
    if (!raw.startsWith('/')) return
    const [command = '', ...rest] = raw.slice(1).split(/\s+/)
    if (!command) return
    try {
      isStreaming.value = true
      setPhase('sending', `/${command}`)
      const { client, sessionID, effectiveDir } = await ensureOpenCodeCommandSession(options)
      await runOpenCodeSlashCommand(client, {
        sessionID,
        directory: effectiveDir,
        command,
        arguments: rest.join(' '),
        agent: options.openCodeAgent,
        model: options.modelId,
      })
      await syncAfterCommand(client)
      setPhase('done')
      notifyOpenCodeSlashCommand(command, true)
    } catch (error: any) {
      const detail = error?.message || String(error)
      sessionCommandNotice.value = detail
      setPhase('error', detail)
      notifyOpenCodeSlashCommand(command, false, detail)
    } finally {
      isStreaming.value = false
    }
  }

  async function runShellCommand(command: string, options: SendMessageOptions = {}) {
    const raw = String(command || '').trim()
    if (!raw) return
    try {
      isStreaming.value = true
      setPhase('tool', 'shell')
      const { client, sessionID, model, effectiveDir } = await ensureOpenCodeCommandSession(options)
      await runOpenCodeShellCommand(client, {
        sessionID,
        directory: effectiveDir,
        command: raw,
        agent: options.openCodeAgent,
        model,
      })
      await syncAfterCommand(client)
      setPhase('done')
      notifyOpenCodeShellCommand(true)
    } catch (error: any) {
      const detail = error?.message || String(error)
      sessionCommandNotice.value = detail
      setPhase('error', detail)
      notifyOpenCodeShellCommand(false)
    } finally {
      isStreaming.value = false
    }
  }

  async function restoreRevertItem(itemId: string, options: SendMessageOptions = {}) {
    if (!itemId) return
    restoringRevertId.value = itemId
    try {
      isStreaming.value = true
      sessionCommandNotice.value = ''
      const { client, sessionID, effectiveDir } = await ensureOpenCodeCommandSession(options)
      await restoreOpenCodeRevertBoundary(client, { sessionID, directory: effectiveDir }, itemId)
      sessionCommandNotice.value = '已恢复 Revert 项'
      await syncAfterCommand(client)
      refreshRevertItemsAfterRestored(itemId)
    } catch (error: any) {
      const detail = error?.message || String(error)
      sessionCommandNotice.value = detail
      setPhase('error', detail)
    } finally {
      restoringRevertId.value = ''
      isStreaming.value = false
    }
  }

  async function sendFollowup(itemId: string, options: SendMessageOptions = {}) {
    const item = sessionFollowups.value.find(entry => entry.id === itemId)
    if (!item || sendingFollowupId.value) return
    sendingFollowupId.value = itemId
    try {
      sessionFollowups.value = sessionFollowups.value.filter(entry => entry.id !== itemId)
      await sendMessage(item.text, options)
    } finally {
      sendingFollowupId.value = ''
    }
  }

  function editFollowup(itemId: string): string {
    const item = sessionFollowups.value.find(entry => entry.id === itemId)
    if (!item) return ''
    sessionFollowups.value = sessionFollowups.value.filter(entry => entry.id !== itemId)
    return item.text
  }

  async function sendDirectLocalModelMessage(
    options: SendMessageOptions,
    runId: number,
    controller: AbortController,
  ) {
    const agentStore = useAgentStore()
    const selectedSkill = options.agentId ? agentStore.getSkillById(options.agentId) : null
    const skillName = selectedSkill?.name || options.skillName || options.agentName || ''
    const assistantMsg: ChatMessage = {
      id: createMessageId('assistant'),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      agentId: options.agentId,
      agentName: options.agentName || skillName,
      reasoningContent: '',
      continuationParentId: options._continuationParentId,
    }
    let localAssistantMsg: ChatMessage = assistantMsg

    try {
      setPhase('thinking', '正在连接本地模型')
      const modelId = options.modelId || agentStore.currentModel
      const providerId = options.modelProviderId
        || localStorage.getItem('jcModelProviderId')
        || resolveModelProviderId(agentStore.availableModels.find(model => model.id === modelId) || modelId)
      const config = await resolveApiConfig({
        modelId,
        modelProviderId: providerId,
        startLocal: true,
      })
      if (!isLocalModelProviderId(config.providerId)) throw new Error('当前选择的不是本地模型。')
      if (runId !== activeRunId || controller.signal.aborted) return

      const isOllama = config.providerId === 'local-ollama'
      const apiMessages = buildDirectMessages({
        messages: messages.value,
        images: options.images,
        files: options.files,
        visionModel: isOllama || supportsVision(config.model),
        apiFormat: isOllama ? 'ollama' as const : 'openai' as const,
        platform: 'desktop',
      })
      messages.value.push(assistantMsg)
      localAssistantMsg = messages.value[messages.value.length - 1]
      setPhase('replying', '本地模型正在回复')
      const body: any = {
        model: config.model,
        messages: apiMessages,
        stream: true,
        keep_alive: '10m',
      }
      if (isOllama && options.images?.length) {
        body.images = options.images.map(u => u.replace(/^data:image\/[^;]+;base64,/, ''))
      }
      const response = await fetch(isOllama ? `${config.apiBase.replace(/\/+$/, '')}/api/chat` : `${config.apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: isOllama ? { 'Content-Type': 'application/json' } : buildHeaders(config),
        signal: controller.signal,
        body: JSON.stringify(isOllama
          ? body
          : {
              model: config.model,
              messages: apiMessages,
              temperature: 0.3,
              stream: true,
              ...buildChatCompletionExtras(config),
            }),
      })
      if (!response.ok) {
        const payload = await response.text().catch(() => '')
        throw new Error(`${isOllama ? 'Ollama' : '本地模型'}请求失败：HTTP ${response.status} ${payload.slice(0, 180)}`)
      }

      const finalText = isOllama
        ? await readOllamaChatStream(response, text => { localAssistantMsg.content = text })
        : await readOpenAiCompatibleStream(response, text => { localAssistantMsg.content = text })
      if (runId !== activeRunId || controller.signal.aborted) return
      localAssistantMsg.content = finalText || localAssistantMsg.content || '本地模型没有返回内容。'
      localAssistantMsg.finishReason = 'stop'
      setPhase('done')
    } catch (error) {
      if (runId !== activeRunId) return
      if (controller.signal.aborted) {
        localAssistantMsg.finishReason = 'abort'
        setPhase('idle')
        return
      }
      const detail = error instanceof Error ? error.message : String(error)
      localAssistantMsg.content = `本地模型对话失败：${detail}`
      localAssistantMsg.finishReason = 'local_model_error'
      setPhase('error', detail)
    } finally {
      if (runId === activeRunId) {
        isStreaming.value = false
        abortController.value = null
        currentToolProgress.value = null
      }
    }
  }

  async function sendDesktopDirectCloudMessage(
    options: SendMessageOptions,
    runId: number,
    controller: AbortController,
  ) {
    const agentStore = useAgentStore()
    const selectedSkill = options.agentId ? agentStore.getSkillById(options.agentId) : null
    const skillName = selectedSkill?.name || options.skillName || options.agentName || ''
    const assistantMsg: ChatMessage = {
      id: createMessageId('assistant'),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      agentId: options.agentId,
      agentName: options.agentName || skillName,
      reasoningContent: '',
      continuationParentId: options._continuationParentId,
    }
    let directAssistantMsg: ChatMessage = assistantMsg

    let config: Awaited<ReturnType<typeof resolveApiConfig>> | undefined
    try {
      setPhase('thinking', '正在连接直连模型')
      const modelId = options.modelId || agentStore.currentModel
      const providerId = options.modelProviderId
        || localStorage.getItem('jcModelProviderId')
        || resolveModelProviderId(agentStore.availableModels.find(model => model.id === modelId) || modelId)
      config = await resolveApiConfig({
        modelId,
        modelProviderId: providerId,
        forceCloud: true,
      })
      if (runId !== activeRunId || controller.signal.aborted) return
      if (!config) throw new Error('resolveApiConfig 返回了 undefined')
      const cfg = config

      const visionModel = supportsVision(cfg.model)
      console.log('[JC] direct send: images=', options.images?.length, 'model=', cfg.model, 'vision=', visionModel)
      const skillPrompt = await resolveWebSkillSystemPrompt(
        skillName,
        [...agentStore.loadSkills(), ...agentStore.getPresetSkills()],
      )
      const apiMessages = buildDirectMessages({
        messages: messages.value,
        systemPrompt: options.systemPrompt,
        skillSystemPrompt: skillPrompt,
        images: options.images,
        files: options.files,
        visionModel,
        apiFormat: 'openai',
        platform: 'desktop',
      })
      // builder 之后 push assistant
      messages.value.push(assistantMsg)
      directAssistantMsg = messages.value[messages.value.length - 1]

      const lastApiMsg = apiMessages[apiMessages.length - 1]
      const lastContent = lastApiMsg?.content
      console.log('[JC] builder last msg role=', lastApiMsg?.role, 'isArray=', Array.isArray(lastContent), 'parts=', Array.isArray(lastContent) ? (lastContent as any[]).length : 'string', 'first60=', typeof lastContent === 'string' ? lastContent.slice(0, 60) : JSON.stringify(lastContent).slice(0, 120))
      const bodyPayload = {
        model: cfg.model,
        messages: apiMessages,
        temperature: 0.3,
        stream: true,
        // ponytail: omit max_tokens so long-form writing can use provider defaults.
        ...buildChatCompletionExtras(cfg),
      }
      const sendChatCompletion = async (request: DirectChatCompletionRequest): Promise<Response> => {
        const response = await fetch(`${cfg.apiBase}/v1/chat/completions`, {
          method: 'POST',
          headers: buildHeaders(cfg),
          signal: controller.signal,
          body: JSON.stringify({
            ...bodyPayload,
            messages: request.messages,
            ...(request.tools?.length ? { tools: request.tools } : {}),
          }),
        })
        if (!response.ok) {
          const payload = await response.text().catch(() => '')
          throw new Error(`直连模型请求失败：HTTP ${response.status} ${payload.slice(0, 180)}`)
        }
        return response
      }

      setPhase('replying', '直连模型正在回复')
      // ponytail: 流中断（error decoding response body 等 reqwest 错误）自动重试 1 次
      let lastError: unknown = null
      let directResult: Awaited<ReturnType<typeof runDirectChatCompletion>> | null = null
      for (let attempt = 0; attempt < 2; attempt++) {
        if (runId !== activeRunId || controller.signal.aborted) return
        try {
          directResult = await runDirectChatCompletion({
            messages: apiMessages,
            onText: text => {
              if (runId === activeRunId) directAssistantMsg.content = text
            },
            sendChatCompletion,
            runWebSearch: async () => 'Web search is not enabled in desktop direct mode',
          })
          break // 成功，退出重试循环
        } catch (err) {
          lastError = err
          if (runId !== activeRunId || controller.signal.aborted) return
          // 只对网络/流错误重试，HTTP 4xx/5xx 不重试
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('HTTP') && !msg.includes('解码') && !msg.includes('decoding') && !msg.includes('读取流失败')) {
            throw err // HTTP 错误直接抛
          }
          if (attempt === 0) {
            console.warn('[JC:direct] 流中断，正在重试（1/2）:', msg.slice(0, 120))
            // 重置 assistant 消息内容准备重试
            directAssistantMsg.content = ''
            continue
          }
          throw err // 第二次也失败，抛出
        }
      }
      if (!directResult) throw lastError || new Error('直连模型返回为空')
      if (runId !== activeRunId || controller.signal.aborted) return
      directAssistantMsg.content = directResult.text || directAssistantMsg.content || '直连模型没有返回内容，请检查网络连接或切换模型后重试。'
      directAssistantMsg.finishReason = 'stop'
      setPhase('done')
    } catch (error) {
      if (runId !== activeRunId) return
      if (controller.signal.aborted) {
        directAssistantMsg.finishReason = 'abort'
        setPhase('idle')
        return
      }
      const detail = error instanceof Error ? error.message : String(error)
      directAssistantMsg.content = `桌面直连对话失败：${detail}`
      directAssistantMsg.finishReason = 'desktop_direct_error'
      setPhase('error', detail)
    } finally {
      if (runId === activeRunId) {
        isStreaming.value = false
        abortController.value = null
        currentToolProgress.value = null
      }
    }
  }

  async function sendMessage(userText: string, options: SendMessageOptions = {}) {
    const text = String(userText || '').trim()
    const hasAttachments = Boolean(options.images?.length || options.files?.length)
    if ((!text && !hasAttachments) || (isStreaming.value && !options._parallel)) return

    const runId = beginRun()
    resetToolState()
    setPhase('sending')

    // 云端附件必须是纯字符串（data: url / 文本内容），否则 IDB clone 失败
    if (options.images?.length) {
      options.images = options.images.map((img: any) => typeof img === 'string' ? img : (img?.data || String(img || '')))
    }
    if (options.files?.length) {
      options.files = options.files.map((f: any) => ({
        name: String(f.name || f.fileName || 'file'),
        content: typeof f.content === 'string' ? f.content : (f.content ? String(f.content) : '')
      }))
    }

    if (!options._skipUserMessageInsert) {
      const userMsg: ChatMessage = {
        id: createMessageId('user'),
        role: 'user',
        content: text,
        timestamp: Date.now(),
        agentId: options.agentId,
        agentName: options.openCodeAgent || options.agentName,
        modelId: options.modelId,
        modelProviderId: options.modelProviderId,
        openCodeParts: buildOpenCodePromptParts({
          text,
          agent: options.openCodeAgent,
          images: options.images,
          files: options.files,
        }) as OpenCodeRenderablePart[],
        images: options.images,
        files: options.files,
        isContinuationPrompt: options._isContinuationPrompt,
        continuationParentId: options._continuationParentId,
      }
      messages.value.push(userMsg)
    }

    const controller = new AbortController()
    abortController.value = controller
    isStreaming.value = true
    if (!isTauriRuntime()) {
      console.log('[JC:cloud] sendMessage 进入云端路径, text:', text.substring(0, 50))
      let sessionId = ''
      try {
        sessionId = String(options.sessionId || '').trim() || ensureCloudConversation(text)
        console.log('[JC:cloud] ensureCloudConversation 返回 sessionId:', sessionId)
        const assistantMsg: ChatMessage = {
          id: createMessageId('assistant'),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          agentId: options.agentId,
          agentName: options.agentName || '',
          reasoningContent: '',
          continuationParentId: options._continuationParentId,
        }
        await sendWebCloudMessage(options, runId, controller, assistantMsg, setPhase, activeRunId, messages.value)
      } finally {
        isStreaming.value = false
        abortController.value = null
        currentToolProgress.value = null
      }
      await saveCloudSnapshot(sessionId, messages.value)
      return
    }
    const agentStore = useAgentStore()
    const selectedModelId = options.modelId || agentStore.currentModel
    const selectedModel = agentStore.availableModels.find(model => model.id === selectedModelId) || selectedModelId
    const selectedProviderId = options.modelProviderId || localStorage.getItem('jcModelProviderId') || resolveModelProviderId(selectedModel)
    if (isLocalModelProviderId(selectedProviderId)) {
      await sendDirectLocalModelMessage(options, runId, controller)
      return
    }
    if (options.chatMode === 'direct') {
      await sendDesktopDirectCloudMessage(options, runId, controller)
      return
    }
    try {
      setPhase('thinking', '正在连接 OpenCode')
      const selectedSkill = options.agentId ? agentStore.getSkillById(options.agentId) : null
      const openCodeSkillName = selectedSkill?.name || options.skillName
      const systemPrompt = [
        options.systemPrompt,
        buildFixedSkillSystemInstruction(openCodeSkillName),
      ].filter(Boolean).join('\n\n')
      const projectedConfig = await projectStoredNewApiForOpenCode({
        currentModel: options.modelId || agentStore.currentModel,
        models: agentStore.availableModels,
      })
      const projectDir = options.openCodeProjectDir || ''
      const handle = await ensureOpenCodeServer({ config: projectedConfig, directory: projectDir || undefined })
      const effectiveDir = resolveOpenCodeDirectory(handle, projectDir)
      // ─── debug: 三层隔离追踪 ───
      console.warn('[隔离] projectDir=', projectDir, 'effectiveDir=', effectiveDir,
        'activeOpenCodeDirectory=', activeOpenCodeDirectory,
        'activeOpenCodeSessionId=', activeOpenCodeSessionId,
        'lastLocalSessionId=', lastLocalSessionId,
        'options.sessionId=', options.sessionId)
      if (activeOpenCodeDirectory && effectiveDir !== activeOpenCodeDirectory) {
        console.warn('[隔离] 目录变化 → 清 activeOpenCodeSessionId')
        setActiveOpenCodeSessionId('')
      }
      activeOpenCodeDirectory = effectiveDir
      const client = createJiucaiOpenCodeClient(handle, effectiveDir || undefined)
      const modelId = options.modelId || agentStore.currentModel
      const model = toOpenCodeModelProjection(modelId)
      const promptText = text
      const permission = buildSkillPermissionScope({ skillName: openCodeSkillName }) || []
      // ponytail: 本地 session（数据库 ID）变了 = 用户点了"新对话" → 清 OpenCode session
      const localSessionId = String(options.sessionId || '')
      if (localSessionId && localSessionId !== lastLocalSessionId) {
        if (activeOpenCodeSessionId) setActiveOpenCodeSessionId('')
        lastLocalSessionId = localSessionId
      }
      if (!activeOpenCodeSessionId) {
        console.warn('[隔离] 新建 session, directory=', effectiveDir)
        const session = await createOpenCodeSession(client, {
          directory: effectiveDir,
          title: text.slice(0, 48) || '新对话',
        agent: options.openCodeAgent,
        model,
        metadata: {
          jiucaiheziSessionId: options.sessionId,
            jiucaiheziAgentId: options.agentId,
          },
          permission,
        }) as { id?: string }
        console.warn('[隔离] 新 session ID=', String(session.id || ''))
        setActiveOpenCodeSessionId(String(session.id || ''))
        activeOpenCodeSessionModelId = modelId
      } else {
        // 切模型时 update session model（保上下文 + 换模型），不重建 session
        if (modelId !== activeOpenCodeSessionModelId) {
          await updateOpenCodeSessionModel(client, activeOpenCodeSessionId, model, { directory: effectiveDir })
          activeOpenCodeSessionModelId = modelId
        }
        await updateOpenCodeSessionPermission(client, activeOpenCodeSessionId, permission, { directory: effectiveDir })
      }
      if (!activeOpenCodeSessionId) throw new Error('OpenCode session 创建失败。')
      try {
        sessionTodos.value = await listOpenCodeTodos(client, activeOpenCodeSessionId, { directory: effectiveDir })
      } catch {
        sessionTodos.value = []
      }
      const assistantMsg: ChatMessage = {
        id: createMessageId('assistant'),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        agentId: options.agentId,
        agentName: options.agentName || openCodeSkillName,
        reasoningContent: '',
        continuationParentId: options._continuationParentId,
      }
      messages.value.push(assistantMsg)
      const initialAssistantMsg = messages.value[messages.value.length - 1]
      const assistantByMessageId = new Map<string, ChatMessage>()
      const roleByMessageId = new Map<string, ChatMessage['role']>()
      const partOwnerByPartId = new Map<string, string>()
      const streamingTools = new Map<string, StreamingToolState>()
      const streamingParts = new Map<string, StreamingPartState>()
      let latestAssistantMessageId = ''
      let eventSubscription: { close: () => void } | null = null
      let statusPollTimer: ReturnType<typeof setInterval> | null = null
      let finalizeTimer: ReturnType<typeof setTimeout> | null = null
      let finalized = false
      let lastEventTime = 0
      const clearStatusPoll = () => {
        if (statusPollTimer) clearInterval(statusPollTimer)
        statusPollTimer = null
      }
      const clearFinalizeTimer = () => {
        if (finalizeTimer) clearTimeout(finalizeTimer)
        finalizeTimer = null
        clearIdleTimer()
      }
      const finalizeOpenCodeRun = async (finishReason: 'done' | 'error' | 'timeout' | 'abort', detail = '') => {
        if (finalized) return
        finalized = true
        clearStatusPoll()
        clearFinalizeTimer()
        eventSubscription?.close()
        eventSubscription = null
        if (runId !== activeRunId || controller.signal.aborted) return
        isStreaming.value = false
        abortController.value = null
        currentToolProgress.value = null
        if (finishReason === 'error') {
          setPhase('error', detail)
        } else if (finishReason === 'timeout') {
          setPhase('error', 'OpenCode 长时间没有返回新事件')
        } else if (finishReason === 'abort') {
          setPhase('idle')
        } else {
          setPhase('done')
        }
        let finalSyncError = ''
        try {
          const nextMessages = await listOpenCodeChatMessages(client, activeOpenCodeSessionId, { directory: effectiveDir })
          replaceMessagesPreservingPrompt(nextMessages, messages.value)
          invalidateOpenCodeSessionContextUsage(activeOpenCodeSessionId)
          openCodeContextUsage.value = await getOpenCodeSessionContextUsage(
            client,
            activeOpenCodeSessionId,
            agentStore.availableModels,
            { directory: effectiveDir },
          )
        } catch (error) {
          finalSyncError = error instanceof Error ? error.message : String(error)
        }
        if (runId !== activeRunId) return
        if (finishReason === 'error') {
          void notifyOpenCodeRun('OpenCode 出错', detail || '会话执行失败')
        } else if (finishReason === 'timeout') {
          const targetMsg = resolveAssistantMessage(latestAssistantMessageId)
          if (targetMsg) {
            targetMsg.finishReason = 'timeout'
            targetMsg.content ||= 'OpenCode 长时间没有返回新事件，本轮已自动停止。'
          }
          void notifyOpenCodeRun('OpenCode 超时', '长时间没有返回新事件')
          if (finalSyncError) void notifyOpenCodeRun('OpenCode 同步失败', finalSyncError)
        } else if (finalSyncError) {
          void notifyOpenCodeRun('OpenCode 同步失败', finalSyncError)
        } else {
          void notifyOpenCodeRun('OpenCode 已完成', detail || '会话已进入 idle')
        }
      }
      const scheduleFinalizeOpenCodeRun = (finishReason: 'done' | 'error' | 'timeout' | 'abort', detail = '') => {
        if (finalized || finalizeTimer) return
        finalizeTimer = setTimeout(() => {
          finalizeTimer = null
          void finalizeOpenCodeRun(finishReason, detail)
        }, finishReason === 'done' ? 120 : 0)
      }
      // 独立 idleTimer，不与 finalizeTimer 共用（避免 v1.0.13 P0：watchdog 和 completion 互斥）
      // ponytail: 官方 OpenCode 无 watchdog（依赖 Effect 结构化并发自动中断）。
      // Tauri/JS 无 Effect 运行时，此 watchdog 为等价替代。
      // 300s 容忍复杂 subagent 任务（写长文、批量文件操作等），
      // 上限：OpenCode 官方单步 timeout 通常为 600s。
      const IDLE_TIMEOUT_MS = 300_000
      let idleTimer: ReturnType<typeof setTimeout> | null = null
      const clearIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = null
      }
      const resetIdleTimer = () => {
        lastEventTime = Date.now()
        clearIdleTimer()
        // 官方 OpenCode 无 watchdog，因为它依赖 Effect 结构化并发：
        // 父 scope 关闭时所有子 fiber 自动中断。Tauri/JS 无 Effect 运行时，
        // 此 watchdog 是等价替代：${IDLE_TIMEOUT_MS / 1000}s 无事件 → abort session → finalize。
        idleTimer = setTimeout(() => {
          if (finalized || runId !== activeRunId) return
          console.warn(`[OpenCode] 看门狗超时：${IDLE_TIMEOUT_MS / 1000}s 无新事件，正在中止运行`)
          void (async () => {
            try {
              await abortOpenCodeSession(client, activeOpenCodeSessionId, { directory: effectiveDir })
            } catch (e) {
              console.warn('[OpenCode] abort 失败（可能已结束）:', e)
            }
            // 直接调 finalizeOpenCodeRun，绕过 scheduleFinalizeOpenCodeRun 的 finalizeTimer 守卫
            void finalizeOpenCodeRun('timeout', `${IDLE_TIMEOUT_MS / 1000}s 无新事件，可能仍在后台运行，已停止等待`)
          })()
        }, IDLE_TIMEOUT_MS)
      }
      const startStatusPoll = () => {
        clearStatusPoll()
        const pollStartTime = Date.now()
        const MAX_POLL_DURATION_MS = 300_000  // 5 分钟
        const MAX_SILENT_MS = 120_000          // 2 分钟无事件
        statusPollTimer = setInterval(() => {
          if (finalized || runId !== activeRunId || controller.signal.aborted) {
            clearStatusPoll()
            return
          }
          // 兜底：轮询超过 5 分钟且最后事件超过 2 分钟前 → 超时
          const elapsed = Date.now() - pollStartTime
          const silentDuration = Date.now() - lastEventTime
          if (elapsed > MAX_POLL_DURATION_MS && silentDuration > MAX_SILENT_MS) {
            clearStatusPoll()
            console.warn('[OpenCode] 状态轮询超时：5min+ 无进展，正在中止')
            void (async () => {
              try { await abortOpenCodeSession(client, activeOpenCodeSessionId, { directory: effectiveDir }) } catch {}
              void finalizeOpenCodeRun('timeout', '状态轮询超过 5 分钟无进展，可能仍在后台运行')
            })()
            return
          }
          void (async () => {
            try {
              const statusMap = await getOpenCodeSessionStatusWithTimeout(
                client,
                { directory: effectiveDir, sessionID: activeOpenCodeSessionId },
                5_000,
                'busy',
              )
              if (getOpenCodeStatusType(statusMap, activeOpenCodeSessionId) === 'idle') {
                scheduleFinalizeOpenCodeRun('done')
              }
            } catch {
              // 官方 run transport 也把 status 轮询作为兜底，失败不应打断事件流。
            }
          })()
        }, 250)
      }
      controller.signal.addEventListener('abort', () => {
        clearStatusPoll()
        clearFinalizeTimer()
        clearIdleTimer()
        eventSubscription?.close()
        eventSubscription = null
      }, { once: true })
      const createOrGetAssistantMessage = (messageId?: string, timestamp?: number): ChatMessage => {
        const id = String(messageId || latestAssistantMessageId || '')
        if (id) {
          const existing = assistantByMessageId.get(id)
          if (existing) return existing
        }
        if (!latestAssistantMessageId && id) {
          const first = messages.value[messages.value.length - 1]
          first.id = id
          first.timestamp = timestamp || first.timestamp
          assistantByMessageId.set(id, first)
          roleByMessageId.set(id, 'assistant')
          latestAssistantMessageId = id
          return first
        }
        const next: ChatMessage = {
          id: id || createMessageId('assistant'),
          role: 'assistant',
          content: '',
          timestamp: timestamp || Date.now(),
          agentId: options.agentId,
          agentName: options.agentName || openCodeSkillName,
          reasoningContent: '',
          continuationParentId: options._continuationParentId,
        }
        messages.value.push(next)
        const reactive = messages.value[messages.value.length - 1]
        if (id) {
          assistantByMessageId.set(id, reactive)
          roleByMessageId.set(id, 'assistant')
          latestAssistantMessageId = id
        }
        return reactive
      }
      const resolveAssistantMessage = (messageId?: string): ChatMessage | null => {
        const id = String(messageId || latestAssistantMessageId || '')
        if (!id) return null
        if (roleByMessageId.get(id) && roleByMessageId.get(id) !== 'assistant') return null
        return assistantByMessageId.get(id) || createOrGetAssistantMessage(id)
      }
      const upsertRuntimeEventPart = (rawPart: Record<string, unknown>, messageId?: string) => {
        const targetMsg = resolveAssistantMessage(messageId) || initialAssistantMsg
        if (!targetMsg) return
        upsertOpenCodePart(targetMsg, rawPart)
      }
      eventSubscription = await subscribeOpenCodeEvents(client, (event) => {
        if (finalized) return
        if (runId !== activeRunId || controller.signal.aborted) return
        resetIdleTimer()
        const payload = event as any
        const properties = payload?.properties || {}
        if (properties.sessionID && properties.sessionID !== activeOpenCodeSessionId) return
        const type = String(payload?.type || '')
        if (type === 'session.status') {
          applyOpenCodeSessionStatus(properties)
          refreshRevertItems(properties.info?.revert?.messageID || properties.revert?.messageID || properties.status?.revert?.messageID)
          const status = normalizeOpenCodeSessionStatus(properties)
          if (isOpenCodeRunErrorEvent(type, properties)) {
            const targetMsg = resolveAssistantMessage(properties.messageID || properties.assistantMessageID || latestAssistantMessageId)
            const detail = getOpenCodeRunErrorDetail(type, properties)
            if (targetMsg) {
              targetMsg.finishReason = 'error'
              targetMsg.content ||= `OpenCode 错误：${detail}`
              upsertOpenCodePart(targetMsg, {
                type: 'error',
                id: `${targetMsg.id}:status-error`,
                message: targetMsg.content,
                error: properties.status?.error || properties.status || properties,
              })
            }
            scheduleFinalizeOpenCodeRun('error', detail.slice(0, 120))
            return
          }
          if (status === 'retry') {
            upsertRuntimeEventPart({
              type: 'retry',
              id: 'session-status-retry',
              attempt: properties.attempt || properties.status?.attempt,
              error: properties.error || properties.status?.error || properties.status,
            }, properties.messageID || properties.assistantMessageID)
          }
        }
        if ((!properties.sessionID || properties.sessionID === activeOpenCodeSessionId) && isOpenCodeRunCompleteEvent(type, properties)) {
          // Phase B: 从 idle 事件中提取 summary.diffs，注入到本轮最后一条 user message
          const summary = properties.info?.summary || properties.summary || {}
          const diffs = Array.isArray(summary.diffs) ? summary.diffs : Array.isArray(properties.diffs) ? properties.diffs : []
          if (diffs.length > 0) {
            for (let i = messages.value.length - 1; i >= 0; i--) {
              if (messages.value[i].role === 'user') {
                messages.value[i].summaryDiffs = diffs.map((d: any) => ({
                  file: d.file || d.path || d.name || 'unknown',
                  additions: typeof d.additions === 'number' ? d.additions : 0,
                  deletions: typeof d.deletions === 'number' ? d.deletions : 0,
                  status: String(d.status || d.change || 'modified'),
                }))
                break
              }
            }
            extractTurnDiffsFromMessages()
          }
          scheduleFinalizeOpenCodeRun('done')
          return
        }
        if (type === 'session.next.context.updated') {
            invalidateOpenCodeSessionContextUsage(activeOpenCodeSessionId)
          void getOpenCodeSessionContextUsage(client, activeOpenCodeSessionId, agentStore.availableModels, { directory: effectiveDir })
            .then(usage => { openCodeContextUsage.value = usage })
            .catch(() => {})
          return
        }
        if (type === 'message.updated') {
          const info = properties.info || {}
          const messageId = String(info.id || properties.messageID || '')
          const role = openCodeMessageRole(info)
          if (messageId && role) roleByMessageId.set(messageId, role)
          if (messageId && role === 'assistant') {
            const message = createOrGetAssistantMessage(messageId, info.time?.created)
            message.agentName = info.agent || message.agentName
            if (info.error) {
              message.finishReason = 'error'
              const detail = `OpenCode 错误：${getOpenCodeRunErrorDetail('message.updated', { error: info.error })}`
              message.content ||= detail
              upsertOpenCodePart(message, {
                type: 'error',
                id: `${messageId}:error`,
                message: detail,
                error: info.error,
              })
            }
          }
          return
        }
        if (properties.assistantMessageID) {
          const messageId = String(properties.assistantMessageID)
          roleByMessageId.set(messageId, 'assistant')
          createOrGetAssistantMessage(messageId, properties.timestamp)
        }
        if (type === 'message.part.updated') {
          const part = properties.part || {}
          if (part.sessionID && part.sessionID !== activeOpenCodeSessionId) return
          // 对齐官方 event-reducer.ts:19,228 — 跳过 patch/step-start/step-finish 的更新 (D0-002)
          if (SKIP_PART_UPDATE_TYPES.has(String(part.type || ''))) return
          const messageId = String(part.messageID || '')
          if (part.id && messageId) partOwnerByPartId.set(String(part.id), messageId)
          if (messageId && roleByMessageId.get(messageId) && roleByMessageId.get(messageId) !== 'assistant') return
          const targetMsg = resolveAssistantMessage(messageId)
          if (!targetMsg) return
          upsertOpenCodePart(targetMsg, part)
          if (part.type === 'text') {
            // ponytail: OpenCode 官方 UserMessageDisplay 跳过 synthetic text part
            // 对齐 message-part.tsx:1058: parts.find(p => p.type === "text" && !p.synthetic)
            if (!(part as any).synthetic) {
              applyTextPartToMessage(targetMsg, String(part.id), String(part.text || ''), streamingParts)
            }
            setPhase('replying', 'OpenCode 正在回复')
            return
          }
          if (part.type === 'reasoning') {
            applyReasoningPartToMessage(targetMsg, String(part.id), String(part.text || ''), streamingParts)
            setPhase('thinking', 'OpenCode 正在思考')
            return
          }
          if (part.type === 'tool') {
            const callId = String(part.callID || part.id)
            const name = String(part.tool || part.name || 'tool')
            const state = part.state || {}
            const input = typeof state.input === 'string' ? state.input : safeJson(state.input || {})
            const startedAtMs = streamingTools.get(callId)?.startedAtMs || Date.now()
            streamingTools.set(callId, { callId, name, input, startedAtMs })
            appendUniqueToolCall(targetMsg, callId, name, input)
            if (state.status === 'pending' || state.status === 'running') {
              currentToolProgress.value = {
                toolCallId: callId,
                name,
                phase: 'executing',
                args: input,
                result: null,
                isError: false,
                startedAtMs,
                finishedAtMs: null,
              }
              setPhase('tool', name)
              return
            }
            if (state.status === 'completed' || state.status === 'error') {
              const isError = state.status === 'error'
              const result = resolveToolResultFromState(state) || (isError ? '工具执行失败' : '工具已完成')
              upsertToolResultMessage(targetMsg.id, callId, name, result, isError)
              currentToolProgress.value = null
              toolHistory.value = [
                ...toolHistory.value.filter(item => item.toolCallId !== callId),
                {
                  toolCallId: callId,
                  name,
                  phase: 'result',
                  args: input,
                  result,
                  isError,
                  startedAtMs,
                  finishedAtMs: Date.now(),
                },
              ]
              setPhase(isError ? 'error' : 'replying', isError ? `${name} 失败` : 'OpenCode 正在继续')
              return
            }
          }
          return
        }
        if (type === 'session.next.text.delta') {
          const targetMsg = resolveAssistantMessage(properties.assistantMessageID)
          if (!targetMsg) return
          const partId = String(properties.textID || properties.partID || 'text')
          const previous = streamingParts.get(partId)
          const nextText = `${previous?.type === 'text' ? previous.text : ''}${properties.delta || ''}`
          applyOpenCodePartDelta(targetMsg, partId, 'text', String(properties.delta || ''))
          applyTextPartToMessage(targetMsg, partId, nextText, streamingParts)
          setPhase('replying', 'OpenCode 正在回复')
          return
        }
        if (type === 'session.next.text.ended') {
          const targetMsg = resolveAssistantMessage(properties.assistantMessageID)
          if (!targetMsg) return
          const partId = String(properties.textID || properties.partID || 'text')
          upsertOpenCodePart(targetMsg, { type: 'text', id: partId, text: String(properties.text || '') })
          applyTextPartToMessage(targetMsg, partId, String(properties.text || ''), streamingParts)
          return
        }
        if (type === 'session.next.reasoning.delta') {
          const targetMsg = resolveAssistantMessage(properties.assistantMessageID)
          if (!targetMsg) return
          const partId = String(properties.reasoningID || properties.partID || 'reasoning')
          const previous = streamingParts.get(partId)
          const nextText = `${previous?.type === 'reasoning' ? previous.text : ''}${properties.delta || ''}`
          applyOpenCodePartDelta(targetMsg, partId, 'reasoning', String(properties.delta || ''))
          applyReasoningPartToMessage(targetMsg, partId, nextText, streamingParts)
          setPhase('thinking', 'OpenCode 正在思考')
          return
        }
        if (type === 'session.next.reasoning.ended' && typeof properties.text === 'string') {
          const targetMsg = resolveAssistantMessage(properties.assistantMessageID)
          if (!targetMsg) return
          const partId = String(properties.reasoningID || properties.partID || 'reasoning')
          upsertOpenCodePart(targetMsg, { type: 'reasoning', id: partId, text: properties.text })
          applyReasoningPartToMessage(targetMsg, partId, properties.text, streamingParts)
          return
        }
        if (type === 'message.part.delta') {
          const partId = String(properties.partID || 'part')
          const messageId = String(properties.messageID || partOwnerByPartId.get(partId) || '')
          if (messageId && roleByMessageId.get(messageId) && roleByMessageId.get(messageId) !== 'assistant') return
          const targetMsg = resolveAssistantMessage(messageId)
          if (!targetMsg) return
          if (messageId) partOwnerByPartId.set(partId, messageId)
          const field = String(properties.field || 'text')
          const delta = String(properties.delta || '')
          const previous = streamingParts.get(partId)
          const nextText = `${previous?.text || ''}${delta}`
          applyOpenCodePartDelta(targetMsg, partId, field, delta)
          if (field === 'reasoning' || previous?.type === 'reasoning') {
            applyReasoningPartToMessage(targetMsg, partId, nextText, streamingParts)
            setPhase('thinking', 'OpenCode 正在思考')
          } else if (field === 'text') {
            applyTextPartToMessage(targetMsg, partId, nextText, streamingParts)
            setPhase('replying', 'OpenCode 正在回复')
          }
          return
        }
        if (type === 'session.next.tool.input.started') {
          const targetMsg = resolveAssistantMessage(properties.assistantMessageID)
          if (!targetMsg) return
          const callId = String(properties.callID || payload.id)
          const name = String(properties.name || 'tool')
          streamingTools.set(callId, { callId, name, input: '', startedAtMs: Date.now() })
          upsertOpenCodePart(targetMsg, {
            type: 'tool',
            id: callId,
            callID: callId,
            tool: name,
            state: { status: 'running', input: {} },
          })
          appendUniqueToolCall(targetMsg, callId, name, '')
          currentToolProgress.value = {
            toolCallId: callId,
            name,
            phase: 'executing',
            args: '',
            result: null,
            isError: false,
            startedAtMs: Date.now(),
            finishedAtMs: null,
          }
          setPhase('tool', name)
          return
        }
        if (type === 'session.next.tool.input.delta') {
          const targetMsg = resolveAssistantMessage(properties.assistantMessageID)
          if (!targetMsg) return
          const callId = String(properties.callID || payload.id)
          const state = streamingTools.get(callId) || { callId, name: 'tool', input: '', startedAtMs: Date.now() }
          state.input += String(properties.delta || '')
          streamingTools.set(callId, state)
          upsertOpenCodePart(targetMsg, {
            type: 'tool',
            id: callId,
            callID: callId,
            tool: state.name,
            state: { status: 'running', input: state.input },
          })
          appendUniqueToolCall(targetMsg, callId, state.name, state.input)
          if (currentToolProgress.value?.toolCallId === callId) currentToolProgress.value.args = state.input
          return
        }
        if (type === 'session.next.tool.input.ended') {
          const targetMsg = resolveAssistantMessage(properties.assistantMessageID)
          if (!targetMsg) return
          const callId = String(properties.callID || payload.id)
          const state = streamingTools.get(callId) || { callId, name: 'tool', input: '', startedAtMs: Date.now() }
          state.input = String(properties.text || state.input || '')
          streamingTools.set(callId, state)
          upsertOpenCodePart(targetMsg, {
            type: 'tool',
            id: callId,
            callID: callId,
            tool: state.name,
            state: { status: 'running', input: state.input },
          })
          appendUniqueToolCall(targetMsg, callId, state.name, state.input)
          return
        }
        if (type === 'session.next.tool.called') {
          const targetMsg = resolveAssistantMessage(properties.assistantMessageID)
          if (!targetMsg) return
          const callId = String(properties.callID || payload.id)
          const name = String(properties.tool || properties.name || streamingTools.get(callId)?.name || 'tool')
          const args = safeJson(properties.input || streamingTools.get(callId)?.input || {})
          streamingTools.set(callId, { callId, name, input: args, startedAtMs: streamingTools.get(callId)?.startedAtMs || Date.now() })
          upsertOpenCodePart(targetMsg, {
            type: 'tool',
            id: callId,
            callID: callId,
            tool: name,
            state: { status: 'running', input: properties.input || streamingTools.get(callId)?.input || {} },
          })
          appendUniqueToolCall(targetMsg, callId, name, args)
          currentToolProgress.value = {
            toolCallId: callId,
            name,
            phase: 'executing',
            args,
            result: null,
            isError: false,
            startedAtMs: Date.now(),
            finishedAtMs: null,
          }
          setPhase('tool', name)
          return
        }
        if (type === 'session.next.tool.progress') {
          const callId = String(properties.callID || payload.id)
          const state = streamingTools.get(callId)
          if (state) setPhase('tool', state.name)
          return
        }
        if (type === 'session.next.tool.success' || type === 'session.next.tool.failed') {
          const targetMsg = resolveAssistantMessage(properties.assistantMessageID)
          if (!targetMsg) return
          const callId = String(properties.callID || payload.id)
          const state = streamingTools.get(callId) || { callId, name: String(properties.tool || 'tool'), input: '', startedAtMs: Date.now() }
          const isError = type === 'session.next.tool.failed'
          const result = isError
            ? safeJson(properties.error || properties.result || '工具执行失败')
            : (toolContentSummary(properties.content) || safeJson(properties.result || properties.structured || '工具已完成'))
          upsertOpenCodePart(targetMsg, {
            type: 'tool',
            id: callId,
            callID: callId,
            tool: state.name,
            state: {
              status: isError ? 'error' : 'completed',
              input: state.input,
              result,
              error: isError ? properties.error : undefined,
            },
          })
          upsertToolResultMessage(targetMsg.id, callId, state.name, result, isError)
          const finishedProgress: ToolProgress = {
            toolCallId: callId,
            name: state.name,
            phase: 'result',
            args: state.input,
            result,
            isError,
            startedAtMs: state.startedAtMs,
            finishedAtMs: Date.now(),
          }
          currentToolProgress.value = null
          toolHistory.value = [...toolHistory.value, finishedProgress]
          setPhase(isError ? 'error' : 'replying', isError ? `${state.name} 失败` : 'OpenCode 正在继续')
          return
        }
        if (type === 'session.next.step.started') {
          upsertRuntimeEventPart({
            type: 'step-start',
            id: String(properties.stepID || payload.id || 'step-start'),
            title: properties.title || properties.name,
            raw: properties,
          }, properties.assistantMessageID || properties.messageID)
          setPhase('thinking', 'OpenCode 开始新阶段')
          return
        }
        if (type === 'session.next.step.finished' || type === 'session.next.step.ended' || type === 'session.next.step.completed') {
          upsertRuntimeEventPart({
            type: 'step-finish',
            id: String(properties.stepID || payload.id || 'step-finish'),
            reason: properties.reason || properties.status || 'done',
            cost: properties.cost,
            raw: properties,
          }, properties.assistantMessageID || properties.messageID)
          setPhase('replying', 'OpenCode 正在继续')
          return
        }
        if (type === 'session.next.step.failed' || type === 'session.next.step.error') {
          upsertRuntimeEventPart({
            type: 'step-fail',
            id: String(properties.stepID || payload.id || 'step-fail'),
            error: properties.error || properties,
            raw: properties,
          }, properties.assistantMessageID || properties.messageID)
          setPhase('error', 'OpenCode 阶段失败')
          return
        }
        if (type === 'session.next.agent.switched') {
          upsertRuntimeEventPart({
            type: 'agent',
            id: String(properties.messageID || properties.assistantMessageID || 'agent-switched'),
            name: properties.agent || 'OpenCode',
            raw: properties,
          }, properties.assistantMessageID || properties.messageID)
          setPhase('thinking', `Agent: ${properties.agent || 'OpenCode'}`)
          return
        }
        if (type === 'session.next.compaction.started') {
          upsertRuntimeEventPart({
            type: 'compaction',
            id: 'compaction',
            auto: properties.auto ?? true,
            overflow: properties.overflow,
            raw: properties,
          }, properties.assistantMessageID || properties.messageID)
          setPhase('thinking', 'OpenCode 正在压缩上下文')
          return
        }
        if (type === 'session.next.compaction.delta') {
          upsertRuntimeEventPart({
            type: 'compaction',
            id: 'compaction',
            auto: properties.auto ?? true,
            overflow: properties.overflow,
            summary: properties.delta || properties.text,
            raw: properties,
          }, properties.assistantMessageID || properties.messageID)
          setPhase('thinking', 'OpenCode 正在压缩上下文')
          return
        }
        if (type === 'permission.asked' || type === 'permission.v2.asked') {
          const request = normalizePermissionRequest(properties)
          // 对齐官方：先查 deny 规则（用户「始终拒绝」的权限不再弹窗）
          if (matchApprovedPermission(request.permission, request.patterns, 'deny')) {
            respondPermission(request.id, 'reject')
            return
          }
          // 对齐官方：再查 allow 规则（用户「始终允许」的权限不再弹窗）
          if (matchApprovedPermission(request.permission, request.patterns, 'allow')) {
            respondPermission(request.id, 'always')
            return
          }
          // 对齐官方 App 端：binary autoAccept toggle → 自动 once
          if (autoAcceptPermissions.value) {
            respondPermission(request.id, 'once')
            return
          }
          pendingPermissions.value = upsertById(pendingPermissions.value, request)
          return
        }
        if (type === 'permission.replied' || type === 'permission.v2.replied') {
          pendingPermissions.value = removeById(pendingPermissions.value, String(properties.requestID || properties.id || ''))
          return
        }
        if (type === 'question.asked' || type === 'question.v2.asked') {
          pendingQuestions.value = upsertById(pendingQuestions.value, normalizeQuestionRequest(properties))
          return
        }
        if (type === 'question.replied' || type === 'question.rejected' || type === 'question.v2.replied' || type === 'question.v2.rejected') {
          pendingQuestions.value = removeById(pendingQuestions.value, String(properties.requestID || properties.id || ''))
          return
        }
        if (type === 'todo.updated') {
          sessionTodos.value = Array.isArray(properties.todos) ? properties.todos : []
          return
        }
        if (type === 'session.followup' || type === 'session.followup.queued' || type === 'followup.queued') {
          const items = Array.isArray(properties.items) ? properties.items : [properties]
          for (const item of items) addFollowup(item?.text || item?.prompt || item?.content || '')
          return
        }
        if (type === 'session.diff') {
          sessionDiffs.value = Array.isArray(properties.diff) ? properties.diff : []
          extractTurnDiffsFromMessages()
          return
        }
        // VCS-001: vcs.branch.updated — 更新 VCS 分支状态 (官方 event-reducer.ts:298)
        if (type === 'vcs.branch.updated') {
          const branch = String(properties.branch || properties.name || '')
          if (branch) vcsInfo.value = { branch, default_branch: vcsInfo.value?.default_branch }
          return
        }
        if (type === 'session.error') {
          const targetMsg = resolveAssistantMessage(properties.messageID || properties.assistantMessageID || latestAssistantMessageId)
          const detail = `OpenCode 错误：${getOpenCodeRunErrorDetail(type, properties)}`
          if (targetMsg) {
            targetMsg.finishReason = 'error'
            targetMsg.content ||= detail
            upsertOpenCodePart(targetMsg, {
              type: 'error',
              id: `${targetMsg.id}:error:${Date.now()}`,
              message: detail,
              error: properties.error || payload,
            })
          }
          void finalizeOpenCodeRun('error', detail.slice(0, 120))
        }
        // MSG-002: message.removed — 从 UI 消息列表移除对应消息 (官方 event-reducer.ts:208)
        if (type === 'message.removed') {
          const removedId = String(properties.messageID || properties.id || '')
          if (removedId) messages.value = messages.value.filter(m => m.id !== removedId)
          return
        }
        // MSG-003: message.part.removed — 从消息中移除指定 part (官方 event-reducer.ts:255)
        if (type === 'message.part.removed') {
          const partId = String(properties.partID || properties.id || '')
          const messageId = String(properties.messageID || partOwnerByPartId.get(partId) || '')
          if (partId && messageId) {
            const targetMsg = resolveAssistantMessage(messageId)
            if (targetMsg?.openCodeParts) {
              targetMsg.openCodeParts = targetMsg.openCodeParts.filter(p => p.id !== partId)
            }
          }
          return
        }
        // SES-001: session 生命周期事件 — 触发会话列表刷新 (官方 event-reducer.ts:111-170)
        if (type === 'session.created' || type === 'session.updated' || type === 'session.deleted') {
          emitEvent('refresh-file-list', { category: 'history' })
          return
        }
      }, {
        directory: effectiveDir,
        debug: true,
        onClose: () => {
          if (runId !== activeRunId || controller.signal.aborted || finalized) return
          void (async () => {
            // 事件流关闭后：最多重试 3 次 status 查询（间隔 3s/5s/8s）
            const retryDelays = [3000, 5000, 8000]
            for (const delay of retryDelays) {
              if (finalized || runId !== activeRunId) return
              await new Promise(r => setTimeout(r, delay))
              try {
                const statusMap = await getOpenCodeSessionStatusWithTimeout(
                  client,
                  { directory: effectiveDir, sessionID: activeOpenCodeSessionId },
                  5_000,
                  'busy',
                )
                if (finalized || runId !== activeRunId) return
                if (getOpenCodeStatusType(statusMap, activeOpenCodeSessionId) === 'idle') {
                  scheduleFinalizeOpenCodeRun('done', 'event stream closed → idle confirmed')
                  return
                }
              } catch { /* 继续重试 */ }
            }
            // 3 次重试后仍 busy → 超时（先 abort 再 finalize，对齐官方 cancel() → cancelBackgroundJobs）
            try {
              await abortOpenCodeSession(client, activeOpenCodeSessionId, { directory: effectiveDir })
            } catch { /* 可能已结束 */ }
            void finalizeOpenCodeRun('timeout', '事件流关闭后仍繁忙，可能仍在后台运行，已停止等待')
          })()
        },
        onError: (error) => {
          if (runId !== activeRunId || controller.signal.aborted || finalized) return
          const detail = error instanceof Error ? error.message : String(error)
          const targetMsg = resolveAssistantMessage(latestAssistantMessageId)
          if (targetMsg) {
            targetMsg.finishReason = 'error'
            targetMsg.content ||= `OpenCode 事件流中断：${detail}`
            upsertOpenCodePart(targetMsg, {
              type: 'error',
              id: `${targetMsg.id}:stream-error`,
              message: targetMsg.content,
              error,
            })
          }
          scheduleFinalizeOpenCodeRun('error', detail.slice(0, 120))
        },
      })
      resetIdleTimer()
      startStatusPoll()
      setPhase('replying', 'OpenCode 正在生成')
      await fireOpenCodePrompt(client, {
        sessionID: activeOpenCodeSessionId,
        directory: effectiveDir,
        text: promptText,
        system: systemPrompt || undefined,
        agent: options.openCodeAgent,
        model,
        tools: options.openCodeTools,
        parts: buildOpenCodePromptParts({
          text: promptText,
          agent: options.openCodeAgent,
          images: options.images,
          files: options.files,
        }),
      })
      // ponytail: prompt 提交成功后，事件流驱动后续 UI 更新。
      // 不在此 return，让函数自然结束（事件流在 try 块内已完成订阅）。
      return
    } catch (err) {
      if (runId !== activeRunId) return
      // ponytail: prompt 失败时需要完整清理事件订阅/计时器。
      // controller.abort() 触发 abort 事件监听器 → 清理 eventSubscription + idleTimer + statusPollTimer
      try { controller.abort() } catch {}
      const detail = err instanceof Error ? err.message : String(err)
      messages.value.push({
        id: createMessageId('assistant'),
        role: 'assistant',
        content: `OpenCode 内核连接失败：${detail}`,
        timestamp: Date.now(),
        agentId: options.agentId,
        agentName: options.agentName,
        finishReason: 'opencode_error',
        continuationParentId: options._continuationParentId,
      })
      isStreaming.value = false
      abortController.value = null
      setPhase('error', detail)
    }
  }

  function stopStream() {
    const sessionId = activeOpenCodeSessionId
    setPhase('cancelling', isTauriRuntime() ? 'OpenCode 正在停止' : '云端请求正在停止')
    if (sessionId) {
      void (async () => {
        try {
          const agentStore = useAgentStore()
          const projectedConfig = await projectStoredNewApiForOpenCode({
            currentModel: agentStore.currentModel,
            models: agentStore.availableModels,
          })
          const projectDir = activeOpenCodeDirectory
          const handle = await ensureOpenCodeServer({ config: projectedConfig, directory: projectDir || undefined })
          const effectiveDir = resolveOpenCodeDirectory(handle, projectDir)
          await abortOpenCodeSession(
            createJiucaiOpenCodeClient(handle, effectiveDir || undefined),
            sessionId,
            { directory: effectiveDir },
          )
          setPhase('idle')
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error)
          sessionCommandNotice.value = `OpenCode 停止失败：${detail}`
          setPhase('error', 'OpenCode 停止失败')
        }
      })()
    } else {
      setPhase('idle')
    }
    cancelCurrentRun()
  }

  async function clearMessages(_options: { sessionId?: string } = {}) {
    cancelCurrentRun()
    messages.value = []
    setActiveOpenCodeSessionId('')
    openCodeContextUsage.value = null
    sessionDiffs.value = []
    sessionShareUrl.value = ''
    sessionCommandNotice.value = ''
    sessionRevertItems.value = []
    sessionFollowups.value = []
    resetToolState()
    setPhase('idle')
  }

  function getActiveOpenCodeSessionId(): string {
    return activeOpenCodeSessionId
  }

  function loadMessages(history: ChatMessage[], _baseline?: RuntimeContextBaseline) {
    cancelCurrentRun()
    messages.value = Array.isArray(history) ? history : []
    setActiveOpenCodeSessionId(String(_baseline?.openCodeSessionId || ''))
    openCodeContextUsage.value = null
    sessionDiffs.value = []
    sessionShareUrl.value = ''
    sessionCommandNotice.value = ''
    sessionRevertItems.value = []
    sessionFollowups.value = []
    resetToolState()
    setPhase('idle')
  }

  return {
    messages,
    isStreaming,
    sendMessage,
    stopStream,
    clearMessages,
    loadMessages,
    activeOpenCodeSessionId: readonly(activeOpenCodeSessionIdRef),
    getActiveOpenCodeSessionId,
    agentPhase,
    agentDetail,
    currentToolProgress,
    toolHistory,
    pendingPermissions,
    autoAcceptPermissions,
    pendingQuestions,
    sessionTodos,
    openCodeContextUsage,
    sessionDiffs,
    turnDiffs,
    vcsDiffs,
    vcsBranchDiffs,
    vcsInfo,
    fetchSessionDiffs,
    extractTurnDiffsFromMessages,
    fetchVcsInfo,
    sessionCommandNotice,
    sessionShareUrl,
    sessionRevertItems,
    restoringRevertId,
    sessionFollowups,
    sendingFollowupId,
    respondPermission,
    replyQuestion,
    rejectQuestion,
    restoreRevertItem,
    sendFollowup,
    editFollowup,
    runOpenCodeSessionAction,
    runSlashCommand,
    runShellCommand,
  }
}
