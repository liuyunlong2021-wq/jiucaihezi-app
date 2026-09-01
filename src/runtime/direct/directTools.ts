import type {
  DirectApiMessage,
  DirectBeforeToolCall,
  DirectReasoningReplay,
  DirectToolCall,
  DirectToolExecutionEvent,
  DirectToolExecutionStatus,
  DirectToolExecutor,
  DirectToolNeedsApproval,
  DirectToolResult,
} from './directTypes'

export async function buildToolResultMessages(
  toolCalls: DirectToolCall[],
  executeTool: DirectToolExecutor,
  options: {
    signal?: AbortSignal
    beforeToolCall?: DirectBeforeToolCall
    toolNeedsApproval?: DirectToolNeedsApproval
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
    tool_calls: calls.map(call => ({
      id: call.id,
      type: 'function' as const,
      function: call.function,
    })),
  }
  if (options.reasoning) assistantMessage[options.reasoning.field] = options.reasoning.value
  const messages: DirectApiMessage[] = [assistantMessage]
  const followupMessages: DirectApiMessage[] = []
  const cancelledMessage = (call: DirectToolCall): DirectApiMessage =>
    toolMessage(call, { content: '工具执行已取消。', status: 'cancelled' })

  const execute = async (
    call: DirectToolCall,
  ): Promise<{ message: DirectApiMessage; followups: DirectApiMessage[] }> => {
    let startedAt: number | undefined
    options.onToolEvent?.({ type: 'tool_execution_start', call })
    if (options.signal?.aborted) {
      const result = { content: '工具执行已取消。', status: 'cancelled' as const }
      emitEnd(
        options.onToolEvent,
        call,
        result,
        'cancelled',
        startedAt,
      )
      return { message: toolMessage(call, result), followups: [] }
    }

    let decision: 'cancelled' | void
    try {
      decision = await options.beforeToolCall?.(call)
    } catch (error) {
      const result = {
        content: `Tool error: ${error instanceof Error ? error.message : String(error)}`,
        status: 'failed',
      } satisfies DirectToolResult
      emitEnd(options.onToolEvent, call, result, 'failed', startedAt)
      return { message: toolMessage(call, result), followups: [] }
    }
    if (decision === 'cancelled') {
      const result = {
        content: '用户拒绝了本次工具操作，未执行。请换一种方法继续。',
        status: 'cancelled',
      } satisfies DirectToolResult
      emitEnd(options.onToolEvent, call, result, 'cancelled', startedAt)
      return { message: toolMessage(call, result), followups: [] }
    }

    startedAt = performance.now()
    let result: DirectToolResult
    let status: DirectToolExecutionStatus
    try {
      result = await executeTool(call, options.signal)
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

    emitEnd(options.onToolEvent, call, result, status, startedAt)
    return { message: toolMessage(call, result), followups: result.followupMessages || [] }
  }

  for (let index = 0; index < calls.length; ) {
    if (options.signal?.aborted) {
      messages.push(...calls.slice(index).map(cancelledMessage))
      break
    }
    const end = canRunInParallel(calls[index]!, options)
      ? calls.findIndex((call, next) => next > index && !canRunInParallel(call, options))
      : index + 1
    const segmentEnd = end < 0 ? calls.length : end
    const segment = calls.slice(index, segmentEnd)
    const results =
      segment.length === 1
        ? [await execute(segment[0]!)]
        : (await Promise.allSettled(segment.map(execute))).map(result => {
            if (result.status === 'rejected') throw result.reason
            return result.value
          })
    for (const result of results) {
      messages.push(result.message)
      followupMessages.push(...result.followups)
    }
    index = segmentEnd
  }

  return [...messages, ...followupMessages]
}

function emitEnd(
  onToolEvent: ((event: DirectToolExecutionEvent) => void) | undefined,
  call: DirectToolCall,
  result: DirectToolResult,
  status: DirectToolExecutionStatus,
  startedAt?: number,
) {
  onToolEvent?.({
    type: 'tool_execution_end',
    call,
    result,
    status,
    durationMs:
      startedAt === undefined ? 0 : Math.max(0, Math.round(performance.now() - startedAt)),
  })
}

function toolMessage(call: DirectToolCall, result: DirectToolResult): DirectApiMessage {
  return {
    role: 'tool',
    tool_call_id: call.id,
    content:
      result.status === 'failed'
        ? `${result.content}\n\n工具失败。请查看真实输出，改用替代工具或命令、Skill 的降级方案，或安装并验证缺失依赖；不要原样重复失败命令。`
        : result.content,
  }
}

function isParallelRead(call: DirectToolCall): boolean {
  const name = call.function.name
  if (!['read', 'glob', 'grep'].includes(name)) return false
  try {
    const path = JSON.parse(call.function.arguments || '{}').path
    return typeof path !== 'string' || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path)
  } catch {
    return false
  }
}

function canRunInParallel(
  call: DirectToolCall,
  options: { beforeToolCall?: DirectBeforeToolCall; toolNeedsApproval?: DirectToolNeedsApproval },
): boolean {
  if (!isParallelRead(call)) return false
  if (!options.beforeToolCall) return true
  if (!options.toolNeedsApproval) return false
  try {
    return !options.toolNeedsApproval(call)
  } catch {
    return false
  }
}
