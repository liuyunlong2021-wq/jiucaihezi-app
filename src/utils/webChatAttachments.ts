/**
 * utils/webChatAttachments.ts
 *
 * Web 端上传资料解析适配层。
 *
 * 职责：
 * 1. 将用户上传的文件发送到 8091 attachment-processor 服务解析
 * 2. 接收统一的 AttachmentDocument
 * 3. 格式化为 LLM 可注入的上下文块
 *
 * 不负责：
 * - 本地文件读取（由 useFileUpload.ts 处理文本直读）
 * - 图片 base64 预览（由 FileUploader.vue 处理）
 * - 桌面端 OpenCode/Tauri 链路
 * - 永久存储
 */

import { resolveApiConfig, buildHeaders } from '@/utils/api'
import type { ApiConfig } from '@/utils/api'
import { isTauriRuntime } from '@/utils/tauriEnv'

// ── 大文件安全 Base64 编码（分块避免 btoa + spread 爆栈）──
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000 // 32KB
  const parts: string[] = []
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK))))
  }
  return btoa(parts.join(''))
}

// ── Types (mirrors 8091 AttachmentDocument contract) ──

export interface AttachmentBlock {
  id: string
  type: 'heading' | 'paragraph' | 'table' | 'formula' | 'figure' | 'caption' | 'list' | 'code' | 'metadata'
  text?: string
  markdown?: string
  page?: number
  bbox?: [number, number, number, number]
  confidence?: number
}

export interface AttachmentWarning {
  code: string
  message: string
  page?: number
}

export interface AttachmentUsage {
  page_count?: number
  image_count?: number
  token_estimate?: number
  elapsed_ms?: number
}

export interface AttachmentDocument {
  id: string
  source_name: string
  mime_type: string
  size_bytes: number
  parser: 'text' | 'pdf-text' | 'pp-ocr-v6' | 'pp-ocr-v6-small' | 'pp-structure-v3' | 'office-8090' | 'graphify-8090' | 'unsupported'
  status: 'success' | 'partial' | 'error'
  markdown: string
  blocks: AttachmentBlock[]
  warnings: AttachmentWarning[]
  usage: AttachmentUsage
  expires_at: string
  error_code?: string
  error_message?: string
}

export interface ParseResponse {
  ok: boolean
  document: AttachmentDocument | null
  error: string
}

// ── Parse status for UI ──

export type ParseStatus = 'idle' | 'uploading' | 'parsing' | 'done' | 'error'

export interface AttachedFileParseState {
  file: File
  fileName: string
  fileSize: number
  status: ParseStatus
  progress?: number // 0-100
  document?: AttachmentDocument
  error?: string
}

// ── File type detection (client-side, for routing decision) ──

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.json', '.xml', '.yaml', '.yml',
  '.py', '.js', '.ts', '.jsx', '.tsx', '.html', '.css',
  '.sh', '.bash', '.sql', '.r', '.java', '.go',
  '.rs', '.c', '.cpp', '.h', '.swift', '.kt',
  '.toml', '.ini', '.cfg', '.conf', '.log',
])

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp',
])

const PDF_EXTENSIONS = new Set(['.pdf'])

const OFFICE_EXTENSIONS = new Set([
  '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt',
  '.odt', '.ods', '.odp',
])

export type FileCategory = 'text' | 'image' | 'pdf' | 'office' | 'unknown'

export function categorizeFile(fileName: string): FileCategory {
  const ext = '.' + (fileName.split('.').pop() || '').toLowerCase()
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  if (OFFICE_EXTENSIONS.has(ext)) return 'office'
  return 'unknown'
}

export function needsServerParse(fileName: string): boolean {
  return categorizeFile(fileName) !== 'text'
}

// ── API call ──

let _apiConfig: ApiConfig | null = null

async function getApiConfig(): Promise<ApiConfig> {
  if (_apiConfig) return _apiConfig
  // allowAnonymous: 未登录用户也能用 8091 OCR（8091 只校验 token 格式不验真伪）
  _apiConfig = await resolveApiConfig({ forceCloud: true, allowAnonymous: true })
  return _apiConfig
}

/**
 * Upload a file to the 8091 attachment-processor for parsing.
 *
 * Auth: Uses the same session/apiKey as chat completions.
 * Nginx validates the session before proxying to 8091.
 *
 * Two transport modes:
 *   Web 端   → FormData (multipart/form-data), browser handles boundary
 *   桌面端   → JSON body with base64 file data (Rust HTTP bridge only supports string body)
 *
 * Returns the parsed AttachmentDocument on success.
 * Throws on network error or parse failure.
 */
export async function parseFileOnServer(file: File): Promise<AttachmentDocument> {
  const config = await getApiConfig()

  // 8091 需要 Bearer token（长度 ≥ 20），只做格式校验不验真伪。
  // buildHeaders 在匿名模式下跳过 Authorization，这里补一个占位 token。
  const headers = buildHeaders(config)
  if (!headers['Authorization']) {
    headers['Authorization'] = 'Bearer __JC_ANONYMOUS_ATTACHMENT_UPLOAD__'
    headers['x-api-key'] = '__JC_ANONYMOUS_ATTACHMENT_UPLOAD__'
  }

  let response: Response

  if (isTauriRuntime()) {
    // 桌面端：读文件 → base64 → JSON body（Rust HTTP bridge 不支持 FormData）
    // 必须直连生产域名，不走 Vite proxy（/__jc_api 不代理 /api/attachments/）
    const apiBase = 'https://api.jiucaihezi.studio'
    const arrayBuf = await file.arrayBuffer()
    const base64 = arrayBufferToBase64(arrayBuf)
    response = await fetch(`${apiBase}/api/attachments/parse`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        file_name: file.name,
        file_data: base64,
        file_size: file.size,
        mode: 'auto',
      }),
    })
  } else {
    // Web 端：FormData（浏览器原生 fetch 支持）
    delete headers['Content-Type'] // browser sets multipart boundary
    const formData = new FormData()
    formData.append('file', file, file.name)
    formData.append('mode', 'auto')
    response = await fetch(`${config.apiBase}/api/attachments/parse`, {
      method: 'POST',
      headers,
      body: formData,
    })
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`服务器解析失败 (${response.status}): ${errorText.slice(0, 200)}`)
  }

  const result: ParseResponse = await response.json()

  if (!result.ok || !result.document) {
    throw new Error(result.error || '解析服务返回空结果')
  }

  return result.document
}

