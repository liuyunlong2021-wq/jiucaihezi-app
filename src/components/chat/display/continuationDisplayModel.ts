import type { ChatMessage } from '@/composables/useChat'

export interface ContinuationPart {
  id: string
  content: string
  finishReason?: string
  reasoningContent?: string
  toolCalls?: ChatMessage['toolCalls']
  officeDownloadFiles?: ChatMessage['officeDownloadFiles']
  searchResults?: ChatMessage['searchResults']
  traceSummary?: ChatMessage['traceSummary']
  latestToolResult?: string
}

function messageContentText(message: ChatMessage): string {
  return String(message.content || '')
}

export function buildContinuationChildrenByParent(messages: ChatMessage[]): Map<string, ContinuationPart[]> {
  const grouped = new Map<string, ContinuationPart[]>()
  const latestToolResultByAssistantId = buildLatestToolResultByAssistantId(messages)
  for (const message of messages) {
    const content = messageContentText(message)
    if (message.role !== 'assistant' || !message.continuationParentId || !content.trim()) continue
    const children = grouped.get(message.continuationParentId) || []
    children.push({
      id: message.id,
      content,
      finishReason: message.finishReason,
      reasoningContent: message.reasoningContent,
      toolCalls: message.toolCalls,
      officeDownloadFiles: message.officeDownloadFiles,
      searchResults: message.searchResults,
      traceSummary: message.traceSummary,
      latestToolResult: latestToolResultByAssistantId.get(message.id),
    })
    grouped.set(message.continuationParentId, children)
  }
  return grouped
}

export function buildLatestToolResultByAssistantId(messages: ChatMessage[]): Map<string, string> {
  const toolOwnerByCallId = new Map<string, string>()
  const resultByAssistantId = new Map<string, string>()
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls || []) {
        toolOwnerByCallId.set(call.id, message.id)
      }
      continue
    }
    if (message.role !== 'tool' || !message.toolCallId) continue
    const assistantId = toolOwnerByCallId.get(message.toolCallId)
    const result = messageContentText(message).trim()
    if (assistantId && result) resultByAssistantId.set(assistantId, result)
  }
  return resultByAssistantId
}

export function getContinuationTailMessage(messages: ChatMessage[], parentAssistantMessageId: string): ChatMessage | null {
  const children = messages.filter(message =>
    message.role === 'assistant'
    && message.continuationParentId === parentAssistantMessageId
    && Boolean(messageContentText(message).trim()),
  )
  if (children.length) return children[children.length - 1]
  const parent = messages.find(message => message.id === parentAssistantMessageId && message.role === 'assistant')
  return parent || null
}

export function collectContinuationThreadIds(messages: ChatMessage[], parentAssistantMessageId: string): string[] {
  const ids = new Set<string>([parentAssistantMessageId])
  for (const message of messages) {
    if (message.continuationParentId === parentAssistantMessageId) ids.add(message.id)
  }
  return messages
    .filter(message => ids.has(message.id) || (message.isContinuationPrompt && ids.has(String(message.continuationParentId || parentAssistantMessageId))))
    .map(message => message.id)
}
