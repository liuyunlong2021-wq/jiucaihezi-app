import { useFileStore, type FileEntry } from '@/composables/useFileStore'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { isAllowedCreationResultUrl } from '@/utils/urlSafety'

const MEDIA_REF_PREFIX = 'jc-media:'

interface DownloadBase64Response {
  status: number
  headers: Record<string, string>
  data_base64: string
}

export function isLocalMediaRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(MEDIA_REF_PREFIX + 'file_')
}

export function mediaRefFromFileId(fileId: string): string {
  return `${MEDIA_REF_PREFIX}${fileId}`
}

export function fileIdFromMediaRef(ref: string): string {
  return String(ref || '').startsWith(MEDIA_REF_PREFIX) ? String(ref).slice(MEDIA_REF_PREFIX.length) : ''
}

function extFor(type: 'image' | 'video' | 'audio'): string {
  return type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'png'
}

function mimeFor(type: 'image' | 'video' | 'audio', fallback?: string): string {
  if (fallback && fallback.includes('/')) return fallback
  return type === 'video' ? 'video/mp4' : type === 'audio' ? 'audio/mpeg' : 'image/png'
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('媒体缓存读取失败'))
    reader.readAsDataURL(blob)
  })
}

function normalizeContentType(headers: Record<string, string>, fallback: string): string {
  const raw = headers['content-type'] || headers['Content-Type'] || fallback
  return String(raw || fallback).split(';')[0].trim() || fallback
}

async function fetchMediaAsDataUrl(
  url: string,
  type: 'image' | 'video' | 'audio',
): Promise<{ content: string; mimeType: string }> {
  if (!isAllowedCreationResultUrl(url)) throw new Error('媒体地址不安全，已阻止缓存')

  // 已经是 data: URI 内嵌媒体（base64），不需要 HTTP 下载，直接透传
  // 适用于 WorldRouter 等返回 b64_json 的图片上游
  if (url.startsWith('data:')) {
    const mimeMatch = url.match(/^data:([^;,]+)/i)
    const mimeType = mimeMatch ? mimeMatch[1] : mimeFor(type)
    return { content: url, mimeType }
  }

  if (isTauriRuntime()) {
    const { invoke } = await import('@tauri-apps/api/core')
    const response = await invoke<DownloadBase64Response>('http_download_base64', {
      request: { url, timeout_secs: 120 },
    })
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`媒体缓存失败: HTTP ${response.status}`)
    }
    const mimeType = normalizeContentType(response.headers || {}, mimeFor(type))
    return {
      content: `data:${mimeType};base64,${response.data_base64}`,
      mimeType,
    }
  }

  const response = await fetch(url)
  if (!response.ok) throw new Error(`媒体缓存失败: HTTP ${response.status}`)
  const blob = await response.blob()
  return {
    content: await blobToDataUrl(blob),
    mimeType: blob.type || mimeFor(type),
  }
}

export async function cacheCreationMediaResult(params: {
  url: string
  type: 'image' | 'video' | 'audio'
  prompt?: string
  model?: string
}): Promise<{ ref: string; file: FileEntry } | null> {
  if (isLocalMediaRef(params.url)) return null
  const { content, mimeType } = await fetchMediaAsDataUrl(params.url, params.type)
  if (!content.startsWith('data:')) throw new Error('媒体缓存失败: 响应不是媒体数据')
  const fileStore = useFileStore()
  const title = String(params.prompt || params.model || 'creation').trim().slice(0, 36) || 'creation'
  const file = await fileStore.addMedia(
    `${title}.${extFor(params.type)}`,
    content,
    params.type,
    mimeFor(params.type, mimeType),
  )
  return { ref: mediaRefFromFileId(file.id), file }
}

export async function resolveCreationMediaUrl(url: string): Promise<string> {
  if (!isLocalMediaRef(url)) return url
  const fileId = fileIdFromMediaRef(url)
  if (!fileId) return ''
  const fileStore = useFileStore()
  const file = await fileStore.getFile(fileId)
  return file?.content || ''
}
