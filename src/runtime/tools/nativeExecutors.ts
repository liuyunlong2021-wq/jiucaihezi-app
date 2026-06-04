import type { ToolExecutor, ToolCallLike, ToolExecutionResult } from './types'

export interface NativeToolCall extends ToolCallLike {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface NativeToolExecutionContext {
  files?: Array<{ name: string; content: string }>
  images?: string[]
  agentId?: string
  sessionId?: string
  userInput?: string
}

export type OptionalStringToolExecutor = (
  call: NativeToolCall,
  context?: NativeToolExecutionContext,
) => Promise<string | null> | string | null

export type StringToolExecutor = (
  call: NativeToolCall,
  context?: NativeToolExecutionContext,
) => Promise<string> | string

export interface NativeFallbackToolExecutorDeps {
  executeTodoToolCall: OptionalStringToolExecutor
  executeDevProjectToolCall: OptionalStringToolExecutor
  executeLocalContentToolCall: OptionalStringToolExecutor
  executeBrowserToolCall: OptionalStringToolExecutor
  executeOfficeToolCall: StringToolExecutor
  executeSkillCreatorTool: StringToolExecutor
  executeSkillBuilderToolCall: OptionalStringToolExecutor
  executeMcpToolCall: (toolName: string, args: Record<string, unknown>) => Promise<string> | string
  isOfficeToolName: (toolName: string) => boolean
  isMcpToolName: (toolName: string) => boolean
}

const SKILL_CREATOR_TOOL_NAMES = new Set([
  'skill_creator_validate',
  'run_skill_tests',
  'skill_creator_aggregate_benchmark',
  'skill_creator_open_eval_review',
  'skill_creator_improve_description',
  'skill_creator_package',
  'save_skill',
])

export function createNativeFallbackToolExecutor(
  deps: NativeFallbackToolExecutorDeps,
): ToolExecutor {
  return async ({ call, args, context }) => {
    const toolName = String(call.function.name || '').trim()
    const nativeCall = normalizeNativeToolCall(call, toolName)
    const nativeContext = normalizeNativeToolContext(context)

    const todoResult = await deps.executeTodoToolCall(nativeCall, nativeContext)
    if (todoResult) return toolStringResult(toolName, nativeCall.id, todoResult)

    const devProjectResult = await deps.executeDevProjectToolCall(nativeCall, nativeContext)
    if (devProjectResult) return toolStringResult(toolName, nativeCall.id, devProjectResult)

    const localContentResult = await deps.executeLocalContentToolCall(nativeCall, nativeContext)
    if (localContentResult) return toolStringResult(toolName, nativeCall.id, localContentResult)

    const browserToolResult = await deps.executeBrowserToolCall(nativeCall, nativeContext)
    if (browserToolResult) return toolStringResult(toolName, nativeCall.id, browserToolResult)

    if (deps.isOfficeToolName(toolName)) {
      return toolStringResult(toolName, nativeCall.id, await deps.executeOfficeToolCall(nativeCall, nativeContext))
    }

    const isSkillBuilderContext = nativeContext?.agentId === 'preset_skill-builder'
    if (isSkillBuilderContext && (toolName === 'run_skill_tests' || toolName === 'save_skill')) {
      return toolStringResult(toolName, nativeCall.id, await deps.executeSkillCreatorTool(nativeCall, nativeContext))
    }

    if (SKILL_CREATOR_TOOL_NAMES.has(toolName)) {
      return toolStringResult(toolName, nativeCall.id, await deps.executeSkillCreatorTool(nativeCall, nativeContext))
    }

    const skillBuilderResult = await deps.executeSkillBuilderToolCall(nativeCall, nativeContext)
    if (skillBuilderResult) return toolStringResult(toolName, nativeCall.id, skillBuilderResult)

    if (deps.isMcpToolName(toolName)) {
      return toolStringResult(toolName, nativeCall.id, await deps.executeMcpToolCall(toolName, args))
    }

    return toolStringResult(toolName, nativeCall.id, JSON.stringify({
      status: 'not_implemented',
      tool: toolName,
      note: `工具 "${toolName}" 暂未注册执行器。参数已记录。`,
      args,
    }))
  }
}

function normalizeNativeToolCall(call: ToolCallLike, toolName: string): NativeToolCall {
  return {
    id: String(call.id || ''),
    type: 'function',
    function: {
      name: toolName,
      arguments: call.function.arguments || '{}',
    },
  }
}

function toolStringResult(toolName: string, callId: string | undefined, message: string): ToolExecutionResult {
  return {
    status: 'ok',
    toolName,
    callId,
    message,
  }
}

function normalizeNativeToolContext(context: unknown): NativeToolExecutionContext | undefined {
  if (!context || typeof context !== 'object') return undefined
  const record = context as NativeToolExecutionContext
  return {
    files: Array.isArray(record.files) ? record.files : undefined,
    images: Array.isArray(record.images) ? record.images : undefined,
    agentId: typeof record.agentId === 'string' ? record.agentId : undefined,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
    userInput: typeof record.userInput === 'string' ? record.userInput : undefined,
  }
}
