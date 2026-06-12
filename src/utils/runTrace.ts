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
  contextPlan: {
    mode: 'fast' | 'balanced' | 'deep'
    sections: Array<{ name: string; tokens: number }>
  }
  exposedTools: string[]
  contextBoundary?: {
    messageId: string
    clearedAt: number
    omittedBeforeBoundaryCount: number
  }
  promptPreview: string
}

export interface RunTraceSummary {
  runId: string
  model: string
  runtime: RunTrace['runtime']
  mode: RunTrace['contextPlan']['mode']
  skillLabel: string
  skillHash?: string
  sectionLabels: string[]
  toolLabels: string[]
}

let lastRunTrace: RunTrace | null = null

export function recordRunTrace(trace: RunTrace): RunTrace {
  lastRunTrace = {
    ...trace,
    promptPreview: buildSafePromptPreview(trace),
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
  const tools = trace.exposedTools.length ? trace.exposedTools.join(',') : 'none'
  return `prompt body redacted; skill=${skill}; tools=${tools}; sections=${sectionSummary}`
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
      : '未选择Skill',
    skillHash: trace.selectedSkill?.hash,
    sectionLabels: trace.contextPlan.sections.map(section => (
      `${section.name} ${section.tokens} tokens`
    )),
    toolLabels: trace.exposedTools,
  }
}
