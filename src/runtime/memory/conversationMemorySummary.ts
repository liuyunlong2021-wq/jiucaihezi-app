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
          model: config.model,
          temperature: 0.2,
          stream: false,
          max_tokens: 300,
          ...buildChatCompletionExtras(config),
          messages: [
            {
              role: 'system',
              content:
                '你是对话记忆索引器。只输出 JSON。JSON 格式：{"summary":"不超过240字的事实简介","keywords":["关键词"]}。简介只描述这条助手回答中可复用的信息。关键词最多12个。',
            },
            {
              role: 'user',
              content: input.assistantTurn.content,
            },
          ],
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
  if (!response.ok)
    throw new ChatHttpError(
      await readChatErrorResponse(response, '索引模型请求失败', config.apiKey),
    )
  const payload = (await response.json().catch(() => null)) as any
  const text =
    payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.message?.reasoning || ''
  return parseSummaryJson(text)
}

function parseSummaryJson(value: unknown): ConversationMemorySummary {
  const text = String(value || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    const start = text.indexOf('{'),
      end = text.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('索引模型返回的 JSON 无效')
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
      throw new Error('索引模型返回的 JSON 无效')
    }
  }
  const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : ''
  if (
    !Array.isArray(parsed?.keywords) ||
    parsed.keywords.some((item: unknown) => typeof item !== 'string')
  )
    throw new Error('索引模型返回的关键词格式无效')
  const keywords = parsed.keywords as string[]
  if (!summary) throw new Error('索引模型未返回有效简介')
  return { summary, keywords }
}
