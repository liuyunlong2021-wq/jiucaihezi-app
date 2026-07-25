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
import { buildMediaPlanPolicy } from '@/runtime/workbench/mediaPlan'
import { webProjectFiles } from '@/utils/webProjectFiles'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { safeFetch } from '@/utils/httpClient'
import { supportsVision } from '@/utils/providerConfig'

import type { ConversationMode, ConversationTurn } from './conversationTranscript'

const REQUIRED_SKILL = 'jc-cha-wiki'
const WIKI_QUERY_TOOLS = new Set(['wiki', 'read', 'glob', 'grep'])

export interface MemoryChatInput {
  projectId: string
  turns: ConversationTurn[]
  modelId: string
  mode?: ConversationMode
  selectedSkillName?: string
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
    throw new Error('当前模型不支持 Wiki 工具，请选择支持工具调用的模型')
  }
  const providerId = model?.providerId || localStorage.getItem('jcModelProviderId') || 'jiucaihezi'
  const config = await resolveApiConfig({
    modelId: input.modelId,
    modelProviderId: providerId,
  })

  const catalog = memoryMode ? await loadWebSkillCatalog() : []
  const selectedSkill = input.selectedSkillName
    ? agentStore.getCustomSkills().find(skill => skill.name === input.selectedSkillName)
    : null
  const messages = buildDirectMessages({
    messages: input.turns,
    historyLimit: null,
    systemPrompt: memoryMode
      ? [
          '你是韭菜盒子记忆对话工作台。项目 Wiki 是唯一长期记忆，当前对话 Raw 是本次讨论的完整原始记录。',
          `每次回复必须先调用 skill({"name":"${REQUIRED_SKILL}"})，再根据用户最新消息调用 wiki、read、glob 或 grep 查询项目 Wiki。没有完成这两步，不得输出最终回复。`,
          '只依据当前对话和实际查询结果回答；不要声称读取了没有实际查询的内容。',
        ].join('\n')
      : '你是韭菜盒子通用对话工作台。依据当前对话和用户本轮提供的内容直接回答。',
    skillSystemPrompt: [
      buildMediaPlanPolicy(input.mediaReferencePolicy),
      memoryMode ? buildWebSkillCatalogPrompt(catalog) : '',
      selectedSkill?.skillContent
        ? `用户额外选择的 Skill：${selectedSkill.name}\n<SKILL.md>\n${selectedSkill.skillContent}\n</SKILL.md>`
        : '',
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
  let loadedRequiredSkill = false
  let queriedWiki = false
  const result = await runDirectChatCompletion({
    messages,
    tools: buildWebProjectToolDefinitions(),
    sendChatCompletion,
    signal: input.signal,
    onText(text) {
      if (loadedRequiredSkill && queriedWiki) input.onText(text)
    },
    onToolEvent(event) {
      if (event.type === 'tool_execution_start') input.onTool?.(event.call.function.name)
    },
    async executeTool(call) {
      const toolResult = await projectTools(call)
      if (toolResult.status !== 'failed') {
        if (call.function.name === 'skill') {
          const args = parseArguments(call.function.arguments)
          loadedRequiredSkill ||= String(args.name || '') === REQUIRED_SKILL
        }
        if (WIKI_QUERY_TOOLS.has(call.function.name) && isProjectWikiQuery(call.function.name, call.function.arguments)) {
          queriedWiki = true
        }
      }
      return toolResult
    },
  })
  if (!loadedRequiredSkill) throw new Error(`模型未按要求加载 ${REQUIRED_SKILL}，本轮没有写入助手回复`)
  if (!queriedWiki) throw new Error('模型未按要求查询项目 Wiki，本轮没有写入助手回复')
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

function isProjectWikiQuery(name: string, rawArguments: string): boolean {
  if (name !== 'read') return true
  const path = String(parseArguments(rawArguments).path || '')
  return !path.startsWith('skill://') && !path.startsWith('/skills/')
}
