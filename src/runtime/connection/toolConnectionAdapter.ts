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
import {
  ALL_SKILL_BUILDER_TOOLS,
  getSkillBuilderToolDefinitions,
} from '@/utils/skillBuilderTools'
import { getMcpBridgeToolDefinitions } from '@/runtime/tools/mcpBridge'
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
  userInput?: string
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
  getMcpTools?: () => TTool[]
}

export interface BuildDefaultChatToolsInput {
  userInput?: string
  agentId?: string
  agentName?: string
  localToolsEnabled?: boolean
  skillMaterialRuntimeAvailable?: boolean
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
  if (input.agentId === 'preset_skill-builder') {
    return [...(input.getSkillCreatorTools?.() || [])]
  }
  if (input.agentId === 'preset_skill-creator') {
    return [...(input.getSkillCreatorTools?.() || [])]
  }

  const intent = classifyToolIntent(input.userInput)
  if (input.userInput && !intent.needsAnyTool) return []

  return [
    ...(intent.todo ? input.getTodoTools?.() || [] : []),
    ...(intent.general ? input.getNonOfficeTools?.() || [] : []),
    ...(intent.browser && !input.webSearchEnabled ? input.getBrowserTools?.() || [] : []),
    ...(intent.localContent ? input.getLocalContentTools?.() || [] : []),
    ...(intent.office ? input.getOfficeTools?.() || [] : []),
    ...(intent.dev ? input.getDevTools?.() || [] : []),
    ...(intent.needsAnyTool ? input.getMcpTools?.() || [] : []),
  ]
}

interface ToolIntent {
  needsAnyTool: boolean
  browser: boolean
  office: boolean
  localContent: boolean
  dev: boolean
  todo: boolean
  general: boolean
}

export function classifyToolIntent(userInput?: string): ToolIntent {
  const text = String(userInput || '').trim()
  if (!text) {
    return {
      needsAnyTool: true,
      browser: true,
      office: true,
      localContent: true,
      dev: true,
      todo: true,
      general: true,
    }
  }

  const office = /(转成|转换成|生成|导出|保存为|整理成|做成|创建|新建|写入|制作).{0,16}(Word|word|docx|文档|Markdown|markdown|MD|md|PDF|pdf|PPT|ppt|幻灯片|表格|Excel|excel|xlsx|文件)/.test(text)
    || /(Word|word|docx|文档|Markdown|markdown|MD|md|PDF|pdf|PPT|ppt|幻灯片|表格|Excel|excel|xlsx|文件).{0,16}(转成|转换|生成|导出|保存|创建|新建|写入|制作)/.test(text)
  const browser = /(联网|网页|网站|浏览器|打开链接|打开网页|搜索一下|查一下|搜一下|最新|今天|新闻|网址|URL|url|http:\/\/|https:\/\/)/.test(text)
  const localContent = /(读取|解析|转换|提取|识别|转写).{0,16}(附件|文件|本地文件|PDF|pdf|Word|word|docx|音频|视频|字幕|Markdown|markdown)/.test(text)
    || /(附件|文件|本地文件|PDF|pdf|Word|word|docx|音频|视频|字幕).{0,16}(读取|解析|转换|提取|识别|转写)/.test(text)
  const dev = /(代码|源码|项目|仓库|repo|repository|文件路径|终端|命令|bug|报错|测试|构建|打包|git|diff).{0,24}(读取|搜索|修改|修复|执行|运行|检查|查看|审计|提交|构建|打包)/i.test(text)
    || /(读取|搜索|修改|修复|执行|运行|检查|查看|审计|提交|构建|打包).{0,24}(代码|源码|项目|仓库|repo|repository|文件路径|终端|命令|bug|报错|测试|git|diff)/i.test(text)
  const todo = /(待办|todo|任务清单|计划清单|提醒我|记一下|分步骤|步骤|开发任务).{0,20}(创建|新增|添加|完成|删除|更新|列出|执行|推进|处理|规划)/i.test(text)
    || /(创建|新增|添加|完成|删除|更新|列出|执行|推进|处理|规划|完成).{0,20}(待办|todo|任务清单|计划清单|提醒|分步骤|开发任务)/i.test(text)
  const needsAnyTool = office || browser || localContent || dev || todo

  return {
    needsAnyTool,
    browser,
    office,
    localContent,
    dev,
    todo,
    general: false,
  }
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
  const mcpTools = getMcpBridgeToolDefinitions({
    coreToolNames: buildCoreToolNameSet(),
  })

  return buildAvailableChatTools<ChatCompletionTool>({
    ...options,
    userInput: options.userInput,
    webSearchEnabled: isWebSearchEnabled(),
    getSkillCreatorTools: () => filterRiskyTools([
      ...(options.agentId === 'preset_skill-builder'
        ? getSkillBuilderToolDefinitions({
          skillMaterialRuntimeAvailable: options.skillMaterialRuntimeAvailable === true,
        })
        : ALL_SKILL_TOOLS),
    ]),
    getTodoTools: () => filterRiskyTools(getTodoToolDefinitions()),
    getNonOfficeTools: () => nonOfficeTools,
    getBrowserTools: () => filterRiskyTools(getBrowserToolDefinitions({ includeApproval: false })),
    getLocalContentTools: () => filterRiskyTools(getLocalContentToolDefinitions()),
    getOfficeTools: () => filterRiskyTools(getDefaultOfficeToolDefinitions()),
    getDevTools: () => getDevProjectRoot() ? filterRiskyTools(getDevProjectToolDefinitions()) : [],
    getMcpTools: () => mcpTools,
  })
}

export function buildDefaultToolRequestOptions(
  options: BuildDefaultChatToolsInput,
  tools: ChatCompletionTool[],
): ReturnType<typeof buildToolRequestOptions> {
  return buildToolRequestOptions(options, tools)
}

function buildCoreToolNameSet(): Set<string> {
  const names = new Set<string>(OFFICE_TOOL_NAMES)
  for (const tool of [
    ...CHAT_TOOLS,
    ...ALL_SKILL_TOOLS,
    ...ALL_SKILL_BUILDER_TOOLS,
    ...getTodoToolDefinitions(),
    ...getBrowserToolDefinitions({ includeApproval: true }),
    ...getLocalContentToolDefinitions(),
    ...getDefaultOfficeToolDefinitions(),
    ...getDevProjectToolDefinitions(),
  ]) {
    const name = String(tool.function?.name || '').trim()
    if (name) names.add(name)
  }
  return names
}
