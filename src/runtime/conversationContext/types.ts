import type { ChatMessage } from '@/composables/useChat'

export type ConversationLoadLevel = 'light' | 'standard' | 'heavy'
export type ConversationCostMode = 'off' | 'light' | 'standard' | 'heavy'
export type ConversationMemoryKind = 'fact' | 'decision' | 'preference' | 'open_thread' | 'artifact' | 'summary'
export type ConversationMemoryLayer = 'turn' | 'segment' | 'session' | 'anchor'
export type ConversationRuntimeSegmentTrigger =
  | 'new_session'
  | 'migration_baseline'
  | 'skill_changed'
  | 'primary_vault_changed'
  | 'context_reset'
  | 'critical_tools_changed'
  | 'manual_new_phase'

export interface BuildConversationContextInput {
  userId: string
  sessionId: string
  userInput: string
  currentMessages: ChatMessage[]
  selectedSkillId?: string
  primaryVaultId?: string | null
  secondaryVaultIds?: string[]
  enabledToolNames: string[]
  modelId: string
  providerId?: string
  contextBudget: number
  contextMode: string
  suppressMemoryRecall?: boolean
  now: number
}

export interface ConversationContextResult {
  runtimeSegmentId: string
  loadLevel: ConversationLoadLevel
  oversizedInput?: OversizedInputPlan
  continuation?: ContinuationState
  evidencePrompt: string
  recentMessages: ChatMessage[]
  memoryHits: ConversationMemoryHit[]
  historicalChunks?: ConversationMessageChunk[]
  tokenPlan: ConversationContextTokenPlan
  trace: ConversationContextTrace
  degradation?: ConversationContextDegradation
}

export interface ConversationContextDegradation {
  reason: 'memory_index_timeout' | 'memory_index_error' | 'storage_unavailable' | 'disabled'
  omittedSections: string[]
  message?: string
}

export interface ConversationMemoryHit {
  id: string
  text: string
  score: number
  kind: ConversationMemoryKind
  layer: ConversationMemoryLayer
  recallReason: string
  sourceMessageIds: string[]
  sessionId: string
  runtimeSegmentId: string
  skillId?: string
  vaultId?: string
  createdAt: number
  lastUsedAt?: number
}

export interface ConversationMessageChunk {
  id: string
  sessionId: string
  messageId: string
  parentMessageId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  chunkIndex: number
  text: string
  startOffset: number
  endOffset: number
  tokenCount: number
  semanticTitle: string
  semanticSummary?: string
  contentKind: 'markdown' | 'plain' | 'json' | 'code' | 'log'
  createdAt: number
  metadata: Record<string, unknown>
}

export interface OversizedInputPlan {
  enabled: boolean
  messageId: string
  chunkIds: string[]
  chunks?: ConversationMessageChunk[]
  brief: {
    task: string
    constraints: string[]
    entities: string[]
    sourcePointers: Array<{ chunkId: string; reason: string }>
  }
  briefLayers: {
    currentTurnDetailed: string
    recentTurnsCompressed: string
    anchorSummary: string
  }
  selectedChunkIds: string[]
  mandatoryChunkIds: string[]
  omittedChunkIds: string[]
  reason: 'current_input_over_budget' | 'current_input_dominates_budget'
}

export interface ContinuationState {
  runId: string
  parentAssistantMessageId: string
  partIds: string[]
  status: 'idle' | 'continuing' | 'completed' | 'failed'
  attempts: number
  reusedContextPlanId: string
  outputStructureSummary: string
  completedSectionPointers: string[]
  lastFinishReason?: string
}

export interface RuntimeSegmentRecord {
  id: string
  sessionId: string
  trigger: ConversationRuntimeSegmentTrigger
  label?: string
  skillId?: string
  primaryVaultId?: string | null
  toolSignature?: string
  createdAt: number
  closedAt?: number
  metadata: Record<string, unknown>
}

