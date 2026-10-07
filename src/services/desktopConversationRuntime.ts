import { reactive, ref, shallowRef, watch } from 'vue'
import type { DirectRunMetrics } from '@/runtime/direct/directTypes'
import type { MemoryProgramStatus } from '@/runtime/memory/memoryChat'
import type { ConversationTurn } from '@/runtime/memory/conversationTranscript'
import { listHarnessConversationCatalog, upsertHarnessConversationCatalogEntry } from '@/runtime/memory/harnessConversationCatalog'
import { buildCreativeContext } from '@/runtime/direct/creativeMemory'
import {
  DEEPSEEK_HARNESS_CONTEXT_WINDOW,
  DEEPSEEK_HARNESS_MAX_OUTPUT_TOKENS,
  DEEPSEEK_HARNESS_SESSION_MARKER,
  deepSeekHandoffTurns,
  deepSeekAssistantText,
  deepSeekPermissionChip,
  deepSeekPrompt,
  deepSeekSessionExists,
  deepSeekSessionProcess,
  deepSeekSessionReasoning,
  deepSeekSessionTurns,
  listDeepSeekHarnessSessions,
  readDeepSeekHarnessSession,
  runDeepSeekHarness,
  type DeepSeekHarnessInput,
  type DeepSeekPermissionTier,
  type DeepSeekRetry,
  type DeepSeekRetryState,
  type DeepSeekSessionSnapshot,
} from './deepSeekHarness'
import { DesktopRemoteHost } from './desktopRemoteHost'
import { desktopRemoteEventCursor, nextDesktopRemoteEventSeq } from './desktopRemoteEventSeq'
import { publishDesktopRemoteEvent } from './desktopRemoteBridge'
import { RemoteProtocolError } from './desktopRemoteProtocol'
import { resolveModelInputModalities } from '@/runtime/direct/modelInputCapabilities'
import { resolveApiConfig } from '@/utils/api'

export type MemoryToolApprovalDecision = 'always' | 'once' | 'reject'
export type MemoryRunStep = {
  id: string
  label: string
  state: 'running' | 'done' | 'failed'
  durationMs?: number
  summary?: string
  startedAt?: number
  errorReason?: string
  /** 工具结果正文。实时也要带：官方在轮次内就把 `read` / `bash` 的产出摆出来。 */
  resultText?: string
  resultTruncated?: boolean
  /** 重试条目（官方 `llm/retry`）：与工具步共用同一条时间线，靠 `kind` 分开渲染。 */
  kind?: 'retry'
  retryState?: DeepSeekRetryState
  retry?: DeepSeekRetry
}

export type MemoryRun = {
  runId: string
  owner: string
  resourcePath: string
  conversationId: string
  phase: 'running' | 'done' | 'failed' | 'stopped'
  status: string
  error: string
  streamingText: string
  reasoning: string
  steps: MemoryRunStep[]
  elapsed: number
  metrics: DirectRunMetrics | null
  userTurn: ConversationTurn | null
  programStatus: MemoryProgramStatus | null
  permissionTier?: DeepSeekPermissionTier
  permissionNotice?: string
  approval: { id: string; message: string; resolve: (decision: MemoryToolApprovalDecision) => void } | null
  controller: AbortController
  timer: ReturnType<typeof setInterval> | null
  startedAt: number
  title?: string
  editTargetId: string
  memoryEnabled: boolean
  runtime: 'legacy' | 'dh'
  officialHistoryReady?: boolean
  officialUserBaseline?: number
}

/** Desktop run state survives workbench view remounts; the Web fallback stays page-scoped. */
export const desktopConversationRuns = reactive(new Map<string, MemoryRun>())

type DesktopConversationSelection = {
  projectName: string
  conversationTitle: string
  conversationId: string
  owner: string
  resourcePath: string
  modelId: string
  modelProviderId?: string
  /** 本会话的沙箱档位（官方三档）。不过线：`desktopConversationContext()` 不发它。 */
  permissionTier: DeepSeekPermissionTier
  skillNames?: string[]
  mediaSelected?: boolean
  avSelected?: boolean
  scene3dSelected?: boolean
  mcpServerIds?: string[]
  turns: ConversationTurn[]
}

