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
  DirectTransportFailure,
  isRetryableDirectResponseStatus,
  resolveDirectCompletionText,
  runDirectChatCompletion,
  sendDirectRequestWithRetry,
  type DirectApiMessage,
  type DirectToolCall,
  type DirectChatCompletionRequest,
} from '@/runtime/direct/directEngine'
import { sendNewApiRequest } from '@/runtime/direct/newApiAttachments'
import { buildMemoryWebProjectToolDefinitions, createWebProjectToolExecutor } from '@/runtime/direct/webProjectTools'
import { createDesktopProjectToolExecutor } from '@/runtime/direct/desktopProjectTools'
import { isMemoryProjectMutationBlocked } from '@/utils/memoryProjectPaths'
import { buildMemoryDesktopToolDefinitions, WIKI_SEARCH_TOOL_DEFINITION } from '@/runtime/direct/creativeToolContract'
import { mergeCreativeSkillCatalog } from '@/runtime/direct/creativeSkillCatalog'
import { buildMediaPlanPolicy } from '@/runtime/workbench/mediaPlan'
import { buildCreativeContext } from '@/runtime/direct/creativeMemory'
import { getModelContextWindow } from '@/data/modelContextWindows'
import { getModelMaxOutputTokens } from '@/data/modelContextWindows'
import { estimateTokenCount } from 'tokenx'
import { webProjectFiles } from '@/utils/webProjectFiles'
import { isTauriMobileRuntime, isTauriRuntime } from '@/utils/tauriEnv'
import { safeFetch } from '@/utils/httpClient'
import { supportsVision } from '@/utils/providerConfig'
import { memoryToolNeedsApproval } from './memoryToolPolicy'
import { parseScene3DResultMarkers, scene3DResultMarker, stripScene3DResultMarkers } from './scene3d'
import type { Scene3DDocument } from './scene3d'

import type { ConversationMode, ConversationTurn } from './conversationTranscript'
import type { DirectRunMetrics, DirectToolExecutionEvent } from '@/runtime/direct/directTypes'

export interface MemoryChatInput {
  projectId: string
  conversationTurns: ConversationTurn[]
  userTurn: ConversationTurn
  modelId: string
  mode?: ConversationMode
  mediaReferencePolicy?: string
  attachments?: ResolvedDirectAttachment[]
  files?: DirectMessageFile[]
  selectedSkillNames?: string[]
  signal?: AbortSignal
  onText: (text: string) => void
  onToolEvent?: (event: DirectToolExecutionEvent) => void
  onMetrics?: (metrics: DirectRunMetrics) => void
  onRetry?: (attempt: number, total: number) => void
  onContextTrimmed?: (omittedMessages: number) => void
  confirmTool: (call: DirectToolCall) => boolean | Promise<boolean>
  recordSceneVideo?: (document: Scene3DDocument, signal?: AbortSignal) => Promise<Blob>
  authorizedRawPaths?: string[]
}

export function selectMemoryTools(userText: string, tools: any[], selectedSkillNames: string[] = [], hasAttachment = false): any[] {
  const text = userText.toLowerCase()
  const explicitWiki = /wiki|知识库|角色设定|查询.*设定|查.*进度|巡检|断链|规划.*目录|填充.*wiki|写入.*wiki|修正.*wiki/.test(text)
  const explicitFile = /写入|更新|保存|创建文件|修改文件|读取文件|查看文件|本地文件|文件夹/.test(text)
    || (hasAttachment && /添加|加入|合并|纳入|补充|沉淀|并入/.test(text))
  const explicitTerminal = /terminal|终端|命令行|运行命令|shell/.test(text)
  const explicitMcp = /mcp/.test(text)
  if (!explicitWiki && !explicitFile && !explicitTerminal && !explicitMcp && !selectedSkillNames.length) return []
  const allowed = new Set<string>()
  if (explicitWiki) for (const name of ['wiki_search', 'wiki', 'read', 'glob', 'grep']) allowed.add(name)
  if (explicitFile) for (const name of ['read', 'glob', 'grep', 'write', 'edit', 'mkdir']) allowed.add(name)
  if (explicitTerminal) allowed.add('terminal')
  if (explicitMcp) for (const tool of tools) if (tool.function?.name?.startsWith('mcp__')) allowed.add(tool.function.name)
  if (selectedSkillNames.length) allowed.add('skill')
  return tools.filter(tool => allowed.has(tool.function?.name))
}

