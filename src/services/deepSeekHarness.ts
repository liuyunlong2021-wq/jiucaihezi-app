import { invoke } from '@tauri-apps/api/core'
import { appDataDir, join, resolveResource } from '@tauri-apps/api/path'
import { mkdir, writeTextFile } from '@tauri-apps/plugin-fs'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { DirectMessageFile, ResolvedDirectAttachment } from '@/utils/directMessageBuilder'
import type { ConversationTurn } from '@/runtime/memory/conversationTranscript'
import { McpStdioTransport } from './mcpStdioTransport'

type BridgeMessage = {
  type: 'ready' | 'notification' | 'result' | 'query-result' | 'error' | 'closed'
  requestId?: string
  notification?: { method?: string; params?: any }
  text?: string
  data?: unknown
  error?: string
}
type Runtime = {
  key: string
  transport: McpStdioTransport
  runs: Map<string, {
    resolve: (value: any) => void
    reject: (error: Error) => void
    notify: (notification: NonNullable<BridgeMessage['notification']>) => void
  }>
  /** 已拉齐到 `@文件` 语义的会话（wire id）→ 当前预设；只在 runtime 存活期内记。 */
  permissions: Map<string, string>
  closed: Promise<void>
  markClosed: () => void
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
  onStatus?: (status: string) => void
  /** 实时推理正文；只在内容真的变化时回调，与 `onText` 分开、不混进消息体。 */
  onReasoning?: (text: string) => void
  onProgress?: (progress: DeepSeekProgress) => void
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
}

