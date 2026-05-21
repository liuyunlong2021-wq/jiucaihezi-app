import { isTauriRuntime } from './tauriEnv'

export interface DocumentToMarkdownInput {
  file: File
  maxChars?: number
  timeoutMs?: number
}

export interface DocumentToMarkdownResult {
  status: 'success' | 'error'
  source: string
  filename: string
  content: string
  engine: 'text' | 'markitdown' | 'rapidocr_chunked' | 'rapidocr_image' | 'attachment_text' | 'unsupported'
  sourcePath?: string
  outputPath?: string
  truncated: boolean
  message: string
  error?: string
}

export function normalizeMarkdownOutputFilename(filename: string): string {
  const clean = String(filename || 'document')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.(md|markdown)$/i, '')
    .replace(/\.[^.]+$/i, '')
    .replace(/\.+$/g, '')
  return `${clean || 'document'}.md`
}

export function isMeaningfulMarkdownContent(markdown: string): boolean {
  const cleaned = String(markdown || '')
    .replace(/\[第\d+页\]/g, '')
    .replace(/\[Page\s*\d+\]/gi, '')
    .replace(/#+\s*/g, '')
    .replace(/[-_*`>[\]().,，。:：;；\s]/g, '')
    .trim()
  return /[\p{L}\p{N}]/u.test(cleaned) && cleaned.length >= 2
}

export function shouldRetryWithOcr(file: File | { name: string; type?: string }, result: DocumentToMarkdownResult): boolean {
  const isPdf = String(file.type || '').includes('pdf') || /\.pdf$/i.test(file.name)
  if (!isPdf || result.status !== 'error') return false
  const message = `${result.message || ''}\n${result.error || ''}`
  return /扫描版|图片型|没有提取到有效正文|MarkItDown 没有提取到有效正文|EMPTY_TEXT/i.test(message)
}

function truncateContent(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false }
  return { content: content.slice(0, maxChars), truncated: true }
}

function buildTextMarkdown(file: File, text: string): string {
  if (/\.md|\.markdown$/i.test(file.name)) return text.trim() + '\n'
  const title = file.name.replace(/\.[^.]+$/, '').replace(/[#\r\n]/g, ' ').trim() || 'document'
  return `# ${title}\n\n${text.trim()}\n`
}

function isLikelyTextFile(file: File): boolean {
  return file.type.startsWith('text/') ||
    /\.(txt|md|markdown|csv|json|xml|html|css|js|jsx|ts|tsx|py|java|c|cpp|h|go|rs|sh|yaml|yml|toml|sql|vue|svelte|log)$/i.test(file.name)
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export async function convertDocumentToMarkdown(input: DocumentToMarkdownInput): Promise<DocumentToMarkdownResult> {
  const maxChars = Math.max(1, Math.min(Number(input.maxChars || 500000), 1_000_000))
  const outputFilename = normalizeMarkdownOutputFilename(input.file.name)

  if (isLikelyTextFile(input.file)) {
    const text = await input.file.text()
    const markdown = buildTextMarkdown(input.file, text)
    const truncated = truncateContent(markdown, maxChars)
    if (!isMeaningfulMarkdownContent(truncated.content)) {
      return {
        status: 'error',
        source: input.file.name,
        filename: outputFilename,
        content: '',
        engine: 'text',
        truncated: false,
        message: '文本文件没有可转换的有效内容。',
        error: 'EMPTY_TEXT',
      }
    }
    return {
      status: 'success',
      source: input.file.name,
      filename: outputFilename,
      content: truncated.content,
      engine: 'text',
      truncated: truncated.truncated,
      message: `已将 ${input.file.name} 转换为 Markdown。`,
    }
  }

  if (!isTauriRuntime()) {
    return {
      status: 'error',
      source: input.file.name,
      filename: outputFilename,
      content: '',
      engine: 'unsupported',
      truncated: false,
      message: '桌面端本地转换不可用，请在韭菜盒子 Studio 中使用。',
      error: 'TAURI_REQUIRED',
    }
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const timeoutMs = Math.max(10_000, Math.min(Number(input.timeoutMs || 120_000), 1_800_000))
    const result = await withTimeout(invoke('document_to_markdown_file', {
      input: {
        filename: input.file.name,
        mimeType: input.file.type || 'application/octet-stream',
        dataBase64: arrayBufferToBase64(await input.file.arrayBuffer()),
        maxChars,
      },
    }), timeoutMs, '本地文档转换超时，请先转成 Markdown/TXT 后再导入。') as {
      status: string
      source: string
      filename: string
      content: string
      engine: 'markitdown' | 'rapidocr_chunked' | 'rapidocr_image' | 'unsupported'
      sourcePath?: string
      outputPath?: string
      truncated?: boolean
      message?: string
      error?: string
    }

    return {
      status: result.status === 'success' ? 'success' : 'error',
      source: result.source || input.file.name,
      filename: result.filename || outputFilename,
      content: result.content || '',
      engine: result.engine || 'unsupported',
      sourcePath: result.sourcePath,
      outputPath: result.outputPath,
      truncated: Boolean(result.truncated),
      message: result.message || (result.status === 'success' ? '转换完成。' : '转换失败。'),
      error: result.error,
    }
  } catch (err) {
    return {
      status: 'error',
      source: input.file.name,
      filename: outputFilename,
      content: '',
      engine: 'unsupported',
      truncated: false,
      message: (err as Error).message || '本地 Markdown 转换失败。',
      error: 'LOCAL_CONVERSION_FAILED',
    }
  }
}
