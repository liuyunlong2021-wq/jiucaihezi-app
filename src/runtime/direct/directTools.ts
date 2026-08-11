import type {
  DirectApiMessage,
  DirectBeforeToolCall,
  DirectReasoningReplay,
  DirectToolCall,
  DirectToolExecutionEvent,
  DirectToolExecutionStatus,
  DirectToolExecutor,
  DirectToolResult,
} from './directTypes'

export async function buildToolResultMessages(
  toolCalls: DirectToolCall[],
  executeTool: DirectToolExecutor,
  options: {
    signal?: AbortSignal
    beforeToolCall?: DirectBeforeToolCall
    onToolEvent?: (event: DirectToolExecutionEvent) => void
    reasoning?: DirectReasoningReplay
  } = {},
): Promise<DirectApiMessage[]> {
  const calls = toolCalls.map((toolCall, index) => ({
    ...toolCall,
    id: toolCall.id || `call_${toolCall.function?.name || 'tool'}_${index + 1}`,
    function: {
      name: toolCall.function?.name || 'tool',
      arguments: toolCall.function?.arguments || '{}',
    },
  }))
  const assistantMessage: DirectApiMessage = {
    role: 'assistant',
    tool_calls: calls.map(call => ({ id: call.id, type: 'function' as const, function: call.function })),
  }
  if (options.reasoning) assistantMessage[options.reasoning.field] = options.reasoning.value
  const messages: DirectApiMessage[] = [assistantMessage]
  const followupMessages: DirectApiMessage[] = []

  for (const call of calls) {
    options.onToolEvent?.({ type: 'tool_execution_start', call })
    if (options.signal?.aborted) {
      emitEnd(options.onToolEvent, call, { content: '工具执行已取消。', status: 'cancelled' }, 'cancelled')
      throw new DOMException('Aborted', 'AbortError')
    }

    let decision: 'cancelled' | void
    try {
      decision = await options.beforeToolCall?.(call)
    } catch (error) {
      const result = {
        content: `Tool error: ${error instanceof Error ? error.message : String(error)}`,
        status: 'failed',
      } satisfies DirectToolResult
      emitEnd(options.onToolEvent, call, result, 'failed')
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: `${result.content}\n\n工具失败。请查看真实输出，改用替代工具或命令、Skill 的降级方案，或安装并验证缺失依赖；不要原样重复失败命令。`,
      })
      continue
    }
    if (decision === 'cancelled') {
      const result = {
        content: '用户拒绝了本次工具操作，未执行。请换一种方法继续。',
        status: 'cancelled',
      } satisfies DirectToolResult
      emitEnd(options.onToolEvent, call, result, 'cancelled')
      messages.push({ role: 'tool', tool_call_id: call.id, content: result.content })
      continue
    }

    let result: DirectToolResult
    let status: DirectToolExecutionStatus
    try {
      result = await executeTool(call)
      if (options.signal?.aborted) {
        result = { content: '工具执行已取消。', status: 'cancelled' }
        status = 'cancelled'
      } else {
        status = result.status || 'succeeded'
      }
    } catch (error) {
      if (options.signal?.aborted) {
        result = { content: '工具执行已取消。', status: 'cancelled' }
        status = 'cancelled'
      } else {
        result = {
          content: `Tool error: ${error instanceof Error ? error.message : String(error)}`,
          status: 'failed',
        }
        status = 'failed'
      }
    }

    emitEnd(options.onToolEvent, call, result, status)
    if (status === 'cancelled' && options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: result.status === 'failed'
        ? `${result.content}\n\n工具失败。请查看真实输出，改用替代工具或命令、Skill 的降级方案，或安装并验证缺失依赖；不要原样重复失败命令。`
        : result.content,
    })
    if (result.followupMessages?.length) followupMessages.push(...result.followupMessages)
  }

  return [...messages, ...followupMessages]
}

function emitEnd(
  onToolEvent: ((event: DirectToolExecutionEvent) => void) | undefined,
  call: DirectToolCall,
  result: DirectToolResult,
  status: DirectToolExecutionStatus,
) {
  onToolEvent?.({ type: 'tool_execution_end', call, result, status })
}
