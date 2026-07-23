import { ref } from 'vue'
import { resolveDirectCompletionText, runDirectChatCompletion } from '@/runtime/direct/directEngine'
import { buildCreativeToolDefinitions } from '@/runtime/direct/creativeToolContract'
import { createDesktopProjectToolExecutor, type LocalCreativeSkill } from '@/runtime/direct/desktopProjectTools'
import {
  buildDirectMessages,
  type ResolvedDirectAttachment,
} from '@/utils/directMessageBuilder'
import {
  buildChatCompletionExtras,
  buildHeaders,
  ChatHttpError,
  readChatErrorResponse,
  resolveApiConfig,
} from '@/utils/api'
import { safeFetch } from '@/utils/httpClient'
import { buildWebSkillCatalogPrompt, type WebSkillCatalogEntry } from '@/utils/skillContentResolver'
import { supportsVision } from '@/utils/providerConfig'
import { getModelContextWindow } from '@/data/modelContextWindows'
import {
  buildCreativeContext,
  readCreativeProjectMemory,
  type CreativeProjectTextFiles,
} from '@/runtime/direct/creativeMemory'
import type { ChatMessage } from '@/composables/useChat'
import type { DirectToolCall, DirectToolExecutionEvent } from '@/runtime/direct/directTypes'
import { MEDIA_PLAN_POLICY } from '@/runtime/workbench/mediaPlan'
import { resolveDirectRequestConstraints } from '@/runtime/direct/directRequestConstraints'
import { buildDirectAttachmentHttpError } from '@/runtime/direct/directAttachmentErrors'
import { sendNewApiRequest } from '@/runtime/direct/newApiAttachments'

function terminalInputPolicy(attachments: Array<{ name: string; inputPath: string }> = []): string {
  const savePolicy = '用户要求保存到工作区时，必须调用 write 或 edit，并在工具成功后才说明已保存。'
  if (!attachments.length) {
    return ['当前没有可用终端附件，禁止使用 {{attachment:文件名}}。用户消息中的绝对路径直接用于 read 或 terminal。', savePolicy].join('\n')
  }
  const tokens = attachments.map(item => `{{attachment:${item.name}}}`).join('、')
  return [`本轮唯一可用的终端附件令牌：${tokens}。只可使用以上精确令牌；用户消息中的绝对路径直接用于 read 或 terminal。`, savePolicy].join('\n')
}

export function useCreativeChat() {
  const isStreaming = ref(false)
  let controller: AbortController | undefined

  async function send(input: {
    projectDir: string
    modelId: string
    modelProviderId?: string
    messages: ChatMessage[]
    mediaPlanPolicy?: string
    skillPrompt?: string
    loadSkill?: (name: string) => Promise<LocalCreativeSkill | null>
    skillCatalog?: WebSkillCatalogEntry[]
    attachments?: Array<{ name: string; inputPath: string }>
    modelAttachments?: ResolvedDirectAttachment[]
    modelToolCall?: boolean
    projectMemoryFiles?: CreativeProjectTextFiles
    confirmTool?: (call: DirectToolCall) => boolean | Promise<boolean>
    onText: (text: string) => void
    onFinishReason?: (finishReason?: string) => void
    onToolEvent?: (event: DirectToolExecutionEvent) => void
  }) {
    if (!input.projectDir) throw new Error('请先选择项目文件夹')
    controller?.abort()
    const activeController = new AbortController()
    controller = activeController
    isStreaming.value = true
    try {
      const config = await resolveApiConfig({ modelId: input.modelId, modelProviderId: input.modelProviderId })
      const skillCatalog = buildWebSkillCatalogPrompt(input.skillCatalog || [])
      const [projectMemory] = await Promise.all([readCreativeProjectMemory(input.projectMemoryFiles)])
      const contextWindow = getModelContextWindow(input.modelId, input.modelProviderId)
      const context = buildCreativeContext({
        messages: input.messages,
        modelId: input.modelId,
        contextWindow,
        reservedTokens: Math.min(16_384, Math.floor(contextWindow / 4)),
        projectMemory,
      })
      const userGoal = String(input.messages.at(-1)?.content || '')
      const requestConstraints = resolveDirectRequestConstraints(userGoal)
      const toolsAllowed = input.modelToolCall !== false && !requestConstraints.toolsForbidden
      const messages = buildDirectMessages({
        messages: context.messages,
        historyLimit: null,
        systemPrompt: context.systemPrompt,
        skillSystemPrompt: [input.mediaPlanPolicy || MEDIA_PLAN_POLICY, input.skillPrompt, skillCatalog, terminalInputPolicy(input.attachments)].filter(Boolean).join('\n\n'),
        visionModel: supportsVision(input.modelId, input.modelProviderId),
        apiFormat: 'openai',
        platform: 'desktop',
        attachments: input.modelAttachments,
      })
      const projectTools = createDesktopProjectToolExecutor({
        projectDir: input.projectDir,
        loadSkill: input.loadSkill,
        attachments: input.attachments,
      })
      let roundText = ''
      const result = await runDirectChatCompletion({
        messages,
        tools: toolsAllowed ? buildCreativeToolDefinitions() : [],
        executeTool: projectTools,
        signal: activeController.signal,
        beforeToolCall: async call => {
          if (call.function.name === 'skill') return
          const approved = await input.confirmTool?.(call)
          return approved === false ? 'cancelled' : undefined
        },
        onToolEvent: event => input.onToolEvent?.(event),
        onText: text => {
          roundText = text
          input.onText(text)
        },
        sendChatCompletion: async request => {
          const response = await sendNewApiRequest(
            {
              model: config.model,
              messages: request.messages,
              ...(request.tools?.length ? { tools: request.tools } : {}),
              stream: true,
              temperature: 0.3,
              ...buildChatCompletionExtras(config),
            },
            body => safeFetch(`${config.apiBase}/v1/chat/completions`, {
              method: 'POST',
              headers: buildHeaders(config),
              signal: activeController.signal,
              body,
            }),
          )
          if (!response.ok) {
            const errorMessage = await readChatErrorResponse(response, '创作模式请求失败', config.apiKey)
            const attachmentError = buildDirectAttachmentHttpError(response.status, request.messages)
            throw new ChatHttpError([errorMessage, attachmentError].filter(Boolean).join('；'))
          }
          return response
        },
      }).then(result => {
        input.onText(resolveDirectCompletionText(result.text || roundText, result.finishReason, '模型没有返回内容。'))
        input.onFinishReason?.(result.finishReason)
        if (activeController.signal.aborted) throw new DOMException('Aborted', 'AbortError')
        return result
      })
      return result
    } catch (error) {
      throw error
    } finally {
      if (controller === activeController) {
        isStreaming.value = false
        controller = undefined
      }
    }
  }

  function cancel() {
    controller?.abort()
  }

  return { isStreaming, send, cancel }
}
