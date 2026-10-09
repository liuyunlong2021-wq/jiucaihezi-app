import { invoke } from '@tauri-apps/api/core'
import { appDataDir, join, resolveResource } from '@tauri-apps/api/path'
import { mkdir, writeTextFile } from '@tauri-apps/plugin-fs'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { DirectMessageFile, ResolvedDirectAttachment } from '@/utils/directMessageBuilder'
import type { ConversationTurn } from '@/runtime/memory/conversationTranscript'
import { McpStdioTransport } from './mcpStdioTransport'
import { computerUseEnabledNow } from '@/stores/agentStore'
import { MANJU_ROUTER, manjuRoutePrompt } from '@/runtime/memory/manjuProduction'

type BridgeMessage = {
  type: 'ready' | 'notification' | 'result' | 'query-result' | 'error' | 'closed'
  requestId?: string
  notification?: { method?: string; params?: any }
  text?: string
  data?: unknown
  error?: string
  errorName?: string
  errorCode?: string
}
type Runtime = {
  key: string
  transport: McpStdioTransport
  runs: Map<string, {
    resolve: (value: any) => void
    reject: (error: Error) => void
    notify: (notification: NonNullable<BridgeMessage['notification']>) => void
  }>
  /** 宿主确认的会话预设，只在 runtime 存活期内保留。 */
  permissions: Map<string, string>
  permissionListeners: Map<string, (tier: DeepSeekPermissionTier) => void>
  closed: Promise<void>
  markClosed: () => void
  ended?: boolean
  closing?: Promise<void>
}
type RuntimeSlot = { key: string; ready: Promise<Runtime> }

export interface DeepSeekHarnessInput {
  cwd: string
  sessionId: string
  message: string
  model: string
  apiBase: string
  apiKey: string
  /**
   * 当前模型是否声明图片输入。官方对「没声明」的模型按纯文本处理，图片既不会内联进
   * 请求，`read_image` 也会被直接拒掉，于是「看一眼图片」退化成找文件、找 OCR。
   */
  imageInput?: boolean
  /** 本会话的沙箱档位；不传即官方默认档。 */
  permissionTier?: DeepSeekPermissionTier
  mediaSelected?: boolean
  avSelected?: boolean
  scene3dSelected?: boolean
  mcpServerIds?: string[]
  files?: DirectMessageFile[]
  attachments?: ResolvedDirectAttachment[]
  signal?: AbortSignal
  onText?: (text: string) => void
  /** 漫剧产物成功保存后，用于刷新并定位文件树。 */
  onArtifactSaved?: (path: string) => void
  onStatus?: (status: string) => void
  /** 实时推理正文；只在内容真的变化时回调，与 `onText` 分开、不混进消息体。 */
  onReasoning?: (text: string) => void
  onProgress?: (progress: DeepSeekProgress) => void
  onSessionEvent?: (event: any) => void
  onUsage?: (usage: DeepSeekUsage | undefined) => void
  onPermission?: (tier: DeepSeekPermissionTier) => void
  onApproval?: (request: DeepSeekApprovalRequest, signal: AbortSignal) => Promise<'allowed-once' | 'rejected'>
}

export type DeepSeekApprovalRequest = {
  id: string
  sessionId: string
  agentId: string
  requestSessionId?: string
  turn?: number
  callId?: string
  toolName: string
  target?: string
  reason?: string
  displayReason?: { zh?: string; en?: string }
}

export type DeepSeekProgress = {
  id: string
  label?: string
  state: 'running' | 'done' | 'failed'
  /** 白名单字段拼出的参数摘要；解析失败或没有白名单字段时是空串。 */
  summary?: string
  /** 工具调用的会话时间戳，用来算时长。 */
  startedAt?: number
  endedAt?: number
  errorReason?: string
  resultText?: string
  resultTruncated?: boolean
  parentCallId?: string
  rootCallId?: string
  readFile?: DeepSeekReadFileMeta
  /** 重试进度用：条目种类、官方 `retryState` 与重试事实（实时与历史同源）。 */
  kind?: 'retry'
  retryState?: DeepSeekRetryState
  retry?: DeepSeekRetry
}

/** 官方 `llm/retry` / `llm/retry-started` 里的重试状态（官方 UI 的 `retryState`）。 */
export type DeepSeekRetryState = 'scheduled' | 'started' | 'cancelled'

/** 一条重试的原始事实，字段名跟着官方事件走，不在中间层改名。 */
export type DeepSeekRetry = {
  /** 官方 `retry`：第几次重试（从 1 开始）。 */
  attempt: number
  /** 官方 `maxRetries`；`mode: 'always'` 的事件不带它，官方 UI 显示 `∞`。 */
  maximum: number | '∞'
  /** 官方 `delayMs`：这次等待的时长。 */
  delayMs: number
  /** 官方 `failure.code`；上游不一定给。 */
  failureCode?: string
  failureMessage: string
}

/** 一次工具调用在 UI 上的完整投影（实时与历史同源）。 */
export type DeepSeekProcessStep = {
  id: string
  /**
   * 条目种类。`tool`（默认）是一次工具调用；`narration` 是模型在步骤之间说的那句话 ——
   * 官方把它归**过程**不归答案（`processSpec` 只把 step < 答案步的正文算进过程）；
   * `retry` 是官方 `llm/retry` 的一次模型请求重试。
   */
  kind?: 'tool' | 'narration' | 'retry'
  label: string
  summary: string
  state: 'running' | 'done' | 'failed'
  startedAt?: number
  durationMs?: number
  errorReason?: string
  resultText?: string
  resultTruncated?: boolean
  parentCallId?: string
  rootCallId?: string
  readFile?: DeepSeekReadFileMeta
  /** 叙述条目的正文，仅 `kind === 'narration'` 使用。 */
  narration?: string
  /** 重试条目的状态，仅 `kind === 'retry'` 使用；取自官方同名事实。 */
  retryState?: DeepSeekRetryState
  /** 重试条目的原始事实，仅 `kind === 'retry'` 使用。 */
  retry?: DeepSeekRetry
}

/** 官方 `TokenUsage` 的子集；计数互斥，`inputTokens` 只含未缓存输入。 */
export type DeepSeekUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

export type DeepSeekReadFileMeta = {
  path: string
  lineStart: number
  lineCount: number
  totalLines: number
  language?: string
}

export type DeepSeekInboxTarget = 'next-turn' | 'next-step'
export type DeepSeekInboxItem = {
  id: string
  target: DeepSeekInboxTarget
  text: string
  textOnly: boolean
  attachmentCount: number
}

export type DeepSeekAssistantStreamState = {
  attemptId: string
  nextIndex: number
  text: string
  reasoning: string
  /** 当前 attempt 所属的 turn/step；实时推理要挂到正确的 step 上。 */
  turn: number
  step: number
}

export type DeepSeekSessionSnapshot = {
  session: { id: string; cwd?: string; createdAt?: number }
  events: any[]
}

export const DEEPSEEK_HARNESS_CONTEXT_WINDOW = 262_144
export const DEEPSEEK_HARNESS_MAX_OUTPUT_TOKENS = 32_768
export const DEEPSEEK_HARNESS_SESSION_MARKER = 'dh-session-v1'

/**
 * 等运行时确认关闭的上限。
 *
 * 官方 `HarnessClient.close()` 的拆卸阶梯本身有界：shutdown 请求 1s → stdin EOF 宽限 6s →
 * （Windows 直接强杀）3s，所以这个值必须高于它，否则会打断官方正在做的协同 flush。
 * 但上限不能没有：官方只对「进程还守规矩」的情况承诺回调，进程已死、stdin 写不进去
 * 或拆卸阶梯自己卡住时 `closed` 永不来 —— 没有上限，下面的兜底杀进程就永远不可达，
 * 运行时连同它的 `dsh` 子进程一起变孤儿，而那把跨进程写锁是永不过期的。
 */
export const DEEPSEEK_HARNESS_SHUTDOWN_TIMEOUT_MS = 15_000

/** 同一会话上一轮还没落地时再发一条时给用户看的话。 */
export const DEEPSEEK_HARNESS_BUSY_MESSAGE =
  '这个会话的上一轮还在进行，Harness 同一会话只允许一个写入方；等它结束后再发一次。'

/**
 * 登记表挂在 `globalThis` 上，不用模块级 Map。Vite 的模块热替换会重新求值本模块，
 * 模块级 Map 会连同里面唯一指向运行时的引用一起丢掉：进程还活着、stdin 还开着、
 * 会话写句柄还握着那把跨进程写锁，但 App 里再没有人能关掉它 —— 同一会话的下一轮
 * resume 就只剩「session ... is already owned by an active write handle」。
 */
type HarnessRegistry = {
  runtimes: Map<string, RuntimeSlot>
  /** 正在跑的会话（wire id）。官方把「同一会话的并发 resume」划给调用方排除。 */
  runningSessions: Set<string>
}

const harnessRegistry: HarnessRegistry = ((
  globalThis as unknown as Record<string, unknown>
).__JC_DEEPSEEK_HARNESS__ ??= {
  runtimes: new Map<string, RuntimeSlot>(),
  runningSessions: new Set<string>(),
}) as HarnessRegistry

const runtimes = harnessRegistry.runtimes
const runningSessions = harnessRegistry.runningSessions

/**
 * 沙箱档位。官方 base profile（`@deepseek-ai/dsh-base/cordis.patch.yml` 的 `permission` 条目）
 * 已经配好这三档，官方客户端也叫这三档（仅可查看 / 工作区内修改 / 完全权限）。我们只负责把
 * 选择传下去 —— 后端不需要改任何配置。
 */
export type DeepSeekPermissionTier = 'read-only' | 'workspace-write' | 'danger-full-access'

/**
 * 权限选择器的三档，顺序即官方 base profile 的顺序。
 *
 * `label` 逐字用官方 `dsh-client-ui-permission-presets` 的 zh 字典；`short` 是横排按钮上的
 * 短名（工作台那个按钮常驻显示当前档，全名「工作区内修改」会把整排按钮撑到滚动）；
 * `note` 用官方 config 里那两档 description 的口径补上「越界怎么办」，因为那才是三档真正的区别。
 *
 */
export const DEEPSEEK_PERMISSION_TIERS: ReadonlyArray<{
  tier: DeepSeekPermissionTier
  label: string
  short: string
  note: string
}> = [
  { tier: 'read-only', label: '仅可查看', short: '仅可查看', note: '默认不修改文件，需要时可请求本次授权' },
  { tier: 'workspace-write', label: '工作区内修改', short: '工作区', note: '只能改工作区内的文件，越界需请求本次授权' },
  { tier: 'danger-full-access', label: '完全权限', short: '完全权限', note: '本机文件不再受限，也不再询问' },
]

