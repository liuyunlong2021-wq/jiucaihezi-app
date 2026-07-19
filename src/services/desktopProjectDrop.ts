import { emitEvent } from '@/utils/eventBus'
import { isTauriRuntime } from '@/utils/tauriEnv'

export type DesktopProjectDropTarget = 'canvas' | 'chat' | 'editor' | 'project'

export interface DesktopProjectDrop {
  target: DesktopProjectDropTarget
  paths: string[]
  targetPath: string
}

function dropTargetAt(position: { x: number; y: number }): DesktopProjectDrop | null {
  const scale = window.devicePixelRatio || 1
  const element = document.elementFromPoint(position.x / scale, position.y / scale)
  const targetElement = element?.closest<HTMLElement>('[data-project-drop-target]')
  const target = targetElement?.dataset.projectDropTarget as DesktopProjectDropTarget | undefined
  if (!target || !['canvas', 'chat', 'editor', 'project'].includes(target)) return null
  const pathElement = element?.closest<HTMLElement>('[data-project-drop-path]')
  return { target, paths: [], targetPath: pathElement?.dataset.projectDropPath || '' }
}

export async function startDesktopProjectDropDispatcher(): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return await getCurrentWindow().onDragDropEvent(event => {
    if (event.payload.type !== 'drop') return
    const drop = dropTargetAt(event.payload.position)
    if (!drop) return
    drop.paths = event.payload.paths || []
    if (drop.paths.length) emitEvent('project:desktop-drop', drop)
  })
}
