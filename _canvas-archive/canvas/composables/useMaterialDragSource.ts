/**
 * useMaterialDragSource — Vue 版，对齐 T8 hooks/useMaterialDragSource.ts
 */
import { useCanvasDragMaterialStore, type MaterialPayload } from '@/stores/canvasDragMaterialStore'

export function useMaterialDragSource(getPayload: () => MaterialPayload | null) {
  const dragStore = useCanvasDragMaterialStore()

  return (e: MouseEvent) => {
    if (e.button !== 0) return
    if (!(e.ctrlKey || e.metaKey)) return
    const payload = getPayload()
    if (!payload) return
    if (!payload.url && !payload.text) return
    e.preventDefault()
    e.stopPropagation()
    dragStore.start(payload, e.clientX, e.clientY)
  }
}
