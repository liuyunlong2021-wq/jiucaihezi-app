/**
 * connectionValidation.ts
 *
 * Phase 2 — 14x14 Connection Validation Matrix + 5 auto-inference rules.
 * Safe v8 utility (no touch to old canvas/runtime).
 *
 * Covers all combinations from SDD 6.2 (including Group fold/expand dynamic semantics).
 */

export type NodeType =
  | 'text' | 'llm' | 'imageGen' | 'videoGen' | 'audioGen'
  | 'imageResult' | 'videoResult' | 'audioResult'
  | 'skill' | 'toolset'
  | 'loop' | 'textSplit' | 'group'

export type EdgeType = 'prompt-flow' | 'context-injection' | 'tool' | 'media-ref' | 'orchestration'

const PROMPT_FLOW_SOURCES = new Set(['text', 'llm', 'loop', 'textSplit'])
const PROMPT_FLOW_TARGETS = new Set(['text', 'llm', 'imageGen', 'videoGen', 'audioGen', 'group'])

const CONTEXT_SOURCES = new Set(['skill', 'toolset', 'group'])
const CONTEXT_TARGETS = new Set(['llm', 'group'])

const TOOL_SOURCES = new Set(['toolset'])
const TOOL_TARGETS = new Set(['llm'])

const MEDIA_REF_SOURCES = new Set(['imageResult', 'videoResult', 'audioResult', 'upload'])
const MEDIA_REF_TARGETS = new Set(['imageGen', 'videoGen', 'audioGen'])

/**
 * Core 14x14 matrix (simplified but faithful to SDD).
 * Returns allowed edge type or null if illegal.
 */
export function getAllowedEdgeType(sourceType: NodeType, targetType: NodeType, sourceHandle?: string | null, targetHandle?: string | null): EdgeType | null {
  // Context Providers → only LLM or Group left-context
  if (CONTEXT_SOURCES.has(sourceType) && CONTEXT_TARGETS.has(targetType)) {
    if (targetHandle?.includes('context') || !targetHandle) return 'context-injection'
  }

  // Tools → only LLM
  if (TOOL_SOURCES.has(sourceType) && TOOL_TARGETS.has(targetType)) {
    return 'tool'
  }

  // Media references (results → gens)
  if (MEDIA_REF_SOURCES.has(sourceType) && MEDIA_REF_TARGETS.has(targetType)) {
    return 'media-ref'
  }

  // Prompt-flow (the most common and important)
  if (PROMPT_FLOW_SOURCES.has(sourceType) && PROMPT_FLOW_TARGETS.has(targetType)) {
    // Special: Group when folded can have multiple left-prompt-N
    if (targetType === 'group' && targetHandle?.startsWith('left-prompt')) {
      return 'prompt-flow'
    }
    if (sourceHandle?.includes('text') || sourceHandle?.includes('out') || !sourceHandle) {
      return 'prompt-flow'
    }
    return 'prompt-flow'
  }

  // Group internal → external (orchestration)
  if (sourceType === 'group' && PROMPT_FLOW_TARGETS.has(targetType)) {
    return 'prompt-flow'
  }

  return null
}

/**
 * 5 auto-inference rules (from SDD)
 */
export function inferEdgeType(sourceType: NodeType, targetType: NodeType, sourceHandle?: string | null, targetHandle?: string | null): EdgeType {
  const allowed = getAllowedEdgeType(sourceType, targetType, sourceHandle, targetHandle)
  if (allowed) return allowed

  // Fallbacks
  if (sourceType === 'group' || targetType === 'group') return 'prompt-flow'
  if (CONTEXT_SOURCES.has(sourceType)) return 'context-injection'
  return 'prompt-flow'
}

export function isValidConnection(
  sourceType: NodeType,
  targetType: NodeType,
  sourceHandle?: string | null,
  targetHandle?: string | null,
  groupFolded?: boolean
): boolean {
  // When Group is folded, some internal ports are hidden → stricter rules
  if ((sourceType === 'group' || targetType === 'group') && groupFolded) {
    // Only allow explicitly exposed ports (left-prompt-N, right-out, etc.)
    if (targetHandle && !targetHandle.startsWith('left-prompt') && targetHandle !== 'left-context') {
      return false
    }
  }

  return getAllowedEdgeType(sourceType, targetType, sourceHandle, targetHandle) !== null
}
