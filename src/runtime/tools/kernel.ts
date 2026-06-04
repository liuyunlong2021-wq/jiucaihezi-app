import {
  getRegisteredExecutor,
  type ToolExecutorRegistry,
} from './registry'
import type {
  ToolExecutor,
  ToolCallLike,
  ToolExecutionResult,
} from './types'

export interface ToolRuntimeKernel {
  execute(input: ToolKernelExecuteInput): Promise<ToolExecutionResult>
}

export interface ToolKernelExecuteInput {
  call: ToolCallLike
  exposedToolNames: Set<string> | string[]
  context?: unknown
}

export interface CreateToolRuntimeKernelInput {
  executors: ToolExecutorRegistry
  fallbackExecutor?: ToolExecutor
}

const MAX_TOOL_ARGS_LENGTH = 100_000

function parseToolArgs(raw: string | undefined): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  try {
    if (String(raw || '').length > MAX_TOOL_ARGS_LENGTH) {
      return { ok: false, error: `工具参数过大 (${String(raw || '').length} 字符)，拒绝执行` }
    }
    const parsed = JSON.parse(raw || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: '工具参数必须是 JSON object' }
    }
    return { ok: true, args: parsed as Record<string, unknown> }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: message }
  }
}

function hasExposedTool(exposedToolNames: Set<string> | string[], toolName: string): boolean {
  return exposedToolNames instanceof Set
    ? exposedToolNames.has(toolName)
    : exposedToolNames.includes(toolName)
}

export function createToolRuntimeKernel(input: CreateToolRuntimeKernelInput): ToolRuntimeKernel {
  return {
    async execute({ call, exposedToolNames, context }) {
      const toolName = String(call.function.name || '').trim()
      const callId = call.id

      if (!hasExposedTool(exposedToolNames, toolName)) {
        return {
          status: 'error',
          toolName,
          callId,
          errorCode: 'TOOL_NOT_EXPOSED',
          errorMessage: `工具 "${toolName}" 未在本轮 ToolConnection 中暴露，已拒绝执行。`,
        }
      }

      const parsed = parseToolArgs(call.function.arguments)
      if (!parsed.ok) {
        return {
          status: 'error',
          toolName,
          callId,
          errorCode: 'INVALID_TOOL_ARGUMENTS_JSON',
          errorMessage: `工具 "${toolName}" 的参数不是合法 JSON：${parsed.error}`,
        }
      }

      const executor = getRegisteredExecutor(input.executors, toolName) || input.fallbackExecutor
      if (!executor) {
        return {
          status: 'error',
          toolName,
          callId,
          errorCode: 'TOOL_NOT_REGISTERED',
          errorMessage: `工具 "${toolName}" 暂未注册执行器。`,
        }
      }

      return executor({
        call,
        args: parsed.args,
        context,
      })
    },
  }
}

export function stringifyToolExecutionResult(result: ToolExecutionResult): string {
  if (typeof result.message === 'string') return result.message
  if (result.status === 'error') {
    return JSON.stringify({
      status: 'error',
      error: result.errorCode || 'TOOL_EXECUTION_ERROR',
      tool: result.toolName,
      message: result.errorMessage || `工具 "${result.toolName}" 执行失败。`,
    })
  }
  return JSON.stringify({
    status: result.status,
    tool: result.toolName,
    data: result.data ?? null,
    artifactIds: result.artifactIds || undefined,
    jobId: result.jobId || undefined,
  })
}
