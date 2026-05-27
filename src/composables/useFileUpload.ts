/**
 * useFileUpload.ts — 统一文件上传服务
 *
 * 所有文件上传/处理的单一入口：
 *   - Office/PDF/文本资料 → 本地 ToMD 转 Markdown
 *   - 图片 → 本地预览
 *   - 音视频 → 本地预览 / 本地缓存
 *
 * 统一返回 ProcessedFile 对象，各组件直接使用。
 */
import { convertDocumentToMarkdown } from '@/utils/documentMarkdown'

// ─── 类型 ───

export interface ProcessedFile {
  /** 原始文件名 */
  name: string
  /** 文件类型分类 */
  type: 'image' | 'text' | 'pdf' | 'office' | 'audio' | 'video' | 'unknown'
  /** 原始 MIME */
  mimeType: string
  /** 原始文件大小 (bytes) */
  size: number
  /** 提取的文本内容（文本/PDF/Office 文件） */
  textContent?: string
  /** 图片预览 (data URL 或远程 URL) */
  previewUrl?: string
  /** 后端文件 URL（大文件/媒体） */
  remoteUrl?: string
  /** 缩略图 URL（Office 文件首页预览） */
  thumbnailUrl?: string
  /** Markdown 转换输出文件名 */
  markdownFilename?: string
  /** Markdown 转换引擎 */
  markdownEngine?: string
  /** 处理状态 */
  status: 'processing' | 'ready' | 'error'
  /** 错误信息 */
  error?: string
  /** 上传进度 0-100 */
  progress: number
  /** 原始 File 对象 */
  rawFile: File
}

export interface UploadOptions {
  /** 最大文本截取长度 (默认 500KB) */
  maxTextLength?: number
  /** 已废弃：桌面版不再上传图片到后端，保留字段仅兼容旧调用 */
  preferRemoteImage?: boolean
  /** 图片客户端压缩阈值 (默认 1MB，小于此值客户端压缩) */
  localCompressThreshold?: number
  /** 图片压缩目标大小 base64 (默认 2MB) */
  compressTarget?: number
  /** 上传进度回调 */
  onProgress?: (file: ProcessedFile) => void
}

// ─── 文件类型检测 ───

const OFFICE_EXT = /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/i
const PDF_EXT = /\.pdf$/i
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp']
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|tiff?)$/i
const TEXT_EXT = /\.(txt|md|csv|json|xml|html|css|js|jsx|ts|tsx|py|java|c|cpp|h|hpp|go|rs|sh|bash|zsh|yaml|yml|toml|sql|r|swift|kt|rb|php|dockerfile|env|ini|conf|log|vue|svelte|lua|pl|scala|zig|dart|makefile|cmake)$/i
const AUDIO_EXT = /\.(mp3|wav|ogg|flac|aac|m4a|wma|opus)$/i
const VIDEO_EXT = /\.(mp4|mov|avi|mkv|webm|flv|wmv|m4v)$/i

export function detectFileType(file: File): ProcessedFile['type'] {
  const name = file.name.toLowerCase()
  const mime = file.type.toLowerCase()

  // 1. MIME type 优先判断
  if (IMAGE_TYPES.includes(mime) || IMAGE_EXT.test(name)) return 'image'
  if (mime === 'application/pdf' || PDF_EXT.test(name)) return 'pdf'

  // 2. Office MIME types（浏览器对 Office 文件 MIME 识别更可靠）
  if (mime.includes('officedocument') || mime.includes('msword') || mime.includes('ms-excel') ||
      mime.includes('ms-powerpoint') || mime === 'application/rtf' ||
      mime.includes('opendocument') || OFFICE_EXT.test(name)) return 'office'

  // 3. 文本类型
  if (mime.startsWith('text/') || mime === 'application/json' ||
      mime === 'application/xml' || mime === 'application/javascript' ||
      TEXT_EXT.test(name)) return 'text'

  // 4. 音视频
  if (mime.startsWith('audio/') || AUDIO_EXT.test(name)) return 'audio'
  if (mime.startsWith('video/') || VIDEO_EXT.test(name)) return 'video'

  // 5. 无 MIME 时根据扩展名兜底
  if (!mime || mime === 'application/octet-stream') {
    if (OFFICE_EXT.test(name)) return 'office'
    if (PDF_EXT.test(name)) return 'pdf'
    if (TEXT_EXT.test(name)) return 'text'
  }

  return 'unknown'
}

// ─── 核心：处理单个文件 ───

export async function processFile(file: File, options: UploadOptions = {}): Promise<ProcessedFile> {
  const {
    maxTextLength = 500 * 1024,
    localCompressThreshold = 1 * 1024 * 1024,
    compressTarget = 2 * 1024 * 1024,
    onProgress,
  } = options

  const type = detectFileType(file)
  const result: ProcessedFile = {
    name: file.name,
    type,
    mimeType: file.type,
    size: file.size,
    status: 'processing',
    progress: 0,
    rawFile: file,
  }

  const updateProgress = (p: number) => {
    result.progress = p
    onProgress?.(result)
  }

  try {
    switch (type) {
      case 'pdf':
      case 'office':
        await processOfficeFile(result, maxTextLength, updateProgress)
        break

      case 'image':
        await processImage(result, localCompressThreshold, compressTarget, updateProgress)
        break

      case 'text':
        await processText(result, maxTextLength, updateProgress)
        break

      case 'audio':
      case 'video':
        await processMedia(result, updateProgress)
        break

      default:
        // 二进制文件如果看起来像图片，走图片处理
        if (file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|ico|tiff?|heic|heif)$/i.test(file.name)) {
          result.type = 'image'
          await processImage(result, localCompressThreshold, compressTarget, updateProgress)
        } else {
          // 尝试作为文本读取
          try {
            const text = await file.text()
            if (text.length > 0 && !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 1000))) {
              result.textContent = text.slice(0, maxTextLength)
              result.type = 'text'
            } else {
              throw new Error('该文件不是可读取文本，请使用本地格式转换工具先转为 Markdown。')
            }
          } catch {
            throw new Error('该文件无法在本地直接读取，请使用本地格式转换工具先转为 Markdown。')
          }
        }
    }

    result.status = 'ready'
    result.progress = 100
  } catch (err: any) {
    result.status = 'error'
    result.error = err.message || '文件处理失败'
  }

  onProgress?.(result)
  return result
}

