import type {
  ToolConnection,
  ToolConnectionSource,
} from './types'

export interface ToolDefinitionLike {
  function?: {
    name?: string
  }
}

export interface BuildToolConnectionInput {
  enabled: boolean
  source: ToolConnectionSource
  tools: ToolDefinitionLike[]
}

export function buildToolConnection(input: BuildToolConnectionInput): ToolConnection {
  return {
    enabled: input.enabled,
    source: input.source,
    availableToolNames: input.enabled ? toolNames(input.tools) : [],
  }
}

function toolNames(tools: ToolDefinitionLike[]): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const tool of tools) {
    const name = String(tool.function?.name || '').trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

