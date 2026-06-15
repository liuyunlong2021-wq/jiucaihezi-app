import type {
  AssistantMessage,
  Message,
  Part,
  SessionMessage,
  UserMessage,
} from '@opencode-ai/sdk/v2'

import type { ChatMessage } from '@/composables/useChat'
import type { ToolCall } from '@/composables/useChat'
import {
  normalizeOpenCodeParts,
  openCodeToolResultContent,
  safeOpenCodeJsonSummary,
  summarizeOpenCodePart,
} from './timelineRows'

export interface OpenCodeMessageWithParts {
  info: Message
  parts: Part[]
}

function messageTime(message: SessionMessage | Message): number {
  const created = (message as any)?.time?.created
  if (typeof created === 'number') return created < 10_000_000_000 ? created * 1000 : created
  if (typeof created === 'string') {
    const parsed = Date.parse(created)
    if (Number.isFinite(parsed)) return parsed
    const numeric = Number(created)
    if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric
  }
  return Date.now()
}

function inputToArgs(input: unknown): string {
  if (typeof input === 'string') return input
  return safeOpenCodeJsonSummary(input || {})
}

function toolCallFromPart(part: any): ToolCall | null {
  const type = part?.type
  if (type === 'tool') {
    return {
      id: String(part.callID || part.id),
      type: 'function',
      function: {
        name: String(part.tool || part.name || 'tool'),
        arguments: inputToArgs(part.state?.input),
      },
    }
  }
  if (type === 'tool_call') {
    return {
      id: String(part.callID || part.toolCallId || part.id),
      type: 'function',
      function: {
        name: String(part.tool || part.name || part.function?.name || 'tool'),
        arguments: inputToArgs(part.input || part.arguments || part.function?.arguments),
      },
    }
  }
  return null
}

function collectToolCalls(parts: unknown[] | undefined): ToolCall[] {
  const calls = (parts || []).map(toolCallFromPart).filter(Boolean) as ToolCall[]
  const seen = new Set<string>()
  return calls.filter((call) => {
    if (seen.has(call.id)) return false
    seen.add(call.id)
    return true
  })
}

function toolMessagesFromParts(parent: ChatMessage, parts: unknown[] | undefined): ChatMessage[] {
  return (parts || [])
    .filter((part: any) => part?.type === 'tool' || part?.type === 'tool_result')
    .map((part: any) => {
      const state = part.state || {}
      const result = part.type === 'tool_result'
        ? safeOpenCodeJsonSummary(part.result || part.output || part.content || part)
        : openCodeToolResultContent(part)
      if (!result && (state.status === 'pending' || state.status === 'running')) return null
      return {
        id: `${parent.id}__tool__${part.callID || part.toolCallId || part.id || Date.now()}`,
        role: 'tool' as const,
        content: result || summarizeOpenCodePart(part),
        timestamp: parent.timestamp,
        toolCallId: String(part.callID || part.toolCallId || part.id || ''),
        toolName: String(part.tool || part.name || 'tool'),
        finishReason: state.status === 'error' ? 'tool_error' : 'tool_complete',
      }
    })
    .filter(Boolean) as ChatMessage[]
}

function normalizeSessionContent(message: any): unknown[] {
  if (message?.type === 'shell') {
    return [{
      id: message.callID || message.id,
      type: 'shell',
      command: message.command,
      output: message.output,
      status: message.time?.completed ? 'completed' : 'running',
    }]
  }
  if (Array.isArray(message?.content)) {
    return message.content.map((part: any) => {
      if (part?.type !== 'tool') return part
      return {
        ...part,
        callID: part.id,
        tool: part.name,
      }
    })
  }
  return []
}

function contentTextFromValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .map((part: any) => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''
        const type = String(part.type || '')
        if (type === 'text' || type === 'input_text' || type === 'output_text') {
          return contentTextFromValue(part.text ?? part.content ?? part.value)
        }
        return ''
      })
      .join('')
  }
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  for (const key of ['text', 'message', 'summary', 'content', 'output']) {
    const text = contentTextFromValue(record[key])
    if (text) return text
  }
  return ''
}

function roleFromOpenCodeMessage(message: SessionMessage | Message): ChatMessage['role'] {
  const kind = (message as any).type || (message as any).role
  if (kind === 'assistant') return 'assistant'
  if (kind === 'user') return 'user'
  if (kind === 'shell') return 'assistant'
  return 'system'
}

export function mapOpenCodeMessageToChatMessage(message: SessionMessage | Message, parts?: Part[]): ChatMessage {
  const anyMessage = message as any
  const contentParts = Array.isArray(parts) ? parts : normalizeSessionContent(anyMessage)
  const assistantContent = contentTextFromValue(anyMessage.content)
  const reasoningContent = Array.isArray(anyMessage.content)
    ? anyMessage.content
      .filter((part: any) => part?.type === 'reasoning')
      .map((part: any) => part.text || '')
      .join('')
    : ''
  const content = assistantContent
    || contentTextFromValue(anyMessage.text)
    || contentTextFromValue(anyMessage.summary)
    || contentTextFromValue(anyMessage.system)
    || contentTextFromValue(anyMessage.error?.data?.message)
    || contentTextFromValue(anyMessage.error?.message)
    || ''
  const toolCalls = collectToolCalls(contentParts.length ? contentParts : anyMessage.parts)
  // Preserve per-turn diffs from user message summary (official: UserMessage.summary.diffs → turnDiffs)
  const summaryDiffs = Array.isArray(anyMessage.summary?.diffs)
    ? (anyMessage.summary.diffs as any[]).map((d: any) => ({
        file: d.file,
        patch: d.patch,
        additions: d.additions,
        deletions: d.deletions,
        status: d.status,
      }))
    : undefined
  return {
    id: String(anyMessage.id || `${anyMessage.type || anyMessage.role || 'message'}_${messageTime(message)}`),
    role: roleFromOpenCodeMessage(message),
    content,
    timestamp: messageTime(message),
    agentName: anyMessage.agent,
    finishReason: anyMessage.error ? 'error' : undefined,
    reasoningContent,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    openCodeParts: normalizeOpenCodeParts(contentParts.length ? contentParts : anyMessage.parts, String(anyMessage.id || 'message')),
    summaryDiffs,
  }
}

export function mapOpenCodeMessageToChatMessages(message: SessionMessage | Message, parts?: Part[]): ChatMessage[] {
  const base = mapOpenCodeMessageToChatMessage(message, parts)
  const anyMessage = message as any
  const contentParts = Array.isArray(parts) ? parts : normalizeSessionContent(anyMessage)
  return [base, ...toolMessagesFromParts(base, contentParts)]
}

export function mapOpenCodeMessagesToChatMessages(messages: Array<SessionMessage | OpenCodeMessageWithParts>): ChatMessage[] {
  return messages
    .flatMap((message) => {
      const value = message as OpenCodeMessageWithParts
      if (value?.info && Array.isArray(value.parts)) return mapOpenCodeMessageToChatMessages(value.info, value.parts)
      return mapOpenCodeMessageToChatMessages(message as SessionMessage)
    })
    .filter(message => (
      String(message.content || '').trim()
      || Boolean(message.toolCalls?.length)
      || Boolean(message.openCodeParts?.length)
    ))
}

export type OpenCodeUserMessage = UserMessage
export type OpenCodeAssistantMessage = AssistantMessage
