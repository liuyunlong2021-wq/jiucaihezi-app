/**
 * mediaReorder.ts — 文件树单层媒体排序编号（纯函数）
 *
 * 规则：编号名统一为 `三位编号_父文件夹名.原扩展名`（如 `第一集/001_第一集.png`）；
 *      已有编号的文件一律尊重现有编号顺序，未编号的文件按生成时间接在后面。
 * 只做「读列表 → 算新名字」：不碰文件系统、不碰 Vue、不读当前时间。
 */
import type { ProjectResource } from '@/utils/projectResource'

export type MediaKind = 'image' | 'video' | 'audio'
export type MediaReorderMode = 'respect' | 'created'
export type MediaReorderTimeSource = 'task' | 'file' | 'none'

export type ReorderResource = Pick<
  ProjectResource,
  'path' | 'name' | 'isDirectory' | 'updatedAt' | 'mimeType'
>

export interface MediaReorderRename {
  path: string
  name: string
  nextName: string
  timeSource: MediaReorderTimeSource
}

export interface MediaReorderConflict {
  path: string
  name: string
  nextName: string
  holderPath: string
}

export interface MediaReorderPlan {
  /** 需要改名的文件，已按最终顺序排列。 */
  renames: MediaReorderRename[]
  /** 目标名与当前名相同：不执行改名、不产生变更事件。 */
  unchanged: MediaReorderRename[]
  conflicts: MediaReorderConflict[]
  /** 冲突方也会改名：先改成临时名再落到最终名。 */
  needsTempPass: boolean
  numberedCount: number
  unnumberedCount: number
  fileTimeCount: number
}

const ORDER_PREFIX = /^(\d{3,})[_-]/
const TRAILING_TASK_SUFFIX = /^.*_([a-z0-9]{4,})$/i
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|avif|heic)$/i
const VIDEO_EXT = /\.(?:mp4|mov|avi|webm|mkv|m4v)$/i
const AUDIO_EXT = /\.(?:mp3|wav|ogg|m4a|flac|aac)$/i

export function mediaKindOf(path: string, mimeType?: string): MediaKind | null {
  const value = String(path || '')
  if (mimeType?.startsWith('image/')) return 'image'
  if (mimeType?.startsWith('video/')) return 'video'
  if (mimeType?.startsWith('audio/')) return 'audio'
  if (IMAGE_EXT.test(value)) return 'image'
  if (VIDEO_EXT.test(value)) return 'video'
  if (AUDIO_EXT.test(value)) return 'audio'
  return null
}

export function orderPrefixOf(name: string): number | null {
  const match = ORDER_PREFIX.exec(String(name || ''))
  return match ? Number(match[1]) : null
}

export function stripOrderPrefix(name: string): string {
  const value = String(name || '')
  const match = ORDER_PREFIX.exec(value)
  return match ? value.slice(match[0].length) : value
}

function extensionOf(name: string): string {
  const match = /\.[^.]+$/.exec(String(name || ''))
  return match ? match[0] : ''
}

/** 编号名：三位数字 + 下划线 + 父文件夹名 + 原扩展名。 */
export function orderName(index: number, folderName: string, fileName: string): string {
  return `${String(index).padStart(3, '0')}_${String(folderName || '').trim()}${extensionOf(fileName)}`
}

/** 交换型冲突时使用的临时名，保留扩展名以便分类不跳变。 */
export function temporaryReorderName(index: number, name: string): string {
  return `__pft_reorder_tmp_${String(index).padStart(3, '0')}_${stripOrderPrefix(name)}`
}

/** 文件名末尾的任务后缀，与 buildMediaFilename 的 `_${task.id 后 6 位}` 规则一致。 */
export function fileNameTaskSuffix(fileName: string): string | null {
  const stem = stripOrderPrefix(String(fileName || '')).replace(/\.[^.]+$/, '')
  const match = TRAILING_TASK_SUFFIX.exec(stem)
  return match ? match[1].toLowerCase() : null
}

interface ReorderEntry {
  path: string
  name: string
  prefix: number | null
  updatedAt: number | undefined
  sortTime: number
  timeSource: MediaReorderTimeSource
}

