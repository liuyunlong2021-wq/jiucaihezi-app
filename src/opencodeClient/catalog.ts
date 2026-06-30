import type { OpencodeClient, SessionMessage } from '@opencode-ai/sdk/v2'
import type { ModelEntry } from '@/stores/agentStore'
import { OPENCODE_JC_PROVIDER_ID } from './providerProjection'
import { createOpenCodeSessionCacheBucket } from './sessionCache'

export interface OpenCodeAgentOption {
  id: string
  label: string
  description?: string
  mode?: 'subagent' | 'primary' | 'all' | string
  hidden?: boolean
  color?: string
  model?: {
    id: string
    providerID: string
    variant?: string
  }
}

export interface OpenCodeSkillOption {
  name: string
  label: string
  description?: string
  location?: string
  content?: string
}

export interface OpenCodeCommandOption {
  id: string
  label: string
  description?: string
  slash?: string
  category?: string
  source: 'Skill' | 'MCP' | 'Custom'
}

export interface OpenCodeContextUsage {
  sessionID: string
  messageCount: number
  userMessages: number
  assistantMessages: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
  limit?: number
  usage?: number
  providerID?: string
  modelID?: string
  modelLabel?: string
  cost?: number
  lastMessageAt?: number
}

const contextUsageCache = createOpenCodeSessionCacheBucket<OpenCodeContextUsage>()

function unwrapData<T>(result: unknown): T {
  const value = result as { data?: T; error?: unknown }
  if (value && typeof value === 'object' && 'error' in value && value.error) {
    const error = value.error as { message?: string; detail?: string; code?: string }
    throw new Error(error.message || error.detail || error.code || 'OpenCode API returned an error')
  }
  if (value && typeof value === 'object' && 'data' in value) return value.data as T
  return result as T
}

function normalizeTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
}

export function normalizeOpenCodeModel(model: any): ModelEntry | null {
  const id = String(model?.id || model?.modelID || '').trim()
  if (!id) return null
  if (model?.enabled === false || model?.status === 'deprecated') return null
  const output = normalizeTextArray(model?.capabilities?.output)
  const input = normalizeTextArray(model?.capabilities?.input)
  const providerId = String(model?.providerID || OPENCODE_JC_PROVIDER_ID)
  let capability: ModelEntry['capability'] = 'text'
  if (output.includes('image')) capability = 'image'
  else if (output.includes('video')) capability = 'video'
  else if (output.includes('audio')) capability = 'audio'
  else if (!output.includes('text') && !input.includes('text')) capability = 'text'
  return {
    id,
    label: String(model?.name || id),
    providerId,
    capability,
    contextWindow: Number(model?.limit?.context) || undefined,
  }
}

export function normalizeOpenCodeAgent(agent: any): OpenCodeAgentOption | null {
  const id = String(agent?.id || '').trim()
  if (!id || agent?.hidden) return null
  return {
    id,
    label: id,
    description: agent?.description ? String(agent.description) : undefined,
    mode: agent?.mode,
    hidden: Boolean(agent?.hidden),
    color: agent?.color ? String(agent.color) : undefined,
    model: agent?.model,
  }
}

export function normalizeOpenCodeSkill(skill: any): OpenCodeSkillOption | null {
  const name = String(skill?.name || '').trim()
  if (!name) return null
  return {
    name,
    label: name,
    description: skill?.description ? String(skill.description) : undefined,
    location: skill?.location ? String(skill.location) : undefined,
    content: skill?.content ? String(skill.content) : undefined,
  }
}

