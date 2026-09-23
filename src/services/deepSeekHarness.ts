import { invoke } from '@tauri-apps/api/core'
import { resolveResource } from '@tauri-apps/api/path'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import type { DirectMessageFile, ResolvedDirectAttachment } from '@/utils/directMessageBuilder'
import type { ConversationTurn } from '@/runtime/memory/conversationTranscript'
import { McpStdioTransport } from './mcpStdioTransport'

type BridgeMessage = {
  type: 'ready' | 'notification' | 'result' | 'error' | 'closed'
  requestId?: string
  notification?: { method?: string; params?: any }
  text?: string
  error?: string
}
type Runtime = {
  key: string
  transport: McpStdioTransport
  runs: Map<string, {
    resolve: (value: string) => void
    reject: (error: Error) => void
    notify: (notification: NonNullable<BridgeMessage['notification']>) => void
  }>
  closed: Promise<void>
  markClosed: () => void
}

export interface DeepSeekHarnessInput {
  cwd: string
  sessionId: string
  message: string
  model: string
  apiBase: string
  apiKey: string
  fileAccessEnabled?: boolean
  files?: DirectMessageFile[]
  attachments?: ResolvedDirectAttachment[]
  signal?: AbortSignal
  onText?: (text: string) => void
  onStatus?: (status: string) => void
  onProgress?: (progress: DeepSeekProgress) => void
}

export type DeepSeekProgress = {
  id: string
  label?: string
  state: 'running' | 'done' | 'failed'
}

export type DeepSeekAssistantStreamState = {
  attemptId: string
  nextIndex: number
  text: string
}

export const DEEPSEEK_HARNESS_CONTEXT_WINDOW = 262_144
export const DEEPSEEK_HARNESS_MAX_OUTPUT_TOKENS = 32_768
export const DEEPSEEK_HARNESS_SESSION_MARKER = 'dh-session-v1'

let runtime: Runtime | null = null

export function deepSeekPermissionMode(fileAccessEnabled = false): 'workspace-write' | 'danger-full-access' {
  return fileAccessEnabled ? 'danger-full-access' : 'workspace-write'
}

function runtimeKey(input: DeepSeekHarnessInput): string {
  return `${input.cwd}\0${input.apiBase}\0${input.model}\0${deepSeekPermissionMode(input.fileAccessEnabled)}`
}

export function deepSeekSessionId(conversationId: string): string {
  return `jc-v1-${conversationId}`
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

export function applyDeepSeekAssistantStream(
  state: DeepSeekAssistantStreamState,
  frame: any,
): string | undefined {
  if (frame?.type === 'start') {
    state.attemptId = String(frame.attemptId || '')
    state.nextIndex = 0
    state.text = ''
    return ''
  }
  if (
    frame?.type !== 'chunk'
    || String(frame.attemptId || '') !== state.attemptId
    || frame.index !== state.nextIndex
  ) return undefined
  state.nextIndex += 1
  if (frame.chunk?.type !== 'text-delta') return undefined
  state.text += String(frame.chunk.text || '')
  return state.text
}

function deepSeekToolLabel(name: string): string {
  if (/read/i.test(name)) return '读取文件'
  if (/grep|search/i.test(name)) return '搜索内容'
  if (/glob|find|list/i.test(name)) return '查找文件'
  if (/write|edit|patch/i.test(name)) return '修改文件'
  if (/bash|terminal|pwsh|command/i.test(name)) return '执行命令'
  if (/skill/i.test(name)) return '加载 Skill'
  return `执行 ${name || '工具'}`
}

export function deepSeekProgress(event: any): DeepSeekProgress | undefined {
  if (event?.type === 'tool/call') return {
    id: String(event.data?.callId || ''),
    label: deepSeekToolLabel(String(event.data?.name || '')),
    state: 'running',
  }
  if (event?.type === 'tool/result') return {
    id: String(event.data?.message?.toolCallId || ''),
    state: event.data?.message?.isError ? 'failed' : 'done',
  }
  return undefined
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
): any[] {
  const inlineFiles = [
    ...files,
    ...attachments.flatMap(attachment => attachment.textContent
      ? [{ name: attachment.name, content: attachment.textContent }]
      : []),
  ]
  const text = [
    message,
    ...inlineFiles.map(file => `[已读取文件: ${file.name}]\n${file.content.slice(0, 120_000)}`),
  ].filter(Boolean).join('\n\n')
  const blocks: any[] = [{ type: 'text', text }]
  for (const attachment of attachments) {
    if (attachment.kind !== 'image') continue
    const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/s.exec(attachment.value)
    const mimeType = (match?.[1] || attachment.mime).toLowerCase().replace('image/jpg', 'image/jpeg')
    if (!match || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType)) continue
    blocks.push({ type: 'image', data: match[2], mimeType })
  }
  return blocks
}

