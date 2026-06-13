import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import type { Todo } from '@opencode-ai/sdk/v2'

function unwrapData<T>(result: unknown): T {
  const value = result as { data?: T; error?: unknown }
  if (value && typeof value === 'object' && 'error' in value && value.error) {
    const error = value.error as { message?: string; detail?: string; code?: string; _tag?: string }
    throw new Error(error.message || error.detail || error.code || error._tag || 'OpenCode API returned an error')
  }
  if (value && typeof value === 'object' && 'data' in value) return value.data as T
  return result as T
}

export type OpenCodePermissionReply = 'once' | 'always' | 'reject'

export interface OpenCodePermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
  always?: string[]
  source?: unknown
}

export interface OpenCodeQuestionOption {
  label: string
  description?: string
}

export interface OpenCodeQuestionInfo {
  header: string
  question: string
  options: OpenCodeQuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface OpenCodeQuestionRequest {
  id: string
  sessionID: string
  questions: OpenCodeQuestionInfo[]
  tool?: unknown
}

export type OpenCodeTodo = Todo & {
  id?: string
  content: string
  status: string
  priority?: string
}

export function normalizePermissionRequest(value: any): OpenCodePermissionRequest {
  return {
    id: String(value?.id || value?.requestID || ''),
    sessionID: String(value?.sessionID || ''),
    permission: String(value?.permission || value?.action || 'permission'),
    patterns: Array.isArray(value?.patterns) ? value.patterns.map(String) : Array.isArray(value?.resources) ? value.resources.map(String) : [],
    metadata: value?.metadata,
    always: Array.isArray(value?.always) ? value.always.map(String) : Array.isArray(value?.save) ? value.save.map(String) : [],
    source: value?.source,
  }
}

export function normalizeQuestionRequest(value: any): OpenCodeQuestionRequest {
  return {
    id: String(value?.id || value?.requestID || ''),
    sessionID: String(value?.sessionID || ''),
    questions: Array.isArray(value?.questions)
      ? value.questions.map((question: any) => ({
        header: String(question?.header || question?.question || '问题').slice(0, 40),
        question: String(question?.question || question?.header || ''),
        options: Array.isArray(question?.options)
          ? question.options.map((option: any) => ({
            label: String(option?.label || option),
            description: option?.description ? String(option.description) : undefined,
          }))
          : [],
        multiple: question?.multiple === true,
        custom: question?.custom === true,
      }))
      : [],
    tool: value?.tool,
  }
}

export async function replyOpenCodePermission(
  client: OpencodeClient,
  input: { sessionID: string; requestID: string; reply: OpenCodePermissionReply; directory?: string; workspace?: string },
): Promise<void> {
  const anyClient = client as any
  // OpenCode 1.17.0 still exposes these first-class endpoints, while the
  // bundled 1.16.2 SDK's generated v2 session paths are stale for this route.
  if (anyClient.permission?.reply) {
    unwrapData(await anyClient.permission.reply({
      requestID: input.requestID,
      directory: input.directory,
      workspace: input.workspace,
      reply: input.reply,
    }))
    return
  }
  if (anyClient.v2?.session?.permission?.reply) {
    unwrapData(await anyClient.v2.session.permission.reply({
      sessionID: input.sessionID,
      requestID: input.requestID,
      reply: input.reply,
    }))
    return
  }
  if (anyClient.permission?.respond) {
    unwrapData(await anyClient.permission.respond({
      sessionID: input.sessionID,
      permissionID: input.requestID,
      directory: input.directory,
      workspace: input.workspace,
      response: input.reply,
    }))
    return
  }
  throw new Error('OpenCode permission reply endpoint is unavailable.')
}

export async function replyOpenCodeQuestion(
  client: OpencodeClient,
  input: { sessionID: string; requestID: string; answers: string[][]; directory?: string; workspace?: string },
): Promise<void> {
  const anyClient = client as any
  // Keep question replies on the server-supported endpoint before trying
  // generated v2 session fallbacks.
  if (anyClient.question?.reply) {
    unwrapData(await anyClient.question.reply({
      requestID: input.requestID,
      directory: input.directory,
      workspace: input.workspace,
      answers: input.answers,
    }))
    return
  }
  if (anyClient.v2?.session?.question?.reply) {
    unwrapData(await anyClient.v2.session.question.reply({
      sessionID: input.sessionID,
      requestID: input.requestID,
      questionV2Reply: { answers: input.answers },
    }))
    return
  }
  throw new Error('OpenCode question reply endpoint is unavailable.')
}

export async function rejectOpenCodeQuestion(
  client: OpencodeClient,
  input: { sessionID: string; requestID: string; directory?: string; workspace?: string },
): Promise<void> {
  const anyClient = client as any
  if (anyClient.question?.reject) {
    unwrapData(await anyClient.question.reject({
      requestID: input.requestID,
      directory: input.directory,
      workspace: input.workspace,
    }))
    return
  }
  if (anyClient.v2?.session?.question?.reject) {
    unwrapData(await anyClient.v2.session.question.reject({
      sessionID: input.sessionID,
      requestID: input.requestID,
    }))
    return
  }
  throw new Error('OpenCode question reject endpoint is unavailable.')
}

export async function listOpenCodeTodos(
  client: OpencodeClient,
  sessionID: string,
  input: { directory?: string; workspace?: string } = {},
): Promise<OpenCodeTodo[]> {
  const response = unwrapData<any>(await client.session.todo({
    sessionID,
    directory: input.directory,
    workspace: input.workspace,
  } as any))
  return Array.isArray(response) ? response : response?.data || response?.todos || []
}
