/**
 * Canvas Media Asset - 统一媒体资产类型
 * 
 * 目标：让画布中的图片、视频、音频有统一的抽象，
 * 同时支持本地文件（sourcePath + convertFileSrc）和远程 URL。
 */

export type MediaKind = 'image' | 'video' | 'audio';

export interface CanvasMediaAsset {
  /** fileStore 中的 id（如果已写入文件区） */
  id?: string;

  /** 媒体类型 */
  kind: MediaKind;

  /** 
   * 可直接用于 <img> / <video> / <audio> 的地址
   * - 远程：https://...
   * - 本地桌面：convertFileSrc 后的安全地址
   */
  url: string;

  /** 
   * 本地原始文件路径（仅桌面端存在）
   * 用于持久化、重选、Tauri 操作等场景
   */
  sourcePath?: string;

  /** 文件名（不含路径） */
  name?: string;

  /** 文件大小（字节） */
  size?: number;

  mimeType?: string;

  /** 来源 */
  origin: 'local' | 'remote' | 'generated' | 'uploaded';

  /** 创建时间 */
  createdAt?: number;

  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 工具函数：从各种老字段构造 CanvasMediaAsset
 */
export function createMediaAssetFromLegacy(data: any, kind?: MediaKind): CanvasMediaAsset | null {
  const url = data?.url || data?.imageUrl || data?.videoUrl || data?.audioUrl;
  if (!url) return null;

  const resolvedKind: MediaKind = kind || inferKindFromUrl(url) || 'image';

  return {
    kind: resolvedKind,
    url,
    sourcePath: data?.sourcePath || data?.localPath,
    name: data?.name || data?.fileName,
    size: data?.size || data?.fileSize,
    mimeType: data?.mimeType || data?.mime,
    origin: data?.sourcePath ? 'local' : (data?.origin || 'remote'),
    createdAt: data?.createdAt || Date.now(),
  };
}

export function inferKindFromUrl(url: string): MediaKind | null {
  const u = url.toLowerCase();
  if (u.includes('.mp4') || u.includes('.mov') || u.includes('.webm') || u.includes('.m4v')) return 'video';
  if (u.includes('.mp3') || u.includes('.wav') || u.includes('.m4a') || u.includes('.flac') || u.includes('.ogg')) return 'audio';
  if (u.includes('.jpg') || u.includes('.jpeg') || u.includes('.png') || u.includes('.webp') || u.includes('.gif')) return 'image';
  return null;
}

/**
 * 工具函数：获取可用于展示的 URL
 * （目前直接返回 url，后续可在这里统一处理 convertFileSrc 等逻辑）
 */
export function resolveDisplayUrl(asset: CanvasMediaAsset | null | undefined): string {
  if (!asset) return '';
  return asset.url || '';
}

/**
 * 判断是否为本地素材
 */
export function isLocalAsset(asset: CanvasMediaAsset | null | undefined): boolean {
  return !!asset?.sourcePath;
}