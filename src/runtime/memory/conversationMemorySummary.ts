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
  '必须返回 summary 和 keywords 两个字段，不得返回其它字段。',
  'summary：用中文写一条可独立理解的事实简介，概括这条回答确定了什么或解决了什么，1-2句，最多240个字符。',
  'keywords：返回1-12个简洁关键词；关键词必须来自或明确概括这条回答中的主题、实体、路径、技术名词或决策；每个关键词最多32个字符。',
  '不要补充输入中没有的事实，不要写 Markdown，不要写解释，不要输出代码围栏。',
].join('\n')

export const CONVERSATION_MEMORY_SUMMARY_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'conversation_memory_summary',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        summary: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
      },
      required: ['summary', 'keywords'],
    },
  },
} as const

export function buildConversationMemorySummaryRequest(model: string, assistantContent: string) {
  return {
    model,
    temperature: 0.2,
    stream: false,
    max_tokens: 300,
    response_format: CONVERSATION_MEMORY_SUMMARY_RESPONSE_FORMAT,
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
          ...buildConversationMemorySummaryRequest(config.model, input.assistantTurn.content),
          ...buildChatCompletionExtras(config),
        },
        payload =>
          safeFetch(`${config.apiBase}/v1/chat/completions`, {
            method: 'POST',
            headers: buildHeaders(config),
            signal: input.signal,
            body: payload,
          }),
      ),
    { signal: input.signal, onRetry: input.onRetry },
  )
  if (!response.ok) {
    const message = await readChatErrorResponse(response, '索引模型请求失败', config.apiKey)
    if (/response.?format|json.?schema|structured output|unsupported/i.test(message))
      throw new Error('当前模型或网关不支持索引结构化输出')
    throw new ChatHttpError(message)
  }
  const payload = (await response.json().catch(() => null)) as any
  return parseConversationMemorySummaryPayload(payload)
}

export function parseConversationMemorySummaryPayload(payload: unknown): ConversationMemorySummary {
  const choice = (payload as any)?.choices?.[0]
  const message = choice?.message
  if (choice?.finish_reason === 'length') throw new Error('索引模型输出被截断')
  if (typeof message?.refusal === 'string' && message.refusal.trim())
    throw new Error('索引模型拒绝生成记忆索引')
  if (typeof message?.content !== 'string' || !message.content.trim())
    throw new Error('索引模型未返回结构化内容')
  let parsed: any
  try {
    parsed = JSON.parse(message.content)
  } catch {
    throw new Error('索引模型返回的 JSON 无效')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('索引模型返回的 JSON 结构无效')
  if (Object.keys(parsed).some(key => key !== 'summary' && key !== 'keywords'))
    throw new Error('索引模型返回了未允许的字段')
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
  if (!summary) throw new Error('索引模型未返回有效简介')
  if (summary.length > 240) throw new Error('索引模型简介超过240字')
  if (!Array.isArray(parsed.keywords) || parsed.keywords.length < 1 || parsed.keywords.length > 12)
    throw new Error('索引模型返回的关键词数量无效')
  const keywords: string[] = [
    ...new Set<string>(
      parsed.keywords.map((item: unknown) => {
        if (typeof item !== 'string') throw new Error('索引模型返回的关键词格式无效')
        const keyword = item.trim()
        if (!keyword || keyword.length > 32) throw new Error('索引模型返回的关键词长度无效')
        return keyword
      }),
    ),
  ]
  if (!keywords.length) throw new Error('索引模型未返回有效关键词')
  return { summary, keywords }
}
