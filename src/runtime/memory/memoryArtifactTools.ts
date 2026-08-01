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
  const source = String(content).trim().replace(/^```html\s*([\s\S]*?)\s*```$/i, '$1').trim()
  if (/<html(?:\s|>)/i.test(source) && /<body(?:\s|>)/i.test(source)) {
    return /^<!doctype html>/i.test(source) ? source : `<!doctype html>\n${source}`
  }
  if (/<(?:style|script|main|section|article|div|table|form|nav|header|footer)(?:\s|>)/i.test(source)) {
    throw new Error('网页内容不完整，请提供包含 html、head 和 body 的完整 HTML 后重试')
  }
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
    `<body><main class="markdown-body">${safeMarkdownHtml(source)}</main></body>`,
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
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none;z-index:-2147483647;'
  const element = document.createElement('main')
  element.className = 'markdown-body'
  element.style.cssText = `width:${width}px;padding:64px;background:#fff;color:#24251f;font:18px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;overflow-wrap:anywhere;`
  element.innerHTML = `<style>${ARTIFACT_STYLE}</style>${safeMarkdownHtml(input.content)}`
  host.appendChild(element)
  document.body.appendChild(host)
  try {
    await document.fonts?.ready
    const blob = await toBlob(element, { backgroundColor: '#ffffff', pixelRatio: 1, cacheBust: true })
    if (!blob) throw new Error('图片渲染失败')
    await assertImageNotBlank(blob)
    return blob
  } finally {
    host.remove()
  }
}

async function assertImageNotBlank(blob: Blob): Promise<void> {
  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.src = url
  try {
    await image.decode()
    const scale = Math.min(1, 512 / image.naturalWidth, 2048 / image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法验证图片内容')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 10 && (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245)) return
    }
    throw new Error('图片渲染结果为空白，请重试')
  } finally {
    URL.revokeObjectURL(url)
  }
}
