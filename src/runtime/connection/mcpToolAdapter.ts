import type { ChatCompletionTool } from '@/composables/officeTools'
import type { McpToolSchema } from '@/stores/mcpStore'

// ─── Tool Definition Conversion ──────────────────────

/**
 * Convert MCP tool schemas to OpenAI ChatCompletionTool format.
 * Returns empty array when Pinia is unavailable (e.g. during tests/build).
 */
export function getMcpToolDefinitions(): ChatCompletionTool[] {
  try {
    // Inline dynamic import to defer Pinia dependency
    const mcpModule = (globalThis as any).__jiucaihezi_mcpStore__
    if (!mcpModule) return []
    const store = mcpModule.useMcpStore()
    if (!store?.allMcpTools) return []
    return store.allMcpTools.map(convertMcpToolToChat)
  } catch {
    return []
  }
}

// Register store reference at runtime
export function registerMcpStore(useMcpStoreFn: () => any) {
  (globalThis as any).__jiucaihezi_mcpStore__ = { useMcpStore: useMcpStoreFn }
}

function convertMcpToolToChat(tool: McpToolSchema): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
  }
}

// ─── Tool Execution ──────────────────────────────────

export async function executeMcpToolCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { callMcpTool } = await import('@/services/mcpClient')
  const match = toolName.match(/^mcp__(.+?)__/)
  if (!match) {
    throw new Error(`Invalid MCP tool name: ${toolName}`)
  }
  const serverId = match[1]
  return callMcpTool(serverId, toolName, args)
}

// ─── Helpers ─────────────────────────────────────────

export function isMcpToolName(name: string): boolean {
  return name.startsWith('mcp__')
}

export function getMcpToolLabel(toolName: string): string {
  const match = toolName.match(/^mcp__(.+?)__(.+)$/)
  if (!match) return toolName
  return `${match[1]} / ${match[2]}`
}
