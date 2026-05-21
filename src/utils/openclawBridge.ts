/**
 * utils/openclawBridge.ts — OpenClaw Gateway 完整连接桥
 *
 * 职责：
 *   1. WebSocket RPC 通信 (端口 18789)
 *   2. Session 生命周期管理 (create/send/subscribe)
 *   3. 工具调用事件转发 (exec/read/write/browser/cron)
 *   4. 执行审批机制 (exec.approval.resolve)
 *   5. 通过 Tauri Shell 启动 Gateway 子进程
 *   6. 暴露 Gateway 状态给 UI
 */
import { ref, readonly, type Ref } from 'vue'
import { emitEvent } from '@/utils/eventBus'
import { isTauriRuntime } from './tauriEnv'

// ═══════════════════════════════════════════════════
//  类型定义
// ═══════════════════════════════════════════════════

export type GatewayStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface GatewayInfo {
  status: GatewayStatus
  version?: string
  models?: string[]
  sessions?: number
  error?: string
  port: number
  url: string
}

/** OpenClaw 工具调用事件 */
export interface ToolCallEvent {
  id: string
  sessionKey: string
  toolName: string
  args: Record<string, unknown>
  status: 'pending' | 'approved' | 'denied' | 'running' | 'done' | 'error'
  result?: unknown
  error?: string
  requiresApproval: boolean
}

/** OpenClaw Session 消息事件 */
export interface SessionEvent {
  type: 'text' | 'tool_call' | 'tool_result' | 'thinking' | 'error' | 'done'
  sessionKey: string
  seq: number
  data: {
    text?: string
    toolCall?: ToolCallEvent
    error?: string
  }
}

/** Session 信息 */
export interface SessionInfo {
  key: string
  agentId?: string
  status: 'active' | 'idle' | 'closed'
  createdAt: number
}

// ═══════════════════════════════════════════════════
//  响应式状态
// ═══════════════════════════════════════════════════

const DEFAULT_PORT = 18789

const gateway = ref<GatewayInfo>({
  status: 'disconnected',
  port: DEFAULT_PORT,
  url: `ws://127.0.0.1:${DEFAULT_PORT}`,
})

/** 当前活跃 session */
const activeSession = ref<SessionInfo | null>(null)

/** OpenClaw 模式是否开启 */
const openclawMode = ref(false)

// ═══════════════════════════════════════════════════
//  内部状态
// ═══════════════════════════════════════════════════

let ws: WebSocket | null = null
let pendingCalls = new Map<string, {
  resolve: (v: any) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let gatewayProcess: any = null
let eventSubscriptions = new Map<string, Set<(event: SessionEvent) => void>>()
let globalSeq = 0

// ═══════════════════════════════════════════════════
//  配置
// ═══════════════════════════════════════════════════

function getConfig(): { port: number; authToken: string } {
  const port = parseInt(localStorage.getItem('jcOpenClawPort') || '') || DEFAULT_PORT
  const authToken = localStorage.getItem('jcOpenClawAuth') || ''
  return { port, authToken }
}

export function saveConfig(port: number, authToken: string) {
  localStorage.setItem('jcOpenClawPort', String(port))
  localStorage.setItem('jcOpenClawAuth', authToken)
}

// ═══════════════════════════════════════════════════
//  Gateway 进程管理 (Tauri)
// ═══════════════════════════════════════════════════

export async function startGatewayProcess(): Promise<boolean> {
  if (!isTauriRuntime()) {
    console.warn('[OpenClaw] 非 Tauri 环境，无法启动 Gateway 进程')
    return false
  }

  try {
    const { Command } = await import('@tauri-apps/plugin-shell')
    const cmd = Command.create('openclaw', ['gateway'], {
      env: { OPENCLAW_PORT: String(getConfig().port) },
    })

    cmd.on('error', (error: string) => {
      console.error('[OpenClaw] 进程错误:', error)
      gateway.value.status = 'error'
      gateway.value.error = error
    })

    cmd.on('close', (data: { code: number | null }) => {
      console.log('[OpenClaw] 进程退出, code:', data.code)
      gateway.value.status = 'disconnected'
      gatewayProcess = null
    })

    cmd.stdout.on('data', (line: string) => console.log('[OpenClaw]', line))
    cmd.stderr.on('data', (line: string) => console.warn('[OpenClaw]', line))

    gatewayProcess = await cmd.spawn()
    console.log('[OpenClaw] Gateway 进程已启动, PID:', gatewayProcess.pid)
    await new Promise(r => setTimeout(r, 2000))
    return true
  } catch (e: any) {
    console.error('[OpenClaw] 启动失败:', e.message)
    gateway.value.status = 'error'
    gateway.value.error = `启动失败: ${e.message}。请先安装 OpenClaw: npm i -g openclaw`
    return false
  }
}

export async function stopGatewayProcess() {
  if (gatewayProcess) {
    try { await gatewayProcess.kill() } catch {}
    gatewayProcess = null
  }
}

// ═══════════════════════════════════════════════════
//  WebSocket 连接 + 握手
// ═══════════════════════════════════════════════════

function makeId(): string {
  return `rpc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export async function connect(): Promise<void> {
  if (ws && ws.readyState === WebSocket.OPEN) return

  const { port, authToken } = getConfig()
  const url = authToken
    ? `ws://127.0.0.1:${port}?auth=${encodeURIComponent(authToken)}`
    : `ws://127.0.0.1:${port}`

  gateway.value.status = 'connecting'
  gateway.value.url = `ws://127.0.0.1:${port}`

  return new Promise((resolve) => {
    try {
      ws = new WebSocket(url)
    } catch {
      gateway.value.status = 'error'
      gateway.value.error = '无法创建 WebSocket 连接'
      resolve()
      return
    }

    ws.onopen = async () => {
      console.log('[OpenClaw] WebSocket 已连接')
      gateway.value.status = 'connected'
      gateway.value.error = undefined

      // 心跳
      heartbeatTimer = setInterval(() => {
        rpcCall('health').catch(() => {})
      }, 30000)

      // 获取 Gateway 信息
      try {
        const status = await rpcCall('status')
        gateway.value.version = status?.version
        gateway.value.models = status?.models
        gateway.value.sessions = status?.sessions?.length || 0
      } catch {}

      resolve()
    }

    ws.onclose = () => {
      console.log('[OpenClaw] WebSocket 断开')
      gateway.value.status = 'disconnected'
      cleanup()
      scheduleReconnect()
    }

    ws.onerror = () => {
      gateway.value.status = 'error'
      gateway.value.error = `无法连接到 Gateway (端口 ${port})`
      cleanup()
      resolve()
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data))
        handleMessage(msg)
      } catch {}
    }
  })
}

