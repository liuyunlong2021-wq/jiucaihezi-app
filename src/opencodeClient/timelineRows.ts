import type { ChatMessage } from '@/composables/useChat'

export type OpenCodePartStatus = 'pending' | 'running' | 'completed' | 'error' | 'unknown'

export interface OpenCodeRenderablePart {
  id: string
  messageId: string
  type: string
  text?: string
  title?: string
  toolName?: string
  input?: string
  result?: string
  status?: OpenCodePartStatus
  isError?: boolean
  raw?: unknown
  [key: string]: unknown
}

export type OpenCodeTimelineRow =
  | { type: 'user'; key: string; messageId: string; previousUserMessage: boolean }
  | { type: 'assistant-part'; key: string; messageId: string; part: OpenCodeRenderablePart; previousAssistantPart: boolean }
  | { type: 'context-group'; key: string; messageId: string; parts: OpenCodeRenderablePart[]; previousAssistantPart: boolean }
  | { type: 'system-event'; key: string; messageId: string; part: OpenCodeRenderablePart; text: string }
  | { type: 'thinking'; key: string; messageId: string; reasoningHeading?: string }
  | { type: 'error'; key: string; messageId: string; text: string }
  | { type: 'turn-divider'; key: string; messageId: string; label: 'compaction' | 'interrupted' }

const CONTEXT_GROUP_TOOLS = new Set(['read', 'glob', 'grep', 'list'])
const HIDDEN_TOOLS = new Set(['todowrite'])
const EDIT_DEFAULT_OPEN_TOOLS = new Set(['edit', 'write', 'apply_patch'])

export function safeOpenCodeJsonSummary(value: unknown, maxLength = 1200): string {
  if (typeof value === 'string') return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
  try {
    const text = JSON.stringify(value, null, 2)
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
  } catch {
    return String(value)
  }
}

function partText(part: any): string {
  if (typeof part?.text === 'string') return part.text
  if (typeof part?.content === 'string') return part.content
  if (typeof part?.message === 'string') return part.message
  if (typeof part?.summary === 'string') return part.summary
  return ''
}

function partStatus(part: any): OpenCodePartStatus {
  const status = String(part?.state?.status || part?.status || '').toLowerCase()
  if (status === 'pending' || status === 'running' || status === 'completed' || status === 'error') return status
  return 'unknown'
}

export function openCodeToolResultContent(part: any): string {
  const state = part?.state || {}
  if (part?.type === 'tool_result') return safeOpenCodeJsonSummary(part.result || part.output || part.content || part)
  if (state.status === 'error') return safeOpenCodeJsonSummary(state.error || state.result || state.content || '工具执行失败')
  if ('result' in state && state.result !== undefined) return safeOpenCodeJsonSummary(state.result)
  if (typeof state.output === 'string') return state.output
  if (Array.isArray(state.content)) {
    return state.content.map((item: any) => {
      if (item?.type === 'text') return item.text || ''
      if (item?.type === 'file') return `[文件] ${item.name || item.mime || safeOpenCodeJsonSummary(item.source, 200)}`
      return safeOpenCodeJsonSummary(item, 300)
    }).filter(Boolean).join('\n')
  }
  if (state.structured && Object.keys(state.structured).length) return safeOpenCodeJsonSummary(state.structured)
  return ''
}

export function summarizeOpenCodePart(part: unknown): string {
  const value = part as any
  const type = value?.type
  if (!type) return partText(value)
  if (type === 'text' || type === 'reasoning') return partText(value)
  if (type === 'file') return `[文件] ${value.filename || value.name || value.url || value.mime || value.id || 'attachment'}`
  if (type === 'attachment') return `[附件] ${value.filename || value.name || value.mime || value.id || 'attachment'}`
  if (type === 'subtask') return `[子任务] ${value.description || value.prompt || value.agent || safeOpenCodeJsonSummary(value, 400)}`
  if (type === 'step-start') return '[阶段] 开始执行'
  if (type === 'step-finish') return `[阶段] 完成：${value.reason || 'done'}${value.cost ? `，成本 ${value.cost}` : ''}`
  if (type === 'step-fail') return `[阶段失败] ${value.error?.message || value.reason || safeOpenCodeJsonSummary(value.error || value, 400)}`
  if (type === 'snapshot') return `[快照] ${value.snapshot || value.id || ''}`.trim()
  if (type === 'patch' || type === 'diff') return `[变更] ${(value.files || []).join(', ') || value.hash || type}`
  if (type === 'shell') return `[Shell] ${value.command || ''}\n${value.output || ''}`.trim()
  if (type === 'agent') return `[Agent] 切换到 ${value.name || value.agent || 'unknown'}`
  if (type === 'retry') return `[重试] 第 ${value.attempt || '?'} 次：${value.error?.message || safeOpenCodeJsonSummary(value.error, 300)}`
  if (type === 'compaction') return `[上下文压缩] ${value.auto ? '自动' : '手动'}${value.overflow ? '，上下文溢出' : ''}`
  if (type === 'error') return `[错误] ${value.message || value.error?.message || safeOpenCodeJsonSummary(value.error || value, 500)}`
  if (type === 'tool' || type === 'tool_call' || type === 'tool_result') {
    const state = value.state || {}
    const label = value.tool || value.name || value.function?.name || value.callID || value.toolCallId || 'tool'
    if (isDismissedQuestionRawPart(value)) return '问题已忽略'
    if (state.status === 'pending' || state.status === 'running') return `[工具] ${label} ${state.status}`
    if (state.status === 'error') return `[工具失败] ${label}: ${state.error?.message || safeOpenCodeJsonSummary(state.error, 300)}`
    const result = openCodeToolResultContent(value)
    return result ? `[工具完成] ${label}\n${result}` : `[工具完成] ${label}`
  }
  return `[OpenCode: ${type}] ${safeOpenCodeJsonSummary(value, 800)}`
}

