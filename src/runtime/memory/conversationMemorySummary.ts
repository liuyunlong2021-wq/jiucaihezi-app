import {
  buildChatCompletionExtras,
  buildHeaders,
  ChatHttpError,
  readChatErrorResponse,
  resolveApiConfig,
} from '@/utils/api'
import { safeFetch } from '@/utils/httpClient'
import { sendDirectRequestWithRetry } from '@/runtime/direct/directEngine'
import { sendNewApiRequest } from '@/runtime/direct/newApiAttachments'
import type { ConversationTurn } from './conversationTranscript'
import type { ConversationMemorySummary } from './conversationMemoryIndex'

export const CONVERSATION_MEMORY_SUMMARY_PROMPT = [
  '你是对话记忆索引器。',
  '请只根据用户消息中的这条 assistant 回答生成可检索的对话记忆索引。',
  '只输出两行纯文本：',
  '简介：用中文写一条可独立理解的事实简介，概括这条回答确定了什么或解决了什么，1-2句，最多240个字符。',
  '关键词：1-12个简洁关键词，用顿号分隔；关键词必须来自或明确概括这条回答中的主题、实体、路径、技术名词或决策，每个最多32个字符。',
  '不要补充输入中没有的事实，不要写 Markdown、解释或代码围栏。',
].join('\n')

const CONVERSATION_MEMORY_SUMMARY_MAX_TOKENS = 800
const OLLAMA_CONVERSATION_MEMORY_SUMMARY_MAX_TOKENS = 256

export function buildConversationMemorySummaryRequest(
  model: string,
  assistantContent: string,
  providerId = 'jiucaihezi',
) {
  if (providerId === 'local-ollama') {
    return {
      model,
      stream: false,
      think: false,
      options: {
        temperature: 0.2,
        num_predict: OLLAMA_CONVERSATION_MEMORY_SUMMARY_MAX_TOKENS,
      },
      messages: [
        { role: 'system' as const, content: CONVERSATION_MEMORY_SUMMARY_PROMPT },
        { role: 'user' as const, content: assistantContent },
      ],
    }
  }

  return {
    model,
    temperature: 0.2,
    stream: false,
    max_tokens: CONVERSATION_MEMORY_SUMMARY_MAX_TOKENS,
    messages: [
      { role: 'system' as const, content: CONVERSATION_MEMORY_SUMMARY_PROMPT },
      { role: 'user' as const, content: assistantContent },
    ],
  }
}

export async function generateConversationMemorySummary(input: {
  modelId: string
  assistantTurn: ConversationTurn
  signal?: AbortSignal
  onRetry?: (attempt: number, total: number) => void
}): Promise<ConversationMemorySummary> {
  const providerId = localStorage.getItem('jcModelProviderId') || 'jiucaihezi'
  const config = await resolveApiConfig({ modelId: input.modelId, modelProviderId: providerId })
  const response = await sendDirectRequestWithRetry(
    () =>
      sendNewApiRequest(
        {
          ...buildConversationMemorySummaryRequest(
            config.model,
            input.assistantTurn.content,
            config.providerId,
          ),
          ...buildChatCompletionExtras(config),
        },
        payload =>
          safeFetch(
            `${config.apiBase}${config.providerId === 'local-ollama' ? '/api/chat' : '/v1/chat/completions'}`,
            {
              method: 'POST',
              headers: buildHeaders(config),
              signal: input.signal,
              body: payload,
            },
          ),
      ),
    { signal: input.signal, onRetry: input.onRetry },
  )
  if (!response.ok) {
    const message = await readChatErrorResponse(response, '索引模型请求失败', config.apiKey)
    throw new ChatHttpError(message)
  }
  const payload = (await response.json().catch(() => null)) as any
  return parseConversationMemorySummaryPayload(payload, input.assistantTurn.content)
}

export function parseConversationMemorySummaryPayload(payload: unknown, assistantContent = ''): ConversationMemorySummary {
  const choice = (payload as any)?.choices?.[0]
  const nativePayload = payload as any
  const message = choice?.message || nativePayload?.message
  const finishReason = choice?.finish_reason || nativePayload?.done_reason
  if (finishReason === 'length') throw new Error('索引模型输出被截断')
  if (typeof message?.refusal === 'string' && message.refusal.trim())
    throw new Error('索引模型拒绝生成记忆索引')
  if (typeof message?.content !== 'string' || !message.content.trim())
    throw new Error('索引模型未返回文本简介')
  const lines = message.content.replace(/\r/g, '').split('\n').map((line: string) => line.trim().replace(/^(?:[-*]\s+|\d+[.、]\s*)/, '')).filter(Boolean)
  const summary = (lines.find((line: string) => !/^关键词\s*[:：]/.test(line)) || '').replace(/^简介\s*[:：]\s*/, '').trim().replace(/[\r\n]+/g, ' ').slice(0, 240)
  if (!summary) throw new Error('索引模型未返回有效简介')
  const keywordLine = lines.find((line: string) => /^关键词\s*[:：]/.test(line))
  const listedKeywords: string[] = (keywordLine || '').replace(/^关键词\s*[:：]\s*/, '').split(/[,，、]/).map((keyword: string) => keyword.trim().replace(/[\r\n]+/g, ' ')).filter((keyword: string) => keyword && keyword.length <= 32)
  const fallbackKeywords: string[] = [
    summary.slice(0, 32),
    ...String(assistantContent).match(/[A-Za-z][A-Za-z0-9_.-]{1,31}/g) || [],
  ]
  const keywords: string[] = (listedKeywords.length ? listedKeywords : fallbackKeywords).map((keyword: string) => keyword.trim().replace(/[\r\n]+/g, ' ')).filter((keyword: string) => keyword && keyword.length <= 32)
  const normalizedKeywords = [...new Set(keywords)].slice(0, 12)
  if (!normalizedKeywords.length) throw new Error('索引模型未返回有效简介')
  return { summary, keywords: normalizedKeywords }
}
