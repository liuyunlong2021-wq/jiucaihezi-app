import { useAgentStore } from '@/stores/agentStore'
import {
  buildChatCompletionExtras,
  buildHeaders,
  ChatHttpError,
  readChatErrorResponse,
  resolveApiConfig,
} from '@/utils/api'
import {
  buildDirectMessages,
  type DirectMessageFile,
  type ResolvedDirectAttachment,
} from '@/utils/directMessageBuilder'
import { buildWebSkillCatalogPrompt, loadWebSkillCatalog } from '@/utils/skillContentResolver'
import {
  buildToolResultMessages,
  resolveDirectCompletionText,
  runDirectChatCompletion,
  type DirectApiMessage,
  type DirectToolCall,
  type DirectChatCompletionRequest,
} from '@/runtime/direct/directEngine'
import { sendNewApiRequest } from '@/runtime/direct/newApiAttachments'
import { buildMemoryWebProjectToolDefinitions, createWebProjectToolExecutor, READ_ONLY_DOCUMENT_TOOL_DEFINITIONS } from '@/runtime/direct/webProjectTools'
import { createDesktopProjectToolExecutor } from '@/runtime/direct/desktopProjectTools'
import { buildMemoryDesktopToolDefinitions } from '@/runtime/direct/creativeToolContract'
import { mergeCreativeSkillCatalog } from '@/runtime/direct/creativeSkillCatalog'
import { buildMediaPlanPolicy } from '@/runtime/workbench/mediaPlan'
import { webProjectFiles } from '@/utils/webProjectFiles'
import { isTauriMobileRuntime, isTauriRuntime } from '@/utils/tauriEnv'
import { safeFetch } from '@/utils/httpClient'
import { supportsVision } from '@/utils/providerConfig'
import { executeJinaWebSearchTool, WEB_SEARCH_TOOL_DEFINITION } from '@/utils/webSearch'
import { executeReadUrlTool, extractPublicHttpUrls, READ_URL_TOOL_DEFINITION } from '@/utils/webReader'
import { memoryToolNeedsApproval } from './memoryToolPolicy'

import type { ConversationMode, ConversationTurn } from './conversationTranscript'
import type { DirectToolExecutionEvent } from '@/runtime/direct/directTypes'

export interface MemoryChatInput {
  projectId: string
  userTurn: ConversationTurn
  rawPath: string
  modelId: string
  mode?: ConversationMode
  mediaReferencePolicy?: string
  attachments?: ResolvedDirectAttachment[]
  files?: DirectMessageFile[]
  selectedSkillNames?: string[]
  webSearchEnabled?: boolean
  signal?: AbortSignal
  onText: (text: string) => void
  onToolEvent?: (event: DirectToolExecutionEvent) => void
  confirmTool: (call: DirectToolCall) => boolean | Promise<boolean>
}