/** 默认档：官方 `sandbox-policy.mode` 的缺省值，也是审批策略为 `ask` 的那一档。 */
export const DEEPSEEK_DEFAULT_PERMISSION_TIER: DeepSeekPermissionTier = 'workspace-write'

/**
 * 档位 → 落盘芯片（只写不读）。
 *
 * 默认档不落芯片（与旧会话一致：没芯片 = 默认档）；`danger-full-access` 仍写 `file` ——
 * 旧会话里 `file` 的意思就是「开」，语义一一对应，不需要迁移；`read-only` 是新档，
 * 用 `file:read-only`。
 *
 * **芯片不是档位的真相源**：档位是工作区级的持久选择（见 `MemoryWorkbench` 的
 * `permissionTier`）—— 以前靠芯片反推回来，新建对话、编辑重发、重开旧对话都会把档位打回默认，
 * 用户体感就是「一个任务一次权限」。这里只负责把事实告诉会话与手机端。
 */
export function deepSeekPermissionChip(tier: DeepSeekPermissionTier): string | undefined {
  if (tier === 'danger-full-access') return 'file'
  return tier === 'read-only' ? 'file:read-only' : undefined
}

/**
 * 重试与失败的中文文案，**逐字**取自官方 `@deepseek-ai/dsh-client-ui-chat` 的中文字典
 * （`lib/client.js` 的 `message.retry.*` / `message.turnError` / `duration.milliseconds`）。
 * 只登记我们真的会渲染的几条，不自造近义词。
 */
export const DEEPSEEK_RETRY_TEXT = {
  /** 官方 `message.retry.status`：`{label}（{retry}/{maximum}） · {seconds}s`。 */
  status: (label: string, attempt: number, maximum: number | '∞', seconds: number) =>
    `${label}（${attempt}/${maximum}） · ${seconds}s`,
  active: '正在重试模型请求',
  scheduled: '等待重试模型请求',
  started: '已重试模型请求',
  cancelled: '模型请求重试已取消',
  /** 官方 `message.retry.delay` / `message.retry.failure`。 */
  delay: '重试延迟：',
  failure: '失败原因：',
  /** 官方 `duration.milliseconds`。 */
  milliseconds: (milliseconds: number) => `${milliseconds}毫秒`,
  /** 官方 `message.turnError`。 */
  turnError: '本轮运行失败',
}

/**
 * 官方 `failureMessage()`：只有几个已知 code 有专属文案，其余原样透出 message。
 * 官方那两个 `ACCOUNT_*` 分支针对「退出官方账号登录」，我们不接官方账号，没有这两条。
 */
export function deepSeekFailureText(message: string, code?: string): string {
  if (code === 'session/writer-held' || /^session "[^"\n]+" is already owned by an active write handle$/.test(message))
    return '这个对话正被另一个运行时占用。请关闭占用它的实例，释放后可在原对话重试。'
  if (code === 'AUTH') return 'API 密钥无效'
  if (code === 'QUOTA' || code === 'ACCOUNT_QUOTA') return '当前请求的额度已用尽'
  return message
}

/**
 * 路由 patch 里这条模型声明的输入模态。官方对没声明的模型取 `DEFAULT_INPUT = ["text"]`：
 * 低估的代价是图片在附着前就被拒（点名模型），高估的代价是上游在轮次中途拒绝。
 * 实测不声明时，一次「查看图片内容」变成 11 步工具乱找 + 6 次 429/524 重试，16 分钟无果。
 */
export function deepSeekModelInput(imageInput = false): Array<'text' | 'image'> {
  return imageInput ? ['text', 'image'] : ['text']
}

function runtimeKey(input: DeepSeekHarnessInput): string {
  return [
    input.cwd,
    input.apiBase,
    input.model,
    deepSeekModelInput(input.imageInput).join('+'),
    input.mediaSelected ? 'media' : '',
    input.avSelected ? 'av' : '',
    input.scene3dSelected ? '3d' : '',
    // Computer Use 只改路由组合，不改会话；放进键里是为了「切开关 = 换 runtime」——
    // 不然关掉开关后旧 runtime 仍在跑，模型手里还攥着桌面工具。
    computerUseEnabledNow() ? 'cua' : '',
    [...new Set(input.mcpServerIds || [])].sort().join(','),
  ].join('\0')
}

function workspaceRuntimeKey(input: DeepSeekHarnessInput): string {
  return input.cwd
}

export function deepSeekSessionId(conversationId: string): string {
  return `jc-v1-${conversationId}`
}
export function deepSeekSessionExists(
  sessions: Array<{ header: { id: string } }>,
  conversationId: string,
): boolean {
  const sessionId = deepSeekSessionId(conversationId)
  return sessions.some(session => session.header.id === sessionId)
}

export function deepSeekAssistantText(event: any): string {
  if (event?.type !== 'assistant/message') return ''
  const content = event?.data?.message?.content
  return Array.isArray(content)
    ? content
        .filter(block => block?.type === 'text')
        .map(block => String(block.text || ''))
        .join('')
    : ''
}

/**
 * 同一 step 的推理文本，按 content 里的块顺序拼接。
 * 官方把 `reasoning` 当普通内容块（`dsh-llm` 的 `ReasoningBlock`），所以它一直在
 * `assistant/message.data.message.content` 里，不需要额外通道；此前只是被正文过滤丢掉了。
 */
export function deepSeekAssistantReasoning(event: any): string {
  if (event?.type !== 'assistant/message') return ''
  const content = event?.data?.message?.content
  return Array.isArray(content)
    ? content
        .filter(block => block?.type === 'reasoning')
        .map(block => String(block.text || ''))
        .join('')
    : ''
}

function deepSeekOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 官方只在适配器报告了 token 计数时给 `usage`，缺省时必须返回 `undefined`：
 * 用 0 或估算值代替会让用户看到假数字（官方 GUI 同样是“缺就不显示”）。
 */
export function deepSeekMessageUsage(event: any): DeepSeekUsage | undefined {
  const usage = event?.type === 'assistant/message' ? event?.data?.usage : undefined
  if (!usage || typeof usage !== 'object') return undefined
  const inputTokens = deepSeekOptionalNumber(usage.inputTokens)
  const outputTokens = deepSeekOptionalNumber(usage.outputTokens)
  if (inputTokens === undefined || outputTokens === undefined) return undefined
  const totalTokens = deepSeekOptionalNumber(usage.totalTokens)
  const cacheReadTokens = deepSeekOptionalNumber(usage.cacheReadTokens)
  const cacheWriteTokens = deepSeekOptionalNumber(usage.cacheWriteTokens)
  const reasoningTokens = deepSeekOptionalNumber(usage.reasoningTokens)
  return {
    inputTokens,
    outputTokens,
    ...totalTokens === undefined ? {} : { totalTokens },
    ...cacheReadTokens === undefined ? {} : { cacheReadTokens },
    ...cacheWriteTokens === undefined ? {} : { cacheWriteTokens },
    ...reasoningTokens === undefined ? {} : { reasoningTokens },
  }
}

function deepSeekInboxItem(message: any, target: DeepSeekInboxTarget): DeepSeekInboxItem | undefined {
  const id = String(message?.id || '')
  if (!id || !Array.isArray(message?.content)) return undefined
  const content = message.content as Array<{ type?: unknown; text?: unknown }>
  return {
    id,
    target,
    text: content.filter(block => block?.type === 'text').map(block => String(block.text || '')).join('\n').trim(),
    textOnly: content.every(block => block?.type === 'text'),
    attachmentCount: content.filter(block => block?.type !== 'text').length,
  }
}

/** Durable Session Inbox projection. A Vue queue is never used as the source of truth. */
export function applyDeepSeekInboxEvent(
  current: DeepSeekInboxItem[], event: any,
): DeepSeekInboxItem[] {
  if (event?.type !== 'agent/inbox/spliced') return current
  const target = event.data?.target as DeepSeekInboxTarget
  if (target !== 'next-turn' && target !== 'next-step') return current
  const start = Number(event.data?.start)
  if (!Number.isInteger(start) || start < 0) return current
  const queue = current.filter(item => item.target === target)
  const removed = Number(event.data?.removedCount ?? 0)
  if (!Number.isInteger(removed) || removed < 0 || !Array.isArray(event.data?.inserted)) return current
  const inserted = event.data.inserted
    .map((message: any) => deepSeekInboxItem(message, target))
    .filter((item: DeepSeekInboxItem | undefined): item is DeepSeekInboxItem => Boolean(item))
  queue.splice(start, removed, ...inserted)
  return [
    ...(target === 'next-turn' ? queue : current.filter(item => item.target === 'next-turn')),
    ...(target === 'next-step' ? queue : current.filter(item => item.target === 'next-step')),
  ]
}

export function deepSeekSessionInbox(snapshot: DeepSeekSessionSnapshot): DeepSeekInboxItem[] {
  let items: DeepSeekInboxItem[] = []
  for (const event of snapshot.events || []) items = applyDeepSeekInboxEvent(items, event)
  return items
}

export function deepSeekSessionUsage(snapshot: DeepSeekSessionSnapshot): Map<string, DeepSeekUsage> {
  const owners = deepSeekTurnOwners(snapshot)
  const usageByOwner = new Map<string, DeepSeekUsage>()
  for (const event of snapshot.events || []) {
    if (event?.type !== 'assistant/message' || !isAppendSurface(event)) continue
    const owner = owners.get(Number(event.data?.turn))
    if (!owner) continue
    const usage = deepSeekMessageUsage(event)
    if (usage) usageByOwner.set(owner, usage)
  }
  return usageByOwner
}

function deepSeekReadFileMeta(meta: any): DeepSeekReadFileMeta | undefined {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined
  const path = typeof meta.path === 'string' ? meta.path.trim() : ''
  const lineStart = Number(meta.offset)
  const totalLines = Number(meta.totalLines)
  const lines = Array.isArray(meta.lines) ? meta.lines : null
  if (!path || !Number.isInteger(lineStart) || lineStart < 1
    || !Number.isInteger(totalLines) || totalLines < 0 || !lines
    || !lines.every((line: any) => Number.isInteger(line?.number) && typeof line?.text === 'string')) return undefined
  let previous = lineStart - 1
  for (const line of lines) {
    if (line.number <= previous || line.number > totalLines) return undefined
    previous = line.number
  }
  return {
    path,
    lineStart,
    lineCount: lines.length,
    totalLines,
    ...(typeof meta.lang === 'string' ? { language: meta.lang } : {}),
  }
}