export function deepSeekTurnError(event: any): string {
  if (event?.type !== 'turn/end' || event?.data?.reason?.kind !== 'error') return ''
  return String(event.data.reason.error?.message || 'DeepSeek Harness 执行失败')
}

async function createRuntime(input: DeepSeekHarnessInput): Promise<Runtime> {
  const relativePatchPath = '.raw/临时任务/deepseek-harness/route.cordis.yml'
  const routeDir = `${input.cwd.replace(/[\\/]+$/, '')}/.raw/临时任务/deepseek-harness`
  const patchPath = `${routeDir}/route.cordis.yml`
  const apiBase = input.apiBase.replace(/\/+$/, '')
  const baseURL = apiBase.endsWith('/v1') ? apiBase : `${apiBase}/v1`
  await invoke('dev_write_file', {
    input: {
      root: input.cwd,
      relativePath: relativePatchPath,
      content: [
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
        '',
      ].join('\n'),
    },
  })

  const runtimeRoot = 'deepseek-harness/node_modules'
  const command = await resolveResource(
    `${runtimeRoot}/node/bin/${navigator.userAgent.includes('Windows') ? 'node.exe' : 'node'}`,
  )
  const runner = await resolveResource('deepseek-harness/runner.mjs')
  const transport = new McpStdioTransport({
    command,
    args: [runner, JSON.stringify({ cwd: input.cwd, model: input.model, patchPath, dshHome: routeDir })],
    cwd: input.cwd,
    env: {
      JIUCAIHEZI_DH_API_KEY: input.apiKey,
      DSH_HOME: routeDir,
      DSH_TELEMETRY_MODE: 'DISABLED',
      DSH_PERMISSION_MODE: deepSeekPermissionMode(input.fileAccessEnabled),
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
    if (runtime === active) runtime = null
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

async function ensureRuntime(input: DeepSeekHarnessInput): Promise<Runtime> {
  const key = runtimeKey(input)
  if (runtime?.key === key) return runtime
  await stopDeepSeekHarness()
  runtime = await createRuntime(input)
  return runtime
}

export async function runDeepSeekHarness(input: DeepSeekHarnessInput): Promise<string> {
  if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const active = await ensureRuntime(input)
  const wireSessionId = deepSeekSessionId(input.sessionId)
  const requestId = crypto.randomUUID()
  let finalText = ''
  const stream = { attemptId: '', nextIndex: 0, text: '' }
  const notify = (frame: NonNullable<BridgeMessage['notification']>) => {
    if (frame.params?.sessionId !== wireSessionId) return
    if (frame.method === 'session.assistant-stream') {
      const text = applyDeepSeekAssistantStream(stream, frame.params.frame)
      if (text !== undefined) input.onText?.(text)
      return
    }
    if (frame.method === 'session.event') {
      const event = frame.params.event
      if (event?.type === 'step/start') input.onStatus?.('正在分析')
      if (event?.type === 'llm/retry') {
        const retry = Number(event.data?.retry || 0)
        const max = Number(event.data?.maxRetries || 0)
        input.onStatus?.(max ? `正在重试（${retry}/${max}）` : '正在重试')
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
    void stopDeepSeekHarness()
    active.runs.get(requestId)?.reject(new DOMException('Aborted', 'AbortError'))
    active.runs.delete(requestId)
  }
  input.signal?.addEventListener('abort', abort, { once: true })
  try {
    input.onStatus?.('正在启动')
    const completed = new Promise<string>((resolve, reject) => {
      active.runs.set(requestId, { resolve, reject, notify })
    })
    await active.transport.send({
      type: 'run',
      requestId,
      sessionId: wireSessionId,
      contentBlocks: deepSeekContentBlocks(input.message, input.attachments, input.files),
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

export async function stopDeepSeekHarness(): Promise<void> {
  const active = runtime
  runtime = null
  if (!active) return
  try {
    await active.transport.send({ type: 'close' } as unknown as JSONRPCMessage)
    await active.closed
  } finally {
    await active.transport.close()
  }
}
