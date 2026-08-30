import type { ChatCompletionTool } from '@/composables/officeTools'
import type { McpToolSchema } from '@/stores/mcpStore'
import type { ToolExecutor, ToolExecutionResult } from './types'

export const MCP_TOOL_PREFIX = 'mcp__'
const MAX_MCP_RESULT_CHARS = 102_400

export interface McpBridgeStoreLike {
  allMcpTools?: McpToolSchema[]
  getMcpToolByName?: (toolName: string) => McpToolSchema | null | undefined
  isServerEnabled?: (serverId: string) => boolean
  isServerConnected?: (serverId: string) => boolean
}

export interface GetMcpBridgeToolDefinitionsOptions {
  store?: McpBridgeStoreLike | null
  coreToolNames?: Iterable<string>
}

export type CallMcpTool = (
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<string> | string

export interface CreateMcpBridgeExecutorOptions {
  store?: McpBridgeStoreLike | null
  coreToolNames?: Iterable<string>
  callMcpTool?: CallMcpTool
}

interface ParsedMcpToolName {
  serverId: string
  originalName: string
}

export function registerMcpStore(useMcpStoreFn: () => unknown) {
  ;(globalThis as any).__jiucaihezi_mcpStore__ = { useMcpStore: useMcpStoreFn }
}

export function getMcpBridgeToolDefinitions(
  options: GetMcpBridgeToolDefinitionsOptions = {},
): ChatCompletionTool[] {
  const store = options.store || resolveMcpStore()
  const coreNames = normalizeNameSet(options.coreToolNames)
  return getMcpToolsFromStore(store)
    .filter(tool => isMcpToolVisible(tool, store, coreNames))
    .map(convertMcpToolToChat)
}

/** Expose one callable tool per connected MCP server; operations stay inside its schema. */
export function getMcpServerBridgeToolDefinitions(
  options: GetMcpBridgeToolDefinitionsOptions = {},
): ChatCompletionTool[] {
  const store = options.store || resolveMcpStore()
  const coreNames = normalizeNameSet(options.coreToolNames)
  const grouped = new Map<string, McpToolSchema[]>()
  for (const tool of getMcpToolsFromStore(store)) {
    if (!isMcpToolVisible(tool, store, coreNames)) continue
    const list = grouped.get(tool.serverId) || []
    list.push(tool)
    grouped.set(tool.serverId, list)
  }
  return [...grouped.entries()].map(([serverId, tools]) => ({
    type: 'function',
    function: {
      name: `mcp__${serverId}`,
      description: [
        `MCP 服务器「${serverId}」整体工具。通过 operation 选择操作；不要把服务器内部操作当作独立工具。`,
        ...tools.map(
          tool =>
            `- ${tool.originalName}: ${tool.description || '无描述'}; schema=${JSON.stringify(tool.inputSchema)}`,
        ),
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            enum: tools.map(tool => tool.originalName),
          },
          arguments: {
            type: 'object',
            description: '所选 operation 的参数对象。完整字段以 operation 的 MCP schema 为准。',
            additionalProperties: true,
          },
        },
        required: ['operation', 'arguments'],
        additionalProperties: false,
      },
    },
  }))
}

export function createMcpBridgeExecutor(
  options: CreateMcpBridgeExecutorOptions = {},
): ToolExecutor {
  return async ({ call, args }) => {
    const toolName = String(call.function.name || '').trim()
    return executeMcpBridgeTool({
      toolName,
      callId: call.id,
      args,
      store: options.store || resolveMcpStore(),
      coreToolNames: options.coreToolNames,
      callMcpTool: options.callMcpTool,
    })
  }
}

export async function executeMcpBridgeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  options: CreateMcpBridgeExecutorOptions = {},
): Promise<string> {
  const aggregate = parseMcpServerToolName(toolName)
  if (aggregate) {
    const operation = typeof args.operation === 'string' ? args.operation.trim() : ''
    const operationArgs = args.arguments
    if (!operation || !operationArgs || typeof operationArgs !== 'object' || Array.isArray(operationArgs)) {
      return JSON.stringify({
        status: 'error',
        error: 'MCP_INVALID_ARGUMENTS',
        tool: toolName,
        message: 'MCP 整体工具必须提供 operation 和 arguments 对象。',
      })
    }
    return await executeMcpBridgeToolCall(
      `mcp__${aggregate.serverId}__${operation}`,
      operationArgs as Record<string, unknown>,
      options,
    )
  }
  const result = await executeMcpBridgeTool({
    toolName,
    args,
    store: options.store || resolveMcpStore(),
    coreToolNames: options.coreToolNames,
    callMcpTool: options.callMcpTool,
  })

  if (result.status === 'ok') return String(result.message || '')
  return JSON.stringify({
    status: 'error',
    error: result.errorCode || 'MCP_TOOL_ERROR',
    tool: result.toolName,
    message: result.errorMessage || 'MCP 外挂工具执行失败。',
  })
}

export function isMcpToolName(name: string): boolean {
  return String(name || '').startsWith(MCP_TOOL_PREFIX)
}