function isDismissedQuestionRawPart(part: any): boolean {
  if (part?.type !== 'tool') return false
  const tool = String(part.tool || part.name || '')
  if (tool !== 'question') return false
  const state = part.state || {}
  if (String(state.status || '').toLowerCase() !== 'error') return false
  const error = String(state.error?.message || state.error || part.error?.message || part.error || '')
  return /dismissed this question|question dismissed|dismiss/i.test(error)
}

export function normalizeOpenCodePart(rawPart: unknown, messageId: string): OpenCodeRenderablePart {
  const part = rawPart as any
  const type = String(part?.type || 'unknown')
  const id = String(part?.id || part?.partID || part?.callID || part?.toolCallId || `${type}_${Date.now()}`)
  const status = partStatus(part)
  const toolName = String(part?.tool || part?.name || part?.function?.name || '')
  const result = openCodeToolResultContent(part)
  return {
    id,
    messageId,
    type,
    text: type === 'text' || type === 'reasoning' ? partText(part) : undefined,
    title: part?.title || part?.state?.title || summarizeOpenCodePart(part).split('\n')[0],
    toolName: toolName || (type === 'shell' ? 'shell' : undefined),
    input: safeOpenCodeJsonSummary(part?.state?.input ?? part?.input ?? part?.arguments ?? part?.function?.arguments ?? {}),
    result: result || (type === 'shell' ? String(part?.output || '') : undefined),
    status,
    isError: status === 'error' || type === 'error',
    raw: part,
  }
}

export function normalizeOpenCodeParts(parts: unknown[] | undefined, messageId: string): OpenCodeRenderablePart[] {
  return (parts || []).map(part => normalizeOpenCodePart(part, messageId))
}

export function upsertOpenCodePart(message: ChatMessage, rawPart: unknown): OpenCodeRenderablePart {
  const next = normalizeOpenCodePart(rawPart, message.id)
  const parts = message.openCodeParts ? [...message.openCodeParts] : []
  const index = parts.findIndex(part => part.id === next.id)
  if (index >= 0) {
    parts[index] = {
      ...parts[index],
      ...next,
      text: next.text !== undefined ? next.text : parts[index].text,
      result: next.result !== undefined ? next.result : parts[index].result,
    }
  } else {
    parts.push(next)
  }
  message.openCodeParts = parts
  return index >= 0 ? parts[index] : next
}

export function applyOpenCodePartDelta(
  message: ChatMessage,
  partId: string,
  field: string,
  delta: string,
): OpenCodeRenderablePart {
  const parts = message.openCodeParts ? [...message.openCodeParts] : []
  const index = parts.findIndex(part => part.id === partId)
  const existing = index >= 0 ? parts[index] : undefined
  const type = existing?.type || (field === 'reasoning' ? 'reasoning' : 'text')
  const next: OpenCodeRenderablePart = {
    id: partId,
    messageId: message.id,
    type,
    text: existing?.text,
    result: existing?.result,
    status: 'running',
    raw: existing?.raw,
  }
  // 按官方 event-reducer 规则：对任意 string field 追加 delta，不限 text/reasoning
  next[field] = `${(existing?.[field] as string | undefined) || ''}${delta}`
  if (index >= 0) parts[index] = { ...existing, ...next }
  else parts.push(next)
  message.openCodeParts = parts
  return index >= 0 ? parts[index] : next
}

