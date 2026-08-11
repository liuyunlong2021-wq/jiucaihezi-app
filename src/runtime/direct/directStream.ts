import type { DirectReasoningReplay, DirectToolCall } from './directTypes'

function contentToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item
      if (item?.type === 'text') return String(item.text || '')
      if (item?.type === 'image_url') return '[图片]'
      return safeJson(item)
    }).filter(Boolean).join('\n')
  }
  return safeJson(value)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isJsonResponse(response: Response): boolean {
  return (response.headers.get('content-type') || '').toLowerCase().includes('application/json')
}

export interface DirectStreamResult {
  text: string
  finishReason?: string
  reasoning?: DirectReasoningReplay
}

export function resolveDirectCompletionText(text: string, finishReason: string | undefined, emptyText: string): string {
  if (finishReason === 'content_filter') {
    return text
      ? `${text}\n\n上游以 content_filter 终止。`
      : '上游以 content_filter 终止，未返回正文。'
  }
  if (text) return text
  return emptyText
}

export class DirectStreamInterruptionError extends Error {
  constructor(readonly partialText: string, cause: unknown, readonly reasoning?: DirectReasoningReplay) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'DirectStreamInterruptionError'
  }
}

export async function readChatCompletionDetails(
  response: Response,
  onText: (text: string) => void,
  toolCallAccumulator?: Record<number, DirectToolCall>,
): Promise<DirectStreamResult> {
  if (isJsonResponse(response)) {
    const data = await response.json()
    const choice = data?.choices?.[0]
    accumulateToolCalls(choice?.message?.tool_calls, toolCallAccumulator)
    const text = contentToText(getChatCompletionMessageContent(data)).trim()
    if (text) onText(text)
    const reasoningContent = typeof choice?.message?.reasoning_content === 'string' ? choice.message.reasoning_content : ''
    return {
      text,
      finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
      ...(reasoningContent ? { reasoning: { field: 'reasoning_content' as const, value: reasoningContent } } : {}),
    }
  }

  const reader = response.body?.getReader()
  if (!reader) return { text: '' }

  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''
  let reasoningContent = ''
  let streamDone = false
  let finishReason: string | undefined

  const consumeData = (raw: string) => {
    if (!raw || raw === '[DONE]') {
      if (raw === '[DONE]') streamDone = true
      return
    }
    try {
      const parsed = JSON.parse(raw)
      const choice = parsed?.choices?.[0] || {}
      const delta = choice.delta || {}
      if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason
      if (typeof delta.reasoning_content === 'string') reasoningContent += delta.reasoning_content
      const contentDelta = String(delta.content || '')
      if (contentDelta) {
        accumulated += contentDelta
        onText(accumulated)
      }
      accumulateToolCalls(delta.tool_calls, toolCallAccumulator)
    } catch {
      // Ignore provider keep-alive rows and malformed stream fragments.
    }
  }

  try {
    while (!streamDone) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        consumeData(line.slice(5).trim())
        if (streamDone) break
      }
    }
    buffer += decoder.decode()
    if (!streamDone && buffer.startsWith('data:')) consumeData(buffer.slice(5).trim())
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new DirectStreamInterruptionError(
      accumulated.trim(),
      error,
      reasoningContent ? { field: 'reasoning_content', value: reasoningContent } : undefined,
    )
  } finally {
    try { reader.releaseLock() } catch {}
  }

  return {
    text: accumulated.trim(),
    finishReason,
    ...(reasoningContent ? { reasoning: { field: 'reasoning_content' as const, value: reasoningContent } } : {}),
  }
}

export async function readChatCompletionResponse(
  response: Response,
  onText: (text: string) => void,
  toolCallAccumulator?: Record<number, DirectToolCall>,
): Promise<string> {
  return (await readChatCompletionDetails(response, onText, toolCallAccumulator)).text
}

function getChatCompletionMessageContent(data: any): unknown {
  const message = data?.choices?.[0]?.message || {}
  return message.content || ''
}

function accumulateToolCalls(value: unknown, target?: Record<number, DirectToolCall>): void {
  if (!target || !Array.isArray(value)) return
  for (const [position, part] of (value as any[]).entries()) {
    const index = Number.isFinite(part?.index) ? Number(part.index) : position
    const existing = target[index] || {
      id: '',
      type: 'function' as const,
      function: { name: '', arguments: '' },
    }
    if (part?.id) existing.id = String(part.id)
    if (part?.function?.name) existing.function.name = String(part.function.name)
    if (part?.function?.arguments) existing.function.arguments += String(part.function.arguments)
    target[index] = existing
  }
}