function deepSeekMessageText(content: any): string {
  return Array.isArray(content)
    ? content.filter(block => block?.type === 'text').map(block => String(block.text || '')).join('')
    : ''
}

/**
 * 官方对「正文」的判据，逐字对齐 `dsh-client-ui-chat` 的 `visibleAssistantEvent` /  
 * `hasAssistantReplyContent`：`tool-call` 块不算正文；`text` 块必须 `trim()` 后非空。
 *
 * 实测踩到：纯工具步的 assistant/message 会带一个只含两个换行的 text 块（`'\n\n'`），
 * 不 trim 就被当成「有正文的助手轮次」，界面上只留下一个孤儿「韭菜盒子」。
 */
function deepSeekVisibleText(content: unknown): string {
  return Array.isArray(content)
    ? content
        .filter(block => block?.type === 'text' && String(block?.text || '').trim())
        .map(block => String(block.text).trim())
        .join('\n\n')
    : ''
}

/**
 * 人类 transcript 只认 `surfaceOp === 'append'` 的事件。
 *
 * 官方原话：「The model-visible surface deliberately shadows replaced ranges, so it is the
 * wrong source for a human transcript… replacement copies stay model-only.」实测本机会话里
 * 已有 28 条 `{ op: 'replace', startSeq, endSeq }`（压缩产生），不过滤就会把被替掉的旧范围
 * 也显示给用户。
 */
function isAppendSurface(event: any): boolean {
  return event?.surfaceOp === 'append'
}

function visibleDeepSeekUserText(text: string): string {
  const current = text.split('【本轮消息】\n\n').at(-1) || text
  return current.replace(/^(?:\/[\w.-]+(?:\s+|$))+\n*/u, '').trim()
}

function deepSeekUserMessageId(event: any): string {
  return String(event.data?.id || `dh-user-${event.seq}`)
}

/**
 * 一轮里能上屏的 assistant 消息，按事件顺序。
 *
 * 官方把一轮看成「**一个过程节点 + 一个答案节点**」（`dsh-client-ui-chat` 的 `turn-process`
 * 定义）：答案取该轮**最后一条有正文且不含 tool-call 块**的 assistant 消息；其余有正文的消息
 * 是**过程叙述**。实测 turn 7 的三步就是 `'\n\n'` / `'\n\n'` / `'搞定 ✅'` —— 只有最后一步是
 * 答案。我们以前每步各出一条「韭菜盒子」，所以才会出现两个空行。
 */
function deepSeekTurnMessages(
  snapshot: DeepSeekSessionSnapshot,
): Map<number, Array<{ id: string; text: string; toolCall: boolean; time: number }>> {
  const messages = new Map<number, Array<{ id: string; text: string; toolCall: boolean; time: number }>>()
  for (const event of snapshot.events || []) {
    if (event?.type !== 'assistant/message' || !isAppendSurface(event)) continue
    const turn = Number(event.data?.turn)
    if (!Number.isFinite(turn)) continue
    const content = event.data?.message?.content
    messages.set(turn, [...messages.get(turn) || [], {
      id: String(event.data?.message?.id || ''),
      text: deepSeekVisibleText(content),
      toolCall: Array.isArray(content) && content.some((block: any) => block?.type === 'tool-call'),
      time: Number(event.time) || 0,
    }])
  }
  return messages
}

/** 每轮的答案：该轮最后一条有正文且不含 tool-call 的消息（官方 `latestAnswer` 的等价物）。 */
function deepSeekTurnAnswers(
  snapshot: DeepSeekSessionSnapshot,
): Map<number, { id: string; text: string; time: number }> {
  const answers = new Map<number, { id: string; text: string; time: number }>()
  for (const [turn, messages] of deepSeekTurnMessages(snapshot)) {
    const answer = [...messages].reverse().find(message => message.id && message.text && !message.toolCall)
    if (answer) answers.set(turn, { id: answer.id, text: answer.text, time: answer.time })
  }
  return answers
}

/**
 * 每轮用于挂载的轮次 id：有答案就用答案，没有（纯工具轮）就用最后一条 assistant 消息。
 *
 * 纯工具轮也要有一个 UI 轮次做挂载点，否则它的过程无处可渲染。
 */
function deepSeekTurnAnchors(snapshot: DeepSeekSessionSnapshot): Map<number, string> {
  const anchors = new Map<number, string>()
  for (const [turn, messages] of deepSeekTurnMessages(snapshot)) {
    const id = [...messages].reverse().find(message => message.id)?.id
    if (id) anchors.set(turn, id)
  }
  return anchors
}

export type DeepSeekTurnFailure = {
  code?: string
  message: string
  /**
   * 官方 `assistant/attempt` 的条数：这一轮里没成为可见消息的模型尝试次数。
   * 只有终止 code 时看不清「重试了几次都没成」，失败原因与尝试次数要一起给出。
   */
  attempts?: number
}

/** 会话快照 → 发起该轮的用户消息 id → 官方 turn/end(error) 失败原因。 */
export function deepSeekSessionFailures(snapshot: DeepSeekSessionSnapshot): Map<string, DeepSeekTurnFailure> {
  const owners = deepSeekTurnOwners(snapshot)
  const failures = new Map<string, DeepSeekTurnFailure>()
  const attempts = new Map<number, number>()
  for (const event of snapshot.events || []) {
    if (event?.type !== 'assistant/attempt') continue
    const turn = Number(event.data?.turn)
    if (Number.isFinite(turn)) attempts.set(turn, (attempts.get(turn) || 0) + 1)
  }
  for (const event of snapshot.events || []) {
    if (event?.type !== 'turn/end' || event.data?.reason?.kind !== 'error') continue
    const owner = owners.get(Number(event.data?.turn))
    if (!owner) continue
    const failure = event.data.reason.error
    const message = String(failure?.message || 'DeepSeek Harness 执行失败').trim()
    const code = String(failure?.code || '').trim()
    const count = attempts.get(Number(event.data?.turn)) || 0
    failures.set(owner, {
      ...code ? { code } : {},
      message,
      ...count ? { attempts: count } : {},
    })
  }
  return failures
}

export function deepSeekSessionTurns(snapshot: DeepSeekSessionSnapshot): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  const answers = deepSeekTurnAnswers(snapshot)
  const anchors = deepSeekTurnAnchors(snapshot)
  for (const event of snapshot.events || []) {
    if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
      if (!isAppendSurface(event)) continue
      const content = visibleDeepSeekUserText(deepSeekVisibleText(event.data.content))
      if (content) turns.push({
        id: deepSeekUserMessageId(event),
        role: 'user',
        content,
        createdAt: new Date(Number(event.time) || Date.now()).toISOString(),
        toolChips: [DEEPSEEK_HARNESS_SESSION_MARKER],
      })
      continue
    }
    // 一轮在 `turn/end` 收口，只产出一条 assistant 记录。
    // 注意 `turn/end` 是 log-only 边界事件、**不带 surfaceOp**（官方类型上就禁止），
    // 所以 surface 过滤只能加在消息事件上，不能放在循环开头统一 continue。
    if (event?.type !== 'turn/end') continue
    const turn = Number(event.data?.turn)
    if (!Number.isFinite(turn)) continue
    const answer = answers.get(turn)
    const id = answer?.id || anchors.get(turn)
    if (!id) continue
    turns.push({
      id,
      role: 'assistant',
      // 只有答案有正文。纯工具轮**故意**留空 —— 它只是过程块的挂载点，
      // 侧栏由 turnHasBody() 判掉，不会再出现孤儿的「韭菜盒子」。
      content: answer?.text || '',
      createdAt: new Date(answer?.time || Number(event.time) || Date.now()).toISOString(),
    })
  }
  return turns
}

export function applyDeepSeekAssistantStream(
  state: DeepSeekAssistantStreamState,
  frame: any,
): string | undefined {
  if (frame?.type === 'start') {
    state.attemptId = String(frame.attemptId || '')
    state.nextIndex = 0
    state.text = ''
    state.reasoning = ''
    state.turn = Number(frame.turn) || 0
    state.step = Number(frame.step) || 0
    return ''
  }
  if (
    frame?.type !== 'chunk'
    || String(frame.attemptId || '') !== state.attemptId
    || frame.index !== state.nextIndex
  ) return undefined
  state.nextIndex += 1
  // 推理分片照旧推进序号，但不影响返回值：正文增量仍只由 text-delta 驱动，
  // 否则调用方会把推理当正文渲染进消息体。
  if (frame.chunk?.type === 'reasoning-delta') {
    state.reasoning = `${state.reasoning || ''}${String(frame.chunk.text || '')}`
    return undefined
  }
  if (frame.chunk?.type !== 'text-delta') return undefined
  state.text += String(frame.chunk.text || '')
  return state.text
}

/**
 * 官方 Harness 工具面（`--profile sdk` 默认 24 个）的中文标签。
 * 清单与来源插件见 [[开发/韭菜盒子Harness会话与可选建库统一合同-2026-09-24#与官方 Harness 的关系]]；
 * 表里没有的名字退回关键词规则，最后才落到「执行 <name>」——MCP 代理工具名由服务端决定，不能穷举。
 */
const DEEPSEEK_TOOL_LABELS: Record<string, string> = {
  bash: '执行命令',
  read: '读取文件',
  read_image: '读取图片',
  write: '修改文件',
  edit: '修改文件',
  glob: '查找文件',
  grep: '搜索内容',
  skill: '加载 Skill',
  todo_write: '更新任务清单',
  create_goal: '创建目标',
  update_goal: '更新目标',
  get_goal: '读取目标',
  subagent: '派发子代理',
  subagent_fork: '派发子代理分支',
  list_agents: '列出子代理',
  interrupt_agent: '中止子代理',
  send_message: '发送子代理消息',
  job_list: '列出后台任务',
  job_output: '读取后台任务输出',
  job_kill: '停止后台任务',
  web_search: '联网搜索',
  web_fetch: '抓取网页',
  workflow: '运行工作流',
  exit_plan_mode: '退出计划模式',
}

function deepSeekToolLabel(name: string): string {
  const official = DEEPSEEK_TOOL_LABELS[name]
  if (official) return official
  if (/read/i.test(name)) return '读取文件'
  if (/grep|search/i.test(name)) return '搜索内容'
  if (/glob|find|list/i.test(name)) return '查找文件'
  if (/write|edit|patch/i.test(name)) return '修改文件'
  if (/bash|terminal|pwsh|command/i.test(name)) return '执行命令'
  if (/skill/i.test(name)) return '加载 Skill'
  return `执行 ${name || '工具'}`
}

