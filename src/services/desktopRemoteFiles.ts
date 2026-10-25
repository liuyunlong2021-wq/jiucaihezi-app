import { RemoteProtocolError } from './desktopRemoteProtocol'

/**
 * 手机看成果：只读开放项目里的 `wiki/`（文字成果）与 `.raw/jc-media/`（图片、视频）。
 * 读写都经已有的 `dev_list_directory` / `dev_read_file`，它们负责“不跳出项目目录”；
 * 这里再收窄到成果目录、去掉点文件，并按扩展名白名单决定能下发什么。
 */

/** 每段原始字节数：远小于 Noise 消息与中继单帧上限，视频由手机分段拼起来。 */
export const REMOTE_FILE_CHUNK_BYTES = 512 * 1024

const ROOTS = ['wiki', '.raw/jc-media'] as const

const KINDS: Record<string, { kind: RemoteFileKind; mime: string }> = {
  md: { kind: 'text', mime: 'text/markdown' },
  txt: { kind: 'text', mime: 'text/plain' },
  json: { kind: 'text', mime: 'application/json' },
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  webp: { kind: 'image', mime: 'image/webp' },
  gif: { kind: 'image', mime: 'image/gif' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  m4v: { kind: 'video', mime: 'video/mp4' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  webm: { kind: 'video', mime: 'video/webm' },
}

export type RemoteFileKind = 'text' | 'image' | 'video'
export type RemoteFileEntry = {
  path: string
  name: string
  isDir: boolean
  size?: number
  updatedAt?: number
  kind?: RemoteFileKind
}

type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>

/** 规范化手机给的路径；空串代表成果根目录。不在成果目录里的一律 FILE_PATH_INVALID。 */
export function remoteFilePath(raw: string): string {
  const path = String(raw ?? '').trim()
  if (!path) return ''
  const segments = path.split('/')
  const inRoot = ROOTS.some(root => path === root || path.startsWith(`${root}/`))
  // `.raw` 是成果根本身的一段；其余任何点开头的段（含 `..`）都不放行。
  const hidden = segments.some((segment, index) => !segment || (segment.startsWith('.') && !(index === 0 && segment === '.raw')))
  if (!inRoot || hidden || path.includes('\\') || /^[A-Za-z]:/.test(path)) throw new RemoteProtocolError('FILE_PATH_INVALID')
  return path
}

export function remoteFileKind(path: string) {
  return KINDS[path.split('.').pop()?.toLowerCase() || ''] ?? null
}

export async function listRemoteFiles(owner: string, rawPath: string, invoke: Invoke): Promise<RemoteFileEntry[]> {
  const path = remoteFilePath(rawPath)
  if (!path) {
    const roots: RemoteFileEntry[] = []
    for (const root of ROOTS) {
      try {
        await invoke('dev_list_directory', { input: { root: owner, relativePath: root } })
        roots.push({ path: root, name: root === 'wiki' ? 'wiki' : '图片与视频', isDir: true })
      } catch { /* 这个项目还没有这类成果 */ }
    }
    return roots
  }
  const entries = await invoke('dev_list_directory', { input: { root: owner, relativePath: path } }) as Array<{
    path: string; isDir: boolean; size?: number; updatedAt?: number
  }>
  return entries
    .map(entry => ({ ...entry, name: entry.path.split('/').pop() || entry.path }))
    .filter(entry => !entry.name.startsWith('.'))
    .map(entry => ({
      path: entry.path, name: entry.name, isDir: entry.isDir,
      ...entry.size === undefined || entry.size === null ? {} : { size: entry.size },
      ...entry.updatedAt === undefined || entry.updatedAt === null ? {} : { updatedAt: entry.updatedAt },
      ...entry.isDir ? {} : { kind: remoteFileKind(entry.path)?.kind },
    }))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir))
}

export async function readRemoteFile(owner: string, rawPath: string, offset: number, invoke: Invoke) {
  const path = remoteFilePath(rawPath)
  const type = remoteFileKind(path)
  if (!path || !type) throw new RemoteProtocolError('FILE_TYPE_NOT_ALLOWED')
  if (!Number.isSafeInteger(offset) || offset < 0) throw new RemoteProtocolError('FILE_OFFSET_INVALID')
  const read = await invoke('dev_read_file', {
    input: { root: owner, relativePath: path, maxBytes: REMOTE_FILE_CHUNK_BYTES, offset },
  }) as { base64: string; size: number; truncated: boolean }
  return { path, ...type, size: read.size, offset, base64: read.base64, done: !read.truncated }
}
