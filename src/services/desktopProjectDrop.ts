import { emitEvent } from '@/utils/eventBus'
import { isTauriMobileRuntime, isTauriRuntime } from '@/utils/tauriEnv'

export type DesktopProjectDropTarget = 'canvas' | 'chat' | 'project'

export interface DesktopProjectDrop {
  target: DesktopProjectDropTarget
  paths: string[]
  targetPath: string
  warnings: string[]
}

const MAX_DESKTOP_DROP_ENTRIES = 1000

function visible(element: HTMLElement | null): element is HTMLElement {
  return Boolean(
    element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden',
  )
}

function fallbackTarget(): HTMLElement | null {
  const chat = document.querySelector<HTMLElement>(
    '[data-project-drop-target="chat"]:not([data-project-drop-disabled="true"])',
  )
  return visible(chat) ? chat : null
}

export function desktopProjectDropAt(position: {
  x: number
  y: number
}): DesktopProjectDrop | null {
  const scale = window.devicePixelRatio || 1
  const element = document.elementFromPoint(position.x / scale, position.y / scale)
  const hit = element?.closest<HTMLElement>('[data-project-drop-target]') || null
  if (hit?.dataset.projectDropDisabled === 'true') return null
  const targetElement = hit || fallbackTarget()
  const target = targetElement?.dataset.projectDropTarget as DesktopProjectDropTarget | undefined
  if (!target || !['canvas', 'chat', 'project'].includes(target)) return null
  const pathElement = element?.closest<HTMLElement>('[data-project-drop-path]')
  return { target, paths: [], targetPath: pathElement?.dataset.projectDropPath || '', warnings: [] }
}

async function expandDroppedPaths(
  paths: string[],
): Promise<{ paths: string[]; warnings: string[] }> {
  const { invoke } = await import('@tauri-apps/api/core')
  const expanded = await Promise.allSettled(
    paths.map(sourcePath =>
      invoke<Array<{ path: string; isDir?: boolean; isDirectory?: boolean }>>(
        'dev_list_external_files',
        { input: { path: sourcePath, maxEntries: MAX_DESKTOP_DROP_ENTRIES } },
      ),
    ),
  )
  const files: string[] = []
  const warnings: string[] = []
  for (const [index, result] of expanded.entries()) {
    const sourcePath = paths[index] || ''
    const label = sourcePath.split(/[\\/]/).pop() || sourcePath
    if (result.status === 'rejected') {
      warnings.push(
        `“${label}”无法读取：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      )
      continue
    }
    const entries = result.value
    files.push(
      ...entries.filter(entry => !(entry.isDir ?? entry.isDirectory)).map(entry => entry.path),
    )
    if (entries.length >= MAX_DESKTOP_DROP_ENTRIES) {
      warnings.push(`“${label}”达到 1000 个条目上限，请拆分文件夹后继续导入`)
    }
  }
  return { paths: [...new Set(files)], warnings }
}

export async function startDesktopProjectDropDispatcher(): Promise<() => void> {
  if (!isTauriRuntime() || isTauriMobileRuntime()) return () => undefined
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return await getCurrentWindow().onDragDropEvent(event => {
    if (event.payload.type !== 'drop') return
    const drop = desktopProjectDropAt(event.payload.position)
    if (!drop) return
    void expandDroppedPaths(event.payload.paths || []).then(expanded => {
      drop.paths = expanded.paths
      drop.warnings = expanded.warnings
      if (!drop.paths.length && !drop.warnings.length) return
      emitEvent('project:desktop-drop', drop)
    })
  })
}
