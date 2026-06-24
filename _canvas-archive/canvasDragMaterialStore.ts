/* canvasDragMaterialStore — Pinia 版，对齐 T8 stores/dragMaterial.ts */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type MaterialKind = 'image' | 'video' | 'audio' | 'text'

export interface MaterialPayload {
  kind: MaterialKind
  url?: string
  text?: string
  sourceNodeId?: string
  previewUrl?: string
}

export interface MaterialDropEventDetail {
  targetNodeId: string
  payload: MaterialPayload
}

export const MATERIAL_DROP_EVENT = 'jiucai:material-drop'

export const useCanvasDragMaterialStore = defineStore('canvasDragMaterial', () => {
  const dragging = ref(false)
  const payload = ref<MaterialPayload | null>(null)
  const clientX = ref(0)
  const clientY = ref(0)
  const hoverTargetId = ref<string | null>(null)
  const hoverAccepts = ref(false)

  function start(p: MaterialPayload, x: number, y: number) {
    dragging.value = true; payload.value = p; clientX.value = x; clientY.value = y; hoverTargetId.value = null; hoverAccepts.value = false
  }
  function move(x: number, y: number, targetId: string | null, accepts: boolean) {
    clientX.value = x; clientY.value = y; hoverTargetId.value = targetId; hoverAccepts.value = accepts
  }
  function end() {
    dragging.value = false; payload.value = null; hoverTargetId.value = null; hoverAccepts.value = false
  }
  return { dragging, payload, clientX, clientY, hoverTargetId, hoverAccepts, start, move, end }
})
