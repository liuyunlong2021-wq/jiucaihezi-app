/**
 * utils/webSearch.ts — 联网搜索工具（Jina Search API）
 *
 * 流程:
 *   1. 通过 Nginx 代理调用 s.jina.ai（隐藏 API Key）
 *   2. 返回纯净 Markdown 搜索结果
 *   3. 前端将结果注入 system prompt → LLM 基于实时数据回答
 *
 * 费用: Jina 免费 100万 Token/月，足够日均 150 用户使用
 */

import { resolveApiConfig } from './api'
import { safeFetch } from './httpClient'
import { isTauriRuntime } from './tauriEnv'

// ─── 每日搜索次数限制 ───
const DAILY_SEARCH_LIMIT = 3
const SEARCH_COUNT_KEY = 'web_search_daily'

function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10) // "2026-05-16"
}

function getDailySearchCount(): number {
  try {
    const raw = localStorage.getItem(SEARCH_COUNT_KEY)
    if (!raw) return 0
    const data = JSON.parse(raw)
    if (data.date !== getTodayKey()) return 0
    return data.count || 0
  } catch { return 0 }
}

function incrementDailySearch(): void {
  const today = getTodayKey()
  const count = getDailySearchCount()
  localStorage.setItem(SEARCH_COUNT_KEY, JSON.stringify({ date: today, count: count + 1 }))
}

export function getRemainingSearches(): number {
  if (isTauriRuntime()) return 0
  return Math.max(0, DAILY_SEARCH_LIMIT - getDailySearchCount())
}

export function hasSearchQuotaLimit(): boolean {
  return !isTauriRuntime()
}

export function desktopSearchHasQuotaLimit(): boolean {
  return false
}

/** 搜索结果条目 */
export interface SearchResult {
  title: string
  url: string
  content: string
}

/** 搜索返回 */
export interface WebSearchResponse {
  query: string
  results: SearchResult[]
  markdown: string       // 拼接好的 markdown 文本（直接塞进 system prompt）
  tokenEstimate: number  // 粗略 token 估算
  searchTime: number     // 搜索耗时（ms）
}

export function parseJinaSearchText(rawText: string, maxResults = 5): SearchResult[] {
  const lines = String(rawText || '').split(/\r?\n/)
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
    const title = line.match(/^Title:\s*(.+)$/i)
    if (title) {
      pushCurrent()
      current = { title: title[1].trim(), url: '', content: '' }
      continue
    }

    const url = line.match(/^URL Source:\s*(.+)$/i)
    if (url) {
      current ||= { title: '', url: '', content: '' }
      current.url = url[1].trim()
      continue
    }

    if (/^Markdown Content:\s*$/i.test(line)) {
      current ||= { title: '', url: '', content: '' }
      readingContent = true
      continue
    }

    if (readingContent && current) {
      current.content += `${line}\n`
    }
  }

  pushCurrent()
  return results.slice(0, maxResults)
}

export function buildDesktopSearchMarkdown(query: string, results: SearchResult[]): string {
  return buildSearchMarkdown(query, results)
}

async function webSearchFromDesktop(query: string, maxResults: number): Promise<WebSearchResponse> {
  const start = Date.now()
  const url = `https://s.jina.ai/${encodeURIComponent(query)}`

  try {
    const res = await safeFetch(url, {
      method: 'GET',
      headers: { Accept: 'text/plain' },
    })
    if (!res.ok) {
      const reason = `本地搜索请求失败 (${res.status})`
      return { query, results: [], markdown: `[联网搜索失败] ${reason}`, tokenEstimate: 0, searchTime: Date.now() - start }
    }

    const rawText = await res.text()
    let results = parseJinaSearchText(rawText, maxResults)
    if (!results.length && rawText.trim()) {
      results = [{
        title: '搜索结果',
        url,
        content: rawText.trim().slice(0, 1500),
      }]
    }

    const markdown = buildDesktopSearchMarkdown(query, results)
    return {
      query,
      results,
      markdown,
      tokenEstimate: Math.ceil(markdown.length / 2),
      searchTime: Date.now() - start,
    }
  } catch (err) {
    console.warn('[WebSearch] 桌面本地搜索失败:', (err as Error).message)
    return { query, results: [], markdown: '', tokenEstimate: 0, searchTime: Date.now() - start }
  }
}

/**
 * 执行联网搜索
 * @param query  用户的搜索词
 * @param maxResults  最多返回几条（默认 5，省 token）
 */