/**
 * 参数摘要的白名单与其优先级。
 * 键名按真样本实测（TDD §2.3）：`read`/`read_image` 用 `file_path`（不是 `path`），
 * `glob` 用 `path`+`pattern`，`pwsh` 用 `command`+`description`，`skill` 用 `name`。
 * 白名单之外的字段一律不显示：写入内容、文件正文、密钥都不上屏。
 */
const DEEPSEEK_SUMMARY_KEYS = ['command', 'file_path', 'path', 'pattern', 'query', 'url', 'name', 'toolName']
const DEEPSEEK_SUMMARY_LIMIT = 80
const DEEPSEEK_ERROR_LIMIT = 200
/** 工具结果正文的上限：bash 输出与文件正文可能几十万字符，投影层就得截断。 */
export const DEEPSEEK_PROCESS_RESULT_LIMIT = 4_000

function deepSeekClip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function deepSeekToolSummary(rawArguments: unknown): string {
  if (typeof rawArguments !== 'string') return ''
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    // 模型产出的参数不保证是合法 JSON；摘要只是锦上添花，不能因此抛错。
    return ''
  }
  if (!parsed || typeof parsed !== 'object') return ''
  for (const key of DEEPSEEK_SUMMARY_KEYS) {
    const value = (parsed as Record<string, unknown>)[key]
    if (typeof value !== 'string' || !value.trim()) continue
    return deepSeekClip(value.replace(/\s+/g, ' ').trim(), DEEPSEEK_SUMMARY_LIMIT)
  }
  return ''
}

function deepSeekResultText(content: unknown): { text: string; truncated: boolean } {
  const text = Array.isArray(content)
    ? content.filter(block => block?.type === 'text').map(block => String(block.text || '')).join('')
    : ''
  return { text: deepSeekClip(text, DEEPSEEK_PROCESS_RESULT_LIMIT), truncated: text.length > DEEPSEEK_PROCESS_RESULT_LIMIT }
}

/**
 * 失败原因：显式 `error.reason` / `error.code` 优先，都没有时回退到结果正文首行。
 * 实测那次 `read_image` 失败就是 `isError: true` 但 `error` 整个是 `undefined`，
 * 失败说明只在正文里（`Error: cannot read … does not declare image input`）。
 */
function deepSeekResultErrorReason(error: any, isError: boolean, resultText: string): string | undefined {
  for (const candidate of [error?.reason, error?.code]) {
    const text = String(candidate ?? '').replace(/\s+/g, ' ').trim()
    if (text) return deepSeekClip(text, DEEPSEEK_ERROR_LIMIT)
  }
  if (!isError) return undefined
  const firstLine = resultText.split('\n').map(line => line.trim()).find(Boolean) || ''
  return firstLine ? deepSeekClip(firstLine, DEEPSEEK_ERROR_LIMIT) : undefined
}

/**
 * 重试的配对键。
 *
 * 官方 `llm/retry` 与 `llm/retry-started` 靠 `retryId` 配对；但若上游某一版没发这个字段，
 * 整块重试行会**静默消失**（没有报错，只是看不见），所以同一轮的 `retry` 序号当兜底键 ——
 * 官方事件里 `turn` + `retry` 在一個轮次内唯一。
 */
function deepSeekRetryKey(data: any): string {
  const id = String(data?.retryId || '').trim()
  if (id) return `retry-${id}`
  const turn = Number(data?.turn)
  const attempt = Number(data?.retry)
  return Number.isFinite(turn) && Number.isFinite(attempt) ? `retry-${turn}-${attempt}` : ''
}

export function deepSeekProgress(event: any): DeepSeekProgress | undefined {
  if (event?.type === 'llm/retry') {
    const id = deepSeekRetryKey(event.data)
    if (!id) return undefined
    const failure = event.data?.failure
    const failureCode = String(failure?.code || '').trim()
    const startedAt = deepSeekOptionalNumber(Number(event?.time))
    return {
      id,
      kind: 'retry',
      // 等待刚排定：官方 `retryState` 的初始态就是 `scheduled`。
      state: 'running',
      retryState: 'scheduled',
      retry: {
        attempt: Number(event.data?.retry || 0),
        // 官方：只有 `mode === 'normal'` 的事件带 `maxRetries`，其余显示 `∞`。
        maximum: event.data?.mode === 'normal' ? Number(event.data?.maxRetries || 0) : '∞',
        delayMs: Number(event.data?.delayMs || 0),
        ...failureCode ? { failureCode } : {},
        failureMessage: String(failure?.message || '').trim(),
      },
      ...startedAt === undefined ? {} : { startedAt },
    }
  }
  // 等待结束、下一次请求已发出：官方那份节点只把状态从 scheduled 推成 started。
  if (event?.type === 'llm/retry-started') {
    const id = deepSeekRetryKey(event.data)
    if (!id) return undefined
    const endedAt = deepSeekOptionalNumber(Number(event?.time))
    return {
      id,
      kind: 'retry',
      state: 'done',
      retryState: 'started',
      ...endedAt === undefined ? {} : { endedAt },
    }
  }
  if (event?.type === 'tool/call') {
    const startedAt = deepSeekOptionalNumber(Number(event?.time))
    return {
      id: String(event.data?.callId || ''),
      label: deepSeekToolLabel(String(event.data?.name || '')),
      state: 'running',
      summary: deepSeekToolSummary(event.data?.arguments),
      ...startedAt === undefined ? {} : { startedAt },
    }
  }
  if (event?.type === 'tool/ptc-dispatch-start') {
    const startedAt = deepSeekOptionalNumber(Number(event?.time))
    const args = typeof event.data?.arguments === 'string'
      ? event.data.arguments
      : JSON.stringify(event.data?.arguments ?? {})
    return {
      id: String(event.data?.subCallId || ''),
      parentCallId: String(event.data?.parentCallId || ''),
      rootCallId: String(event.data?.rootCallId || ''),
      label: deepSeekToolLabel(String(event.data?.name || '')),
      summary: deepSeekToolSummary(args),
      state: 'running',
      ...startedAt === undefined ? {} : { startedAt },
    }
  }
  if (event?.type === 'tool/ptc-dispatch') {
    const isError = Boolean(event.data?.isError)
    const { text, truncated } = deepSeekResultText(event.data?.content)
    const endedAt = deepSeekOptionalNumber(Number(event?.time))
    const errorReason = deepSeekResultErrorReason(event.data?.error, isError, text)
    return {
      id: String(event.data?.subCallId || ''),
      parentCallId: String(event.data?.parentCallId || ''),
      rootCallId: String(event.data?.rootCallId || ''),
      state: isError ? 'failed' : 'done',
      ...endedAt === undefined ? {} : { endedAt },
      ...errorReason === undefined ? {} : { errorReason },
      resultText: text,
      resultTruncated: truncated,
    }
  }
  if (event?.type === 'tool/result') {
    const isError = Boolean(event.data?.message?.isError)
    const { text, truncated } = deepSeekResultText(event.data?.message?.content)
    const endedAt = deepSeekOptionalNumber(Number(event?.time))
    const errorReason = deepSeekResultErrorReason(event.data?.error, isError, text)
    const readFile = deepSeekReadFileMeta(event.data?.meta)
    return {
      id: String(event.data?.message?.toolCallId || ''),
      state: isError ? 'failed' : 'done',
      ...endedAt === undefined ? {} : { endedAt },
      ...errorReason === undefined ? {} : { errorReason },
      resultText: text,
      resultTruncated: truncated,
      ...(readFile ? { readFile } : {}),
    }
  }
  return undefined
}

/**
 * 把一条 `tool/call`（可选配对它自己的 `tool/result`）折叠成一个过程步骤。
 * 时长由两个事件的时间戳相减得到，不依赖事件里有没有现成的耗时字段。
 */
function deepSeekProcessStep(call: any, result: any): DeepSeekProcessStep | undefined {
  const started = deepSeekProgress(call)
  if (!started?.id) return undefined
  const step: DeepSeekProcessStep = {
    id: started.id,
    label: started.label || '执行工具',
    summary: started.summary || '',
    state: 'running',
    ...started.startedAt === undefined ? {} : { startedAt: started.startedAt },
    ...started.parentCallId ? { parentCallId: started.parentCallId } : {},
    ...started.rootCallId ? { rootCallId: started.rootCallId } : {},
    ...started.readFile ? { readFile: started.readFile } : {},
  }
  const settled = deepSeekProgress(result)
  if (!settled) return step
  step.state = settled.state
  step.errorReason = settled.errorReason
  step.resultText = settled.resultText
  step.resultTruncated = settled.resultTruncated
  if (settled.parentCallId) step.parentCallId = settled.parentCallId
  if (settled.rootCallId) step.rootCallId = settled.rootCallId
  if (settled.readFile) step.readFile = settled.readFile
  if (step.startedAt !== undefined && settled.endedAt !== undefined) {
    const durationMs = settled.endedAt - step.startedAt
    if (durationMs >= 0) step.durationMs = durationMs
  }
  return step
}

/**
 * 会话快照 → 该轮对话的发起人（UI 轮次 id）→ 工具步骤。
 *
 * 归属必须落在**发起这一轮的用户消息**上，不能落在 assistant message 上：
 * 纯工具步（`assistant/message` 只有 `tool-call` 块、无正文）不产出 UI 轮次，
 * 挂在它上面就等于过程永远不可见——真样本里一整轮 10 个工具步就是这样消失的。
 *
 * 工具步骤只取 `tool/call` + `tool/result` 事件，不解析 message content 里的 `tool-call` 块：
 * 同一 callId 两处都出现，只用事件源天然避免同一步渲染两遍。
 *
 * 重试也在这里成条目（官方 `llm/retry` / `llm/retry-started`），与工具步排在同一条时间线上：
 * 一轮 12 次重试原本只剩状态行一句话，跑完就没了 —— 事后无法区分「重试救回来了」和
 * 「一次就成功」。
 *
 * 结果按 UI 轮次 id 侧存，不写 `ConversationTurn`：Harness 对话以 Session 为唯一真源，
 * 每次打开重建即可，不需要新的持久化格式。
 */
