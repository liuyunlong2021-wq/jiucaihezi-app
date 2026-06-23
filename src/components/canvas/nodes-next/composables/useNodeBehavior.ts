/**
 * useNodeBehavior.ts
 *
 * 组合所有 Phase 0 手感能力的高级 Hook
 * 提供一站式 节点行为支持
 */

import { globalFreezeManager } from './useGlobalFreezeManager.ts'
import { useNodeResize } from './useNodeResize.ts'
import type { CanvasNode } from '@/types/canvas'

interface NodeBehaviorOptions {
  onResizeEnd?: (id: string, width: number, height: number) => void
}

export function useNodeBehavior(node: CanvasNode, options: NodeBehaviorOptions = {}) {
  const { handlePointerDown, resizingId } = useNodeResize({
    minWidth: 240,
    minHeight: 100,
    onResizeEnd: (id, width, height) => {
      options.onResizeEnd?.(id, width, height)
    }
  })

  const onResizeHandlePointerDown = (e: PointerEvent) => {
    handlePointerDown(e, node)
  }

  return {
    isInteracting: globalFreezeManager.isFrozen,
    resizingId,
    onResizeHandlePointerDown,
  }
}