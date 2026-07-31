import { toBlob } from 'html-to-image'
import { createDocxFromText } from '@/utils/localDocx'
import { renderMessageMarkdown } from '@/components/chat/display/markdownDisplayPolicy'

export type MemoryArtifactFormat = 'docx' | 'md' | 'txt'
export type MemoryImageRenderer = (input: { title: string; content: string; width?: number }) => Promise<Blob>

const ARTIFACT_STYLE = `
*{box-sizing:border-box}body{margin:0;background:#fff;color:#24251f;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}.markdown-body{width:100%;padding:64px;font-size:18px;line-height:1.75;overflow-wrap:anywhere}.markdown-body h1,.markdown-body h2,.markdown-body h3{line-height:1.35}.markdown-body h1{font-size:2em}.markdown-body h2{font-size:1.55em;border-bottom:1px solid #ddd;padding-bottom:.25em}.markdown-body h3{font-size:1.25em}.markdown-body img{max-width:100%;height:auto}.markdown-body table{width:100%;border-collapse:collapse}.markdown-body th,.markdown-body td{padding:8px 10px;border:1px solid #ddd;text-align:left;vertical-align:top}.markdown-body blockquote{margin:1em 0;padding:.4em 1em;border-left:4px solid #7d862f;background:#f6f7ef}.markdown-body pre{overflow:auto;padding:16px;background:#f5f5f3;border-radius:6px}.md-code-head{display:none}.md-table-wrap{overflow:auto}
`.trim()

export function artifactFilename(title: string, extension: string): string {
  const safe = String(title || '韭菜盒子作品')
    .replace(/[/\\:*?"<>|\0]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || '韭菜盒子作品'
  return `${safe.replace(/\.[a-z0-9]{1,8}$/i, '')}.${extension}`
}

function safeMarkdownHtml(content: string): string {
  return renderMessageMarkdown(String(content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'), 'assistant')
}

export function createArtifactHtml(title: string, content: string): string {
  if (!String(content || '').trim()) throw new Error('生成内容不能为空')
  const safeTitle = String(title || '韭菜盒子作品').replace(/[&<>"']/g, value => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[value]!)
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${safeTitle}</title>`,
    `<style>${ARTIFACT_STYLE}</style>`,
    '</head>',
    `<body><main class="markdown-body">${safeMarkdownHtml(content)}</main></body>`,
    '</html>',
  ].join('\n')
}

export function createDocumentArtifact(
  title: string,
  content: string,
  format: MemoryArtifactFormat,
): { filename: string; mimeType: string; data: string | Uint8Array } {
  if (!String(content || '').trim()) throw new Error('生成内容不能为空')
  if (!['docx', 'md', 'txt'].includes(format)) throw new Error(`不支持的文档格式: ${format}`)
  if (format === 'docx') return {
    filename: artifactFilename(title, 'docx'),
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    data: createDocxFromText({ title, content }),
  }
  return {
    filename: artifactFilename(title, format),
    mimeType: format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8',
    data: content,
  }
}

export const renderMemoryArtifactImage: MemoryImageRenderer = async input => {
  if (!String(input.content || '').trim()) throw new Error('生成内容不能为空')
  const width = Math.max(480, Math.min(Math.round(Number(input.width) || 1080), 1920))
  const element = document.createElement('main')
  element.className = 'markdown-body'
  element.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;padding:64px;background:#fff;color:#24251f;font:18px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;overflow-wrap:anywhere;`
  element.innerHTML = `<style>${ARTIFACT_STYLE}</style>${safeMarkdownHtml(input.content)}`
  document.body.appendChild(element)
  try {
    await document.fonts?.ready
    const blob = await toBlob(element, { backgroundColor: '#ffffff', pixelRatio: 1, cacheBust: true })
    if (!blob) throw new Error('图片渲染失败')
    return blob
  } finally {
    element.remove()
  }
}
