export type ConnectionSource = 'manual' | 'plain'
export type SkillSelectedBy = 'user'
export type SkillResourceKind = 'references' | 'scripts' | 'assets'
export type ToolConnectionSource = 'global' | 'skill-suggested' | 'user-requested'
export type SkillApplicabilityMode = 'apply' | 'reference-only' | 'off'

export interface SkillConnectionResource {
  kind: SkillResourceKind
  path: string
}

export interface ParsedSkillMd {
  name: string
  description: string
  body: string
  fullSkillMd: string
  frontmatter: Record<string, string>
}

export interface SkillConnection {
  id: string
  name: string
  description: string
  selectedBy: SkillSelectedBy
  fullSkillMd: string
  body: string
  resources: SkillConnectionResource[]
}

export interface ToolConnection {
  enabled: boolean
  source: ToolConnectionSource
  availableToolNames: string[]
}

export interface LlmConnection {
  modelId: string
  providerId?: string
  runtime: 'chat-completions' | 'responses' | 'local'
  contextBudget: number
}

export interface RuntimeConnectionTrace {
  createdAt: number
  userInput: string
  sectionNames: string[]
  skillApplicability?: {
    mode: SkillApplicabilityMode
    reason: string
    matchedTerms: string[]
  }
  conversationContext?: {
    runtimeSegmentId: string
    loadLevel: 'light' | 'standard' | 'heavy'
    memoryHitCount: number
    degraded: boolean
  }
}

export interface RuntimeConnection {
  id: string
  source: ConnectionSource
  skill?: SkillConnection
  tools: ToolConnection
  llm: LlmConnection
  trace: RuntimeConnectionTrace
}