export function deepSeekSessionProcess(
  snapshot: DeepSeekSessionSnapshot,
): Map<string, DeepSeekProcessStep[]> {
  const owners = deepSeekTurnOwners(snapshot)
  const resultsByCall = new Map<string, any>()
  const ptcResultsByCall = new Map<string, any>()
  for (const event of snapshot.events || []) {
    if (event?.type === 'tool/result' && isAppendSurface(event)) {
      const callId = String(event.data?.message?.toolCallId || '')
      if (callId) resultsByCall.set(callId, event)
    }
    if (event?.type === 'tool/ptc-dispatch') {
      const callId = String(event.data?.subCallId || '')
      if (callId) ptcResultsByCall.set(callId, event)
    }
  }
  const process = new Map<string, DeepSeekProcessStep[]>()
  const answers = deepSeekTurnAnswers(snapshot)
  const retries = new Map<string, { step: DeepSeekProcessStep; turn: number }>()
  const callOwners = new Map<string, string>()
  const push = (owner: string, step: DeepSeekProcessStep) =>
    process.set(owner, [...process.get(owner) || [], step])
  for (const event of snapshot.events || []) {
    const owner = owners.get(Number(event?.data?.turn))
    if (event?.type === 'tool/call') {
      if (!owner) continue
      const callId = String(event.data?.callId || '')
      const step = deepSeekProcessStep(event, resultsByCall.get(callId))
      if (step) {
        callOwners.set(callId, owner)
        push(owner, step)
      }
      continue
    }
    if (event?.type === 'tool/ptc-dispatch-start') {
      const parentCallId = String(event.data?.parentCallId || '')
      const callOwner = callOwners.get(parentCallId) || callOwners.get(String(event.data?.rootCallId || ''))
      if (!callOwner) continue
      const callId = String(event.data?.subCallId || '')
      const step = deepSeekProcessStep(event, ptcResultsByCall.get(callId))
      if (step) {
        callOwners.set(callId, callOwner)
        push(callOwner, step)
      }
      continue
    }
    if (event?.type === 'tool/ptc-dispatch') {
      const callOwner = callOwners.get(String(event.data?.subCallId || ''))
      if (!callOwner) continue
      const progress = deepSeekProgress(event)
      const step = process.get(callOwner)?.find(item => item.id === progress?.id)
      if (step && progress) {
        step.state = progress.state
        step.errorReason = progress.errorReason
        step.resultText = progress.resultText
        step.resultTruncated = progress.resultTruncated
        if (step.startedAt !== undefined && progress.endedAt !== undefined && progress.endedAt >= step.startedAt)
          step.durationMs = progress.endedAt - step.startedAt
      }
      continue
    }
    if (!owner) continue
    if (event?.type === 'llm/retry' || event?.type === 'llm/retry-started') {
      const progress = deepSeekProgress(event)
      if (!progress?.id) continue
      const existing = retries.get(progress.id)
      if (existing) {
        // `llm/retry-started` 只推状态，原始事实（次数/上限/延迟/原因）留在排定那一条上。
        existing.step.retryState = progress.retryState
        existing.step.state = progress.state
        continue
      }
      const step: DeepSeekProcessStep = {
        id: progress.id,
        kind: 'retry',
        label: '',
        summary: '',
        state: progress.state,
        retryState: progress.retryState,
        ...progress.startedAt === undefined ? {} : { startedAt: progress.startedAt },
        ...progress.retry === undefined ? {} : { retry: progress.retry },
      }
      retries.set(progress.id, { step, turn: Number(event.data?.turn) })
      push(owner, step)
      continue
    }
    // 中途叙述归过程：官方 `processSpec` 只把 step < 答案步的正文算进过程，答案另有节点。
    if (event?.type !== 'assistant/message' || !isAppendSurface(event)) continue
    const id = String(event.data?.message?.id || '')
    if (!id || id === answers.get(Number(event.data?.turn))?.id) continue
    const text = deepSeekVisibleText(event.data?.message?.content)
    if (text) push(owner, {
      id: `narration-${event.seq}`,
      kind: 'narration',
      label: '',
      summary: '',
      state: 'done',
      narration: text,
    })
  }
  // 官方 `retryState: 'cancelled'`：轮次没正常收口时，那次等待没等到 `llm/retry-started`。
  const ended = new Map<number, string>()
  for (const event of snapshot.events || []) {
    if (event?.type === 'turn/end') ended.set(Number(event.data?.turn), String(event.data?.reason?.kind || ''))
  }
  for (const { step, turn } of retries.values()) {
    const reason = ended.get(turn)
    if (reason !== undefined && reason !== 'completed' && step.retryState === 'scheduled') {
      step.retryState = 'cancelled'
      step.state = 'failed'
    }
  }
  return process
}

/** 会话快照 → 同一个 UI 轮次 id → 该轮推理正文（多 step 的推理按事件顺序拼接）。 */
export function deepSeekSessionReasoning(snapshot: DeepSeekSessionSnapshot): Map<string, string> {
  const owners = deepSeekTurnOwners(snapshot)
  const reasoningByOwner = new Map<string, string>()
  for (const event of snapshot.events || []) {
    if (event?.type !== 'assistant/message') continue
    const reasoning = deepSeekAssistantReasoning(event)
    if (!reasoning) continue
    const owner = owners.get(Number(event.data?.turn))
    if (!owner) continue
    const previous = reasoningByOwner.get(owner)
    reasoningByOwner.set(owner, previous ? `${previous}\n\n${reasoning}` : reasoning)
  }
  return reasoningByOwner
}

/**
 * 官方 turn 号 → 该轮 UI 轮次 id。
 *
 * 优先认真人消息（`source.kind === 'user'`），没才退回该轮的 assistant message id，
 * 这样注入式轮次（goal 续轮等）不会连过程带丢。
 * 这里的 id 必须与 `deepSeekSessionTurns()` 完全一致，所以共用 `deepSeekUserMessageId()`。
 */
function deepSeekTurnOwners(snapshot: DeepSeekSessionSnapshot): Map<number, string> {
  const answers = deepSeekTurnAnswers(snapshot)
  const anchors = deepSeekTurnAnchors(snapshot)
  const owners = new Map<number, string>()
  let currentTurn: number | undefined
  for (const event of snapshot.events || []) {
    if (event?.type === 'turn/start') {
      currentTurn = Number(event.data?.turn)
      continue
    }
    if (currentTurn === undefined || !Number.isFinite(currentTurn)) continue
    if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
      if (!isAppendSurface(event)) continue
      owners.set(currentTurn, deepSeekUserMessageId(event))
      continue
    }
    if (event?.type !== 'assistant/message' || owners.has(currentTurn)) continue
    if (!isAppendSurface(event)) continue
    // 注入式轮次（goal 续轮等）没有真人发起人：挂到该轮的**答案或锚点**上，
    // 挂到中间那条只有换行的消息上就再也找不到可渲染的轮次，过程会整段消失。
    const id = answers.get(currentTurn)?.id || anchors.get(currentTurn)
    if (id) owners.set(currentTurn, id)
  }
  return owners
}

export function deepSeekHandoffTurns(turns: ConversationTurn[]): ConversationTurn[] {
  let lastHarnessUser = -1
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn.role !== 'user' || !turn.toolChips?.includes(DEEPSEEK_HARNESS_SESSION_MARKER)) continue
    lastHarnessUser = index
    break
  }
  if (lastHarnessUser < 0) return turns
  const afterHarnessRound = turns[lastHarnessUser + 1]?.role === 'assistant'
    ? lastHarnessUser + 2
    : lastHarnessUser + 1
  return turns.slice(afterHarnessRound)
}

export function deepSeekPrompt(
  message: string,
  skillNames: string[],
  handoffTurns: ConversationTurn[] = [],
  wikiContext = '',
  sessionReferences: Array<{ title: string; turns: Array<{ role: 'user' | 'assistant'; content: string }> }> = [],
): string {
  const gestures = skillNames.map(name => `/${name}`).join(' ')
  const handoff = handoffTurns.length
    ? [
        '【既有对话移交】',
        ...handoffTurns.map(turn => `${turn.role === 'user' ? '用户' : '助手'}：${turn.content}`),
        '【本轮消息】',
      ].join('\n\n')
    : ''
  const manju = skillNames.includes(MANJU_ROUTER) ? manjuRoutePrompt() : ''
  const references = sessionReferences.map(reference => [
    `【引用会话：${reference.title} · 最近最多 12 条用户/助手消息】`,
    ...reference.turns.slice(-12).map(turn => `${turn.role === 'user' ? '用户' : '助手'}：${turn.content.slice(0, 4_000)}`),
  ].join('\n\n')).join('\n\n')
  const referenceLabel = sessionReferences.length
    ? `引用会话：${sessionReferences.map(reference => `「${reference.title.replace(/\s+/g, ' ').trim().slice(0, 120)}」`).join('、')}`
    : ''
  const currentMessage = [referenceLabel, message].filter(Boolean).join('\n\n')
  const currentMarker = !handoff && (manju || wikiContext || references) ? '【本轮消息】' : ''
  return [gestures, manju, wikiContext, references, handoff, currentMarker, currentMessage]
    .filter(Boolean).join('\n\n')
}

