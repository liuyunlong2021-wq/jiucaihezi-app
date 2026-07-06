import { approximateTokenSize } from 'tokenx'
import type { ConversationLoadLevel, ConversationMessageChunk, OversizedInputPlan } from './types'

export interface ChunkConversationTextInput {
  sessionId: string
  messageId: string
  role: ConversationMessageChunk['role']
  text: string
  targetTokens?: number
  maxTokens?: number
  overlapTokens?: number
  now: number
}

export interface BuildOversizedInputPlanInput extends ChunkConversationTextInput {
  availableInputBudget: number
  loadLevel: ConversationLoadLevel
  recentTurnSummaries?: string[]
  anchorSummaries?: string[]
}

interface LogicalBlock {
  text: string
  startOffset: number
  endOffset: number
}

export function chunkConversationText(input: ChunkConversationTextInput): ConversationMessageChunk[] {
  const text = String(input.text || '')
  if (!text) return []
  const targetTokens = input.targetTokens || 1200
  const maxTokens = input.maxTokens || 1600
  const overlapTokens = input.overlapTokens || 200
  const blocks = splitLogicalBlocks(text)
  const chunks: LogicalBlock[] = []
  let current: LogicalBlock | null = null

  for (const block of blocks) {
    const candidateText: string = current ? `${current.text}\n\n${block.text}` : block.text
    const candidateTokens = approximateTokenSize(candidateText)
    if (!current) {
      current = block
      continue
    }
    if (candidateTokens <= targetTokens || approximateTokenSize(current.text) < 450) {
      current = {
        text: candidateText,
        startOffset: current.startOffset,
        endOffset: block.endOffset,
      }
      continue
    }
    chunks.push(...splitOversizedBlock(current, maxTokens))
    current = block
  }
  if (current) chunks.push(...splitOversizedBlock(current, maxTokens))

  const overlappedChunks = applyChunkOverlap(chunks, text, overlapTokens)

  return overlappedChunks.map((chunk, index) => ({
    id: `${input.messageId}_chunk_${index}`,
    sessionId: input.sessionId,
    messageId: input.messageId,
    parentMessageId: input.messageId,
    role: input.role,
    chunkIndex: index,
    text: chunk.text,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    tokenCount: approximateTokenSize(chunk.text),
    semanticTitle: buildSemanticTitle(input.messageId, index, chunk.text),
    semanticSummary: '',
    contentKind: detectContentKind(chunk.text),
    createdAt: input.now,
    metadata: {
      overlapTokens,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
    },
  }))
}

function applyChunkOverlap(chunks: LogicalBlock[], source: string, overlapTokens: number): LogicalBlock[] {
  if (chunks.length <= 1 || overlapTokens <= 0) return chunks
  const overlapChars = Math.max(1, overlapTokens * 2)
  return chunks.map((chunk, index) => {
    if (index === 0) return chunk
    const previous = chunks[index - 1]
    const startOffset = Math.max(previous.startOffset, chunk.startOffset - overlapChars)
    return {
      text: source.slice(startOffset, chunk.endOffset).trim(),
      startOffset: startOffset + (source.slice(startOffset, chunk.endOffset).length - source.slice(startOffset, chunk.endOffset).trimStart().length),
      endOffset: chunk.endOffset,
    }
  })
}

export function buildOversizedInputPlan(input: BuildOversizedInputPlanInput): OversizedInputPlan {
  const chunks = chunkConversationText(input)
  const chunkIds = chunks.map(chunk => chunk.id)
  const mandatoryBudget = Math.max(1, Math.floor(input.availableInputBudget * 0.12))
  const mandatoryChunkIds: string[] = []
  let mandatoryTokens = 0
  for (const chunk of chunks) {
    if (mandatoryTokens >= mandatoryBudget && mandatoryChunkIds.length > 0) break
    mandatoryChunkIds.push(chunk.id)
    mandatoryTokens += chunk.tokenCount
  }
  const selectedChunkIds = chunks
    .filter(chunk => !mandatoryChunkIds.includes(chunk.id))
    .slice(0, input.loadLevel === 'heavy' ? 4 : 2)
    .map(chunk => chunk.id)
  const used = new Set([...mandatoryChunkIds, ...selectedChunkIds])
  const omittedChunkIds = chunkIds.filter(id => !used.has(id))
  const sourcePointers = [...mandatoryChunkIds, ...selectedChunkIds].map(chunkId => ({
    chunkId,
    reason: mandatoryChunkIds.includes(chunkId) ? 'mandatory source chunk' : 'selected source chunk',
  }))

  return {
    enabled: chunks.length > 0,
    messageId: input.messageId,
    chunkIds,
    chunks,
    brief: {
      task: buildTaskBrief(input.text),
      constraints: extractConstraintHints(input.text),
      entities: extractEntityHints(input.text),
      sourcePointers,
    },
    briefLayers: {
      currentTurnDetailed: `当前任务：${buildTaskBrief(input.text)}`,
      recentTurnsCompressed: (input.recentTurnSummaries || []).join('\n') || '近期轮次暂无可用摘要。',
      anchorSummary: (input.anchorSummaries || []).join('\n') || '暂无已确认锚点。',
    },
    selectedChunkIds,
    mandatoryChunkIds,
    omittedChunkIds,
    reason: 'current_input_dominates_budget',
  }
}

