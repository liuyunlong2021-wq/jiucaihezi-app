import type { OfficeDownloadFile } from '@/utils/officeDownloads'

export type OfficeDocType = 'docx' | 'pdf' | 'xlsx' | 'pptx'

const XLSX_PARSE_ERROR = '无法可靠生成 Excel：请输出标准 Markdown 表格、CSV 表格或 JSON sheets 数据后再导出为本地 CSV/JSON。'

type XlsxRow = Record<string, unknown>
type XlsxSheets = Record<string, XlsxRow[]>
type PptxSlide = { title: string; subtitle?: string; bullets?: string[]; paragraphs?: string[]; table?: unknown[] }

export function inferOfficeDocType(agentId?: string, agentName?: string): OfficeDocType | null {
  const value = `${agentId || ''} ${agentName || ''}`.toLowerCase()
  if (/docx|word|文档/.test(value)) return 'docx'
  if (/pdf/.test(value)) return 'pdf'
  if (/pptx|ppt|powerpoint|演示|幻灯片/.test(value)) return 'pptx'
  if (/xlsx|xls|excel|exl|表格|电子表格/.test(value)) return 'xlsx'
  return null
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, block => block.replace(/^```\w*\s*/, '').replace(/```$/, ''))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim()
}

function extractTitle(text: string, fallback: string): string {
  const heading = text.match(/^#{1,3}\s+(.+)$/m)?.[1]
  if (heading) return stripMarkdown(heading).slice(0, 80)
  const firstLine = text.split(/\n+/).map(line => stripMarkdown(line)).find(Boolean)
  return (firstLine || fallback).slice(0, 80)
}

function toParagraphs(text: string): Array<string | { text: string; heading_level?: number }> {
  const lines = stripMarkdown(text).split(/\n+/).map(line => line.trim()).filter(Boolean)
  return lines.map(line => {
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) return { text: heading[2], heading_level: Math.min(3, heading[1].length) }
    return line.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '')
  })
}

function parseMarkdownTable(text: string): Record<string, string>[] {
  const lines = text.split(/\n/).map(line => line.trim()).filter(line => line.includes('|'))
  for (let i = 0; i < lines.length - 1; i += 1) {
    const headerLine = lines[i]
    const separatorLine = lines[i + 1]
    if (!/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separatorLine)) continue

    const headers = headerLine.split('|').map(cell => stripMarkdown(cell.trim())).filter(Boolean)
    if (!headers.length) continue

    const rows: Record<string, string>[] = []
    for (let j = i + 2; j < lines.length; j += 1) {
      const cells = lines[j].split('|').map(cell => stripMarkdown(cell.trim()))
      const normalized = cells.length === headers.length + 2 ? cells.slice(1, -1) : cells.filter((_, index) => !(index === 0 || index === cells.length - 1) || cellHasContent(cells[index]))
      if (normalized.length < 2) break
      const row: Record<string, string> = {}
      headers.forEach((header, index) => { row[header || `列${index + 1}`] = normalized[index] || '' })
      rows.push(row)
    }
    if (rows.length) return rows
  }
  return []
}