const selectedConversation = shallowRef<DesktopConversationSelection | null>(null)
export const desktopRemoteCompleted = shallowRef<{
  runId: string
  owner: string
  resourcePath: string
  conversationId: string
  title?: string
  snapshot: DeepSeekSessionSnapshot
} | null>(null)
export const desktopRemoteSyncError = ref('')
let stopPublisher: (() => void) | null = null
let contextEventSeq = 0

export function setDesktopConversationSelection(selection: DesktopConversationSelection | null) {
  selectedConversation.value = selection
}

export function startDesktopConversationPublisher() {
  if (stopPublisher) return stopPublisher
  const publish = (sessionId: string, event: unknown) => {
    void publishDesktopRemoteEvent(sessionId, event).then(
      () => { desktopRemoteSyncError.value = '' },
      cause => { desktopRemoteSyncError.value = `手机状态同步失败：${cause instanceof Error ? cause.message : String(cause)}` },
    )
  }
  const stopContext = watch(
    () => JSON.stringify(desktopConversationContext()),
    (_value, previous) => {
      if (!previous && !desktopConversationContext().sessionId) return
      publish('', {
        version: 1, requestId: `context-${++contextEventSeq}`, type: 'context.changed',
        sentAt: Date.now(), payload: desktopConversationContext(),
      })
    },
    { immediate: true },
  )
  const stopState = watch(
    () => {
      const selected = selectedConversation.value
      if (!selected) return null
      return {
        sessionId: `jc-v1-${selected.conversationId}`,
        turns: desktopRemoteTurns(selected.turns),
        ...desktopConversationLiveState(selected.owner, selected.resourcePath),
      }
    },
    projection => {
      if (!projection) return
      const seq = nextDesktopRemoteEventSeq(projection.sessionId)
      publish(projection.sessionId, {
        version: 1, requestId: `event-${seq}`, type: 'session.event', sentAt: Date.now(),
        payload: { ...projection, ...desktopRemoteEventCursor(projection.sessionId), seq },
      })
    },
    { immediate: true },
  )
  stopPublisher = () => {
    stopContext()
    stopState()
    stopPublisher = null
  }
  return stopPublisher
}

export function desktopConversationContext() {
  const selected = selectedConversation.value
  return {
    projectName: selected?.projectName || '当前项目',
    conversationTitle: selected?.conversationTitle || '',
    conversationId: selected?.conversationId || '',
    sessionId: selected ? `jc-v1-${selected.conversationId}` : '',
  }
}

function selectedRun() {
  const selected = selectedConversation.value
  return selected ? desktopConversationRuns.get(memoryRunKey(selected.owner, selected.resourcePath)) ?? null : null
}

type RemoteExecution = (run: MemoryRun, selected: DesktopConversationSelection) => Promise<string>

export function createDesktopConversationHost(execute: RemoteExecution = executeDesktopRemoteText) {
  return new DesktopRemoteHost({
    getContext: desktopConversationContext,
    readSession: readDesktopConversationSession,
    sendMessage: async text => {
      const { beginDesktopUpdateTask } = await import('./desktopUpdater')
      const release = await beginDesktopUpdateTask()
      try { return startDesktopRemoteTextRun(text, execute) }
      finally { await release() }
    },
    stopRun: async () => {
      const run = selectedRun()
      if (run) stopRun(run)
      return run?.phase || 'idle'
    },
    respondApproval: async (approvalId, decision) => {
      const run = selectedRun()
      if (!run?.approval || run.approval.id !== approvalId) throw new RemoteProtocolError('APPROVAL_NOT_FOUND')
      settleApproval(run, decision === 'approve' ? 'once' : decision)
    },
    subscribe: () => () => undefined, // Rust LAN bridge owns the connection subscription.
    isBusy: () => selectedRun()?.phase === 'running',
  })
}

