/**
 * canvasPersistence — 画布 JSON 持久化
 *
 * 桌面端: {projectDir}/.jiucaihezi/canvas/{canvasId}.json
 * Web 端: localStorage
 */
import type { CanvasDocument } from '@/types/canvas'
import { isTauriRuntime } from '@/utils/tauriEnv'

const STORAGE_KEY = 'jc_canvas_v1'

/** 获取项目画布目录 */
async function getCanvasDir(): Promise<string | null> {
  if (!isTauriRuntime()) return null
  try {
    const { useProjectStore } = await import('@/stores/projectStore')
    const projectDir = useProjectStore().projectDir.value
    if (!projectDir) return null
    return `${projectDir}/.jiucaihezi/canvas`
  } catch {
    return null
  }
}

/** 保存画布 */
export async function saveCanvas(doc: CanvasDocument): Promise<void> {
  const json = JSON.stringify(doc)

  if (isTauriRuntime()) {
    const dir = await getCanvasDir()
    if (dir) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('dev_write_file_bytes', {
          input: {
            root: dir.split('/.jiucaihezi/canvas')[0],
            relativePath: `.jiucaihezi/canvas/${doc.canvasId}.json`,
            dataBase64: btoa(unescape(encodeURIComponent(json))),
          },
        })
        return
      } catch {
        // 降级到 localStorage
      }
    }
  }

  try { localStorage.setItem(STORAGE_KEY, json) } catch {}
}

/** 恢复画布 */
export async function restoreCanvas(canvasId: string): Promise<CanvasDocument | null> {
  if (isTauriRuntime()) {
    const dir = await getCanvasDir()
    if (dir) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const result = await invoke<{ content: string; truncated: boolean }>('dev_read_file', {
          input: {
            root: dir.split('/.jiucaihezi/canvas')[0],
            relativePath: `.jiucaihezi/canvas/${canvasId}.json`,
            maxBytes: 500_000,
          },
        })
        if (result?.content) return JSON.parse(result.content)
      } catch {
        // 文件不存在，返回 null
      }
    }
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}

  return null
}