function cellHasContent(cell: string): boolean {
  return cell.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeArrayRows(data: unknown): XlsxRow[] {
  if (!Array.isArray(data) || !data.length) return []

  if (data.every(isRecord)) return data as XlsxRow[]

  if (data.every(Array.isArray)) {
    const table = data as unknown[][]
    const headers = table[0].map((cell, index) => String(cell || `列${index + 1}`).trim() || `列${index + 1}`)
    if (!headers.length || table.length < 2) return []
    return table.slice(1).map((cells) => {
      const row: XlsxRow = {}
      headers.forEach((header, index) => { row[header] = cells[index] ?? '' })
      return row
    })
  }

  return []
}

function normalizeWorkbookSpec(value: unknown): { sheets: XlsxSheets } | null {
  if (Array.isArray(value)) {
    const rows = normalizeArrayRows(value)
    return rows.length ? { sheets: { Sheet1: rows } } : null
  }

  if (!isRecord(value)) return null

  if (isRecord(value.sheets)) {
    const sheets: XlsxSheets = {}
    for (const [sheetName, sheetData] of Object.entries(value.sheets)) {
      const rows = normalizeArrayRows(sheetData)
      if (rows.length) sheets[sheetName || 'Sheet1'] = rows
    }
    return Object.keys(sheets).length ? { sheets } : null
  }

  if ('data' in value) {
    const rows = normalizeArrayRows(value.data)
    return rows.length ? { sheets: { Sheet1: rows } } : null
  }

  return null
}

function parseStructuredWorkbook(text: string): { sheets: XlsxSheets } | null {
  const candidates = [
    text.trim(),
    ...Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), match => match[1].trim()),
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      const workbook = normalizeWorkbookSpec(JSON.parse(candidate))
      if (workbook) return workbook
    } catch {
      // Try the next candidate.
    }
  }

  return null
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') return line.split('\t').map(cell => stripMarkdown(cell.trim()))

  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"' && next === '"') {
      current += '"'
      i += 1
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === delimiter && !inQuotes) {
      cells.push(stripMarkdown(current.trim()))
      current = ''
      continue
    }
    current += char
  }
  cells.push(stripMarkdown(current.trim()))
  return cells
}

function parseDelimitedTable(text: string): Record<string, string>[] {
  const rawLines = stripMarkdown(text).split(/\n/).map(line => line.trim()).filter(Boolean)
  const delimiters = ['\t', ',', '，']

  for (const delimiter of delimiters) {
    const rows = rawLines
      .map(line => parseDelimitedLine(line, delimiter))
      .filter(cells => cells.length >= 2)

    if (rows.length < 2) continue

    const headers = rows[0].map((cell, index) => cell || `列${index + 1}`)
    if (headers.length < 2) continue

    const dataRows = rows.slice(1)
      .filter(cells => cells.length === headers.length)
      .map((cells) => {
        const row: Record<string, string> = {}
        headers.forEach((header, index) => { row[header] = cells[index] || '' })
        return row
      })

    if (dataRows.length) return dataRows
  }

  return []
}

function textItems(value: unknown): string[] {
  if (value == null) return []
  if (typeof value === 'string') return value.split(/\n+/).map(item => stripMarkdown(item.trim())).filter(Boolean)
  if (Array.isArray(value)) return value.map(item => {
    if (typeof item === 'string') return stripMarkdown(item.trim())
    if (isRecord(item)) return stripMarkdown(String(item.text || item.title || item.label || item.value || '').trim())
    return stripMarkdown(String(item).trim())
  }).filter(Boolean)
  if (isRecord(value)) return textItems(value.text || value.title || value.label || value.value)
  return [stripMarkdown(String(value).trim())].filter(Boolean)
}

function normalizePptxSlide(value: unknown, index: number): PptxSlide | null {
  if (!isRecord(value)) {
    const text = textItems(value).join('\n')
    return text ? { title: `第 ${index + 1} 页`, paragraphs: [text] } : null
  }

  const title = stripMarkdown(String(value.title || value.heading || `第 ${index + 1} 页`).trim()) || `第 ${index + 1} 页`
  const subtitle = textItems(value.subtitle)[0]
  const bullets = textItems(value.bullets || value.points || value.items)
  const paragraphs = textItems(value.paragraphs || value.body || value.content || value.text || value.notes)
  const slide: PptxSlide = { title }
  if (subtitle) slide.subtitle = subtitle
  if (bullets.length) slide.bullets = bullets.slice(0, 8)
  else if (paragraphs.length) slide.paragraphs = paragraphs.slice(0, 8)
  else slide.paragraphs = [title]
  if (Array.isArray(value.table)) slide.table = value.table
  return slide
}

