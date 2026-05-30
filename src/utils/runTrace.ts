export interface RunTrace {
  runId: string
  timestamp: number
  model: string
  runtime: 'chat-completions' | 'responses' | 'local'
  selectedSkill?: {
    id: string
    name: string
    tier: 'L1' | 'L2'
    hash: string
  }
  selectedVault?: {
    id: string
    name: string
  }
  contextPlan: {
    mode: 'fast' | 'balanced' | 'deep' | 'full-vault'
    sections: Array<{ name: string; tokens: number }>
  }
  knowledgeHits: Array<{
    path: string
    title: string
    reason: string
    score: number
  }>
  exposedTools: string[]
  knowledgeSearched?: boolean
  staticKnowledgeInjected?: boolean
  promptPreview: string
}

export interface RunTraceSummary {
  runId: string
  model: string
  runtime: RunTrace['runtime']
  mode: RunTrace['contextPlan']['mode']
  skillLabel: string
  skillHash?: string
  vaultLabel: string
  sectionLabels: string[]
  toolLabels: string[]
  knowledgeLabels: string[]
  knowledgeStatus: string
}

let lastRunTrace: RunTrace | null = null

export function recordRunTrace(trace: RunTrace): RunTrace {
  lastRunTrace = {
    ...trace,
    promptPreview: buildSafePromptPreview(trace),
    knowledgeHits: trace.knowledgeHits.slice(0, 20),
    exposedTools: trace.exposedTools.slice(0, 50),
    contextPlan: {
      ...trace.contextPlan,
      sections: trace.contextPlan.sections.slice(0, 20),
    },
  }
  return lastRunTrace
}

function buildSafePromptPreview(trace: RunTrace): string {
  const sectionSummary = trace.contextPlan.sections
    .slice(0, 20)
    .map(section => `${section.name}:${section.tokens}`)
    .join(', ')
  const skill = trace.selectedSkill
    ? `${trace.selectedSkill.name}:${trace.selectedSkill.hash}`
    : 'none'
  const vault = trace.selectedVault?.name || 'none'
  const tools = trace.exposedTools.length ? trace.exposedTools.join(',') : 'none'
  return `prompt body redacted; skill=${skill}; vault=${vault}; tools=${tools}; sections=${sectionSummary}`
}

export function getLastRunTrace(): RunTrace | null {
  return lastRunTrace
}

export function clearLastRunTrace(): void {
  lastRunTrace = null
}

export function buildRunTraceSummary(trace: RunTrace): RunTraceSummary {
  return {
    runId: trace.runId,
    model: trace.model,
    runtime: trace.runtime,
    mode: trace.contextPlan.mode,
    skillLabel: trace.selectedSkill
      ? `${trace.selectedSkill.name} · ${trace.selectedSkill.tier}`
      : '未选择搭子',
    skillHash: trace.selectedSkill?.hash,
    vaultLabel: trace.selectedVault?.name || '未选择知识库',
    sectionLabels: trace.contextPlan.sections.map(section => (
      `${section.name} ${section.tokens} tokens`
    )),
    toolLabels: trace.exposedTools,
    knowledgeLabels: trace.knowledgeHits.map(hit => (
      `${hit.title} · ${hit.path} · ${hit.reason}`
    )),
    knowledgeStatus: trace.knowledgeHits.length > 0
      ? `命中 ${trace.knowledgeHits.length} 条`
      : trace.knowledgeSearched
        ? trace.staticKnowledgeInjected
          ? '已检索，未命中条目；已注入知识库规则/钉选记忆'
          : '已检索，未命中相关条目'
        : '未检索知识库',
  }
}