function startDesktopRemoteTextRun(text: string, execute: RemoteExecution) {
  const selected = selectedConversation.value
  if (!selected) throw new RemoteProtocolError('SESSION_NOT_CURRENT')
  const userTurn: ConversationTurn = {
    id: `turn-${crypto.randomUUID()}`, role: 'user', content: text,
    createdAt: new Date().toISOString(), skillNames: selected.skillNames || [],
    toolChips: [DEEPSEEK_HARNESS_SESSION_MARKER,
      ...(deepSeekPermissionChip(selected.permissionTier) ? [deepSeekPermissionChip(selected.permissionTier)!] : []),
      ...(selected.mediaSelected ? ['media'] : []),
      ...(selected.avSelected ? ['av'] : []),
      ...(selected.scene3dSelected ? ['scene3d'] : []),
      ...(selected.mcpServerIds || []).map(id => `mcp__${id}`)],
  }
  const title = !selected.turns.some(turn => turn.role === 'user') && selected.conversationTitle === '新对话'
    ? text.replace(/\s+/g, ' ').slice(0, 28) : undefined
  const run = beginMemoryRun(desktopConversationRuns, {
    owner: selected.owner, resourcePath: selected.resourcePath, conversationId: selected.conversationId,
    userTurn, title, editTargetId: '', runtime: 'dh',
  })
  run.officialUserBaseline = selected.turns.filter(turn => turn.role === 'user'
    && turn.toolChips?.includes(DEEPSEEK_HARNESS_SESSION_MARKER)).length
  beginRunStatus(run)
  void execute(run, selected).then(reply => {
    if (run.phase !== 'running') return
    if (!run.officialHistoryReady) run.streamingText ||= reply
    run.phase = 'done'
    if (!run.error) run.status = run.officialHistoryReady ? '已完成' : '等待会话同步'
  }, cause => {
    if (run.phase !== 'running') return
    run.phase = 'failed'
    run.status = '处理失败'
    run.error = cause instanceof Error ? cause.message : String(cause)
  }).finally(() => {
    settleApproval(run, 'reject')
    stopRunTimer(run)
  })
  return { runId: run.runId }
}

async function executeDesktopRemoteText(run: MemoryRun, selected: DesktopConversationSelection) {
  const userTurn = run.userTurn!
  const config = await resolveApiConfig({ modelId: selected.modelId, modelProviderId: selected.modelProviderId })
  const missing = deepSeekHandoffTurns(selected.turns)
  const handoff = missing.length ? buildCreativeContext({
    messages: [...missing, userTurn], modelId: config.model,
    contextWindow: DEEPSEEK_HARNESS_CONTEXT_WINDOW,
    reservedTokens: DEEPSEEK_HARNESS_MAX_OUTPUT_TOKENS + 32_768,
    maxHistoryRounds: Number.MAX_SAFE_INTEGER, maxHistoryTokens: Number.MAX_SAFE_INTEGER,
  }).messages.slice(0, -1) as ConversationTurn[] : []
  const query = {
    cwd: selected.owner, sessionId: selected.conversationId, message: '',
    model: config.model, apiBase: config.apiBase, apiKey: config.apiKey,
    imageInput: resolveModelInputModalities({ id: config.model, providerId: selected.modelProviderId }).includes('image'),
    permissionTier: selected.permissionTier,
    mediaSelected: selected.mediaSelected, avSelected: selected.avSelected,
    scene3dSelected: selected.scene3dSelected, mcpServerIds: selected.mcpServerIds,
  }
  const key = memoryRunKey(run.owner, run.resourcePath)
  const current = () => desktopConversationRuns.get(key) === run && run.phase === 'running'
  let reply: string
  try {
    reply = await executeDesktopHarnessRun(desktopConversationRuns, run, { ...query,
      message: deepSeekPrompt(userTurn.content, selected.skillNames || [], handoff),
    })
  } catch (cause) {
    if (desktopConversationRuns.get(key) === run && run.phase === 'stopped') {
      try { finishDesktopRemoteOfficialSession(run, selected, await readDeepSeekHarnessSession(query)) }
      catch (readCause) { run.error = `已停止；会话记录刷新失败：${readCause instanceof Error ? readCause.message : String(readCause)}` }
    }
    throw cause
  }
  if (!current()) return reply
  try {
    const snapshot = await readDeepSeekHarnessSession(query)
    if (!current()) return reply
    if (!finishDesktopRemoteOfficialSession(run, selected, snapshot)) run.status = '等待会话同步'
  } catch (cause) {
    run.status = '任务已完成，会话刷新失败'
    run.error = cause instanceof Error ? cause.message : String(cause)
  }
  return reply
}

