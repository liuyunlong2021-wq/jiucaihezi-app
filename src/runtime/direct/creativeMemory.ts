import { getModelContextWindow } from '@/data/modelContextWindows'
import { estimateTokenCount } from 'tokenx'

export interface CreativeContextMessage {
  id: string
  role: string
  content: unknown
  files?: Array<{ name: string; content: string }>
  images?: string[]
  attachments?: Array<{ name: string; readablePath?: string; textContent?: string }>
  finishReason?: string
}

const MAX_HISTORY_ROUNDS = 3
const MAX_HISTORY_TOKENS = 24_000

const FAILED_ASSISTANT_FINISH_REASONS = new Set([
  'network_error',
  'http_error',
  'web_cloud_error',
  'web_cloud_http_error',
  'web_cloud_login_required',
  'abort',
  'content_filter',
])

function estimateTokens(value: unknown): number {
  if (typeof value === 'string') return estimateTokenCount(value)
  if (value == null) return 0
  return estimateTokenCount(JSON.stringify(value))
}

function estimateMessageTokens(message: CreativeContextMessage): number {
  return estimateTokens({
    content: message.content,
    files: message.files,
    images: message.images,
    attachments: message.attachments,
  })
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
}): { messages: CreativeContextMessage[]; estimatedTokens: number; omittedMessages: number } {
  const contextWindow = input.contextWindow || getModelContextWindow(input.modelId)
  const budget = Math.max(0, contextWindow - input.reservedTokens)
  const history: CreativeContextMessage[] = []
  for (const message of input.messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    if (message.role === 'assistant' && FAILED_ASSISTANT_FINISH_REASONS.has(message.finishReason || '')) {
      if (history.at(-1)?.role === 'user') history.pop()
      continue
    }
    if (estimateMessageTokens(message) > 0) history.push(message)
  }
  if (!history.length) return { messages: [], estimatedTokens: 0, omittedMessages: 0 }

  const selected: CreativeContextMessage[] = []
  let used = 0
  let index = history.length - 1
  const latest = history[index]
  const latestTokens = estimateMessageTokens(latest)
  selected.unshift(latest)
  used += latestTokens
  index -= 1

  const historyBudget = Math.min(MAX_HISTORY_TOKENS, Math.max(0, budget - latestTokens))
  let historyTokens = 0
  let historyRounds = 0
  while (index >= 1 && historyRounds < MAX_HISTORY_ROUNDS) {
    const assistant = history[index]
    const user = history[index - 1]
    if (assistant.role !== 'assistant' || user.role !== 'user') break
    const pairTokens = estimateMessageTokens(user) + estimateMessageTokens(assistant)
    if (historyTokens + pairTokens > historyBudget) break
    selected.unshift(user, assistant)
    used += pairTokens
    historyTokens += pairTokens
    historyRounds += 1
    index -= 2
  }

  return {
    messages: selected,
    estimatedTokens: used,
    omittedMessages: history.length - selected.length,
  }
}
