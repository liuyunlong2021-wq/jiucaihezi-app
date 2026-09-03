import { useAgentStore } from '@/stores/agentStore'
import { createRuntimeProjectFileService } from '@/services/projectFileService'
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
import {
  buildWebSkillCatalogPrompt,
  loadWebSkillByName,
  loadWebSkillCatalog,
} from '@/utils/skillContentResolver'
import {
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
import type { DirectToolExecutor, DirectToolResult } from '@/runtime/direct/directTypes'
import {
  buildMemoryWebProjectToolDefinitions,
  createWebProjectToolExecutor,
} from '@/runtime/direct/webProjectTools'
import { createDesktopProjectToolExecutor } from '@/runtime/direct/desktopProjectTools'
import { isMemoryProjectMutationBlocked } from '@/utils/memoryProjectPaths'
import { queryConversationMemoryIndex } from './conversationMemoryIndex'
import {
  buildMemoryDesktopToolDefinitions,
  parseCreativeToolArguments,
  TOOL_DESCRIBE_TOOL_DEFINITION,
  TOOL_SEARCH_TOOL_DEFINITION,
  MEMORY_SEARCH_TOOL_DEFINITION,
} from '@/runtime/direct/creativeToolContract'
import { resolveCreativeProjectPath } from '@/runtime/direct/creativeToolContract'
import { mergeCreativeSkillCatalog } from '@/runtime/direct/creativeSkillCatalog'
import { buildMediaPlanPolicy } from '@/runtime/workbench/mediaPlan'
import { buildCreativeContext } from '@/runtime/direct/creativeMemory'
import { getModelContextWindow } from '@/data/modelContextWindows'
import { getModelMaxOutputTokens } from '@/data/modelContextWindows'
import { estimateTokenCount } from 'tokenx'
import { webProjectFiles } from '@/utils/webProjectFiles'
import { invoke } from '@tauri-apps/api/core'

export function normalizeMemoryToolResult(result: DirectToolResult): DirectToolResult {
  return { ...result, status: result.status ?? 'succeeded' }
}
import { isTauriMobileRuntime, isTauriRuntime } from '@/utils/tauriEnv'
import { safeFetch } from '@/utils/httpClient'
import { supportsVision } from '@/utils/providerConfig'
import { memoryToolNeedsApproval } from './memoryToolPolicy'
import {
  parseScene3DResultMarkers,
  scene3DResultMarker,
  stripScene3DResultMarkers,
} from './scene3d'
import type { Scene3DDocument } from './scene3d'

import type { ConversationTurn } from './conversationTranscript'
import type { DirectRunMetrics, DirectToolExecutionEvent } from '@/runtime/direct/directTypes'
import { parseSkillMd, serializeToSkillMd, type SkillConfig } from '@/types/skill'
import { describeToolDefinition, searchToolDefinitions } from '@/runtime/direct/toolSearch'
import {
  ALL_SKILL_TOOLS,
} from '@/utils/skillTestRunner'
import { executeSkillCreatorToolCall, isSkillCreatorToolName } from './skillCreatorToolExecutor'

export interface MemoryChatInput {
  projectId?: string
  conversationId?: string
  conversationTurns: ConversationTurn[]
  userTurn: ConversationTurn
  modelId: string
  mediaReferencePolicy?: string
  attachments?: ResolvedDirectAttachment[]
  files?: DirectMessageFile[]
  selectedSkillNames?: string[]
  fileToolsSelected?: boolean
  selectedMcpToolNames?: string[]
  mediaSelected?: boolean
  avSelected?: boolean
  scene3dSelected?: boolean
  terminalSelected?: boolean
  signal?: AbortSignal
  onText: (text: string) => void
  onToolEvent?: (event: DirectToolExecutionEvent) => void
  onProgramStatus?: (status: MemoryProgramStatus) => void
  onMetrics?: (metrics: DirectRunMetrics) => void
  onRetry?: (attempt: number, total: number) => void
  onContextTrimmed?: (omittedMessages: number) => void
  confirmTool: (call: DirectToolCall) => boolean | Promise<boolean>
  recordSceneVideo?: (document: Scene3DDocument, signal?: AbortSignal) => Promise<Blob>
  authorizedRawPaths?: string[]
}

export interface MemoryProgramStatus {
  kind: 'file' | 'media' | '3d' | 'terminal' | 'mcp'
  status: 'succeeded' | 'failed' | 'cancelled'
  paths: string[]
  reason?: string
  toolName?: string
}

export function hasExplicitMemoryCapability(
  input: Pick<
    MemoryChatInput,
    | 'selectedSkillNames'
    | 'fileToolsSelected'
    | 'selectedMcpToolNames'
    | 'mediaSelected'
    | 'avSelected'
    | 'scene3dSelected'
    | 'terminalSelected'
    | 'attachments'
  >,
): boolean {
  return Boolean(
    input.selectedSkillNames?.length ||
    input.fileToolsSelected ||
    input.selectedMcpToolNames?.length ||
    input.mediaSelected ||
    input.avSelected ||
    input.scene3dSelected ||
    input.terminalSelected,
  )
}

export function selectMemoryTools(
  tools: any[],
  selectedSkillNames: string[] = [],
  knowledgeFilesSelected = false,
  attachmentNeedsRead = false,
  fileToolsSelected = false,
  selectedMcpToolNames: string[] = [],
  mediaSelected = false,
  scene3dSelected = false,
  terminalSelected = false,
  skillAllowedToolNames: string[] = [],
): any[] {
  const allowed = new Set<string>()
  // T4: memory_search is now a native tool, always available
  allowed.add('memory_search')
  // T5: jc-jiyi retired - conversation_memory_query only for backward compatibility
  if (selectedSkillNames.includes('jc-jiyi')) allowed.add('conversation_memory_query')
  if (knowledgeFilesSelected)
    for (const name of ['read', 'glob', 'grep', 'write', 'edit', 'mkdir', 'move', 'delete'])
      allowed.add(name)
  if (attachmentNeedsRead) allowed.add('read')
  if (fileToolsSelected)
    for (const name of ['read', 'glob', 'grep', 'write', 'edit', 'mkdir', 'move', 'delete'])
      allowed.add(name)
  const selectedTools = new Set([
    ...selectedMcpToolNames.map(name => String(name || '').trim()),
    ...normalizeSkillAllowedToolNames(selectedMcpToolNames),
  ])
  for (const tool of tools)
    if (selectedTools.has(tool.function?.name)) allowed.add(tool.function.name)
  if (mediaSelected)
    for (const name of [
      'create_document',
      'create_html',
      'export_markdown_png',
      'export_markdown_slides',
    ])
      allowed.add(name)
  if (scene3dSelected)
    for (const name of ['create_3d_scene', 'edit_3d_scene', 'export_3d_scene_video'])
      allowed.add(name)
  if (terminalSelected) allowed.add('terminal')
  for (const name of [...skillAllowedToolNames, ...normalizeSkillAllowedToolNames(skillAllowedToolNames)]) allowed.add(name)
  return tools.filter(tool => allowed.has(tool.function?.name))
}

export function normalizeSkillAllowedToolNames(names: Iterable<string>): string[] {
  const expanded = new Set<string>()
  for (const raw of names) {
    const name = String(raw || '').trim()
    if (!name) continue
    if (name === 'file') {
      for (const tool of ['read', 'glob', 'grep', 'write', 'edit', 'mkdir', 'move', 'delete']) expanded.add(tool)
    } else if (name === 'media' || name === 'av') {
      for (const tool of ['export_markdown_png', 'create_document', 'create_html', 'export_markdown_slides']) expanded.add(tool)
    } else if (name === '3d') {
      for (const tool of ['create_3d_scene', 'edit_3d_scene', 'export_3d_scene_video']) expanded.add(tool)
    } else if (/^mcp__[^_]+__.+$/.test(name)) {
      expanded.add(name.replace(/^((?:mcp__[^_]+)__).+$/, '$1').replace(/__$/, ''))
    } else expanded.add(name)
  }
  return [...expanded]
}

export function resolveMemoryToolSearchDefinitions(
  authorizedTools: any[],
  describedToolNames: ReadonlySet<string>,
  directlyExposedToolNames: ReadonlySet<string> = new Set(),
): any[] {
  const exposed = new Set<string>()
  return [
    ...authorizedTools.filter(tool => directlyExposedToolNames.has(tool.function?.name)),
    TOOL_SEARCH_TOOL_DEFINITION,
    TOOL_DESCRIBE_TOOL_DEFINITION,
    ...authorizedTools.filter(tool => describedToolNames.has(tool.function?.name)),
  ].filter(tool => {
    const name = tool.function?.name
    if (!name || exposed.has(name)) return false
    exposed.add(name)
    return true
  })
}

export async function runMemoryChat(input: MemoryChatInput): Promise<string> {
  if (input.userTurn.role !== 'user') throw new Error('请先输入消息')

  const agentStore = useAgentStore()
  const selectedProviderId = localStorage.getItem('jcModelProviderId') || 'jiucaihezi'
  const model =
    agentStore.availableModels.find(
      entry =>
        entry.id === input.modelId && (entry.providerId || 'jiucaihezi') === selectedProviderId,
    ) || agentStore.availableModels.find(entry => entry.id === input.modelId)
  const latestUserTurn = input.userTurn
  const latestUserText = latestUserTurn?.content || ''
  const desktopRuntime = isTauriRuntime() && !isTauriMobileRuntime()
  const explicitCapabilitySelected = hasExplicitMemoryCapability(input)
  if (explicitCapabilitySelected && !input.projectId) throw new Error('请先创建或选择项目')
  if (explicitCapabilitySelected && agentStore.modelsFetched && model?.toolCall === false) {
    throw new Error('当前模型不支持工具调用，请选择支持工具调用的模型')
  }
  const providerId = model?.providerId || selectedProviderId
  const config = await resolveApiConfig({
    modelId: input.modelId,
    modelProviderId: providerId,
  })

  const customSkills = explicitCapabilitySelected ? agentStore.getCustomSkills() : []
  const selectedSkillNames = selectedSkillNamesForInput(input)
  const customSkillsByName = new Map(customSkills.map(skill => [skill.name, skill]))
  let catalog: ReturnType<typeof mergeCreativeSkillCatalog> = []
  let catalogError = ''
  if (selectedSkillNames.length) {
    try {
      catalog = mergeCreativeSkillCatalog(customSkills, await loadWebSkillCatalog())
    } catch (error) {
      catalogError = error instanceof Error ? error.message : String(error)
    }
  }
  const unknownSkill = selectedSkillNames.find(
    name => !customSkillsByName.has(name) && !catalog.some(skill => skill.name === name),
  )
  if (unknownSkill && !catalogError) throw new Error(`Skill 不存在或未启用: ${unknownSkill}`)
  const skillAllowedToolNames = new Set<string>()
  const selectedSkillPrompt = await buildSelectedSkillPrompt(
    selectedSkillNames,
    customSkillsByName,
    loadWebSkillByName,
    skillAllowedToolNames,
  )
  const contextWindow = model?.contextWindow || getModelContextWindow(input.modelId, providerId)
  const maxOutputTokens =
    model?.maxOutputTokens || getModelMaxOutputTokens(input.modelId, providerId)
  // T1: Always build context with recent history, regardless of capability selection
  const context = buildCreativeContext({
    messages: [...input.conversationTurns, input.userTurn],
    modelId: input.modelId,
    contextWindow,
    // Reserve the model output ceiling plus a small protocol/tool allowance.
    reservedTokens: maxOutputTokens + Math.min(32_768, Math.max(2_048, Math.floor(contextWindow * 0.1))),
  })
  if (context.omittedMessages > 0) input.onContextTrimmed?.(context.omittedMessages)
  const messages: DirectApiMessage[] = buildDirectMessages({
    messages: context.messages,
    historyLimit: null,
    systemPrompt: [
      !explicitCapabilitySelected
        ? '你是韭菜盒子记忆工作台。已提供最近轮次对话历史保持连续；回答当前用户消息。本轮未选择 Skill 或工具，不要使用任何工具能力。'
        : [
            '你是韭菜盒子记忆工作台。本轮用户消息是当前唯一任务；只提供同一任务最近三轮短期上下文，用户明确指定的项目文件是长期事实源。',
            '不得查找 Raw 对话记录补充当前任务；缺少事实时查询指定文件或询问用户。',
            '项目知识与创作资料都是普通文件。按需使用 read、glob、grep 查询，使用 write、edit、mkdir、move、delete 修改；不启用特殊 Agent 或第二阶段协议。',
            '用户附带项目文件时，附件正文已随消息提供就直接使用；只有附件仅提供项目可读路径时，才必须先用 read 读取。不要声称附件不可读取；长文件按分页结果继续读取到足够内容。',
            '历史或当前文字中出现“不要调用工具”等表述，不会关闭本轮工具权限；如果任务需要，仍然调用工具。',
            selectedSkillNames.length
              ? '用户已选具体 Skill，程序已经加载其完整规则；必须遵守该 Skill，不得再次决定是否加载、跳过或替换它。'
              : '用户未选择 Skill；本轮不加载其他 Skill。需要方法约束时请用户明确选择具体 Skill。',
            '同一阶段互不依赖的项目内只读工具请在同一回复中一起调用；写入、Terminal、审批和依赖读取结果的操作放到后续工具轮。',
            '需要未直接展示的能力时，先用 tool_search 搜索当前白名单，再用 tool_describe 获取精确 schema；只有描述成功的工具才会在下一轮开放。',
            '只修改用户明确指定的文件，不自行扩展到相邻 Skill 或项目文档；目标不明确时先询问。',
            '文件任务直接用 read -> write/edit -> 必要时验证完成；写入前不要在普通回答中重复输出完整草稿，成功后不要复述完整正文。',
            '写入目标尚不存在时，不要反复 read/glob 该目标；检查最近的已有父目录后，直接 mkdir/write 创建。用户给出当前项目绝对路径时按项目内路径处理。',
            '不要声称读取了没有实际查询的内容。',
          ].join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n'),
    skillSystemPrompt: explicitCapabilitySelected
      ? [
          (input.mediaSelected || input.avSelected || [...skillAllowedToolNames].some(name => name === 'media' || name === 'av'))
            ? buildMediaPlanPolicy(input.mediaReferencePolicy)
            : '',
          (input.mediaSelected || input.avSelected || [...skillAllowedToolNames].some(name => name === 'media' || name === 'av'))
            ? '记忆工作台支持批量媒体确认：单个任务在 jc-media-plan 中写一个 JSON 对象；多个独立任务写对象数组，每个任务一项。不要输出多个 jc-media-plan 代码块.'
            : '',
          selectedSkillPrompt || buildWebSkillCatalogPrompt(catalog),
        ]
          .filter(Boolean)
          .join('\n\n')
      : '',
    // oxfmt-ignore
    attachments: input.attachments,
    // oxfmt-ignore
    files: input.files,
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

  const localSkillLoader = desktopRuntime ? createLocalSkillLoader(customSkillsByName) : undefined
  const rawProjectTools = isTauriRuntime()
    ? createDesktopProjectToolExecutor({
        projectDir: input.projectId || '',
        authorizedRawPaths: input.authorizedRawPaths,
        loadSkill: localSkillLoader,
        preloadSkills: selectedSkillNames,
        recordSceneVideo: input.recordSceneVideo
          ? document => input.recordSceneVideo!(document, input.signal)
          : undefined,
      })
    : createWebProjectToolExecutor({
        projectId: input.projectId || '',
        files: webProjectFiles,
        authorizedRawPaths: input.authorizedRawPaths,
        preloadSkills: selectedSkillNames.filter(name => !customSkillsByName.has(name)),
      })
  const projectTools: DirectToolExecutor = async (call, signal) =>
    normalizeMemoryToolResult(await rawProjectTools(call, signal))

  const executeMemoryTool = async (call: DirectToolCall, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    // T4: memory_search - native tool for current conversation
    if (call.function.name === 'memory_search') {
      const args = parseCreativeToolArguments(call)
      if (!input.projectId || !input.conversationId) {
        return {
          content: JSON.stringify({ error: 'NO_CONVERSATION', message: '当前对话未绑定项目' }),
          status: 'failed' as const
        }
      }
      try {
        const result = await queryConversationMemoryIndex(
          input.projectId,
          input.conversationId,
          String(args.query || ''),
          createRuntimeProjectFileService(),
          Math.min(Number(args.limit) || 5, 10),
        )
        return { content: JSON.stringify(result) }
      } catch (error) {
        return {
          content: JSON.stringify({
            error: 'QUERY_FAILED',
            message: error instanceof Error ? error.message : '查询失败'
          }),
          status: 'failed' as const
        }
      }
    }
    if (isSkillCreatorToolName(call.function.name)) {
      if (!selectedSkillNames.some(name => name === 'skill-creator' || name === 'preset_skill-creator')) {
        return { content: JSON.stringify({ error: 'TOOL_NOT_ALLOWED', tool: call.function.name }), status: 'failed' as const }
      }
      return {
        content: await executeSkillCreatorToolCall(call, {
          agentId: selectedSkillNames.some(name => name === 'skill-creator' || name === 'preset_skill-creator')
            ? 'skill-creator'
            : undefined,
          sessionId: input.conversationId,
          userInput: latestUserText,
          signal,
        }),
      }
    }
    if (call.function.name === 'conversation_memory_query') {
      if (!allowedMemoryToolNames.has(call.function.name))
        return { content: JSON.stringify({ error: 'TOOL_NOT_ALLOWED', tool: call.function.name }), status: 'failed' as const }
      const args = parseCreativeToolArguments(call)
      if (!input.projectId || !input.conversationId) throw new Error('当前对话未绑定项目或 conversation ID')
      return {
        content: JSON.stringify(await queryConversationMemoryIndex(
          input.projectId,
          input.conversationId,
          String(args.query || ''),
          createRuntimeProjectFileService(),
          Number(args.limit) || 5,
        )),
      }
    }
    if (call.function.name === 'tool_search') {
      const args = parseCreativeToolArguments(call)
      return {
        content: JSON.stringify(
          searchToolDefinitions(
            authorizedMemoryToolDefinitions,
            String(args.query || ''),
            Number(args.limit),
          ),
        ),
      }
    }
    if (call.function.name === 'tool_describe') {
      const args = parseCreativeToolArguments(call)
      const name = String(args.name || '')
      const definition = describeToolDefinition(authorizedMemoryToolDefinitions, name)
      if (definition) describedToolNames.add(name)
      return definition
        ? { content: JSON.stringify(definition) }
        : { content: `工具未在当前白名单中：${name}`, status: 'failed' as const }
    }
    if (!allowedMemoryToolNames.has(call.function.name)) {
      return {
        content: JSON.stringify({
          error: 'TOOL_NOT_ALLOWED',
          tool: call.function.name,
          message: '工具未由 Skill 或用户选择授权，已拒绝执行。',
        }),
        status: 'failed' as const,
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
  const allMemoryToolDefinitions = [
    // T4: Add memory_search as native tool
    MEMORY_SEARCH_TOOL_DEFINITION,
    ...(desktopRuntime
    ? buildMemoryDesktopToolDefinitions()
    : buildMemoryWebProjectToolDefinitions()),
    ...(selectedSkillNames.some(name => name === 'skill-creator' || name === 'preset_skill-creator') ? ALL_SKILL_TOOLS : []),
  ]
  if (selectedSkillNames.some(name => name === 'skill-creator' || name === 'preset_skill-creator')) {
    for (const tool of ALL_SKILL_TOOLS) skillAllowedToolNames.add(tool.function.name)
  }
  const declaredSkillTools = normalizeSkillAllowedToolNames(skillAllowedToolNames)
  const availableToolNames = new Set(allMemoryToolDefinitions.map(tool => String(tool.function?.name || '')))
  const unavailableSkillTools = declaredSkillTools.filter(name => !availableToolNames.has(name))
  if (unavailableSkillTools.length) {
    throw new Error(`Skill 声明的工具当前不可用：${unavailableSkillTools.join(', ')}`)
  }
  const memoryToolDefinitions = selectMemoryTools(
    allMemoryToolDefinitions,
    [],
    false,
    Boolean(
      input.attachments?.some(
        attachment =>
          attachment.kind === 'file' && attachment.readablePath && !attachment.textContent,
      ),
    ),
    Boolean(input.fileToolsSelected),
    input.selectedMcpToolNames || [],
    Boolean(input.mediaSelected || input.avSelected),
    Boolean(input.scene3dSelected),
    Boolean(input.terminalSelected),
    declaredSkillTools,
  )
  const authorizedMemoryToolDefinitions = memoryToolDefinitions
  const allowedMemoryToolNames = new Set(
    authorizedMemoryToolDefinitions.map(tool => String(tool.function?.name || '')),
  )
  const describedToolNames = new Set<string>()
  const directlyExposedToolNames = new Set(memoryToolDefinitions.map(tool => String(tool.function?.name || '')))
  const resolveTools = () => resolveMemoryToolSearchDefinitions(
    authorizedMemoryToolDefinitions,
    describedToolNames,
    directlyExposedToolNames,
  )
  let aggregatedProgramStatus: MemoryProgramStatus | null = null
  const result = await runDirectChatCompletion({
    messages,
    tools: resolveTools(),
    resolveTools,
    sendChatCompletion,
    signal: input.signal,
    onText: input.onText,
    onToolEvent(event) {
      input.onToolEvent?.(event)
      if (event.type !== 'tool_execution_end' || !shouldReportProgramStatus(event.call.function.name))
        return
      const kind = memoryProgramKind(event.call.function.name)
      const paths = memoryToolPaths(event.call)
      const reason = event.status === 'succeeded' ? undefined : event.result.content || undefined
      const status =
        aggregatedProgramStatus?.status === 'failed' || event.status === 'failed'
          ? 'failed'
          : aggregatedProgramStatus?.status === 'cancelled' || event.status === 'cancelled'
            ? 'cancelled'
            : 'succeeded'
      aggregatedProgramStatus = {
        kind,
        status,
        paths: [...new Set([...(aggregatedProgramStatus?.paths || []), ...paths])],
        reason: [aggregatedProgramStatus?.reason, reason].filter(Boolean).join('\n') || undefined,
        toolName: event.call.function.name,
      }
      input.onProgramStatus?.(aggregatedProgramStatus)
    },
    continueToolsOnInterruption: true,
    maxToolRounds: 12,
    finalizeAtToolRoundLimit: true,
    compactToolHistory: selectedSkillNames.length === 0,
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

function assertMemoryProjectMutationProtected(call: DirectToolCall, projectId = ''): void {
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

function shouldReportProgramStatus(name: string): boolean {
  return !new Set(['read', 'glob', 'grep', 'skill']).has(name)
}

export function memoryProgramKind(name: string): MemoryProgramStatus['kind'] {
  if (name === 'terminal') return 'terminal'
  if (name.startsWith('mcp__')) return 'mcp'
  if (name.startsWith('create_3d_') || name.startsWith('edit_3d_') || name.startsWith('export_3d_'))
    return '3d'
  if (name.startsWith('create_') || name.startsWith('export_')) return 'media'
  return 'file'
}

function memoryToolPaths(call: DirectToolCall): string[] {
  const args = parseArguments(call.function.arguments)
  return [args.path, args.destination, args.existingPath]
    .filter(value => typeof value === 'string' && value.trim())
    .map(value => String(value).trim())
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

export function selectedSkillNamesForInput(input: Pick<MemoryChatInput, 'selectedSkillNames'>): string[] {
  const names = [...new Set((input.selectedSkillNames || []).map(name => String(name).trim()))]
  if (names.some(name => !name)) throw new Error('Skill 名称不能为空')
  if (names.some(name => name.toLowerCase() === 'skill')) {
    throw new Error('必须选择具体 Skill，不能只选择通用 Skill 标签')
  }
  return names
}

export async function buildSelectedSkillPrompt(
  names: string[],
  localSkills: Map<string, SkillConfig>,
  loadSkill: typeof loadWebSkillByName = loadWebSkillByName,
  allowedTools?: Set<string>,
): Promise<string> {
  if (!names.length) return ''
  const blocks = await Promise.all(
    names.map(async name => {
      const local = localSkills.get(name)
      if (local) {
        const resourceRoot = `skill://local/${encodeURIComponent(name)}`
        const resources = [
          ...new Set(['SKILL.md', ...(local.assetIndex || []).map(item => item.path)]),
        ]
        const skillMd = localSkillMarkdown(local)
        for (const tool of parseSkillMd(skillMd).allowedTools || []) allowedTools?.add(tool)
        return [
          `<selected_skill name="${name}">`,
          '来源：本地 Skill。以下是完整 SKILL.md，属于本轮强制执行合同。',
          '<SKILL.md>',
          skillMd || '[SKILL.md 为空]',
          '</SKILL.md>',
          '<skill_files>',
          ...resources.map(path => `<file>${path}</file>`),
          '</skill_files>',
          `资源根路径：${resourceRoot}`,
          '</selected_skill>',
        ].join('\n')
      }
      try {
        const skill = await loadSkill(name)
        for (const tool of parseSkillMd(skill.content).allowedTools || []) allowedTools?.add(tool)
        return [
          `<selected_skill name="${skill.name}">`,
          '来源：产品 Skill 包。以下是完整 SKILL.md，属于本轮强制执行合同。',
          '<SKILL.md>',
          skill.content.trim() || '[SKILL.md 为空]',
          '</SKILL.md>',
          '<skill_files>',
          ...skill.files.map(path => `<file>${path}</file>`),
          '</skill_files>',
          `资源根路径：${skill.baseDirectory}`,
          '</selected_skill>',
        ].join('\n')
      } catch (error) {
        return [
          `<selected_skill name="${name}">`,
          `Skill 规则加载失败，必须把真实错误视为本轮观察结果：${error instanceof Error ? error.message : String(error)}`,
          '</selected_skill>',
        ].join('\n')
      }
    }),
  )
  return [
    '用户已明确选择以下具体 Skill。它们不是可选参考资料，而是本轮必须遵守的执行合同。',
    '完整 SKILL.md 的角色、步骤、输出格式、必填项、禁止事项和质量检查全部有效；不得自行跳过、改写或降级。',
    'Skill 明确要求的 references、scripts 或 assets 必须先通过当前 Skill 包的受限资源读取获得真实内容；读取失败时如实说明，不得伪造已读取。',
    'Skill 规则决定怎么做，用户消息决定做什么，已连接能力只提供真实事实和动作结果。',
    ...blocks,
  ].join('\n\n')
}

type LocalSkillDirectoryNode = {
  path: string
  relative_path: string
  is_dir: boolean
  children?: LocalSkillDirectoryNode[]
}

function createLocalSkillLoader(skills: Map<string, SkillConfig>) {
  return async (name: string) => {
    const skill = skills.get(name)
    if (!skill) return null
    const packagePath = String(skill.packagePath || '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
    const context = { skillId: skill.id, agentId: null, rowId: null }
    const safeResource = (value: string) => {
      const path = String(value || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
      return path && !path.split('/').some(part => part === '..' || !part) ? path : ''
    }
    const fallbackResources = new Set([
      'SKILL.md',
      ...(skill.assetIndex || []).map(item => safeResource(item.path)).filter(Boolean),
    ])
    let resources = [...fallbackResources]
    if (packagePath) {
      try {
        const tree = await invoke<LocalSkillDirectoryNode[]>('list_skill_directory', {
          dirPath: packagePath,
          context,
        })
        const flatten = (nodes: LocalSkillDirectoryNode[]): string[] =>
          nodes.flatMap(node => (node.is_dir ? flatten(node.children || []) : [node.relative_path]))
        resources = [...new Set(['SKILL.md', ...flatten(tree).map(safeResource).filter(Boolean)])]
      } catch {
        // The loader still exposes the complete SKILL.md when a directory listing is unavailable.
      }
    }
    return {
      content: localSkillMarkdown(skill),
      resources,
      readResource: async (relativePath: string) => {
        const relative = safeResource(relativePath)
        if (!resources.includes(relative)) throw new Error(`Skill 资源不存在: ${relative}`)
        if (relative === 'SKILL.md') return localSkillMarkdown(skill)
        if (!packagePath) throw new Error(`Skill 资源路径不可用: ${relative}`)
        return await invoke<string>('read_file_by_path', {
          path: `${packagePath}/${relative}`,
          context,
        })
      },
    }
  }
}

function localSkillMarkdown(skill: SkillConfig): string {
  const content = String(skill.skillContent || '').trim()
  return content.startsWith('---\n') || content.startsWith('---\r\n')
    ? content
    : serializeToSkillMd({
        ...skill,
        name: skill.name || 'Selected Skill',
        description: skill.description || '',
        triggers: skill.triggers || [],
        skillContent: content,
      })
}
