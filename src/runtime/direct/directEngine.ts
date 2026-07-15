export type { DirectApiMessage, DirectToolCall } from './directTypes'
import type { DirectApiMessage, DirectToolCall, DirectToolExecutor, DirectToolResult } from './directTypes'
import { readChatCompletionResponse } from './directStream'
import { buildToolResultMessages } from './directTools'

export { readChatCompletionResponse } from './directStream'
export { appendSystemEvidence, buildToolResultMessages } from './directTools'

export interface DirectChatCompletionRequest {
  messages: DirectApiMessage[]
  tools?: unknown[]
}

export interface RunDirectChatCompletionOptions {
  messages: DirectApiMessage[]
  tools?: unknown[]
  onText: (text: string) => void
  onToolCalls?: (toolCalls: DirectToolCall[]) => void
  sendChatCompletion: (request: DirectChatCompletionRequest) => Promise<Response>
  runWebSearch?: (query: string) => Promise<string>
  executeTool?: DirectToolExecutor
  maxToolRounds?: number
  signal?: AbortSignal
}

export interface RunDirectChatCompletionResult {
  text: string
  toolCalls: DirectToolCall[]
  usedSecondPass: boolean
}

export async function runDirectChatCompletion(
  options: RunDirectChatCompletionOptions,
): Promise<RunDirectChatCompletionResult> {
  const messages = [...options.messages]
  const allToolCalls: DirectToolCall[] = []
  const maxToolRounds = Math.max(1, options.maxToolRounds || 12)
  const executeTool = options.executeTool || legacyWebSearchExecutor(options.runWebSearch)
  let toolRounds = 0
  let fallbackText = ''

  while (true) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const toolCallAccumulator: Record<number, DirectToolCall> = {}
    const response = await options.sendChatCompletion({ messages: [...messages], tools: options.tools })
    const text = await readChatCompletionResponse(response, options.onText, toolCallAccumulator)
    if (text) fallbackText = text
    const toolCalls = Object.values(toolCallAccumulator)
      .filter(toolCall => toolCall.function.name)
      .map((toolCall, index) => ({
        ...toolCall,
        id: toolCall.id || `call_${toolCall.function.name}_${index + 1}`,
      }))
    if (!toolCalls.length) {
      return {
        text: text || fallbackText,
        toolCalls: allToolCalls,
        usedSecondPass: toolRounds > 0,
      }
    }

    if (toolRounds >= maxToolRounds) throw new Error(`工具调用超过 ${maxToolRounds} 轮，已停止`)
    allToolCalls.push(...toolCalls)
    options.onToolCalls?.(toolCalls)
    messages.push(...await buildToolResultMessages(toolCalls, executeTool, options.signal))
    toolRounds += 1
  }
}

function legacyWebSearchExecutor(runWebSearch?: (query: string) => Promise<string>): DirectToolExecutor {
  return async (call): Promise<DirectToolResult> => {
    if (call.function.name !== 'web_search' || !runWebSearch) throw new Error(`Unsupported tool: ${call.function.name}`)
    let args: any
    try { args = JSON.parse(call.function.arguments || '{}') }
    catch (error) { throw new Error(`Tool argument parse failed: ${error instanceof Error ? error.message : String(error)}`) }
    const query = String(args?.query || '').trim()
    if (!query) throw new Error('Tool argument parse failed: query is required')
    return { content: await runWebSearch(query) }
  }
}
