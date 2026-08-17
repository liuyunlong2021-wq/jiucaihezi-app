/**
 * projectMediaWriter.ts — 桌面端媒体直写项目文件夹
 *
 * 职责：
 * 1. 接收 base64 媒体数据
 * 2. 生成安全文件名
 * 3. 通过项目文件总管写入 {projectDir}/jc-media/{kind}s/
 * 4. 返回文件系统绝对路径（用于 convertFileSrc 显示）
 *
 * Web 端 / 无项目文件夹时不可用，调用方自行 fallback。
 */
import { buildMediaFilename } from '@/utils/mediaFilename'

/** MIME → 文件扩展名 */
function mimeToExt(mime: string, sourceUrl = ''): string {
  const map: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/bmp': '.bmp',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg',
    'audio/mp4': '.m4a', 'text/plain': '.txt', 'text/markdown': '.md',
    'model/gltf-binary': '.glb', 'model/gltf+json': '.gltf', 'model/obj': '.obj',
    'application/zip': '.zip',
  }
  const urlExt = sourceUrl.split(/[?#]/, 1)[0]?.match(/\.(glb|gltf|obj|fbx|stl|ply|zip)$/i)?.[0]?.toLowerCase()
  return map[mime] || urlExt || (mime.startsWith('image/') ? '.png' : mime.startsWith('video/') ? '.mp4' : mime.startsWith('audio/') ? '.mp3' : '.bin')
}

export interface WriteProjectMediaResult {
  filePath: string   // 绝对路径，用于 convertFileSrc()
  projectPath: string
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const data = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index)
  return data
}

export async function writeProjectMedia(opts: {
  dataBase64: string   // 纯 base64，不含 data: 前缀
  mime: string
  projectDir: string
  kind: 'image' | 'video' | 'audio' | 'model3d' | 'text'
  summary?: string
  prompt?: string
  model?: string
  taskId?: string
  sourceUrl?: string
  memory?: boolean
}): Promise<WriteProjectMediaResult> {
  const ext = mimeToExt(opts.mime, opts.sourceUrl)
  const filename = buildMediaFilename({
    summary: opts.summary,
    prompt: opts.prompt,
    model: opts.model,
    taskId: opts.taskId,
    extension: ext,
  })

  const folderName = opts.memory
    ? opts.kind === 'image' ? '图片' : opts.kind === 'video' ? '视频' : opts.kind === 'audio' ? '音频' : '文档'
    : opts.kind === 'text' ? 'text' : opts.kind === 'model3d' ? 'models' : `${opts.kind}s`
  const relativePath = `${opts.memory ? '.raw/jc-media' : 'jc-media'}/${folderName}/${filename}`

  const [{ createProjectFileActions }, { createRuntimeProjectFileService }] = await Promise.all([
    import('@/services/projectFileActions'), import('@/services/projectFileService'),
  ])
  const resource = await createProjectFileActions(createRuntimeProjectFileService()).importMedia({
    owner: opts.projectDir,
    path: relativePath,
    data: base64ToBytes(opts.dataBase64),
    mimeType: opts.mime,
  })
  return {
    filePath: `${opts.projectDir.replace(/[\\/]+$/, '')}/${resource.path}`,
    projectPath: resource.path,
  }
}