export function normalizeOpenCodeCommand(command: any): OpenCodeCommandOption | null {
  const id = String(command?.id || command?.name || command?.command || command?.slash || '').trim()
  const slash = String(command?.slash || command?.name || command?.command || '').replace(/^\//, '').trim()
  if (!id && !slash) return null
  const category = String(command?.category || command?.source || command?.type || '').trim()
  const lower = `${id} ${slash} ${category}`.toLowerCase()
  let source: OpenCodeCommandOption['source'] = 'Custom'
  if (lower.includes('skill')) source = 'Skill'
  else if (lower.includes('mcp')) source = 'MCP'
  return {
    id: id || slash,
    label: String(command?.title || command?.label || command?.description || id || slash),
    description: command?.description ? String(command.description) : undefined,
    slash,
    category: category || undefined,
    source,
  }
}

export async function listOpenCodeModels(
  client: OpencodeClient,
  input: { directory?: string; workspace?: string } = {},
): Promise<ModelEntry[]> {
  const response = unwrapData<any>(await (client as any).v2.model.list({
    location: {
      directory: input.directory,
      workspace: input.workspace,
    },
  }))
  const list = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : []
  return list.map(normalizeOpenCodeModel).filter(Boolean) as ModelEntry[]
}

export async function listOpenCodeAgents(
  client: OpencodeClient,
  input: { directory?: string; workspace?: string } = {},
): Promise<OpenCodeAgentOption[]> {
  const response = unwrapData<any>(await (client as any).v2.agent.list({
    location: {
      directory: input.directory,
      workspace: input.workspace,
    },
  }))
  const list = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : []
  return list.map(normalizeOpenCodeAgent).filter(Boolean) as OpenCodeAgentOption[]
}

export async function listOpenCodeSkills(
  client: OpencodeClient,
  input: { directory?: string; workspace?: string } = {},
): Promise<OpenCodeSkillOption[]> {
  const anyClient = client as any
  const payload = {
    location: {
      directory: input.directory,
      workspace: input.workspace,
    },
  }
  const response = unwrapData<any>(
    anyClient.v2?.skill?.list
      ? await anyClient.v2.skill.list(payload)
      : anyClient.app?.skills
        ? await anyClient.app.skills(payload)
        : await anyClient.skill.list(payload),
  )
  const list = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : []
  return list.map(normalizeOpenCodeSkill).filter(Boolean) as OpenCodeSkillOption[]
}

export async function listOpenCodeCommands(
  client: OpencodeClient,
  input: { directory?: string; workspace?: string } = {},
): Promise<OpenCodeCommandOption[]> {
  const anyClient = client as any
  const payload = {
    location: {
      directory: input.directory,
      workspace: input.workspace,
    },
  }
  const commandApi = anyClient.command || anyClient.v2?.command
  if (!commandApi?.list) return []
  let rawResponse: unknown
  try {
    rawResponse = await commandApi.list(payload)
  } catch {
    rawResponse = await commandApi.list()
  }
  const response = unwrapData<any>(rawResponse)
  const list = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : []
  return list.map(normalizeOpenCodeCommand).filter(Boolean) as OpenCodeCommandOption[]
}

function messageTime(message: any): number | undefined {
  const value = Number(message?.time?.completed || message?.time?.created || 0)
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function computeOpenCodeContextUsage(
  sessionID: string,
  contextMessages: SessionMessage[],
  models: ModelEntry[] = [],
): OpenCodeContextUsage {
  let input = 0
  let output = 0
  let reasoning = 0
  let cacheRead = 0
  let cacheWrite = 0
  let cost = 0
  let userMessages = 0
  let assistantMessages = 0
  let modelID = ''
  let providerID = ''
  let lastMessageAt = 0

  for (const message of contextMessages as any[]) {
    const created = messageTime(message)
    if (created) lastMessageAt = Math.max(lastMessageAt, created)
    if (message?.type === 'user') userMessages++
    if (message?.type !== 'assistant') continue
    assistantMessages++
    input += Number(message.tokens?.input || 0)
    output += Number(message.tokens?.output || 0)
    reasoning += Number(message.tokens?.reasoning || 0)
    cacheRead += Number(message.tokens?.cache?.read || 0)
    cacheWrite += Number(message.tokens?.cache?.write || 0)
    cost += Number(message.cost || 0)
    if (message.model?.id) modelID = String(message.model.id)
    if (message.model?.providerID) providerID = String(message.model.providerID)
  }

  const total = input + output + reasoning + cacheRead + cacheWrite
  const model = models.find(item => item.id === modelID && (!providerID || item.providerId === providerID))
    || models.find(item => item.id === modelID)
  const limit = model?.contextWindow
  return {
    sessionID,
    messageCount: contextMessages.length,
    userMessages,
    assistantMessages,
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total,
    limit,
    usage: limit ? Math.round((total / limit) * 100) : undefined,
    providerID: providerID || undefined,
    modelID: modelID || undefined,
    modelLabel: model?.label || modelID || undefined,
    cost: cost || undefined,
    lastMessageAt: lastMessageAt || undefined,
  }
}

export async function getOpenCodeSessionContextUsage(
  client: OpencodeClient,
  sessionID: string,
  models: ModelEntry[] = [],
  options: { preferCache?: boolean; directory?: string; workspace?: string } = {},
): Promise<OpenCodeContextUsage> {
  if (options.preferCache) {
    const cached = contextUsageCache.get(sessionID)
    if (cached) return cached
  }
  const response = unwrapData<any>(await (client as any).v2.session.context({
    sessionID,
    directory: options.directory,
    workspace: options.workspace,
  }))
  const contextMessages = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : []
  const usage = computeOpenCodeContextUsage(sessionID, contextMessages, models)
  contextUsageCache.set(sessionID, usage)
  return usage
}

export function invalidateOpenCodeSessionContextUsage(sessionID: string): void {
  contextUsageCache.delete(sessionID)
}