export function isRenderableOpenCodePart(part: OpenCodeRenderablePart, showReasoning = true): boolean {
  if (part.type === 'tool') {
    if (part.toolName && HIDDEN_TOOLS.has(part.toolName)) return false
    if (part.toolName === 'question') return part.status !== 'pending' && part.status !== 'running'
    return true
  }
  if (part.type === 'text') return Boolean(part.text?.trim())
  if (part.type === 'reasoning') return showReasoning && Boolean(part.text?.trim())
  return true
}

export function isContextOpenCodeTool(part: OpenCodeRenderablePart): boolean {
  return part.type === 'tool' && Boolean(part.toolName && CONTEXT_GROUP_TOOLS.has(part.toolName))
}

export function isDismissedOpenCodeQuestion(part: OpenCodeRenderablePart): boolean {
  if (part.type !== 'tool' || part.toolName !== 'question') return false
  return part.status === 'error' && isDismissedQuestionRawPart(part.raw)
}

export function openCodePartDefaultOpen(
  part: OpenCodeRenderablePart,
  settings: { shellToolPartsExpanded?: boolean; editToolPartsExpanded?: boolean } = {},
): boolean | undefined {
  if (part.type !== 'tool') return undefined
  if (part.toolName === 'bash') return Boolean(settings.shellToolPartsExpanded)
  if (part.toolName && EDIT_DEFAULT_OPEN_TOOLS.has(part.toolName)) return Boolean(settings.editToolPartsExpanded)
  return undefined
}

export type OpenCodePartGroup =
  | { type: 'part'; key: string; part: OpenCodeRenderablePart }
  | { type: 'context'; key: string; parts: OpenCodeRenderablePart[] }

export function groupOpenCodeTimelineParts(parts: OpenCodeRenderablePart[]): OpenCodePartGroup[] {
  const groups: OpenCodePartGroup[] = []
  let contextParts: OpenCodeRenderablePart[] = []
  const flush = () => {
    if (!contextParts.length) return
    groups.push({
      type: 'context',
      key: `context:${contextParts[0].id}`,
      parts: contextParts,
    })
    contextParts = []
  }
  for (const part of parts) {
    if (isContextOpenCodeTool(part)) {
      contextParts.push(part)
      continue
    }
    flush()
    groups.push({ type: 'part', key: `part:${part.messageId}:${part.id}`, part })
  }
  flush()
  return groups
}

export function isSystemOpenCodePart(part: OpenCodeRenderablePart): boolean {
  return isDismissedOpenCodeQuestion(part)
    || part.type === 'agent'
    || part.type === 'compaction'
    || part.type === 'retry'
    || part.type === 'step-start'
    || part.type === 'step-finish'
    || part.type === 'step-fail'
}

function reasoningHeading(text: string): string | undefined {
  const atx = text.replace(/\r\n?/g, '\n').match(/^\s{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/m)
  return atx?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined
}

export function buildOpenCodeTimelineRows(
  messages: ChatMessage[],
  input: { isStreaming?: boolean; activeAssistantMessageId?: string; showReasoning?: boolean } = {},
): OpenCodeTimelineRow[] {
  const rows: OpenCodeTimelineRow[] = []
  let previousUserMessage = false
  for (const message of messages) {
    if (message.role === 'user') {
      rows.push({ type: 'user', key: `user-message:${message.id}`, messageId: message.id, previousUserMessage })
      previousUserMessage = true
      continue
    }
    if (message.role !== 'assistant') continue
    const parts = (message.openCodeParts || []).filter(part => isRenderableOpenCodePart(part, input.showReasoning ?? true))
    let previousAssistantPart = false
    for (const group of groupOpenCodeTimelineParts(parts)) {
      if (group.type === 'context') {
        rows.push({
          type: 'context-group',
          key: group.key,
          messageId: message.id,
          parts: group.parts,
          previousAssistantPart,
        })
        previousAssistantPart = true
        continue
      }
      const part = group.part
      if (isSystemOpenCodePart(part)) {
        rows.push({
          type: 'system-event',
          key: `system-event:${message.id}:${part.id}`,
          messageId: message.id,
          part,
          text: part.title || summarizeOpenCodePart(part.raw || part),
        })
        continue
      }
      rows.push({
        type: 'assistant-part',
        key: `assistant-part:${message.id}:${part.id}`,
        messageId: message.id,
        part,
        previousAssistantPart,
      })
      previousAssistantPart = true
    }
    if (message.finishReason === 'error') {
      rows.push({
        type: 'error',
        key: `error:${message.id}`,
        messageId: message.id,
        text: message.content || 'OpenCode 运行错误',
      })
    }
    if (input.isStreaming && input.activeAssistantMessageId === message.id && !parts.some(part => part.type === 'text' && part.text?.trim())) {
      rows.push({
        type: 'thinking',
        key: `thinking:${message.id}`,
        messageId: message.id,
        reasoningHeading: reasoningHeading(message.reasoningContent || ''),
      })
    }
  }
  return rows
}
