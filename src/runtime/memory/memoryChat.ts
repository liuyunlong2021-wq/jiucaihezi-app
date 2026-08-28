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
import {
  buildMemoryWebProjectToolDefinitions,
  createWebProjectToolExecutor,
} from '@/runtime/direct/webProjectTools'
import { createDesktopProjectToolExecutor } from '@/runtime/direct/desktopProjectTools'
import { isMemoryProjectMutationBlocked } from '@/utils/memoryProjectPaths'
import {
  buildMemoryDesktopToolDefinitions,
  WIKI_CONTEXT_TOOL_DEFINITION,
} from '@/runtime/direct/creativeToolContract'
import { resolveCreativeProjectPath } from '@/runtime/direct/creativeToolContract'
import { wikiPlanConfirmationId } from '@/runtime/direct/wikiRuntime'
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
import { WIKI_AGENT_POLICY } from './wikiAgent'
import { runWikiTwoPhase } from './wikiTwoPhase'
import {
  parseScene3DResultMarkers,
  scene3DResultMarker,
  stripScene3DResultMarkers,
} from './scene3d'
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
  wikiSelected?: boolean
  fileToolsSelected?: boolean
  selectedMcpToolNames?: string[]
  mediaSelected?: boolean
  scene3dSelected?: boolean
  terminalSelected?: boolean
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

export function hasExplicitMemoryCapability(
  input: Pick<
    MemoryChatInput,
    | 'selectedSkillNames'
    | 'wikiSelected'
    | 'fileToolsSelected'
    | 'selectedMcpToolNames'
    | 'mediaSelected'
    | 'scene3dSelected'
    | 'terminalSelected'
    | 'attachments'
  >,
): boolean {
  return Boolean(
    input.selectedSkillNames?.length ||
    input.wikiSelected ||
    input.fileToolsSelected ||
    input.selectedMcpToolNames?.length ||
    input.mediaSelected ||
    input.scene3dSelected ||
    input.terminalSelected,
  )
}

export function selectMemoryTools(
  tools: any[],
  selectedSkillNames: string[] = [],
  wikiSelected = false,
  attachmentNeedsRead = false,
  fileToolsSelected = false,
  selectedMcpToolNames: string[] = [],
  mediaSelected = false,
  scene3dSelected = false,
  terminalSelected = false,
): any[] {
  const allowed = new Set<string>()
  if (wikiSelected) {
    allowed.add(WIKI_CONTEXT_TOOL_DEFINITION.function.name)
    allowed.add('wiki')
  }
  // Selected Skills are preloaded as context; there is no generic Skill loader to expand scope.
  if (attachmentNeedsRead) allowed.add('read')
  if (fileToolsSelected)
    for (const name of ['read', 'glob', 'grep', 'write', 'edit', 'mkdir']) allowed.add(name)
  for (const tool of tools)
    if (selectedMcpToolNames.includes(tool.function?.name)) allowed.add(tool.function.name)
  if (mediaSelected)
    for (const name of [
      'create_document',
      'create_html',
      'export_markdown_png',
      'export_markdown_slides',
    ])
      allowed.add(name)
  if (scene3dSelected) allowed.add('create_3d_scene')
  if (terminalSelected) allowed.add('terminal')
  return tools.filter(tool => allowed.has(tool.function?.name))
}

