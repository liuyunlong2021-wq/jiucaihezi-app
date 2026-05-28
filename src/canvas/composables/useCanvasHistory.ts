/**
 * useCanvasHistory — Vue 版，对齐 T8 hooks/useCanvasHistory.ts
 * 画布撤销/重做历史
 */
import { ref } from 'vue'
import { useCanvasStore } from '@/stores/canvasStore'

interface Snapshot {
  nodes: any[]
  edges: any[]
}

export function useCanvasHistory() {
  const store = useCanvasStore()
  const past = ref<Snapshot[]>([])
  const future = ref<Snapshot[]>([])
  const maxSize = 50

  function takeSnapshot(): Snapshot {
    return {
      nodes: JSON.parse(JSON.stringify(store.nodes)),
      edges: JSON.parse(JSON.stringify(store.edges)),
    }
  }

  function pushHistory() {
    past.value.push(takeSnapshot())
    if (past.value.length > maxSize) past.value.shift()
    future.value = []
  }

  function undo() {
    if (past.value.length === 0) return false
    future.value.push(takeSnapshot())
    const snap = past.value.pop()!
    store.replaceNodes(snap.nodes)
    store.replaceEdges(snap.edges)
    return true
  }

  function redo() {
    if (future.value.length === 0) return false
    past.value.push(takeSnapshot())
    const snap = future.value.pop()!
    store.replaceNodes(snap.nodes)
    store.replaceEdges(snap.edges)
    return true
  }

  return { pushHistory, undo, redo, canUndo: () => past.value.length > 0, canRedo: () => future.value.length > 0 }
}