function compareByTime(a: ReorderEntry, b: ReorderEntry): number {
  const timeDiff = a.sortTime - b.sortTime
  // 两边都无时间时 Inf - Inf 为 NaN，此时交给文件时间与名称兜底。
  if (!Number.isNaN(timeDiff) && timeDiff !== 0) return timeDiff
  const updatedDiff = (a.updatedAt ?? 0) - (b.updatedAt ?? 0)
  if (updatedDiff !== 0) return updatedDiff
  return a.name.localeCompare(b.name, 'zh-CN')
}

function compareRespectingNumber(a: ReorderEntry, b: ReorderEntry): number {
  const aNumbered = a.prefix !== null
  const bNumbered = b.prefix !== null
  if (aNumbered && bNumbered) {
    const prefixDiff = (a.prefix as number) - (b.prefix as number)
    return prefixDiff !== 0 ? prefixDiff : a.name.localeCompare(b.name, 'zh-CN')
  }
  if (aNumbered !== bNumbered) return aNumbered ? -1 : 1
  return compareByTime(a, b)
}

export function planMediaReorder(input: {
  resources: ReorderResource[]
  /** 编号基础名：父文件夹名。 */
  baseName: string
  /** 该文件的生成时间（任务 createdAt）；找不到返回 undefined，交给文件时间兜底。 */
  createdAtOf?: (path: string, name: string) => number | undefined
  mode?: MediaReorderMode
  isProtected?: (path: string) => boolean
}): MediaReorderPlan {
  const mode: MediaReorderMode = input.mode === 'created' ? 'created' : 'respect'
  const isProtected = input.isProtected || (() => false)
  const media = (input.resources || []).filter(
    resource =>
      !resource.isDirectory &&
      mediaKindOf(resource.path || resource.name, resource.mimeType) !== null &&
      !isProtected(resource.path),
  )
  if (media.length < 2) {
    return {
      renames: [],
      unchanged: [],
      conflicts: [],
      needsTempPass: false,
      numberedCount: 0,
      unnumberedCount: 0,
      fileTimeCount: 0,
    }
  }

  const entries: ReorderEntry[] = media.map(resource => {
    const taskTime = input.createdAtOf?.(resource.path, resource.name)
    const fileTime =
      typeof resource.updatedAt === 'number' && Number.isFinite(resource.updatedAt)
        ? resource.updatedAt
        : undefined
    return {
      path: resource.path,
      name: resource.name,
      prefix: orderPrefixOf(resource.name),
      updatedAt: fileTime,
      sortTime: taskTime ?? fileTime ?? Number.POSITIVE_INFINITY,
      timeSource: taskTime !== undefined ? 'task' : fileTime !== undefined ? 'file' : 'none',
    }
  })

  const ordered =
    mode === 'created'
      ? [...entries].sort(compareByTime)
      : [...entries].sort(compareRespectingNumber)
  const planned: MediaReorderRename[] = ordered.map((entry, index) => ({
    path: entry.path,
    name: entry.name,
    nextName: orderName(index + 1, input.baseName, entry.name),
    timeSource: entry.timeSource,
  }))
  const renames = planned.filter(entry => entry.nextName !== entry.name)
  const changingPaths = new Set(renames.map(entry => entry.path))
  const conflicts: MediaReorderConflict[] = renames.flatMap(entry => {
    const holder = entries.find(
      candidate => candidate.name === entry.nextName && candidate.path !== entry.path,
    )
    return holder
      ? [{ path: entry.path, name: entry.name, nextName: entry.nextName, holderPath: holder.path }]
      : []
  })

  return {
    renames,
    unchanged: planned.filter(entry => entry.nextName === entry.name),
    conflicts,
    needsTempPass: conflicts.some(conflict => changingPaths.has(conflict.holderPath)),
    numberedCount: entries.filter(entry => entry.prefix !== null).length,
    unnumberedCount: entries.filter(entry => entry.prefix === null).length,
    fileTimeCount: entries.filter(entry => entry.timeSource === 'file').length,
  }
}
