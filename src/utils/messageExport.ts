export type LocalExportFormat = 'md' | 'txt' | 'html' | 'json' | 'csv' | 'srt'

export interface MessageExportFile {
  filename: string
  mimeType: string
  content: string
}

const MIME_TYPES: Record<LocalExportFormat, string> = {
  md: 'text/markdown;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  html: 'text/html;charset=utf-8',
  json: 'application/json;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
  srt: 'application/x-subrip;charset=utf-8',
}

function sanitizeFilename(value: string): string {
  return String(value || '韭菜盒子导出')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '韭菜盒子导出'
}

function stripMarkdown(text: string): string {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, block => block.replace(/^```\w*\s*/, '').replace(/```$/, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim()
}

function escapeHtml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function markdownToSimpleHtml(markdown: string): string {
  const body = String(markdown || '')
    .split(/\n/)
    .map(line => {
      const heading = line.match(/^(#{1,6})\s+(.+)$/)
      if (heading) {
        const level = Math.min(6, heading[1].length)
        return `<h${level}>${escapeHtml(heading[2])}</h${level}>`
      }
      if (!line.trim()) return ''
      return `<p>${escapeHtml(line)}</p>`
    })
    .join('\n')

  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8"><title>韭菜盒子导出</title></head>',
    '<body>',
    body,
    '</body>',
    '</html>',
  ].join('\n')
}

function looksLikeSrt(content: string): boolean {
  return /\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/.test(content)
}

function looksLikeCsv(content: string): boolean {
  const lines = content.trim().split(/\n+/).slice(0, 5)
  if (lines.length < 2) return false
  return lines.every(line => {
    const commaCount = (line.match(/[,，]/g) || []).length
    return commaCount >= 1
  })
}

function looksLikeJson(content: string): boolean {
  const text = content.trim()
  if (!text.startsWith('{') && !text.startsWith('[')) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

export function getLocalExportFormats(content: string): LocalExportFormat[] {
  const formats: LocalExportFormat[] = ['md', 'txt', 'html']
  if (looksLikeSrt(content)) formats.push('srt')
  if (looksLikeCsv(content)) formats.push('csv')
  if (looksLikeJson(content)) formats.push('json')
  return formats
}

export function buildMessageExportFile(
  format: LocalExportFormat,
  content: string,
  title = '韭菜盒子导出',
): MessageExportFile {
  const filename = `${sanitizeFilename(title)}.${format}`
  if (format === 'txt') {
    return { filename, mimeType: MIME_TYPES.txt, content: stripMarkdown(content) }
  }
  if (format === 'html') {
    return { filename, mimeType: MIME_TYPES.html, content: markdownToSimpleHtml(content) }
  }
  return { filename, mimeType: MIME_TYPES[format], content }
}
