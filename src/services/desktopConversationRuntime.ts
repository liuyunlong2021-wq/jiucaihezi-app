import { isProductionSelection, productionRoute, productionMode, type ProductionRoute } from '@/runtime/memory/productionSkills'
import { restoreProductionSelection } from '@/runtime/memory/productionSelection'
import { WIKI_MEMORY_SKILL } from '@/runtime/memory/manjuProduction'
import { needsProjectWiki } from '@/runtime/memory/projectWiki'
import { reactive, ref, shallowRef, watch } from 'vue'
import type { DirectRunMetrics } from '@/runtime/direct/directTypes'
import type { MemoryProgramStatus } from '@/runtime/memory/memoryChat'
import type { ConversationTurn } from '@/runtime/memory/conversationTranscript'
import {
  createHarnessConversationCatalogEntry,
  listHarnessConversationCatalog,
  updateHarnessConversationPreferences,
  upsertHarnessConversationCatalogEntry,
} from '@/runtime/memory/harnessConversationCatalog'
import {
  DEEPSEEK_HARNESS_SESSION_MARKER,
  applyDeepSeekInboxEvent,
  deepSeekHandoffTurns,
  deepSeekAssistantText,
  deepSeekPermissionChip,
  deepSeekPrompt,
  deepSeekSessionExists,
  deepSeekSessionId,
  deepSeekSessionInbox,
  deepSeekSessionProcess,
  deepSeekSessionReasoning,
  deepSeekSessionTurns,
  deepSeekDeliverables,
  listDeepSeekHarnessSessions,
  readDeepSeekHarnessSession,
  runDeepSeekHarness,
  type DeepSeekHarnessInput,
  type DeepSeekInboxItem,
  type DeepSeekPermissionTier,
  type DeepSeekReadFileMeta,
  type DeepSeekRetry,
  type DeepSeekRetryState,
  type DeepSeekSessionSnapshot,
  type DeepSeekUsage,
} from './deepSeekHarness'
import { DesktopRemoteHost, type DesktopRemoteSessionSummary } from './desktopRemoteHost'
import { desktopRemoteEventCursor, nextDesktopRemoteEventSeq } from './desktopRemoteEventSeq'
import { publishDesktopRemoteEvent } from './desktopRemoteBridge'
import { listRemoteFiles, readRemoteFile } from './desktopRemoteFiles'
import { manjuAutoProjection, runManjuCommand } from './desktopRemoteManju'
import { RemoteProtocolError } from './desktopRemoteProtocol'
import { resolveModelInputModalities } from '@/runtime/direct/modelInputCapabilities'
import { buildWikiMemoryIndexContext } from '@/runtime/memory/memoryChat'
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
  parentCallId?: string
  rootCallId?: string
  readFile?: DeepSeekReadFileMeta
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
  usage?: DeepSeekUsage
  deliverables?: Array<{ path: string; description?: string }>
  inbox?: DeepSeekInboxItem[]
  userTurn: ConversationTurn | null
  programStatus: MemoryProgramStatus | null
  permissionTier?: DeepSeekPermissionTier
  permissionNotice?: string
  harnessModel?: string
  harnessProviderId?: string
  approval: { id: string; message: string; resolve: (decision: MemoryToolApprovalDecision) => void } | null
  controller: AbortController
  timer: ReturnType<typeof setInterval> | null
  startedAt: number
  title?: string
  /** Display-only association used to hand the live Markdown nodes to the authoritative answer. */
  officialAssistantTurnId?: string
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
/** 手机新建了对话：工作台据此刷新对话列表。 */
export const desktopRemoteCatalogChanged = ref(0)
/** 手机改了某个对话的创作模式：若电脑正开着它，工作台据此恢复输入框里的模式。 */
export const desktopRemoteModeChanged = shallowRef<{ owner: string; conversationId: string } | null>(null)
let stopPublisher: (() => void) | null = null
let contextEventSeq = 0

export function setDesktopConversationSelection(selection: DesktopConversationSelection | null) {
  selectedConversation.value = selection
}

/** 与工作台 `conversationFromCatalog` 的资源路径同一格式：运行表按它取同一个 run。 */
const HARNESS_CONVERSATION_PREFIX = '.harness-conversations'

