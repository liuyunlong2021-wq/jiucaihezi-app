import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { highlightCode } from '@/utils/highlight'
import { renderMathInText } from '@/utils/mathRenderer'

type MessageMarkdownRole = 'user' | 'assistant' | 'system' | 'tool' | 'divider'
type DomPurifyLike = {
  sanitize?: (html: string, config?: Record<string, unknown>) => string
  default?: DomPurifyLike
}

let rendererConfigured = false

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

function normalizeLinkHref(href: string): string {
  const trimmed = String(href || '').trim()
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return trimmed
  return '#'
}

function normalizeCodeLang(lang?: string): string {
  const value = String(lang || 'code').trim()
  return /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : 'code'
}

function configureMarkdownRenderer() {
  if (rendererConfigured) return
  rendererConfigured = true

  marked.use({
    renderer: {
      link(this: any, { href, title, tokens }: any) {
        const text = this.parser.parseInline(tokens)
        const safeHref = normalizeLinkHref(href)
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
        return `<a href="${escapeAttr(safeHref)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
      },
      code(this: any, { text, lang }: any) {
        if (lang === 'mermaid') {
          return `<div class="md-code" data-scrollable="true" data-mermaid="1"><div class="md-code-head"><span class="md-code-lang">mermaid</span></div><pre><code class="language-mermaid">${escapeHtml(text)}</code></pre></div>`
        }
        const highlighted = highlightCode(text, lang)
        const langLabel = normalizeCodeLang(lang)
        return `<div class="md-code" data-scrollable="true"><div class="md-code-head"><span class="md-code-lang">${langLabel}</span><button class="md-code-copy" type="button" data-code-copy="1" aria-label="复制代码"><span aria-hidden="true">📋</span><span>复制</span></button></div><pre><code class="hljs language-${langLabel}">${highlighted}</code></pre></div>`
      },
      table(this: any, token: any) {
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
      },
    },
  })
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
