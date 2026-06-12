import { buildToolConnection } from './toolConnection'
import type {
  ConnectionSource,
  LlmConnection,
  RuntimeConnection,
  SkillConnection,
  SkillApplicabilityMode,
  ToolConnection,
} from './types'

export interface BuildRuntimeConnectionInput {
  source: ConnectionSource
  userInput: string
  skill?: SkillConnection
  tools?: ToolConnection
  llm: LlmConnection
  skillApplicability?: {
    mode: SkillApplicabilityMode
    reason: string
    matchedTerms: string[]
  }
  now?: number
  id?: string
}

export function buildRuntimeConnection(input: BuildRuntimeConnectionInput): RuntimeConnection {
  const tools = input.tools || buildToolConnection({
    enabled: false,
    source: 'global',
    tools: [],
  })
  const createdAt = input.now || Date.now()

  return {
    id: input.id || `connection_${createdAt.toString(36)}`,
    source: input.source,
    skill: input.skill,
    tools,
    llm: input.llm,
    trace: {
      createdAt,
      userInput: input.userInput,
      sectionNames: resolveSectionNames(input.skill, tools),
      skillApplicability: input.skillApplicability,
    },
  }
}

function resolveSectionNames(
  skill: SkillConnection | undefined,
  tools: ToolConnection,
): string[] {
  const sections: string[] = []
  if (skill) sections.push('skill')
  if (tools.enabled && tools.availableToolNames.length > 0) sections.push('tools')
  return sections
}
