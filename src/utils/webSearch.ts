/**
 * utils/webSearch.ts — 联网搜索模块
 *
 * 双通道：
 *   1. jinaWebSearch() — Jina API 快速搜索（知识注入，用户开关控制）
 *   2. browser_search     — 浏览器操控（AI 工具调用，始终可用）
 *
 * Jina 搜索走 NewAPI 的 jina-search 模型：
 *   POST /v1/chat/completions  { model: "jina-search", messages: [{role:"user", content: query}] }
 */
import { getApiKey } from '@/services/newApiClient'

export interface SearchResult {
  title: string
  url: string
  content: string
}

export interface WebSearchResponse {
  query: string
  results: SearchResult[]
  markdown: string
  tokenEstimate: number
  searchTime: number
  /** 错误信息，成功时为空 */
  error?: string
}

/** 是否启用联网搜索 */
export function isWebSearchEnabled(): boolean {
  try { return localStorage.getItem('jcWebSearchEnabled') === 'true' }
  catch { return false }
}

export const JINA_SEARCH_MODEL = 'jina-search'

/**
 * 调 NewAPI jina-search 模型执行联网搜索
 */
export async function jinaWebSearch(query: string, maxResults = 5): Promise<WebSearchResponse> {
  const start = Date.now()
  const apiBase = (() => {
    try { return localStorage.getItem('jcApiBase') || 'https://api.jiucaihezi.studio' }
    catch { return 'https://api.jiucaihezi.studio' }
  })()
  const apiKey = await getApiKey()

  if (!apiKey) {
    return { query, results: [], markdown: '', tokenEstimate: 0, searchTime: Date.now() - start, error: '未设置 API Key，请在设置中填入' }
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)

    const resp = await fetch(`${apiBase}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: JINA_SEARCH_MODEL,
        messages: [{ role: 'user', content: query }],
        max_tokens: 4096,
        temperature: 0,
      }),
    })
    clearTimeout(timer)

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '')
      const errMsg = errText?.substring(0, 300) || `HTTP ${resp.status}`
      console.warn('[jina-search] API error:', resp.status, errMsg)
      return { query, results: [], markdown: '', tokenEstimate: 0, searchTime: Date.now() - start, error: `搜索API返回错误(${resp.status})：${errMsg}` }
    }

    const data = await resp.json()
    const rawText = data?.choices?.[0]?.message?.content || ''
    if (!rawText) {
      console.warn('[jina-search] empty response:', JSON.stringify(data).substring(0, 200))
      return { query, results: [], markdown: '', tokenEstimate: 0, searchTime: Date.now() - start, error: '搜索API返回空结果' }
    }
    const results = parseJinaSearchText(rawText, maxResults)
    const markdown = buildSearchMarkdown(query, results)
    const tokenEstimate = results.reduce((sum, r) => sum + r.content.length, 0)

    return { query, results, markdown, tokenEstimate, searchTime: Date.now() - start }
  } catch (e: any) {
    const errMsg = e?.name === 'AbortError' ? '搜索超时(8秒)' : (e?.message || String(e))
    console.warn('[jina-search] exception:', errMsg)
    return { query, results: [], markdown: '', tokenEstimate: 0, searchTime: Date.now() - start, error: errMsg }
  }
}

// ─── 兼容旧接口 ───

export function getRemainingSearches(): number { return 0 }
export function hasSearchQuotaLimit(): boolean { return false }
export function desktopSearchHasQuotaLimit(): boolean { return false }

export async function webSearch(query: string, _maxResults = 5): Promise<WebSearchResponse> {
  return jinaWebSearch(query, _maxResults)
}

export function parseJinaSearchText(rawText: string, maxResults = 5): SearchResult[] {
  const text = String(rawText || '').trim()
  if (!text) return []

  const lines = text.split(/\r?\n/)
  const results: SearchResult[] = []
  let current: SearchResult | null = null
  let readingContent = false

  const pushCurrent = () => {
    if (!current) return
    current.content = current.content.trim().slice(0, 1500)
    if (current.title || current.url || current.content) {
      results.push({
        title: current.title || current.url || '搜索结果',
        url: current.url,
        content: current.content,
      })
    }
    current = null
    readingContent = false
  }

  for (const line of lines) {
    // Title: ... 格式（Jina 标准输出）
    const title = line.match(/^Title:\s*(.+)$/i)
    if (title) { pushCurrent(); current = { title: title[1].trim(), url: '', content: '' }; continue }

    // URL Source: ... 格式
    const url = line.match(/^URL Source:\s*(.+)$/i)
    if (url) { current ||= { title: '', url: '', content: '' }; current.url = url[1].trim(); continue }

    // Markdown Content: 分隔线
    if (/^Markdown Content:\s*$/i.test(line)) { current ||= { title: '', url: '', content: '' }; readingContent = true; continue }

    // ### N. Title 格式（NewAPI 可能返回不同格式）
    const mdTitle = line.match(/^#{1,3}\s+\d+\.\s*(.+)$/)
    if (mdTitle) { pushCurrent(); current = { title: mdTitle[1].trim(), url: '', content: '' }; continue }

    // 来源: URL 中文格式
    const sourceUrl = line.match(/^来源[：:]\s*(.+)$/)
    if (sourceUrl && current) { current.url = sourceUrl[1].trim(); continue }

    if (readingContent && current) current.content += line + '\n'
  }

  pushCurrent()

  // 兜底：如果格式化解析失败，将整个文本作为一条结果
  if (results.length === 0 && text.length > 10) {
    results.push({ title: text.substring(0, 80).replace(/\n/g, ' '), url: '', content: text.substring(0, 1500) })
  }

  return results.slice(0, maxResults)
}

export function buildDesktopSearchMarkdown(query: string, results: SearchResult[]): string {
  return buildSearchMarkdown(query, results)
}

function buildSearchMarkdown(query: string, results: SearchResult[]): string {
  if (results.length === 0) return ''

  // 只给 LLM 必要信息：标题 + URL + 一句话摘要。不重复全文。
  const items = results.map((r, i) => {
    const summary = r.content.replace(/\n/g, ' ').substring(0, 120)
    return `${i + 1}. **${r.title}**\n   来源: ${r.url}\n   摘要: ${summary}`
  }).join('\n\n')

  return `[搜索参考: "${query}"]\n以下是联网获取的最新信息，请据此回答用户问题。禁止逐字复制搜索结果，用你自己的话总结。\n\n${items}\n\n---\n基于以上信息回答，引用时注明来源。`
}
