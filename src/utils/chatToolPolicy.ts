export interface ToolPolicyInput {
  agentId?: string | null
  systemPrompt?: string
  localToolsEnabled?: boolean
}

export type ToolExecutorMode = 'disabled' | 'default' | 'agent'
export type ToolRiskLike = 'safe' | 'write' | 'approval'
export type ToolSourceLike = 'cloud' | 'local'

export interface ToolNameLike {
  function: {
    name: string
  }
}

function hasConcreteAgent(input: ToolPolicyInput): boolean {
  return Boolean(input.agentId && input.agentId.trim())
}

export function shouldEnableToolCalling(input: ToolPolicyInput): boolean {
  return input.localToolsEnabled === true
}

export function shouldEnableAgentTools(input: ToolPolicyInput): boolean {
  return shouldEnableToolCalling(input)
}

export function getToolExecutorMode(input: ToolPolicyInput): ToolExecutorMode {
  if (!shouldEnableToolCalling(input)) return 'disabled'
  return hasConcreteAgent(input) ? 'agent' : 'default'
}

export function shouldExposeApprovalTools(input: ToolPolicyInput): boolean {
  return false
}

export function filterApprovalToolsForPolicy<T extends ToolNameLike>(
  input: ToolPolicyInput,
  tools: T[],
  getRisk: (toolName: string) => ToolRiskLike | undefined,
): T[] {
  return tools.filter(tool => {
    const risk = getRisk(tool.function.name)
    return risk !== 'approval' && risk !== 'write'
  })
}

export function filterUnavailableSourceToolsForPolicy<T extends ToolNameLike>(
  tools: T[],
  getSource: (toolName: string) => ToolSourceLike | undefined,
  availableSources: Partial<Record<ToolSourceLike, boolean>>,
): T[] {
  return tools.filter(tool => {
    const source = getSource(tool.function.name)
    if (!source) return true
    return availableSources[source] !== false
  })
}

export function buildToolRequestOptions<T>(
  input: ToolPolicyInput,
  tools: T[] = [],
): { tools?: T[]; tool_choice?: 'auto' } {
  if (!shouldEnableToolCalling(input) || tools.length === 0) return {}
  return {
    tools,
    tool_choice: 'auto',
  }
}

export function canExecuteToolCall(
  toolName: string,
  options: { isMember: boolean; exposedToolNames: Set<string> },
): boolean {
  const name = String(toolName || '').trim()
  return Boolean(options.isMember && name && options.exposedToolNames.has(name))
}