export function desktopRemoteOfficialHistoryReady(
  snapshot: DeepSeekSessionSnapshot, baseline: number, userText: string, sentAt: string,
) {
  const users = deepSeekSessionTurns(snapshot).filter(turn => turn.role === 'user')
  const lastEvent = [...(snapshot.events || [])].reverse().find(event =>
    event?.type === 'user/message' && event.data?.source?.kind === 'user')
  return users.length > baseline && users.at(-1)?.content === userText
    && Number.isFinite(Date.parse(sentAt)) && Number(lastEvent?.time) >= Date.parse(sentAt)
}

function finishDesktopRemoteOfficialSession(
  run: MemoryRun, selected: DesktopConversationSelection, snapshot: DeepSeekSessionSnapshot,
) {
  const userTurn = run.userTurn
  if (!userTurn || run.officialUserBaseline === undefined
    || !desktopRemoteOfficialHistoryReady(snapshot, run.officialUserBaseline, userTurn.content, userTurn.createdAt)) return false
  const now = new Date().toISOString()
  const existing = listHarnessConversationCatalog(selected.owner).find(item => item.conversationId === selected.conversationId)
  upsertHarnessConversationCatalogEntry({
    conversationId: selected.conversationId, sessionId: `jc-v1-${selected.conversationId}`,
    workspaceKey: selected.owner, title: run.title || existing?.title || selected.conversationTitle,
    createdAt: existing?.createdAt || userTurn.createdAt, updatedAt: now,
    ...(existing?.legacyRawPath || !selected.resourcePath.startsWith('.harness-conversations/')
      ? { legacyRawPath: existing?.legacyRawPath || selected.resourcePath, migratedAt: now } : {}),
  })
  const currentSelection = selectedConversation.value
  if (currentSelection?.owner === selected.owner && currentSelection.conversationId === selected.conversationId)
    setDesktopConversationSelection({ ...selected, conversationTitle: run.title || selected.conversationTitle,
      turns: deepSeekSessionTurns(snapshot) })
  desktopRemoteCompleted.value = {
    runId: run.runId, owner: run.owner, resourcePath: run.resourcePath,
    conversationId: run.conversationId, title: run.title, snapshot,
  }
  run.officialHistoryReady = true
  run.userTurn = null
  if (run.phase !== 'stopped' || snapshot.events.some(event => deepSeekAssistantText(event).trim() === run.streamingText.trim()))
    run.streamingText = ''
  run.error = ''
  run.status = run.phase === 'stopped' ? '已停止' : '已完成'
  return true
}

export const memoryRunKey = (owner: string, path: string) => `${owner}::${path}`

export function beginMemoryRun(
  runs: Map<string, MemoryRun>,
  input: Pick<MemoryRun, 'owner' | 'resourcePath' | 'conversationId' | 'title' | 'editTargetId' | 'runtime'>
    & { userTurn: ConversationTurn },
) {
  const key = memoryRunKey(input.owner, input.resourcePath)
  if (runs.get(key)?.phase === 'running') throw new RemoteProtocolError('SESSION_BUSY')
  runs.set(key, {
    runId: input.userTurn.id,
    owner: input.owner,
    resourcePath: input.resourcePath,
    conversationId: input.conversationId,
    phase: 'running', status: '正在思考', error: '', streamingText: '', reasoning: '',
    steps: [], elapsed: 0, metrics: null, userTurn: input.userTurn,
    programStatus: null, approval: null, controller: new AbortController(), timer: null,
    startedAt: Date.now(), title: input.title, editTargetId: input.editTargetId,
    memoryEnabled: false, runtime: input.runtime,
  })
  return runs.get(key)!
}

export function desktopRemoteTurns(turns: ConversationTurn[]) {
  return turns.map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt }))
}

