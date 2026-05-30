export type ConnectionSource = 'manual' | 'plain'
export type SkillSelectedBy = 'user'
export type SkillResourceKind = 'references' | 'scripts' | 'assets'
export type ToolConnectionSource = 'global' | 'skill-suggested' | 'user-requested'
export type KnowledgeConnectionMode = 'off' | 'quick' | 'standard' | 'deep'
export type KnowledgeCitationMode = 'none' | 'summary' | 'required'

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

export interface KnowledgeConnectionHit {
  id: string
  title?: string
  vaultId?: string
  path?: string
  snippet?: string
}

export interface KnowledgeConnection {
  mode: KnowledgeConnectionMode
  citationMode: KnowledgeCitationMode
  primaryVaultId?: string
  secondaryVaultIds: string[]
  evidenceText: string
  hits: KnowledgeConnectionHit[]
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
}

export interface RuntimeConnection {
  id: string
  source: ConnectionSource
  skill?: SkillConnection
  knowledge: KnowledgeConnection
  tools: ToolConnection
  llm: LlmConnection
  trace: RuntimeConnectionTrace
}