// ─── 批量处理 ───

export async function processFiles(files: FileList | File[], options: UploadOptions = {}): Promise<ProcessedFile[]> {
  const results: ProcessedFile[] = []
  for (const file of Array.from(files)) {
    results.push(await processFile(file, options))
  }
  return results
}

// ─── 内部：Office/PDF 文件处理 ───

async function processOfficeFile(result: ProcessedFile, maxTextLength: number, onProgress: (p: number) => void) {
  onProgress(10)

  const converted = await convertDocumentToMarkdown({
    file: result.rawFile,
    maxChars: maxTextLength,
    timeoutMs: 1800000,
  })
  onProgress(85)

  result.markdownFilename = converted.filename
  result.markdownEngine = converted.engine
  if (converted.status === 'success') {
    result.textContent = converted.content
    result.error = undefined
  } else {
    result.textContent = ''
    result.error = converted.message || converted.error || (
      result.type === 'pdf'
        ? 'PDF 没有可提取的文字层，可能是扫描版/图片型 PDF，需要 OCR'
        : '文档没有提取到有效正文'
    )
    throw new Error(result.error)
  }

  onProgress(100)
}

// ─── 内部：图片处理 ───

async function processImage(
  result: ProcessedFile,
  _localThreshold: number,
  compressTarget: number,
  onProgress: (p: number) => void,
) {
  onProgress(10)

  if (result.mimeType === 'image/svg+xml') {
    const text = await result.rawFile.text()
    result.previewUrl = 'data:image/svg+xml;base64,' + btoa(text)
    onProgress(100)
    return
  }

  const processLocally = async (): Promise<string> => {
    const dataUrl = await readAsDataURL(result.rawFile)
    if (dataUrl.length <= compressTarget) return dataUrl
    return await compressImageClient(result.rawFile, compressTarget)
  }

  const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: () => Promise<T>): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]).catch(() => fallback())
  }

  try {
    result.previewUrl = await withTimeout(
      processLocally(),
      10000,
      () => readAsDataURL(result.rawFile),
    )
  } catch {
    result.previewUrl = URL.createObjectURL(result.rawFile)
  }

  onProgress(100)
}

// ─── 内部：文本处理 ───

async function processText(result: ProcessedFile, maxLength: number, onProgress: (p: number) => void) {
  onProgress(30)
  const text = await result.rawFile.text()
  result.textContent = text.slice(0, maxLength)
  onProgress(100)
}

// ─── 内部：音视频处理 ───

async function processMedia(result: ProcessedFile, onProgress: (p: number) => void) {
  onProgress(30)
  result.previewUrl = URL.createObjectURL(result.rawFile)
  onProgress(100)
}

// ─── 工具：客户端图片压缩 ───

async function compressImageClient(file: File, targetSize: number): Promise<string> {
  const dataUrl = await readAsDataURL(file)
  if (dataUrl.length <= targetSize) return dataUrl

  const img = await loadImage(dataUrl)
  // 初始缩放：限制最大尺寸
  const maxDim = targetSize > 500 * 1024 ? 2048 : 800
  let { width, height } = img
  if (width > maxDim || height > maxDim) {
    const ratio = Math.min(maxDim / width, maxDim / height)
    width = Math.round(width * ratio)
    height = Math.round(height * ratio)
  }

  // NextChat 策略：先降质量(0.9→0.5)，再缩尺寸(每次×0.9)，最多20次迭代
  let quality = 0.9
  let result = canvasCompress(img, width, height, quality)
  let iterations = 0
  while (result.length > targetSize && iterations < 20) {
    iterations++
    if (quality > 0.5) {
      quality -= 0.1
    } else {
      width = Math.round(width * 0.9)
      height = Math.round(height * 0.9)
      if (width < 100 || height < 100) break
    }
    result = canvasCompress(img, width, height, quality)
  }
  return result
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

function canvasCompress(img: HTMLImageElement, w: number, h: number, quality: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', quality)
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

// ─── 便捷方法：判断是否为 LLM 可消费的文件 ───

export function isLLMConsumable(pf: ProcessedFile): boolean {
  return !!(pf.textContent || pf.previewUrl || pf.remoteUrl)
}

/**
 * 将 ProcessedFile 转换为 LLM 消息内容片段
 * - 图片 → image_url content part
 * - 文本/Office → text content part
 */
export function toMessageContent(pf: ProcessedFile): Array<{ type: string; [k: string]: any }> {
  const parts: Array<{ type: string; [k: string]: any }> = []

  if (pf.type === 'image') {
    const url = pf.remoteUrl || pf.previewUrl
    if (url) {
      parts.push({
        type: 'image_url',
        image_url: { url, detail: 'auto' },
      })
    }
  }

  if (pf.textContent) {
    parts.push({
      type: 'text',
      text: `[文件: ${pf.name}]\n${pf.textContent}`,
    })
  }

  return parts
}