export function desktopConversationLiveState(owner: string, path: string) {
  const run = desktopConversationRuns.get(memoryRunKey(owner, path))
  return {
    streamingText: run?.streamingText || '',
    pendingTurn: run?.userTurn ? desktopRemoteTurns([run.userTurn])[0] : undefined,
    run: run ? {
      runId: run.runId,
      state: run.phase,
      status: run.status,
      error: run.error,
      steps: run.steps.map(({ id, label, state, durationMs, errorReason }) => ({ id, label, state, durationMs, errorReason })),
      approval: run.approval ? { id: run.approval.id, message: run.approval.message } : null,
    } : { state: 'idle', steps: [], approval: null },
  }
}

function assertSelectedSession(sessionId: string, selected: DesktopConversationSelection) {
  const current = selectedConversation.value
  if (!current || `jc-v1-${current.conversationId}` !== sessionId
    || current.owner !== selected.owner || current.resourcePath !== selected.resourcePath)
    throw new Error('SESSION_NOT_CURRENT')
}

function desktopConversationProjection(
  sessionId: string,
  selected: DesktopConversationSelection,
  snapshot?: DeepSeekSessionSnapshot,
) {
  return {
    sessionId,
    ...desktopRemoteEventCursor(sessionId),
    turns: snapshot ? desktopRemoteTurns(deepSeekSessionTurns(snapshot)) : [],
    process: snapshot ? Object.fromEntries([...deepSeekSessionProcess(snapshot)].map(([turnId, steps]) => [
      turnId,
      steps.map(({ id, label, state, durationMs, errorReason }) => ({ id, label, state, durationMs, errorReason })),
    ])) : {},
    reasoning: snapshot ? Object.fromEntries(deepSeekSessionReasoning(snapshot)) : {},
    ...desktopConversationLiveState(selected.owner, selected.resourcePath),
  }
}

export async function readDesktopConversationSession(sessionId: string) {
  const selected = selectedConversation.value
  if (!selected) throw new Error('SESSION_NOT_CURRENT')
  assertSelectedSession(sessionId, selected)
  const config = await resolveApiConfig({ modelId: selected.modelId, modelProviderId: selected.modelProviderId })
  const query = {
    cwd: selected.owner,
    sessionId: selected.conversationId,
    message: '',
    model: config.model,
    apiBase: config.apiBase,
    apiKey: config.apiKey,
    imageInput: resolveModelInputModalities({ id: config.model, providerId: selected.modelProviderId }).includes('image'),
    permissionTier: selected.permissionTier,
  }
  const sessions = await listDeepSeekHarnessSessions(query)
  assertSelectedSession(sessionId, selected)
  if (!deepSeekSessionExists(sessions, selected.conversationId))
    return desktopConversationProjection(sessionId, selected)
  const snapshot = await readDeepSeekHarnessSession(query)
  assertSelectedSession(sessionId, selected)
  const run = desktopConversationRuns.get(memoryRunKey(selected.owner, selected.resourcePath))
  if ((run?.phase === 'done' || run?.phase === 'stopped') && !run.officialHistoryReady && run.conversationId === selected.conversationId)
    finishDesktopRemoteOfficialSession(run, selected, snapshot)
  return desktopConversationProjection(sessionId, selected, snapshot)
}

export function settleApproval(run: MemoryRun | null, decision: MemoryToolApprovalDecision) {
  const pending = run?.approval
  if (!run || !pending) return
  run.approval = null
  pending.resolve(decision)
}

export function stopRunTimer(run: MemoryRun) {
  if (run.timer) clearInterval(run.timer)
  run.timer = null
}

/** Stop one run without affecting other conversations or the workbench view. */
export function stopRun(run: MemoryRun) {
  if (run.phase !== 'running') return
  run.phase = 'stopped'
  run.status = '已停止'
  stopRunTimer(run)
  settleApproval(run, 'reject')
  run.controller.abort()
  // Stop execution; retain the accepted input and observed output until official history replaces them.
}

export function beginRunStatus(run: MemoryRun) {
  stopRunTimer(run)
  run.elapsed = 0
  run.steps = []
  run.reasoning = ''
  run.metrics = null
  run.startedAt = Date.now()
  run.timer = setInterval(() => { run.elapsed = Math.floor((Date.now() - run.startedAt) / 1000) }, 1000)
}

