/**
 * parseMentions — 从文本中解析 @[nodeId] 引用
 * 移植自 huobao-canvas hooks/useNodeRef
 */
export interface ParsedMention {
  nodeId: string
  order: number
}

export function parseMentions(text: string): ParsedMention[] {
  if (!text) return []
  const mentions: ParsedMention[] = []
  const regex = /@\[([^\]|]+)(?:\|([^\]]+))?\]/g
  let match: RegExpExecArray | null
  let order = 0
  while ((match = regex.exec(text)) !== null) {
    mentions.push({ nodeId: match[1], order: ++order })
  }
  return mentions
}

export function removeMention(text: string, nodeId: string): string {
  const regex = new RegExp(`@\\[${nodeId}\\](?:\\|[^\\]]+)?`, 'g')
  return text.replace(regex, '').replace(/\s+/g, ' ').trim()
}