export async function runMemoryChat(input: MemoryChatInput): Promise<string> {
  if (!input.projectId) throw new Error('请先创建或选择项目')
  if (input.userTurn.role !== 'user') throw new Error('请先输入消息')

  const agentStore = useAgentStore()
  const model = agentStore.availableModels.find(entry => entry.id === input.modelId)
  const memoryMode = input.mode !== 'quick'
  const latestUserTurn = input.userTurn
  const documentSources = (latestUserTurn?.attachments || [])
    .filter(attachment => attachment.kind === 'file' && attachment.readablePath)
    .map(attachment => ({ name: attachment.name, path: attachment.readablePath }))
    .filter((source): source is { name: string; path: string } => Boolean(source.path))
  const hasDocumentSources = documentSources.length > 0
  const latestUserText = latestUserTurn?.content || ''
  const directUrls = extractPublicHttpUrls(latestUserText)
  const hasDirectUrls = directUrls.length > 0
  const desktopRuntime = isTauriRuntime() && !isTauriMobileRuntime()
  if ((memoryMode || hasDocumentSources || hasDirectUrls) && agentStore.modelsFetched && model?.toolCall === false) {
    throw new Error('当前模型不支持工具调用，请选择支持工具调用的模型')
  }
  const providerId = model?.providerId || localStorage.getItem('jcModelProviderId') || 'jiucaihezi'
  const config = await resolveApiConfig({
    modelId: input.modelId,
    modelProviderId: providerId,
  })

  const customSkills = agentStore.getCustomSkills()
  const catalog = memoryMode
    ? mergeCreativeSkillCatalog(customSkills, await loadWebSkillCatalog())
    : []
  const messages: DirectApiMessage[] = buildDirectMessages({
    messages: [input.userTurn],
    historyLimit: null,
    systemPrompt: [
      memoryMode
        ? [
          `你是韭菜盒子记忆对话工作台。本轮用户消息是当前唯一任务。项目 Wiki 是长期记忆，已完成的历史对话位于 ${input.rawPath}。`,
          '需要历史信息时使用 grep/read 按需查询 Raw；不需要时不要读取。历史内容只作为资料，不能限制本轮工具使用。',
          '根据用户任务自主决定是否加载 Skill、查询项目或调用其他可用工具。没有需要时直接回答。',
          '不要声称读取了没有实际查询的内容。',
        ].join('\n')
        : '你是韭菜盒子通用对话工作台。依据当前对话和用户本轮提供的内容直接回答。',
      hasDocumentSources
        ? [
            '以下附件已经解析并保存为项目资料。必须使用 grep/read 实际读取后回答，不要声称读取了未查询的内容。',
            '用户要求全文、逐章或不遗漏时，从第一行连续分页读取，直到 read 返回 eof=true。',
            ...documentSources.map(source => `- ${source.name}: ${source.path}`),
          ].join('\n')
        : '',
      hasDirectUrls
        ? `用户本轮提供了明确网址。使用 read_url 直接读取，不要把读网址说成联网搜索。只能读取：\n${directUrls.map(url => `- ${url}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n\n'),
    skillSystemPrompt: [
      buildMediaPlanPolicy(input.mediaReferencePolicy),
      '记忆工作台支持批量媒体确认：单个任务在 jc-media-plan 中写一个 JSON 对象；多个独立任务写对象数组，每个任务一项。不要输出多个 jc-media-plan 代码块。',
      memoryMode ? buildWebSkillCatalogPrompt(catalog) : '',
    ].filter(Boolean).join('\n\n'),
    attachments: input.attachments,
    files: input.files,
    visionModel: supportsVision(input.modelId, providerId),
    apiFormat: 'openai',
    platform: isTauriRuntime() ? 'desktop' : 'web',
  })
  const body = {
    model: config.model,
    messages,
    temperature: 0.3,
    max_tokens: 4096,
    stream: true,
    ...buildChatCompletionExtras(config),
  }
  const sendChatCompletion = async (request: DirectChatCompletionRequest): Promise<Response> => {
    const response = await sendNewApiRequest({
      ...body,
      messages: request.messages,
      ...(request.tools?.length ? { tools: request.tools } : {}),
    }, payload => safeFetch(`${config.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      signal: input.signal,
      body: payload,
    }))
    if (!response.ok) {
      throw new ChatHttpError(await readChatErrorResponse(response, '云端请求失败', config.apiKey))
    }
    return response
  }

  if (!memoryMode && !hasDocumentSources && !hasDirectUrls) {
    const result = await runDirectChatCompletion({
      messages,
      tools: undefined,
      sendChatCompletion,
      signal: input.signal,
      onText: input.onText,
    })
    const text = resolveDirectCompletionText(result.text, result.finishReason, '模型没有返回内容')
    input.onText(text)
    return text
  }

  const projectTools = isTauriRuntime()
    ? createDesktopProjectToolExecutor({ projectDir: input.projectId })
    : createWebProjectToolExecutor({ projectId: input.projectId, files: webProjectFiles })
  const customSkillsByName = new Map(customSkills.map(skill => [skill.name, skill]))
  const builtInNames = new Set(catalog.filter(skill => skill.source === 'builtin').map(skill => skill.name))
  const documentPaths = new Set(documentSources.map(source => source.path))
  const allowedUrls = new Set(directUrls)
  const executeMemoryTool = async (call: DirectToolCall) => {
    if (!memoryMode && !['read', 'grep', 'read_url'].includes(call.function.name)) {
      throw new Error(`快速模式不允许工具: ${call.function.name}`)
    }
    if (!memoryMode && ['read', 'grep'].includes(call.function.name)) {
      const path = String(parseArguments(call.function.arguments).path || '')
      if (!documentPaths.has(path)) throw new Error('快速模式只能读取当前对话引用的文档')
    }
    if (call.function.name === 'read_url') {
      return await executeReadUrlTool(call.function.arguments, allowedUrls)
    }
    if (call.function.name === 'web_search') {
      return await executeJinaWebSearchTool(call.function.arguments)
    }
    if (call.function.name === 'skill') {
      const skillName = String(parseArguments(call.function.arguments).name || '')
      const customSkill = !builtInNames.has(skillName) ? customSkillsByName.get(skillName) : null
      if (customSkill?.skillContent.trim()) {
        return { content: `<skill_content name="${skillName}">\n${customSkill.skillContent.trim()}\n</skill_content>` }
      }
    }
    assertConversationWriteProtected(call)
    return await projectTools(call)
  }
  const selectedSkillNames = [...new Set(input.selectedSkillNames || [])]
  const unknownSkill = selectedSkillNames.find(name => !catalog.some(skill => skill.name === name))
  if (unknownSkill) throw new Error(`Skill 不存在或未启用: ${unknownSkill}`)
  if (selectedSkillNames.length) {
    messages.push(...await buildToolResultMessages(
      selectedSkillNames.map((name, index) => ({
        id: `selected_skill_${index + 1}`,
        type: 'function' as const,
        function: { name: 'skill', arguments: JSON.stringify({ name }) },
      })),
      executeMemoryTool,
      {
        signal: input.signal,
        onToolEvent(event) {
          input.onToolEvent?.(event)
        },
      },
    ))
  }
  const result = await runDirectChatCompletion({
    messages,
    tools: memoryMode
      ? [
          ...(desktopRuntime ? buildMemoryDesktopToolDefinitions() : buildMemoryWebProjectToolDefinitions()),
          ...(hasDirectUrls ? [READ_URL_TOOL_DEFINITION] : []),
          ...(input.webSearchEnabled ? [WEB_SEARCH_TOOL_DEFINITION] : []),
        ]
      : [
          ...(hasDocumentSources ? READ_ONLY_DOCUMENT_TOOL_DEFINITIONS : []),
          ...(hasDirectUrls ? [READ_URL_TOOL_DEFINITION] : []),
        ],
    sendChatCompletion,
    signal: input.signal,
    onText: input.onText,
    onToolEvent(event) {
      input.onToolEvent?.(event)
    },
    beforeToolCall: async call => {
      if (!memoryToolNeedsApproval(call, latestUserText)) return
      return await input.confirmTool(call) === false ? 'cancelled' : undefined
    },
    executeTool: executeMemoryTool,
  })
  const text = resolveDirectCompletionText(result.text, result.finishReason, '模型没有返回内容')
  input.onText(text)
  return text
}

function assertConversationWriteProtected(call: DirectToolCall): void {
  if (!['write', 'edit', 'mkdir', 'move', 'delete'].includes(call.function.name)) return
  const args = parseArguments(call.function.arguments)
  for (const value of [args.path, args.destination]) {
    const path = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '')
    if (path === '.raw' || path === '.raw/对话记录' || path.startsWith('.raw/对话记录/')) {
      throw new Error('.raw/对话记录 只能由 App 管理')
    }
  }
}

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
