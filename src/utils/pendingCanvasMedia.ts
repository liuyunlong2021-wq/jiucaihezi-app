/**
 * 待入画布媒体队列：预览截帧时创作面板（画布）与预览互斥、必然不可用，
 * 先把媒体路径排队（localStorage 持久化），等画布打开完成时统一加入。
 */
import type { CanvasMediaKind } from '@/types/canvas'

export interface PendingCanvasMediaEntry {
  owner: string
  path: string
  kind: CanvasMediaKind
  addedAt: number
}

const STORAGE_KEY = 'jc_pending_canvas_media_v1'

function readAll(): PendingCanvasMediaEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(entry => entry?.owner && entry?.path) : []
  } catch {
    return []
  }
}

function writeAll(entries: PendingCanvasMediaEntry[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    /* 存储不可用时静默：图片已落盘，最多不自动入画布 */
  }
}

/** 入队（同项目同路径去重，保留最新）。 */
export function queuePendingCanvasMedia(entry: PendingCanvasMediaEntry): void {
  const entries = readAll().filter(item => !(item.owner === entry.owner && item.path === entry.path))
  entries.push(entry)
  writeAll(entries)
}

/** 取出并清空指定项目的待入队列（其他项目的保留）。 */
export function takePendingCanvasMedia(owner: string): PendingCanvasMediaEntry[] {
  const all = readAll()
  const mine = all.filter(item => item.owner === owner)
  if (mine.length) writeAll(all.filter(item => item.owner !== owner))
  return mine
}
