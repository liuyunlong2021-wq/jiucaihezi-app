import type { ConnectionSource } from './types'

export interface SuperpowerConnection {
  enabled: boolean
  source: 'configuration-advisor'
  userInput: string
  selectedSkillId?: string
  prompt?: string
  requiresUserConfirmation: true
}

export interface BuildSuperpowerConnectionInput {
  enabled: boolean
  userInput: string
  selectedSkillId?: string
  prompt?: string
}

export function buildSuperpowerConnection(input: BuildSuperpowerConnectionInput): SuperpowerConnection {
  return {
    enabled: input.enabled,
    source: 'configuration-advisor',
    userInput: input.userInput,
    selectedSkillId: input.selectedSkillId,
    prompt: input.prompt,
    requiresUserConfirmation: true,
  }
}

export function resolveRuntimeConnectionSource(input: {
  advisorRequested?: boolean
  selectedSkillId?: string
}): ConnectionSource {
  if (input.selectedSkillId) return 'manual'
  return 'plain'
}
