import type { ContinuationState } from './types'

export interface CreateContinuationStateInput {
  runId: string
  parentAssistantMessageId: string
  reusedContextPlanId: string
}

export interface BuildContinuationPromptInput {
  reusedContextPlanId: string
  outputStructureSummary: string
  completedSectionPointers: string[]
  lastDecisionSummary: string
  tailExcerpt: string
  nextInstruction: string
}

export interface PrepareContinuationRecordInput {
  sessionId: string
  runtimeSegmentId: string
  runId: string
  parentAssistantMessageId: string
  parentContent: string
  contextPlanId: string
  now: number
}

export interface PreparedContinuationRecord {
  record: ContinuationState & {
    id: string
    sessionId: string
    runtimeSegmentId: string
    createdAt: number
    updatedAt: number
    metadata: Record<string, unknown>
  }
  prompt: string
}

export function createContinuationState(input: CreateContinuationStateInput): ContinuationState {
  return {
    runId: input.runId,
    parentAssistantMessageId: input.parentAssistantMessageId,
    partIds: [],
    status: 'idle',
    attempts: 0,
    reusedContextPlanId: input.reusedContextPlanId,
    outputStructureSummary: '',
    completedSectionPointers: [],
  }
}

export function extractTailExcerpt(text: string, targetTokens = 1000): string {
  const source = String(text || '')
  const approxChars = Math.max(1, targetTokens * 2)
  return source.slice(-approxChars)
}

export function buildContinuationPrompt(input: BuildContinuationPromptInput): string {
  return [
    '继续上一段 assistant 输出。禁止重新规划整体结构，禁止重复已完成内容。',
    `reusedContextPlanId: ${input.reusedContextPlanId}`,
    '',
    '[输出结构摘要]',
    input.outputStructureSummary,
    '',
    '[已完成段落]',
    input.completedSectionPointers.join('\n') || '暂无',
    '',
    '[上一段关键结论]',
    input.lastDecisionSummary || '暂无',
    '',
    '[上一段输出尾部原文]',
    input.tailExcerpt,
    '',
    '[下一步]',
    input.nextInstruction,
    '',
    '[结构校验]',
    '继续前先确认没有偏离 outputStructureSummary，然后直接续写正文。',
  ].join('\n')
}

export function prepareContinuationRecord(input: PrepareContinuationRecordInput): PreparedContinuationRecord {
  const cleanContent = String(input.parentContent || '').replace(/\n\n⚠️[\s\S]*$/u, '').trim()
  const state = createContinuationState({
    runId: input.runId,
    parentAssistantMessageId: input.parentAssistantMessageId,
    reusedContextPlanId: input.contextPlanId,
  })
  const outputStructureSummary = summarizeOutputStructure(cleanContent)
  const completedSectionPointers = extractCompletedSectionPointers(cleanContent)
  const tailExcerpt = extractTailExcerpt(cleanContent, 1000)
  const lastDecisionSummary = summarizeLastDecision(cleanContent)
  const prompt = buildContinuationPrompt({
    reusedContextPlanId: input.contextPlanId,
    outputStructureSummary,
    completedSectionPointers,
    lastDecisionSummary,
    tailExcerpt,
    nextInstruction: '从上一段输出的中断处继续，保持原有结构、语气、设定和格式。',
  })
  return {
    record: {
      ...state,
      id: `cont_${input.parentAssistantMessageId}_${input.now}`,
      sessionId: input.sessionId,
      runtimeSegmentId: input.runtimeSegmentId,
      status: 'continuing',
      attempts: 1,
      outputStructureSummary,
      completedSectionPointers,
      lastFinishReason: 'length',
      createdAt: input.now,
      updatedAt: input.now,
      metadata: {
        tailExcerptTokenTarget: 1000,
        tailExcerptChars: tailExcerpt.length,
      },
    },
    prompt,
  }
}

function summarizeOutputStructure(text: string): string {
  const headings = text.match(/^#{1,6}\s+.+$/gm) || []
  if (headings.length) return headings.slice(0, 12).join('\n')
  const numbered = text.match(/^\s*(?:\d+\.|[一二三四五六七八九十]+[、.]).+$/gm) || []
  if (numbered.length) return numbered.slice(0, 12).join('\n')
  return '沿用上一段输出已经建立的结构，不重新规划。'
}

function extractCompletedSectionPointers(text: string): string[] {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const structural = lines.filter(line => /^(#{1,6}\s+|\d+\.|[一二三四五六七八九十]+[、.])/.test(line))
  return structural.slice(-8)
}

function summarizeLastDecision(text: string): string {
  const sentences = text
    .split(/[。！？!?]\s*/)
    .map(part => part.trim())
    .filter(Boolean)
  const decision = [...sentences].reverse().find(sentence => /决定|结论|因此|所以|必须|需要|建议|保持|采用/.test(sentence))
  return decision || sentences.at(-1) || ''
}