export interface ConversationRunSnapshotRecord {
  id: string
  sessionId: string
  runtimeSegmentId: string
  userMessageId: string
  assistantMessageId?: string
  skillId?: string
  primaryVaultId?: string | null
  enabledToolNames: string[]
  modelId: string
  providerId?: string
  contextMode: string
  loadLevel: ConversationLoadLevel
  promptPlan: Record<string, unknown>
  createdAt: number
}

export interface ConversationMemoryItemRecord extends ConversationMemoryHit {
  tokenCount: number
  updatedAt: number
  indexDriver: string
  externalId?: string
  idempotencyKey: string
  syncStatus: 'local_committed' | 'synced' | 'local_only' | 'delete_pending' | 'archived'
  metadata: Record<string, unknown>
}

export interface ConversationMemoryIndexJob {
  id: string
  sessionId: string
  runtimeSegmentId: string
  runId: string
  sourceMessageIds: string[]
  status: 'pending' | 'running' | 'done' | 'failed' | 'repair_required'
  attempts: number
  nextRunAt: number
  lastError?: string
  idempotencyKey: string
  createdAt: number
  updatedAt: number
}

export interface ConversationRebuildJobRecord {
  id: string
  sessionId: string
  runtimeSegmentId?: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'paused'
  priority: number
  cursor?: string
  processedChunks: number
  totalChunks: number
  attempts: number
  lastError?: string
  createdAt: number
  updatedAt: number
}

export interface ConversationDirtySegmentRecord {
  id: string
  sessionId: string
  runtimeSegmentId: string
  reason: 'index_failed' | 'compaction_failed' | 'backfill_incomplete' | 'message_changed' | 'external_index_drift'
  severity: 'low' | 'medium' | 'high' | 'critical'
  estimatedTokenImpact: number
  dirtySince: number
  priority: number
  status: 'pending' | 'running' | 'done' | 'failed'
  metadata: Record<string, unknown>
}

export interface ConversationContextTokenSectionBudget {
  minTokens: number
  maxTokens: number
  priority: number
  required?: boolean
}

export interface ConversationContextTokenPlan {
  loadLevel: ConversationLoadLevel
  modelContextBudget: number
  windowClass: 'small' | 'medium' | 'large' | 'huge'
  availableInputBudget: number
  outputReserveTokens: number
  oversizedInputRequired: boolean
  sections: {
    systemSkillTools: ConversationContextTokenSectionBudget
    currentUserInput: ConversationContextTokenSectionBudget
    formalVault: ConversationContextTokenSectionBudget
    recentRawMessages: ConversationContextTokenSectionBudget
    conversationMemory: ConversationContextTokenSectionBudget
    webSearch: ConversationContextTokenSectionBudget
    mandatoryChunks: ConversationContextTokenSectionBudget
  }
  totalPlannedTokens: number
}

export interface ConversationContextTrace {
  sessionId: string
  runtimeSegmentId: string
  loadLevel: ConversationLoadLevel
  selectedSources: Array<{
    section: 'knowledge' | 'recent-messages' | 'conversation-memory' | 'historical-chunks' | 'web-search'
    ids: string[]
    tokens: number
    reason: string
  }>
  chunkRetrieval: {
    mandatoryChunkCount: number
    selectedChunkCount: number
    omittedChunkCount: number
    mandatoryChunkTokens: number
    selectedChunkTokens: number
    historicalChunkCount?: number
    historicalChunkTokens?: number
    reasons: Array<{ chunkId: string; reason: string }>
  }
  compaction: {
    triggered: boolean
    reason?: string
    turnLayerCount: number
    segmentLayerCount: number
    sessionAnchorCount: number
  }
  anchorHitCount: number
  earlySegmentRecallRatio: number
  costMode: ConversationCostMode
  rejectedSources: Array<{
    section: string
    ids: string[]
    reason: 'over_budget' | 'low_score' | 'wrong_segment' | 'missing_provenance' | 'index_degraded'
  }>
  budget: ConversationContextTokenPlan
  degradation?: ConversationContextDegradation
}
