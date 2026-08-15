export type { DirectApiMessage, DirectToolCall } from './directTypes'
import type {
  DirectApiMessage,
  DirectBeforeToolCall,
  DirectToolCall,
  DirectToolExecutionEvent,
  DirectToolExecutor,
} from './directTypes'
import { DirectStreamInterruptionError, readChatCompletionDetails } from './directStream'
import { buildToolResultMessages } from './directTools'

export { readChatCompletionResponse, resolveDirectCompletionText } from './directStream'
export { buildToolResultMessages } from './directTools'

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
  executeTool?: DirectToolExecutor
  maxToolRounds?: number
  allowToolCalls?: boolean
  continueOnInterruption?: boolean
  continueToolsOnInterruption?: boolean
  continueOnLength?: boolean
  maxLengthContinuations?: number
  signal?: AbortSignal
}

export interface RunDirectChatCompletionResult {
  text: string
  toolCalls: DirectToolCall[]
  usedSecondPass: boolean
  finishReason?: string
}

const DIRECT_REQUEST_RETRY_DELAYS = [2000, 4000]
const DIRECT_REQUEST_RETRY_STATUSES = new Set([502, 503, 504, 524])

export class DirectTransportFailure extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'DirectTransportFailure'
  }
}

export function isRetryableDirectResponseStatus(status: number): boolean {
  return DIRECT_REQUEST_RETRY_STATUSES.has(status)
}

export function isRetryableDirectRequestFailure(error: unknown): boolean {
  const message = String((error as Error)?.message || error || '').toLowerCase()
  return /\b(?:502|503|504|524)\b|network|fetch|load failed|connection|socket|timeout|timed out|error sending request|dns|econn/.test(message)
}

export function isRecoverableDirectTransportFailure(error: unknown): boolean {
  return error instanceof DirectTransportFailure || error instanceof DirectStreamInterruptionError
}

export async function sendDirectRequestWithRetry(
  send: () => Promise<Response>,
  options: {
    signal?: AbortSignal
    onRetry?: (attempt: number, total: number) => void
    wait?: (delay: number) => Promise<void>
  } = {},
): Promise<Response> {
  for (let attempt = 0; attempt <= DIRECT_REQUEST_RETRY_DELAYS.length; attempt += 1) {
    try {
      const response = await send()
      if (!isRetryableDirectResponseStatus(response.status) || attempt === DIRECT_REQUEST_RETRY_DELAYS.length) return response
      await response.body?.cancel().catch(() => {})
    } catch (error) {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (!isRetryableDirectRequestFailure(error)) throw error
      if (attempt === DIRECT_REQUEST_RETRY_DELAYS.length) throw new DirectTransportFailure(error)
    }

    options.onRetry?.(attempt + 1, DIRECT_REQUEST_RETRY_DELAYS.length)
    const delay = DIRECT_REQUEST_RETRY_DELAYS[attempt]
    await (options.wait ? options.wait(delay) : waitForDirectRetry(delay, options.signal))
  }
  throw new Error('请求重试状态异常')
}

