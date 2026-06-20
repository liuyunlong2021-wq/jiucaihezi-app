import { executeBrowserToolCall } from '@/utils/browserTools'
import { useFileStore } from '@/composables/useFileStore'
import type { CanvasNode, CanvasToolNodeData } from '@/types/canvas'
import { buildFinalPrompt, getIncomingFileInputs, mergePromptInputs } from './canvasInputs'

interface ToolRuntimeInput {
  node: CanvasNode
  nodes: CanvasNode[]
  edges: any[]
  onProgress?: (progress: number, message: string) => void
}

interface MarkdownPathResult {
  status: 'success' | 'error'
  source: string
  filename: string
  content: string
  engine: string
  sourcePath: string
  outputPath: string
  truncated: boolean
  message: string
  error?: string
}

function normalizeMarkdownName(name: string): string {
  const base = String(name || 'document')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.[^.]+$/i, '')
    .trim() || 'document'
  return `${base}.md`
}

/** 校验文件路径：必须为存在的普通文件，禁止路径遍历 */
function validateSourcePath(sourcePath: string, label: string): void {
  const trimmed = (sourcePath || '').trim()
  if (!trimmed) {
    throw new Error(`${label}：未提供文件路径`)
  }
  // 禁止 null 字节注入
  if (trimmed.includes('\x00')) {
    throw new Error(`${label}：文件路径包含非法字符`)
  }
  // 禁止路径遍历
  if (trimmed.includes('..')) {
    throw new Error(`${label}：不允许路径遍历（..）`)
  }
  // 必须是绝对路径（Rust 侧 canonicalize 要求）
  if (!trimmed.startsWith('/')) {
    throw new Error(`${label}：只支持绝对路径`)
  }
}

