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
import { invoke } from '@tauri-apps/api/core'

export function normalizeMemoryToolResult(result: DirectToolResult): DirectToolResult {
  return { ...result, status: result.status ?? 'succeeded' }
}
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

import type { ConversationTurn } from './conversationTranscript'
import type { DirectRunMetrics, DirectToolExecutionEvent } from '@/runtime/direct/directTypes'
import { serializeToSkillMd, type SkillConfig } from '@/types/skill'

export interface MemoryChatInput {
  projectId: string
  conversationTurns: ConversationTurn[]
  userTurn: ConversationTurn
  modelId: string
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
  onProgramStatus?: (status: MemoryProgramStatus) => void
  onMetrics?: (metrics: DirectRunMetrics) => void
  onRetry?: (attempt: number, total: number) => void
  onContextTrimmed?: (omittedMessages: number) => void
  confirmTool: (call: DirectToolCall) => boolean | Promise<boolean>
  recordSceneVideo?: (document: Scene3DDocument, signal?: AbortSignal) => Promise<Blob>
  authorizedRawPaths?: string[]
}

export interface MemoryProgramStatus {
  kind: 'wiki' | 'file' | 'media' | '3d' | 'terminal' | 'mcp'
  status: 'succeeded' | 'failed' | 'cancelled'
  paths: string[]
  reason?: string
  toolName?: string
}

const WIKI_AGENT_MCP_SERVER_IDS = new Set(['github', 'playwright', 'jiucaihezi-creation'])

