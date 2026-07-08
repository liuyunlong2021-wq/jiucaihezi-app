import { diagnoseMessageText } from './textDiagnostics'

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'divider'

export interface MessageDisplayInput {
  id: string
  role: MessageRole
  content: string
  agentName?: string
  toolName?: string
  searchResults?: unknown[]
}

export interface MessageDisplayModel {
  id: string
  role: MessageRole
  layout: 'user-bubble' | 'assistant-prose' | 'assistant-compact' | 'tool-collapsed' | 'hidden-system'
  showMeta: boolean
  metaLabel: string
  metaIcon: string
  showTimestampByDefault: boolean
  contentKind: 'plain' | 'markdown' | 'code-heavy' | 'longform' | 'tool-result'
  hasTextWarning: boolean
  textWarning?: string
  actionsMode: 'hover' | 'always' | 'hidden'
  referenceMode: 'none' | 'collapsed-summary' | 'expanded'
}

function compactLength(content: string): number {
  return content.replace(/\s+/g, '').length
}

function paragraphCount(content: string): number {
  return content.split(/\n\s*\n/).filter(part => part.trim()).length
}

function headingCount(content: string): number {
  return (content.match(/^#{1,6}\s+\S+/gm) || []).length
}

function listItemCount(content: string): number {
  return (content.match(/^\s*(?:[-*+]|\d+\.)\s+\S+/gm) || []).length
}

function isLongform(content: string): boolean {
  const compact = compactLength(content)
  if (compact >= 900) return true
  return compact >= 420 && (
    paragraphCount(content) >= 4
    || headingCount(content) >= 1
    || listItemCount(content) >= 4
  )
}

function isCodeHeavy(content: string): boolean {
  const fencedCode = content.match(/```[\s\S]*?```/g) || []
  if (!fencedCode.length) return false
  const codeChars = fencedCode.reduce((total, block) => total + block.length, 0)
  return codeChars >= 32 && codeChars / Math.max(content.length, 1) >= 0.28
}

function hasMarkdown(content: string): boolean {
  return /^#{1,6}\s+\S+/m.test(content)
    || /^\s*(?:[-*+]|\d+\.)\s+\S+/m.test(content)
    || /```/.test(content)
    || /\[[^\]]+\]\([^)]+\)/.test(content)
    || /\|.+\|/.test(content)
}

function hasReferences(input: MessageDisplayInput): boolean {
  return Boolean(input.searchResults?.length)
}

export function buildMessageDisplayModel(input: MessageDisplayInput): MessageDisplayModel {
  const textDiagnostic = diagnoseMessageText(input.content || '')
  const hasTextWarning = textDiagnostic.severity === 'medium' || textDiagnostic.severity === 'high'

  if (input.role === 'system') {
    return {
      id: input.id,
      role: input.role,
      layout: 'hidden-system',
      showMeta: false,
      metaLabel: '',
      metaIcon: '',
      showTimestampByDefault: false,
      contentKind: 'plain',
      hasTextWarning,
      textWarning: textDiagnostic.userMessage,
      actionsMode: 'hidden',
      referenceMode: 'none',
    }
  }

  if (input.role === 'tool') {
    return {
      id: input.id,
      role: input.role,
      layout: 'tool-collapsed',
      showMeta: true,
      metaLabel: `工具: ${input.toolName || '结果'}`,
      metaIcon: 'build',
      showTimestampByDefault: false,
      contentKind: 'tool-result',
      hasTextWarning,
      textWarning: textDiagnostic.userMessage,
      actionsMode: 'always',
      referenceMode: 'none',
    }
  }

  if (input.role === 'user') {
    return {
      id: input.id,
      role: input.role,
      layout: 'user-bubble',
      showMeta: false,
      metaLabel: '',
      metaIcon: '',
      showTimestampByDefault: false,
      contentKind: 'plain',
      hasTextWarning,
      textWarning: textDiagnostic.userMessage,
      actionsMode: 'always',
      referenceMode: 'none',
    }
  }

  const codeHeavy = isCodeHeavy(input.content)
  const longform = !codeHeavy && isLongform(input.content)
  const contentKind = codeHeavy ? 'code-heavy' : longform ? 'longform' : hasMarkdown(input.content) ? 'markdown' : 'plain'

  return {
    id: input.id,
    role: input.role,
    layout: codeHeavy || longform ? 'assistant-prose' : 'assistant-compact',
    showMeta: true,
    metaLabel: input.agentName || '韭菜盒子',
    metaIcon: 'auto_awesome',
    showTimestampByDefault: false,
    contentKind,
    hasTextWarning,
    textWarning: textDiagnostic.userMessage,
    actionsMode: 'always',
    referenceMode: hasReferences(input) ? 'collapsed-summary' : 'none',
  }
}