export async function webSearch(query: string, maxResults = 5): Promise<WebSearchResponse> {
  if (!query.trim()) {
    return { query, results: [], markdown: '', tokenEstimate: 0, searchTime: 0 }
  }

  if (isTauriRuntime()) {
    return webSearchFromDesktop(query, maxResults)
  }

  // 每日搜索次数检查
  const remaining = getRemainingSearches()
  if (remaining <= 0) {
    return {
      query,
      results: [],
      markdown: `[联网搜索受限] 今日搜索次数已用完（每日限 ${DAILY_SEARCH_LIMIT} 次），明天将自动恢复。`,
      tokenEstimate: 0,
      searchTime: 0,
    }
  }

  const start = Date.now()

  try {
    // 获取 API 配置（含用户 Key + 后端地址）
    const config = await resolveApiConfig()
    const apiBase = config.apiBase.replace(/\/+$/, '')

    // 通过 Nginx 代理调用 Jina Search，带用户 API Key 经 NewAPI 认证计费
    const apiUrl = `${apiBase}/api/web-search/${encodeURIComponent(query)}`
    const res = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      signal: AbortSignal.timeout(60000),
    })

    if (!res.ok) {
      const reason = res.status === 402 ? '搜索额度已用完（Jina API 402）'
        : res.status === 429 ? '搜索请求过于频繁，请稍后再试'
        : `搜索服务异常 (${res.status})`
      console.warn(`[WebSearch] ${reason}`)
      return { query, results: [], markdown: `[联网搜索失败] ${reason}`, tokenEstimate: 0, searchTime: Date.now() - start }
    }

    let data: any
    try {
      data = await res.json()
    } catch {
      console.warn('[WebSearch] JSON 解析失败')
      return { query, results: [], markdown: '', tokenEstimate: 0, searchTime: Date.now() - start }
    }

    const searchTime = Date.now() - start

    // Jina 返回 { code: 200, data: [...] } 或 { code: 401, message: "..." }
    if (!data?.data || !Array.isArray(data.data) || data.data.length === 0) {
      console.warn('[WebSearch] 无搜索结果', data?.message || '')
      return { query, results: [], markdown: '', tokenEstimate: 0, searchTime }
    }

    // Jina Search 返回格式: { data: [{ title, url, content, description }] }
    const items: SearchResult[] = (data.data || [])
      .slice(0, maxResults)
      .map((item: any) => ({
        title: item.title || '',
        url: item.url || '',
        content: (item.content || item.description || '').slice(0, 1500),  // 每条最多 1500 字符，控制 token
      }))

    // 搜索成功，计数 +1
    incrementDailySearch()

    // 拼接成 LLM 友好的 Markdown
    const markdown = buildSearchMarkdown(query, items)
    const tokenEstimate = Math.ceil(markdown.length / 2)  // 粗估：中文约 2 字符/token

    return { query, results: items, markdown, tokenEstimate, searchTime }
  } catch (err) {
    console.warn('[WebSearch] 搜索失败:', (err as Error).message)
    return { query, results: [], markdown: '', tokenEstimate: 0, searchTime: Date.now() - start }
  }
}

/**
 * 将搜索结果拼接成大模型友好的 Markdown 文本
 */
function buildSearchMarkdown(query: string, results: SearchResult[]): string {
  if (results.length === 0) return ''

  const lines: string[] = [
    `[联网搜索结果] 搜索词: "${query}"`,
    `搜索时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    `共 ${results.length} 条结果:`,
    '',
  ]

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    lines.push(`### ${i + 1}. ${r.title}`)
    lines.push(`来源: ${r.url}`)
    lines.push(r.content)
    lines.push('')
  }

  lines.push('---')
  lines.push('请基于以上搜索结果回答用户问题。如果搜索结果中没有相关信息，请如实告知。引用信息时请注明来源。')

  return lines.join('\n')
}

/**
 * 将 Jina Reader 抓取的纯文本搜索结果格式化
 */
function buildReaderSearchMarkdown(query: string, rawText: string): string {
  if (!rawText.trim()) return ''

  const lines: string[] = [
    `[联网搜索结果] 搜索词: "${query}"`,
    `搜索时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
    '',
    rawText,
    '',
    '---',
    '请基于以上搜索结果回答用户问题。如果搜索结果中没有相关信息，请如实告知。引用信息时请注明来源。',
  ]

  return lines.join('\n')
}
