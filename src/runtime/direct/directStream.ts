import type { DirectToolCall } from './directTypes'

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

export async function readChatCompletionResponse(
  response: Response,
  onText: (text: string) => void,
  toolCallAccumulator?: Record<number, DirectToolCall>,
): Promise<string> {
  if (isJsonResponse(response)) {
    const data = await response.json()
    accumulateToolCalls(data?.choices?.[0]?.message?.tool_calls, toolCallAccumulator)
    const text = contentToText(getChatCompletionMessageContent(data)).trim()
    if (text) onText(text)
    return text
  }

  const reader = response.body?.getReader()
  if (!reader) return ''

  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''
  let streamDone = false

  try {
    while (!streamDone) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw) continue
        if (raw === '[DONE]') {
          streamDone = true
          break
        }

        try {
          const parsed = JSON.parse(raw)
          const delta = parsed?.choices?.[0]?.delta || {}
          const contentDelta = String(delta.content || delta.reasoning_content || '')
          if (contentDelta) {
            accumulated += contentDelta
            onText(accumulated)
          }
          accumulateToolCalls(delta.tool_calls, toolCallAccumulator)
        } catch {
          // Ignore provider keep-alive rows and malformed stream fragments.
        }
      }
    }
  } finally {
    try { reader.releaseLock() } catch {}
  }

  return accumulated.trim()
}

function getChatCompletionMessageContent(data: any): unknown {
  const message = data?.choices?.[0]?.message || {}
  return message.content || message.reasoning || message.reasoning_content || ''
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
