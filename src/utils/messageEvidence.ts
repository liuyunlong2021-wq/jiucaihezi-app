import type { RecallKnowledgeHit } from './vaultRecallTrace'

export type MessageEvidenceRole = 'user' | 'assistant' | 'system' | 'tool'

export function shouldShowKnowledgeReferences(
  role: MessageEvidenceRole,
  knowledgeHits: RecallKnowledgeHit[] | undefined,
): boolean {
  return role === 'assistant' && Array.isArray(knowledgeHits) && knowledgeHits.length > 0
}
