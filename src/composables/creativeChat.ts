import { ref } from 'vue'
import { runDirectChatCompletion } from '@/runtime/direct/directEngine'
import { CREATIVE_PROJECT_TOOL_DEFINITIONS } from '@/runtime/direct/creativeToolContract'
import { createDesktopProjectToolExecutor } from '@/runtime/direct/desktopProjectTools'
import { buildDirectMessages } from '@/utils/directMessageBuilder'
import { buildChatCompletionExtras, buildHeaders, resolveApiConfig } from '@/utils/api'
import { safeFetch } from '@/utils/httpClient'
import { buildWebSkillCatalogPrompt, loadWebSkillCatalog } from '@/utils/skillContentResolver'
import type { ChatMessage } from '@/composables/useChat'

export function useCreativeChat() {
  const isStreaming = ref(false)
  let controller: AbortController | undefined

  async function send(input: {
    projectDir: string
    modelId: string
    modelProviderId?: string
    messages: ChatMessage[]
    skillPrompt?: string
    onText: (text: string) => void
    onToolCall?: (call: { id: string; type: 'function'; function: { name: string; arguments: string } }) => void
    onToolResult?: (call: { id: string; type: 'function'; function: { name: string; arguments: string } }, result: string, status: 'succeeded' | 'failed') => void
  }) {
    if (!input.projectDir) throw new Error('请先选择项目文件夹')
    controller?.abort()
    const activeController = new AbortController()
    controller = activeController
    isStreaming.value = true
    try {
      const config = await resolveApiConfig({ modelId: input.modelId, modelProviderId: input.modelProviderId })
      const skillCatalog = buildWebSkillCatalogPrompt(await loadWebSkillCatalog())
      const messages = buildDirectMessages({
        messages: input.messages,
        skillSystemPrompt: [input.skillPrompt, skillCatalog].filter(Boolean).join('\n\n'),
        visionModel: false,
        apiFormat: 'openai',
        platform: 'desktop',
      })
      const projectTools = createDesktopProjectToolExecutor({ projectDir: input.projectDir })
      const executeTool = async (call: Parameters<typeof projectTools>[0]) => {
        let result: Awaited<ReturnType<typeof projectTools>>
        let status: 'succeeded' | 'failed' = 'succeeded'
        try {
          result = await projectTools(call)
        } catch (error) {
          if (activeController.signal.aborted) throw new DOMException('Aborted', 'AbortError')
          result = { content: `Tool error: ${error instanceof Error ? error.message : String(error)}` }
          status = 'failed'
        }
        input.onToolResult?.(call, result.content, status)
        return result
      }
      let roundText = ''
      return await runDirectChatCompletion({
        messages,
        tools: CREATIVE_PROJECT_TOOL_DEFINITIONS,
        executeTool,
        signal: activeController.signal,
        onText: text => { roundText = text },
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
              max_tokens: 4096,
              ...buildChatCompletionExtras(config),
            }),
          })
          if (!response.ok) throw new Error(`创作模式请求失败: HTTP ${response.status}`)
          return response
        },
      }).then(result => {
        input.onText(result.text || roundText || '模型没有返回内容。')
        if (activeController.signal.aborted) throw new DOMException('Aborted', 'AbortError')
        return result
      })
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
