export const CONVERSATION_DIRECTORY = '.raw/对话记录'

export interface ConversationAttachment {
  id: string
  name: string
  mime: string
  size: number
  kind: 'image' | 'video' | 'audio' | 'file'
  projectPath?: string
}

export type ConversationMode = 'quick' | 'memory'

export interface ConversationTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  mode?: ConversationMode
  attachments?: ConversationAttachment[]
}

export interface ConversationTranscript {
  id: string
  title: string
  createdAt: string
  turns: ConversationTurn[]
}

const CONVERSATION_MARKER = /<!--\s*jc:conversation\s+id="([^"]+)"\s+created-at="([^"]+)"\s*-->/
const TURN_BLOCK = /<!--\s*jc:turn\s+id="([^"]+)"\s+role="(user|assistant)"\s+created-at="([^"]+)"(?:\s+mode="(quick|memory)")?(?:\s+attachments="([^"]*)")?\s*-->\s*\n## (?:用户|助手)\s*\n\n([\s\S]*?)\n<!--\s*\/jc:turn\s*-->/g

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
    const turn: ConversationTurn = {
      id: match[1],
      role: match[2] as ConversationTurn['role'],
      createdAt: match[3],
      mode: match[4] as ConversationMode | undefined,
      content: match[6],
      attachments: parseAttachments(match[5]),
    }
    const previous = turns.at(-1)
    // ponytail: normalize the old click+Enter race without rewriting the user's Raw file.
    if (previous && isAccidentalDuplicate(previous, turn)) continue
    turns.push(turn)
  }
  return { id: marker[1], title, createdAt: marker[2], turns }
}

function isAccidentalDuplicate(previous: ConversationTurn, current: ConversationTurn): boolean {
  if (previous.role !== 'user' || current.role !== 'user' || previous.content !== current.content || previous.mode !== current.mode) return false
  const previousAt = Date.parse(previous.createdAt)
  const currentAt = Date.parse(current.createdAt)
  return Number.isFinite(previousAt) && Number.isFinite(currentAt) && currentAt >= previousAt && currentAt - previousAt <= 5000
}

export function appendConversationTurn(content: string, turn: ConversationTurn): string {
  if (!CONVERSATION_MARKER.test(content)) throw new Error('对话 Raw 缺少 jc:conversation 标记')
  if (!turn.id || !turn.content.trim()) throw new Error('对话 turn 不完整')
  const heading = turn.role === 'user' ? '用户' : '助手'
  const block = [
    `<!-- jc:turn id="${attribute(turn.id)}" role="${turn.role}" created-at="${attribute(turn.createdAt)}"${turn.mode ? ` mode="${turn.mode}"` : ''}${serializeAttachments(turn.attachments)} -->`,
    `## ${heading}`,
    '',
    turn.content.replace(/\s+$/, ''),
    '<!-- /jc:turn -->',
  ].join('\n')
  return `${content.replace(/\s+$/, '')}\n\n${block}\n`
}

function serializeAttachments(attachments?: ConversationAttachment[]): string {
  if (!attachments?.length) return ''
  return ` attachments="${attribute(encodeURIComponent(JSON.stringify(attachments)))}"`
}

function parseAttachments(value?: string): ConversationAttachment[] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(decodeURIComponent(value))
    if (!Array.isArray(parsed)) return undefined
    const attachments = parsed.filter(item => item && typeof item === 'object' && item.id && item.name && item.mime)
      .map(item => ({
        id: String(item.id),
        name: String(item.name),
        mime: String(item.mime),
        size: Number(item.size) || 0,
        kind: ['image', 'video', 'audio', 'file'].includes(item.kind) ? item.kind : 'file',
        ...(validProjectMediaPath(item.projectPath) ? { projectPath: item.projectPath } : {}),
      })) as ConversationAttachment[]
    return attachments.length ? attachments : undefined
  } catch {
    return undefined
  }
}

function validProjectMediaPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.startsWith('jc-media/')
    && !value.split('/').some(part => !part || part === '.' || part === '..')
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
