import { isAllowedDownloadUrl } from './urlSafety'

export interface OfficeDownloadFile {
  filename: string
  url: string
  size?: number
}

const DOWNLOAD_EXT = /\.(docx?|xlsx?|pptx?|pdf|csv|md|txt|srt|mp4|mov|webm|mkv|mp3|wav|aac|flac|ogg)$/i
const DOWNLOAD_LINK_RE = /(?:https?:\/\/[^\s)\]"'<>]+|asset:\/\/[^\s)\]"'<>]+|blob:[^\s)\]"'<>]+)\.(?:docx?|xlsx?|pptx?|pdf|csv|md|txt|srt|mp4|mov|webm|mkv|mp3|wav|aac|flac|ogg)(?:\?[^\s)\]"'<>]*)?/gi

function normalizeDownloadUrl(url: string): string {
  return isAllowedDownloadUrl(url) ? url : ''
}

export function inferOfficeFilename(url: string, fallback = 'office-file'): string {
  const clean = String(url || '').split('?')[0].split('#')[0]
  const raw = clean.split('/').filter(Boolean).pop() || fallback
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function isOfficeDownload(url: string, filename: string): boolean {
  return DOWNLOAD_EXT.test(filename) || DOWNLOAD_EXT.test(url.split('?')[0])
}

function toDownloadFile(item: Record<string, unknown>, fallbackName = 'office-file'): OfficeDownloadFile | null {
  const rawUrl = String(item.download_url || item.downloadUrl || item.file_url || item.fileUrl || item.url || item.href || item.link || '')
  if (!rawUrl) return null

  const url = normalizeDownloadUrl(rawUrl)
  if (!url) return null
  const filename = String(item.filename || item.name || inferOfficeFilename(url, fallbackName))
  if (!isOfficeDownload(url, filename)) return null

  const size = typeof item.size === 'number' ? item.size : undefined
  return { filename, url, size }
}

function collectOfficeFiles(value: unknown, files: OfficeDownloadFile[]): void {
  if (!value) return

  if (typeof value === 'string') {
    for (const match of value.matchAll(DOWNLOAD_LINK_RE)) {
      const file = toDownloadFile({ url: match[0] })
      if (file) files.push(file)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) collectOfficeFiles(item, files)
    return
  }

  if (typeof value !== 'object') return

  const item = value as Record<string, unknown>
  const direct = toDownloadFile(item)
  if (direct) files.push(direct)
  for (const nested of Object.values(item)) collectOfficeFiles(nested, files)
}

export function extractOfficeDownloadFiles(content: string): OfficeDownloadFile[] {
  const files: OfficeDownloadFile[] = []
  const trimmed = content.trim()

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      collectOfficeFiles(JSON.parse(content), files)
    } catch {
      // Continue with plain-text URL extraction below.
    }
  }

  for (const match of content.matchAll(DOWNLOAD_LINK_RE)) {
    const rawUrl = match[0]
    const file = toDownloadFile({ url: rawUrl })
    if (file) files.push(file)
  }

  return dedupeOfficeDownloadFiles(files)
}

export function dedupeOfficeDownloadFiles(files: OfficeDownloadFile[]): OfficeDownloadFile[] {
  const seen = new Set<string>()
  return files.filter(file => {
    const key = `${file.filename}\n${file.url}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function formatDownloadSize(size?: number): string {
  if (!Number.isFinite(size) || !size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