export function disconnect() {
  cleanup()
  if (ws) {
    ws.close()
    ws = null
  }
  gateway.value.status = 'disconnected'
  activeSession.value = null
}

function cleanup() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
  for (const [, pending] of pendingCalls) {
    clearTimeout(pending.timer)
    pending.reject(new Error('连接断开'))
  }
  pendingCalls.clear()
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect().catch(() => {})
  }, 5000)
}

// ═══════════════════════════════════════════════════
//  消息路由
// ═══════════════════════════════════════════════════

function handleMessage(msg: any) {
  // RPC 响应
  if (msg.type === 'res' && msg.id && pendingCalls.has(msg.id)) {
    const pending = pendingCalls.get(msg.id)!
    pendingCalls.delete(msg.id)
    clearTimeout(pending.timer)
    if (msg.error) {
      pending.reject(new Error(msg.error.message || 'RPC error'))
    } else {
      pending.resolve(msg.result ?? msg.payload)
    }
    return
  }

  // 事件流 (session 消息)
  if (msg.type === 'event') {
    handleEvent(msg)
    return
  }

  // 连接握手 challenge
  if (msg.type === 'connect.challenge') {
    handleChallenge(msg)
    return
  }

  // hello-ok
  if (msg.type === 'hello-ok') {
    console.log('[OpenClaw] 握手完成, 能力:', msg.payload?.features)
    return
  }
}

function handleChallenge(msg: any) {
  const { authToken } = getConfig()
  const connectMsg = {
    type: 'connect',
    id: makeId(),
    role: 'operator',
    token: authToken || undefined,
    nonce: msg.payload?.nonce,
    scopes: ['sessions', 'tools', 'agents', 'config'],
    client: {
      name: '韭菜盒子',
      version: '0.1.0',
      platform: 'tauri',
    },
  }
  ws?.send(JSON.stringify(connectMsg))
}

function handleEvent(msg: any) {
  const eventType = msg.event || ''
  const payload = msg.payload || {}
  const sessionKey = payload.sessionKey || payload.session || ''

  // 将 OpenClaw 事件转换为 SessionEvent
  const sessionEvent = mapToSessionEvent(eventType, payload, sessionKey)
  if (!sessionEvent) return

  // 通知订阅者
  const subs = eventSubscriptions.get(sessionKey)
  if (subs) {
    for (const fn of subs) fn(sessionEvent)
  }

  // 全局订阅 (key = '*')
  const globalSubs = eventSubscriptions.get('*')
  if (globalSubs) {
    for (const fn of globalSubs) fn(sessionEvent)
  }

  // 通过 eventBus 广播给 UI
  emitEvent('openclaw:session-event', sessionEvent)
}

