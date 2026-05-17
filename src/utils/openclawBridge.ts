/**
 * utils/openclawBridge.ts — OpenClaw Gateway 连接桥
 *
 * 职责：
 *   1. 通过 Tauri Shell 启动 `openclaw gateway` 子进程
 *   2. WebSocket RPC 通信 (端口 18789)
 *   3. 转发 AI 对话请求到本地 Gateway
 *   4. 暴露 Gateway 状态给 UI
 */
import { ref, readonly } from 'vue'

// ─── 类型 ───

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

export interface RpcResponse {
  id: string
  type: 'res'
  result?: any
  error?: { message: string; code?: number }
}

// ─── 状态 ───

const DEFAULT_PORT = 18789
const gateway = ref<GatewayInfo>({
  status: 'disconnected',
  port: DEFAULT_PORT,
  url: `ws://127.0.0.1:${DEFAULT_PORT}`,
})

let ws: WebSocket | null = null
let pendingCalls = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let gatewayProcess: any = null // Tauri Child process handle

// ─── 配置 ───

function getConfig(): { port: number; authToken: string } {
  const port = parseInt(localStorage.getItem('jcOpenClawPort') || '') || DEFAULT_PORT
  const authToken = localStorage.getItem('jcOpenClawAuth') || ''
  return { port, authToken }
}

export function saveConfig(port: number, authToken: string) {
  localStorage.setItem('jcOpenClawPort', String(port))
  localStorage.setItem('jcOpenClawAuth', authToken)
}

// ─── 启动 Gateway 进程 (Tauri 环境) ───

export async function startGatewayProcess(): Promise<boolean> {
  if (!('__TAURI__' in window)) {
    console.warn('[OpenClaw] 非 Tauri 环境，无法启动 Gateway 进程')
    return false
  }

  try {
    const { Command } = await import('@tauri-apps/plugin-shell')
    // 尝试通过系统 PATH 找到 openclaw
    const cmd = Command.create('openclaw', ['gateway'], {
      env: {
        OPENCLAW_PORT: String(getConfig().port),
      },
    })

    cmd.on('error', (error: string) => {
      console.error('[OpenClaw] 进程错误:', error)
      gateway.value.status = 'error'
      gateway.value.error = error
    })

    cmd.on('close', (data: { code: number }) => {
      console.log('[OpenClaw] 进程退出, code:', data.code)
      gateway.value.status = 'disconnected'
      gatewayProcess = null
    })

    cmd.stdout.on('data', (line: string) => {
      console.log('[OpenClaw]', line)
    })

    cmd.stderr.on('data', (line: string) => {
      console.warn('[OpenClaw]', line)
    })

    gatewayProcess = await cmd.spawn()
    console.log('[OpenClaw] Gateway 进程已启动, PID:', gatewayProcess.pid)

    // 等一会儿让 Gateway 启动完成
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

// ─── WebSocket 连接 ───

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
        if (msg.type === 'res' && msg.id && pendingCalls.has(msg.id)) {
          const pending = pendingCalls.get(msg.id)!
          pendingCalls.delete(msg.id)
          clearTimeout(pending.timer)
          if (msg.error) {
            pending.reject(new Error(msg.error.message || 'RPC error'))
          } else {
            pending.resolve(msg.result)
          }
        }
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

// ─── RPC 调用 ───

export function rpcCall(method: string, params?: any, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('Gateway 未连接'))
      return
    }

    const id = `rpc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const timer = setTimeout(() => {
      pendingCalls.delete(id)
      reject(new Error(`RPC "${method}" 超时`))
    }, timeoutMs)

    pendingCalls.set(id, { resolve, reject, timer })
    ws.send(JSON.stringify({ type: 'req', id, method, params }))
  })
}

// ─── AI 对话代理 (通过 Gateway 的 OpenAI 兼容 HTTP 接口) ───

/**
 * 通过本地 OpenClaw Gateway 发送 chat completion 请求
 * Gateway 提供 OpenAI 兼容的 HTTP 端点: http://127.0.0.1:{port}/v1/chat/completions
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

/**
 * 检查 Gateway 是否可达
 */
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

// ─── 导出响应式状态 ───

export function useOpenClaw() {
  return {
    gateway: readonly(gateway),
    connect,
    disconnect,
    startGatewayProcess,
    stopGatewayProcess,
    checkGatewayHealth,
    chatViaGateway,
    rpcCall,
    saveConfig,
    getConfig,
  }
}
