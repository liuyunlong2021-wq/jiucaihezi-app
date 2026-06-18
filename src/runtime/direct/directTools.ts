import type { DirectApiMessage, DirectToolCall } from './directTypes'

export function appendSystemEvidence(messages: DirectApiMessage[], evidence: string): DirectApiMessage[] {
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
): Promise<DirectApiMessage[]> {
  const messages: DirectApiMessage[] = []

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
