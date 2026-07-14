import type { DirectApiMessage, DirectToolCall, DirectToolExecutor } from './directTypes'

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
  executeTool: DirectToolExecutor,
): Promise<DirectApiMessage[]> {
  const calls = toolCalls.map((toolCall, index) => ({
    ...toolCall,
    id: toolCall.id || `call_${toolCall.function?.name || 'tool'}_${index + 1}`,
    function: {
      name: toolCall.function?.name || 'tool',
      arguments: toolCall.function?.arguments || '{}',
    },
  }))
  const messages: DirectApiMessage[] = [{
    role: 'assistant',
    tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const, function: call.function })),
  }]
  const followupMessages: DirectApiMessage[] = []

  for (const call of calls) {
    try {
      const result = await executeTool(call)
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result.content,
      })
      if (result.followupMessages?.length) followupMessages.push(...result.followupMessages)
    } catch (error) {
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: `Tool error: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  return [...messages, ...followupMessages]
}