function wrapTextAsMarkdown(title: string, content: string): string {
  if (/\.md|\.markdown$/i.test(title)) return content.trim() + '\n'
  const cleanTitle = title.replace(/\.[^.]+$/i, '').replace(/[#\r\n]/g, ' ').trim() || '文档'
  return `# ${cleanTitle}\n\n${content.trim()}\n`
}

async function convertPathToMarkdown(sourcePath: string, label: string, onProgress?: ToolRuntimeInput['onProgress']): Promise<MarkdownPathResult> {
  validateSourcePath(sourcePath, label)
  onProgress?.(10, '调用本地 ToMD')
  const { invoke } = await import('@tauri-apps/api/core')
  // Web 端不支持本地 ToMD，返回错误
  if (typeof invoke !== 'function') {
    throw new Error(`${label}：本地文件转 Markdown 仅在桌面端可用`)
  }
  const jobId = `canvas_tomd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const result = await invoke('document_path_to_markdown_file', {
    input: {
      sourcePath,
      conversionMode: 'auto',
      outputFormat: 'md',
      timeoutSeconds: 600,
      maxChars: 500000,
      jobId,
    },
  }) as MarkdownPathResult
  if (result.status !== 'success') {
    throw new Error(result.message || result.error || `${label} 转 Markdown 失败`)
  }
  onProgress?.(92, 'Markdown 已生成')
  return result
}

function tryParseJson(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function requireBrowserSuccess(raw: string, fallback: string): any {
  const parsed = tryParseJson(raw)
  if (!parsed || typeof parsed !== 'object') return raw
  if (parsed.status && parsed.status !== 'success') {
    throw new Error(parsed.message || parsed.error || fallback)
  }
  return parsed.result ?? parsed
}

function searchResultToMarkdown(result: any, query: string): string {
  const rows = Array.isArray(result?.results) ? result.results : []
  const lines = [`# 搜索：${query}`]
  if (result?.searchUrl) lines.push(`> 搜索页：${result.searchUrl}`)
  if (!rows.length) {
    lines.push('', '没有读取到结构化搜索结果。')
    return lines.join('\n')
  }
  rows.forEach((item: any, index: number) => {
    const title = String(item.title || `结果 ${index + 1}`).trim()
    const url = String(item.url || '').trim()
    const snippet = String(item.snippet || '').trim()
    lines.push('', `## ${index + 1}. ${title}`)
    if (url) lines.push(url)
    if (snippet) lines.push(snippet)
  })
  return lines.join('\n') + '\n'
}

function browserResultToMarkdown(title: string, raw: string): string {
  const result = requireBrowserSuccess(raw, '浏览器读取失败')
  if (!result || typeof result !== 'object') {
    return `# ${title}\n\n${raw.trim()}\n`
  }

  const pageTitle = result.title || result.pageTitle || title
  const url = result.url || result.href || ''
  const text = result.text || result.content || result.markdown || result.body || JSON.stringify(result, null, 2)
  return [
    `# ${pageTitle}`,
    url ? `> 来源：${url}` : '',
    String(text || '').trim(),
  ].filter(Boolean).join('\n\n') + '\n'
}

async function runToMarkdown(input: ToolRuntimeInput, data: CanvasToolNodeData) {
  const fileStore = useFileStore()
  const incomingFiles = await getIncomingFileInputs(input.nodes, input.edges, input.node.id)
  const firstFile = incomingFiles[0]

  let filename = normalizeMarkdownName(data.label || 'ToMD')
  let content = ''
  let outputPath = ''

  if (firstFile?.sourcePath) {
    const result = await convertPathToMarkdown(firstFile.sourcePath, firstFile.fileName, input.onProgress)
    filename = result.filename || normalizeMarkdownName(firstFile.fileName)
    content = result.content || ''
    outputPath = result.outputPath || ''
  } else if (firstFile?.file) {
    filename = normalizeMarkdownName(firstFile.file.name)
    content = wrapTextAsMarkdown(firstFile.file.name, firstFile.file.content || '')
  } else if (data.input?.trim()) {
    filename = normalizeMarkdownName(data.label || 'ToMD 输出')
    content = wrapTextAsMarkdown(data.label || 'ToMD 输出', data.input)
  } else {
    throw new Error('ToMD 节点需要连接文件节点，或在节点里输入文本。')
  }

  if (!content.trim()) throw new Error('ToMD 没有得到有效 Markdown 内容。')
  const file = await fileStore.addText(filename, content)
  return { content, fileId: file.id, outputPath }
}

async function runBrowserRead(input: ToolRuntimeInput, data: CanvasToolNodeData) {
  const merged = await mergePromptInputs(input.nodes, input.edges, input.node.id)
  const query = buildFinalPrompt(merged.text, data.input || '').trim()
  if (!query) throw new Error('浏览器读取节点需要 URL 或搜索词。')

  input.onProgress?.(20, '打开浏览器')
  const isUrl = /^https?:\/\//i.test(query)
  if (isUrl) {
    requireBrowserSuccess(await executeBrowserToolCall({
      function: { name: 'browser_open', arguments: JSON.stringify({ url: query }) },
    }), '浏览器打开网页失败')
  } else {
    const search = requireBrowserSuccess(await executeBrowserToolCall({
      function: { name: 'browser_search', arguments: JSON.stringify({ query, max_results: 6 }) },
    }), '浏览器搜索失败')
    const content = searchResultToMarkdown(search, query)
    const fileStore = useFileStore()
    const file = await fileStore.addText(`${data.label || '浏览器搜索'}.md`, content)
    return { content, fileId: file.id, outputPath: '' }
  }

  input.onProgress?.(70, '读取网页内容')
  const raw = await executeBrowserToolCall({
    function: { name: 'browser_read', arguments: JSON.stringify({ max_chars: 40000 }) },
  })
  const content = browserResultToMarkdown(isUrl ? '网页读取结果' : `搜索：${query}`, raw)
  const fileStore = useFileStore()
  const file = await fileStore.addText(`${data.label || '浏览器读取'}.md`, content)
  return { content, fileId: file.id, outputPath: '' }
}

export async function runCanvasToolNode(input: ToolRuntimeInput): Promise<{ content: string; fileId: string; outputPath?: string }> {
  const data = input.node.data as CanvasToolNodeData
  if (data.toolKind === 'tomd') return runToMarkdown(input, data)
  if (data.toolKind === 'browser-read') return runBrowserRead(input, data)
  throw new Error('暂不支持这个本地工具。')
}
