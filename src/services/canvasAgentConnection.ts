import { reactive } from 'vue'
import type { McpServerConfig } from '@/stores/mcpStore'
import { MCP_REALM_ID } from './mcpStdioTransport'

export const CANVAS_AGENT_PACKAGE = '@basketikun/canvas-agent@0.6.0'
export const MCP_CONNECT_TIMEOUT_MS = 30_000
export type CanvasAgentStatus = { ready: boolean; projectTitle: string }
type NativeInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export function isCanvasAgentServer(config: Pick<McpServerConfig, 'id' | 'transport' | 'command' | 'args'>) {
  return config.transport === 'stdio' && (config.id === 'infinite-canvas' || (
    /(?:^|[/\\])npx(?:\.cmd)?$/.test(config.command || '') &&
    (config.args || []).some(arg => /^@basketikun\/canvas-agent(?:@[^\s]+)?$/.test(arg)) &&
    config.args?.at(-1) === 'mcp'
  ))
}

export function canvasToolDescription(name: string, description: string) {
  return `${description}\n无限画布：先 canvas_get_state，选区用 canvas_get_selection；画布生图直接 canvas_generate_image，其他媒体用对应 canvas_generate_*，节点/连线用 canvas_apply_ops。不要运行本地 gpt-image 脚本或安装 uv；用户明确选择其他执行方式时遵从用户。保留用户指定模型（含 provider 前缀），不可用则说明，不静默换模型或修改 API Key。生成调用仅为提交，必须用 generation_get_status 确认结果；未知状态不重提付费任务。当前工具：${name}。`
}

export function createCanvasAgentConnection(call: NativeInvoke, realm: string) {
  const statuses = reactive<Record<string, CanvasAgentStatus>>({})
  const leases = new Map<string, { id: string; pending: Promise<void> }>()
  const releaseNative = (id: string) => call('canvas_agent_release', { leaseId: id })
  async function release(serverId: string) {
    const lease = leases.get(serverId)
    leases.delete(serverId)
    delete statuses[serverId]
    if (lease) await releaseNative(lease.id)
  }
  function prepare(serverId: string) {
    const existing = leases.get(serverId)
    if (existing) return existing.pending
    const lease = { id: crypto.randomUUID(), pending: Promise.resolve() }
    leases.set(serverId, lease)
    lease.pending = (async () => {
      try {
        const status = await call('canvas_agent_connect', { leaseId: lease.id, realm, timeoutMs: MCP_CONNECT_TIMEOUT_MS }) as CanvasAgentStatus
        if (leases.get(serverId) !== lease) {
          await releaseNative(lease.id)
          throw new Error('画布连接已取消')
        }
        statuses[serverId] = status
      } catch (error) {
        if (leases.get(serverId) === lease) await release(serverId)
        throw error
      }
    })()
    return lease.pending
  }
  async function refresh(serverId: string) {
    const lease = leases.get(serverId)
    if (!lease) throw new Error('无限画布未连接')
    try {
      const status = await call('canvas_agent_status', { leaseId: lease.id }) as CanvasAgentStatus
      if (leases.get(serverId) === lease) statuses[serverId] = status
      return status
    } catch (error) {
      if (leases.get(serverId) === lease) statuses[serverId] = { ready: false, projectTitle: '' }
      throw error
    }
  }
  async function open(serverId: string, newCanvas = false) {
    const lease = leases.get(serverId)
    if (!lease) throw new Error('无限画布未连接')
    await lease.pending
    if (leases.get(serverId) !== lease) throw new Error('画布连接已取消')
    const status = await call('canvas_agent_open', { leaseId: lease.id, newCanvas }) as CanvasAgentStatus
    if (leases.get(serverId) === lease) statuses[serverId] = status
  }
  return { statuses, prepare, release, refresh, open }
}

export const canvasAgentConnection = createCanvasAgentConnection(async (command, args) => {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(command, args)
}, MCP_REALM_ID)
