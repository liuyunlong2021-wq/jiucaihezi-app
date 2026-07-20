import { ref } from 'vue'
import { runDirectChatCompletion } from '@/runtime/direct/directEngine'
import { buildCreativeToolDefinitions } from '@/runtime/direct/creativeToolContract'
import { createDesktopProjectToolExecutor, type LocalCreativeSkill } from '@/runtime/direct/desktopProjectTools'
import { buildDirectMessages } from '@/utils/directMessageBuilder'
import { buildChatCompletionExtras, buildHeaders, resolveApiConfig } from '@/utils/api'
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
    skillPrompt?: string
    loadSkill?: (name: string) => Promise<LocalCreativeSkill | null>
    skillCatalog?: WebSkillCatalogEntry[]
    attachments?: Array<{ name: string; inputPath: string }>
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
      const messages = buildDirectMessages({
        messages: context.messages,
        historyLimit: null,
        systemPrompt: context.systemPrompt,
        skillSystemPrompt: [input.skillPrompt, skillCatalog, terminalInputPolicy(input.attachments)].filter(Boolean).join('\n\n'),
        visionModel: supportsVision(input.modelId, input.modelProviderId),
        apiFormat: 'openai',
        platform: 'desktop',
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
        tools: buildCreativeToolDefinitions(),
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
              tools: request.tools,
              stream: true,
              temperature: 0.3,
              ...buildChatCompletionExtras(config),
            }),
          })
          if (!response.ok) throw new Error(`创作模式请求失败: HTTP ${response.status}`)
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
