import type { Scene3DCamera, Scene3DDocument } from './scene3d'

export interface Scene3DEditorContext {
  selectedId: string | null
  selectedBone: string | null
  camera: Scene3DCamera
  time: number
  recording?: boolean
}

export interface Scene3DHost {
  context(path: string): Scene3DEditorContext | null
  beginEdit(path: string): Promise<() => void>
  saved(path: string): Promise<void>
  preview(document: Scene3DDocument, context?: Scene3DEditorContext | null): Promise<Blob>
  seat(document: Scene3DDocument, target: string, seat: string, floorY: number): Promise<{ document: Scene3DDocument; report: Record<string, unknown> }>
}

/** Both manual edits and external Agent edits enter the same undo history. */
export function appendScene3DHistory(history: Scene3DDocument[], index: number, next: Scene3DDocument): number {
  if (JSON.stringify(history[index]) === JSON.stringify(next)) return index
  history.splice(index + 1)
  history.push(structuredClone(next))
  if (history.length > 100) history.shift()
  return history.length - 1
}