export async function runMemoryChat(input: MemoryChatInput): Promise<string> {
  if (!input.projectId) throw new Error('请先创建或选择项目')
  if (input.userTurn.role !== 'user') throw new Error('请先输入消息')

  const agentStore = useAgentStore()
  const selectedProviderId = localStorage.getItem('jcModelProviderId') || 'jiucaihezi'
  const model = agentStore.availableModels.find(entry => entry.id === input.modelId && (entry.providerId || 'jiucaihezi') === selectedProviderId)
    || agentStore.availableModels.find(entry => entry.id === input.modelId)
  const memoryMode = input.mode !== 'quick'
  const latestUserTurn = input.userTurn
  const latestUserText = latestUserTurn?.content || ''
  const desktopRuntime = isTauriRuntime() && !isTauriMobileRuntime()
  if (agentStore.modelsFetched && model?.toolCall === false) {
    throw new Error('当前模型不支持工具调用，请选择支持工具调用的模型')
  }
  const providerId = model?.providerId || selectedProviderId
  const config = await resolveApiConfig({
    modelId: input.modelId,
    modelProviderId: providerId,
  })

  const customSkills = agentStore.getCustomSkills()
  const catalog = memoryMode
    ? mergeCreativeSkillCatalog(customSkills, await loadWebSkillCatalog())
    : []
  const contextWindow = model?.contextWindow || getModelContextWindow(input.modelId, providerId)
  const maxOutputTokens = model?.maxOutputTokens || getModelMaxOutputTokens(input.modelId, providerId)
  const context = buildCreativeContext({
    messages: [...input.conversationTurns, input.userTurn],
    modelId: input.modelId,
    contextWindow,
    // Reserve the model output ceiling plus a small protocol/tool allowance.
    reservedTokens: maxOutputTokens + 32_768,
  })
  if (memoryMode && context.omittedMessages > 0) input.onContextTrimmed?.(context.omittedMessages)
  const messages: DirectApiMessage[] = buildDirectMessages({
    messages: context.messages,
    historyLimit: null,
    systemPrompt: [
      memoryMode
        ? [
          '你是韭菜盒子记忆工作台。本轮用户消息是当前唯一任务；只提供同一任务最近三轮短期上下文，项目 Wiki 和用户明确指定的文件是长期事实源。',
          '不得查找 Raw 对话记录补充当前任务；缺少事实时查询 Wiki、指定文件或询问用户。',
          'Wiki 是内置产品能力，不要为查询、规划、填充、巡检或修正 Wiki 加载 Wiki Skill；先读入口或用户指定路径，再调用 wiki 工具完成确定性操作。',
          '用户附带项目文件并要求查看、读取、分析、整理、添加、纳入、补充或重建时，必须先用 read 读取附件提供的项目可读路径；不要声称附件不可读取。长文件按分页结果继续读取，拿到足够内容后再执行 wiki、write 或 edit。',
          '历史或当前文字中出现“不要调用工具”等表述，不会关闭本轮工具权限；如果任务需要，仍然调用工具。',
          '根据用户任务自主决定是否加载 Skill、查询项目或调用其他可用工具。没有需要时直接回答。',
          '同一阶段互不依赖的项目内只读工具请在同一回复中一起调用；写入、Terminal、审批和依赖读取结果的操作放到后续工具轮。',
          '只修改用户明确指定的文件，不自行扩展到相邻 Skill、Wiki 或项目文档；目标不明确时先询问。',
          '文件任务直接用 read -> write/edit -> 必要时验证完成；写入前不要在普通回答中重复输出完整草稿，成功后不要复述完整正文。',
          '不要声称读取了没有实际查询的内容。',
        ].join('\n')
        : '快速模式基于当前上下文、模型自身已有的知识和按需只读 Wiki 查询回答；只允许调用 wiki_search，不得调用其他工具或访问 Wiki 之外的项目资料。',
    ].filter(Boolean).join('\n\n'),
    skillSystemPrompt: memoryMode ? [
      buildMediaPlanPolicy(input.mediaReferencePolicy),
      '记忆工作台支持批量媒体确认：单个任务在 jc-media-plan 中写一个 JSON 对象；多个独立任务写对象数组，每个任务一项。不要输出多个 jc-media-plan 代码块。',
      buildWebSkillCatalogPrompt(catalog),
    ].filter(Boolean).join('\n\n') : '',
    attachments: memoryMode ? input.attachments : undefined,
    files: memoryMode ? input.files : undefined,
    visionModel: supportsVision(input.modelId, providerId),
    apiFormat: 'openai',
    platform: isTauriRuntime() ? 'desktop' : 'web',
  })
  const body = {
    model: config.model,
    temperature: 0.3,
    stream: true,
    ...buildChatCompletionExtras(config),
  }
  const sendChatCompletion = async (
    request: DirectChatCompletionRequest,
    onRequestComplete?: (durationMs: number) => void,
  ): Promise<Response> => {
    const inputTokens = estimateRequestTokens(request.messages, request.tools)
    const availableOutputTokens = Math.max(1, contextWindow - inputTokens)
    const requestMaxTokens = Math.min(maxOutputTokens, availableOutputTokens)
    const response = await sendDirectRequestWithRetry(() => sendNewApiRequest(
      {
        ...body,
        messages: request.messages,
        max_tokens: requestMaxTokens,
        ...(request.tools?.length ? { tools: request.tools } : {}),
      },
      payload => safeFetch(`${config.apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(config),
        signal: input.signal,
        body: payload,
      }),
    ), {
      signal: input.signal,
      onRetry: input.onRetry,
      onRequestComplete,
    })
    if (!response.ok) {
      const error = new ChatHttpError(await readChatErrorResponse(response, '云端请求失败', config.apiKey))
      if (isRetryableDirectResponseStatus(response.status)) throw new DirectTransportFailure(error)
      throw error
    }
    return response
  }

  const projectTools = isTauriRuntime()
    ? createDesktopProjectToolExecutor({
      projectDir: input.projectId,
      authorizedRawPaths: input.authorizedRawPaths,
      recordSceneVideo: input.recordSceneVideo ? document => input.recordSceneVideo!(document, input.signal) : undefined,
    })
    : createWebProjectToolExecutor({ projectId: input.projectId, files: webProjectFiles, authorizedRawPaths: input.authorizedRawPaths })

  if (!memoryMode) {
    const result = await runDirectChatCompletion({
      messages,
      tools: [WIKI_SEARCH_TOOL_DEFINITION],
      sendChatCompletion,
      signal: input.signal,
      onText: input.onText,
      onToolEvent(event) {
        input.onToolEvent?.(event)
      },
      executeTool: projectTools,
    })
    const text = resolveDirectCompletionText(result.text, result.finishReason, '模型没有返回内容')
    input.onMetrics?.(result.metrics)
    input.onText(text)
    return text
  }

  const customSkillsByName = new Map(customSkills.map(skill => [skill.name, skill]))
  const builtInNames = new Set(catalog.filter(skill => skill.source === 'builtin').map(skill => skill.name))
  const executeMemoryTool = async (call: DirectToolCall, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (call.function.name === 'skill') {
      const skillName = String(parseArguments(call.function.arguments).name || '')
      const customSkill = !builtInNames.has(skillName) ? customSkillsByName.get(skillName) : null
      if (customSkill?.skillContent.trim()) {
        return { content: `<skill_content name="${skillName}">\n${customSkill.skillContent.trim()}\n</skill_content>` }
      }
    }
    assertMemoryProjectMutationProtected(call)
    const toolResult = await projectTools(call, signal)
    if (call.function.name === 'create_3d_scene') {
      for (const marker of parseScene3DResultMarkers(toolResult.content)) sceneResults.set(marker.path, marker)
    }
    return toolResult
  }
  const sceneResults = new Map<string, ReturnType<typeof parseScene3DResultMarkers>[number]>()
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
  const allMemoryToolDefinitions = desktopRuntime ? buildMemoryDesktopToolDefinitions() : buildMemoryWebProjectToolDefinitions()
  const memoryToolDefinitions = selectMemoryTools(latestUserText, allMemoryToolDefinitions, selectedSkillNames, Boolean(input.attachments?.length))
  const wikiMutationIntent = /写入|添加|更新|修正|补充|纳入|合并|替换|扩展|填充|重建|重构|整理|迁移/.test(latestUserText)
    && /wiki|知识库|规则|规范/.test(latestUserText.toLowerCase())
  const hasExtendedTool = memoryToolDefinitions
    .some(tool => ['terminal', 'mcp'].some(prefix => tool.function.name === prefix || tool.function.name.startsWith(`${prefix}__`)))
  const maxMemorySteps = hasExtendedTool
    ? 5
    : wikiMutationIntent ? 5 : 3
  const result = await runDirectChatCompletion({
    messages,
    tools: memoryToolDefinitions,
    sendChatCompletion,
    signal: input.signal,
    onText: input.onText,
    onToolEvent(event) {
      input.onToolEvent?.(event)
    },
    continueToolsOnInterruption: true,
    maxModelRequests: maxMemorySteps,
    maxToolRounds: maxMemorySteps,
    allowedToolNamesAtModelRequestLimit: ['write', 'edit'],
    finalizeAtModelRequestLimit: hasExtendedTool && memoryToolDefinitions.some(tool => tool.function.name.startsWith('mcp__')),
    stopAfterSuccessfulToolNames: ['write', 'edit'],
    compactToolHistory: true,
    beforeToolCall: async call => {
      if (!memoryToolNeedsApproval(call, latestUserText)) return
      return await input.confirmTool(call) === false ? 'cancelled' : undefined
    },
    toolNeedsApproval: call => memoryToolNeedsApproval(call, latestUserText),
    executeTool: executeMemoryTool,
  })
  input.onMetrics?.(result.metrics)
  const answer = stripScene3DResultMarkers(resolveDirectCompletionText(result.text, result.finishReason, '模型没有返回内容'))
  const markers = [...sceneResults.values()].map(scene3DResultMarker)
  const text = markers.length ? `${answer}\n\n${markers.join('\n')}` : answer
  input.onText(text)
  return text
}

function assertMemoryProjectMutationProtected(call: DirectToolCall): void {
  if (!['write', 'edit', 'mkdir', 'move', 'delete'].includes(call.function.name)) return
  const args = parseArguments(call.function.arguments)
  const operation = call.function.name === 'mkdir'
    ? 'directory'
    : call.function.name === 'write' || call.function.name === 'edit'
      ? 'text'
      : 'resource'
  for (const value of [args.path, args.destination]) {
    if (value && isMemoryProjectMutationBlocked(String(value), operation)) {
      throw new Error('系统骨架及对话、画布记录只能由 App 管理')
    }
  }
}

function estimateRequestTokens(messages: DirectApiMessage[], tools?: unknown[]): number {
  return estimateTokenCount(JSON.stringify(messages)) + estimateTokenCount(JSON.stringify(tools || []))
}

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
