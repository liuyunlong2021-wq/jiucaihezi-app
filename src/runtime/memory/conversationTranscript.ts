import { MEMORY_CONVERSATION_DIRECTORY } from '@/utils/memoryProjectPaths'

export const CONVERSATION_DIRECTORY = MEMORY_CONVERSATION_DIRECTORY

export interface ConversationAttachment {
  id: string
  name: string
  mime: string
  size: number
  kind: 'image' | 'video' | 'audio' | 'file'
  projectPath?: string
  readablePath?: string
  characterCount?: number
}

export interface ConversationTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  attachments?: ConversationAttachment[]
  skillNames?: string[]
}

export interface ConversationTranscript {
  id: string
  title: string
  createdAt: string
  turns: ConversationTurn[]
}

export function conversationDocumentSources(turns: ConversationTurn[]): Array<{ name: string; path: string }> {
  const sources = new Map<string, { name: string; path: string }>()
  for (const turn of turns) {
    if (turn.role !== 'user') continue
    for (const attachment of turn.attachments || []) {
      if (attachment.kind !== 'file' || !attachment.readablePath) continue
      sources.set(attachment.readablePath, { name: attachment.name, path: attachment.readablePath })
    }
  }
  return [...sources.values()]
}

const CONVERSATION_MARKER = /<!--\s*jc:conversation\s+id="([^"]+)"\s+created-at="([^"]+)"\s*-->/
// Keep accepting the removed mode attribute so existing Raw conversations remain readable.
const TURN_BLOCK = /<!--\s*jc:turn\s+id="([^"]+)"\s+role="(user|assistant)"\s+created-at="([^"]+)"(?:\s+mode="(?:quick|memory)")?(?:\s+attachments="([^"]*)")?(?:\s+skills="([^"]*)")?\s*-->\s*\n## (?:用户|助手)\s*\n\n([\s\S]*?)\n<!--\s*\/jc:turn\s*-->/g

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
      content: match[6],
      attachments: parseAttachments(match[4]),
      skillNames: parseSkillNames(match[5]),
    }
    const previous = turns.at(-1)
    // ponytail: normalize the old click+Enter race without rewriting the user's Raw file.
    if (previous && isAccidentalDuplicate(previous, turn)) continue
    turns.push(turn)
  }
  return { id: marker[1], title, createdAt: marker[2], turns }
}

function isAccidentalDuplicate(previous: ConversationTurn, current: ConversationTurn): boolean {
  if (previous.role !== 'user' || current.role !== 'user' || previous.content !== current.content) return false
  const previousAt = Date.parse(previous.createdAt)
  const currentAt = Date.parse(current.createdAt)
  return Number.isFinite(previousAt) && Number.isFinite(currentAt) && currentAt >= previousAt && currentAt - previousAt <= 5000
}

export function appendConversationTurn(content: string, turn: ConversationTurn): string {
  if (!CONVERSATION_MARKER.test(content)) throw new Error('对话 Raw 缺少 jc:conversation 标记')
  if (!turn.id || !turn.content.trim()) throw new Error('对话 turn 不完整')
  const heading = turn.role === 'user' ? '用户' : '助手'
  const block = [
    `<a id="jc-turn-${attribute(turn.id)}"></a>`,
    `<!-- jc:turn id="${attribute(turn.id)}" role="${turn.role}" created-at="${attribute(turn.createdAt)}"${serializeAttachments(turn.attachments)}${serializeSkillNames(turn.skillNames)} -->`,
    `## ${heading}`,
    '',
    turn.content.replace(/\s+$/, ''),
    '<!-- /jc:turn -->',
  ].join('\n')
  return `${content.replace(/\s+$/, '')}\n\n${block}\n`
}

