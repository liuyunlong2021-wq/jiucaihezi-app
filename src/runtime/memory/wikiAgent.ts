import type { WikiActionInput } from '@/runtime/direct/wikiRuntime'

export interface WikiAgentState {
  runId: string
  wikiRoot: string
  requiresMutation: boolean
  evidencePaths: string[]
  retrievalSignatures: string[]
  failedSignatures: string[]
  pendingPlan?: WikiActionInput
  applyResult?: string
  validationResult?: string
}

export function createWikiAgentState(input: Pick<WikiAgentState, 'runId' | 'wikiRoot' | 'requiresMutation'>): WikiAgentState {
  return { ...input, evidencePaths: [], retrievalSignatures: [], failedSignatures: [] }
}

export function recordWikiRetrieval(state: WikiAgentState, signature: string, paths: string[]): boolean {
  if (state.retrievalSignatures.includes(signature)) return false
  state.retrievalSignatures.push(signature)
  const before = state.evidencePaths.length
  state.evidencePaths.push(...paths.filter(path => !state.evidencePaths.includes(path)))
  return state.evidencePaths.length > before
}

export const WIKI_AGENT_POLICY = `
Wiki 是显式激活的外部 Markdown 事实源。
Skill 负责当前任务的方法、格式和质量规则；Wiki Agent 只负责按计划提供事实，并执行经过校验的 Wiki 变更计划。
只读取实际选定的页面，不补造事实；只在 Wiki 根目录内执行合法操作。
`.trim()