function normalizePptxSpec(value: unknown): { title: string; subtitle?: string; theme?: string; slides: PptxSlide[] } | null {
  if (!isRecord(value)) return null

  const rawSlides = Array.isArray(value.slides) ? value.slides : []
  const slides = rawSlides
    .map((slide, index) => normalizePptxSlide(slide, index))
    .filter((slide): slide is PptxSlide => Boolean(slide))

  if (!slides.length) {
    const fallbackItems = textItems(value.bullets || value.paragraphs || value.content || value.text || value.body)
    if (fallbackItems.length) slides.push({ title: '内容概要', bullets: fallbackItems.slice(0, 8) })
  }

  if (!slides.length) return null

  const title = stripMarkdown(String(value.title || value.name || '演示文稿').trim()) || '演示文稿'
  const spec: { title: string; subtitle?: string; theme?: string; slides: PptxSlide[] } = { title, slides }
  const subtitle = textItems(value.subtitle || value.description)[0]
  if (subtitle) spec.subtitle = subtitle
  if (typeof value.theme === 'string' && value.theme.trim()) spec.theme = value.theme.trim()
  return spec
}

function parseStructuredPptx(text: string): { title: string; subtitle?: string; theme?: string; slides: PptxSlide[] } | null {
  const candidates = [
    text.trim(),
    ...Array.from(text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), match => match[1].trim()),
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      const spec = normalizePptxSpec(JSON.parse(candidate))
      if (spec) return spec
    } catch {
      // Try the next candidate.
    }
  }

  return null
}

function toSlides(text: string): PptxSlide[] {
  const sections = text
    .split(/\n(?=#{1,3}\s+)/)
    .map(section => section.trim())
    .filter(Boolean)

  if (sections.length > 1) {
    return sections.slice(0, 12).map((section, index) => {
      const lines = section.split(/\n+/).map(line => line.trim()).filter(Boolean)
      const title = stripMarkdown(lines[0].replace(/^#{1,3}\s+/, '')) || `第 ${index + 1} 页`
      const body = lines.slice(1).map(line => stripMarkdown(line.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, ''))).filter(Boolean)
      return body.length ? { title, bullets: body.slice(0, 8) } : { title, paragraphs: [title] }
    })
  }

  const lines = stripMarkdown(text).split(/\n+/).map(line => line.trim().replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '')).filter(Boolean)
  const slides: PptxSlide[] = []
  if (lines.length === 1) return [{ title: '内容概要', paragraphs: [lines[0]] }]
  for (let i = 0; i < lines.length; i += 5) {
    const chunk = lines.slice(i, i + 5)
    slides.push({ title: chunk[0] || `第 ${slides.length + 1} 页`, bullets: chunk.slice(1, 5).length ? chunk.slice(1, 5) : [chunk[0]] })
  }
  return slides.slice(0, 12)
}

export function buildOfficeCreateSpec(docType: OfficeDocType, content: string): Record<string, unknown> {
  const title = extractTitle(content, docType === 'xlsx' ? '表格' : docType === 'pptx' ? '演示文稿' : '文档')

  if (docType === 'xlsx') {
    const structuredWorkbook = parseStructuredWorkbook(content)
    if (structuredWorkbook) return structuredWorkbook

    const tableRows = parseMarkdownTable(content)
    if (tableRows.length) return { sheets: { Sheet1: tableRows } }

    const delimitedRows = parseDelimitedTable(content)
    if (delimitedRows.length) return { sheets: { Sheet1: delimitedRows } }

    throw new Error(XLSX_PARSE_ERROR)
  }

  if (docType === 'pptx') {
    const structuredPptx = parseStructuredPptx(content)
    if (structuredPptx) return { theme: 'midnight', ...structuredPptx }

    return {
      title,
      subtitle: '由韭菜盒子生成',
      theme: 'midnight',
      slides: toSlides(content),
    }
  }

  return {
    title,
    paragraphs: toParagraphs(content),
  }
}

export function canBuildOfficeCreateSpec(docType: OfficeDocType, content: string): boolean {
  try {
    buildOfficeCreateSpec(docType, content)
    return true
  } catch {
    return false
  }
}

export async function createOfficeDownloadFromText(docType: OfficeDocType, _content: string): Promise<OfficeDownloadFile[]> {
  throw new Error('线上 Office 生成已关闭。' + docType.toUpperCase() + ' 本地写出器尚未接入，请先导出 Markdown/TXT/HTML/CSV。')
}