export function deepSeekContentBlocks(
  message: string,
  attachments: ResolvedDirectAttachment[] = [],
  files: DirectMessageFile[] = [],
  imageInput = false,
): any[] {
  // 用户引用的项目内文件一律走官方 @file 语义：提示词里只出现 `@路径`，正文由模型自己
  // read（官方 `dsh-file-reference` 的 FILE_REFERENCE_PROMPT 定义了这件事）。
  // 内联正文会跟"去读它"自相矛盾——实测模型因此把整个工作区翻了一遍。
  const mentionPath = (attachment: ResolvedDirectAttachment) =>
    attachment.readablePath || attachment.resourcePath || ''
  const referenced = attachments.filter(attachment => mentionPath(attachment))
  const inlineFiles = [
    ...files,
    ...attachments.flatMap(attachment => attachment.textContent && !mentionPath(attachment)
      ? [{ name: attachment.name, content: attachment.textContent }]
      : []),
  ]
  const images = attachments.filter(attachment => attachment.kind === 'image')
  const imageBlocks: any[] = []
  // 模型声明的图片输入是唯一开关：官方对未声明的模型按纯文本处理，送过去的图片块
  // 既不会内联，`read_image` 也会被拒。所以这里不发块，而是把它当“未送达”说清楚。
  if (imageInput) {
    for (const attachment of images) {
      const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/s.exec(attachment.value)
      const mimeType = (match?.[1] || attachment.mime).toLowerCase().replace('image/jpg', 'image/jpeg')
      if (!match || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType)) continue
      imageBlocks.push({ type: 'image', data: match[2], mimeType })
    }
  }
  // 看不见的图片必须说出来：直连路径一直有这句降级文案，Harness 路径漏了它，
  // 模型只拿到一个附件 id 就去满盘找文件（实测 11 步工具、16 分钟、最终 524）。
  const undelivered = images.length - imageBlocks.length
  const notice = undelivered
    ? `[附带 ${undelivered} 张图片，${imageInput ? '当前格式不受支持（仅支持 PNG/JPEG/WebP/GIF）' : '当前模型不支持视觉'}]`
    : ''
  // 路径本身就是要给模型的那条路——不给它的话，模型手里只有一个附件 id，只能满盘找
  // 文件（实测 11 步工具、16 分钟后 524）。但 `read` 读不了图片和视频：图片要
  // read_image，视频要 bash 抽帧（jc-watch 那条链路），出现这类引用时补一句，其余
  // 什么都不用说——`@` 的含义由官方 FILE_REFERENCE_PROMPT 交代。
  const mentionHint = referenced.some(attachment => attachment.kind !== 'file')
    ? '[本轮引用里的图片用 read_image 读，视频用 @jc-watch 抽帧。]'
    : ''
  // 带空白的路径按官方 mention 语法加引号（`@"path with spaces"`）。
  const mentionTokens = referenced.map(attachment => {
    const path = mentionPath(attachment)
    return /\s/.test(path) ? `@"${path}"` : `@${path}`
  })
  const text = [
    message,
    ...inlineFiles.map(file => `[已读取文件: ${file.name}]\n${file.content.slice(0, 120_000)}`),
    mentionTokens.join('\n'),
    notice,
    mentionHint,
  ].filter(Boolean).join('\n\n')
  return [{ type: 'text', text }, ...imageBlocks]
}

export function deepSeekTurnError(event: any): string {
  if (event?.type !== 'turn/end' || event?.data?.reason?.kind !== 'error') return ''
  return String(event.data.reason.error?.message || 'DeepSeek Harness 执行失败')
}

/**
 * 内置 Skill 源目录（`public/skills` → 打包成 `resources/skills`）。
 *
 * 官方 skill 扫描根只覆盖项目与用户目录（`~/.agents/skills` 等），**不含应用内置目录**：
 * 不配 `bundledSkillDir` / `DSH_BUNDLED_SKILL_DIR` 就没有 rank 600 的 `bundled` 根。缺它时
 * 内置的 jc-watch / skill-creator / wiki-memory / jc-new-user-guide 对模型完全不存在，模型
 * 只能满盘找 —— 实测一条 `find /Users/by3 -iname "*jc-watch*"` 白烧一分多钟。这是我们没给
 * 信息，不是模型笨。
 *
 * 探测必须在 Rust：前端 fs 插件的 `exists()` 受 capability 的 scope 限制（只放行
 * `$APPDATA/**`、`$HOME/.agents/**` 等），探 `target/debug/skills` 会直接抛
 * `forbidden path ... allow-exists` 而不是返回 false —— 整个 run 0.00 秒就死在这。
 */
async function bundledSkillsDirectory(): Promise<string | undefined> {
  return await invoke<string | null>('resolve_bundled_skills') || undefined
}

async function createRuntime(input: DeepSeekHarnessInput): Promise<Runtime> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.cwd))
  const workspaceKey = [...new Uint8Array(digest)].slice(0, 12).map(byte => byte.toString(16).padStart(2, '0')).join('')
  const routeDir = await join(await appDataDir(), 'deepseek-harness', 'workspaces', workspaceKey)
  const legacyRouteDir = await join(input.cwd, '.raw', '临时任务', 'deepseek-harness')
  try {
    await invoke('dev_copy_external', { input: { source: legacyRouteDir, destination: routeDir } })
  } catch { /* Missing/already migrated legacy state needs no action. */ }
  const patchPath = await join(routeDir, 'route.cordis.yml')
  const apiBase = input.apiBase.replace(/\/+$/, '')
  const baseURL = apiBase.endsWith('/v1') ? apiBase : `${apiBase}/v1`
  const mcpServerIds = [...new Set(input.mcpServerIds || [])]
  for (const id of mcpServerIds) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw new Error(`MCP 服务器 ID 不符合 Harness 命名规则: ${id}`)
  }
  const localCapabilities = [input.mediaSelected && 'media', input.scene3dSelected && '3d'].filter(Boolean) as string[]
  // 创作服务器在所有创作芯片下都挂：@排版/@3D 同样需要「把已生成的结果放进画布」和
  // 创作上下文查询。只有 @影音 允许那个会花钱的 submit_creation_task——以前只有 @影音
  // 挂它，于是只开 @排版 时 add_creation_result_to_canvas 成了 unknown tool，模型只
  // 好自己找 CLI 硬做（curl 60 秒超时），最后交出一份对话复盘当回答。
  const needsCreation = Boolean(input.avSelected || input.mediaSelected || input.scene3dSelected)
  const needsMcp = needsCreation || mcpServerIds.length > 0
  const mcpLaunch = needsMcp
    ? await invoke<{ command: string; args: string[]; cwd?: string }>('resolve_creation_mcp')
    : null
  // patch 里新增插件必须包在 `- insert:` 里：官方 patch 语义（dsh-app-boot 的
  // applyEntryPatches）对非 insert 条目是按 id 匹配**已有**行，匹配不到只 warn + 跳过。
  // 我们以前把 MCP 条目直接写成顶层 `- id:`，于是全部被静默丢掉——创作 / 媒体 / 3D /
  // 自定义 MCP 在 Harness 会话里从来没有挂上过（`dsh --dump-config` 实测命中 0，
  // stderr 报 patch: entry not found）。
  const insertPatch = (entries: string[]) => entries.length
    ? ['- insert:', ...entries.map(line => line ? `    ${line}` : line)]
    : []
  const mcpEntry = (id: string, serverName: string, env: Record<string, string>) => [
    `- id: ${JSON.stringify(id)}`,
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    `    serverName: ${JSON.stringify(serverName)}`,
    '    transport: stdio',
    `    command: ${JSON.stringify(mcpLaunch!.command)}`,
    `    args: ${JSON.stringify(mcpLaunch!.args)}`,
    ...(mcpLaunch!.cwd ? [`    cwd: ${JSON.stringify(mcpLaunch!.cwd)}`] : []),
    '    env:',
    ...Object.entries(env).map(([key, value]) => `      ${key}: ${JSON.stringify(value)}`),
    // 生图、生视频、3D 导出是长任务，官方默认 60 秒不够（有意偏离，见 Harness 合同 §12.3）。
    '    toolCallTimeoutMs: 900000',
    // 不写 failOnStartupError，用官方默认 false：MCP 起不来只让那台服务器的工具不出现并
    // 记一条 error，不把整轮对话判失败。写 true 时「创作 MCP 没起来」会升级成「任务失败」。
    '',
  ]
  const mcpPatch = insertPatch([
    ...(needsCreation ? mcpEntry('mcp-jiucaihezi-creation', 'jiucaihezi-creation', {
      // capabilities 必须带 'av'：App 用 `/av` 筛模型表，缺了它 list_creation_models
      // 返回空。付费闸门是另一件事，走 JIUCAIHEZI_CREATION_PAID。
      JIUCAIHEZI_CREATION_CAPABILITIES: 'av',
      ...(input.avSelected ? {} : { JIUCAIHEZI_CREATION_PAID: '0' }),
    }) : []),
    ...(localCapabilities.length ? mcpEntry('mcp-jiucaihezi-tools', 'jiucaihezi', {
      JIUCAIHEZI_PROXY_CAPABILITIES: localCapabilities.join(','),
    }) : []),
    ...mcpServerIds.flatMap((serverName, index) => mcpEntry(`mcp-proxy-${index}`, serverName, {
      JIUCAIHEZI_PROXY_MCP_SERVER: serverName,
    })),
  ])
  // 官方 subagent 工具在 continuable（后台）模式下 `run_in_background` 默认 true：
  // 派发只回一句 “started subagent <id>”，父代理拿不到结果却以为已完成，于是重复派活、
  // 重复写文件（实测一轮 34 分钟里 1.md/3.md 各被写两遍，16–20 集的失败也无人知晓）。
  // 改成官方 one-shot：该模式默认等结果，父代理能拿到子代理的产出与失败。
  // config 必须给全量且照抄基线——patch 按顶层键整体替换，漏一个键会把 provider/toolName
  // 一起抹掉；`subagent_fork` 在 sdk 基线上本来就是 one-shot，不需要在这里重复声明。
  const subagentPatch = [
    '- id: tool-subagent',
    '  config:',
    '    provider: spawn',
    '    toolName: subagent',
    '    backgroundMode: one-shot',
    '',
  ]
  // 官方 @file 语义的对话面：引用文件只给路径，正文由模型自己 read。官方 provider
  // `dsh-file-reference-local` 会往系统提示装一段 FILE_REFERENCE_PROMPT（"@ 开头的是
  // 用户显式引用的路径…读完之前不要声称看过"），而且只在 agent 有 read 工具时才装。
  const fileReferencePatch = insertPatch([
    '- id: file-reference-local',
    "  name: '@deepseek-ai/dsh-file-reference-local'",
  ])
  // 官方 Computer Use（计算机操作）：`dsh-computer-use` 只占一个提供方注册位，模型可见的
  // 工具由提供方给 —— 一次只能挂一个，第二个注册会失败并报出已占用者名。我们挂原生那个：
  // 上游 Cua Driver 的 npm 原生运行时跑在 harness 进程内，用户机器不用另装 CLI。
  // 代价两处，都是官方的已知限制：原生崩溃会带走 harness 进程（要独立进程就用 MCP 那个
  // 提供方），截图走持久化附件、只有声明图片输入的模型路由收得到（见上面的 modelInputLines）。
  const computerUsePatch = computerUseEnabledNow()
    ? insertPatch([
      '- id: computer-use',
      "  name: '@deepseek-ai/dsh-computer-use'",
      '- id: computer-use-cua-driver-native',
      "  name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'",
    ])
    : []
  await mkdir(routeDir, { recursive: true })
  // 不声明时官方默认就是纯文本（DEFAULT_INPUT = ["text"]），所以只有确实声明图片输入时才写这一行：
  // 显式写 [text] 没有信息增量，却会把 catalog 自带的模态一并抹掉。
  const modelInputLines = input.imageInput
    ? [`            input: ${JSON.stringify(deepSeekModelInput(true))}`]
    : []
  await writeTextFile(patchPath, [
        '- id: llm-pi-ai',
        '  config:',
        '    providers:',
        '      jiucaihezi:',
        '        displayName: 韭菜盒子',
        '        apiKeyEnv: JIUCAIHEZI_DH_API_KEY',
        '        api: openai-completions',
        `        baseURL: ${JSON.stringify(baseURL)}`,
        '        retryPolicy:',
        '          mode: normal',
        // 官方 `DEFAULT_MAX_RETRIES = 5`。原先写 1 的理由是「一次抖动不该被放大成 5 倍等待」,
        // 但实测 253 个步骤里 12 次传输故障（每个模型请求约 4.5%，一轮 7 步约 27%、42 步约 85%），
        // 502 是秒级失败、多等 ~15 秒几乎必然救回；而 turns 33/34 的 524 正是被那唯一一次重试救回来的。
        // 长任务的失败是必然事件，缺的是预算与可见性（重试链已进会话投影），不是次数。
        '          maxRetries: 5',
        '          retryableCodes:',
        '            - EMPTY_RESPONSE',
        '            - RATE_LIMIT',
        '            - SERVER',
        '            - TIMEOUT',
        '            - TRANSPORT',
        '            - PI_AI_ERROR',
        '        models:',
        `          - id: ${JSON.stringify(input.model)}`,
        `            name: ${JSON.stringify(input.model)}`,
        `            contextWindow: ${DEEPSEEK_HARNESS_CONTEXT_WINDOW}`,
        `            maxTokens: ${DEEPSEEK_HARNESS_MAX_OUTPUT_TOKENS}`,
        ...modelInputLines,
        '',
        ...mcpPatch,
        ...subagentPatch,
        ...fileReferencePatch,
        ...computerUsePatch,
      ].join('\n'))

  const runtimeRoot = 'deepseek-harness/node_modules'
  const command = await resolveResource(
    `${runtimeRoot}/node/bin/${navigator.userAgent.includes('Windows') ? 'node.exe' : 'node'}`,
  )
  const runner = await resolveResource('deepseek-harness/runner.mjs')
  const bundledSkills = await bundledSkillsDirectory()
  const transport = new McpStdioTransport({
    command,
    args: [runner, JSON.stringify({
      cwd: input.cwd,
      model: input.model,
      patchPath,
      dshHome: routeDir,
      // Computer Use 的插件包不在官方 bundle 依赖图里，profile 目录解析不到就只会静默
      // `failed to import`；runner 按这个开关决定要不要把它们挂进 profile（见 runner.mjs）。
      computerUse: computerUseEnabledNow(),
    })],
    cwd: input.cwd,
    env: {
      JIUCAIHEZI_DH_API_KEY: input.apiKey,
      DSH_HOME: routeDir,
      DSH_TELEMETRY_MODE: 'DISABLED',
      DSH_PERMISSION_MODE: input.permissionTier ?? DEEPSEEK_DEFAULT_PERMISSION_TIER,
      ...bundledSkills === undefined ? {} : { DSH_BUNDLED_SKILL_DIR: bundledSkills },
    },
  })
  let markReady!: () => void
  let failReady!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => { markReady = resolve; failReady = reject })
  let markClosed!: () => void
  const closed = new Promise<void>(resolve => { markClosed = resolve })
  const active: Runtime = {
    key: runtimeKey(input),
    transport,
    runs: new Map(),
    permissions: new Map(),
    permissionListeners: new Map(),
    closed,
    markClosed,
  }
  transport.onmessage = message => {
    const frame = message as unknown as BridgeMessage
    if (frame.type === 'ready') { markReady(); return }
    if (frame.type === 'closed') { active.markClosed(); return }
    const pending = frame.requestId ? active.runs.get(frame.requestId) : undefined
    if (!pending) return
    if (frame.type === 'notification' && frame.notification) pending.notify(frame.notification)
    if (frame.type === 'result') { active.runs.delete(frame.requestId!); pending.resolve(frame.text || '') }
    if (frame.type === 'query-result') { active.runs.delete(frame.requestId!); pending.resolve(frame.data) }
    if (frame.type === 'error') {
      active.runs.delete(frame.requestId!)
      const raw = frame.error || 'DeepSeek Harness 执行失败'
      const error = Object.assign(new Error(deepSeekFailureText(raw, frame.errorCode), { cause: new Error(raw) }), {
        name: frame.errorName || 'Error', code: frame.errorCode,
      })
      pending.reject(error)
    }
  }
  transport.onclose = () => {
    const diagnostics = transport.diagnostics()
    const detail = diagnostics.stderr.slice(-8).join('\n').trim()
    const error = new Error(detail ? `DeepSeek Harness 已退出\n${detail}` : 'DeepSeek Harness 已退出')
    failReady(error)
    for (const pending of active.runs.values()) pending.reject(error)
    active.runs.clear()
    active.markClosed()
  }
  await transport.start()
  try {
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DeepSeek Harness 启动超时')), 15_000)),
    ])
  } catch (error) {
    await transport.close()
    throw error
  }
  return active
}

