/**
 * mediaFileReader.ts — P1 媒体文件读取器 + LRU 缓存
 *
 * 统一读取入口，避免各组件各自读文件、各自拼 base64。
 *
 * 三层 resolver：
 * - resolveForDisplay(assetId) → Tauri convertFileSrc 安全地址（组件直接 <img>）
 * - resolveForLlm(assetId)    → base64 data URL（给 LLM 的 image_url block）
 * - resolveForUpload(assetId) → File 对象（上传用）
 */

import { isTauriRuntime } from './tauriEnv'
import { getMediaAssetById, type MediaAssetRow } from './idb'
import { MEDIA_REF_PREFIX } from './mediaFileWriter'

// ═══════════════════════════════════════════════════
//  LRU base64 缓存
// ═══════════════════════════════════════════════════

const MAX_LRU_SIZE = 50
const MAX_CACHE_BYTES = 50 * 1024 * 1024 // 50MB 上限

interface CacheEntry {
  base64: string
  size: number
}

const lruCache = new Map<string, CacheEntry>()
let lruCacheBytes = 0

function cacheGet(key: string): string | null {
  const entry = lruCache.get(key)
  if (!entry) return null
  // LRU: 移到末尾（最近使用）
  lruCache.delete(key)
  lruCache.set(key, entry)
  return entry.base64
}

function cacheSet(key: string, base64: string, byteSize: number): void {
  // 驱逐最旧条目直到空间足够
  while (lruCache.size >= MAX_LRU_SIZE || lruCacheBytes + byteSize > MAX_CACHE_BYTES) {
    const oldest = lruCache.keys().next()
    if (oldest.done) break
    const old = lruCache.get(oldest.value)
    if (old) lruCacheBytes -= old.size
    lruCache.delete(oldest.value)
  }
  lruCache.set(key, { base64, size: byteSize })
  lruCacheBytes += byteSize
}

// ═══════════════════════════════════════════════════
//  路径解析
// ═══════════════════════════════════════════════════

let _appDataDir: string | null = null

async function getAppDataDir(): Promise<string> {
  if (_appDataDir) return _appDataDir
  const { appDataDir } = await import('@tauri-apps/api/path')
  _appDataDir = await appDataDir()
  return _appDataDir
}

export async function assetRowToRealPath(row: MediaAssetRow): Promise<string> {
  const { join } = await import('@tauri-apps/api/path')
  const appData = await getAppDataDir()
  // 兼容旧路径 media/...（实际文件在 data/media/...）和新路径 output/...
  if (row.logicalPath.startsWith('media/')) {
    return await join(appData, 'data', row.logicalPath)
  }
  return await join(appData, row.logicalPath)
}

// ═══════════════════════════════════════════════════
//  公开 API
// ═══════════════════════════════════════════════════

/**
 * 给 UI 渲染用：返回可加载地址。
 * 桌面端：convertFileSrc → asset://localhost/...
 * Web 端：sourceUrl（远程 CDN URL）
 */
export async function resolveForDisplay(assetId: string): Promise<string> {
  // Web 端：从 media_assets 取 sourceUrl
  if (!isTauriRuntime()) {
    const row = await getMediaAssetById(assetId)
    return row?.sourceUrl || ''
  }

  const row = await getMediaAssetById(assetId)
  if (!row) return ''

  const realPath = await assetRowToRealPath(row)
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  return convertFileSrc(realPath)
}

/**
 * 给 LLM 调用用：返回 base64 data URL。
 * 含 LRU 内存缓存（max 50 条 / 50MB）。
 *
 * 重发消息时同一历史图片会被反复编码，缓存避免重复读盘+编码。
 */
export async function resolveForLlm(assetId: string): Promise<string> {
  if (!isTauriRuntime()) return ''

  // 1. 查 LRU 缓存
  const cached = cacheGet(assetId)
  if (cached) return cached

  // 2. 查 media_assets 表
  const row = await getMediaAssetById(assetId)
  if (!row) return ''

  // 3. 读文件（P3.6: 文件可能被用户手动删除 → 捕获异常，返回 ''）
  const realPath = await assetRowToRealPath(row)
  const { readFile } = await import('@tauri-apps/plugin-fs')
  let bytes: Uint8Array
  try {
    bytes = await readFile(realPath)
  } catch {
    console.warn('[JC] media file missing for LLM:', assetId)
    return ''
  }

  // 4. base64 编码
  const binary = Array.from(bytes).map(b => String.fromCharCode(b)).join('')
  const base64 = btoa(binary)
  const dataUrl = `data:${row.mime};base64,${base64}`

  // 5. 写缓存
  cacheSet(assetId, dataUrl, row.size)

  return dataUrl
}

/**
 * 从 jc-media://{assetId} 引用中提取 assetId。
 * 如果不是 jc-media:// 引用，返回 null。
 */
export function parseMediaRef(ref: string): string | null {
  if (!ref || !ref.startsWith(MEDIA_REF_PREFIX)) return null
  return ref.slice(MEDIA_REF_PREFIX.length)
}

/**
 * 判断字符串是否为 jc-media:// 引用
 */
export function isMediaRef(value: string): boolean {
  return value.startsWith(MEDIA_REF_PREFIX)
}

/**
 * 共享工具：将 jc-media:// 或普通 URL 懒解析为可加载地址。
 * 桌面端：jc-media:// → convertFileSrc（asset://localhost/...）
 * Web 端：jc-media:// → sourceUrl（远程 CDN URL）
 * 其他 URL → 原样直通
 */
export async function resolveJcMediaUrl(url: string): Promise<string> {
  if (!url) return ''
  // 非 jc-media 引用：原样返回（普通 http/https URL）
  if (!url.startsWith(MEDIA_REF_PREFIX)) return url

  const assetId = url.slice(MEDIA_REF_PREFIX.length)

  // 桌面端：convertFileSrc
  if (isTauriRuntime()) {
    return (await resolveForDisplay(assetId)) || url
  }

  // Web 端：从 media_assets 取 sourceUrl
  const row = await getMediaAssetById(assetId)
  return row?.sourceUrl || ''
}
