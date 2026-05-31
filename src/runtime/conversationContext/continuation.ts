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
