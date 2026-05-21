/**
 * fileProcessor.ts — 文件校验、压缩、文本提取
 */

// ─── 支持的格式 ───────────────────────────────────────────
export const SUPPORTED_IMAGE_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'
]

export const SUPPORTED_TEXT_EXT = /\.(txt|md|csv|json|xml|html|css|js|jsx|ts|tsx|py|java|c|cpp|h|hpp|go|rs|sh|bash|zsh|yaml|yml|toml|sql|r|swift|kt|rb|php|dockerfile|env|ini|conf|log|vue|svelte|lua|pl|scala|zig|dart|makefile|cmake|srt|vtt)$/i

// ─── 大小限制 ─────────────────────────────────────────────
export const MAX_IMAGE_RAW = 20 * 1024 * 1024      // 20MB 原始
export const MAX_TEXT_SIZE = 1 * 1024 * 1024        // 1MB
export const MAX_PDF_SIZE = 20 * 1024 * 1024        // 20MB
export const MAX_BASE64_TARGET = 2 * 1024 * 1024    // 压缩目标 2MB base64
export const TEXT_TRUNCATE_BYTES = 500 * 1024       // 截取 500KB

// ─── 类型判断 ─────────────────────────────────────────────
export function isImageFile(file: File): boolean {
  return SUPPORTED_IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(file.name)
}

export function isTextFile(file: File): boolean {
  return file.type.startsWith('text/') || SUPPORTED_TEXT_EXT.test(file.name)
}

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

// ─── 文件校验 ─────────────────────────────────────────────
export interface ValidationResult {
  ok: boolean
  error?: string
  fileType: 'image' | 'text' | 'pdf' | 'unsupported'
}

export function validateFile(file: File): ValidationResult {
  if (isImageFile(file)) {
    if (file.size > MAX_IMAGE_RAW) {
      return { ok: false, error: `图片过大（${formatSize(file.size)}），最大支持 20MB`, fileType: 'image' }
    }
    return { ok: true, fileType: 'image' }
  }

  if (isPdfFile(file)) {
    if (file.size > MAX_PDF_SIZE) {
      return { ok: false, error: `PDF 过大（${formatSize(file.size)}），最大支持 20MB`, fileType: 'pdf' }
    }
    return { ok: true, fileType: 'pdf' }
  }

  if (isTextFile(file)) {
    if (file.size > MAX_TEXT_SIZE) {
      return { ok: true, fileType: 'text' } // 允许但会截取
    }
    return { ok: true, fileType: 'text' }
  }

  return { ok: false, error: `不支持的文件格式：${file.name.split('.').pop() || file.type}`, fileType: 'unsupported' }
}

// ─── 图片压缩 ─────────────────────────────────────────────
export async function compressImage(file: File): Promise<string> {
  const originalDataUrl = await readFileAsDataURL(file)

  // SVG 不压缩
  if (file.type === 'image/svg+xml') return originalDataUrl

  // 小图片不压缩
  if (originalDataUrl.length <= MAX_BASE64_TARGET) return originalDataUrl

  const img = await loadImage(originalDataUrl)
  const maxDim = 2048
  let { width, height } = img

  // 缩放到最大边 2048px
  if (width > maxDim || height > maxDim) {
    const ratio = Math.min(maxDim / width, maxDim / height)
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }

  // 逐步降低质量直到满足大小
  const qualities = [0.85, 0.7, 0.5, 0.3]
  for (const q of qualities) {
    const result = canvasToDataURL(img, width, height, q)
    if (result.length <= MAX_BASE64_TARGET) return result
  }

  // 最后手段：进一步缩小尺寸
  width = Math.round(width * 0.5)
  height = Math.round(height * 0.5)
  const result = canvasToDataURL(img, width, height, 0.5)
  if (result.length <= MAX_BASE64_TARGET) return result

  throw new Error('图片压缩后仍然过大，请使用更小的图片')
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

function canvasToDataURL(img: HTMLImageElement, w: number, h: number, quality: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

// ─── PDF 文本提取 ──────────────────────────────────────────
let pdfjsLib: any = null

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib
  try {
    pdfjsLib = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs' as any)
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs'
    return pdfjsLib
  } catch {
    throw new Error('PDF 解析库加载失败，请检查网络')
  }
}

export async function extractPdfText(file: File, maxPages = 30): Promise<string> {
  const pdfjs = await loadPdfJs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise
  const totalPages = Math.min(pdf.numPages, maxPages)
  const pages: string[] = []

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const text = textContent.items.map((item: any) => item.str).join(' ')
    if (text.trim()) pages.push(`[第${i}页]\n${text}`)
  }

  let result = pages.join('\n\n')
  if (pdf.numPages > maxPages) {
    result += `\n\n[注：PDF 共 ${pdf.numPages} 页，已提取前 ${maxPages} 页]`
  }
  return result
}

// ─── 文本截取 ──────────────────────────────────────────────
export function truncateText(text: string, maxBytes = TEXT_TRUNCATE_BYTES): { text: string; truncated: boolean } {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(text)
  if (bytes.length <= maxBytes) return { text, truncated: false }

  const decoder = new TextDecoder()
  const truncated = decoder.decode(bytes.slice(0, maxBytes))
  return { text: truncated, truncated: true }
}

// ─── 工具函数 ─────────────────────────────────────────────
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`))
    reader.readAsDataURL(file)
  })
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error(`读取文件失败: ${file.name}`))
    reader.readAsText(file)
  })
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
