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

function imageTokenReserve(url: string): number {
  // shortcut: 没有通道图像计数接口；按32px块的3倍加余量估算，不代表账单token。未知尺寸预留64K。
  try {
    if (!/^data:image\/[\w.+-]+;base64,/i.test(url)) return 65_536
    const start = url.indexOf(',') + 1
    // 只读头部，不解码整张图；JPEG大段EXIF找不到尺寸时走未知兜底。
    const binary = atob(url.slice(start, start + 65_536))
    const data = new DataView(Uint8Array.from(binary, char => char.charCodeAt(0)).buffer)
    let width = 0
    let height = 0
    if (binary.startsWith('\x89PNG\r\n\x1a\n')) {
      width = data.getUint32(16)
      height = data.getUint32(20)
    } else if (binary.startsWith('GIF87a') || binary.startsWith('GIF89a')) {
      width = data.getUint16(6, true)
      height = data.getUint16(8, true)
    } else if (binary.startsWith('RIFF') && binary.slice(8, 12) === 'WEBP') {
      const kind = binary.slice(12, 16)
      if (kind === 'VP8X') {
        width = 1 + (data.getUint32(24, true) & 0xffffff)
        height = 1 + (data.getUint32(26, true) >>> 8)
      } else if (kind === 'VP8L' && data.getUint8(20) === 0x2f) {
        const bits = data.getUint32(21, true)
        width = (bits & 0x3fff) + 1
        height = ((bits >>> 14) & 0x3fff) + 1
      } else if (kind === 'VP8 ' && binary.slice(23, 26) === '\x9d\x01\x2a') {
        width = data.getUint16(26, true) & 0x3fff
        height = data.getUint16(28, true) & 0x3fff
      }
    } else if (data.getUint16(0) === 0xffd8) {
      let offset = 2
      while (offset + 4 < data.byteLength && data.getUint8(offset) === 0xff) {
        while (data.getUint8(offset + 1) === 0xff) offset++
        const marker = data.getUint8(offset + 1)
        offset += 2
        if (marker === 0xda || marker === 0xd9) break
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
        const length = data.getUint16(offset)
        if (length < 2 || offset + length > data.byteLength) break
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          height = data.getUint16(offset + 3)
          width = data.getUint16(offset + 5)
          break
        }
        offset += length
      }
    }
    if (width > 0 && height > 0 && width <= 65_535 && height <= 65_535) {
      return Math.max(4096, Math.ceil(width / 32) * Math.ceil(height / 32) * 3 + 1024)
    }
  } catch { /* 损坏/未知头部仍保留图像预算，不影响原始附件发送。 */ }
  return 65_536
}

function estimateTokens(value: unknown): number {
  if (typeof value === 'string') return estimateTokenCount(value)
  if (value == null) return 0
  let imageTokens = 0
  const text = JSON.stringify(value, (_key, part) => {
    if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
      imageTokens += imageTokenReserve(part.image_url.url)
      return { ...part, image_url: { ...part.image_url, url: '[图像数据，单独预留视觉token]' } }
    }
    return part
  })
  return estimateTokenCount(text) + imageTokens
}

function estimateMessageTokens(message: CreativeContextMessage): number {
  return estimateTokens({
    content: message.content,
    files: message.files,
    images: message.images?.map(url => ({ type: 'image_url', image_url: { url } })),
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
  const estimate = () => estimateTokens(messages) + estimateTokenCount(JSON.stringify(request.tools || []))
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
  if (inputTokens > budget) throw new Error(`本轮必需原文、规则或工具结果超过模型可用上下文，请缩小处理范围或分段读取；未截断正文，也未发送超限请求。（预估输入 ${inputTokens}，输入预算 ${budget}，总容量 ${contextWindow} token）`)
  return { messages, inputTokens, maxOutputTokens, safetyTokens, omittedMessages }
}
