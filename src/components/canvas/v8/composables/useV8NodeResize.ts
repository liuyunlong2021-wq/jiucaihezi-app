/**
 * useV8NodeResize.ts
 *
 * V8 高性能 Resize 逻辑
 * 
 * 特点：
 * - 使用原生 Pointer Events + requestAnimationFrame
 * - 拖拽过程中完全不写 Pinia / Vue 响应式数据
 * - 只在 pointerup 时批量提交
 * - 自动集成全局冻结策略
 */

import { ref } from 'vue'
import type { CanvasNode } from '@/types/canvas'
import { globalFreezeManager } from './useGlobalFreezeManager.ts'

interface ResizeOptions {
  minWidth?: number
  minHeight?: number
  onResize?: (id: string, width: number, height: number) => void
  onResizeEnd?: (id: string, width: number, height: number) => void
}

export function useV8NodeResize(options: ResizeOptions = {}) {
  const {
    minWidth = 240,
    minHeight = 100,
    onResize,
    onResizeEnd,
  } = options

  const resizingId = ref<string | null>(null)
  let startX = 0
  let startY = 0
  let startWidth = 0
  let startHeight = 0
  let currentNodeId = ''
  let rafId: number | null = null

  const handlePointerDown = (e: PointerEvent, node: CanvasNode) => {
    e.stopPropagation()
    e.preventDefault()

    currentNodeId = node.id
    resizingId.value = node.id

    startX = e.clientX
    startY = e.clientY
    startWidth = (node.data as any)?.width ?? 280
    startHeight = (node.data as any)?.height ?? 160

    globalFreezeManager.freeze()

    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('pointerup', (ev) => handlePointerUp(ev as PointerEvent), { once: true })
  }

  const handlePointerMove = (e: PointerEvent) => {
    if (!currentNodeId) return

    if (rafId) cancelAnimationFrame(rafId)

    rafId = requestAnimationFrame(() => {
      const newWidth = Math.max(minWidth, startWidth + (e.clientX - startX))
      const newHeight = Math.max(minHeight, startHeight + (e.clientY - startY))

      const el = document.querySelector(`[data-node-id="${currentNodeId}"]`) as HTMLElement
      if (el) {
        el.style.width = `${newWidth}px`
        el.style.height = `${newHeight}px`
      }

      onResize?.(currentNodeId, Math.round(newWidth), Math.round(newHeight))
    })
  }

  const handlePointerUp = (e?: PointerEvent) => {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }

    const upEvent = e || (window.event as PointerEvent) || { clientX: startX, clientY: startY } as any
    const finalWidth = Math.max(minWidth, startWidth + (upEvent.clientX - startX))
    const finalHeight = Math.max(minHeight, startHeight + (upEvent.clientY - startY))

    onResizeEnd?.(currentNodeId, Math.round(finalWidth), Math.round(finalHeight))

    globalFreezeManager.unfreeze(60)

    window.removeEventListener('pointermove', handlePointerMove)
    resizingId.value = null
    currentNodeId = ''
  }

  return {
    resizingId,
    handlePointerDown,
  }
}