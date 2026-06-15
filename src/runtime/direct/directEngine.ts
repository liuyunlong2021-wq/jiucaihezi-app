export type { DirectApiMessage, DirectToolCall } from './directTypes'
import type { DirectApiMessage, DirectToolCall } from './directTypes'
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
  sendChatCompletion: (request: DirectChatCompletionRequest) => Promise<Response>
  runWebSearch: (query: string) => Promise<string>
}

export interface RunDirectChatCompletionResult {
  text: string
  toolCalls: DirectToolCall[]
  usedSecondPass: boolean
}

export async function runDirectChatCompletion(
  options: RunDirectChatCompletionOptions,
): Promise<RunDirectChatCompletionResult> {
  const toolCallAccumulator: Record<number, DirectToolCall> = {}
  const firstResponse = await options.sendChatCompletion({
    messages: options.messages,
    tools: options.tools,
  })
  const firstText = await readChatCompletionResponse(firstResponse, options.onText, toolCallAccumulator)
  const toolCalls = Object.values(toolCallAccumulator).filter(toolCall => toolCall.function.name)

  if (!toolCalls.length) {
    return {
      text: firstText,
      toolCalls,
      usedSecondPass: false,
    }
  }

  const toolMessages = await buildToolResultMessages(toolCalls, options.runWebSearch)
  const secondResponse = await options.sendChatCompletion({
    messages: [...options.messages, ...toolMessages],
  })
  const secondText = await readChatCompletionResponse(secondResponse, options.onText)

  return {
    text: secondText || firstText,
    toolCalls,
    usedSecondPass: true,
  }
}
