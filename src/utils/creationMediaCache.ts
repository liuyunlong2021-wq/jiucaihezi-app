import { useFileStore, type FileEntry } from '@/composables/useFileStore'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { isAllowedCreationResultUrl } from '@/utils/urlSafety'
import { CREATION_GALLERY_SOURCE } from '@/utils/fileEntryFilters'
import { writeMediaAsset, MEDIA_REF_PREFIX } from '@/utils/mediaFileWriter'
import { useProjectStore } from '@/stores/projectStore'
import { webProjectFiles } from '@/utils/webProjectFiles'

interface DownloadBase64Response {
  status: number
  headers: Record<string, string>
  data_base64: string
}

export function isLocalMediaRef(value: unknown): value is string {
  // ★ SSD-v2: 同时兼容旧格式 jc-media://file_* 和新格式 jc-media://jcma_*
  //    旧格式走 documents 表 base64（resolveCreationMediaUrl 已改为走 mediaFileReader）
  //    新格式走 media_assets 表 + output/ 文件系统
  return typeof value === 'string' && value.startsWith(MEDIA_REF_PREFIX)
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

function webMediaFilename(params: { type: 'image' | 'video' | 'audio'; prompt?: string; model?: string; taskId?: string }): string {
  const stem = String(params.prompt || params.model || 'creation')
    .replace(/[/\\:*?"<>|]/g, '_')
    .trim()
    .slice(0, 48) || 'creation'
  const suffix = String(params.taskId || Date.now().toString(36)).replace(/[^a-z0-9_-]/gi, '').slice(-16)
  return `${stem}_${suffix}.${extFor(params.type)}`
}

function webRemoteMediaFile(params: {
  url: string
  type: 'image' | 'video' | 'audio'
  prompt?: string
  model?: string
  taskId?: string
}): FileEntry {
  return {
    id: `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: `${String(params.prompt || params.model || 'creation').trim().slice(0, 50)}.${extFor(params.type)}`,
    category: params.type,
    mimeType: mimeFor(params.type),
    size: 0,
    content: '',
    metadata: { source: CREATION_GALLERY_SOURCE, prompt: params.prompt, model: params.model, taskId: params.taskId, originalUrl: params.url },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
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

function debugMediaDownloadPath(path: 'tauri' | 'browser', url: string) {
  if (!(import.meta as any).env?.DEV) return
  try {
    console.debug(
      `[creationMediaCache] downloading via ${path === 'tauri' ? 'Tauri http_download_base64' : 'browser fetch'}`,
      new URL(url).hostname,
    )
  } catch {
    console.debug(`[creationMediaCache] downloading via ${path === 'tauri' ? 'Tauri http_download_base64' : 'browser fetch'}`)
  }
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
    debugMediaDownloadPath('tauri', url)
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

  debugMediaDownloadPath('browser', url)
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
  taskId?: string
  metadataKind?: 'creation-result' | 'creation-import'
}): Promise<{ ref: string; file: FileEntry } | null> {
  if (isLocalMediaRef(params.url)) return null

  // 桌面端：下载 → output/creation/ + media_assets，不经过 documents 表
  if (isTauriRuntime() && /^https?:\/\//.test(params.url)) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const dl = await invoke<{ status: number; data_base64: string; headers?: Record<string, string> }>('http_download_base64', {
        request: { url: params.url, timeout_secs: 120 },
      })
      if (dl.status >= 200 && dl.status < 300 && dl.data_base64) {
        const contentType = normalizeContentType(dl.headers || {}, mimeFor(params.type))
        // ★ 项目文件夹优先
        const projectDir = (await import('@/stores/projectStore')).useProjectStore().projectDir.value
        if (projectDir) {
          const { writeProjectMedia } = await import('@/utils/projectMediaWriter')
          const { filePath } = await writeProjectMedia({
            dataBase64: dl.data_base64, mime: contentType,
            projectDir, kind: params.type,
            prompt: String(params.prompt || params.model || ''),
          })
          return {
            ref: filePath,
            file: {
              id: `proj_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
              name: filePath.split('/').pop() || 'creation',
              category: params.type, mimeType: contentType, size: 0, content: '',
              metadata: { source: CREATION_GALLERY_SOURCE, prompt: params.prompt, model: params.model, taskId: params.taskId, projectPath: filePath },
              createdAt: Date.now(), updatedAt: Date.now(),
            } as FileEntry,
          }
        }
        // 无项目 → 回退 output/creation/
        const dataUri = `data:${contentType};base64,${dl.data_base64}`
        const name = String(params.prompt || params.model || 'creation').trim().slice(0, 50)
        const result = await writeMediaAsset({ source: 'creation', data: dataUri, sourceId: params.taskId, name })
        const mime = result.mime
        return {
          ref: `${MEDIA_REF_PREFIX}//${result.assetId}`,
          file: {
            id: result.assetId,
            name: `${name}.${extFor(params.type)}`,
            category: params.type,
            mimeType: mime,
            size: result.size,
            content: '', // 不再存 base64
            metadata: { source: CREATION_GALLERY_SOURCE, prompt: params.prompt, model: params.model, taskId: params.taskId },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          } as FileEntry,
        }
      }
    } catch (e) { console.warn('[JC] creationMediaCache 落地失败:', e) }
  }

  // Web 端：直接用远程 URL，不下载不转码不塞 IndexedDB，防止内存爆炸
  if (!isTauriRuntime()) {
    const projectId = useProjectStore().webProjectId.value
    if (projectId) {
      try {
        const name = webMediaFilename(params)
        const file = await webProjectFiles.addMedia(
          projectId,
          `output/creation/${name}`,
          params.url,
          params.type,
          mimeFor(params.type),
          {
            source: CREATION_GALLERY_SOURCE,
            kind: params.metadataKind || 'creation-result',
            prompt: params.prompt || '',
            model: params.model || '',
            taskId: params.taskId || '',
            originalUrl: params.url,
          },
        )
        return { ref: params.url, file }
      } catch (error) {
        console.warn('[JC] Web 项目媒体记录失败，保留远程结果:', error)
      }
    }
    return { ref: params.url, file: webRemoteMediaFile(params) }
  }

  // 桌面端回退：保持原逻辑（fetch → data URL → documents 表）
  const { content, mimeType } = await fetchMediaAsDataUrl(params.url, params.type)
  if (!content.startsWith('data:')) throw new Error('媒体缓存失败: 响应不是媒体数据')
  const fileStore = useFileStore()
  const title = String(params.prompt || params.model || 'creation').trim().slice(0, 36) || 'creation'
  const file = await fileStore.addMedia(
    `${title}.${extFor(params.type)}`,
    content,
    params.type,
    mimeFor(params.type, mimeType),
    {
      source: CREATION_GALLERY_SOURCE,
      kind: params.metadataKind || 'creation-result',
      prompt: params.prompt || '',
      model: params.model || '',
      taskId: params.taskId || '',
      originalUrl: params.url,
    },
  )
  return { ref: mediaRefFromFileId(file.id), file }
}

export async function resolveCreationMediaUrl(url: string): Promise<string> {
  if (!url) return ''
  // ★ 新存储系统（SSD-v2）：媒体文件落在 output/{source}/ 文件系统，
  //    jc-media:// 引用通过 media_assets 表 + convertFileSrc 解析，
  //    不再走旧的 documents 表 base64。
  const { resolveJcMediaUrl } = await import('./mediaFileReader')
  return await resolveJcMediaUrl(url)
}
