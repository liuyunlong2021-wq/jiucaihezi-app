import { invoke } from '@tauri-apps/api/core'
import { resolveResource } from '@tauri-apps/api/path'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { McpStdioTransport } from './mcpStdioTransport'

type JsonRpc = {
  id?: number
  method?: string
  params?: any
  result?: any
  error?: { message?: string }
}
type Runtime = {
  key: string
  sessionNonce: string
  transport: McpStdioTransport
  nextId: number
  pending: Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>
  observers: Set<(message: JsonRpc) => void>
}

export interface DeepSeekHarnessInput {
  cwd: string
  sessionId: string
  message: string
  model: string
  apiBase: string
  apiKey: string
  signal?: AbortSignal
  onText?: (text: string) => void
  onStatus?: (status: string) => void
}

let runtime: Runtime | null = null

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

export function deepSeekPrompt(message: string, skillNames: string[]): string {
  const gestures = skillNames.map(name => `/${name}`).join(' ')
  return gestures ? `${gestures}\n\n${message}` : message
}

export function deepSeekTurnError(event: any): string {
  if (event?.type !== 'turn/end' || event?.data?.reason?.kind !== 'error') return ''
  return String(event.data.reason.error?.message || 'DeepSeek Harness 执行失败')
}

async function request(
  active: Runtime,
  method: string,
  params: object,
  timeoutMs?: number,
): Promise<any> {
  const id = active.nextId++
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = new Promise((resolve, reject) => {
    active.pending.set(id, {
      resolve: value => {
        if (timer) clearTimeout(timer)
        resolve(value)
      },
      reject: error => {
        if (timer) clearTimeout(timer)
        reject(error)
      },
    })
    if (timeoutMs)
      timer = setTimeout(() => {
        active.pending.delete(id)
        reject(new Error(`DeepSeek Harness ${method} 超时`))
      }, timeoutMs)
  })
  try {
    await active.transport.send({ jsonrpc: '2.0', id, method, params } as JSONRPCMessage)
  } catch (error) {
    active.pending.delete(id)
    if (timer) clearTimeout(timer)
    throw error
  }
  return result
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
        '            contextWindow: 262144',
        '            maxTokens: 32768',
        '',
      ].join('\n'),
    },
  })

  const runtimeRoot = 'deepseek-harness/node_modules'
  const command = await resolveResource(
    `${runtimeRoot}/node/bin/${navigator.userAgent.includes('Windows') ? 'node.exe' : 'node'}`,
  )
  const dshBin = await resolveResource(`${runtimeRoot}/@deepseek-ai/dsh/lib/bin.js`)
  const transport = new McpStdioTransport({
    command,
    args: [...(dshBin ? [dshBin] : []), '--profile', 'sdk', '--patch', patchPath],
    cwd: input.cwd,
    env: {
      JIUCAIHEZI_DH_API_KEY: input.apiKey,
      DSH_HOME: routeDir,
      DSH_TELEMETRY_MODE: 'DISABLED',
    },
  })
  const active: Runtime = {
    key: `${input.cwd}\0${input.apiBase}\0${input.model}`,
    sessionNonce: crypto.randomUUID(),
    transport,
    nextId: 1,
    pending: new Map(),
    observers: new Set(),
  }
  transport.onmessage = message => {
    const frame = message as JsonRpc
    if (typeof frame.id === 'number') {
      const pending = active.pending.get(frame.id)
      if (!pending) return
      active.pending.delete(frame.id)
      if (frame.error) pending.reject(new Error(frame.error.message || 'DeepSeek Harness 请求失败'))
      else pending.resolve(frame.result)
      return
    }
    for (const observer of active.observers) observer(frame)
  }
  transport.onclose = () => {
    for (const pending of active.pending.values())
      pending.reject(new Error('DeepSeek Harness 已退出'))
    active.pending.clear()
    if (runtime === active) runtime = null
  }
  await transport.start()
  try {
    await request(
      active,
      'initialize',
      { cwd: input.cwd, provider: 'jiucaihezi', model: input.model },
      15_000,
    )
  } catch (error) {
    await transport.close()
    throw error
  }
  return active
}

async function ensureRuntime(input: DeepSeekHarnessInput): Promise<Runtime> {
  const key = `${input.cwd}\0${input.apiBase}\0${input.model}`
  if (runtime?.key === key) return runtime
  await stopDeepSeekHarness()
  runtime = await createRuntime(input)
  return runtime
}

export async function runDeepSeekHarness(input: DeepSeekHarnessInput): Promise<string> {
  if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const active = await ensureRuntime(input)
  const wireSessionId = `${input.sessionId}-${active.sessionNonce}`
  let finalText = ''
  let received = false
  let messageId = ''
  const earlyFrames: JsonRpc[] = []
  let settle!: (value: string) => void
  let fail!: (error: Error) => void
  const completed = new Promise<string>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  const observe = (frame: JsonRpc) => {
    if (!messageId) {
      earlyFrames.push(frame)
      return
    }
    if (frame.params?.sessionId !== wireSessionId) return
    if (frame.method === 'session.event') {
      const event = frame.params.event
      if (
        event?.type === 'agent/inbox/spliced' &&
        event?.data?.inserted?.some((item: any) => item?.id === messageId)
      )
        received = true
      const text = deepSeekAssistantText(event)
      if (text) {
        finalText = text
        input.onText?.(text)
      }
      const error = deepSeekTurnError(event)
      if (received && error) fail(new Error(error))
    }
    if (received && frame.method === 'session.status' && frame.params.status === 'idle')
      settle(finalText)
  }
  active.observers.add(observe)
  const abort = () => {
    void stopDeepSeekHarness()
    fail(new DOMException('Aborted', 'AbortError'))
  }
  input.signal?.addEventListener('abort', abort, { once: true })
  try {
    input.onStatus?.('正在启动 DeepSeek Harness')
    const accepted = await request(active, 'session/prompt', {
      sessionId: wireSessionId,
      contentBlocks: [{ type: 'text', text: input.message }],
    })
    messageId = String(accepted?.messageId || '')
    if (!messageId) throw new Error('DeepSeek Harness 未返回消息 ID')
    for (const frame of earlyFrames) observe(frame)
    input.onStatus?.('DeepSeek Harness 正在执行')
    const result = await completed
    if (!result.trim()) throw new Error('DeepSeek Harness 未返回正文')
    return result
  } finally {
    active.observers.delete(observe)
    input.signal?.removeEventListener('abort', abort)
  }
}

export async function stopDeepSeekHarness(): Promise<void> {
  const active = runtime
  runtime = null
  await active?.transport.close()
}
