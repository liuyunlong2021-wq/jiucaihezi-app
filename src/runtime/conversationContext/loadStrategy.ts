import type { ConversationLoadLevel } from './types'

export interface ResolveConversationLoadStrategyInput {
  messageCount: number
  estimatedSessionTokens: number
  currentUserInputTokens: number
  modelContextBudget: number
  availableInputBudget: number
  userInput: string
  memoryIndexFreshness?: 'fresh' | 'stale' | 'missing'
  lastRunWasDegraded?: boolean
}

export interface ConversationLoadStrategyResult {
  loadLevel: ConversationLoadLevel
  oversizedInput: boolean
  oversizedReason?: 'current_input_over_budget' | 'current_input_dominates_budget'
  historicalLongContext: boolean
  isMemoryIntentQuery: boolean
  memoryIntentConfidence: number
  currentUserInputRatio: number
  sessionTokenRatio: number
}

const MEMORY_INTENT_PATTERNS = [
  /之前/,
  /上次/,
  /继续/,
  /回忆/,
  /总结我们/,
  /刚才决定/,
  /前面说过/,
  /按我们定的/,
  /早期/,
  /第\s*\d+\s*轮/,
]

export function resolveConversationLoadStrategy(
  input: ResolveConversationLoadStrategyInput,
): ConversationLoadStrategyResult {
  const modelContextBudget = Math.max(1, input.modelContextBudget || 1)
  const availableInputBudget = Math.max(1, input.availableInputBudget || Math.floor(modelContextBudget * 0.75))
  const currentUserInputRatio = input.currentUserInputTokens / availableInputBudget
  const sessionTokenRatio = input.estimatedSessionTokens / modelContextBudget
  const isMemoryIntentQuery = MEMORY_INTENT_PATTERNS.some(pattern => pattern.test(input.userInput || ''))
  const memoryIntentConfidence = isMemoryIntentQuery ? 0.85 : 0.1
  const oversizedInput = currentUserInputRatio > 0.55 || input.currentUserInputTokens + 1 > availableInputBudget
  const oversizedReason = oversizedInput
    ? currentUserInputRatio > 0.55
      ? 'current_input_dominates_budget'
      : 'current_input_over_budget'
    : undefined
  const historicalLongContext = sessionTokenRatio > 0.45 || input.messageCount > 80

  let loadLevel: ConversationLoadLevel = 'standard'
  if (oversizedInput || historicalLongContext || input.lastRunWasDegraded) {
    loadLevel = 'heavy'
  } else if (
    input.messageCount < 16
    && sessionTokenRatio < 0.12
    && !isMemoryIntentQuery
    && input.memoryIndexFreshness !== 'missing'
  ) {
    loadLevel = 'light'
  }

  return {
    loadLevel,
    oversizedInput,
    oversizedReason,
    historicalLongContext,
    isMemoryIntentQuery,
    memoryIntentConfidence,
    currentUserInputRatio,
    sessionTokenRatio,
  }
}
