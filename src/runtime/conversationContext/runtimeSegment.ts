import type { ConversationRuntimeSegmentTrigger } from './types'

export interface RuntimeSegmentDecisionInput {
  reason?: 'new_session' | 'manual_new_phase'
  previousSkillId?: string | null
  nextSkillId?: string | null
  previousPrimaryVaultId?: string | null
  nextPrimaryVaultId?: string | null
  previousToolNames?: string[]
  nextToolNames?: string[]
  criticalToolNames?: string[]
  contextReset?: boolean
  previousModelId?: string
  nextModelId?: string
  previousWebSearchEnabled?: boolean
  nextWebSearchEnabled?: boolean
  previousSecondaryVaultIds?: string[]
  nextSecondaryVaultIds?: string[]
}

export interface RuntimeSegmentDecision {
  create: boolean
  trigger?: ConversationRuntimeSegmentTrigger
  reason: string
}

export function buildToolSignature(toolNames: string[]): string {
  return [...new Set((toolNames || []).map(name => String(name).trim()).filter(Boolean))]
    .sort()
    .join('|')
}

export function shouldCreateRuntimeSegment(input: RuntimeSegmentDecisionInput): RuntimeSegmentDecision {
  if (input.reason === 'new_session') return { create: true, trigger: 'new_session', reason: 'new session' }
  if (input.reason === 'manual_new_phase') return { create: true, trigger: 'manual_new_phase', reason: 'manual new phase' }
  if (input.contextReset) return { create: true, trigger: 'context_reset', reason: 'context reset' }

  if (normalize(input.previousSkillId) !== normalize(input.nextSkillId)) {
    return { create: true, trigger: 'skill_changed', reason: 'primary skill changed' }
  }

  if (normalize(input.previousPrimaryVaultId) !== normalize(input.nextPrimaryVaultId)) {
    return { create: true, trigger: 'primary_vault_changed', reason: 'primary vault changed' }
  }

  const critical = new Set((input.criticalToolNames || []).map(String))
  const prevCriticalSignature = buildToolSignature((input.previousToolNames || []).filter(name => critical.has(name)))
  const nextCriticalSignature = buildToolSignature((input.nextToolNames || []).filter(name => critical.has(name)))
  if (prevCriticalSignature !== nextCriticalSignature) {
    return { create: true, trigger: 'critical_tools_changed', reason: 'critical tool signature changed' }
  }

  return { create: false, reason: 'configuration change does not require runtime segment' }
}

function normalize(value: string | null | undefined): string {
  return String(value || '').trim()
}
