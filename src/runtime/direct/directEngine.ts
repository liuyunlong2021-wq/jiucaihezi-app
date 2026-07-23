export type { DirectApiMessage, DirectToolCall } from './directTypes'
import type {
  DirectApiMessage,
  DirectBeforeToolCall,
  DirectToolCall,
  DirectToolExecutionEvent,
  DirectToolExecutor,
  DirectToolResult,
} from './directTypes'
import { DirectStreamInterruptionError, readChatCompletionDetails, readChatCompletionResponse } from './directStream'
import { buildToolResultMessages } from './directTools'

export { readChatCompletionResponse, resolveDirectCompletionText } from './directStream'
export { appendSystemEvidence, buildToolResultMessages } from './directTools'

export interface DirectChatCompletionRequest {
  messages: DirectApiMessage[]
  tools?: unknown[]
}

export interface RunDirectChatCompletionOptions {
  messages: DirectApiMessage[]
  tools?: unknown[]
  onText: (text: string) => void
  onToolEvent?: (event: DirectToolExecutionEvent) => void
  beforeToolCall?: DirectBeforeToolCall
  sendChatCompletion: (request: DirectChatCompletionRequest) => Promise<Response>
  runWebSearch?: (query: string) => Promise<string>
  executeTool?: DirectToolExecutor
  maxToolRounds?: number
  allowToolCalls?: boolean
  signal?: AbortSignal
}

export interface RunDirectChatCompletionResult {
  text: string
  toolCalls: DirectToolCall[]
  usedSecondPass: boolean
  finishReason?: string
}

export async function runDirectChatCompletion(
  options: RunDirectChatCompletionOptions,
): Promise<RunDirectChatCompletionResult> {
  const messages = [...options.messages]
  const allToolCalls: DirectToolCall[] = []
  const maxToolRounds = Math.max(1, options.maxToolRounds || 64)
  const executeTool = options.executeTool || legacyWebSearchExecutor(options.runWebSearch)
  let toolRounds = 0
  let fallbackText = ''
  let lastFailedToolSignature = ''

  const executeToolWithRepeatGuard: DirectToolExecutor = async call => {
    const signature = `${call.function.name}\u0000${call.function.arguments}`
    if (signature === lastFailedToolSignature) {
      return {
        content: '这个工具调用刚刚失败。请根据真实错误换一种方法，不要原样重复。',
        status: 'failed',
      }
    }
    lastFailedToolSignature = ''
    try {
      const result = await executeTool(call)
      if (result.status === 'failed') lastFailedToolSignature = signature
      return result
    } catch (error) {
      lastFailedToolSignature = signature
      throw error
    }
  }

  while (true) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const toolCallAccumulator: Record<number, DirectToolCall> = {}
    const response = await options.sendChatCompletion({ messages: [...messages], tools: options.tools })
    let stream
    try {
      stream = await readChatCompletionDetails(response, options.onText, toolCallAccumulator)
    } catch (error) {
      if (!(error instanceof DirectStreamInterruptionError) || options.signal?.aborted || Object.keys(toolCallAccumulator).length) throw error
      const partialText = error.partialText
      if (partialText) {
        fallbackText = partialText
        options.onText(partialText)
      }
      const continuationMessages: DirectApiMessage[] = [
        ...messages,
        ...(error.partialText ? [{ role: 'assistant', content: error.partialText }] : []),
        { role: 'user', content: '上一段可见正文传输中断。请从末尾继续，不要重复已有内容，也不要调用工具。' },
      ]
      const continuationResponse = await options.sendChatCompletion({ messages: continuationMessages, tools: undefined })
      try {
        const continuation = await readChatCompletionDetails(
          continuationResponse,
          text => options.onText(joinText(partialText, text)),
        )
        const text = joinText(partialText, continuation.text)
        return {
          text,
          toolCalls: allToolCalls,
          usedSecondPass: toolRounds > 0,
          finishReason: continuation.finishReason,
        }
      } catch (continuationError) {
        if (continuationError instanceof DirectStreamInterruptionError) {
          const text = joinText(partialText, continuationError.partialText)
          if (text) options.onText(text)
        }
        throw continuationError
      }
    }
    const text = stream.text
    if (text) fallbackText = text
    const toolCalls = Object.values(toolCallAccumulator)
      .filter(toolCall => toolCall.function.name)
      .map((toolCall, index) => ({
        ...toolCall,
        id: toolCall.id || `call_${toolCall.function.name}_${index + 1}`,
      }))
      .map(toolCall => normalizeToolCall(toolCall, options.tools))
    if (!toolCalls.length) {
      return {
        text: text || fallbackText,
        toolCalls: allToolCalls,
        usedSecondPass: toolRounds > 0,
        finishReason: stream.finishReason,
      }
    }

    if (options.allowToolCalls === false) throw new Error('此请求不允许工具调用')
    if (toolRounds >= maxToolRounds) throw new Error(`工具调用超过 ${maxToolRounds} 轮，已停止`)
    allToolCalls.push(...toolCalls)
    messages.push(...await buildToolResultMessages(toolCalls, executeToolWithRepeatGuard, {
      signal: options.signal,
      beforeToolCall: options.beforeToolCall,
      onToolEvent: options.onToolEvent,
    }))
    toolRounds += 1
  }
}

function normalizeToolCall(call: DirectToolCall, tools: unknown[] | undefined): DirectToolCall {
  const prefix = 'available_skills:'
  const skillName = call.function.name.startsWith(prefix)
    ? call.function.name.slice(prefix.length).trim()
    : ''
  const argumentsText = call.function.arguments.trim()
  const skillAdvertised = tools?.some(tool => {
    if (!tool || typeof tool !== 'object') return false
    const definition = (tool as { function?: unknown }).function
    return Boolean(definition && typeof definition === 'object' && (definition as { name?: unknown }).name === 'skill')
  })
  if (!skillAdvertised || !skillName || (argumentsText && argumentsText !== '{}')) return call
  return {
    ...call,
    function: {
      name: 'skill',
      arguments: JSON.stringify({ name: skillName }),
    },
  }
}

function joinText(prefix: string, suffix: string): string {
  return [prefix, suffix].filter(Boolean).join('')
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