export async function executeDesktopHarnessRun(
  runs: Map<string, MemoryRun>,
  run: MemoryRun,
  input: Omit<DeepSeekHarnessInput, 'signal' | 'onStatus' | 'onText' | 'onReasoning' | 'onProgress'>,
  execute: (input: DeepSeekHarnessInput) => Promise<string> = runDeepSeekHarness,
) {
  const current = () => runs.get(memoryRunKey(run.owner, run.resourcePath)) === run && run.phase === 'running'
  if (!current() || run.controller.signal.aborted) throw new RemoteProtocolError('RUN_STOPPED')
  let approvalQueue: Promise<unknown> = Promise.resolve()
  let closed = false
  try {
    return await execute({ ...input, signal: run.controller.signal,
      onPermission(tier) { if (current()) run.permissionTier = tier },
      onApproval(request, signal) {
        const answer = approvalQueue.then(() => new Promise<'allowed-once' | 'rejected'>(resolve => {
          if (closed || !current() || signal.aborted || run.controller.signal.aborted) { resolve('rejected'); return }
          let settled = false
          const finish = (decision: MemoryToolApprovalDecision) => {
            if (settled) return
            settled = true
            signal.removeEventListener('abort', abort)
            run.controller.signal.removeEventListener('abort', abort)
            if (run.approval?.id === request.id) run.approval = null
            if (current()) run.status = '正在等待模型继续处理'
            resolve(decision === 'once' ? 'allowed-once' : 'rejected')
          }
          const abort = () => finish('reject')
          signal.addEventListener('abort', abort, { once: true })
          run.controller.signal.addEventListener('abort', abort, { once: true })
          const step = run.steps.find(item => item.id === request.callId)
          run.approval = { id: request.id, message: [request.toolName, request.target || step?.summary, request.displayReason?.zh || request.reason || '此操作需要你的授权'].filter(Boolean).join(' · '), resolve: finish }
          run.status = '等待你的授权'
        }))
        approvalQueue = answer
        return answer
      },
      onStatus(status) { if (current() && !run.approval) run.status = status },
      onText(text) { if (current()) { if (!run.approval) run.status = '正在执行'; run.streamingText = text } },
      onReasoning(text) { if (current()) run.reasoning = text },
      onProgress(progress) {
        if (!current()) return
        const step = run.steps.find(item => item.id === progress.id)
        // 重试条目按事件推进：`llm/retry` 建行、`llm/retry-started` 只推状态。
        // 它没有工具名，不能走下面那条「label 缺省成执行工具」的分支。
        if (progress.kind === 'retry') {
          if (!step) run.steps.push({ id: progress.id, kind: 'retry', label: '', summary: '',
            state: progress.state, retryState: progress.retryState, retry: progress.retry,
            startedAt: progress.startedAt })
          else {
            step.state = progress.state
            if (progress.retryState) step.retryState = progress.retryState
          }
          return
        }
        if (progress.state === 'running') {
          if (!step) run.steps.push({ id: progress.id, label: progress.label || '执行工具',
            state: 'running', summary: progress.summary, startedAt: progress.startedAt })
          if (!run.approval) run.status = `正在${progress.label || '执行工具'}`
          return
        }
        if (step) {
          step.state = progress.state
          step.errorReason = progress.errorReason
          step.resultText = progress.resultText
          step.resultTruncated = progress.resultTruncated
          if (step.startedAt !== undefined && progress.endedAt !== undefined && progress.endedAt >= step.startedAt)
            step.durationMs = progress.endedAt - step.startedAt
        }
        const running = run.steps.find(item => item.state === 'running')
        if (!run.approval) run.status = running ? `正在${running.label}` : '正在等待模型继续处理'
        if (progress.state === 'failed' && /\[sandbox: file access denied under (?:read-only|workspace-write|danger-full-access) mode\]/.test(progress.resultText || progress.errorReason || ''))
          run.permissionNotice = '操作被当前权限限制。可调整权限，或在下一次授权请求中本次允许。'
      },
    })
  } finally {
    closed = true
    settleApproval(run, 'reject')
  }
}