export async function runMemoryChat(input: MemoryChatInput): Promise<string> {
  if (!input.projectId) throw new Error('请先创建或选择项目')
  if (input.userTurn.role !== 'user') throw new Error('请先输入消息')

  const agentStore = useAgentStore()
  const selectedProviderId = localStorage.getItem('jcModelProviderId') || 'jiucaihezi'
  const model =
    agentStore.availableModels.find(
      entry =>
        entry.id === input.modelId && (entry.providerId || 'jiucaihezi') === selectedProviderId,
    ) || agentStore.availableModels.find(entry => entry.id === input.modelId)
  const memoryMode = input.mode !== 'quick'
  const latestUserTurn = input.userTurn
  const latestUserText = latestUserTurn?.content || ''
  const desktopRuntime = isTauriRuntime() && !isTauriMobileRuntime()
  const explicitCapabilitySelected = hasExplicitMemoryCapability(input)
  if (explicitCapabilitySelected && agentStore.modelsFetched && model?.toolCall === false) {
    throw new Error('当前模型不支持工具调用，请选择支持工具调用的模型')
  }
  const providerId = model?.providerId || selectedProviderId
  const config = await resolveApiConfig({
    modelId: input.modelId,
    modelProviderId: providerId,
  })

  const customSkills = explicitCapabilitySelected ? agentStore.getCustomSkills() : []
  const catalog = selectedSkillNamesForInput(input).length
    ? mergeCreativeSkillCatalog(customSkills, await loadWebSkillCatalog())
    : []
  const contextWindow = model?.contextWindow || getModelContextWindow(input.modelId, providerId)
  const maxOutputTokens =
    model?.maxOutputTokens || getModelMaxOutputTokens(input.modelId, providerId)
  const context = explicitCapabilitySelected
    ? buildCreativeContext({
        messages: [...input.conversationTurns, input.userTurn],
        modelId: input.modelId,
        contextWindow,
        // Reserve the model output ceiling plus a small protocol/tool allowance.
        reservedTokens: maxOutputTokens + 32_768,
      })
    : { messages: [input.userTurn], omittedMessages: 0 }
  if (memoryMode && context.omittedMessages > 0) input.onContextTrimmed?.(context.omittedMessages)
  const messages: DirectApiMessage[] = buildDirectMessages({
    messages: context.messages,
    historyLimit: null,
    systemPrompt: [
      !explicitCapabilitySelected
        ? '只回答当前用户消息。不要读取历史、Wiki、Skill、项目文件或任何工具；不要把模型自身的工具能力暴露给本轮任务。'
        : memoryMode
          ? [
              '你是韭菜盒子记忆工作台。本轮用户消息是当前唯一任务；只提供同一任务最近三轮短期上下文，项目 Wiki 和用户明确指定的文件是长期事实源。',
              '不得查找 Raw 对话记录补充当前任务；缺少事实时查询 Wiki、指定文件或询问用户。',
              'Wiki 是内置产品能力；@Wiki 只提供 wiki_context 和 wiki。先用 wiki_context 读取入口、目录或明确页面，再按证据回答；不得修改 Wiki 根目录之外的文件。',
              '用户要求修改 Wiki 时，调用 wiki action=apply 一次提交 operations；程序负责导航、双链、来源、日志、冲突检查、回滚和验证。普通写入无需审批，移动和回收必须先展示完整计划并取得确认。工具成功后输出简短回执。',
              '用户要求根据文档创建、新建、建立或搭建 Wiki 时，直接调用一次 wiki scaffold：用 plan 提交完整目录、Markdown 文件正文和 index.md 导航，由程序批量落盘；不要逐个调用 mkdir、write 或 edit。',
              '用户附带项目文件时，附件正文已随消息提供就直接使用；只有附件仅提供项目可读路径时，才必须先用 read 读取。不要声称附件不可读取；长文件按分页结果继续读取到足够内容。',
              '历史或当前文字中出现“不要调用工具”等表述，不会关闭本轮工具权限；如果任务需要，仍然调用工具。',
              '根据用户任务自主决定是否加载 Skill、查询项目或调用其他可用工具。没有需要时直接回答。',
              '同一阶段互不依赖的项目内只读工具请在同一回复中一起调用；写入、Terminal、审批和依赖读取结果的操作放到后续工具轮。',
              '只修改用户明确指定的文件，不自行扩展到相邻 Skill、Wiki 或项目文档；目标不明确时先询问。',
              '文件任务直接用 read -> write/edit -> 必要时验证完成；写入前不要在普通回答中重复输出完整草稿，成功后不要复述完整正文。',
              '写入目标尚不存在时，不要反复 read/glob 该目标；检查最近的已有父目录后，直接 mkdir/write 创建。用户给出当前项目绝对路径时按项目内路径处理。',
              '不要声称读取了没有实际查询的内容。',
              WIKI_AGENT_POLICY,
            ].join('\n')
          : '快速模式基于当前上下文、模型自身已有的知识和按需只读 Wiki 查询回答；只允许调用 wiki_context，不得调用其他工具或访问 Wiki 之外的项目资料。',
    ]
      .filter(Boolean)
      .join('\n\n'),
    skillSystemPrompt:
      explicitCapabilitySelected && memoryMode
        ? [
            buildMediaPlanPolicy(input.mediaReferencePolicy),
            '记忆工作台支持批量媒体确认：单个任务在 jc-media-plan 中写一个 JSON 对象；多个独立任务写对象数组，每个任务一项。不要输出多个 jc-media-plan 代码块。',
            buildWebSkillCatalogPrompt(catalog),
          ]
            .filter(Boolean)
            .join('\n\n')
        : '',
    // oxfmt-ignore
    attachments: memoryMode ? input.attachments : (input.attachments?.length ? input.attachments : undefined),
    // oxfmt-ignore
    files: memoryMode ? input.files : (input.files?.length ? input.files : undefined),
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
    const response = await sendDirectRequestWithRetry(
      () =>
        sendNewApiRequest(
          {
            ...body,
            messages: request.messages,
            max_tokens: requestMaxTokens,
            ...(request.tools?.length ? { tools: request.tools } : {}),
          },
          payload =>
            safeFetch(`${config.apiBase}/v1/chat/completions`, {
              method: 'POST',
              headers: buildHeaders(config),
              signal: input.signal,
              body: payload,
            }),
        ),
      {
        signal: input.signal,
        onRetry: input.onRetry,
        onRequestComplete,
      },
    )
    if (!response.ok) {
      const error = new ChatHttpError(
        await readChatErrorResponse(response, '云端请求失败', config.apiKey),
      )
      if (isRetryableDirectResponseStatus(response.status)) throw new DirectTransportFailure(error)
      throw error
    }
    return response
  }

  if (!explicitCapabilitySelected) {
    const result = await runDirectChatCompletion({
      messages,
      tools: undefined,
      sendChatCompletion,
      signal: input.signal,
      onText: input.onText,
    })
    const text = resolveDirectCompletionText(result.text, result.finishReason, '模型没有返回内容')
    input.onMetrics?.(result.metrics)
    input.onText(text)
    return text
  }

  const projectTools = isTauriRuntime()
    ? createDesktopProjectToolExecutor({
        projectDir: input.projectId,
        authorizedRawPaths: input.authorizedRawPaths,
        recordSceneVideo: input.recordSceneVideo
          ? document => input.recordSceneVideo!(document, input.signal)
          : undefined,
      })
    : createWebProjectToolExecutor({
        projectId: input.projectId,
        files: webProjectFiles,
        authorizedRawPaths: input.authorizedRawPaths,
      })

  const customSkillsByName = new Map(customSkills.map(skill => [skill.name, skill]))
  const builtInNames = new Set(
    catalog.filter(skill => skill.source === 'builtin').map(skill => skill.name),
  )
  const wikiSearchSignatures = new Set<string>()
  const executeMemoryTool = async (call: DirectToolCall, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (call.function.name === 'wiki_context') {
      const args = parseArguments(call.function.arguments)
      if (args.action === 'search') {
        const signature = JSON.stringify({
          query: args.query,
          scope: args.scope || 'active',
        })
        if (wikiSearchSignatures.has(signature))
          throw new Error('相同 Wiki 搜索已执行，拒绝重复检索')
        wikiSearchSignatures.add(signature)
      }
    }
    if (call.function.name === 'skill') {
      const skillName = String(parseArguments(call.function.arguments).name || '')
      const customSkill = !builtInNames.has(skillName) ? customSkillsByName.get(skillName) : null
      if (customSkill?.skillContent.trim()) {
        return {
          content: `<skill_content name="${skillName}">\n${customSkill.skillContent.trim()}\n</skill_content>`,
        }
      }
    }
    assertMemoryProjectMutationProtected(call, input.projectId)
    const toolResult = await projectTools(call, signal)
    if (call.function.name === 'create_3d_scene') {
      for (const marker of parseScene3DResultMarkers(toolResult.content))
        sceneResults.set(marker.path, marker)
    }
    return toolResult
  }
  const sceneResults = new Map<string, ReturnType<typeof parseScene3DResultMarkers>[number]>()
  const selectedSkillNames = selectedSkillNamesForInput(input)
  const unknownSkill = selectedSkillNames.find(name => !catalog.some(skill => skill.name === name))
  if (unknownSkill) throw new Error(`Skill 不存在或未启用: ${unknownSkill}`)
  if (selectedSkillNames.length) {
    messages.push(
      ...(await buildToolResultMessages(
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
      )),
    )
  }
  const allMemoryToolDefinitions = desktopRuntime
    ? buildMemoryDesktopToolDefinitions()
    : buildMemoryWebProjectToolDefinitions()
  const memoryToolDefinitions = selectMemoryTools(
    allMemoryToolDefinitions,
    selectedSkillNames,
    Boolean(input.wikiSelected),
    Boolean(
      input.attachments?.some(
        attachment =>
          attachment.kind === 'file' && attachment.readablePath && !attachment.textContent,
      ),
    ),
    Boolean(input.fileToolsSelected),
    input.selectedMcpToolNames || [],
    Boolean(input.mediaSelected),
    Boolean(input.scene3dSelected),
    Boolean(input.terminalSelected),
  )
  const wikiOnlyTask = Boolean(
    input.wikiSelected &&
    !input.fileToolsSelected &&
    !input.selectedMcpToolNames?.length &&
    !input.mediaSelected &&
    !input.scene3dSelected &&
    !input.terminalSelected,
  )
  if (wikiOnlyTask) {
    const entryCall: DirectToolCall = {
      id: 'wiki_entry_preflight',
      type: 'function',
      function: { name: 'wiki_context', arguments: JSON.stringify({ action: 'entry' }) },
    }
    const entryResult = await projectTools(entryCall, input.signal)
    if (entryResult.status !== 'succeeded')
      throw new Error(entryResult.content || 'Wiki 入口读取未完成')
    const phaseResult = await runWikiTwoPhase({
      runId: `wiki-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      messages,
      task: latestUserText,
      entryResult: entryResult.content,
      sendChatCompletion,
      signal: input.signal,
      executeWiki: async call => {
        if (
          call.function.name === 'wiki' &&
          memoryToolNeedsApproval(call, latestUserText, input.projectId)
        ) {
          const approvalArgs = parseArguments(call.function.arguments)
          if (approvalArgs.action === 'apply' && Array.isArray(approvalArgs.operations)) {
            call = {
              ...call,
              function: {
                ...call.function,
                arguments: JSON.stringify({
                  ...approvalArgs,
                  confirmedPlanId: wikiPlanConfirmationId(approvalArgs as never),
                }),
              },
            }
          }
          if (!(await input.confirmTool(call)))
            return { content: '操作已取消', status: 'cancelled' }
        }
        const result = await projectTools(call, input.signal)
        input.onToolEvent?.({
          type: 'tool_execution_end',
          call,
          result,
          status: result.status || 'succeeded',
          durationMs: 0,
        })
        return result
      },
    })
    input.onMetrics?.(phaseResult.metrics)
    const text = phaseResult.applyResult
      ? `${phaseResult.text}\n\n${phaseResult.applyResult}`
      : phaseResult.text
    input.onText(text)
    return text
  }
  const hasExtendedTool = memoryToolDefinitions.some(tool =>
    ['terminal', 'mcp'].some(
      prefix => tool.function.name === prefix || tool.function.name.startsWith(`${prefix}__`),
    ),
  )
  const maxMemorySteps = hasExtendedTool ? 5 : 3
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
    finalizeAtModelRequestLimit:
      !input.wikiSelected &&
      hasExtendedTool &&
      memoryToolDefinitions.some(tool => tool.function.name.startsWith('mcp__')),
    stopAfterSuccessfulToolNames: ['write', 'edit'],
    compactToolHistory: true,
    beforeToolCall: async call => {
      if (!memoryToolNeedsApproval(call, latestUserText, input.projectId)) return
      return (await input.confirmTool(call)) === false ? 'cancelled' : undefined
    },
    toolNeedsApproval: call => memoryToolNeedsApproval(call, latestUserText, input.projectId),
    executeTool: executeMemoryTool,
  })
  input.onMetrics?.(result.metrics)
  const answer = stripScene3DResultMarkers(
    resolveDirectCompletionText(result.text, result.finishReason, '模型没有返回内容'),
  )
  const markers = [...sceneResults.values()].map(scene3DResultMarker)
  const text = markers.length ? `${answer}\n\n${markers.join('\n')}` : answer
  input.onText(text)
  return text
}

function assertMemoryProjectMutationProtected(call: DirectToolCall, projectId: string): void {
  if (!['write', 'edit', 'mkdir', 'move', 'delete'].includes(call.function.name)) return
  const args = parseArguments(call.function.arguments)
  const operation =
    call.function.name === 'mkdir'
      ? 'directory'
      : call.function.name === 'write' || call.function.name === 'edit'
        ? 'text'
        : 'resource'
  for (const value of [args.path, args.destination]) {
    const path = value ? resolveCreativeProjectPath(String(value), projectId, true).path : ''
    if (path && isMemoryProjectMutationBlocked(path, operation)) {
      throw new Error('系统骨架及对话、画布记录只能由 App 管理')
    }
  }
}

function estimateRequestTokens(messages: DirectApiMessage[], tools?: unknown[]): number {
  return (
    estimateTokenCount(JSON.stringify(messages)) + estimateTokenCount(JSON.stringify(tools || []))
  )
}

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function selectedSkillNamesForInput(input: Pick<MemoryChatInput, 'selectedSkillNames'>): string[] {
  return [...new Set(input.selectedSkillNames || [])]
}
