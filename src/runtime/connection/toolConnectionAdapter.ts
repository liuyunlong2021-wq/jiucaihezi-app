import { buildToolConnection, type ToolDefinitionLike } from './toolConnection'
import {
  getDefaultOfficeToolDefinitions,
  type ChatCompletionTool,
} from '@/composables/officeTools'
import { getBrowserToolDefinitions } from '@/utils/browserTools'
import { buildToolRequestOptions, filterApprovalToolsForPolicy } from '@/utils/chatToolPolicy'
import {
  getDevProjectRoot,
  getDevProjectToolDefinitions,
} from '@/utils/devProjectTools'
import { getLocalContentToolDefinitions } from '@/utils/localContentTools'
import { getToolCardByName } from '@/utils/toolRegistry'
import { isWebSearchEnabled } from '@/utils/webSearch'
import { getTodoToolDefinitions } from '@/utils/todoTools'
import { ALL_SKILL_TOOLS } from '@/utils/skillTestRunner'
import { getMcpToolDefinitions } from './mcpToolAdapter'
import type {
  ToolConnection,
  ToolConnectionSource,
} from './types'

export interface ResolveToolConnectionInput<TTool extends ToolDefinitionLike = ToolDefinitionLike> {
  enabled: boolean
  source: ToolConnectionSource
  getTools: () => TTool[]
}

export interface ResolveToolConnectionResult<TTool extends ToolDefinitionLike = ToolDefinitionLike> {
  connection: ToolConnection
  tools: TTool[]
}

export interface BuildAvailableChatToolsInput<TTool extends ToolDefinitionLike = ToolDefinitionLike> {
  agentId?: string
  agentName?: string
  localToolsEnabled?: boolean
  webSearchEnabled?: boolean
  getSkillCreatorTools?: () => TTool[]
  getTodoTools?: () => TTool[]
  getNonOfficeTools?: () => TTool[]
  getBrowserTools?: () => TTool[]
  getLocalContentTools?: () => TTool[]
  getOfficeTools?: () => TTool[]
  getDevTools?: () => TTool[]
}

export interface BuildDefaultChatToolsInput {
  agentId?: string
  agentName?: string
  localToolsEnabled?: boolean
}

export const OFFICE_TOOL_NAMES = new Set([
  'office_create',
  'office_read',
  'office_convert',
  'office_execute',
  'create_document',
  'read_document',
  'convert_document',
  'run_code',
  'code_execute',
])
const CHAT_TOOLS: ChatCompletionTool[] = []

export function resolveToolConnection<TTool extends ToolDefinitionLike = ToolDefinitionLike>(
  input: ResolveToolConnectionInput<TTool>,
): ResolveToolConnectionResult<TTool> {
  const tools = input.enabled ? input.getTools() : []
  return {
    connection: buildToolConnection({
      enabled: input.enabled,
      source: input.source,
      tools,
    }),
    tools,
  }
}

export function buildAvailableChatTools<TTool extends ToolDefinitionLike = ToolDefinitionLike>(
  input: BuildAvailableChatToolsInput<TTool>,
): TTool[] {
  if (input.agentId === 'preset_skill-creator') {
    return [...(input.getSkillCreatorTools?.() || [])]
  }

  return [
    ...(input.getTodoTools?.() || []),
    ...(input.getNonOfficeTools?.() || []),
    ...(input.webSearchEnabled ? [] : input.getBrowserTools?.() || []),
    ...(input.getLocalContentTools?.() || []),
    ...(input.getOfficeTools?.() || []),
    ...(input.getDevTools?.() || []),
  ]
}

export function isOfficeToolName(name: string): boolean {
  return OFFICE_TOOL_NAMES.has(String(name || '').trim())
}

export function buildDefaultChatTools(options: BuildDefaultChatToolsInput): ChatCompletionTool[] {
  if (options.localToolsEnabled !== true) return []

  const filterRiskyTools = (tools: ChatCompletionTool[]) => filterApprovalToolsForPolicy(
    options,
    tools,
    toolName => getToolCardByName(toolName)?.risk,
  )

  const nonOfficeTools = filterApprovalToolsForPolicy(
    options,
    CHAT_TOOLS.filter(tool => !isOfficeToolName(tool.function.name)),
    toolName => getToolCardByName(toolName)?.risk,
  )
  const mcpTools = getMcpToolDefinitions()

  return buildAvailableChatTools<ChatCompletionTool>({
    ...options,
    webSearchEnabled: isWebSearchEnabled(),
    getSkillCreatorTools: () => filterRiskyTools([...ALL_SKILL_TOOLS]),
    getTodoTools: () => filterRiskyTools(getTodoToolDefinitions()),
    getNonOfficeTools: () => [...nonOfficeTools, ...mcpTools],
    getBrowserTools: () => filterRiskyTools(getBrowserToolDefinitions({ includeApproval: false })),
    getLocalContentTools: () => filterRiskyTools(getLocalContentToolDefinitions()),
    getOfficeTools: () => filterRiskyTools(getDefaultOfficeToolDefinitions()),
    getDevTools: () => getDevProjectRoot() ? filterRiskyTools(getDevProjectToolDefinitions()) : [],
  })
}

export function buildDefaultToolRequestOptions(
  options: BuildDefaultChatToolsInput,
  tools: ChatCompletionTool[],
): ReturnType<typeof buildToolRequestOptions> {
  return buildToolRequestOptions(options, tools)
}
