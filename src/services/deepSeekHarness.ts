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
  fileAccessEnabled?: boolean
  mediaSelected?: boolean
  avSelected?: boolean
  scene3dSelected?: boolean
  mcpServerIds?: string[]
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

export type DeepSeekSessionSnapshot = {
  session: { id: string; cwd?: string; createdAt?: number }
  events: any[]
}

export const DEEPSEEK_HARNESS_CONTEXT_WINDOW = 262_144
export const DEEPSEEK_HARNESS_MAX_OUTPUT_TOKENS = 32_768
export const DEEPSEEK_HARNESS_SESSION_MARKER = 'dh-session-v1'

const runtimes = new Map<string, RuntimeSlot>()

export function deepSeekPermissionMode(fileAccessEnabled = false): 'workspace-write' | 'danger-full-access' {
  return fileAccessEnabled ? 'danger-full-access' : 'workspace-write'
}

function runtimeKey(input: DeepSeekHarnessInput): string {
  return [
    input.cwd,
    input.apiBase,
    input.model,
    deepSeekPermissionMode(input.fileAccessEnabled),
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

function deepSeekMessageText(content: any): string {
  return Array.isArray(content)
    ? content.filter(block => block?.type === 'text').map(block => String(block.text || '')).join('')
    : ''
}

function visibleDeepSeekUserText(text: string): string {
  const current = text.split('【本轮消息】\n\n').at(-1) || text
  return current.replace(/^(?:\/[\w.-]+(?:\s+|$))+\n*/u, '').trim()
}

export function deepSeekSessionTurns(snapshot: DeepSeekSessionSnapshot): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  for (const event of snapshot.events || []) {
    if (event?.type === 'user/message' && event.data?.source?.kind === 'user') {
      const content = visibleDeepSeekUserText(deepSeekMessageText(event.data.content))
      if (content) turns.push({
        id: String(event.data.id || `dh-user-${event.seq}`),
        role: 'user',
        content,
        createdAt: new Date(Number(event.time) || Date.now()).toISOString(),
        toolChips: [DEEPSEEK_HARNESS_SESSION_MARKER],
      })
    }
    if (event?.type === 'assistant/message') {
      const content = deepSeekMessageText(event.data?.message?.content)
      if (content) turns.push({
        id: String(event.data.message.id || `dh-assistant-${event.seq}`),
        role: 'assistant',
        content,
        createdAt: new Date(Number(event.time) || Date.now()).toISOString(),
      })
    }
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
  await mkdir(routeDir, { recursive: true })
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
        '',
        ...mcpPatch,
      ].join('\n'))

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

export async function runDeepSeekHarness(input: DeepSeekHarnessInput): Promise<string> {
  if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const active = await ensureRuntime(input)
  if (input.signal?.aborted) {
    void stopRuntime(active)
    throw new DOMException('Aborted', 'AbortError')
  }
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
    void stopRuntime(active)
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

function stopRuntime(active: Runtime): Promise<void> {
  active.closing ??= (async () => {
    try {
      await active.transport.send({ type: 'close' } as unknown as JSONRPCMessage)
      await active.closed
    } finally {
      await active.transport.close()
    }
  })()
  return active.closing
}

export async function stopDeepSeekHarness(): Promise<void> {
  const slots = [...runtimes.values()]
  runtimes.clear()
  await Promise.allSettled(slots.map(async slot => stopRuntime(await slot.ready)))
}
