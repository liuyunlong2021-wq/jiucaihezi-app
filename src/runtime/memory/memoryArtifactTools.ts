import { toBlob } from 'html-to-image'
import { createDocxFromText } from '@/utils/localDocx'
import { renderMessageMarkdown } from '@/components/chat/display/markdownDisplayPolicy'

export type MemoryArtifactFormat = 'docx' | 'md' | 'txt'
export type MemorySlideFormat = 'html' | 'pdf' | 'pptx'
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

function markdownSlides(content: string): string[] {
  const slides = String(content || '').trim().split(/^\s*---\s*$/m).map(value => value.trim()).filter(Boolean)
  if (!slides.length) throw new Error('幻灯片内容不能为空')
  return slides
}

export function createMarkdownSlidesHtml(title: string, content: string): string {
  const safeTitle = String(title || '韭菜盒子幻灯片').replace(/[&<>"']/g, value => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[value]!)
  const slides = markdownSlides(content).map((slide, index) =>
    `<section class="slide" id="slide-${index + 1}"><div>${safeMarkdownHtml(slide)}</div><small>${index + 1}</small></section>`)
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title><style>
*{box-sizing:border-box}html{scroll-snap-type:y mandatory}body{margin:0;background:#171916;color:#f7f7f2;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}.slide{position:relative;width:100vw;min-height:100vh;padding:8vh 9vw;display:flex;align-items:center;scroll-snap-align:start;background:#f8f8f4;color:#20231f;overflow:hidden}.slide>div{width:100%;font-size:clamp(20px,2.2vw,34px);line-height:1.55}.slide h1{font-size:2.15em;margin:.2em 0}.slide h2{font-size:1.55em;margin:.25em 0}.slide h3{font-size:1.2em}.slide img{max-width:100%;max-height:58vh}.slide pre{font-size:.62em;overflow:auto;background:#e9ebe5;padding:18px}.slide small{position:absolute;right:3vw;bottom:3vh;color:#73776f}@media print{html{scroll-snap-type:none}.slide{width:13.333in;height:7.5in;min-height:0;break-after:page}}
</style></head><body>${slides.join('')}<script>addEventListener('keydown',event=>{const pages=[...document.querySelectorAll('.slide')];const current=Math.max(0,pages.findIndex(page=>page.getBoundingClientRect().top>=-innerHeight/2));const delta=['ArrowRight','ArrowDown','PageDown',' '].includes(event.key)?1:['ArrowLeft','ArrowUp','PageUp'].includes(event.key)?-1:0;if(delta){event.preventDefault();pages[Math.max(0,Math.min(pages.length-1,current+delta))]?.scrollIntoView({behavior:'smooth'})}})</script></body></html>`
}

function slideEditableContent(markdown: string) {
  const lines = markdown.split('\n')
  const titleIndex = lines.findIndex(line => /^#{1,3}\s+/.test(line))
  const title = titleIndex >= 0 ? lines[titleIndex]!.replace(/^#{1,3}\s+/, '').trim() : ''
  const body = lines.filter((_, index) => index !== titleIndex)
  const separator = body.findIndex(line => /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line))
  const tableStart = separator > 0 && body[separator - 1]!.includes('|') ? separator - 1 : -1
  let tableEnd = tableStart >= 0 ? separator + 1 : -1
  while (tableEnd >= 0 && tableEnd < body.length && body[tableEnd]!.includes('|')) tableEnd += 1
  const table = tableStart >= 0 ? body.slice(tableStart, tableEnd).filter((_, index) => index !== 1).map(line =>
    line.trim().replace(/^\||\|$/g, '').split('|').map(cell => ({ text: cell.trim() }))) : []
  const textLines = body.filter((_, index) => tableStart < 0 || index < tableStart || index >= tableEnd).map(line => {
    const bullet = /^\s*[-*+]\s+/.test(line)
    const numbered = /^\s*\d+[.)]\s+/.test(line)
    return {
      bullet: bullet || numbered,
      numbered,
      text: line
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^[#>]+\s*/, '')
        .replace(/[*_`]/g, '')
        .trim(),
    }
  }).filter(line => line.text)
  return { title, textLines, table }
}

async function createMarkdownSlidesPptx(title: string, content: string): Promise<Uint8Array> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const deck = new PptxGenJS()
  deck.layout = 'LAYOUT_WIDE'
  deck.author = '韭菜盒子 Studio'
  deck.title = title
  for (const source of markdownSlides(content)) {
    const slide = deck.addSlide()
    slide.background = { color: 'F8F8F4' }
    const text = slideEditableContent(source)
    slide.addText(text.title || title, { x: .8, y: .65, w: 11.7, h: .8, fontFace: 'Microsoft YaHei', fontSize: 28, bold: true, color: '20231F', margin: 0 })
    let y = 1.75
    for (const line of text.textLines) {
      slide.addText(line.text, { x: .95, y, w: 11.2, h: .45, fontFace: 'Microsoft YaHei', fontSize: 19, color: '30342E', margin: 0, bullet: line.bullet ? { type: line.numbered ? 'number' : 'bullet' } : undefined })
      y += .52
    }
    if (text.table.length) slide.addTable(text.table, { x: .85, y: Math.min(y + .12, 5.6), w: 11.5, fontFace: 'Microsoft YaHei', fontSize: 14, color: '30342E', border: { type: 'solid', color: 'C9CEC6', pt: 1 }, fill: { color: 'FFFFFF' }, margin: .08 })
  }
  const output = await deck.write({ outputType: 'uint8array' })
  return output instanceof Uint8Array ? output : new Uint8Array(output as ArrayBuffer)
}

async function createMarkdownSlidesPdf(title: string, content: string): Promise<Uint8Array> {
  if (typeof document === 'undefined') throw new Error('PDF 幻灯片需要在应用页面中生成')
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1280px;pointer-events:none;'
  document.body.appendChild(host)
  try {
    for (const source of markdownSlides(content)) {
      const page = document.createElement('section')
      page.style.cssText = 'width:1280px;height:720px;padding:70px 88px;background:#f8f8f4;color:#20231f;font:28px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;overflow:hidden;'
      page.innerHTML = safeMarkdownHtml(source)
      host.replaceChildren(page)
      await document.fonts?.ready
      const blob = await toBlob(page, { backgroundColor: '#f8f8f4', pixelRatio: 1 })
      if (!blob) throw new Error('PDF 页面渲染失败')
      const image = await pdf.embedPng(await blob.arrayBuffer())
      const pdfPage = pdf.addPage([960, 540])
      pdfPage.drawImage(image, { x: 0, y: 0, width: 960, height: 540 })
    }
    pdf.setTitle(title)
    return pdf.save()
  } finally {
    host.remove()
  }
}

export async function createMarkdownSlidesArtifact(title: string, content: string, format: MemorySlideFormat) {
  if (!['html', 'pdf', 'pptx'].includes(format)) throw new Error(`不支持的幻灯片格式: ${format}`)
  if (format === 'html') return { filename: artifactFilename(title, 'html'), mimeType: 'text/html;charset=utf-8', data: createMarkdownSlidesHtml(title, content) }
  if (format === 'pdf') return { filename: artifactFilename(title, 'pdf'), mimeType: 'application/pdf', data: await createMarkdownSlidesPdf(title, content) }
  return { filename: artifactFilename(title, 'pptx'), mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', data: await createMarkdownSlidesPptx(title, content) }
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
