import type { ChatMessage } from '@/composables/useChat'

const RAW_SYNC_ROLES = new Set(['user', 'assistant'])

export interface ConversationRawSyncInput {
  vaultId?: string | null
  sessionId: string
  messages: ChatMessage[]
}

export interface ConversationRawMarkdownInput {
  sessionId: string
  title?: string
  messages: ChatMessage[]
  updatedAt?: number
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'
}

function displayTime(timestamp?: number): string {
  if (!timestamp) return ''
  try {
    return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return ''
  }
}

function roleLabel(role: ChatMessage['role']): string {
  return role === 'user' ? '我' : 'AI'
}

function syncableMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(message =>
    RAW_SYNC_ROLES.has(message.role) &&
    String(message.content || '').trim().length > 0
  )
}

function messageContentText(message: ChatMessage): string {
  return String(message.content || '')
}

export function shouldSyncConversationRaw(input: ConversationRawSyncInput): boolean {
  return Boolean(
    input.vaultId &&
    input.sessionId &&
    syncableMessages(input.messages).length > 0,
  )
}

export function buildConversationRawFileName(sessionId: string): string {
  return `会话_${sanitizeSessionId(sessionId)}.md`
}

export function collectConversationRawMessageIds(messages: ChatMessage[]): string[] {
  return syncableMessages(messages).map(message => message.id).filter(Boolean)
}

export function buildConversationRawMarkdown(input: ConversationRawMarkdownInput): string {
  const title = input.title?.trim() || '未命名对话'
  const updated = displayTime(input.updatedAt)
  const header = [
    `# ${title}`,
    '',
    `- 会话ID：${input.sessionId}`,
    updated ? `- 更新时间：${updated}` : '',
  ].filter(Boolean)

  const body = syncableMessages(input.messages).map(message => {
    const time = displayTime(message.timestamp)
    const label = roleLabel(message.role)
    const timeLine = time ? `时间：${time}\n` : ''
    return `${timeLine}${label}：\n${messageContentText(message).trim()}`
  })

  return [...header, '', ...body].join('\n\n---\n\n')
}
