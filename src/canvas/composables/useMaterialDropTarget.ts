/**
 * useMaterialDropTarget — Vue 版，对齐 T8 hooks/useMaterialDropTarget.ts
 */
import { computed, onMounted, onUnmounted } from 'vue'
import {
  useCanvasDragMaterialStore,
  MATERIAL_DROP_EVENT,
  type MaterialKind,
  type MaterialPayload,
  type MaterialDropEventDetail,
} from '@/stores/canvasDragMaterialStore'

interface Options {
  id: string
  accepts: MaterialKind[]
  onDrop: (payload: MaterialPayload) => void
  allowSelf?: boolean
}

export function useMaterialDropTarget({ id, accepts, onDrop, allowSelf }: Options) {
  const dragStore = useCanvasDragMaterialStore()
  const acceptsKey = accepts.join(',')

  function handler(e: Event) {
    const ce = e as CustomEvent<MaterialDropEventDetail>
    const detail = ce.detail
    if (!detail || detail.targetNodeId !== id) return
    if (!accepts.includes(detail.payload.kind)) return
    if (!allowSelf && detail.payload.sourceNodeId === id) return
    onDrop(detail.payload)
  }

  onMounted(() => { window.addEventListener(MATERIAL_DROP_EVENT, handler as EventListener) })
  onUnmounted(() => { window.removeEventListener(MATERIAL_DROP_EVENT, handler as EventListener) })

  const dropProps = computed(() => ({
    'data-drop-kinds': acceptsKey,
    'data-node-id': id,
  }))
  const isHover = computed(() => dragStore.dragging && dragStore.hoverTargetId === id)
  const isAccepting = computed(() =>
    isHover.value && dragStore.hoverAccepts && !!dragStore.payload &&
    accepts.includes(dragStore.payload.kind) && (allowSelf || dragStore.payload.sourceNodeId !== id)
  )

  return { dropProps, isHover, isAccepting }
}
