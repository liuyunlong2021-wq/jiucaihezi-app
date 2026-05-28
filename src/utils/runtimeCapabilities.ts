import { LOCAL_MLX_PROVIDER_ID, LOCAL_OLLAMA_PROVIDER_ID } from './providerConfig'
import type { ContextAssemblyMode } from './contextAssembly'
import { chooseLlmRuntime, type LlmRuntimeKind } from './llmRuntime'
import type { ProviderCapabilityProbe } from './providerCapabilityProbe'

export type RuntimeCapabilityTier = 'fast' | 'balanced' | 'deep' | 'full-vault'
export type ReasoningEffort = 'low' | 'medium' | 'high'

export interface RuntimeProfileInput {
  modelId: string
  providerId?: string
  requestedTier?: RuntimeCapabilityTier
  preferResponses?: boolean
  providerCapability?: ProviderCapabilityProbe | null
}

export interface RuntimeProfile {
  modelId: string
  providerId: string
  runtime: LlmRuntimeKind
  capabilityTier: RuntimeCapabilityTier
  contextMode: ContextAssemblyMode
  supportsReasoningEffort: boolean
  reasoningEffort?: ReasoningEffort
}

export interface RecallRuntimeBudget {
  maxTotalChars: number
  maxItems: number
  perItemChars: number
}

export interface ReasoningChatExtrasOptions {
  enabled?: boolean
}

export function resolveRuntimeProfile(input: RuntimeProfileInput): RuntimeProfile {
  const modelId = String(input.modelId || '').trim()
  const providerId = String(input.providerId || 'jiucaihezi')
  const requestedTier = input.requestedTier || 'balanced'
  const isLocal = providerId === LOCAL_MLX_PROVIDER_ID || providerId === LOCAL_OLLAMA_PROVIDER_ID
  const supportsReasoningEffort = !isLocal && isReasoningModel(modelId)
  const capabilityTier = isLocal ? 'fast' : requestedTier

  const runtime = chooseLlmRuntime({
    providerId,
    modelId,
    preferResponses: input.preferResponses,
    providerCapability: input.providerCapability,
  })

  return {
    modelId,
    providerId,
    runtime,
    capabilityTier,
    contextMode: capabilityTier,
    supportsReasoningEffort,
    reasoningEffort: supportsReasoningEffort ? effortForTier(capabilityTier) : undefined,
  }
}

export function buildReasoningChatExtras(
  profile: RuntimeProfile,
  options: ReasoningChatExtrasOptions = {},
): Record<string, unknown> {
  if (!options.enabled) return {}
  if (!profile.supportsReasoningEffort || !profile.reasoningEffort) return {}
  return {
    reasoning_effort: profile.reasoningEffort,
    reasoning: { effort: profile.reasoningEffort },
  }
}

export function normalizeRuntimeCapabilityTier(value: unknown): RuntimeCapabilityTier {
  return value === 'fast' || value === 'balanced' || value === 'deep' || value === 'full-vault'
    ? value
    : 'balanced'
}

export function resolveRecallRuntimeBudget(tier: RuntimeCapabilityTier): RecallRuntimeBudget {
  if (tier === 'fast') return { maxTotalChars: 3000, maxItems: 4, perItemChars: 360 }
  if (tier === 'deep') return { maxTotalChars: 12000, maxItems: 12, perItemChars: 700 }
  if (tier === 'full-vault') return { maxTotalChars: 20000, maxItems: 20, perItemChars: 900 }
  return { maxTotalChars: 8000, maxItems: 8, perItemChars: 520 }
}

function isReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return id === 'gpt-5.5' || id.includes('/gpt-5.5') || /^o[134](?:-|$)/.test(id)
}

function effortForTier(tier: RuntimeCapabilityTier): ReasoningEffort {
  if (tier === 'fast') return 'low'
  if (tier === 'deep' || tier === 'full-vault') return 'high'
  return 'medium'
}