/** 一次工具调用在 UI 上的完整投影（实时与历史同源）。 */
export type DeepSeekProcessStep = {
  id: string
  /**
   * 条目种类。`tool`（默认）是一次工具调用；`narration` 是模型在步骤之间说的那句话 ——
   * 官方把它归**过程**不归答案（`processSpec` 只把 step < 答案步的正文算进过程）。
   */
  kind?: 'tool' | 'narration'
  label: string
  summary: string
  state: 'running' | 'done' | 'failed'
  startedAt?: number
  durationMs?: number
  errorReason?: string
  resultText?: string
  resultTruncated?: boolean
  /** 叙述条目的正文，仅 `kind === 'narration'` 使用。 */
  narration?: string
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
 * 中间档的 `note` 必须写「会被拒绝」而不是「会询问」：DH 路径下没有任何东西应答
 * `approval/request`，越界是 fail-closed 直接失败，不是弹窗问一次。
 */
export const DEEPSEEK_PERMISSION_TIERS: ReadonlyArray<{
  tier: DeepSeekPermissionTier
  label: string
  short: string
  note: string
}> = [
  { tier: 'read-only', label: '仅可查看', short: '仅可查看', note: '不改动任何文件' },
  { tier: 'workspace-write', label: '工作区内修改', short: '工作区', note: '只能改工作区内的文件，越界会被拒绝' },
  { tier: 'danger-full-access', label: '完全权限', short: '完全权限', note: '本机文件不再受限，也不再询问' },
]

/** 默认档：官方 `sandbox-policy.mode` 的缺省值，也是审批策略为 `ask` 的那一档。 */
export const DEEPSEEK_DEFAULT_PERMISSION_TIER: DeepSeekPermissionTier = 'workspace-write'

/**
 * 档位 → 落盘芯片。
 *
 * 默认档不落芯片（与旧会话一致：没芯片 = 默认档）；`danger-full-access` 仍写 `file` ——
 * 旧会话里 `file` 的意思就是「开」，语义一一对应，不需要迁移；`read-only` 是新档，
 * 用 `file:read-only`。芯片串是会话里持久化的唯一真相源，所以这两个函数成对写在一起。
 */
export function deepSeekPermissionChip(tier: DeepSeekPermissionTier): string | undefined {
  if (tier === 'danger-full-access') return 'file'
  return tier === 'read-only' ? 'file:read-only' : undefined
}

/** 落盘芯片 → 档位。见 {@link deepSeekPermissionChip}。 */
export function deepSeekPermissionFromChips(ids: Iterable<string>): DeepSeekPermissionTier {
  const chips = new Set(ids)
  if (chips.has('file')) return 'danger-full-access'
  return chips.has('file:read-only') ? 'read-only' : DEEPSEEK_DEFAULT_PERMISSION_TIER
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
    input.permissionTier ?? DEEPSEEK_DEFAULT_PERMISSION_TIER,
    input.mediaSelected ? 'media' : '',
    input.avSelected ? 'av' : '',
    input.scene3dSelected ? '3d' : '',
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

export function deepSeekProgress(event: any): DeepSeekProgress | undefined {
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
  if (event?.type === 'tool/result') {
    const isError = Boolean(event.data?.message?.isError)
    const { text, truncated } = deepSeekResultText(event.data?.message?.content)
    const endedAt = deepSeekOptionalNumber(Number(event?.time))
    const errorReason = deepSeekResultErrorReason(event.data?.error, isError, text)
    return {
      id: String(event.data?.message?.toolCallId || ''),
      state: isError ? 'failed' : 'done',
      ...endedAt === undefined ? {} : { endedAt },
      ...errorReason === undefined ? {} : { errorReason },
      resultText: text,
      resultTruncated: truncated,
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
  }
  const settled = deepSeekProgress(result)
  if (!settled) return step
  step.state = settled.state
  step.errorReason = settled.errorReason
  step.resultText = settled.resultText
  step.resultTruncated = settled.resultTruncated
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
 * 结果按 UI 轮次 id 侧存，不写 `ConversationTurn`：Harness 对话以 Session 为唯一真源，
 * 每次打开重建即可，不需要新的持久化格式。
 */
export function deepSeekSessionProcess(
  snapshot: DeepSeekSessionSnapshot,
): Map<string, DeepSeekProcessStep[]> {
  const owners = deepSeekTurnOwners(snapshot)
  const resultsByCall = new Map<string, any>()
  for (const event of snapshot.events || []) {
    if (event?.type !== 'tool/result' || !isAppendSurface(event)) continue
    const callId = String(event.data?.message?.toolCallId || '')
    if (callId) resultsByCall.set(callId, event)
  }
  const process = new Map<string, DeepSeekProcessStep[]>()
  const answers = deepSeekTurnAnswers(snapshot)
  const push = (owner: string, step: DeepSeekProcessStep) =>
    process.set(owner, [...process.get(owner) || [], step])
  for (const event of snapshot.events || []) {
    const owner = owners.get(Number(event?.data?.turn))
    if (!owner) continue
    if (event?.type === 'tool/call') {
      const step = deepSeekProcessStep(event, resultsByCall.get(String(event.data?.callId || '')))
      if (step) push(owner, step)
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
): string {
  const gestures = skillNames.map(name => `/${name}`).join(' ')
  const handoff = handoffTurns.length
    ? [
        '【既有对话移交】',
        ...handoffTurns.map(turn => `${turn.role === 'user' ? '用户' : '助手'}：${turn.content}`),
        '【本轮消息】',
      ].join('\n\n')
    : ''
  return [gestures, handoff, message].filter(Boolean).join('\n\n')
}

export function deepSeekContentBlocks(
  message: string,
  attachments: ResolvedDirectAttachment[] = [],
  files: DirectMessageFile[] = [],
  imageInput = false,
): any[] {
  const inlineFiles = [
    ...files,
    ...attachments.flatMap(attachment => attachment.textContent
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
  // 附件一律把**项目内路径**告诉模型：官方读图就是 `read_image(file_path)`，视频则要靠
  // `bash` 抽帧（jc-watch 那条链路，`read`/`read_image` 都读不了视频）。内联图片块只是
  // 给声明了视觉的模型省一次工具往返，路径才是模型自己能动手的那条路——不给它的话，
  // 模型手里只有一个附件 id，只能满盘找文件（实测 11 步工具、16 分钟后 524）。
  const attachmentKindLabels: Record<string, string> = { image: '图片', video: '视频', audio: '音频', file: '文件' }
  const attachmentPaths = attachments
    .filter(attachment => attachment.resourcePath)
    .map(attachment => `- ${attachment.name}（${attachmentKindLabels[attachment.kind] || '文件'}）：${attachment.resourcePath}`)
  const pathNotice = attachmentPaths.length
    ? ['[本轮附件]以下文件就在项目里，用 read 或 read_image 按路径直接读（视频先用 @jc-watch 抽帧）：', ...attachmentPaths].join('\n')
    : ''
  const text = [
    message,
    ...inlineFiles.map(file => `[已读取文件: ${file.name}]\n${file.content.slice(0, 120_000)}`),
    notice,
    pathNotice,
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
  const needsCreation = input.avSelected
  const localCapabilities = [input.mediaSelected && 'media', input.scene3dSelected && '3d'].filter(Boolean) as string[]
  const needsMcp = needsCreation || localCapabilities.length > 0 || mcpServerIds.length > 0
  const mcpLaunch = needsMcp
    ? await invoke<{ command: string; args: string[]; cwd?: string }>('resolve_creation_mcp')
    : null
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
    '    toolCallTimeoutMs: 900000',
    '    failOnStartupError: true',
    '',
  ]
  const mcpPatch = [
    ...(needsCreation ? mcpEntry('mcp-jiucaihezi-creation', 'jiucaihezi-creation', {
      JIUCAIHEZI_CREATION_CAPABILITIES: 'av',
    }) : []),
    ...(localCapabilities.length ? mcpEntry('mcp-jiucaihezi-tools', 'jiucaihezi', {
      JIUCAIHEZI_PROXY_CAPABILITIES: localCapabilities.join(','),
    }) : []),
    ...mcpServerIds.flatMap((serverName, index) => mcpEntry(`mcp-proxy-${index}`, serverName, {
      JIUCAIHEZI_PROXY_MCP_SERVER: serverName,
    })),
  ]
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
        '          maxRetries: 1',
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
      ].join('\n'))

  const runtimeRoot = 'deepseek-harness/node_modules'
  const command = await resolveResource(
    `${runtimeRoot}/node/bin/${navigator.userAgent.includes('Windows') ? 'node.exe' : 'node'}`,
  )
  const runner = await resolveResource('deepseek-harness/runner.mjs')
  const bundledSkills = await bundledSkillsDirectory()
  const transport = new McpStdioTransport({
    command,
    args: [runner, JSON.stringify({ cwd: input.cwd, model: input.model, patchPath, dshHome: routeDir })],
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
    if (frame.type === 'error') { active.runs.delete(frame.requestId!); pending.reject(new Error(frame.error || 'DeepSeek Harness 执行失败')) }
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
  const requestId = crypto.randomUUID()
  const completed = new Promise<any>((resolve, reject) => {
    active.runs.set(requestId, { resolve, reject, notify() {} })
  })
  try {
    await active.transport.send({
      type: command,
      requestId,
      ...(command === 'read-session' ? { sessionId: deepSeekSessionId(input.sessionId) } : {}),
    } as unknown as JSONRPCMessage)
    return await completed
  } finally {
    active.runs.delete(requestId)
  }
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
    if (!active.closing) return active
    await active.closing
    if (runtimes.get(workspaceKey) === current) runtimes.delete(workspaceKey)
    return ensureRuntime(input, reuseWorkspace)
  }

  const slot: RuntimeSlot = {
    key,
    ready: (async () => {
      if (current) await stopRuntime(await current.ready)
      return createRuntime(input)
    })(),
  }
  runtimes.set(workspaceKey, slot)
  try {
    const active = await slot.ready
    void active.closed.then(() => {
      if (runtimes.get(workspaceKey) === slot) runtimes.delete(workspaceKey)
    })
    return active
  } catch (error) {
    if (runtimes.get(workspaceKey) === slot) runtimes.delete(workspaceKey)
    throw error
  }
}

/**
 * 把当前会话的权限拉齐到选中的档位。
 *
 * 会话把权限记成 durable 事实（`permission/preset` + `sandbox/mode` + `approval/policy`，
 * 实测老会话里就是 workspace-write / workspace-write / ask），进程级 `DSH_PERMISSION_MODE`
 * 只决定**新会话**的默认值：官方 `pinInitialPermission` 对已存在的会话保留它自己记下的开关。
 * 所以打开 `@文件` 也松不开老会话的沙箱，写 `~/.agents/skills` 会拿到
 * `[sandbox: file access denied under workspace-write mode]` —— 用户看到的就是「没有权限」。
 *
 * 切换走官方命令面（`dsh-permission-presets` 注册的 `/permission <preset>`），不自己写
 * `permission/preset` 事件：官方那两个 canonical setter 才是沙箱与审批的真正开关。
 * SDK 通道没有权限方法，这条请求由 `scripts/prepare-deepseek-harness.mjs` 的第 5 处补丁补上。
 *
 * 每个 (runtime, 会话) 只切一次：`runtimeKey` 已经含权限模式，模式一变就是新 runtime；而切换会往
 * 会话日志写 `command/run` + `command/done` 两条生命周期事件，不该每轮都写。
 */
async function alignSessionPermission(
  active: Runtime,
  sessionId: string,
  preset: DeepSeekPermissionTier = DEEPSEEK_DEFAULT_PERMISSION_TIER,
): Promise<void> {
  if (active.permissions.get(sessionId) === preset) return
  const requestId = crypto.randomUUID()
  const completed = new Promise<unknown>((resolve, reject) => {
    // 这条请求不参与 UI 投影：官方命令面不产生模型轮次，也没有工具进度要转发。
    active.runs.set(requestId, { resolve, reject, notify: () => {} })
  })
  try {
    await active.transport.send({ type: 'permission', requestId, sessionId, preset } as unknown as JSONRPCMessage)
    await completed
  } finally {
    active.runs.delete(requestId)
  }
  active.permissions.set(sessionId, preset)
}

export async function runDeepSeekHarness(input: DeepSeekHarnessInput): Promise<string> {
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
    void stopRuntime(active)
    throw new DOMException('Aborted', 'AbortError')
  }
  const requestId = crypto.randomUUID()
  let finalText = ''
  let reasoningSent = ''
  const stream = { attemptId: '', nextIndex: 0, text: '', reasoning: '', turn: 0, step: 0 }
  const notify = (frame: NonNullable<BridgeMessage['notification']>) => {
    if (frame.params?.sessionId !== wireSessionId) return
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
    void stopRuntime(active)
    active.runs.get(requestId)?.reject(new DOMException('Aborted', 'AbortError'))
    active.runs.delete(requestId)
  }
  input.signal?.addEventListener('abort', abort, { once: true })
  try {
    input.onStatus?.('正在启动')
    await alignSessionPermission(active, wireSessionId, input.permissionTier)
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
      await active.transport.send({ type: 'close' } as unknown as JSONRPCMessage)
      if (!await waitForRuntimeClose(active, DEEPSEEK_HARNESS_SHUTDOWN_TIMEOUT_MS)) {
        console.warn(`[JC-DH] ${DEEPSEEK_HARNESS_SHUTDOWN_TIMEOUT_MS}ms 内未确认关闭，按进程树收尾`)
      }
    } catch (error) {
      // 进程早就没了、或 stdin 已经写不进去：都不影响下面的收尾。
      console.warn('[JC-DH] 关闭请求未能送达:', error)
    } finally {
      // 兜底必须无条件执行：`mcp_kill_stdio` 现在按进程树收尾，否则留下的 `dsh` 子进程
      // 会一直握着这个会话的跨进程写锁。
      await active.transport.close().catch(() => {})
    }
  })()
  return active.closing
}

export async function stopDeepSeekHarness(): Promise<void> {
  const slots = [...runtimes.values()]
  runtimes.clear()
  await Promise.allSettled(slots.map(async slot => stopRuntime(await slot.ready)))
}
