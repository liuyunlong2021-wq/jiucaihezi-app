/**
 * useV8Node.ts
 *
 * 组合 Freeze + Resize + Frame 事件的便捷 Hook
 * 供未来 V8 节点使用
 */

import { useV8NodeResize } from './useV8NodeResize.ts'
import { globalFreeze } from './useCanvasInteractionFreeze.ts'
import type { CanvasNode } from '@/types/canvas'

export function useV8Node(node: CanvasNode) {
  const { handlePointerDown: handleResizeDown, resizingId } = useV8NodeResize({
    onResizeEnd: (id, width, height) => {
      // 这里未来会调用 canvasStore 更新
      console.log('[V8] Node resized:', id, width, height)
    },
  })

  const onResizeHandlePointerDown = (e: PointerEvent) => {
    handleResizeDown(e, node)
  }

  return {
    resizingId,
    onResizeHandlePointerDown,
    // 未来可以在这里暴露更多 V8 节点通用行为
  }
}