export type FileSortMode = 'time-desc' | 'time-asc' | 'name-asc' | 'name-desc'

export const DEFAULT_FILE_SORT_MODE: FileSortMode = 'time-desc'

export const FILE_SORT_OPTIONS: Array<{
  mode: FileSortMode
  icon: string
  shortLabel: string
  title: string
}> = [
  { mode: 'time-desc', icon: 'south', shortLabel: '最新', title: '排序：最新在前' },
  { mode: 'time-asc', icon: 'north', shortLabel: '最早', title: '排序：最早在前' },
  { mode: 'name-asc', icon: 'sort_by_alpha', shortLabel: 'A-Z', title: '排序：名称 A-Z' },
  { mode: 'name-desc', icon: 'sort_by_alpha', shortLabel: 'Z-A', title: '排序：名称 Z-A' },
]

export interface SortableFileEntry {
  id?: string
  name?: string
  createdAt?: number
  updatedAt?: number
}

export function isFileSortMode(value: unknown): value is FileSortMode {
  return FILE_SORT_OPTIONS.some(option => option.mode === value)
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

  const nameDiff = compareName(a, b)
  return mode === 'name-asc' ? nameDiff : -nameDiff
}