function mapToSessionEvent(eventType: string, payload: any, sessionKey: string): SessionEvent | null {
  globalSeq++

  // 文本输出
  if (eventType === 'session.text' || eventType === 'session.message') {
    return {
      type: 'text',
      sessionKey,
      seq: globalSeq,
      data: { text: payload.text || payload.content || '' },
    }
  }

  // 思考过程
  if (eventType === 'session.thinking') {
    return {
      type: 'thinking',
      sessionKey,
      seq: globalSeq,
      data: { text: payload.text || '' },
    }
  }

  // 工具调用
  if (eventType === 'session.tool' || eventType === 'session.tool.call') {
    const toolCall: ToolCallEvent = {
      id: payload.callId || payload.id || makeId(),
      sessionKey,
      toolName: payload.toolName || payload.name || '',
      args: payload.args || payload.input || {},
      status: payload.requiresApproval ? 'pending' : 'running',
      requiresApproval: !!payload.requiresApproval,
    }
    return {
      type: 'tool_call',
      sessionKey,
      seq: globalSeq,
      data: { toolCall },
    }
  }

  // 工具结果
  if (eventType === 'session.tool.result' || eventType === 'session.tool.done') {
    const toolCall: ToolCallEvent = {
      id: payload.callId || payload.id || '',
      sessionKey,
      toolName: payload.toolName || payload.name || '',
      args: {},
      status: payload.error ? 'error' : 'done',
      result: payload.output || payload.result,
      error: payload.error,
      requiresApproval: false,
    }
    return {
      type: 'tool_result',
      sessionKey,
      seq: globalSeq,
      data: { toolCall },
    }
  }

  // 会话完成
  if (eventType === 'session.done' || eventType === 'session.end') {
    return {
      type: 'done',
      sessionKey,
      seq: globalSeq,
      data: {},
    }
  }

  // 错误
  if (eventType === 'session.error') {
    return {
      type: 'error',
      sessionKey,
      seq: globalSeq,
      data: { error: payload.message || payload.error || '未知错误' },
    }
  }

  return null
}

// ═══════════════════════════════════════════════════
//  RPC 调用
// ═══════════════════════════════════════════════════

export function rpcCall(method: string, params?: any, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Gateway 未连接'))
      return
    }

    const id = makeId()
    const timer = setTimeout(() => {
      pendingCalls.delete(id)
      reject(new Error(`RPC "${method}" 超时`))
    }, timeoutMs)

    pendingCalls.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ type: 'req', id, method, params }))
  })
}

// ═══════════════════════════════════════════════════
//  Session 管理
// ═══════════════════════════════════════════════════

/**
 * 创建新的 Agent 会话
 */
export async function sessionCreate(opts?: {
  agentId?: string
  systemPrompt?: string
  tools?: string[]
}): Promise<SessionInfo> {
  const result = await rpcCall('sessions.create', {
    agentId: opts?.agentId,
    systemPrompt: opts?.systemPrompt,
    tools: opts?.tools,
  })

  const session: SessionInfo = {
    key: result.sessionKey || result.key || result.id || makeId(),
    agentId: opts?.agentId,
    status: 'active',
    createdAt: Date.now(),
  }
  activeSession.value = session

  // 自动订阅事件
  await rpcCall('sessions.messages.subscribe', { sessionKey: session.key }).catch(() => {})

  return session
}

/**
 * 向会话发送消息
 */
export async function sessionSend(text: string, sessionKey?: string): Promise<void> {
  const key = sessionKey || activeSession.value?.key
  if (!key) throw new Error('没有活跃的 Session')

  await rpcCall('sessions.send', {
    sessionKey: key,
    message: text,
  })
}

/**
 * 中断当前会话的执行
 */
export async function sessionAbort(sessionKey?: string): Promise<void> {
  const key = sessionKey || activeSession.value?.key
  if (!key) return
  await rpcCall('sessions.abort', { sessionKey: key }).catch(() => {})
}

/**
 * 订阅 session 事件
 * 返回取消订阅函数
 */
export function onSessionEvent(
  callback: (event: SessionEvent) => void,
  sessionKey?: string,
): () => void {
  const key = sessionKey || '*'
  if (!eventSubscriptions.has(key)) {
    eventSubscriptions.set(key, new Set())
  }
  eventSubscriptions.get(key)!.add(callback)

  return () => {
    eventSubscriptions.get(key)?.delete(callback)
  }
}

// ═══════════════════════════════════════════════════
//  工具审批
// ═══════════════════════════════════════════════════

/**
 * 审批 exec 命令（允许执行）
 */
export async function approveExec(callId: string, sessionKey?: string): Promise<void> {
  const key = sessionKey || activeSession.value?.key
  await rpcCall('exec.approval.resolve', {
    callId,
    sessionKey: key,
    approved: true,
  })
}

