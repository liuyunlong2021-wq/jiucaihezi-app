/**
 * useCanvasInteractionFreeze.ts
 *
 * 手感核心：全局拖拽/缩放冻结策略
 * 
 * 目标：
 * - 拖拽或缩放节点时，冻结画布上所有非必要渲染和交互
 * - 极大提升复杂画布（30+ 节点）的流畅度
 *
 * 使用方式：
 * const { isInteracting, startInteraction, endInteraction } = useCanvasInteractionFreeze()
 */

import { globalFreezeManager } from './useGlobalFreezeManager.ts'

/**
 * @deprecated 推荐直接使用 globalFreezeManager（更健壮的版本）
 */
export function useCanvasInteractionFreeze() {
  return {
    isInteracting: globalFreezeManager.isFrozen,
    startInteraction: globalFreezeManager.freeze,
    endInteraction: globalFreezeManager.unfreeze,
  }
}

export const globalFreeze = {
  isInteracting: globalFreezeManager.isFrozen,
  startInteraction: globalFreezeManager.freeze,
  endInteraction: globalFreezeManager.unfreeze,
}