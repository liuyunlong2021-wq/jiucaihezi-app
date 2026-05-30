import { buildSuperpowersPrompt } from '@/composables/useSkillRouter'
import type { SkillConfig } from '@/types/skill'
import type { ConnectionSource } from './types'

export interface SuperpowerConnection {
  enabled: boolean
  source: 'superpower'
  userInput: string
  selectedSkillId?: string
  prompt?: string
  autoSelectionAllowed: boolean
}

export interface BuildSuperpowerConnectionInput {
  enabled: boolean
  userInput: string
  selectedSkillId?: string
  prompt?: string
  autoSelectionAllowed?: boolean
}

export function buildSuperpowerConnection(input: BuildSuperpowerConnectionInput): SuperpowerConnection {
  return {
    enabled: input.enabled,
    source: 'superpower',
    userInput: input.userInput,
    selectedSkillId: input.selectedSkillId,
    prompt: input.prompt,
    autoSelectionAllowed: Boolean(input.autoSelectionAllowed),
  }
}

export function resolveRuntimeConnectionSource(input: {
  superpowerEnabled?: boolean
  selectedSkillId?: string
}): ConnectionSource {
  if (input.superpowerEnabled) return 'superpower'
  if (input.selectedSkillId) return 'manual'
  return 'plain'
}

export function buildSuperpowerSystemPrompt(input: {
  allSkills: SkillConfig[]
  activeSkill: SkillConfig | null
}): string {
  return buildSuperpowersPrompt(input.allSkills, input.activeSkill)
}
