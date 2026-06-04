export type ToolArtifactKind = 'html' | 'document' | 'media' | 'text' | 'unknown'

export interface ToolDownloadFileLike {
  filename: string
  url: string
  size?: number
}

export interface ToolArtifact {
  id: string
  kind: ToolArtifactKind
  filename: string
  url: string
  path: string
  localPath?: string
  mimeType: string
  bytes?: number
  createdAt: number
}

export interface OpenOfficeDownloadFileDeps {
  shellOpen?: (path: string) => Promise<void>
  windowOpen?: (url: string) => void
  openExternal?: (url: string) => Promise<void>
}

export function assetUrlToLocalPath(url: string): string {
  try {
    if (/(^|\/)\.\.(\/|$)/.test(url) || /%2e/i.test(url)) return ''
    const parsed = new URL(url)
    if (parsed.protocol !== 'asset:' || parsed.hostname !== 'localhost') return ''
    const decoded = decodeURIComponent(parsed.pathname || '')
    if (!decoded.startsWith('/') || decoded.includes('\0')) return ''
    if (decoded.split('/').some(segment => segment === '..')) return ''
    return decoded
  } catch {
    return ''
  }
}

export function buildToolArtifactFromDownloadFile(
  file: ToolDownloadFileLike,
  now = Date.now(),
): ToolArtifact {
  const localPath = file.url.startsWith('asset:') ? assetUrlToLocalPath(file.url) : ''
  const kind = inferArtifactKind(file.filename || file.url)
  return {
    id: buildArtifactId(file),
    kind,
    filename: file.filename,
    url: file.url,
    path: localPath || file.url,
    localPath: localPath || undefined,
    mimeType: inferArtifactMimeType(file.filename || file.url, kind),
    bytes: typeof file.size === 'number' ? file.size : undefined,
    createdAt: now,
  }
}

export async function openOfficeDownloadFile(
  file: ToolDownloadFileLike,
  deps: OpenOfficeDownloadFileDeps = {},
): Promise<void> {
  if (!file.url) return

  if (file.url.startsWith('asset:')) {
    const localPath = assetUrlToLocalPath(file.url)
    if (localPath) {
      try {
        await resolveShellOpen(deps)(localPath)
        return
      } catch {
        // Fall through to the asset URL so browser previews still work in dev/test.
      }
    }
    resolveWindowOpen(deps)(file.url)
    return
  }

  if (file.url.startsWith('blob:')) {
    resolveWindowOpen(deps)(file.url)
    return
  }

  await resolveOpenExternal(deps)(file.url)
}

function buildArtifactId(file: ToolDownloadFileLike): string {
  const scheme = String(file.url || '').split(':')[0] || 'file'
  return `artifact_${scheme}_${file.filename}_${sanitizeForArtifactId(file.url)}`
}

function sanitizeForArtifactId(value: string): string {
  return String(value || '').replace(/[^A-Za-z0-9_]/g, '_')
}

function inferArtifactKind(value: string): ToolArtifactKind {
  const ext = String(value || '').split('?')[0].split('#')[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
  if (!ext) return 'unknown'
  if (['html', 'htm'].includes(ext)) return 'html'
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf'].includes(ext)) return 'document'
  if (['mp4', 'mov', 'webm', 'mkv', 'mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) return 'media'
  if (['json', 'md', 'txt', 'csv', 'srt'].includes(ext)) return 'text'
  return 'unknown'
}

function inferArtifactMimeType(value: string, kind: ToolArtifactKind): string {
  const ext = String(value || '').split('?')[0].split('#')[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase()
  switch (ext) {
    case 'html':
    case 'htm':
      return 'text/html'
    case 'pdf':
      return 'application/pdf'
    case 'doc':
      return 'application/msword'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'xls':
      return 'application/vnd.ms-excel'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'ppt':
      return 'application/vnd.ms-powerpoint'
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case 'csv':
      return 'text/csv'
    case 'json':
      return 'application/json'
    case 'md':
      return 'text/markdown'
    case 'txt':
      return 'text/plain'
    case 'srt':
      return 'application/x-subrip'
    case 'mp4':
      return 'video/mp4'
    case 'mov':
      return 'video/quicktime'
    case 'webm':
      return 'video/webm'
    case 'mkv':
      return 'video/x-matroska'
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    case 'aac':
      return 'audio/aac'
    case 'flac':
      return 'audio/flac'
    case 'ogg':
      return 'audio/ogg'
    default:
      return kind === 'text' ? 'text/plain' : 'application/octet-stream'
  }
}

function resolveWindowOpen(deps: OpenOfficeDownloadFileDeps): (url: string) => void {
  if (deps.windowOpen) return deps.windowOpen
  return (url: string) => {
    globalThis.window?.open?.(url, '_blank')
  }
}

function resolveShellOpen(deps: OpenOfficeDownloadFileDeps): (path: string) => Promise<void> {
  if (deps.shellOpen) return deps.shellOpen
  return async (path: string) => {
    const shell = await import('@tauri-apps/plugin-shell')
    await shell.open(path)
  }
}

function resolveOpenExternal(deps: OpenOfficeDownloadFileDeps): (url: string) => Promise<void> {
  if (deps.openExternal) return deps.openExternal
  return async (url: string) => {
    const { openExternal } = await import('@/utils/httpClient')
    await openExternal(url)
  }
}
