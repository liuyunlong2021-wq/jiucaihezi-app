export type FileSortMode =
  | 'time-desc'
  | 'time-asc'
  | 'name-asc'
  | 'name-desc'
  | 'size-desc'
  | 'size-asc'
  | 'kind-asc'

/** 默认「修改日期·最新在前」：生成物名带时间戳，按名字升序会永远沉在列表最底下。 */
export const DEFAULT_FILE_SORT_MODE: FileSortMode = 'time-desc'

/**
 * 排序菜单的唯一真源：菜单项与当前项文案都从这里取，不另建映射表。
 * 只列数据支持得起的维度：树节点有 name / size / updatedAt / mimeType。
 * 不提供「不排序」——桌面 list 按字节序返回，中文名会全部沉底。
 */
export const FILE_SORT_OPTIONS: Array<{
  mode: FileSortMode
  icon: string
  shortLabel: string
  title: string
}> = [
  { mode: 'time-desc', icon: 'south', shortLabel: '修改日期：最新在前', title: '排序：修改日期，最新在前' },
  { mode: 'time-asc', icon: 'north', shortLabel: '修改日期：最早在前', title: '排序：修改日期，最早在前' },
  { mode: 'name-asc', icon: 'sort_by_alpha', shortLabel: '名称：A→Z', title: '排序：名称，A→Z' },
  { mode: 'name-desc', icon: 'sort_by_alpha', shortLabel: '名称：Z→A', title: '排序：名称，Z→A' },
  { mode: 'size-desc', icon: 'south', shortLabel: '大小：大到小', title: '排序：大小，大到小' },
  { mode: 'size-asc', icon: 'north', shortLabel: '大小：小到大', title: '排序：大小，小到大' },
  { mode: 'kind-asc', icon: 'category', shortLabel: '种类', title: '排序：种类，图片→视频→音频→文档→其他' },
]

export interface SortableFileEntry {
  id?: string
  name?: string
  createdAt?: number
  updatedAt?: number
  size?: number | null
  isDir?: boolean
  mimeType?: string
}

export function isFileSortMode(value: unknown): value is FileSortMode {
  return FILE_SORT_OPTIONS.some(option => option.mode === value)
}

export function fileSortLabel(mode: FileSortMode): string {
  return FILE_SORT_OPTIONS.find(option => option.mode === mode)?.shortLabel || '修改日期：最新在前'
}

function itemTime(item: SortableFileEntry) {
  return Number(item.updatedAt || item.createdAt || 0) || 0
}

function compareName(a: SortableFileEntry, b: SortableFileEntry) {
  const result = String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  })
  if (result !== 0) return result
  return String(a.id || '').localeCompare(String(b.id || ''), 'zh-CN')
}

export type FileKind = 'image' | 'video' | 'audio' | 'document' | 'other'

const KIND_RANK: Record<FileKind, number> = { image: 0, video: 1, audio: 2, document: 3, other: 4 }

const KIND_EXTENSIONS: Record<FileKind, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif', 'heic', 'tif', 'tiff'],
  video: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'],
  document: ['md', 'txt', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'json', 'html', 'csv', 'canvas', 'jccanvas', 'jcscene'],
  other: [],
}

/**
 * 种类先看 mimeType（列表接口给得准），缺失时退回扩展名。
 * 目录不参与种类比较：调用方已经保证目录永远排在最前。
 */
export function fileKindOf(entry: SortableFileEntry): FileKind {
  if (entry.isDir) return 'other'
  const mime = String(entry.mimeType || '').toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  const extension = String(entry.name || '').split('.').pop()?.toLowerCase() || ''
  for (const kind of ['image', 'video', 'audio', 'document'] as const) {
    if (KIND_EXTENSIONS[kind].includes(extension)) return kind
  }
  return 'other'
}

export function compareFileEntries(
  a: SortableFileEntry,
  b: SortableFileEntry,
  mode: FileSortMode = DEFAULT_FILE_SORT_MODE,
) {
  if (mode === 'time-desc' || mode === 'time-asc') {
    const diff = itemTime(b) - itemTime(a)
    if (diff !== 0) return mode === 'time-desc' ? diff : -diff
    return compareName(a, b)
  }

  if (mode === 'size-desc' || mode === 'size-asc') {
    const diff = Number(b.size || 0) - Number(a.size || 0)
    if (diff !== 0) return mode === 'size-desc' ? diff : -diff
    return compareName(a, b)
  }

  if (mode === 'kind-asc') {
    const diff = KIND_RANK[fileKindOf(a)] - KIND_RANK[fileKindOf(b)]
    if (diff !== 0) return diff
    return compareName(a, b)
  }

  const nameDiff = compareName(a, b)
  return mode === 'name-asc' ? nameDiff : -nameDiff
}
