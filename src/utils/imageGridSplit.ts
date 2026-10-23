/**
 * imageGridSplit — 把一张图按 N×M 切开。
 *
 * 只服务 MJ 那种「一次出 4 张拼成一张」的成图，所以几何计算是纯函数，
 * 便于单测；裁剪和落盘在浏览器里做，不调任何上游接口。
 */
import { createProjectFileActions } from '@/services/projectFileActions'
import { createRuntimeProjectFileService } from '@/services/projectFileService'
import { queuePendingCanvasMedia } from '@/utils/pendingCanvasMedia'
import { nextMaterialPath } from '@/utils/projectMaterials'

export interface ImageSplitGrid {
  cols: number
  rows: number
}

/** MJ 默认四宫格；其余三个是常见变体，按需选。 */
export const IMAGE_SPLIT_GRIDS: ImageSplitGrid[] = [
  { cols: 2, rows: 2 },
  { cols: 1, rows: 2 },
  { cols: 2, rows: 1 },
  { cols: 3, rows: 3 },
]

export function imageSplitLabel(grid: ImageSplitGrid): string {
  return `${grid.rows}×${grid.cols}`
}

export interface ImageSplitRect {
  index: number
  x: number
  y: number
  width: number
  height: number
}

/**
 * 边界用整数分配、最后一行/列直接吃到边缘：既不重叠也不留缝。
 * index 从左上到右下，1 起。
 */
export function imageSplitRects(width: number, height: number, grid: ImageSplitGrid): ImageSplitRect[] {
  const { cols, rows } = grid
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return []
  if (cols < 1 || rows < 1) return []
  const rects: ImageSplitRect[] = []
  for (let row = 0; row < rows; row += 1) {
    const y = Math.round((height * row) / rows)
    const bottom = row === rows - 1 ? height : Math.round((height * (row + 1)) / rows)
    for (let col = 0; col < cols; col += 1) {
      const x = Math.round((width * col) / cols)
      const right = col === cols - 1 ? width : Math.round((width * (col + 1)) / cols)
      rects.push({ index: row * cols + col + 1, x, y, width: right - x, height: bottom - y })
    }
  }
  return rects
}

/** 从原图裁出选中的格子，文件名形如 `原名-u2.png`。 */
export async function cropImageTiles(
  blob: Blob,
  grid: ImageSplitGrid,
  selectedIndexes: number[],
  baseName = 'image',
): Promise<File[]> {
  const bitmap = await createImageBitmap(blob)
  try {
    const rects = imageSplitRects(bitmap.width, bitmap.height, grid)
      .filter(rect => selectedIndexes.includes(rect.index))
    const files: File[] = []
    for (const rect of rects) {
      const canvas = document.createElement('canvas')
      canvas.width = rect.width
      canvas.height = rect.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('浏览器不支持画布裁剪')
      context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
      const tile = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!tile) throw new Error('切图导出失败')
      files.push(new File([tile], tileFilename(baseName, rect.index), { type: 'image/png' }))
    }
    return files
  } finally {
    bitmap.close?.()
  }
}

function tileFilename(baseName: string, index: number): string {
  const base = String(baseName || 'image').replace(/\.[^.]+$/, '')
  return `${base}-u${index}.png`
}

/**
 * 落盘：写进项目「图片」目录，并排队进画布（与视频截帧同一路径）。
 * 返回写入的相对路径，方便宿主提示。
 */
export async function saveSplitTiles(owner: string, files: File[]): Promise<string[]> {
  if (!owner || !files.length) return []
  const projectFiles = createRuntimeProjectFileService()
  const actions = createProjectFileActions(projectFiles)
  const existing = new Set((await projectFiles.list(owner)).map(item => item.path))
  const saved: string[] = []
  for (const file of files) {
    const resource = await actions.importMedia({
      owner,
      path: nextMaterialPath('.raw/jc-media/图片', file.name, existing),
      data: new Uint8Array(await file.arrayBuffer()),
      mimeType: 'image/png',
    })
    existing.add(resource.path)
    queuePendingCanvasMedia({ owner, path: resource.path, kind: 'image', addedAt: Date.now() })
    saved.push(resource.path)
  }
  return saved
}
