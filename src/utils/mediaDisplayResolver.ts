import { isLocalMediaRef, resolveCreationMediaUrl } from '@/utils/creationMediaCache'

export type MediaDisplayResolveStatus = 'loading' | 'ready' | 'failed'

export interface MediaDisplayResolveResult {
  displayUrl: string
  status: MediaDisplayResolveStatus
  errorMsg?: string
}

export type LocalMediaResolver = (ref: string) => Promise<string>

export function isDeferredMediaDisplayUrl(url: string): boolean {
  return isLocalMediaRef(url)
}

export async function resolveMediaDisplayUrl(
  url: string,
  resolveLocal: LocalMediaResolver = resolveCreationMediaUrl,
): Promise<MediaDisplayResolveResult> {
  if (!url) {
    return { displayUrl: '', status: 'failed', errorMsg: '媒体地址为空' }
  }
  if (!isDeferredMediaDisplayUrl(url)) {
    return { displayUrl: url, status: 'ready' }
  }
  try {
    const resolved = await resolveLocal(url)
    if (!resolved) return { displayUrl: '', status: 'failed', errorMsg: '本地媒体引用无法解析' }
    return { displayUrl: resolved, status: 'ready' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '本地媒体引用解析失败')
    return { displayUrl: '', status: 'failed', errorMsg: message }
  }
}
