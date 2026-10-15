import { marked, type Links, type Token } from 'marked'
import DOMPurify from 'dompurify'
import { highlightCode } from '@/utils/highlight'
import { renderMathInText } from '@/utils/mathRenderer'
import { parseEvalReviewPath } from '@/runtime/memory/skillInstall'

type MessageMarkdownRole = 'user' | 'assistant' | 'system' | 'tool' | 'divider'
type DomPurifyLike = {
  sanitize?: (html: string, config?: Record<string, unknown>) => string
  default?: DomPurifyLike
}

let rendererConfigured = false
let displayRenderer: ReturnType<typeof createDisplayRenderer>

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function sanitizeDisplayHtml(html: string): string {
  const purify = DOMPurify as DomPurifyLike
  const sanitize = purify.sanitize || purify.default?.sanitize
  if (typeof sanitize === 'function') {
    return sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ['target', 'rel'],
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    })
  }
  return html
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, '')
    .replace(/\s+(?:href|src)\s*=\s*javascript:[^\s>]*/gi, '')
}

function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/'/g, '&#39;')
}

/**
 * Markdown 里的项目内文件路径（`30秒广告.md`、`wiki/剧本/30秒广告.md`、`/wiki/剧本/30秒广告.md`）
 * 必须带着路径交给点击处理器，否则链接只剩外观。返回未编码的项目路径。
 */
function projectFileLinkTarget(href: string): string | null {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null
  let path = href.replace(/[?#].*$/, '')
  try {
    path = decodeURIComponent(path)
  } catch {
    /* 含裸 % 的路径按原样处理 */
  }
  if (!/\.(?:md|markdown)$/i.test(path)) return null
  const target = path.replace(/^\.?\//, '')
  if (!target || target.startsWith('/') || target.includes('//')) return null
  return target
}

function normalizeLinkHref(href: string): string {
  const trimmed = String(href || '').trim()
  // 评测报告走应用内预览：不能压成 `#` 变成死链，那样点了只会得到一个无意义的 `#` 导航。
  const evalReport = parseEvalReviewPath(trimmed)
  if (evalReport) return `#jc-eval-review=${encodeURIComponent(evalReport)}`
  const projectFile = projectFileLinkTarget(trimmed)
  if (projectFile) return `#jc-file=${encodeURIComponent(projectFile)}`
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed
  if (trimmed.startsWith('#')) return trimmed
  return '#'
}

function normalizeCodeLang(lang?: string): string {
  const value = String(lang || 'code').trim()
  return /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : 'code'
}

function createDisplayRenderer(plainUnstableCode = false) {
  const renderer: any = new marked.Renderer()
  renderer.link = function (this: any, { href, title, tokens }: any) {
    const text = this.parser.parseInline(tokens)
    const safeHref = normalizeLinkHref(href)
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
    // 应用内链接（项目文件、评测报告）不能带 target=_blank，否则会被当成外部链接交给系统浏览器。
    const inAppLink = /^#jc-(?:file|eval-review)=/.test(safeHref)
    const externalAttrs = inAppLink ? '' : ' target="_blank" rel="noopener noreferrer"'
    return `<a href="${escapeAttr(safeHref)}"${titleAttr}${externalAttrs}>${text}</a>`
  }
  renderer.code = function (this: any, { text, lang }: any) {
    if (lang === 'mermaid') {
      return `<div class="md-code" data-scrollable="true" data-mermaid="1"><div class="md-code-head"><span class="md-code-lang">mermaid</span><button class="md-code-copy" type="button" data-code-copy="1" aria-label="复制代码"><span class="md-code-copy-icon" aria-hidden="true">⧉</span><span class="md-code-copy-label">复制</span></button></div><pre><code class="language-mermaid">${escapeHtml(text)}</code></pre></div>`
    }
    const langLabel = normalizeCodeLang(lang)
    const head = `<div class="md-code-head"><span class="md-code-lang">${langLabel}</span><div class="md-code-actions"><button class="md-code-wrap" type="button" data-code-wrap="1" aria-label="切换代码换行" aria-pressed="false">换行</button><button class="md-code-copy" type="button" data-code-copy="1" aria-label="复制代码"><span class="md-code-copy-icon" aria-hidden="true">⧉</span><span class="md-code-copy-label">复制</span></button></div></div>`
    if (plainUnstableCode) {
      return `<div class="md-code md-code-streaming" data-scrollable="true">${head}<pre><code>${escapeHtml(text)}</code></pre></div>`
    }
    const highlighted = highlightCode(text, lang)
    return `<div class="md-code" data-scrollable="true">${head}<pre><code class="hljs language-${langLabel}">${highlighted}</code></pre></div>`
  }
  renderer.table = function (this: any, token: any) {
    const renderCell = (cell: any, index: number, header: boolean) => {
      const tag = header ? 'th' : 'td'
      const align = token.align?.[index]
      const alignAttr = align ? ` align="${align}"` : ''
      return `<${tag}${alignAttr}>${this.parser.parseInline(cell.tokens || [])}</${tag}>`
    }
    const header = token.header.map((cell: any, index: number) => renderCell(cell, index, true)).join('')
    const body = token.rows
      .map((row: any[]) => `<tr>${row.map((cell: any, index: number) => renderCell(cell, index, false)).join('')}</tr>`)
      .join('')
    return `<div class="md-table-wrap" data-scrollable="true"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`
  }
  return renderer
}

function configureMarkdownRenderer() {
  if (rendererConfigured) return
  rendererConfigured = true
  displayRenderer = createDisplayRenderer()
  marked.use({ renderer: displayRenderer })
}

export function renderMessageMarkdown(content: string, role: MessageMarkdownRole): string {
  if (!content) return ''
  configureMarkdownRenderer()
  if (role === 'user') {
    return sanitizeDisplayHtml(escapeHtml(content).replace(/\n/g, '<br>'))
  }
  try {
    const mathProcessed = renderMathInText(content)
    const html = marked.parse(mathProcessed, { breaks: true, gfm: true }) as string
    return sanitizeDisplayHtml(html)
  } catch {
    return sanitizeDisplayHtml(escapeHtml(content).replace(/\n/g, '<br>'))
  }
}

/** Renders one pre-lexed block through the same safe link, table and code rules as settled Markdown. */
export function renderMarkdownChunk(
  token: Token,
  links: Links,
  options: { streaming?: boolean; stable?: boolean } = {},
): string {
  if (token.type === 'def' || token.type === 'space') return ''
  configureMarkdownRenderer()
  try {
    const renderer = options.streaming && options.stable === false
      ? createDisplayRenderer(true)
      : displayRenderer
    const html = marked.Parser.parse([token], {
      breaks: true,
      gfm: true,
      links,
      renderer,
    } as any) as string
    return sanitizeDisplayHtml(html)
  } catch {
    return sanitizeDisplayHtml(escapeHtml(token.raw).replace(/\n/g, '<br>'))
  }
}