export function replaceConversationTurnAndTruncate(
  content: string,
  turnId: string,
  replacement: ConversationTurn,
  assistant: ConversationTurn,
): string {
  const transcript = parseConversationTranscript(CONVERSATION_DIRECTORY + '/edit.md', content)
  if (!transcript) throw new Error('对话 Raw 缺少有效会话内容')
  const index = transcript.turns.findIndex(turn => turn.id === turnId)
  if (index < 0 || transcript.turns[index]?.role !== 'user') throw new Error('只能编辑用户消息')
  if (replacement.role !== 'user' || assistant.role !== 'assistant') throw new Error('编辑轮次角色不正确')
  let next = createConversationTranscript(transcript.id, transcript.title, transcript.createdAt)
  for (const turn of [...transcript.turns.slice(0, index), replacement, assistant]) next = appendConversationTurn(next, turn)
  return next
}

export function mergeConversationTranscriptContents(path: string, remote: string, local: string): string | null {
  const remoteTranscript = parseConversationTranscript(path, remote)
  const localTranscript = parseConversationTranscript(path, local)
  if (!remoteTranscript || !localTranscript || remoteTranscript.id !== localTranscript.id) return null

  const turns = new Map(remoteTranscript.turns.map(turn => [turn.id, turn]))
  for (const turn of localTranscript.turns) turns.set(turn.id, turn)
  const ordered = [...turns.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  let merged = createConversationTranscript(
    localTranscript.id,
    localTranscript.title === '新对话' ? remoteTranscript.title : localTranscript.title,
    localTranscript.createdAt,
  )
  for (const turn of ordered) merged = appendConversationTurn(merged, turn)
  return merged
}

export function remapConversationAttachmentPaths(
  path: string,
  content: string,
  paths: ReadonlyMap<string, string>,
): string {
  const transcript = parseConversationTranscript(path, content)
  if (!transcript) return content
  let changed = false
  const turns = transcript.turns.map(turn => ({
    ...turn,
    attachments: turn.attachments?.map(attachment => {
      const projectPath = attachment.projectPath && paths.get(attachment.projectPath)
      const readablePath = attachment.readablePath && paths.get(attachment.readablePath)
      if (!projectPath && !readablePath) return attachment
      changed = true
      return {
        ...attachment,
        ...(projectPath ? { projectPath } : {}),
        ...(readablePath ? { readablePath } : {}),
      }
    }),
  }))
  if (!changed) return content
  let remapped = createConversationTranscript(transcript.id, transcript.title, transcript.createdAt)
  for (const turn of turns) remapped = appendConversationTurn(remapped, turn)
  return remapped
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
        ...(validProjectAttachmentPath(item.projectPath) ? { projectPath: item.projectPath } : {}),
        ...(validReadablePath(item.readablePath) ? { readablePath: item.readablePath } : {}),
        ...(Number.isSafeInteger(item.characterCount) && item.characterCount >= 0 ? { characterCount: item.characterCount } : {}),
      })) as ConversationAttachment[]
    return attachments.length ? attachments : undefined
  } catch {
    return undefined
  }
}

function validProjectAttachmentPath(value: unknown): value is string {
  return typeof value === 'string'
    && (value.startsWith('.raw/jc-media/') || value.startsWith('jc-media/') || value.startsWith('jc-materials/'))
    && validSafeRelativePath(value)
}

function validReadablePath(value: unknown): value is string {
  return typeof value === 'string'
    && (value.startsWith('.raw/jc-media/文档/') || value.startsWith('jc-materials/'))
    && /\.(?:md|markdown|txt|csv|tsv|json|ya?ml|xml|html?|srt|vtt|log)$/i.test(value)
    && validSafeRelativePath(value)
}

function validSafeRelativePath(value: string): boolean {
  return !value.startsWith('/')
    && !value.includes('\\')
    && !value.includes('\0')
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

function serializeSkillNames(skillNames?: string[]): string {
  if (!skillNames?.length) return ''
  const names = skillNames.filter(name => String(name || '').trim())
  if (!names.length) return ''
  return ` skills="${attribute(encodeURIComponent(JSON.stringify(names)))}"`
}

function parseSkillNames(value?: string): string[] | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(decodeURIComponent(value))
    if (!Array.isArray(parsed)) return undefined
    const names = parsed.filter(name => typeof name === 'string' && name.trim()).map(name => String(name).trim())
    return names.length ? names : undefined
  } catch {
    return undefined
  }
}