async function queryDeepSeekHarness(
  input: DeepSeekHarnessInput,
  command: 'list-sessions' | 'read-session',
): Promise<any> {
  const active = await ensureRuntime(input, true)
  return harnessControl(active, {
    type: command,
    ...(command === 'read-session' ? { sessionId: deepSeekSessionId(input.sessionId) } : {}),
  }, input.signal)
}

export async function readDeepSeekHarnessSession(
  input: DeepSeekHarnessInput,
): Promise<DeepSeekSessionSnapshot> {
  return queryDeepSeekHarness(input, 'read-session')
}

export async function listDeepSeekHarnessSessions(
  input: DeepSeekHarnessInput,
): Promise<Array<{ header: { id: string }; live: boolean; persisted: boolean }>> {
  return queryDeepSeekHarness(input, 'list-sessions')
}

async function ensureRuntime(input: DeepSeekHarnessInput, reuseWorkspace = false): Promise<Runtime> {
  const workspaceKey = workspaceRuntimeKey(input)
  const key = runtimeKey(input)
  const current = runtimes.get(workspaceKey)
  if (current && (reuseWorkspace || current.key === key)) {
    const active = await current.ready
    if (!active.closing && !active.ended) return active
    await stopRuntime(active)
    if (runtimes.get(workspaceKey) === current) runtimes.delete(workspaceKey)
    return ensureRuntime(input, reuseWorkspace)
  }

  let predecessor: Runtime | undefined
  const slot: RuntimeSlot = {
    key,
    ready: (async () => {
      if (current) {
        predecessor = await current.ready
        await stopRuntime(predecessor)
      }
      return createRuntime(input)
    })(),
  }
  runtimes.set(workspaceKey, slot)
  try {
    const active = await slot.ready
    void active.closed.then(async () => {
      active.ended = true
      await stopRuntime(active)
      if (runtimes.get(workspaceKey) === slot) runtimes.delete(workspaceKey)
    }).catch(error => console.warn('[JC-DH] 运行时收尾失败:', error))
    return active
  } catch (error) {
    if (runtimes.get(workspaceKey) === slot) {
      // 新配置没有接手时仍保留旧拥有者；下一次发送必须先重试它的收尾。
      if (current && predecessor) runtimes.set(workspaceKey, current)
      else runtimes.delete(workspaceKey)
    }
    throw error
  }
}

/** Bounded control RPCs must also settle when stopping during permission alignment. */
async function harnessControl(active: Runtime, command: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const requestId = crypto.randomUUID()
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort = () => {}
  const completed = new Promise<any>((resolve, reject) => {
    abort = () => reject(new DOMException('Aborted', 'AbortError'))
    active.runs.set(requestId, { resolve, reject, notify() {} })
    timer = setTimeout(() => reject(new Error('运行时通信超时，请重试')), 15_000)
    signal?.addEventListener('abort', abort, { once: true })
  })
  try {
    // Include send in the deadline: a blocked transport must not prevent cancellation.
    void active.transport.send({ ...command, requestId } as unknown as JSONRPCMessage).catch(error => active.runs.get(requestId)?.reject(error))
    return await completed
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    active.runs.delete(requestId)
  }
}

async function sessionPermission(active: Runtime, sessionId: string, preset?: DeepSeekPermissionTier, signal?: AbortSignal, existingOnly = false): Promise<DeepSeekPermissionTier | undefined> {
  const data = await harnessControl(active, { type: 'permission', sessionId, existingOnly, ...(preset ? { preset } : {}) }, signal)
  if (existingOnly && data?.exists === false) return undefined
  const tier = DEEPSEEK_PERMISSION_TIERS.find(option => option.tier === data?.preset)?.tier
  if (!tier) throw new Error('宿主返回了无法识别的权限档位')
  active.permissions.set(sessionId, tier)
  active.permissionListeners.get(sessionId)?.(tier)
  return tier
}

export async function readCurrentDeepSeekPermission(cwd: string, conversationId: string, signal?: AbortSignal): Promise<DeepSeekPermissionTier | undefined> {
  const slot = runtimes.get(cwd)
  if (!slot) return undefined
  const active = await slot.ready
  if (active.closing) return undefined
  return sessionPermission(active, deepSeekSessionId(conversationId), undefined, signal, true)
}

/** Update the live Session through the official command; no runtime restart or prompt replay. */
export async function switchDeepSeekSessionPermission(cwd: string, conversationId: string, tier: DeepSeekPermissionTier, signal?: AbortSignal): Promise<DeepSeekPermissionTier | undefined> {
  const slot = runtimes.get(cwd)
  if (!slot) return undefined
  const active = await slot.ready
  if (active.closing) throw new Error('任务正在停止，请稍后切换权限')
  const sessionId = deepSeekSessionId(conversationId)
  try {
    const current = await sessionPermission(active, sessionId, undefined, signal, true)
    if (!current) return undefined
    return current === tier ? current : await sessionPermission(active, sessionId, tier, signal)
  } catch (error) {
    // A deadline can expire after the host committed. Read the authoritative state before reporting.
    if (!signal?.aborted) {
      try {
        const actual = await sessionPermission(active, sessionId, undefined, signal, true)
        if (actual === tier) return actual
        if (error instanceof Error && actual) Object.assign(error, { permissionTier: actual })
      } catch { /* keep the original error */ }
    }
    throw error
  }
}

async function alignSessionPermission(active: Runtime, sessionId: string, preset: DeepSeekPermissionTier = DEEPSEEK_DEFAULT_PERMISSION_TIER, signal?: AbortSignal): Promise<void> {
  const current = await sessionPermission(active, sessionId, undefined, signal)
  if (current !== preset) await sessionPermission(active, sessionId, preset, signal)
}

