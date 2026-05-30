import type { SkillConfig } from '@/types/skill'
import { createSkillRuntimeSpec } from './agentRuntime'
import {
  buildRunTraceSummary,
  recordRunTrace,
  type RunTrace,
  type RunTraceSummary,
} from './runTrace'
import type { RecallKnowledgeHit } from './vaultRecallTrace'

export interface ChatRunAuditVault {
  id: string
  name: string
}

export interface ChatRunAuditInput {
  runId: string
  timestamp?: number
  model: string
  runtime: RunTrace['runtime']
  agent?: SkillConfig | null
  vault?: ChatRunAuditVault | null
  contextMode?: RunTrace['contextPlan']['mode']
  sections: RunTrace['contextPlan']['sections']
  knowledgeHits: RecallKnowledgeHit[]
  knowledgeSearched?: boolean
  staticKnowledgeInjected?: boolean
  exposedTools?: string[]
  promptPreview: string
}

export function buildChatRunAuditTrace(input: ChatRunAuditInput): RunTrace {
  const selectedSkill = input.agent
    ? (() => {
        const spec = createSkillRuntimeSpec(input.agent)
        return {
          id: spec.id,
          name: spec.name,
          tier: spec.tier,
          hash: spec.contentHash,
        }
      })()
    : undefined

  return {
    runId: input.runId,
    timestamp: input.timestamp || Date.now(),
    model: input.model,
    runtime: input.runtime,
    selectedSkill,
    selectedVault: input.vault ? { id: input.vault.id, name: input.vault.name } : undefined,
    contextPlan: {
      mode: input.contextMode || 'balanced',
      sections: input.sections,
    },
    knowledgeHits: input.knowledgeHits.map(hit => ({
      path: hit.path,
      title: hit.title,
      reason: hit.reason,
      score: hit.score,
    })),
    exposedTools: Array.from(new Set((input.exposedTools || []).map(name => String(name || '').trim()).filter(Boolean))),
    knowledgeSearched: input.knowledgeSearched,
    staticKnowledgeInjected: input.staticKnowledgeInjected,
    promptPreview: 'prompt body redacted before trace construction',
  }
}

export function recordAuditedChatRun(input: ChatRunAuditInput): RunTraceSummary {
  return buildRunTraceSummary(recordRunTrace(buildChatRunAuditTrace(input)))
}