/**
 * Result of parsing a batch of files on the server.
 * Separates successes from failures so the UI can report both.
 */
export interface ParseFilesResult {
  /** Successfully parsed documents (keyed by file name) */
  documents: Map<string, AttachmentDocument>
  /** Files that failed to parse: fileName → error message */
  failures: Map<string, string>
  /** Total files attempted */
  total: number
}

/**
 * Parse multiple files in parallel and return results.
 * Failures are collected but don't throw — the caller decides how to handle.
 */
export async function parseFilesOnServer(
  files: File[],
  onProgress?: (fileName: string, status: ParseStatus, doc?: AttachmentDocument, error?: string) => void,
): Promise<ParseFilesResult> {
  const documents = new Map<string, AttachmentDocument>()
  const failures = new Map<string, string>()

  const tasks = files.map(async (file) => {
    onProgress?.(file.name, 'uploading')
    try {
      const doc = await parseFileOnServer(file)
      documents.set(file.name, doc)
      onProgress?.(file.name, 'done', doc)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误'
      failures.set(file.name, msg)
      onProgress?.(file.name, 'error', undefined, msg)
    }
  })

  await Promise.allSettled(tasks)
  return { documents, failures, total: files.length }
}

// ── LLM Context formatting ──

/**
 * Format a parsed AttachmentDocument for injection into LLM context.
 *
 * Produces bounded Markdown that clearly marks user-uploaded material.
 * Includes parser status, warnings, and content boundaries.
 */
export function formatAttachmentForLLM(doc: AttachmentDocument): string {
  const parts: string[] = []

  parts.push('[用户上传资料开始]')
  parts.push(`文件名: ${doc.source_name}`)

  if (doc.parser && doc.parser !== 'unsupported') {
    parts.push(`解析器: ${doc.parser}`)
  }

  if (doc.status === 'error') {
    parts.push(`状态: 解析失败`)
    parts.push(`错误: ${doc.error_message || '未知错误'}`)
    parts.push('[用户上传资料结束]')
    return parts.join('\n')
  }

  if (doc.status === 'partial') {
    parts.push(`状态: 部分解析 (可能不完整)`)
  }

  // Include warnings
  if (doc.warnings.length > 0) {
    parts.push('警告:')
    for (const w of doc.warnings) {
      const pageHint = w.page ? ` (第${w.page}页)` : ''
      parts.push(`  - ${w.message}${pageHint}`)
    }
  }

  // Usage hint
  if (doc.usage.token_estimate) {
    parts.push(`内容长度: ≈${doc.usage.token_estimate} tokens`)
  }

  parts.push('')
  parts.push('<document_markdown>')
  parts.push(doc.markdown || '(无内容)')
  parts.push('</document_markdown>')
  parts.push('[用户上传资料结束]')

  return parts.join('\n')
}

/**
 * Format multiple parsed documents for LLM context.
 * Each document gets its own boundary block.
 */
export function formatAttachmentsForLLM(docs: AttachmentDocument[]): string {
  if (!docs.length) return ''

  // Separate successful/partial from errors
  const good = docs.filter(d => d.status === 'success' || d.status === 'partial')
  const bad = docs.filter(d => d.status === 'error')

  const parts: string[] = []

  if (good.length > 0) {
    parts.push(`以下 ${good.length} 个文件已解析，请根据这些资料回答用户问题：`)
    parts.push('')
    for (const doc of good) {
      parts.push(formatAttachmentForLLM(doc))
      parts.push('')
    }
  }

  if (bad.length > 0) {
    parts.push('以下文件未能解析：')
    for (const doc of bad) {
      parts.push(`  - ${doc.source_name}: ${doc.error_message || '解析失败'}`)
    }
  }

  return parts.join('\n')
}

/**
 * Build a complete user message with parsed attachment content injected.
 *
 * @param userText - The user's typed message
 * @param parsedDocs - Successfully parsed attachment documents
 * @returns Formatted message content string for LLM
 */
export function buildUserMessageWithAttachments(
  userText: string,
  parsedDocs: AttachmentDocument[],
): string {
  if (!parsedDocs.length) return userText

  const attachmentBlock = formatAttachmentsForLLM(parsedDocs)
  if (!attachmentBlock) return userText

  return `${attachmentBlock}\n\n用户问题:\n${userText}`
}

// ── Token budget control ──

const MAX_ATTACHMENT_TOKENS = 80_000 // ~80K tokens max for attachments

export function trimAttachmentDocsByBudget(
  docs: AttachmentDocument[],
  maxTokens: number = MAX_ATTACHMENT_TOKENS,
): { included: AttachmentDocument[]; truncated: AttachmentDocument[] } {
  const included: AttachmentDocument[] = []
  const truncated: AttachmentDocument[] = []
  let totalTokens = 0

  for (const doc of docs) {
    const docTokens = doc.usage.token_estimate || (doc.markdown.length / 3)
    if (totalTokens + docTokens <= maxTokens) {
      included.push(doc)
      totalTokens += docTokens
    } else {
      truncated.push(doc)
    }
  }

  return { included, truncated }
}
