import { buildHeaders, resolveApiConfig } from '@/utils/api'
import { safeFetch } from '@/utils/httpClient'
import { isSafePublicHttpUrl } from '@/utils/urlSafety'

export const JINA_READER_MODEL = 'jina-reader'

export const READ_URL_TOOL_DEFINITION = {
  type: 'function' as const,
  function: {
    name: 'read_url',
    description: '读取用户本轮明确提供的网址正文。它不是联网搜索，不能发现新网页。',
    parameters: {
      type: 'object' as const,
      properties: {
        url: { type: 'string' as const, description: '用户本轮提供的完整 http/https 网址' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
}

export function extractPublicHttpUrls(text: string): string[] {
  const urls = String(text || '').match(/https?:\/\/[^\s<>"'，。！？；）】]+/gi) || []
  return [...new Set(urls.filter(isSafePublicHttpUrl))]
}

export async function executeReadUrlTool(
  argumentsText: string,
  allowedUrls: ReadonlySet<string>,
  reader = readUrl,
): Promise<{ content: string }> {
  let args: unknown
  try { args = JSON.parse(argumentsText || '{}') }
  catch { throw new Error('读网址参数不是有效 JSON') }
  const url = String((args as { url?: unknown })?.url || '').trim()
  if (!isSafePublicHttpUrl(url)) throw new Error('只能读取公开的 http/https 网址')
  if (!allowedUrls.has(url)) throw new Error('只能读取用户本轮明确提供的网址')

  return { content: await reader(url) }
}

export async function readUrl(url: string): Promise<string> {
  const config = await resolveApiConfig({
    forceCloud: true,
    modelId: JINA_READER_MODEL,
    modelProviderId: 'jiucaihezi',
  })
  const response = await safeFetch(`${config.apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({
      model: JINA_READER_MODEL,
      messages: [{ role: 'user', content: url }],
      stream: false,
      temperature: 0,
    }),
  })
  if (!response.ok) throw new Error(`网页读取失败（HTTP ${response.status}）`)
  const data = await response.json()
  const content = String(data?.choices?.[0]?.message?.content || '').trim()
  if (!content) throw new Error('网页没有返回可读正文')
  return `[网页正文]\n来源: ${url}\n\n${content}`
}