function splitLogicalBlocks(text: string): LogicalBlock[] {
  const lines = text.split(/\n/)
  const blocks: LogicalBlock[] = []
  let cursor = 0
  let current = ''
  let currentStart = 0
  let inFence = false

  const flush = (endOffset: number) => {
    const trimmed = current.trim()
    if (trimmed) {
      const leading = current.length - current.trimStart().length
      blocks.push({
        text: trimmed,
        startOffset: currentStart + leading,
        endOffset,
      })
    }
    current = ''
  }

  for (const line of lines) {
    const lineStart = cursor
    const lineWithBreak = line + '\n'
    cursor += lineWithBreak.length
    const isFence = line.trim().startsWith('```')
    const isHeading = /^#{1,6}\s+/.test(line)
    const isBlank = !line.trim()
    if (!current) currentStart = lineStart
    if ((isHeading || isBlank) && current.trim() && !inFence) {
      flush(lineStart)
      if (!isBlank) {
        currentStart = lineStart
        current = lineWithBreak
      }
    } else {
      current += lineWithBreak
    }
    if (isFence) inFence = !inFence
  }
  flush(text.length)
  return blocks.length ? blocks : [{ text, startOffset: 0, endOffset: text.length }]
}

/**
 * 在中日韩标点（。！？）或双换行之后分割文本。
 * 分隔符保留在前一段末尾，行为等价于 split(/(?<=。|！|？|\n\n)/)。
 * 不使用 lookbehind，兼容 macOS Monterey WKWebView。
 */
function splitOnDelimiters(text: string): string[] {
  const result: string[] = []
  let lastIndex = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '。' || ch === '！' || ch === '？') {
      result.push(text.slice(lastIndex, i + 1))
      lastIndex = i + 1
    } else if (ch === '\n' && i + 1 < text.length && text[i + 1] === '\n') {
      result.push(text.slice(lastIndex, i + 2))
      lastIndex = i + 2
      i++ // skip the second \n of the pair
    }
  }
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex))
  }
  return result.length > 0 ? result : [text]
}

function splitOversizedBlock(block: LogicalBlock, maxTokens: number): LogicalBlock[] {
  if (approximateTokenSize(block.text) <= maxTokens) return [block]
  const paragraphs = splitOnDelimiters(block.text)
  const result: LogicalBlock[] = []
  let current = ''
  let offset = block.startOffset
  let currentStart = block.startOffset
  for (const part of paragraphs) {
    const next = current + part
    if (current && approximateTokenSize(next) > maxTokens) {
      result.push({ text: current.trim(), startOffset: currentStart, endOffset: offset })
      currentStart = offset
      current = part
    } else {
      current = next
    }
    offset += part.length
  }
  if (current.trim()) result.push({ text: current.trim(), startOffset: currentStart, endOffset: block.endOffset })
  return result
}

function buildSemanticTitle(messageId: string, chunkIndex: number, text: string): string {
  const heading = text.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading.slice(0, 30)
  const first = text.replace(/[`*_>#\-\[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30)
  return first || `${messageId}#${chunkIndex}`
}

function detectContentKind(text: string): ConversationMessageChunk['contentKind'] {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  if (/```/.test(text)) return 'code'
  if (/^#{1,6}\s+/m.test(text)) return 'markdown'
  if (/^\d{4}-\d{2}-\d{2}/m.test(text)) return 'log'
  return 'plain'
}

function buildTaskBrief(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240) || '处理当前超长输入。'
}

function extractConstraintHints(text: string): string[] {
  const hints = ['保留原始 chunk 作为事实源']
  if (/格式|模板|输出/.test(text)) hints.push('遵守用户指定输出格式')
  if (/风格|语气|口吻/.test(text)) hints.push('保留用户指定风格/语气')
  return hints
}

function extractEntityHints(text: string): string[] {
  const matches = text.match(/[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fa5]{2,8}/g) || []
  return [...new Set(matches)].slice(0, 20)
}
