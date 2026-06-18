/**
 * mediaFileWriter.ts — P1 媒体文件写入器
 *
 * 唯一写入入口，职责：
 * 1. 接收 base64 字符串（或 Uint8Array）
 * 2. 解码写入 ~/.jiucaihezi/output/{source}/{YYYY-MM}/{assetId}.{ext}
 * 3. INSERT INTO media_assets
 * 4. 返回 assetId
 *
 * 写入顺序（ADR-004）：先文件 → 后 DB（文件是实体，DB 是引用）
 */

import { isTauriRuntime } from './tauriEnv'
import { insertMediaAsset } from './idb'

export interface WriteMediaOptions {
  /** base64 字符串（可含 data: URI 前缀）或 Uint8Array */
  data: string | Uint8Array
  /** 来源：chat / creation / canvas */
  source: string
  /** 业务 ID（如 conversationId / taskId），可选 */
  sourceId?: string
  /** 可选自定义文件名（不含路径），不传则自动生成 */
  name?: string
  /** MIME 类型（data 为 Uint8Array 时必须传入，否则默认 application/octet-stream → .bin） */
  mime?: string
}

export interface WriteMediaResult {
  assetId: string
  logicalPath: string
  mime: string
  size: number
}

/** 从 base64 data URI 或原始 base64 提取 mime 类型 */
function parseMime(input: string): string {
  const match = input.match(/^data:([^;]+);/)
  return match ? match[1] : 'application/octet-stream'
}

/** 从 mime 类型推导文件扩展名 */
function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
    'audio/webm': '.weba',
  }
  return map[mime] || '.bin'
}

/** 从文件魔数检测真实 MIME（CDN Content-Type 可能不准） */
function detectMimeFromBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png'
  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg'
  // WebP: 52 49 46 46 ... 57 45 42 50 at offset 8
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  // GIF: 47 49 46 38
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif'
  return null
}

/** 将 base64 字符串（可能含 data: URI 前缀）解码为 Uint8Array */
function base64ToBytes(input: string): { bytes: Uint8Array; mime: string } {
  const mime = parseMime(input)
  const base64 = input.includes(',') ? input.split(',')[1] : input
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return { bytes, mime }
}

/** 生成短 assetId (时间戳+随机) */
function generateAssetId(): string {
  return `jcma_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 获取当前年月字符串，如 "2026-06" */
function yearMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 将媒体写入文件系统 + media_assets 表
 *
 * @returns assetId，后续业务层存为 jc-media://{assetId}
 */
export async function writeMediaAsset(opts: WriteMediaOptions): Promise<WriteMediaResult> {
  if (!isTauriRuntime()) {
    throw new Error('mediaFileWriter 仅支持 Tauri 桌面环境')
  }

  const { source, sourceId, name } = opts

  // 1. 解码数据
  let bytes: Uint8Array
  let mime: string
  if (typeof opts.data === 'string') {
    const decoded = base64ToBytes(opts.data)
    bytes = decoded.bytes
    mime = decoded.mime
  } else {
    bytes = opts.data
    // magic bytes 优先于 HTTP Content-Type（CDN 可能返回不准）
    mime = detectMimeFromBytes(bytes) || opts.mime || 'application/octet-stream'
  }

  const ext = mimeToExt(mime)
  const assetId = generateAssetId()
  const ym = yearMonth()
  const fileName = name ? `${name}${ext}` : `${assetId}${ext}`

  // 2. 获取目标路径
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const appData = await appDataDir()
  const mediaDir = await join(appData, 'output', source, ym)
  const logicalPath = `output/${source}/${ym}/${fileName}`
  const filePath = await join(appData, logicalPath)

  // 3. 确保目录存在
  const { mkdir, exists: fsExists } = await import('@tauri-apps/plugin-fs')
  if (!(await fsExists(mediaDir))) {
    await mkdir(mediaDir, { recursive: true })
  }

  // 4. 先写文件（实体优先于 DB 引用 — ADR-004）
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  await writeFile(filePath, bytes)

  // 5. 后写 DB
  const now = Date.now()
  await insertMediaAsset({
    id: assetId,
    logicalPath,
    mime,
    size: bytes.byteLength,
    width: null,
    height: null,
    hash: null,
    source,
    sourceId: sourceId ?? null,
    thumbnailAssetId: null,
    createdAt: now,
  })

  return { assetId, logicalPath, mime, size: bytes.byteLength }
}

/** 从 data URI 快速判断是否为 base64 媒体（非 HTTP URL） */
export function isBase64Media(value: string): boolean {
  return value.startsWith('data:') && value.includes(';base64,')
}

/** 前缀常量：业务表统一使用 jc-media:// 引用媒体 */
export const MEDIA_REF_PREFIX = 'jc-media://'
