import { getModelContextWindow } from '@/data/modelContextWindows'
import { estimateTokenCount } from 'tokenx'
import type { DirectChatCompletionRequest } from './directEngine'

export interface CreativeContextMessage {
  id: string
  role: string
  content: unknown
  files?: Array<{ name: string; content: string }>
  images?: string[]
  attachments?: Array<{ name: string; readablePath?: string; textContent?: string }>
  finishReason?: string
}

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

  const historyBudget = Math.max(0, budget - latestTokens)
  let historyTokens = 0
  while (index >= 1) {
    const assistant = history[index]
    const user = history[index - 1]
    if (assistant.role !== 'assistant' || user.role !== 'user') break
    const pairTokens = estimateMessageTokens(user) + estimateMessageTokens(assistant)
    if (historyTokens + pairTokens > historyBudget) break
    selected.unshift(user, assistant)
    used += pairTokens
    historyTokens += pairTokens
    index -= 2
  }

  return {
    messages: selected,
    estimatedTokens: used,
    omittedMessages: history.length - selected.length,
  }
}

/** 每次请求（包括工具续轮）检查完整负载；必需正文和当前任务工具结果不做隐式切片。 */
export function fitDirectRequest(request: DirectChatCompletionRequest, contextWindow: number, outputCeiling: number, currentTaskMessage?: DirectChatCompletionRequest['messages'][number]) {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) throw new Error('模型上下文容量无效')
  const safetyTokens = Math.min(2048, Math.max(256, Math.ceil(contextWindow * 0.02)))
  const maxOutputTokens = Math.max(1, Math.min(outputCeiling, Math.floor(contextWindow / 4)))
  const messages = request.messages.map(message => ({ ...message }))
  const firstTool = messages.findIndex(message => message.role === 'assistant' && message.tool_calls?.length)
  let protectedIndex = currentTaskMessage ? request.messages.indexOf(currentTaskMessage) : -1
  if (protectedIndex < 0) {
    for (let i = 0; i < (firstTool < 0 ? messages.length : firstTool); i++) if (messages[i]?.role === 'user') protectedIndex = i
  }
  const estimate = () => estimateTokenCount(JSON.stringify(messages)) + estimateTokenCount(JSON.stringify(request.tools || []))
  const budget = contextWindow - safetyTokens - maxOutputTokens
  let omittedMessages = 0
  // 同内容工具结果只保留一次正文，但调用/结果仍完整配对。
  const seenResults = new Set<string>()
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.role !== 'tool' || typeof message.content !== 'string') continue
    if (seenResults.has(message.content)) message.content = '[重复工具正文已省略，使用本请求中较新的相同工具结果。]'
    else seenResults.add(message.content)
  }
  while (estimate() > budget) {
    const users = messages.flatMap((message, i) => message.role === 'user' && i <= protectedIndex ? [i] : [])
    if (users.length < 2) break
    const start = users[0]!
    const end = users[1]!
    omittedMessages += end - start
    messages.splice(start, end - start)
    protectedIndex -= end - start
  }
  if (estimate() > budget) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'system' && String(messages[i]?.content).startsWith('<retrieved_context>')) {
        messages.splice(i, 1)
        omittedMessages++
      }
    }
  }
  const inputTokens = estimate()
  if (inputTokens > budget) throw new Error('本轮必需原文、规则或工具结果超过模型可用上下文，请缩小处理范围或分段读取；未截断正文，也未发送超限请求。')
  return { messages, inputTokens, maxOutputTokens, safetyTokens, omittedMessages }
}
