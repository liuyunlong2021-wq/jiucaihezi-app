import {
  buildKnowledgeConnection,
  renderKnowledgeConnectionEvidence,
} from './knowledgeConnection'
import type {
  KnowledgeCitationMode,
  KnowledgeConnection,
  KnowledgeConnectionHit,
  KnowledgeConnectionMode,
} from './types'

export interface KnowledgeRecallResultLike<THit extends KnowledgeConnectionHit = KnowledgeConnectionHit> {
  text: string
  hits: THit[]
  searched: boolean
  staticKnowledgeInjected: boolean
}

export interface ResolveKnowledgeConnectionInput<THit extends KnowledgeConnectionHit = KnowledgeConnectionHit> {
  mode: KnowledgeConnectionMode
  citationMode: KnowledgeCitationMode
  userInput: string
  primaryVaultId?: string
  secondaryVaultIds?: string[]
  skillId?: string
  skillHint?: string
  recallOptions?: Record<string, unknown>
  recallKnowledge: (userInput: string, opts: Record<string, unknown>) => Promise<KnowledgeRecallResultLike<THit>>
}

export interface ResolveKnowledgeConnectionResult<THit extends KnowledgeConnectionHit = KnowledgeConnectionHit> {
  connection: KnowledgeConnection
  evidencePrompt: string
  recall: KnowledgeRecallResultLike<THit>
}

const EMPTY_RECALL: KnowledgeRecallResultLike = {
  text: '',
  hits: [],
  searched: false,
  staticKnowledgeInjected: false,
}

export async function resolveKnowledgeConnection<THit extends KnowledgeConnectionHit = KnowledgeConnectionHit>(
  input: ResolveKnowledgeConnectionInput<THit>,
): Promise<ResolveKnowledgeConnectionResult<THit>> {
  if (input.mode === 'off') {
    const connection = buildKnowledgeConnection({
      mode: 'off',
      citationMode: input.citationMode,
    })
    return { connection, evidencePrompt: '', recall: { ...EMPTY_RECALL, hits: [] as THit[] } }
  }

  const recall = await input.recallKnowledge(input.userInput, {
    ...(input.recallOptions || {}),
    vaultId: input.primaryVaultId,
    skillId: input.skillId,
    skillHint: input.skillHint,
  })

  const connection = buildKnowledgeConnection({
    mode: input.mode,
    citationMode: input.citationMode,
    primaryVaultId: input.primaryVaultId,
    secondaryVaultIds: input.secondaryVaultIds,
    evidenceText: recall.text,
    hits: recall.hits,
  })

  return {
    connection,
    evidencePrompt: renderKnowledgeConnectionEvidence(connection.evidenceText),
    recall,
  }
}