export async function queueDeepSeekHarnessMessage(input: DeepSeekHarnessInput): Promise<{ messageId: string }> {
  const active = await ensureRuntime(input, true)
  return await harnessControl(active, {
    type: 'queue',
    sessionId: deepSeekSessionId(input.sessionId),
    contentBlocks: deepSeekContentBlocks(input.message, input.attachments, input.files, input.imageInput),
  }, input.signal) as { messageId: string }
}

export type DeepSeekQueueAction =
  | { kind: 'edit'; text: string }
  | { kind: 'remove' }
  | { kind: 'steer' }

export async function updateDeepSeekHarnessQueue(
  input: DeepSeekHarnessInput & { itemId: string; action: DeepSeekQueueAction },
): Promise<{ accepted: true }> {
  const active = await ensureRuntime(input, true)
  const action = input.action.kind === 'edit'
    ? { kind: 'edit', content: [{ type: 'text', text: input.action.text }] }
    : { kind: input.action.kind }
  return await harnessControl(active, {
    type: 'update-queue',
    sessionId: deepSeekSessionId(input.sessionId),
    itemId: input.itemId,
    action,
  }, input.signal) as { accepted: true }
}

export async function runDeepSeekHarness(input: DeepSeekHarnessInput): Promise<string> {
  const { beginDesktopUpdateTask } = await import('./desktopUpdater')
  const release = await beginDesktopUpdateTask()
  try { return await runDeepSeekHarnessTask(input) }
  finally { await release() }
}

async function runDeepSeekHarnessTask(input: DeepSeekHarnessInput): Promise<string> {
  if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const wireSessionId = deepSeekSessionId(input.sessionId)
  // 官方把「同一会话的并发 resume」划给调用方排除：resume 要先把会话的写所有权拿到手，
  // 上一个句柄还没放手时第二次以写模式打开会被跨进程写锁顶回 `SessionAlreadyOwnedError`。
  // 在这里挡住，用户看到的是一句话，而不是几秒后的英文锁冲突。
  if (runningSessions.has(wireSessionId)) throw new Error(DEEPSEEK_HARNESS_BUSY_MESSAGE)
  runningSessions.add(wireSessionId)
  try {
    return await runDeepSeekHarnessTurn(input, wireSessionId)
  } finally {
    runningSessions.delete(wireSessionId)
  }
}

async function runDeepSeekHarnessTurn(
  input: DeepSeekHarnessInput,
  wireSessionId: string,
): Promise<string> {
  const active = await ensureRuntime(input)
  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const requestId = crypto.randomUUID()
  let finalText = ''
  let reasoningSent = ''
  const approvals = new Map<string, AbortController>()
  active.permissionListeners.set(wireSessionId, tier => input.onPermission?.(tier))
  const stream = { attemptId: '', nextIndex: 0, text: '', reasoning: '', turn: 0, step: 0 }
  const manjuArtifactCallIds = new Set<string>()
  const notify = (frame: NonNullable<BridgeMessage['notification']>) => {
    if (frame.params?.sessionId !== wireSessionId) return
    if (frame.method === 'session.approval-settled') {
      approvals.get(frame.params.id)?.abort()
      approvals.delete(frame.params.id)
      return
    }
    if (frame.method === 'session.approval-request') {
      const request = frame.params as DeepSeekApprovalRequest
      if (approvals.has(request.id)) return
      const controller = new AbortController()
      approvals.set(request.id, controller)
      input.onStatus?.('等待你的授权')
      void Promise.resolve().then(() => input.onApproval?.(request, controller.signal) ?? 'unavailable').then(async outcome => {
        if (controller.signal.aborted || input.signal?.aborted) return
        await harnessControl(active, { type: 'approval', approval: { ...request, outcome } }, input.signal)
      }).catch(error => {
        if (controller.signal.aborted || input.signal?.aborted) return
        const failure = new Error(`授权通信失败：${error instanceof Error ? error.message : String(error)}`)
        input.onStatus?.(failure.message)
        active.runs.get(requestId)?.reject(failure)
        // The card has already settled locally; close the host to cancel a lost reply rather than leaving an unanswerable request.
        void stopRuntime(active).catch(error => console.warn('[JC-DH] 授权失败后的收尾失败:', error))
      })
      return
    }
    if (frame.method === 'session.assistant-stream') {
      const text = applyDeepSeekAssistantStream(stream, frame.params.frame)
      if (text !== undefined) input.onText?.(text)
      // 推理不进正文：它在 `assistant/message` 里是一个独立的内容块，实时也走单独通道。
      if (stream.reasoning !== reasoningSent) {
        reasoningSent = stream.reasoning
        input.onReasoning?.(stream.reasoning)
      }
      return
    }
    if (frame.method === 'session.event') {
      const event = frame.params.event
      input.onSessionEvent?.(event)
      if (event?.type === 'assistant/message' && isAppendSurface(event))
        input.onUsage?.(deepSeekMessageUsage(event))
      if (event?.type === 'tool/call' && event.data.name === 'wiki_save_artifact')
        manjuArtifactCallIds.add(String(event.data.callId))
      if (event?.type === 'tool/result') {
        const message = event.data.message
        const callId = String(message.toolCallId || message.source?.callId || '')
        if (callId && manjuArtifactCallIds.delete(callId) && !message.isError) {
          const content = Array.isArray(message.content)
            ? message.content as Array<{ type?: unknown; text?: unknown }>
            : []
          const text = content
            .filter((block): block is { type: 'text'; text: string } =>
              block?.type === 'text' && typeof block.text === 'string')
            .map(block => block.text)
            .join('\n')
          try {
            const result = JSON.parse(text) as { status?: unknown; path?: unknown }
            const path = typeof result.path === 'string' ? result.path : ''
            const safePath = /^(?:wiki|docs\/wiki)\//.test(path)
              && path.endsWith('.md')
              && !path.split('/').some(part => part === '.' || part === '..')
            if ((result.status === 'saved' || result.status === 'saved_with_warnings') && safePath)
              input.onArtifactSaved?.(path)
          } catch { /* a malformed tool result must not interrupt the Harness event stream */ }
        }
      }
      if (event?.type === 'step/start') input.onStatus?.('正在分析')
      if (event?.type === 'llm/retry') {
        const retry = Number(event.data?.retry || 0)
        const max = Number(event.data?.maxRetries || 0)
        // 上游原因必须显形：只报「正在重试」时，16 分钟的盲等和 10 秒的诊断没法区分。
        // 事件自带 failure（如 SERVER + 524 原文），JSON 主体不上面向用户的状态行。
        // 文案对齐官方 `message.retry.active`（“正在重试模型请求”），后面按 `message.retry.status`
        // 补上 `（{retry}/{maximum}）`。
        const failure = event.data?.failure
        const detail = [failure?.code, String(failure?.message ?? '').replace(/\s*\{[\s\S]*$/, '')]
          .map(value => String(value ?? '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join(' ')
        input.onStatus?.(max ? `正在重试模型请求（${retry}/${max}）${detail ? `·${detail}` : ''}` : '正在重试模型请求')
      }
      const progress = deepSeekProgress(event)
      if (progress?.id) input.onProgress?.(progress)
      const text = deepSeekAssistantText(event)
      if (text) {
        finalText = text
        input.onText?.(text)
      }
    }
  }
  const abort = () => {
    const rejectRun = () => {
      active.runs.get(requestId)?.reject(new DOMException('Aborted', 'AbortError'))
      active.runs.delete(requestId)
    }
    void harnessControl(active, { type: 'cancel', sessionId: wireSessionId })
      .then(rejectRun)
      .catch(error => {
        console.warn('[JC-DH] 会话停止失败，正在收尾运行时:', error)
        void stopRuntime(active).catch(closeError => console.warn('[JC-DH] 取消后的收尾失败:', closeError)).finally(rejectRun)
      })
  }
  input.signal?.addEventListener('abort', abort, { once: true })
  try {
    input.onStatus?.('正在启动')
    await alignSessionPermission(active, wireSessionId, input.permissionTier, input.signal)
    const completed = new Promise<string>((resolve, reject) => {
      active.runs.set(requestId, { resolve, reject, notify })
    })
    await active.transport.send({
      type: 'run',
      requestId,
      sessionId: wireSessionId,
      contentBlocks: deepSeekContentBlocks(input.message, input.attachments, input.files, input.imageInput),
    } as unknown as JSONRPCMessage)
    input.onStatus?.('正在执行')
    const result = await completed || finalText
    if (!result.trim()) throw new Error('DeepSeek Harness 未返回正文')
    return result
  } finally {
    for (const controller of approvals.values()) controller.abort()
    approvals.clear()
    active.permissionListeners.delete(wireSessionId)
    active.runs.delete(requestId)
    input.signal?.removeEventListener('abort', abort)
  }
}

async function waitForRuntimeClose(active: Runtime, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      active.closed.then(() => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function stopRuntime(active: Runtime): Promise<void> {
  active.closing ??= (async () => {
    try {
      // stdin 背压也在关闭期限内；发送被卡住不能让进程树收尾永不可达。
      void active.transport.send({ type: 'close' } as unknown as JSONRPCMessage).catch(error => {
        console.warn('[JC-DH] 关闭请求未能送达:', error)
        active.markClosed()
      })
      if (!await waitForRuntimeClose(active, DEEPSEEK_HARNESS_SHUTDOWN_TIMEOUT_MS)) {
        console.warn(`[JC-DH] ${DEEPSEEK_HARNESS_SHUTDOWN_TIMEOUT_MS}ms 内未确认关闭，按进程树收尾`)
      }
    } catch (error) {
      // 进程早就没了、或 stdin 已经写不进去：都不影响下面的收尾。
      console.warn('[JC-DH] 关闭请求未能送达:', error)
    } finally {
      // 兜底必须无条件执行：`mcp_kill_stdio` 现在按进程树收尾，否则留下的 `dsh` 子进程
      // 会一直握着这个会话的跨进程写锁。
      await active.transport.close()
    }
  })().catch(error => {
    // 收尾失败没有释放所有权；保留登记并允许下一次发送再次完成收尾。
    active.ended = true
    active.closing = undefined
    throw error
  })
  return active.closing
}

export async function stopDeepSeekHarness(strict = false): Promise<void> {
  const slots = [...runtimes.entries()]
  const results = await Promise.allSettled(slots.map(async ([key, slot]) => {
    await stopRuntime(await slot.ready)
    if (runtimes.get(key) === slot) runtimes.delete(key)
  }))
  if (strict) {
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }
}
