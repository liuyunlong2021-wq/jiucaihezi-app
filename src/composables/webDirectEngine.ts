export interface DirectToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

type ApiMessage = Record<string, any>

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
  for (const part of value as any[]) {
    const index = Number.isFinite(part?.index) ? Number(part.index) : 0
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

export function appendSystemEvidence(messages: ApiMessage[], evidence: string): ApiMessage[] {
  const cleanEvidence = String(evidence || '').trim()
  if (!cleanEvidence) return messages

  const next = messages.map(message => ({ ...message }))
  const systemIndex = next.findIndex(message => message.role === 'system')
  const block = [
    '【Web 搜索结果（供参考）】',
    cleanEvidence,
    '请基于搜索事实和你的知识回答，不要编造链接或内容。',
  ].join('\n')

  if (systemIndex >= 0) {
    next[systemIndex].content = [next[systemIndex].content, block].filter(Boolean).join('\n\n')
    return next
  }

  return [{ role: 'system', content: block }, ...next]
}

export async function buildToolResultMessages(
  toolCalls: DirectToolCall[],
  runWebSearch: (query: string) => Promise<string>,
): Promise<ApiMessage[]> {
  const messages: ApiMessage[] = []

  for (const [index, toolCall] of toolCalls.entries()) {
    const name = toolCall.function?.name || 'tool'
    const id = toolCall.id || `call_${name}_${index + 1}`
    const assistantToolCall = {
      id,
      type: 'function' as const,
      function: {
        name,
        arguments: toolCall.function?.arguments || '{}',
      },
    }
    messages.push({ role: 'assistant', tool_calls: [assistantToolCall] })

    if (name !== 'web_search') {
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: `Unsupported tool: ${name}`,
      })
      continue
    }

    const parsed = parseToolArguments(toolCall.function?.arguments || '{}')
    if (!parsed.ok) {
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: `Tool argument parse failed: ${parsed.error}`,
      })
      continue
    }

    const query = String(parsed.value.query || '').trim()
    messages.push({
      role: 'tool',
      tool_call_id: id,
      content: query ? await runWebSearch(query) : 'Tool argument parse failed: query is required',
    })
  }

  return messages
}

function parseToolArguments(value: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(value || '{}')
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'arguments must be an object' }
    return { ok: true, value: parsed }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