/**
 * 手机列出过、可以在后台推进的对话（M2），键是 sessionId。
 *
 * 只认电脑当前项目：一个工作区同时只归一个窗口，运行表也是每个窗口各一份，
 * 在这里跑别的项目会和那个窗口的 runner 撞同一个会话写锁（见 `claimWorkspace`）。
 */
const remoteSessionTargets = new Map<string, {
  owner: string
  conversationId: string
  conversationTitle: string
  resourcePath: string
  turns: ConversationTurn[]
}>()

/** 手机指定的对话在电脑上的执行上下文；不认识或不属于当前项目时为 null。 */
function desktopRemoteSelection(sessionId: string): DesktopConversationSelection | null {
  const current = selectedConversation.value
  if (!current || !sessionId) return null
  if (deepSeekSessionId(current.conversationId, current.owner) === sessionId) return current
  const target = remoteSessionTargets.get(sessionId)
  if (!target || target.owner !== current.owner) return null
  // 模型、权限档、MCP 沿用电脑当前设置；A 的 Skill 与媒体开关不带给 B，
  // B 的创作模式按电脑记住的偏好恢复，与电脑打开 B 时同一条规则。
  // 标题以对话目录的实时值为准：B 在列出之后可能已被自动改名。
  const title = listHarnessConversationCatalog(current.owner)
    .find(item => item.conversationId === target.conversationId)?.title || target.conversationTitle
  return { ...current, conversationTitle: title, conversationId: target.conversationId,
    resourcePath: target.resourcePath, skillNames: rememberedProductionSkills(current.owner, target.conversationId, target.turns),
    mediaSelected: false, avSelected: false, scene3dSelected: false, turns: target.turns }
}

function rememberedProductionSkills(owner: string, conversationId: string, turns: ConversationTurn[]) {
  const entry = listHarnessConversationCatalog(owner).find(item => item.conversationId === conversationId)
  const latest = [...turns].reverse().find(turn => turn.role === 'user')
  return restoreProductionSelection(latest?.skillNames, entry?.manju, entry?.novel, entry?.shortDrama)
    .filter(name => isProductionSelection(name) || name === WIKI_MEMORY_SKILL)
}

const REMOTE_MODES: readonly ProductionRoute[] = ['manju', 'short-drama', 'novel', 'none']

function remoteMode(selected: DesktopConversationSelection): ProductionRoute {
  return productionRoute(selected.skillNames || [])
}

/** 手机切换对话的创作模式：与电脑上点「漫剧制作 / 短剧改编 / 小说创作」写同一份对话偏好。 */
async function setDesktopRemoteMode(sessionId: string, mode: string) {
  if (!REMOTE_MODES.includes(mode as ProductionRoute)) throw new RemoteProtocolError('MODE_INVALID')
  const selected = desktopRemoteSelection(sessionId)
  if (!selected) throw new RemoteProtocolError('SESSION_NOT_FOUND')
  if (desktopConversationRuns.get(memoryRunKey(selected.owner, selected.resourcePath))?.phase === 'running')
    throw new RemoteProtocolError('SESSION_BUSY')
  const entry = listHarnessConversationCatalog(selected.owner).find(item => item.conversationId === selected.conversationId)
  const wikiMemoryWasSelected = entry?.manju?.wikiMemoryWasSelected ?? entry?.novel?.wikiMemoryWasSelected
    ?? entry?.shortDrama?.wikiMemoryWasSelected ?? (selected.skillNames || []).includes(WIKI_MEMORY_SKILL)
  await updateHarnessConversationPreferences(selected.owner, selected.conversationId, {
    manju: { ...entry?.manju, enabled: mode === 'manju', wikiMemoryWasSelected },
    novel: { ...entry?.novel, enabled: mode === 'novel', wikiMemoryWasSelected },
    shortDrama: { ...entry?.shortDrama, enabled: mode === 'short-drama', wikiMemoryWasSelected },
  })
  const current = selectedConversation.value
  if (current && deepSeekSessionId(current.conversationId, current.owner) === sessionId)
    setDesktopConversationSelection({ ...current, skillNames: rememberedProductionSkills(current.owner, current.conversationId, current.turns) })
  desktopRemoteModeChanged.value = { owner: selected.owner, conversationId: selected.conversationId }
  return { mode }
}

async function invokeDesktop(command: string, args: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke(command, args)
}

