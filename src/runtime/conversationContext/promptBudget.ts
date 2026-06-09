import type {
  ConversationContextTokenPlan,
  ConversationContextTokenSectionBudget,
  ConversationLoadLevel,
} from './types'

export interface AllocateConversationPromptBudgetInput {
  loadLevel: ConversationLoadLevel
  modelContextBudget: number
  currentUserInputTokens: number
  systemSkillToolTokens: number
}

function section(minTokens: number, maxTokens: number, priority: number, required = false): ConversationContextTokenSectionBudget {
  return { minTokens, maxTokens, priority, required }
}

function windowClassForBudget(modelContextBudget: number): ConversationContextTokenPlan['windowClass'] {
  if (modelContextBudget <= 32000) return 'small'
  if (modelContextBudget <= 128000) return 'medium'
  if (modelContextBudget <= 512000) return 'large'
  return 'huge'
}

export function allocateConversationPromptBudget(
  input: AllocateConversationPromptBudgetInput,
): ConversationContextTokenPlan {
  const modelContextBudget = Math.max(4096, input.modelContextBudget || 128000)
  const outputReserveRatio = input.loadLevel === 'heavy' ? 0.25 : 0.2
  const outputReserveTokens = Math.floor(modelContextBudget * outputReserveRatio)
  const availableInputBudget = Math.max(1024, modelContextBudget - outputReserveTokens)
  const windowClass = windowClassForBudget(modelContextBudget)
  const windowMultiplier = windowClass === 'huge' ? 2.2 : windowClass === 'large' ? 1.5 : windowClass === 'small' ? 0.55 : 1
  const oversizedInputRequired = input.currentUserInputTokens > availableInputBudget * 0.55

  const base = {
    light: {
      vault: [1000, 1800],
      recent: [2000, 4000],
      memory: [0, 500],
    },
    standard: {
      vault: [1800, 3000],
      recent: [4000, 8000],
      memory: [1200, 1800],
    },
    heavy: {
      vault: [3000, 5000],
      recent: [6000, 12000],
      memory: [2500, 3500],
    },
  }[input.loadLevel]

  const scale = (value: number) => Math.max(0, Math.floor(value * windowMultiplier))
  const mandatoryChunkTokens = oversizedInputRequired
    ? Math.floor(availableInputBudget * 0.12)
    : 0

  const sections = {
    systemSkillTools: section(input.systemSkillToolTokens, input.systemSkillToolTokens, 100, true),
    currentUserInput: section(
      Math.min(input.currentUserInputTokens, availableInputBudget),
      Math.min(input.currentUserInputTokens, availableInputBudget),
      95,
      true,
    ),
    formalVault: section(scale(base.vault[0]), scale(base.vault[1]), 80),
    recentRawMessages: section(scale(base.recent[0]), scale(base.recent[1]), 70),
    conversationMemory: section(scale(base.memory[0]), scale(base.memory[1]), 60),
    webSearch: section(0, 0, 40),
    mandatoryChunks: section(mandatoryChunkTokens, oversizedInputRequired ? Math.ceil(availableInputBudget * 0.18) : 0, 75),
  }

  const totalPlannedTokens = Object.values(sections)
    .reduce((sum, item) => sum + item.maxTokens, 0) + outputReserveTokens

  return {
    loadLevel: input.loadLevel,
    modelContextBudget,
    windowClass,
    availableInputBudget,
    outputReserveTokens,
    oversizedInputRequired,
    sections,
    totalPlannedTokens: Math.min(totalPlannedTokens, modelContextBudget),
  }
}