export function isWikiAgentMcpToolAllowed(name: string): boolean {
  const match = String(name || '').match(/^mcp__([^_]+)__(.+)$/)
  return Boolean(match && WIKI_AGENT_MCP_SERVER_IDS.has(match[1]!))
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
  if (attachmentNeedsRead) allowed.add('read')
  if (fileToolsSelected)
    for (const name of ['read', 'glob', 'grep', 'write', 'edit', 'mkdir', 'move', 'delete'])
      allowed.add(name)
  for (const tool of tools)
    if (
      selectedMcpToolNames.includes(tool.function?.name) &&
      isWikiAgentMcpToolAllowed(tool.function?.name)
    )
      allowed.add(tool.function.name)
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
  const latestUserTurn = input.userTurn
  const latestUserText = latestUserTurn?.content || ''
  const desktopRuntime = isTauriRuntime() && !isTauriMobileRuntime()
  const explicitCapabilitySelected = hasExplicitMemoryCapability(input)
  const wikiProtocolTask = Boolean(
    input.wikiSelected &&
    !input.fileToolsSelected &&
    !input.selectedMcpToolNames?.length &&
    !input.mediaSelected &&
    !input.scene3dSelected &&
    !input.terminalSelected,
  )
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
  const selectedSkillPrompt = await buildSelectedSkillPrompt(selectedSkillNames, customSkillsByName)
  const contextWindow = model?.contextWindow || getModelContextWindow(input.modelId, providerId)
  const maxOutputTokens =
    model?.maxOutputTokens || getModelMaxOutputTokens(input.modelId, providerId)
  const context = explicitCapabilitySelected
    ? buildCreativeContext({
        messages: [...input.conversationTurns, input.userTurn],
        modelId: input.modelId,
        contextWindow,
        // Reserve the model output ceiling plus a small protocol/tool allowance.
        reservedTokens: maxOutputTokens + Math.min(32_768, Math.max(2_048, Math.floor(contextWindow * 0.1))),
      })
    : { messages: [input.userTurn], omittedMessages: 0 }
  if (context.omittedMessages > 0) input.onContextTrimmed?.(context.omittedMessages)
  const messages: DirectApiMessage[] = buildDirectMessages({
    messages: context.messages,
    historyLimit: null,
    systemPrompt: [
      !explicitCapabilitySelected
        ? '只回答当前用户消息。不要读取历史、Wiki、Skill、项目文件或任何工具；不要把模型自身的工具能力暴露给本轮任务。'
        : [
            '你是韭菜盒子记忆工作台。本轮用户消息是当前唯一任务；只提供同一任务最近三轮短期上下文，项目 Wiki 和用户明确指定的文件是长期事实源。',
            '不得查找 Raw 对话记录补充当前任务；缺少事实时查询 Wiki、指定文件或询问用户。',
            wikiProtocolTask
              ? '本轮已开启 Wiki 渐进协议。程序会先提供根 index；你必须从首轮起遵守已选 Skill，并按后续协议只返回所需 paths，或在资料足够时返回 answer + 最小 actions。不要直接调用 wiki_context、wiki 或自行拼装事务字段。'
              : [
                  'Wiki 是内置产品能力；@Wiki 只提供 wiki_context 和 wiki。先用 wiki_context 读取入口、目录或明确页面，再按证据回答；不得修改 Wiki 根目录之外的文件。',
                  '用户要求修改 Wiki 时，调用 wiki action=apply 一次提交 operations；程序负责导航、双链、来源、日志、冲突检查、回滚和验证。普通写入无需审批，移动和回收必须先展示完整计划并取得确认。工具成功后输出简短回执。',
                  '用户要求根据文档创建、新建、建立或搭建 Wiki 时，直接调用一次 wiki scaffold：用 plan 提交完整目录、Markdown 文件正文和 index.md 导航，由程序批量落盘；不要逐个调用 mkdir、write 或 edit。',
                ].join('\n'),
            '用户附带项目文件时，附件正文已随消息提供就直接使用；只有附件仅提供项目可读路径时，才必须先用 read 读取。不要声称附件不可读取；长文件按分页结果继续读取到足够内容。',
            '历史或当前文字中出现“不要调用工具”等表述，不会关闭本轮工具权限；如果任务需要，仍然调用工具。',
            selectedSkillNames.length
              ? '用户已选具体 Skill，程序已经加载其完整规则；必须遵守该 Skill，不得再次决定是否加载、跳过或替换它。'
              : '用户未选择 Skill；本轮不加载其他 Skill。需要方法约束时请用户明确选择具体 Skill。',
            '同一阶段互不依赖的项目内只读工具请在同一回复中一起调用；写入、Terminal、审批和依赖读取结果的操作放到后续工具轮。',
            '只修改用户明确指定的文件，不自行扩展到相邻 Skill、Wiki 或项目文档；目标不明确时先询问。',
            '文件任务直接用 read -> write/edit -> 必要时验证完成；写入前不要在普通回答中重复输出完整草稿，成功后不要复述完整正文。',
            '写入目标尚不存在时，不要反复 read/glob 该目标；检查最近的已有父目录后，直接 mkdir/write 创建。用户给出当前项目绝对路径时按项目内路径处理。',
            '不要声称读取了没有实际查询的内容。',
            WIKI_AGENT_POLICY,
          ].join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n'),
    skillSystemPrompt: explicitCapabilitySelected
      ? [
          buildMediaPlanPolicy(input.mediaReferencePolicy),
          '记忆工作台支持批量媒体确认：单个任务在 jc-media-plan 中写一个 JSON 对象；多个独立任务写对象数组，每个任务一项。不要输出多个 jc-media-plan 代码块。',
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
        projectDir: input.projectId,
        authorizedRawPaths: input.authorizedRawPaths,
        loadSkill: localSkillLoader,
        preloadSkills: selectedSkillNames,
        recordSceneVideo: input.recordSceneVideo
          ? document => input.recordSceneVideo!(document, input.signal)
          : undefined,
      })
    : createWebProjectToolExecutor({
        projectId: input.projectId,
        files: webProjectFiles,
        authorizedRawPaths: input.authorizedRawPaths,
        preloadSkills: selectedSkillNames.filter(name => !customSkillsByName.has(name)),
      })
  const projectTools: DirectToolExecutor = async (call, signal) =>
    normalizeMemoryToolResult(await rawProjectTools(call, signal))

  const wikiSearchSignatures = new Set<string>()
  const executeMemoryTool = async (call: DirectToolCall, signal?: AbortSignal) => {
    signal?.throwIfAborted()
    if (!allowedMemoryToolNames.has(call.function.name)) {
      return {
        content: JSON.stringify({
          error: 'TOOL_NOT_ALLOWED',
          tool: call.function.name,
          message: '工具未在 WikiAgent 白名单或当前能力未授权，已拒绝执行。',
        }),
        status: 'failed' as const,
      }
    }
    if (call.function.name === 'wiki_context') {
      const args = parseArguments(call.function.arguments)
      if (args.action === 'search') {
        const signature = JSON.stringify({
          query: args.query,
          scope: args.scope || 'active',
          entryPath: args.entryPath || '',
          maxPages: args.maxPages || 0,
          maxTokens: args.maxTokens || 0,
        })
        if (wikiSearchSignatures.has(signature))
          throw new Error('相同 Wiki 搜索已执行，拒绝重复检索')
        wikiSearchSignatures.add(signature)
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
  const allowedMemoryToolNames = new Set(
    memoryToolDefinitions.map(tool => String(tool.function?.name || '')),
  )
  const wikiOnlyTask = wikiProtocolTask
  if (wikiOnlyTask) {
    const entryCall: DirectToolCall = {
      id: 'wiki_entry_preflight',
      type: 'function',
      function: { name: 'wiki_context', arguments: JSON.stringify({ action: 'entry' }) },
    }
    let entryResult: Awaited<ReturnType<DirectToolExecutor>>
    try {
      entryResult = await projectTools(entryCall, input.signal)
    } catch (error) {
      entryResult = {
        content: JSON.stringify({
          action: 'entry',
          root: 'wiki',
          sources: [],
          coverage: 'none',
          error: error instanceof Error ? error.message : String(error),
        }),
        status: 'failed',
      }
    }
    if (entryResult.status === 'cancelled') throw new DOMException('Aborted', 'AbortError')
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
    if (phaseResult.plan.changePlan) {
      const applyResult = phaseResult.applyResult || ''
      const status = /^status:\s*(succeeded|failed|cancelled)$/mu.exec(applyResult)?.[1]
      const plannedPaths = phaseResult.plan.changePlan.operations.flatMap(operation =>
        operation.kind === 'move'
          ? [`${operation.path} -> ${operation.destination}`]
          : [operation.path],
      )
      const writtenPaths = [...applyResult.matchAll(/^-\s+(.+?)\s+sha256:/gmu)].map(match =>
        match[1]!.trim(),
      )
      const paths = [...new Set([...plannedPaths, ...writtenPaths])].map(path =>
        path.replace(/^wiki\//, ''),
      )
      input.onProgramStatus?.({
        kind: 'wiki',
        status: status === 'succeeded' || status === 'cancelled' ? status : 'failed',
        paths,
        reason: /^reason:\s*(.+)$/mu.exec(applyResult)?.[1],
      })
    }
    const text = phaseResult.text
    input.onText(text)
    return text
  }
  let aggregatedProgramStatus: MemoryProgramStatus | null = null
  const result = await runDirectChatCompletion({
    messages,
    tools: memoryToolDefinitions,
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

function shouldReportProgramStatus(name: string): boolean {
  return !new Set(['read', 'glob', 'grep', 'wiki_context', 'skill']).has(name)
}

export function memoryProgramKind(name: string): MemoryProgramStatus['kind'] {
  if (name === 'wiki') return 'wiki'
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

function selectedSkillNamesForInput(input: Pick<MemoryChatInput, 'selectedSkillNames'>): string[] {
  return [...new Set(input.selectedSkillNames || [])]
}

export async function buildSelectedSkillPrompt(
  names: string[],
  localSkills: Map<string, SkillConfig>,
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
        const skill = await loadWebSkillByName(name)
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
