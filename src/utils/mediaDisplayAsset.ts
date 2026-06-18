import type { CreationResult } from '@/composables/useCreation'
import type { FileEntry } from '@/composables/useFileStore'

export type MediaAssetKind = 'image' | 'video' | 'audio' | 'text'
export type MediaDisplayStatus = 'loading' | 'ready' | 'failed' | 'remote-only'

export interface MediaDisplayAsset {
  id: string
  kind: MediaAssetKind
  name: string
  mimeType?: string
  displayUrl: string
  thumbnailUrl?: string
  originalUrl?: string
  localRef?: string
  fileId?: string
  prompt?: string
  model?: string
  taskId?: string
  createdAt?: number
  duration?: number
  width?: number
  height?: number
  thumbnailFailedAt?: number
  thumbnailError?: string
  status?: MediaDisplayStatus
  errorMsg?: string
  content?: string
}

export function isMediaFileEntry(entry: FileEntry): boolean {
  return entry.category === 'image' || entry.category === 'video' || entry.category === 'audio'
}

export function mediaKindFromEntry(entry: FileEntry): MediaAssetKind | null {
  if (entry.category === 'image' || entry.category === 'video' || entry.category === 'audio') return entry.category
  return null
}

export function mediaKindFromResult(result: CreationResult): MediaAssetKind | null {
  return result.type === 'image' || result.type === 'video' || result.type === 'audio'
    ? result.type
    : null
}

export function mediaDisplayAssetFromFileEntry(entry: FileEntry): MediaDisplayAsset | null {
  const kind = mediaKindFromEntry(entry)
  if (!kind) return null
  const metadata = entry.metadata || {}
  return {
    id: entry.id,
    kind,
    name: entry.name || kind,
    mimeType: entry.mimeType,
    displayUrl: entry.content || '',
    thumbnailUrl: typeof metadata.thumbnailUrl === 'string' ? metadata.thumbnailUrl : undefined,
    originalUrl: typeof metadata.originalUrl === 'string' ? metadata.originalUrl : undefined,
    localRef: `jc-media:${entry.id}`,
    fileId: entry.id,
    prompt: typeof metadata.prompt === 'string' ? metadata.prompt : undefined,
    model: typeof metadata.model === 'string' ? metadata.model : undefined,
    taskId: typeof metadata.taskId === 'string' ? metadata.taskId : undefined,
    createdAt: entry.createdAt,
    duration: typeof metadata.duration === 'number' ? metadata.duration : undefined,
    width: typeof metadata.width === 'number' ? metadata.width : undefined,
    height: typeof metadata.height === 'number' ? metadata.height : undefined,
    thumbnailFailedAt: typeof metadata.thumbnailFailedAt === 'number' ? metadata.thumbnailFailedAt : undefined,
    thumbnailError: typeof metadata.thumbnailError === 'string' ? metadata.thumbnailError : undefined,
    status: entry.content ? 'ready' : 'failed',
    errorMsg: entry.content ? undefined : '媒体内容为空',
  }
}

export function mediaDisplayAssetFromCreationResult(params: {
  result: CreationResult
  id: string
  displayUrl: string
  status?: MediaDisplayStatus
  errorMsg?: string
}): MediaDisplayAsset | null {
  const kind = mediaKindFromResult(params.result)
  if (!kind) return null
  return {
    id: params.id,
    kind,
    name: params.result.content?.trim().slice(0, 36) || params.result.model || kind,
    mimeType: undefined,
    displayUrl: params.displayUrl,
    originalUrl: params.result.originalUrl,
    localRef: params.result.url.startsWith('jc-media:') ? params.result.url : undefined,
    prompt: params.result.content,
    model: params.result.model,
    taskId: params.result.taskId,
    createdAt: params.result.ts,
    status: params.status || (params.displayUrl ? 'ready' : 'loading'),
    errorMsg: params.errorMsg,
  }
}

function assetDedupeKeys(asset: MediaDisplayAsset): string[] {
  const keys = new Set<string>()
  if (asset.taskId) keys.add(`task:${asset.taskId}`)
  if (asset.fileId) keys.add(`file:${asset.fileId}`)
  if (asset.localRef) keys.add(`local:${asset.localRef}`)
  if (asset.originalUrl) keys.add(`url:${asset.originalUrl}`)
  if (asset.displayUrl && asset.status !== 'loading') keys.add(`display:${asset.displayUrl}`)
  return [...keys]
}

function mediaAssetPreferenceScore(asset: MediaDisplayAsset): number {
  let score = 0
  if (asset.fileId) score += 100
  if (asset.localRef) score += 40
  if (asset.status === 'ready') score += 20
  if (!asset.id.startsWith('task:')) score += 10
  score += Math.min(asset.createdAt || 0, 9_999_999_999) / 1_000_000_000_000
  return score
}

export function dedupeMediaDisplayAssets(assets: MediaDisplayAsset[]): MediaDisplayAsset[] {
  const selected: MediaDisplayAsset[] = []
  const keyToIndex = new Map<string, number>()

  for (const asset of assets) {
    const keys = assetDedupeKeys(asset)
    const existingIndex = keys
      .map(key => keyToIndex.get(key))
      .find((index): index is number => typeof index === 'number')

    if (existingIndex === undefined) {
      const index = selected.length
      selected.push(asset)
      for (const key of keys) keyToIndex.set(key, index)
      continue
    }

    const current = selected[existingIndex]
    const winner = mediaAssetPreferenceScore(asset) >= mediaAssetPreferenceScore(current) ? asset : current
    selected[existingIndex] = winner
    for (const key of new Set([...assetDedupeKeys(current), ...keys, ...assetDedupeKeys(winner)])) {
      keyToIndex.set(key, existingIndex)
    }
  }

  return selected
}
