/**
 * P3.4: 图片缩略图缓存 — 懒生成 128px webp，上限 500，mtime 淘汰
 */
import { isTauriRuntime } from '@/utils/tauriEnv'
import { getMediaAssetById } from '@/utils/idb'
import { assetRowToRealPath } from '@/utils/mediaFileReader'

const THUMB_SIZE = 128
const MAX_THUMBS = 500

let thumbDir: string | null = null
let prunePending = false

async function getThumbDir(): Promise<string> {
  if (thumbDir) return thumbDir
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const dataDir = await appDataDir()
  thumbDir = await join(dataDir, 'output', 'thumbnails')
  return thumbDir
}

/** 确保缩略图目录存在 */
async function ensureThumbDir(): Promise<string> {
  const dir = await getThumbDir()
  const { mkdir, exists } = await import('@tauri-apps/plugin-fs')
  try {
    if (!(await exists(dir))) await mkdir(dir, { recursive: true })
  } catch { /* ok */ }
  return dir
}

/** 从原图生成 128px webp 缩略图，写入 thumbPath */
async function generateImageThumbnail(realPath: string, thumbPath: string): Promise<void> {
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  const src = convertFileSrc(realPath)

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const scale = THUMB_SIZE / Math.max(img.naturalWidth, img.naturalHeight)
        const w = Math.round(img.naturalWidth * scale)
        const h = Math.round(img.naturalHeight * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) { URL.revokeObjectURL(img.src); return reject(new Error('no 2d ctx')) }
        ctx.drawImage(img, 0, 0, w, h)
        canvas.toBlob(async (blob) => {
          URL.revokeObjectURL(img.src)
          if (!blob) return reject(new Error('toBlob null'))
          const buf = await blob.arrayBuffer()
          const { writeFile } = await import('@tauri-apps/plugin-fs')
          await writeFile(thumbPath, new Uint8Array(buf))
          resolve()
        }, 'image/webp', 0.75)
      } catch (e) { URL.revokeObjectURL(img.src); reject(e) }
    }
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('image load failed')) }
    img.src = src
  })
}

/** 淘汰超出上限的缩略图（按 mtime 升序，删最旧的） */
export async function pruneThumbnails(): Promise<void> {
  if (!isTauriRuntime() || prunePending) return
  prunePending = true
  try {
    const dir = await getThumbDir()
    const { readDir, stat, remove } = await import('@tauri-apps/plugin-fs')
    const entries = await readDir(dir)
    const thumbnailFiles = entries.filter(e => /\.(?:webp|jpg)$/i.test(e.name || ''))

    if (thumbnailFiles.length <= MAX_THUMBS) return

    // stat 每个文件获取 mtime，按 mtime 升序（最旧在前）
    const { join } = await import('@tauri-apps/api/path')
    const withMtime: { name: string; mtime: number }[] = []
    for (const f of thumbnailFiles) {
      try {
        const s = await stat(await join(dir, f.name!))
        withMtime.push({ name: f.name!, mtime: s.mtime?.getTime?.() ?? 0 })
      } catch { /* skip unreadable */ }
    }
    withMtime.sort((a, b) => a.mtime - b.mtime)
    const toDelete = withMtime.slice(0, withMtime.length - MAX_THUMBS)
    for (const f of toDelete) {
      try { await remove(await join(dir, f.name)) } catch { /* skip */ }
    }
  } catch { /* silent */ }
  finally { prunePending = false }
}

