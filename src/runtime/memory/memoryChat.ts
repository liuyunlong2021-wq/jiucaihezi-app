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
  resolveDirectCompletionText,
  runDirectChatCompletion,
  type DirectChatCompletionRequest,
} from '@/runtime/direct/directEngine'
import { sendNewApiRequest } from '@/runtime/direct/newApiAttachments'
import { buildWebProjectToolDefinitions, createWebProjectToolExecutor } from '@/runtime/direct/webProjectTools'
import { createDesktopProjectToolExecutor } from '@/runtime/direct/desktopProjectTools'
import { mergeCreativeSkillCatalog } from '@/runtime/direct/creativeSkillCatalog'
import { buildMediaPlanPolicy } from '@/runtime/workbench/mediaPlan'
import { webProjectFiles } from '@/utils/webProjectFiles'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { safeFetch } from '@/utils/httpClient'
import { supportsVision } from '@/utils/providerConfig'

import type { ConversationMode, ConversationTurn } from './conversationTranscript'

export interface MemoryChatInput {
  projectId: string
  turns: ConversationTurn[]
  modelId: string
  mode?: ConversationMode
  mediaReferencePolicy?: string
  attachments?: ResolvedDirectAttachment[]
  files?: DirectMessageFile[]
  signal?: AbortSignal
  onText: (text: string) => void
  onTool?: (name: string) => void
}

export async function runMemoryChat(input: MemoryChatInput): Promise<string> {
  if (!input.projectId) throw new Error('请先创建或选择项目')
  if (!input.turns.some(turn => turn.role === 'user')) throw new Error('请先输入消息')

  const agentStore = useAgentStore()
  const model = agentStore.availableModels.find(entry => entry.id === input.modelId)
  const memoryMode = input.mode !== 'quick'
  if (memoryMode && agentStore.modelsFetched && model?.toolCall === false) {
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
  const messages = buildDirectMessages({
    messages: input.turns,
    historyLimit: null,
    systemPrompt: memoryMode
      ? [
          '你是韭菜盒子记忆对话工作台。项目 Wiki 是唯一长期记忆，当前对话 Raw 是本次讨论的完整原始记录。',
          '根据用户任务自主决定是否加载 Skill、查询项目或调用其他可用工具。没有需要时直接回答。',
          '只依据当前对话和实际工具结果回答；不要声称读取了没有实际查询的内容。',
        ].join('\n')
      : '你是韭菜盒子通用对话工作台。依据当前对话和用户本轮提供的内容直接回答。',
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

  if (!memoryMode) {
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
  const result = await runDirectChatCompletion({
    messages,
    tools: buildWebProjectToolDefinitions(),
    sendChatCompletion,
    signal: input.signal,
    onText: input.onText,
    onToolEvent(event) {
      if (event.type === 'tool_execution_start') input.onTool?.(event.call.function.name)
    },
    async executeTool(call) {
      if (call.function.name === 'skill') {
        const skillName = String(parseArguments(call.function.arguments).name || '')
        const customSkill = !builtInNames.has(skillName) ? customSkillsByName.get(skillName) : null
        if (customSkill?.skillContent.trim()) {
          return { content: `<skill_content name="${skillName}">\n${customSkill.skillContent.trim()}\n</skill_content>` }
        }
      }
      return await projectTools(call)
    },
  })
  const text = resolveDirectCompletionText(result.text, result.finishReason, '模型没有返回内容')
  input.onText(text)
  return text
}

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
