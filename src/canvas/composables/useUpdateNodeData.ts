/**
 * useUpdateNodeData — Vue 版，对齐 T8 nodes/useUpdateNodeData.ts
 * 返回一个 patch 函数，用于更新当前节点的 data
 */
import { useCanvasStore } from '@/stores/canvasStore'

export function useUpdateNodeData(nodeId: string) {
  const canvasStore = useCanvasStore()
  return (patch: Record<string, any>) => {
    canvasStore.updateNodeData(nodeId, patch)
  }
}
