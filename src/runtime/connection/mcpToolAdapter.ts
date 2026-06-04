import type { ChatCompletionTool } from '@/composables/officeTools'
import {
  executeMcpBridgeToolCall,
  getMcpBridgeToolDefinitions,
  getMcpToolLabel,
  isMcpToolName,
  registerMcpStore,
} from '@/runtime/tools/mcpBridge'

export function getMcpToolDefinitions(): ChatCompletionTool[] {
  return getMcpBridgeToolDefinitions()
}

export async function executeMcpToolCall(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  return executeMcpBridgeToolCall(toolName, args)
}

export {
  getMcpToolLabel,
  isMcpToolName,
  registerMcpStore,
}