/** 项目的对外标识：不把电脑上的绝对路径发给手机。 */
async function remoteProjectId(owner: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner))
  return `p-${Array.from(new Uint8Array(digest).slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

async function remoteProjectOwner(projectId: string) {
  const current = selectedConversation.value
  if (!current || projectId !== await remoteProjectId(current.owner)) throw new RemoteProtocolError('PROJECT_NOT_FOUND')
  return current
}

async function listDesktopRemoteProjects() {
  const current = selectedConversation.value
  return current ? [{ projectId: await remoteProjectId(current.owner), name: current.projectName, current: true }] : []
}

async function listDesktopRemoteSessions(projectId: string): Promise<DesktopRemoteSessionSummary[]> {
  const current = await remoteProjectOwner(projectId)
  const currentSessionId = deepSeekSessionId(current.conversationId, current.owner)
  return listHarnessConversationCatalog(current.owner).reverse().slice(0, 100).map(entry => {
    const sessionId = deepSeekSessionId(entry.conversationId, current.owner)
    const resourcePath = entry.legacyRawPath || `${HARNESS_CONVERSATION_PREFIX}/${entry.conversationId}.md`
    remoteSessionTargets.set(sessionId, { owner: current.owner, conversationId: entry.conversationId,
      conversationTitle: entry.title, resourcePath, turns: remoteSessionTargets.get(sessionId)?.turns ?? [] })
    const selected = desktopRemoteSelection(sessionId)
    return { sessionId, title: entry.title, updatedAt: entry.updatedAt, current: sessionId === currentSessionId,
      running: desktopConversationRuns.get(memoryRunKey(current.owner, resourcePath))?.phase === 'running',
      mode: selected ? remoteMode(selected) : 'none' }
  })
}

async function createDesktopRemoteSession(projectId: string) {
  const current = await remoteProjectOwner(projectId)
  const entry = await createHarnessConversationCatalogEntry(current.owner)
  const sessionId = deepSeekSessionId(entry.conversationId, current.owner)
  remoteSessionTargets.set(sessionId, { owner: current.owner, conversationId: entry.conversationId,
    conversationTitle: entry.title, resourcePath: `${HARNESS_CONVERSATION_PREFIX}/${entry.conversationId}.md`, turns: [] })
  desktopRemoteCatalogChanged.value += 1
  return { projectName: current.projectName, conversationTitle: entry.title, conversationId: entry.conversationId, sessionId }
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
        sessionId: deepSeekSessionId(selected.conversationId, selected.owner),
        turns: desktopRemoteTurns(selected.turns),
        mode: remoteMode(selected),
        title: selected.conversationTitle,
        manjuAuto: manjuAutoProjection(selected.owner),
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
  // 电脑当前对话之外、手机正在推进的对话：只推运行进度，历史等结束后手机从官方会话读。
  const backgroundPublished = new Map<string, string>()
  const stopBackground = watch(
    () => JSON.stringify([...desktopConversationRuns.values()].flatMap(run => {
      const sessionId = deepSeekSessionId(run.conversationId, run.owner)
      if (!remoteSessionTargets.has(sessionId) || sessionId === desktopConversationContext().sessionId) return []
      const selected = desktopRemoteSelection(sessionId)
      return [{ sessionId, ...desktopConversationLiveState(run.owner, run.resourcePath),
        ...selected ? { mode: remoteMode(selected), title: selected.conversationTitle } : {} }]
    })),
    value => {
      for (const projection of JSON.parse(value) as Array<{ sessionId: string }>) {
        const text = JSON.stringify(projection)
        if (backgroundPublished.get(projection.sessionId) === text) continue
        backgroundPublished.set(projection.sessionId, text)
        const seq = nextDesktopRemoteEventSeq(projection.sessionId)
        publish(projection.sessionId, {
          version: 1, requestId: `event-${seq}`, type: 'session.event', sentAt: Date.now(),
          payload: { ...projection, ...desktopRemoteEventCursor(projection.sessionId), seq },
        })
      }
    },
  )
  stopPublisher = () => {
    stopContext()
    stopState()
    stopBackground()
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
    sessionId: selected ? deepSeekSessionId(selected.conversationId, selected.owner) : '',
  }
}

function remoteRun(sessionId: string) {
  const selected = desktopRemoteSelection(sessionId)
  return selected ? desktopConversationRuns.get(memoryRunKey(selected.owner, selected.resourcePath)) ?? null : null
}

type RemoteExecution = (run: MemoryRun, selected: DesktopConversationSelection) => Promise<string>

export function createDesktopConversationHost(execute: RemoteExecution = executeDesktopRemoteText) {
  return new DesktopRemoteHost({
    getContext: desktopConversationContext,
    hasSession: sessionId => desktopRemoteSelection(sessionId) !== null,
    listProjects: listDesktopRemoteProjects,
    listSessions: listDesktopRemoteSessions,
    createSession: createDesktopRemoteSession,
    setMode: setDesktopRemoteMode,
    manju: async (sessionId, type, payload) => {
      // 全自动成片驱动的是电脑当前打开的对话（逐集往它发指令），后台对话不开放。
      const current = selectedConversation.value
      if (!current || deepSeekSessionId(current.conversationId, current.owner) !== sessionId)
        throw new RemoteProtocolError('MANJU_NOT_CURRENT')
      return await runManjuCommand(current.owner, type, payload)
    },
    listFiles: async (projectId, path) =>
      await listRemoteFiles((await remoteProjectOwner(projectId)).owner, path, invokeDesktop),
    readFile: async (projectId, path, offset) =>
      await readRemoteFile((await remoteProjectOwner(projectId)).owner, path, offset, invokeDesktop),
    readSession: readDesktopConversationSession,
    sendMessage: async (text, sessionId) => {
      const { beginDesktopUpdateTask } = await import('./desktopUpdater')
      const release = await beginDesktopUpdateTask()
      try { return startDesktopRemoteTextRun(text, execute, sessionId) }
      finally { await release() }
    },
    stopRun: async sessionId => {
      const run = remoteRun(sessionId)
      if (run) stopRun(run)
      return run?.phase || 'idle'
    },
    respondApproval: async (approvalId, decision, sessionId) => {
      const run = remoteRun(sessionId)
      if (!run?.approval || run.approval.id !== approvalId) throw new RemoteProtocolError('APPROVAL_NOT_FOUND')
      settleApproval(run, decision === 'approve' ? 'once' : decision)
    },
    subscribe: () => () => undefined, // Rust LAN bridge owns the connection subscription.
    isBusy: sessionId => remoteRun(sessionId)?.phase === 'running',
  })
}

function startDesktopRemoteTextRun(text: string, execute: RemoteExecution, sessionId: string) {
  const selected = desktopRemoteSelection(sessionId)
  if (!selected) throw new RemoteProtocolError('SESSION_NOT_FOUND')
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
  const handoff = missing
  const query = {
    cwd: selected.owner, sessionId: selected.conversationId, message: '',
    model: config.model, apiBase: config.apiBase, apiKey: config.apiKey,
    modelProviderId: selected.modelProviderId,
    imageInput: resolveModelInputModalities({ id: config.model, providerId: selected.modelProviderId }).includes('image'),
    permissionTier: selected.permissionTier,
    mediaSelected: selected.mediaSelected, avSelected: selected.avSelected,
    scene3dSelected: selected.scene3dSelected, mcpServerIds: selected.mcpServerIds,
  }
  run.harnessModel = config.model
  run.harnessProviderId = selected.modelProviderId
  const key = memoryRunKey(run.owner, run.resourcePath)
  const current = () => desktopConversationRuns.get(key) === run && run.phase === 'running'
  let reply: string
  try {
    reply = await executeDesktopHarnessRun(desktopConversationRuns, run, { ...query,
      productionMode: productionMode(selected.skillNames || []),
      productionRoute: productionRoute(selected.skillNames || []),
      message: deepSeekPrompt(
        userTurn.content,
        selected.skillNames || [],
        handoff,
        needsProjectWiki(userTurn.content, selected.skillNames || []) ? await buildWikiMemoryIndexContext(selected.owner) : '',
      ),
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
  const sentAtMs = Date.parse(sentAt)
  return users.length > baseline && Number.isFinite(sentAtMs)
    && users.some(turn => turn.content === userText && Date.parse(turn.createdAt) >= sentAtMs)
}

function finishDesktopRemoteOfficialSession(
  run: MemoryRun, selected: DesktopConversationSelection, snapshot: DeepSeekSessionSnapshot,
) {
  const userTurn = run.userTurn
  if (!userTurn || run.officialUserBaseline === undefined
    || !desktopRemoteOfficialHistoryReady(snapshot, run.officialUserBaseline, userTurn.content, userTurn.createdAt)) return false
  const now = new Date().toISOString()
  const sessionTurns = deepSeekSessionTurns(snapshot)
  const sentAtMs = Date.parse(userTurn.createdAt)
  const baseline = run.officialUserBaseline
  const userIndex = sessionTurns.findIndex((turn, index) => index >= baseline
    && turn.role === 'user' && turn.content === userTurn.content
    && Date.parse(turn.createdAt) >= sentAtMs)
  run.officialAssistantTurnId = sessionTurns.slice(userIndex + 1).find(turn => turn.role === 'assistant')?.id
  const existing = listHarnessConversationCatalog(selected.owner).find(item => item.conversationId === selected.conversationId)
  upsertHarnessConversationCatalogEntry({
    conversationId: selected.conversationId, sessionId: deepSeekSessionId(selected.conversationId, selected.owner),
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
    memoryEnabled: false, runtime: input.runtime, inbox: [],
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
  const current = desktopRemoteSelection(sessionId)
  if (!current || current.owner !== selected.owner || current.resourcePath !== selected.resourcePath)
    throw new RemoteProtocolError('SESSION_NOT_FOUND')
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
    mode: remoteMode(selected),
    title: selected.conversationTitle,
    manjuAuto: selected === selectedConversation.value ? manjuAutoProjection(selected.owner) : null,
    ...desktopConversationLiveState(selected.owner, selected.resourcePath),
  }
}

export async function readDesktopConversationSession(sessionId: string) {
  const selected = desktopRemoteSelection(sessionId)
  if (!selected) throw new RemoteProtocolError('SESSION_NOT_FOUND')
  const config = await resolveApiConfig({ modelId: selected.modelId, modelProviderId: selected.modelProviderId })
  const query = {
    cwd: selected.owner,
    sessionId: selected.conversationId,
    message: '',
    model: config.model,
    apiBase: config.apiBase,
    apiKey: config.apiKey,
    modelProviderId: selected.modelProviderId,
    imageInput: resolveModelInputModalities({ id: config.model, providerId: selected.modelProviderId }).includes('image'),
    permissionTier: selected.permissionTier,
  }
  const sessions = await listDeepSeekHarnessSessions(query)
  assertSelectedSession(sessionId, selected)
  if (!deepSeekSessionExists(sessions, selected.conversationId))
    return desktopConversationProjection(sessionId, selected)
  const snapshot = await readDeepSeekHarnessSession(query)
  assertSelectedSession(sessionId, selected)
  // 后台对话下一次发送按官方历史计基线、做交接。
  const target = remoteSessionTargets.get(sessionId)
  if (target) target.turns = deepSeekSessionTurns(snapshot)
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
      onArtifactSaved(path) { if (current()) input.onArtifactSaved?.(path) },
      onReasoning(text) { if (current()) run.reasoning = text },
      onUsage(usage) { if (current()) run.usage = usage },
      onSessionEvent(event) {
        if (current()) {
          run.inbox = applyDeepSeekInboxEvent(run.inbox || [], event)
          if (event?.type === 'turn/start') run.deliverables = []
          if (event?.type === 'deliverables/presented') {
            const existing = new Map((run.deliverables || []).map(file => [file.path, file]))
            for (const file of deepSeekDeliverables([event])) if (!existing.has(file.path)) existing.set(file.path, file)
            run.deliverables = [...existing.values()]
          }
        }
      },
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
            state: 'running', summary: progress.summary, startedAt: progress.startedAt,
            parentCallId: progress.parentCallId, rootCallId: progress.rootCallId,
            readFile: progress.readFile })
          if (!run.approval) run.status = `正在${progress.label || '执行工具'}`
          return
        }
        if (step) {
          step.state = progress.state
          step.errorReason = progress.errorReason
          step.resultText = progress.resultText
          step.resultTruncated = progress.resultTruncated
          step.parentCallId = progress.parentCallId || step.parentCallId
          step.rootCallId = progress.rootCallId || step.rootCallId
          step.readFile = progress.readFile || step.readFile
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
