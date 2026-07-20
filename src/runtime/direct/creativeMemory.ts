export interface CreativeProjectTextFiles {
  read(path: string): Promise<string | null>
}

export interface CreativeContextMessage {
  id: string
  role: string
  content: unknown
  files?: Array<{ name: string; content: string }>
  images?: string[]
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
