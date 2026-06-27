/**
 * useHasAutoOutput — Vue 版，对齐 T8 nodes/useHasAutoOutput.ts
 * 检测当前节点是否已有自动生成的 OutputNode 连接
 */
import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'

export function useHasAutoOutput(nodeId: string) {
  const { getEdges, getNodes } = useVueFlow('jiucai-canvas')

  return computed(() => {
    const edges = getEdges.value || []
    const nodes = getNodes.value || []
    return edges.some(e => {
      if (e.source !== nodeId) return false
      const target = nodes.find(n => n.id === e.target)
      return target?.type === 'output' || target?.type === 'imageResult' || target?.type === 'videoResult' || target?.type === 'audioResult'
    })
  })
}