export function getMcpToolLabel(toolName: string): string {
  const parsed = parseMcpToolName(toolName)
  if (!parsed) return '外挂工具'
  return `外挂工具 · ${parsed.serverId} / ${parsed.originalName}`
}

export function isMcpToolReadOnly(toolName: string): boolean {
  return getMcpToolByName(toolName, resolveMcpStore())?.annotations?.readOnlyHint === true
}

async function executeMcpBridgeTool(input: {
  toolName: string
  callId?: string
  args: Record<string, unknown>
  store?: McpBridgeStoreLike | null
  coreToolNames?: Iterable<string>
  callMcpTool?: CallMcpTool
}): Promise<ToolExecutionResult> {
  const parsed = parseMcpToolName(input.toolName)
  if (!parsed) {
    return mcpError(input.toolName, input.callId, 'INVALID_MCP_TOOL_NAME', '不是合法的 MCP 外挂工具名。')
  }

  const store = input.store || null
  if (!isMcpServerConnected(parsed.serverId, store)) {
    return mcpError(
      input.toolName,
      input.callId,
      'MCP_NOT_CONNECTED',
      `MCP Server "${parsed.serverId}" 未连接或未启用，请先到外挂工具设置中启用。`,
    )
  }

  const tool = getMcpToolByName(input.toolName, store)
  if (!tool || !isMcpToolVisible(tool, store, normalizeNameSet(input.coreToolNames))) {
    return mcpError(
      input.toolName,
      input.callId,
      'MCP_TOOL_NOT_EXPOSED',
      `MCP 外挂工具 "${input.toolName}" 未在当前工具池中暴露，已拒绝执行。`,
    )
  }

  try {
    const message = await resolveCallMcpTool(input.callMcpTool)(parsed.serverId, input.toolName, input.args)
    return {
      status: 'ok',
      toolName: input.toolName,
      callId: input.callId,
      message: truncateMcpResult(message),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const errorCode = /not connected|未连接/i.test(message) ? 'MCP_NOT_CONNECTED' : 'MCP_TOOL_FAILED'
    return mcpError(input.toolName, input.callId, errorCode, message)
  }
}

function resolveMcpStore(): McpBridgeStoreLike | null {
  try {
    const mcpModule = (globalThis as any).__jiucaihezi_mcpStore__
    if (!mcpModule?.useMcpStore) return null
    const store = mcpModule.useMcpStore()
    return store || null
  } catch {
    return null
  }
}

function getMcpToolsFromStore(store?: McpBridgeStoreLike | null): McpToolSchema[] {
  return Array.isArray(store?.allMcpTools) ? store!.allMcpTools! : []
}

function getMcpToolByName(
  toolName: string,
  store?: McpBridgeStoreLike | null,
): McpToolSchema | null {
  const fromStore = store?.getMcpToolByName?.(toolName)
  if (fromStore) return fromStore
  return getMcpToolsFromStore(store).find(tool => tool.name === toolName) || null
}

function isMcpToolVisible(
  tool: McpToolSchema,
  store: McpBridgeStoreLike | null | undefined,
  coreNames: Set<string>,
): boolean {
  if (!isMcpToolName(tool.name)) return false
  if (coreNames.has(tool.name) || coreNames.has(tool.originalName)) return false
  return isMcpServerConnected(tool.serverId, store)
}

function isMcpServerConnected(
  serverId: string,
  store?: McpBridgeStoreLike | null,
): boolean {
  if (!store?.isServerEnabled?.(serverId)) return false
  return Boolean(store.isServerConnected?.(serverId))
}

function parseMcpToolName(toolName: string): ParsedMcpToolName | null {
  const match = String(toolName || '').match(/^mcp__(.+?)__(.+)$/)
  if (!match) return null
  return {
    serverId: match[1],
    originalName: match[2],
  }
}

function parseMcpServerToolName(toolName: string): { serverId: string } | null {
  const match = String(toolName || '').match(/^mcp__(.+)$/)
  if (!match || match[1]!.includes('__')) return null
  return { serverId: match[1]! }
}

function convertMcpToolToChat(tool: McpToolSchema): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || `MCP 外挂工具：${getMcpToolLabel(tool.name)}`,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  }
}

function normalizeNameSet(names?: Iterable<string>): Set<string> {
  const set = new Set<string>()
  for (const name of names || []) {
    const normalized = String(name || '').trim()
    if (normalized) set.add(normalized)
  }
  return set
}

function resolveCallMcpTool(callMcpTool?: CallMcpTool): CallMcpTool {
  if (callMcpTool) return callMcpTool
  return async (serverId, toolName, args) => {
    const client = await import('@/services/mcpClient')
    return client.callMcpTool(serverId, toolName, args)
  }
}

function truncateMcpResult(value: string): string {
  const text = String(value || '')
  if (text.length <= MAX_MCP_RESULT_CHARS) return text
  return `${text.slice(0, MAX_MCP_RESULT_CHARS)}\n\n[结果已截断，超过 100KB]`
}

function mcpError(
  toolName: string,
  callId: string | undefined,
  errorCode: string,
  errorMessage: string,
): ToolExecutionResult {
  return {
    status: 'error',
    toolName,
    callId,
    errorCode,
    errorMessage,
  }
}
