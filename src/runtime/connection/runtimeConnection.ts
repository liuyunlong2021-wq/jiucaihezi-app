import { buildKnowledgeConnection } from './knowledgeConnection'
import { buildToolConnection } from './toolConnection'
import type {
  ConnectionSource,
  KnowledgeConnection,
  LlmConnection,
  RuntimeConnection,
  SkillConnection,
  ToolConnection,
} from './types'

export interface BuildRuntimeConnectionInput {
  source: ConnectionSource
  userInput: string
  skill?: SkillConnection
  knowledge?: KnowledgeConnection
  tools?: ToolConnection
  llm: LlmConnection
  now?: number
  id?: string
}

export function buildRuntimeConnection(input: BuildRuntimeConnectionInput): RuntimeConnection {
  const knowledge = input.knowledge || buildKnowledgeConnection({
    mode: 'off',
    citationMode: 'none',
  })
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
    knowledge,
    tools,
    llm: input.llm,
    trace: {
      createdAt,
      userInput: input.userInput,
      sectionNames: resolveSectionNames(input.skill, knowledge, tools),
    },
  }
}

function resolveSectionNames(
  skill: SkillConnection | undefined,
  knowledge: KnowledgeConnection,
  tools: ToolConnection,
): string[] {
  const sections: string[] = []
  if (skill) sections.push('skill')
  if (knowledge.mode !== 'off' && knowledge.evidenceText) sections.push('knowledge')
  if (tools.enabled && tools.availableToolNames.length > 0) sections.push('tools')
  return sections
}

