export type CreativeMemoryEventType = 'user' | 'tool_call' | 'tool_result' | 'assistant' | 'turn_finished'

export interface CreativeMemoryEvent {
  sessionId: string
  turnId: string
  type: CreativeMemoryEventType
  at: number
  data: Record<string, unknown>
}

export interface CreativeProjectTextFiles {
  read(path: string): Promise<string | null>
  write(path: string, content: string): Promise<void>
  append?(path: string, content: string): Promise<void>
}

export interface CreativeContextMessage {
  id: string
  role: string
  content: unknown
  files?: Array<{ name: string; content: string }>
  images?: string[]
}

const PRIVATE_FIELDS = /^(?:api.?key|authorization|token|cachePath|inputPath)$/i

export function toCreativeMemorySessionId(sessionId: string): string {
  const value = String(sessionId || '').trim()
  if (!value) return ''
  if (value.startsWith('jcses_')) return value
  return `jcses_${value.replace(/^(?:creative_|sess_)/, '')}`
}

export function creativeMemoryPath(sessionId: string): string {
  const id = toCreativeMemorySessionId(sessionId)
  if (!id) throw new Error('creative memory path requires sessionId')
  return `.raw/sessions/${id}.jsonl`
}

function safeData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeData)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !PRIVATE_FIELDS.test(key))
    .map(([key, item]) => [key, safeData(item)]))
}

export function encodeCreativeMemoryEvent(event: CreativeMemoryEvent): string {
  const sessionId = toCreativeMemorySessionId(event.sessionId)
  if (!sessionId || !event.turnId) throw new Error('creative memory event requires sessionId and turnId')
  if (event.type === 'turn_finished' && !['done', 'failed', 'cancelled'].includes(String(event.data.status))) {
    throw new Error('turn_finished status must be done, failed, or cancelled')
  }
  return `${JSON.stringify({
    v: 1,
    sessionId,
    turnId: event.turnId,
    type: event.type,
    at: event.at,
    data: safeData(event.data),
  })}\n`
}

export async function appendCreativeMemoryEvent(
  files: CreativeProjectTextFiles,
  event: CreativeMemoryEvent,
): Promise<void> {
  const path = creativeMemoryPath(event.sessionId)
  const line = encodeCreativeMemoryEvent(event)
  if (files.append) {
    await files.append(path, line)
    return
  }
  const existing = await files.read(path)
  await files.write(path, `${existing || ''}${line}`)
}

export async function readCreativeProjectMemory(files?: CreativeProjectTextFiles): Promise<{ claude: string | null; hot: string | null }> {
  if (!files) return { claude: null, hot: null }
  const read = async (path: string) => {
    try {
      return await files.read(path)
    } catch {
      return null
    }
  }
  const [claude, hot] = await Promise.all([read('CLAUDE.md'), read('wiki/hot.md')])
  return { claude, hot }
}

export function createCreativeMemoryRecorder(
  files: CreativeProjectTextFiles,
  sessionId: string,
  turnId: string,
) {
  let tail = Promise.resolve()
  const enqueue = (event: Omit<CreativeMemoryEvent, 'sessionId' | 'turnId' | 'at'>) => {
    const next = tail.then(() => appendCreativeMemoryEvent(files, {
      ...event,
      sessionId,
      turnId,
      at: Date.now(),
    }))
    tail = next.catch(() => undefined)
    return next
  }
  return {
    record(type: CreativeMemoryEventType, data: Record<string, unknown>) {
      return enqueue({ type, data })
    },
    finish(status: 'done' | 'failed' | 'cancelled', error?: string) {
      return enqueue({ type: 'turn_finished', data: error ? { status, error } : { status } })
    },
  }
}

function textLength(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (value == null) return 0
  if (Array.isArray(value)) return value.reduce((total, item) => total + textLength(item), 0)
  return String(value).length
}

function estimateTokens(value: unknown): number {
  return Math.ceil(textLength(value) / 4)
}

function hotMemoryPrompt(memory?: { claude?: string | null; hot?: string | null }): string {
  const claude = String(memory?.claude || '').trim()
  const hot = String(memory?.hot || '').trim()
  return [
    claude ? `[项目 CLAUDE.md]\n${claude}` : '',
    hot ? `[项目 wiki/hot.md]\n${hot}` : '',
  ].filter(Boolean).join('\n\n')
}

/**
 * Keeps the current user message and then walks backwards by complete user/assistant turns.
 * Older context is omitted whole; the model never receives a half message.
 */
export function buildCreativeContext(input: {
  messages: CreativeContextMessage[]
  modelId: string
  contextWindow: number
  reservedTokens: number
  projectMemory?: { claude?: string | null; hot?: string | null }
}): { messages: CreativeContextMessage[]; systemPrompt: string; estimatedTokens: number } {
  const systemPrompt = hotMemoryPrompt(input.projectMemory)
  const contextWindow = input.contextWindow || getModelContextWindow(input.modelId)
  const budget = Math.max(0, contextWindow - input.reservedTokens - estimateTokens(systemPrompt))
  const history = input.messages.filter(message => (
    (message.role === 'user' || message.role === 'assistant') && textLength(message.content) > 0
  ))
  if (!history.length) return { messages: [], systemPrompt, estimatedTokens: estimateTokens(systemPrompt) }

  const selected: CreativeContextMessage[] = []
  let used = 0
  let index = history.length - 1
  const latest = history[index]
  const latestTokens = estimateTokens(latest.content)
  selected.unshift(latest)
  used += latestTokens
  index -= 1

  while (index >= 1) {
    const assistant = history[index]
    const user = history[index - 1]
    if (assistant.role !== 'assistant' || user.role !== 'user') break
    const pairTokens = estimateTokens(user.content) + estimateTokens(assistant.content)
    if (used + pairTokens > budget) break
    selected.unshift(user, assistant)
    used += pairTokens
    index -= 2
  }

  return {
    messages: selected,
    systemPrompt,
    estimatedTokens: estimateTokens(systemPrompt) + used,
  }
}
import { getModelContextWindow } from '@/data/modelContextWindows'
