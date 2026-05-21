export type ConverterOutputFormat = 'md' | 'txt' | 'html' | 'csv' | 'json' | 'srt'
export type ConverterMode = 'auto' | 'fast' | 'ocr'
export const MAX_AUTO_IMPORT_CHARS = 200_000

export interface ConverterFormatOption {
  value: ConverterOutputFormat
  label: string
}

export interface FormatConverterSettings {
  timeoutMinutes: number
  stopOnTimeout: boolean
  importToEditor: boolean
  openFile: boolean
  openFolder: boolean
}

const BASE_FORMATS: ConverterFormatOption[] = [
  { value: 'md', label: 'Markdown' },
  { value: 'txt', label: 'TXT' },
  { value: 'html', label: 'HTML' },
]

export function defaultFormatConverterSettings(): FormatConverterSettings {
  return {
    timeoutMinutes: 10,
    stopOnTimeout: true,
    importToEditor: false,
    openFile: false,
    openFolder: false,
  }
}

export function shouldImportConvertedContentToEditor(input: {
  importToEditor: boolean
  outputFormat: ConverterOutputFormat
  contentLength: number
}): boolean {
  return input.importToEditor
    && ['md', 'txt'].includes(input.outputFormat)
    && input.contentLength > 0
    && input.contentLength <= MAX_AUTO_IMPORT_CHARS
}

function extensionOf(path: string): string {
  return String(path || '').split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || ''
}

export function isPdfPath(path: string): boolean {
  return extensionOf(path) === 'pdf'
}

export function isImagePath(path: string): boolean {
  return ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'heic', 'heif'].includes(extensionOf(path))
}

export function defaultConversionModeForPath(path: string): ConverterMode {
  if (isPdfPath(path)) return 'auto'
  if (isImagePath(path)) return 'ocr'
  return 'fast'
}

export function outputFormatsForPath(path: string): ConverterFormatOption[] {
  const ext = extensionOf(path)
  const formats = [...BASE_FORMATS]
  if (['csv', 'tsv', 'xls', 'xlsx', 'ods'].includes(ext)) formats.push({ value: 'csv', label: 'CSV' })
  if (ext === 'json') formats.push({ value: 'json', label: 'JSON' })
  if (['srt', 'vtt'].includes(ext)) formats.push({ value: 'srt', label: 'SRT' })
  return formats
}

export function normalizeOutputFormatForPath(path: string, format: ConverterOutputFormat): ConverterOutputFormat {
  const allowed = outputFormatsForPath(path).map(item => item.value)
  return allowed.includes(format) ? format : 'md'
}

export function readableSourceMeta(path: string): string {
  const ext = extensionOf(path)
  if (ext === 'pdf') return 'PDF · 智能推荐'
  if (isImagePath(path)) return '图片 · 建议 OCR'
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'Word · 建议快速转换'
  if (['xls', 'xlsx', 'ods', 'csv', 'tsv'].includes(ext)) return '表格 · 可导出 CSV'
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'PPT · 建议快速转换'
  if (ext === 'json') return 'JSON · 可保持结构'
  if (['srt', 'vtt'].includes(ext)) return '字幕 · 可导出 SRT'
  return '文件 · 建议快速转换'
}
