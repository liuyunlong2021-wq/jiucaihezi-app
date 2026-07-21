import { ref } from 'vue'
import { runDirectChatCompletion } from '@/runtime/direct/directEngine'
import { buildCreativeToolDefinitions } from '@/runtime/direct/creativeToolContract'
import { createDesktopProjectToolExecutor, type LocalCreativeSkill } from '@/runtime/direct/desktopProjectTools'
import {
  buildDirectMessages,
  type ResolvedDirectAttachment,
} from '@/utils/directMessageBuilder'
import {
  buildChatCompletionExtras,
  buildHeaders,
  getAssistantMessageContent,
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
import type { DirectToolCall } from '@/runtime/direct/directTypes'
import { MEDIA_PLAN_POLICY } from '@/runtime/workbench/mediaPlan'
import {
  resolveModelInputModalities,
  type InputCapableModel,
  type ModelInputModality,
} from '@/runtime/direct/modelInputCapabilities'
import {
  formatMediaUnderstanding,
  resolveMediaAttachments,
  type MediaSpecialistConsent,
} from '@/runtime/direct/mediaSpecialist'
import { resolveDirectRequestConstraints } from '@/runtime/direct/directRequestConstraints'
import { buildDirectAttachmentHttpError } from '@/runtime/direct/directAttachmentErrors'

function terminalInputPolicy(attachments: Array<{ name: string; inputPath: string }> = []): string {
  const savePolicy = '用户要求保存到工作区时，必须调用 write 或 edit，并在工具成功后才说明已保存。'
  if (!attachments.length) {
    return ['当前没有可用终端附件，禁止使用 {{attachment:文件名}}。用户消息中的绝对路径直接用于 read 或 terminal。', savePolicy].join('\n')
  }
  const tokens = attachments.map(item => `{{attachment:${item.name}}}`).join('、')
  return [`本轮唯一可用的终端附件令牌：${tokens}。只可使用以上精确令牌；用户消息中的绝对路径直接用于 read 或 terminal。`, savePolicy].join('\n')
}

function hasVisionRequest(messages: unknown[]): boolean {
  return messages.some(message => {
    const content = (message as { content?: unknown })?.content
    return Array.isArray(content)
      && content.some(part => (part as { type?: string })?.type === 'image_url')
  })
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
    modelInputModalities?: ModelInputModality[]
    availableModels?: InputCapableModel[]
    confirmMediaSpecialist?: () => Promise<MediaSpecialistConsent>
    onMediaSpecialist?: (modelId: string) => void
    mediaEnhancementEnabled?: boolean
    modelToolCall?: boolean
    projectMemoryFiles?: CreativeProjectTextFiles
    confirmTool?: (call: DirectToolCall) => boolean | Promise<boolean>
    onText: (text: string) => void
    onFinishReason?: (finishReason?: string) => void
    onToolCall?: (call: { id: string; type: 'function'; function: { name: string; arguments: string } }) => void
    onToolResult?: (call: { id: string; type: 'function'; function: { name: string; arguments: string } }, result: string, status: 'succeeded' | 'failed' | 'cancelled') => void
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
      const modelInputModalities = input.modelInputModalities || resolveModelInputModalities({
        id: input.modelId,
        providerId: input.modelProviderId,
      })
      const userGoal = String(input.messages.at(-1)?.content || '')
      const requestConstraints = resolveDirectRequestConstraints(userGoal)
      const toolsAllowed = input.modelToolCall !== false && !requestConstraints.toolsForbidden
      const mediaResolution = await resolveMediaAttachments({
        primaryModel: {
          id: input.modelId,
          providerId: input.modelProviderId || config.providerId,
          inputModalities: modelInputModalities,
        },
        models: input.availableModels || [],
        attachments: input.modelAttachments || [],
        userGoal,
        enhancementEnabled: input.mediaEnhancementEnabled,
        modelLocked: requestConstraints.modelLocked,
        requestConsent: input.confirmMediaSpecialist || (async () => 'reject'),
        sendCompletion: async (specialistModel, specialistMessages) => {
          const response = await safeFetch(`${config.apiBase}/v1/chat/completions`, {
            method: 'POST',
            headers: buildHeaders(config),
            signal: activeController.signal,
            body: JSON.stringify({
              model: specialistModel,
              messages: specialistMessages,
              stream: false,
              temperature: 0.1,
              ...buildChatCompletionExtras(config),
            }),
          })
          if (!response.ok) throw new Error(`媒体专家请求失败（HTTP ${response.status}）`)
          return getAssistantMessageContent(await response.json())
        },
      })
      const mediaUnderstanding = mediaResolution.kind === 'assisted'
        ? formatMediaUnderstanding(mediaResolution.results)
        : ''
      const localMediaPolicy = mediaResolution.kind === 'local_tools_required'
        ? `当前模型和当前账号不能直接读取这些原件：${mediaResolution.unsupportedAttachments.map(item => item.name).join('、')}。不要声称已经读取；任务需要时请调用现有本地工具，工具执行前必须等待用户授权。若没有可用工具，请明确说明无法真实读取。`
        : ''
      if (
        mediaResolution.kind === 'local_tools_required'
        && (!toolsAllowed || !input.attachments?.length)
      ) {
        throw new Error('当前模型和账号不能读取该媒体，并且本轮没有获准可用的本地媒体工具。')
      }
      if (mediaResolution.kind === 'assisted') input.onMediaSpecialist?.(mediaResolution.specialistModel)
      const messages = buildDirectMessages({
        messages: context.messages,
        historyLimit: null,
        systemPrompt: context.systemPrompt,
        skillSystemPrompt: [input.mediaPlanPolicy || MEDIA_PLAN_POLICY, input.skillPrompt, skillCatalog, mediaUnderstanding, localMediaPolicy, terminalInputPolicy(input.attachments)].filter(Boolean).join('\n\n'),
        visionModel: supportsVision(input.modelId, input.modelProviderId),
        apiFormat: 'openai',
        platform: 'desktop',
        attachments: mediaResolution.directAttachments,
      })
      const projectTools = createDesktopProjectToolExecutor({
        projectDir: input.projectDir,
        loadSkill: input.loadSkill,
        attachments: input.attachments,
      })
      const executeTool = async (call: Parameters<typeof projectTools>[0]) => {
        let result: Awaited<ReturnType<typeof projectTools>>
        let status: 'succeeded' | 'failed' | 'cancelled' = 'succeeded'
        try {
          if (call.function.name !== 'skill') {
            const approved = await input.confirmTool?.(call)
            if (approved === false) {
              result = { content: '用户拒绝了本次工具操作，未执行。请换一种方法继续。', status: 'cancelled' }
              status = 'cancelled'
              input.onToolResult?.(call, result.content, status)
              return result
            }
          }
          result = await projectTools(call)
          status = result.status || 'succeeded'
        } catch (error) {
          if (activeController.signal.aborted) {
            result = { content: '工具执行已取消。', status: 'cancelled' }
            status = 'cancelled'
            input.onToolResult?.(call, result.content, status)
            throw new DOMException('Aborted', 'AbortError')
          }
          result = { content: `Tool error: ${error instanceof Error ? error.message : String(error)}` }
          status = 'failed'
        }
        input.onToolResult?.(call, result.content, status)
        return result
      }
      let roundText = ''
      const result = await runDirectChatCompletion({
        messages,
        tools: toolsAllowed ? buildCreativeToolDefinitions() : [],
        executeTool,
        signal: activeController.signal,
        onText: text => {
          roundText = text
          input.onText(text)
        },
        onToolCalls: calls => calls.forEach(call => input.onToolCall?.(call)),
        sendChatCompletion: async request => {
          const response = await safeFetch(`${config.apiBase}/v1/chat/completions`, {
            method: 'POST',
            headers: buildHeaders(config),
            signal: activeController.signal,
            body: JSON.stringify({
              model: config.model,
              messages: request.messages,
              ...(request.tools?.length ? { tools: request.tools } : {}),
              stream: true,
              temperature: 0.3,
              ...buildChatCompletionExtras(config),
            }),
          })
          if (!response.ok) {
            const attachmentError = buildDirectAttachmentHttpError(response.status, request.messages)
            if (attachmentError) throw new Error(attachmentError)
            if (hasVisionRequest(request.messages)) {
              throw new Error(`带参考图的视觉请求失败（HTTP ${response.status}）。请更换对话模型后重试。`)
            }
            throw new Error(`HTTP ${response.status}`)
          }
          return response
        },
      }).then(result => {
        input.onText(result.text || roundText || '模型没有返回内容。')
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
