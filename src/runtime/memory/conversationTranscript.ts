export const CONVERSATION_DIRECTORY = '.raw/对话记录'

export interface ConversationTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export interface ConversationTranscript {
  id: string
  title: string
  createdAt: string
  turns: ConversationTurn[]
}

const CONVERSATION_MARKER = /<!--\s*jc:conversation\s+id="([^"]+)"\s+created-at="([^"]+)"\s*-->/
const TURN_BLOCK = /<!--\s*jc:turn\s+id="([^"]+)"\s+role="(user|assistant)"\s+created-at="([^"]+)"\s*-->\s*\n## (?:用户|助手)\s*\n\n([\s\S]*?)\n<!--\s*\/jc:turn\s*-->/g

export function isConversationPath(path: string): boolean {
  return String(path || '').replace(/^\/+/, '').startsWith(`${CONVERSATION_DIRECTORY}/`)
}

export function createConversationTranscript(id: string, title = '新对话', createdAt = new Date().toISOString()): string {
  return `# ${cleanTitle(title)}\n\n<!-- jc:conversation id="${attribute(id)}" created-at="${attribute(createdAt)}" -->\n`
}

export function parseConversationTranscript(path: string, content: string): ConversationTranscript | null {
  if (!isConversationPath(path)) return null
  const marker = String(content || '').match(CONVERSATION_MARKER)
  if (!marker) return null
  const title = String(content || '').match(/^#\s+(.+)$/m)?.[1]?.trim() || '新对话'
  const turns: ConversationTurn[] = []
  for (const match of String(content || '').matchAll(TURN_BLOCK)) {
    turns.push({ id: match[1], role: match[2] as ConversationTurn['role'], createdAt: match[3], content: match[4] })
  }
  return { id: marker[1], title, createdAt: marker[2], turns }
}

export function appendConversationTurn(content: string, turn: ConversationTurn): string {
  if (!CONVERSATION_MARKER.test(content)) throw new Error('对话 Raw 缺少 jc:conversation 标记')
  if (!turn.id || !turn.content.trim()) throw new Error('对话 turn 不完整')
  const heading = turn.role === 'user' ? '用户' : '助手'
  const block = [
    `<!-- jc:turn id="${attribute(turn.id)}" role="${turn.role}" created-at="${attribute(turn.createdAt)}" -->`,
    `## ${heading}`,
    '',
    turn.content.replace(/\s+$/, ''),
    '<!-- /jc:turn -->',
  ].join('\n')
  return `${content.replace(/\s+$/, '')}\n\n${block}\n`
}

export function renameConversationTranscript(content: string, title: string): string {
  const next = cleanTitle(title)
  return /^#\s+.*$/m.test(content) ? content.replace(/^#\s+.*$/m, `# ${next}`) : `# ${next}\n\n${content}`
}

function cleanTitle(value: string): string {
  const title = String(value || '').replace(/[\r\n]+/g, ' ').trim()
  if (!title) throw new Error('对话标题不能为空')
  return title.slice(0, 80)
}

function attribute(value: string): string {
  return String(value || '').replace(/["<>]/g, '')
}