export async function runDirectChatCompletion(
  options: RunDirectChatCompletionOptions,
): Promise<RunDirectChatCompletionResult> {
  const messages = [...options.messages]
  const allToolCalls: DirectToolCall[] = []
  const maxToolRounds = Math.max(1, options.maxToolRounds || 64)
  const executeTool: DirectToolExecutor = options.executeTool || (async call => {
    throw new Error(`Unsupported tool: ${call.function.name}`)
  })
  let toolRounds = 0
  let fallbackText = ''
  let lengthPrefix = ''
  let lengthContinuations = 0
  let lastFailedToolSignature = ''

  const executeToolWithRepeatGuard: DirectToolExecutor = async (call, signal) => {
    const signature = `${call.function.name}\u0000${call.function.arguments}`
    if (signature === lastFailedToolSignature) {
      return {
        content: '这个工具调用刚刚失败。请根据真实错误换一种方法，不要原样重复。',
        status: 'failed',
      }
    }
    lastFailedToolSignature = ''
    try {
      const result = await executeTool(call, signal)
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
    const streamPrefix = lengthPrefix
    let stream
    try {
      stream = await readChatCompletionDetails(response, value => options.onText(joinText(streamPrefix, value)), toolCallAccumulator)
    } catch (error) {
      if (options.continueOnInterruption === false) throw error
      if (!(error instanceof DirectStreamInterruptionError) || options.signal?.aborted || Object.keys(toolCallAccumulator).length) throw error
      const partialSegment = error.partialText
      const partialText = joinText(streamPrefix, partialSegment)
      if (partialText) {
        fallbackText = partialText
        options.onText(partialText)
      }
      const continuationMessages: DirectApiMessage[] = [
        ...messages,
        ...((partialSegment || error.reasoning) ? [{
          role: 'assistant',
          content: partialSegment || null,
          ...(error.reasoning ? { [error.reasoning.field]: error.reasoning.value } : {}),
        }] : []),
        { role: 'user', content: options.continueToolsOnInterruption
          ? '上一段可见正文传输中断。请从末尾继续，不要重复已有内容。'
          : '上一段可见正文传输中断。请从末尾继续，不要重复已有内容，也不要调用工具。' },
      ]
      const continuationResponse = await options.sendChatCompletion({
        messages: continuationMessages,
        tools: options.continueToolsOnInterruption ? options.tools : undefined,
      })
      try {
        const continuationToolCallAccumulator: Record<number, DirectToolCall> = {}
        const continuation = await readChatCompletionDetails(
          continuationResponse,
          text => options.onText(joinText(partialText, text)),
          continuationToolCallAccumulator,
        )
        const continuationToolCalls = Object.values(continuationToolCallAccumulator)
          .filter(toolCall => toolCall.function.name)
          .map((toolCall, index) => ({
            ...toolCall,
            id: toolCall.id || `call_${toolCall.function.name}_${index + 1}`,
          }))
          .map(toolCall => normalizeToolCall(toolCall, options.tools))
        if (continuationToolCalls.length) {
          if (options.allowToolCalls === false) throw new Error('此请求不允许工具调用')
          if (toolRounds >= maxToolRounds) throw new Error(`工具调用超过 ${maxToolRounds} 轮，已停止`)
          allToolCalls.push(...continuationToolCalls)
          if (streamPrefix) lengthPrefix = partialText
          messages.push(...continuationMessages.slice(messages.length))
          messages.push(...await buildToolResultMessages(continuationToolCalls, executeToolWithRepeatGuard, {
            signal: options.signal,
            reasoning: continuation.reasoning,
            beforeToolCall: async call => {
              if (!toolNames(options.tools).has(call.function.name)) throw new Error(`工具未在当前请求中开放: ${call.function.name}`)
              return await options.beforeToolCall?.(call)
            },
            onToolEvent: options.onToolEvent,
          }))
          toolRounds += 1
          continue
        }
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
      const maxLengthContinuations = Math.max(0, options.maxLengthContinuations ?? 3)
      if (stream.finishReason === 'length' && options.continueOnLength !== false && lengthContinuations < maxLengthContinuations) {
        lengthPrefix = joinText(lengthPrefix, text)
        messages.push(
          { role: 'assistant', content: text || null, ...(stream.reasoning ? { [stream.reasoning.field]: stream.reasoning.value } : {}) },
          { role: 'user', content: '上一段回答达到输出上限。请从末尾继续，不要重复已有内容。' },
        )
        lengthContinuations += 1
        continue
      }
      return {
        text: joinText(lengthPrefix, text) || fallbackText,
        toolCalls: allToolCalls,
        usedSecondPass: toolRounds > 0,
        finishReason: stream.finishReason,
      }
    }

    if (options.allowToolCalls === false) throw new Error('此请求不允许工具调用')
    if (toolRounds >= maxToolRounds) throw new Error(`工具调用超过 ${maxToolRounds} 轮，已停止`)
    allToolCalls.push(...toolCalls)
    const advertisedToolNames = toolNames(options.tools)
    messages.push(...await buildToolResultMessages(toolCalls, executeToolWithRepeatGuard, {
      signal: options.signal,
      reasoning: stream.reasoning,
      beforeToolCall: async call => {
        if (!advertisedToolNames.has(call.function.name)) throw new Error(`工具未在当前请求中开放: ${call.function.name}`)
        return await options.beforeToolCall?.(call)
      },
      onToolEvent: options.onToolEvent,
    }))
    toolRounds += 1
  }
}

function toolNames(tools: unknown[] | undefined): Set<string> {
  return new Set((tools || []).flatMap(tool => {
    if (!tool || typeof tool !== 'object') return []
    const definition = (tool as { function?: unknown }).function
    if (!definition || typeof definition !== 'object') return []
    const name = (definition as { name?: unknown }).name
    return typeof name === 'string' ? [name] : []
  }))
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

function waitForDirectRetry(delay: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, delay)
    signal?.addEventListener('abort', aborted, { once: true })
    function done() {
      signal?.removeEventListener('abort', aborted)
      resolve()
    }
    function aborted() {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
  })
}