/**
 * 拒绝 exec 命令
 */
export async function denyExec(callId: string, sessionKey?: string): Promise<void> {
  const key = sessionKey || activeSession.value?.key
  await rpcCall('exec.approval.resolve', {
    callId,
    sessionKey: key,
    approved: false,
  })
}

// ═══════════════════════════════════════════════════
//  直接工具调用 (绕过 LLM)
// ═══════════════════════════════════════════════════

/**
 * 直接调用 OpenClaw 工具
 */
export async function toolInvoke(
  name: string,
  args: Record<string, unknown>,
  sessionKey?: string,
): Promise<any> {
  const key = sessionKey || activeSession.value?.key
  return rpcCall('tools.invoke', {
    name,
    args,
    sessionKey: key,
  })
}

/**
 * 获取可用工具列表
 */
export async function toolCatalog(): Promise<any[]> {
  const result = await rpcCall('tools.catalog')
  return result?.tools || result || []
}

// ═══════════════════════════════════════════════════
//  AI 对话 (OpenAI 兼容 HTTP — 降级方案)
// ═══════════════════════════════════════════════════

/**
 * 通过 HTTP 端点发送 chat completion（无 Session 特性时的降级方案）
 */
export async function chatViaGateway(params: {
  model: string
  messages: Array<{ role: string; content: string | any[] }>
  stream?: boolean
  temperature?: number
  max_tokens?: number
}): Promise<Response> {
  const { port, authToken } = getConfig()
  const url = `http://127.0.0.1:${port}/v1/chat/completions`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  })
}

// ═══════════════════════════════════════════════════
//  健康检查
// ═══════════════════════════════════════════════════

export async function checkGatewayHealth(): Promise<boolean> {
  const { port } = getConfig()
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

// ═══════════════════════════════════════════════════
//  OpenClaw 模式切换
// ═══════════════════════════════════════════════════

export function setOpenClawMode(enabled: boolean) {
  openclawMode.value = enabled
  localStorage.setItem('jcOpenClawMode', String(enabled))
  emitEvent('openclaw:mode-changed', enabled)

  if (enabled && gateway.value.status !== 'connected') {
    // 自动尝试连接
    connect().catch(() => {})
  }
}

export function getOpenClawMode(): boolean {
  return openclawMode.value
}

function restoreOpenClawMode() {
  openclawMode.value = false
  localStorage.removeItem('jcOpenClawMode')
}

// ═══════════════════════════════════════════════════
//  自动启动
// ═══════════════════════════════════════════════════

let autoBootDone = false

export async function autoBootGateway(): Promise<void> {
  if (autoBootDone) return
  autoBootDone = true

  restoreOpenClawMode()

  if (!isTauriRuntime()) return

  console.log('[LocalTools] 自动启动检测...')

  const alreadyRunning = await checkGatewayHealth()

  if (alreadyRunning) {
    console.log('[LocalTools] 本地工具服务已在运行，直接连接')
    await connect()
    return
  }

  console.log('[LocalTools] 自动启动本地工具服务...')
  const ok = await startGatewayProcess()
  if (ok) {
    for (let i = 0; i < 5; i++) {
      const ready = await checkGatewayHealth()
      if (ready) {
        await connect()
        console.log('[LocalTools] 自动启动完成，已连接')
        return
      }
      await new Promise(r => setTimeout(r, 2000))
    }
    console.warn('[LocalTools] 本地工具服务启动后未能连接')
  }
}

export function saveAutoStart(enabled: boolean) {
  localStorage.setItem('jcOpenClawAutoStart', String(enabled))
}

export function getAutoStart(): boolean {
  return localStorage.getItem('jcOpenClawAutoStart') === 'true'
}

// ═══════════════════════════════════════════════════
//  导出
// ═══════════════════════════════════════════════════

export function useOpenClaw() {
  return {
    // 状态
    gateway: readonly(gateway),
    activeSession: readonly(activeSession) as Readonly<Ref<SessionInfo | null>>,
    openclawMode: readonly(openclawMode),
    // 连接
    connect,
    disconnect,
    startGatewayProcess,
    stopGatewayProcess,
    checkGatewayHealth,
    // Session
    sessionCreate,
    sessionSend,
    sessionAbort,
    onSessionEvent,
    // 工具
    approveExec,
    denyExec,
    toolInvoke,
    toolCatalog,
    // HTTP 降级
    chatViaGateway,
    // RPC
    rpcCall,
    // 配置
    saveConfig,
    getConfig,
    autoBootGateway,
    saveAutoStart,
    getAutoStart,
    // 模式
    setOpenClawMode,
    getOpenClawMode,
  }
}
