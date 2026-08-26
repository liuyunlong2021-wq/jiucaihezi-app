export interface DirectToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface DirectReasoningReplay {
  field: 'reasoning_content'
  value: string
}

export type DirectApiMessage = Record<string, any>

export interface DirectToolResult {
  content: string
  status?: 'succeeded' | 'failed' | 'cancelled'
  followupMessages?: DirectApiMessage[]
}

export type DirectToolExecutor = (call: DirectToolCall, signal?: AbortSignal) => Promise<DirectToolResult>

export type DirectToolExecutionStatus = 'succeeded' | 'failed' | 'cancelled'

export type DirectToolExecutionEvent =
  | { type: 'tool_execution_start'; call: DirectToolCall }
  | {
      type: 'tool_execution_end'
      call: DirectToolCall
      result: DirectToolResult
      status: DirectToolExecutionStatus
      durationMs: number
    }

export type DirectBeforeToolCall = (
  call: DirectToolCall,
) => Promise<'cancelled' | void> | 'cancelled' | void

export type DirectToolNeedsApproval = (call: DirectToolCall) => boolean

export interface DirectRunMetrics {
  modelRequests: number
  modelRequestDurationMs: number[]
  toolRounds: number
  totalDurationMs: number
}
