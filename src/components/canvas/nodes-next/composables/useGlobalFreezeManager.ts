/**
 * useGlobalFreezeManager.ts
 * 
 * 全局冻结管理器（Phase 0 最终版）
 * 负责统一管理画布级别的交互冻结状态
 * 
 * 这是 Phase 0 手感基础设施的核心单例。
 */

import { ref, readonly } from 'vue'

const isFrozen = ref(false)
let activeInteractions = 0
let restoreTimer: number | null = null

export interface GlobalFreezeManager {
  readonly isFrozen: ReturnType<typeof readonly>
  freeze: () => void
  unfreeze: (delay?: number) => void
  reset: () => void
  getActiveCount: () => number
}

export function useGlobalFreezeManager(): GlobalFreezeManager {
  const freeze = () => {
    activeInteractions++
    if (!isFrozen.value) {
      isFrozen.value = true
      document.body.classList.add('canvas-interacting')
      document.documentElement.style.setProperty('--canvas-transition', 'none')

      // VueFlow 针对性优化标记
      const vf = document.querySelector('.vue-flow')
      if (vf) vf.classList.add('v8-interacting')
    }
    if (restoreTimer) {
      clearTimeout(restoreTimer)
      restoreTimer = null
    }
  }

  const unfreeze = (delay = 60) => {
    activeInteractions = Math.max(0, activeInteractions - 1)
    if (activeInteractions === 0) {
      restoreTimer = window.setTimeout(() => {
        isFrozen.value = false
        document.body.classList.remove('canvas-interacting')

        const vf = document.querySelector('.vue-flow')
        if (vf) vf.classList.remove('v8-interacting')

        document.documentElement.style.removeProperty('--canvas-transition')
        restoreTimer = null
      }, delay)
    }
  }

  const reset = () => {
    activeInteractions = 0
    if (restoreTimer) {
      clearTimeout(restoreTimer)
      restoreTimer = null
    }
    isFrozen.value = false
    document.body.classList.remove('canvas-interacting')
    const vf = document.querySelector('.vue-flow')
    if (vf) vf.classList.remove('v8-interacting')
    document.documentElement.style.removeProperty('--canvas-transition')
  }

  const getActiveCount = () => activeInteractions

  return {
    isFrozen: readonly(isFrozen),
    freeze,
    unfreeze,
    reset,
    getActiveCount,
  }
}

// 全局单例（推荐直接使用这个）
export const globalFreezeManager = useGlobalFreezeManager()

// 便捷别名
export const freezeManager = globalFreezeManager
