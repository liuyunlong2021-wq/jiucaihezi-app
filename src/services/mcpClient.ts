import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type { FetchLike, Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServerConfig, McpToolSchema } from '@/stores/mcpStore'
import { McpStdioTransport } from './mcpStdioTransport'
import { createMcpOAuthProvider, McpOAuthInteractionRequiredError } from './mcpOAuthProvider'

// ─── Types ───────────────────────────────────────────

export interface McpConnectionState {
  client: Client | null
  transport: Transport | null
  serverId: string
  config: McpServerConfig
}

export class McpAuthorizationRequiredError extends Error {
  constructor(public readonly serverId: string) {
    super(`MCP server "${serverId}" 需要在浏览器中授权`)
  }
}

// ─── Connection pool ─────────────────────────────────

const connections = new Map<string, McpConnectionState>()

function createOAuthDiscoveryState(config: McpServerConfig): OAuthDiscoveryState | undefined {
  if (!config.oauthAuthorizationServerUrl || !config.oauthAuthorizationEndpoint || !config.oauthTokenEndpoint) return undefined
  return {
    authorizationServerUrl: config.oauthAuthorizationServerUrl,
    authorizationServerMetadata: {
      issuer: config.oauthAuthorizationServerUrl,
      authorization_endpoint: config.oauthAuthorizationEndpoint,
      token_endpoint: config.oauthTokenEndpoint,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
    },
  }
}

function createOAuthTokenProxyFetch(config: McpServerConfig): FetchLike | undefined {
  if (!config.oauthTokenProxyUrl || !config.oauthTokenEndpoint) return undefined
  return async (input, init) => {
    const target = input instanceof Request ? input.url : String(input)
    if (target === config.oauthTokenEndpoint) return fetch(config.oauthTokenProxyUrl!, init)
    return fetch(input, init)
  }
}

function createMcpConnection(config: McpServerConfig, interactiveAuth = true): McpConnectionState {
  const authProvider = config.auth === 'oauth'
    ? createMcpOAuthProvider({
      serverId: config.id,
      clientId: config.oauthClientId,
      discoveryState: createOAuthDiscoveryState(config),
      interactive: interactiveAuth,
    })
    : undefined
  const oauthFetch = config.auth === 'oauth' ? createOAuthTokenProxyFetch(config) : undefined

  let transport: Transport
  if (config.transport === 'sse') {
    if (!config.url) throw new Error('SSE transport requires a URL')
    transport = new SSEClientTransport(new URL(config.url), {
      authProvider,
      requestInit: config.headers ? { headers: config.headers } : undefined,
      fetch: oauthFetch,
    })
  } else if (config.transport === 'streamable-http') {
    if (!config.url) throw new Error('Streamable HTTP transport requires a URL')
    transport = new StreamableHTTPClientTransport(new URL(config.url), {
      authProvider,
      requestInit: config.headers ? { headers: config.headers } : undefined,
      fetch: oauthFetch,
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

  return {
    client: new Client(
      { name: 'jiucaihezi-studio', version: '1.0.0' },
      { capabilities: {} },
    ),
    transport,
    serverId: config.id,
    config,
  }
}

// ─── Public API ──────────────────────────────────────

export async function connectMcpServer(config: McpServerConfig, options: { interactiveAuth?: boolean } = {}): Promise<McpToolSchema[]> {
  // Disconnect if already connected
  await disconnectMcpServer(config.id)

  const connection = createMcpConnection(config, options.interactiveAuth !== false)
  connections.set(config.id, connection)
  try {
    await connection.client?.connect(connection.transport!)
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof McpOAuthInteractionRequiredError) {
      throw new McpAuthorizationRequiredError(config.id)
    }
    connections.delete(config.id)
    throw error
  }

  return await listMcpTools(config.id, connection.client)
}

export async function completeMcpServerAuthorization(serverId: string, authorizationCode: string): Promise<McpToolSchema[]> {
  const connection = connections.get(serverId)
  if (!connection) throw new Error(`MCP server "${serverId}" 没有待完成的授权`)
  const transport = connection.transport as StreamableHTTPClientTransport | SSEClientTransport
  if (typeof (transport as any).finishAuth !== 'function') throw new Error(`MCP server "${serverId}" 不支持 OAuth 授权恢复`)
  await transport.finishAuth(authorizationCode)
  await connection.client?.close()
  // A post-auth 401 must surface once, never reopen the browser in a loop.
  const authorizedConnection = createMcpConnection(connection.config, false)
  connections.set(serverId, authorizedConnection)
  await authorizedConnection.client?.connect(authorizedConnection.transport!)
  return await listMcpTools(serverId, authorizedConnection.client)
}

export interface McpRestoreStoreLike {
  servers: McpServerConfig[]
  setServerStatus(id: string, status: McpServerConfig['status'], error?: string): void
  setServerTools(id: string, tools: McpToolSchema[]): void
}

export async function restoreMcpServers(input: McpRestoreStoreLike & {
  connect?: (config: McpServerConfig) => Promise<McpToolSchema[]>
}): Promise<void> {
  const connect = input.connect || (server => connectMcpServer(server, { interactiveAuth: false }))
  for (const server of input.servers.filter(item => item.enabled)) {
    input.setServerStatus(server.id, 'connecting')
    try {
      input.setServerTools(server.id, await connect(server))
      input.setServerStatus(server.id, 'connected')
    } catch (error) {
      const message = error instanceof McpAuthorizationRequiredError
        ? '需要重新连接'
        : error instanceof Error ? error.message : String(error)
      input.setServerStatus(server.id, 'error', message)
    }
  }
}

async function listMcpTools(serverId: string, client: Client | null): Promise<McpToolSchema[]> {
  if (!client) throw new Error(`MCP server "${serverId}" 未连接`)
  // List tools
  const result = await client.listTools()
  const tools: McpToolSchema[] = (result.tools || []).map(tool => ({
    name: `mcp__${serverId}__${tool.name}`,
    description: tool.description || '',
    inputSchema: tool.inputSchema as Record<string, unknown> || { type: 'object', properties: {} },
    serverId,
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
