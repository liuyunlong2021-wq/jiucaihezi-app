export interface ToolCallLike {
  id?: string
  function: {
    name: string
    arguments?: string
  }
}

export type ToolExecutionStatus = 'ok' | 'error' | 'running'

export interface ToolExecutionResult {
  status: ToolExecutionStatus
  toolName: string
  callId?: string
  message?: string
  data?: unknown
  artifactIds?: string[]
  jobId?: string
  errorCode?: string
  errorMessage?: string
}

export interface ToolExecutorInput {
  call: ToolCallLike
  args: Record<string, unknown>
  context?: unknown
}

export type ToolExecutor = (
  input: ToolExecutorInput,
) => ToolExecutionResult | Promise<ToolExecutionResult>