/** 解析缩略图：命中返回 convertFileSrc 地址，miss 则生成 */
export async function resolveThumbnail(assetId: string): Promise<string> {
  if (!isTauriRuntime()) return ''

  const row = await getMediaAssetById(assetId)
  if (!row) return ''

  // 缩略图以 assetId 命名，避免同文件重复生成
  const dir = await ensureThumbDir()
  const { join } = await import('@tauri-apps/api/path')
  const thumbPath = await join(dir, `${assetId}.webp`)

  // 检查缓存
  const { exists } = await import('@tauri-apps/plugin-fs')
  try {
    if (await exists(thumbPath)) {
      const { convertFileSrc } = await import('@tauri-apps/api/core')
      return convertFileSrc(thumbPath)
    }
  } catch { /* 文件系统异常 → 退化为原图 */ }

  // 生成缩略图
  try {
    const realPath = await assetRowToRealPath(row)
    await generateImageThumbnail(realPath, thumbPath)
    // 异步淘汰（不阻塞返回）
    pruneThumbnails().catch(() => {})
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    return convertFileSrc(thumbPath)
  } catch {
    // 生成失败 → 返回原图
    try {
      const realPath = await assetRowToRealPath(row)
      const { convertFileSrc } = await import('@tauri-apps/api/core')
      return convertFileSrc(realPath)
    } catch { return '' }
  }
}

/** 文件树视频：由桌面后台生成 160px JPG，并复用应用缓存目录。 */
export async function resolveProjectVideoThumbnail(projectDir: string, relativePath: string): Promise<string> {
  if (!isTauriRuntime() || !projectDir || !relativePath) return ''
  try {
    const { invoke, convertFileSrc } = await import('@tauri-apps/api/core')
    const thumbnailPath = await invoke<string>('dev_generate_video_thumbnail', {
      input: { root: projectDir, relativePath },
    })
    void pruneThumbnails()
    return convertFileSrc(thumbnailPath)
  } catch {
    return ''
  }
}

// ═══════════════════════════════════════════════════
//  视频首帧缩略图（已有功能，保留）
// ═══════════════════════════════════════════════════

export interface VideoThumbnailResult {
  thumbnailUrl: string
  duration?: number
  width?: number
  height?: number
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => cleanup(reject, new Error(`视频首帧读取超时: ${eventName}`)), timeoutMs)
    const onEvent = () => cleanup(resolve)
    const onError = () => cleanup(reject, new Error('视频无法读取'))

    function cleanup(done: (value?: any) => void, value?: any) {
      window.clearTimeout(timeout)
      video.removeEventListener(eventName, onEvent)
      video.removeEventListener('error', onError)
      done(value)
    }

    video.addEventListener(eventName, onEvent, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
}

function scaleToFit(width: number, height: number, maxWidth: number): { width: number; height: number } {
  if (!width || !height) return { width: maxWidth, height: Math.round(maxWidth * 9 / 16) }
  if (width <= maxWidth) return { width, height }
  const ratio = maxWidth / width
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  }
}

export async function extractVideoFirstFrameThumbnail(
  url: string,
  opts: { maxWidth?: number; seekTime?: number; quality?: number; timeoutMs?: number } = {},
): Promise<VideoThumbnailResult> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new Error('当前环境不支持生成视频缩略图')
  }
  if (!url) throw new Error('视频地址为空')

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  if (/^https?:/i.test(url)) video.crossOrigin = 'anonymous'
  video.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none'
  document.body.appendChild(video)
  video.src = url

  try {
    await waitForVideoEvent(video, 'loadedmetadata', opts.timeoutMs || 8000)
    const duration = Number.isFinite(video.duration) ? video.duration : undefined
    const width = video.videoWidth || undefined
    const height = video.videoHeight || undefined
    const seekTime = Math.min(Math.max(opts.seekTime ?? Math.min(1, (duration || 0) * 0.1), 0), Math.max((duration || 1) - 0.05, 0))
    if (Number.isFinite(seekTime) && seekTime > 0) {
      video.currentTime = seekTime
      await waitForVideoEvent(video, 'seeked', opts.timeoutMs || 8000)
    }

    const size = scaleToFit(video.videoWidth, video.videoHeight, opts.maxWidth || 360)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建视频缩略图画布')
    ctx.drawImage(video, 0, 0, size.width, size.height)

    return {
      thumbnailUrl: canvas.toDataURL('image/jpeg', opts.quality ?? 0.72),
      duration,
      width,
      height,
    }
  } finally {
    video.removeAttribute('src')
    video.load()
    video.remove()
  }
}
