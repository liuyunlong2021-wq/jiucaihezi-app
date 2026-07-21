/**
 * composables/useChat.ts — Wave 1 OpenCode facade
 *
 * The old hand-written chat kernel is intentionally disconnected here.
 * This module keeps the existing UI contract alive until Wave 2 wires
 * ChatPanel to OpenCode through src/opencodeClient/*.
 */
import { computed, readonly, ref, watch } from 'vue'
import type { OfficeDownloadFile } from '@/utils/officeDownloads'
import type { RunTraceSummary } from '@/utils/runTrace'
import type { RuntimeCapabilityTier } from '@/utils/runtimeCapabilities'
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
} from './web/chatCloud'
import { ensureOpenCodeServer } from '@/opencodeClient/daemon'
import { createJiucaiOpenCodeClient } from '@/opencodeClient/client'
import { projectStoredNewApiForOpenCode, toOpenCodeModelProjection } from '@/opencodeClient/providerProjection'
import {
  buildOpenCodePromptParts,
  createOpenCodeSession,
  listOpenCodeChatMessages,
} from '@/opencodeClient/session'
import { buildFixedSkillSystemInstruction, buildSkillPermissionScope } from '@/opencodeClient/skillScope'
import { createOpenCodeId } from '@/opencodeClient/identifier'
import type { OpenCodeRenderablePart } from '@/opencodeClient/timelineRows'
import {
  listOpenCodeTodos,
  normalizePermissionRequest,
  normalizeQuestionRequest,
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
import { useOpenCodeSyncStore } from '@/stores/openCodeSyncStore'
import { useChatModeStore } from '@/stores/chatModeStore'
import type { MediaPlan } from '@/runtime/workbench/mediaPlan'
import type {
  DirectAttachmentKind,
  ResolvedDirectAttachment,
} from '@/utils/directMessageBuilder'
import type { ModelInputModality } from '@/runtime/direct/modelInputCapabilities'
import type { ProjectResource } from '@/utils/projectResource'

export interface DirectAttachmentRef {
  id: string
  name: string
  mime: string
  size: number
  kind: DirectAttachmentKind
  source: 'upload' | 'project' | 'canvas' | 'task'
  resource?: ProjectResource
  cachePath?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool' | 'divider'
  content: string
  timestamp: number
  agentId?: string
  agentName?: string
  modelId?: string
  modelProviderId?: string
  toolCalls?: ToolCall[]
  toolProgress?: ToolProgress[]
  toolCallId?: string
  toolName?: string
  toolStatus?: 'succeeded' | 'failed' | 'cancelled'
  officeDownloadFiles?: OfficeDownloadFile[]
  images?: string[]
  files?: Array<{ name: string; content: string }>
  attachments?: DirectAttachmentRef[]
  finishReason?: string
  reasoningContent?: string
  isMediaTask?: boolean
  mediaTaskId?: string
  searchResults?: { title: string; url: string; snippet: string }[]
  traceSummary?: RunTraceSummary
  openCodeParts?: OpenCodeRenderablePart[]
  /** Per-turn diffs from the last user message summary (official OpenCode: UserMessage.summary.diffs) */
  summaryDiffs?: OpenCodeDiffFile[]
  mediaPlan?: MediaPlan
  mediaPlanStatus?: 'ready' | 'submitting' | 'submitted' | 'failed'
  mediaPlanError?: string
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
  mediaPlanPolicy?: string
  agentId?: string
  agentName?: string
  skillName?: string
  sessionId?: string
  images?: string[]
  files?: Array<{ name: string; content: string }>
  attachments?: DirectAttachmentRef[]
  modelAttachments?: ResolvedDirectAttachment[]
  modelInputModalities?: ModelInputModality[]
  modelId?: string
  modelProviderId?: string
  chatMode?: 'build' | 'plan'
  openCodeAgent?: string
  openCodeProjectDir?: string
  capabilityTier?: RuntimeCapabilityTier
  connectionSource?: 'plain' | 'manual' | 'superpower' | 'skill' | 'tool'
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
const pendingDesktopMessages = ref<ChatMessage[]>([])

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
/** OpenCode 自动检测到的 Skill 名称（session.next.agent.switched 事件驱动） */
const autoDetectedSkillName = ref<string>('')

let activeRunId = 0
let testDeps: Record<string, unknown> | null = null
let activeOpenCodeSessionId = ''
const activeOpenCodeSessionIdRef = ref('')
let activeOpenCodeDirectory = ''
// ponytail: 跟踪上次发送的项目目录，变了 = 切项目 → 清 session
let lastProjectDir = ''

function setActiveOpenCodeSessionId(sessionId: string) {
  if (sessionId && sessionId !== activeOpenCodeSessionId) {
    // session 切换：清理旧 session 的 pending 权限（approved 规则集保留，对齐官方 session-scoped）
    pendingPermissions.value = []
  }
  activeOpenCodeSessionId = sessionId
  activeOpenCodeSessionIdRef.value = sessionId
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
  const title = ok ? `韭菜盒子${label}已完成` : `韭菜盒子${label}失败`
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
    ok ? '韭菜盒子命令已完成' : '韭菜盒子命令失败',
    detail || `/${clean} ${ok ? '已完成' : '执行失败'}`,
  )
}

function notifyOpenCodeShellCommand(ok: boolean) {
  void notifyOpenCodeRun(
    ok ? '韭菜盒子终端命令已完成' : '韭菜盒子终端命令失败',
    ok ? '终端命令已完成' : '终端命令执行失败',
  )
}

function beginRun(): number {
  activeRunId += 1
  autoDetectedSkillName.value = ''
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



// ponytail: readOpenAiCompatibleStream / readOllamaChatStream 已随直连模式删除（SDD app-opencode-only）

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
  const openCodeSyncStore = useOpenCodeSyncStore()
  const chatModeStore = useChatModeStore()
  const isCreativeDesktopMode = () => isTauriRuntime() && chatModeStore.mode === 'creative'
  const currentOpenCodeSessionID = () => (
    isTauriRuntime() ? openCodeSyncStore.activeSessionId : activeOpenCodeSessionId
  )
  const exposedIsStreaming = computed(() => (
    isTauriRuntime() ? (openCodeSyncStore.isStreaming || isStreaming.value) : isStreaming.value
  ))

  if (isTauriRuntime()) {
    watch(
      () => [openCodeSyncStore.activeSessionId, openCodeSyncStore.chatMessages, chatModeStore.mode] as const,
      ([sessionID, projected, mode]) => {
        if (mode === 'creative') return
        setActiveOpenCodeSessionId(sessionID)
        const confirmed = new Set(projected.map(message => message.id))
        pendingDesktopMessages.value = pendingDesktopMessages.value.filter(message => !confirmed.has(message.id))
        const nextMessages = [
          ...(sessionID ? projected.map(message => ({ ...message })) : []),
          ...pendingDesktopMessages.value,
        ].sort((a, b) => a.timestamp - b.timestamp)
        if (!sessionID) messages.value = []
        else replaceMessagesPreservingPrompt(nextMessages, messages.value)
      },
      { deep: true, immediate: true },
    )
    watch(() => openCodeSyncStore.activePermissions, requests => {
      pendingPermissions.value = requests.map(request => normalizePermissionRequest(request))
    }, { deep: true, immediate: true })
    watch(() => openCodeSyncStore.activeQuestions, requests => {
      pendingQuestions.value = requests.map(request => normalizeQuestionRequest(request))
    }, { deep: true, immediate: true })
    watch(() => openCodeSyncStore.activeTodos, todos => {
      sessionTodos.value = todos as OpenCodeTodo[]
    }, { deep: true, immediate: true })
    watch(() => openCodeSyncStore.activeDiffs, diffs => {
      sessionDiffs.value = diffs as OpenCodeDiffFile[]
    }, { deep: true, immediate: true })
    watch(() => openCodeSyncStore.isStreaming, streaming => {
      if (streaming) setPhase('replying', '韭菜盒子正在处理')
      else if (agentPhase.value !== 'error') setPhase('done')
    }, { immediate: true })
  }

  async function getActiveOpenCodeClient(projectDir?: string) {
    const agentStore = useAgentStore()
    const requestedDir = projectDir || activeOpenCodeDirectory
    const projectedConfig = await projectStoredNewApiForOpenCode({
      currentModel: agentStore.currentModel,
      models: agentStore.availableModels,
    })
    const handle = await ensureOpenCodeServer({ config: projectedConfig, directory: projectDir || undefined })
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
    const sessionID = currentOpenCodeSessionID()
    if (!sessionID) return
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
    try {
      await openCodeSyncStore.replyPermission({
        sessionID: request?.sessionID || sessionID,
        requestID,
        reply,
      })
      sessionCommandNotice.value = ''
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      sessionCommandNotice.value = `韭菜盒子权限回复失败：${detail}`
    }
  }

  async function replyQuestion(requestID: string, answers: string[][]) {
    const sessionID = currentOpenCodeSessionID()
    if (!sessionID) return
    const request = pendingQuestions.value.find(item => item.id === requestID)
    await openCodeSyncStore.replyQuestion({
      sessionID: request?.sessionID || sessionID,
      requestID,
      answers,
    })
  }

  async function rejectQuestion(requestID: string) {
    const sessionID = currentOpenCodeSessionID()
    if (!sessionID) return
    const request = pendingQuestions.value.find(item => item.id === requestID)
    await openCodeSyncStore.rejectQuestion({
      sessionID: request?.sessionID || sessionID,
      requestID,
    })
  }

  async function ensureOpenCodeCommandSession(options: SendMessageOptions = {}) {
    if (isTauriRuntime() && chatModeStore.mode === 'creative') throw new Error('创模式不使用本机会话内核')
    const agentStore = useAgentStore()
    const projectedConfig = await projectStoredNewApiForOpenCode({
      currentModel: options.modelId || agentStore.currentModel,
      models: agentStore.availableModels,
    })
    if (isTauriRuntime() && chatModeStore.mode === 'creative') throw new Error('创模式不使用本机会话内核')
    const projectDir = options.openCodeProjectDir || ''
    // ponytail: 切项目时立即清 session
    if (projectDir && lastProjectDir && projectDir !== lastProjectDir) {
      setActiveOpenCodeSessionId('')
    }
    lastProjectDir = projectDir
    const handle = await ensureOpenCodeServer({ config: projectedConfig, directory: projectDir || undefined })
    if (isTauriRuntime() && chatModeStore.mode === 'creative') throw new Error('创模式不使用本机会话内核')
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
        title: '韭菜盒子命令',
        agent: options.openCodeAgent,
        model,
        metadata: {
          jiucaiheziSessionId: options.sessionId,
          jiucaiheziAgentId: options.agentId,
        },
      }) as { id?: string }
      setActiveOpenCodeSessionId(String(session.id || ''))
    }
    if (!activeOpenCodeSessionId) throw new Error('韭菜盒子会话创建失败。')
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
      const detail = '当前没有可压缩的上下文。'
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
        sessionCommandNotice.value = '已新建会话'
        setPhase('idle')
        notifyOpenCodeSessionAction(action, true, sessionCommandNotice.value)
        return { action, ok: true }
      }
      if (action === 'delete') {
        const sessionID = currentOpenCodeSessionID()
        if (!sessionID) throw new Error('当前没有可删除的会话。')
        await openCodeSyncStore.deleteSession(sessionID)
        resetActiveOpenCodeSessionState()
        sessionCommandNotice.value = '已删除会话'
        messages.value = []
        notifyOpenCodeSessionAction(action, true, sessionCommandNotice.value)
        return { action, ok: true, sessionID, deletedSessionID: sessionID }
      }
      const { client, sessionID, effectiveDir } = await ensureOpenCodeCommandSession(options)
      const location = { directory: effectiveDir }
      if (action === 'fork') {
        const forked = await forkOpenCodeSession(client, { sessionID, ...location }) as any
        const forkedSessionID = String(forked?.id || '')
        if (!forkedSessionID) throw new Error('会话分叉没有返回新会话 ID。')
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
          ? '上下文已压缩'
          : '已发起上下文压缩，等待同步'
        if (compactSync.confirmed) notifyOpenCodeSessionAction(action, true, sessionCommandNotice.value)
        else void notifyOpenCodeRun('韭菜盒子正在压缩上下文', sessionCommandNotice.value)
        return { action, ok: true, sessionID }
      } else if (action === 'undo') {
        const messageID = await latestOpenCodeUserMessageId(client)
        if (!messageID) throw new Error('没有可撤销的用户消息。')
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
        sessionCommandNotice.value = sessionShareUrl.value ? '已生成分享链接' : '已完成分享请求'
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
        sessionCommandNotice.value = '已归档会话'
        notifyOpenCodeSessionAction(action, true, sessionCommandNotice.value)
        return { action, ok: true, sessionID }
      } else if (action === 'diff') {
        sessionDiffs.value = await listOpenCodeSessionDiff(client, { sessionID, ...location })
        sessionCommandNotice.value = sessionDiffs.value.length ? '已拉取文件改动' : '当前没有文件变更'
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

  async function sendMessage(userText: string, options: SendMessageOptions = {}) {
    if (isCreativeDesktopMode()) return
    const text = String(userText || '').trim()
    const hasAttachments = Boolean(options.images?.length || options.files?.length || options.modelAttachments?.length)
    if ((!text && !hasAttachments) || (exposedIsStreaming.value && !options._parallel)) return

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

    const desktopMessageID = isTauriRuntime() ? createOpenCodeId('message') : ''
    const desktopParts = isTauriRuntime()
      ? buildOpenCodePromptParts({
          text,
          agent: options.openCodeAgent,
          images: options.images,
          files: options.files,
        }) as OpenCodeRenderablePart[]
      : []
    if (isTauriRuntime() && !options._skipUserMessageInsert) {
      const pending: ChatMessage = {
        id: desktopMessageID,
        role: 'user',
        content: text,
        timestamp: Date.now(),
        agentId: options.agentId,
        agentName: options.openCodeAgent || options.agentName,
        modelId: options.modelId,
        modelProviderId: options.modelProviderId,
        openCodeParts: desktopParts,
        images: options.images,
        files: options.files,
        attachments: options.attachments,
      }
      pendingDesktopMessages.value.push(pending)
      messages.value.push(pending)
    }

    if (!options._skipUserMessageInsert && !isTauriRuntime()) {
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
        attachments: options.attachments,
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
        }
        await sendWebCloudMessage(options, runId, controller, assistantMsg, setPhase, () => activeRunId, messages.value)
      } finally {
        isStreaming.value = false
        abortController.value = null
        currentToolProgress.value = null
      }
      await saveCloudSnapshot(sessionId, messages.value)
      return
    }
    if (isTauriRuntime()) {
      const agentStore = useAgentStore()
      try {
        setPhase('sending', '韭菜盒子正在连接')
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
        if (isCreativeDesktopMode()) {
          pendingDesktopMessages.value = pendingDesktopMessages.value.filter(message => message.id !== desktopMessageID)
          isStreaming.value = false
          abortController.value = null
          setPhase('idle')
          return
        }
        const projectDir = String(options.openCodeProjectDir || '').trim()
        const handle = await openCodeSyncStore.ensureConnected({ config: projectedConfig, directory: projectDir || undefined })
        if (isCreativeDesktopMode()) {
          pendingDesktopMessages.value = pendingDesktopMessages.value.filter(message => message.id !== desktopMessageID)
          isStreaming.value = false
          abortController.value = null
          setPhase('idle')
          return
        }
        const effectiveDir = resolveOpenCodeDirectory(handle, projectDir)
        activeOpenCodeDirectory = effectiveDir
        const requestedSessionID = String(options.sessionId || '')
        if (requestedSessionID.startsWith('ses_') && requestedSessionID !== openCodeSyncStore.activeSessionId) {
          await openCodeSyncStore.openSession(effectiveDir, requestedSessionID)
          if (isCreativeDesktopMode()) {
            pendingDesktopMessages.value = pendingDesktopMessages.value.filter(message => message.id !== desktopMessageID)
            isStreaming.value = false
            abortController.value = null
            setPhase('idle')
            return
          }
        }
        const sessionID = await openCodeSyncStore.ensureSession({ directory: effectiveDir, title: text.slice(0, 48) || '新对话' })
        if (isCreativeDesktopMode()) {
          pendingDesktopMessages.value = pendingDesktopMessages.value.filter(message => message.id !== desktopMessageID)
          isStreaming.value = false
          abortController.value = null
          setPhase('idle')
          return
        }
        const permission = buildSkillPermissionScope({ skillName: openCodeSkillName }) || []
        await openCodeSyncStore.updateSessionPermission(effectiveDir, sessionID, permission)
        if (isCreativeDesktopMode()) {
          pendingDesktopMessages.value = pendingDesktopMessages.value.filter(message => message.id !== desktopMessageID)
          isStreaming.value = false
          abortController.value = null
          setPhase('idle')
          return
        }
        const model = toOpenCodeModelProjection(options.modelId || agentStore.currentModel)
        const agent = options.openCodeAgent || options.chatMode || 'build'
        await openCodeSyncStore.submitPrompt({
          sessionID,
          messageID: desktopMessageID,
          directory: effectiveDir,
          title: text.slice(0, 48) || '新对话',
          text,
          system: systemPrompt || undefined,
          agent,
          model,
          parts: desktopParts as Array<Record<string, any> & { type: string; id?: string }>,
        })
        pendingDesktopMessages.value = pendingDesktopMessages.value.filter(message => message.id !== desktopMessageID)
        replaceMessagesPreservingPrompt(
          openCodeSyncStore.chatMessages.map(message => ({ ...message })),
          messages.value,
        )
        isStreaming.value = false
        abortController.value = null
        return
      } catch (error) {
        pendingDesktopMessages.value = pendingDesktopMessages.value.filter(message => message.id !== desktopMessageID)
        replaceMessagesPreservingPrompt(
          openCodeSyncStore.chatMessages.map(message => ({ ...message })),
          messages.value,
        )
        isStreaming.value = false
        abortController.value = null
        const detail = error instanceof Error ? error.message : String(error)
        setPhase('error', detail)
        throw error
      }
    }
  }

  function stopStream() {
    if (isTauriRuntime()) {
      setPhase('cancelling', '韭菜盒子正在停止')
      void openCodeSyncStore.abortActiveSession()
        .then(() => setPhase('idle'))
        .catch(error => {
          const detail = error instanceof Error ? error.message : String(error)
          sessionCommandNotice.value = `OpenCode 停止失败：${detail}`
          setPhase('error', '韭菜盒子停止失败')
        })
      return
    }
    setPhase('cancelling', '云端请求正在停止')
    cancelCurrentRun()
  }

  async function clearMessages(_options: { sessionId?: string } = {}) {
    if (isTauriRuntime()) openCodeSyncStore.newDraft()
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
    return isTauriRuntime() ? openCodeSyncStore.activeSessionId : activeOpenCodeSessionId
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
    isStreaming: exposedIsStreaming,
    sendMessage,
    stopStream,
    clearMessages,
    loadMessages,
    activeOpenCodeSessionId: isTauriRuntime() ? readonly(computed(() => openCodeSyncStore.activeSessionId)) : readonly(activeOpenCodeSessionIdRef),
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
    autoDetectedSkillName,
  }
}
