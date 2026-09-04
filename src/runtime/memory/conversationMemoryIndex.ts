import { MEMORY_CONVERSATION_DIRECTORY, MEMORY_INDEX_DIRECTORY } from '@/utils/memoryProjectPaths'
import { createRuntimeProjectFileService, type ProjectFileService } from '@/services/projectFileService'
import { parseConversationTranscript } from './conversationTranscript'

export interface ConversationMemorySummary { summary: string; keywords: string[] }
export interface ConversationMemoryIndexInput { conversationId: string; rawPath: string; assistantTurnId: string; runtime?: 'web' | 'desktop' }
export interface ConversationMemoryIndexEntry extends ConversationMemorySummary { rawPath: string; assistantTurnId: string }
export interface ConversationMemoryQueryMatch { summary: string; keywords: string[]; rawPath: string; assistantTurnId: string; content: string }
export interface ConversationMemoryQueryResult { conversationId: string; matches: ConversationMemoryQueryMatch[] }

const INDEX_MARKER = /<!--\s*jc:conversation-memory-index\s+conversation-id="([^"]+)"\s+source="([^"]+)"\s+version="(\d+)"\s*-->/
const V2_ENTRY_BLOCK = /- 简介：([^\n]*)\n  - 关键词：([^\n]*)\n  - 正链：\[[^\]]*\]\(([^)#]+)#jc-turn-([^\)]+)\)/g
const V1_ENTRY_BLOCK = /- \[([^\]]+)\]\(([^)#]+)#jc-turn-([^\)]+)\)\n  - 简介：([^\n]*)\n  - 关键词：([^\n]*)\n  - 来源：user `[^`]+`，assistant `([^`]+)`/g

export function conversationMemoryIndexPath(conversationId: string): string { return `${MEMORY_INDEX_DIRECTORY}/${safeSegment(conversationId)}.md` }

export function createConversationMemoryIndex(input: ConversationMemoryIndexInput): string {
  return `# 对话记忆索引\n\n<!-- jc:conversation-memory-index conversation-id="${attribute(input.conversationId)}" source="${attribute(relativeRawPath(input.rawPath))}" version="2" -->\n`
}

export function parseConversationMemoryIndex(content: string): { conversationId: string; source: string; version: number; entries: ConversationMemoryIndexEntry[] } | null {
  const marker = String(content || '').match(INDEX_MARKER)
  if (!marker) return null
  const entries: ConversationMemoryIndexEntry[] = []
  for (const match of String(content || '').matchAll(V2_ENTRY_BLOCK)) entries.push({ summary: match[1] || '', keywords: parseKeywords(match[2]), rawPath: resolveRawPath(match[3] || marker[2]), assistantTurnId: decodeURIComponent(match[4] || '') })
  if (!entries.length) for (const match of String(content || '').matchAll(V1_ENTRY_BLOCK)) entries.push({ summary: match[4] || '', keywords: parseKeywords(match[5]), rawPath: resolveRawPath(match[2] || marker[2]), assistantTurnId: decodeURIComponent(match[6] || match[3] || '') })
  return { conversationId: marker[1], source: marker[2], version: Number(marker[3]) || 1, entries }
}

export function upsertConversationMemoryIndex(content: string | undefined, input: ConversationMemoryIndexInput, summary: ConversationMemorySummary): string {
  if (!input.assistantTurnId) throw new Error('assistant turn ID 无效')
  if (!summary.summary.trim()) throw new Error('索引简介不能为空')
  const existing = parseConversationMemoryIndex(content || '')
  const entry: ConversationMemoryIndexEntry = {
    summary: summary.summary.trim().replace(/[\r\n]+/g, ' ').slice(0, 240),
    keywords: [...new Set(summary.keywords.map(keyword => String(keyword).trim().replace(/[\r\n]+/g, ' ')).filter(Boolean))].slice(0, 12),
    rawPath: input.rawPath,
    assistantTurnId: input.assistantTurnId,
  }
  const entries = existing?.conversationId === input.conversationId ? existing.entries : []
  const withoutCurrent = entries.filter(item => item.assistantTurnId !== input.assistantTurnId)
  return `${createConversationMemoryIndex(input).trimEnd()}\n\n${[...withoutCurrent, entry].map(formatConversationMemoryIndexEntry).join('\n\n')}\n`
}

export async function queryConversationMemoryIndex(owner: string, conversationId: string, query: string, files: ProjectFileService = createRuntimeProjectFileService(), limit = 5): Promise<ConversationMemoryQueryResult> {
  const id = safeSegment(conversationId)
  let indexContent: string
  try { indexContent = (await files.readTextAt(owner, conversationMemoryIndexPath(id))).content } catch { return { conversationId: id, matches: [] } }
  const index = parseConversationMemoryIndex(indexContent)
  if (!index || index.conversationId !== id) return { conversationId: id, matches: [] }
  const terms = tokenize(query)
  const candidates = index.entries
    .filter(entry => isValidConversationRawPath(entry.rawPath, id))
    .map(entry => ({ entry, score: terms.reduce((total, term) => total + (`${entry.summary}\n${entry.keywords.join(' ')}`.toLocaleLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter(value => terms.length === 0 || value.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(20, limit)))
  if (!candidates.length) return { conversationId: id, matches: [] }
  const rawTexts = new Map<string, string>()
  for (const { entry } of candidates) {
    if (rawTexts.has(entry.rawPath)) continue
    try { rawTexts.set(entry.rawPath, (await files.readTextAt(owner, entry.rawPath)).content) } catch { rawTexts.set(entry.rawPath, '') }
  }
  const matches = candidates.flatMap(({ entry }) => {
    if (!entry.rawPath.startsWith(`${MEMORY_CONVERSATION_DIRECTORY}/`)) return []
    const raw = rawTexts.get(entry.rawPath)
    const transcript = raw ? parseConversationTranscript(entry.rawPath, raw) : null
    if (!transcript || transcript.id !== id) return []
    const assistant = transcript.turns.find(turn => turn.id === entry.assistantTurnId && turn.role === 'assistant')
    return assistant ? [{ summary: entry.summary, keywords: entry.keywords, rawPath: entry.rawPath, assistantTurnId: assistant.id, content: assistant.content }] : []
  })
  return { conversationId: id, matches }
}

function formatConversationMemoryIndexEntry(entry: ConversationMemoryIndexEntry): string {
  return `- 简介：${entry.summary}\n  - 关键词：${entry.keywords.join('、') || '无'}\n  - 正链：[查看这条回答](${relativeRawPath(entry.rawPath)}#jc-turn-${encodeURIComponent(entry.assistantTurnId)})`
}
function relativeRawPath(rawPath: string): string { const normalized = rawPath.replace(/^\/+/, '').replace(/^\.\//, ''); return normalized.startsWith('.raw/') ? `../${normalized.slice(5)}` : `../${normalized}` }
function resolveRawPath(link: string): string { const normalized = link.replace(/^\/+/, '').replace(/^\.\//, ''); return normalized.startsWith('../') ? `.raw/${normalized.slice(3)}` : normalized }
function parseKeywords(value: string): string[] { return value.split(/[,，、]/).map(item => item.trim()).filter(Boolean) }
function safeSegment(value: string): string {
  const normalized = String(value || '').trim()
  if (!normalized || normalized === '.' || normalized === '..' || normalized.includes('/') || normalized.includes('\\') || normalized.includes('\0')) throw new Error('会话 ID 无效')
  return normalized
}
function isValidConversationRawPath(rawPath: string, conversationId: string): boolean {
  const normalized = String(rawPath || '').replace(/^\.\/+/, '')
  if (!normalized.startsWith(MEMORY_CONVERSATION_DIRECTORY + '/') || normalized.startsWith('/') || normalized.includes('\\')) return false
  return normalized === MEMORY_CONVERSATION_DIRECTORY + '/' + conversationId + '.md'
}
function tokenize(value: string): string[] { return [...new Set(String(value || '').toLocaleLowerCase().split(/[\s,，。；;、|/\\:：!?！？()[\]{}"'`]+/).map(item => item.trim()).filter(Boolean))] }
function attribute(value: string): string { return String(value || '').replace(/["<>]/g, '') }
