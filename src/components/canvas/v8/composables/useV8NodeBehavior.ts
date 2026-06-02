/**
 * useV8NodeBehavior.ts
 *
 * 组合所有 Phase 0 手感能力的高级 Hook
 * 提供一站式 V8 节点行为支持
 */

import { globalFreezeManager } from './useGlobalFreezeManager.ts'
import { useV8NodeResize } from './useV8NodeResize.ts'
import type { CanvasNode } from '@/types/canvas'

interface V8NodeBehaviorOptions {
  onResizeEnd?: (id: string, width: number, height: number) => void
}

export function useV8NodeBehavior(node: CanvasNode, options: V8NodeBehaviorOptions = {}) {
  const { handlePointerDown, resizingId } = useV8NodeResize({
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