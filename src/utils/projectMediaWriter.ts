/**
 * projectMediaWriter.ts — 桌面端媒体直写项目文件夹
 *
 * 职责：
 * 1. 接收 base64 媒体数据
 * 2. 生成安全文件名
 * 3. 调用 Rust dev_write_file_bytes 写入 {projectDir}/jc-media/{kind}s/
 * 4. 返回文件系统绝对路径（用于 convertFileSrc 显示）
 *
 * Web 端 / 无项目文件夹时不可用，调用方自行 fallback。
 */

const SAFE_FILENAME_RE = /[^a-zA-Z0-9\u4e00-\u9fff\-_]/g

/** 清理文件名中的特殊字符，保留中英文、数字、连字符、下划线 */
function sanitizeFilename(input: string): string {
  return input
    .replace(SAFE_FILENAME_RE, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60) || 'untitled'
}

/** MIME → 文件扩展名 */
function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/bmp': '.bmp',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg',
    'audio/mp4': '.m4a', 'text/plain': '.txt', 'text/markdown': '.md',
  }
  return map[mime] || (mime.startsWith('image/') ? '.png' : mime.startsWith('video/') ? '.mp4' : mime.startsWith('audio/') ? '.mp3' : '.bin')
}

function pad(n: number): string { return String(n).padStart(2, '0') }

export interface WriteProjectMediaResult {
  filePath: string   // 绝对路径，用于 convertFileSrc()
}

export async function writeProjectMedia(opts: {
  dataBase64: string   // 纯 base64，不含 data: 前缀
  mime: string
  projectDir: string
  kind: 'image' | 'video' | 'audio' | 'text'
  prompt?: string
}): Promise<WriteProjectMediaResult> {
  const ext = mimeToExt(opts.mime)
  const promptPart = sanitizeFilename(opts.prompt || '')
  const rand = Math.random().toString(36).slice(2, 5)
  const now = new Date()
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const filename = promptPart ? `${ts}_${promptPart}_${rand}${ext}` : `${ts}_${rand}${ext}`

  const folderName = opts.kind === 'text' ? 'text' : `${opts.kind}s`
  const relativePath = `jc-media/${folderName}/${filename}`

  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('dev_write_file_bytes', {
    input: {
      root: opts.projectDir,
      relativePath,
      dataBase64: opts.dataBase64,
    },
  })

  const { join } = await import('@tauri-apps/api/path')
  const filePath = await join(opts.projectDir, relativePath)
  return { filePath }
}
