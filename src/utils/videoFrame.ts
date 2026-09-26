/**
 * 视频截帧：把 video 元素当前显示的画面转成 PNG Blob。
 * 浏览器原生（canvas.drawImage），Tauri / Web 通用，零依赖。
 */
import { isLocalAssetUrl } from '@/utils/urlSafety'

export async function captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) throw new Error('视频还没有可截取的画面')

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('截帧失败：画布不可用')

  try {
    ctx.drawImage(video, 0, 0, width, height)
  } catch {
    // 跨域视频污染画布：引导先保存到项目（保存后是本地文件，可正常截帧）。
    throw new Error('该视频源不允许截帧，请先保存到项目后再试')
  }

  return await new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('截帧失败，请重试'))), 'image/png')
    } catch {
      reject(new Error('该视频源不允许截帧，请先保存到项目后再试'))
    }
  })
}

/**
 * Tauri 本地文件（asset 协议，响应带窗口 Origin 的 CORS 头）需要 CORS 模式加载，
 * canvas 截帧才不被污染；远程源保持原样，避免无 CORS 头的源直接加载失败。
 */
export function videoCrossOriginFor(src: string): 'anonymous' | undefined {
  return isLocalAssetUrl(src) ? 'anonymous' : undefined
}
