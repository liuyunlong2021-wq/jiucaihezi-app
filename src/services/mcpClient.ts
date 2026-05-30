import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServerConfig, McpToolSchema } from '@/stores/mcpStore'
import { McpStdioTransport } from './mcpStdioTransport'

// ─── Types ───────────────────────────────────────────

export interface McpConnectionState {
  client: Client | null
  transport: Transport | null
  serverId: string
}

// ─── Connection pool ─────────────────────────────────

const connections = new Map<string, McpConnectionState>()

// ─── Public API ──────────────────────────────────────

export async function connectMcpServer(config: McpServerConfig): Promise<McpToolSchema[]> {
  // Disconnect if already connected
  await disconnectMcpServer(config.id)

  let transport: Transport

  if (config.transport === 'sse') {
    if (!config.url) throw new Error('SSE transport requires a URL')
    transport = new SSEClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
    })
  } else if (config.transport === 'stdio') {
    if (!config.command) throw new Error('stdio transport requires a command')
    transport = new McpStdioTransport({
      command: config.command,
      args: config.args || [],
      cwd: config.cwd,
    })
  } else {
    throw new Error(`Unsupported transport: ${config.transport}`)
  }

  const client = new Client(
    { name: 'jiucaihezi-studio', version: '1.0.0' },
    { capabilities: {} },
  )

  await client.connect(transport)

  connections.set(config.id, { client, transport, serverId: config.id })

  // List tools
  const result = await client.listTools()
  const tools: McpToolSchema[] = (result.tools || []).map(tool => ({
    name: `mcp__${config.id}__${tool.name}`,
    description: tool.description || '',
    inputSchema: tool.inputSchema as Record<string, unknown> || { type: 'object', properties: {} },
    serverId: config.id,
    originalName: tool.name,
  }))

  return tools
}

export async function disconnectMcpServer(serverId: string): Promise<void> {
  const conn = connections.get(serverId)
  if (!conn) return

  try {
    await conn.client?.close()
  } catch {
    // ignore close errors
  }

  connections.delete(serverId)
}

export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const conn = connections.get(serverId)
  if (!conn?.client) {
    throw new Error(`MCP server "${serverId}" is not connected`)
  }

  // Strip prefix to get original tool name
  const originalName = toolName.startsWith(`mcp__${serverId}__`)
    ? toolName.slice(`mcp__${serverId}__`.length)
    : toolName

  const result = await conn.client.callTool({
    name: originalName,
    arguments: args,
  })

  // Serialize result
  const contents = (result.content as any[]) || []
  const texts = contents
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text as string)

  if (texts.length === 0 && contents.length > 0) {
    return JSON.stringify(contents)
  }

  const joined = texts.join('\n')
  // Truncate to 100KB
  return joined.length > 102400
    ? joined.slice(0, 102400) + '\n\n[结果已截断，超过 100KB]'
    : joined
}

export function isMcpToolName(name: string): boolean {
  return name.startsWith('mcp__')
}

export function getMcpConnectionState(serverId: string): McpConnectionState | undefined {
  return connections.get(serverId)
}

export async function disconnectAllMcpServers(): Promise<void> {
  const ids = [...connections.keys()]
  await Promise.allSettled(ids.map(id => disconnectMcpServer(id)))
}
