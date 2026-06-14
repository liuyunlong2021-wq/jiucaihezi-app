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
  video.preload = 'metadata'
  video.src = url

  try {
    await waitForVideoEvent(video, 'loadedmetadata', opts.timeoutMs || 8000)
    const duration = Number.isFinite(video.duration) ? video.duration : undefined
    const width = video.videoWidth || undefined
    const height = video.videoHeight || undefined
    const seekTime = Math.min(Math.max(opts.seekTime ?? 0.1, 0), Math.max((duration || 1) - 0.05, 0))
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
  }
}
