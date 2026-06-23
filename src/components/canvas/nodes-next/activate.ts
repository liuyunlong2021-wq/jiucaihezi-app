/**
 * activate.ts
 *
 * 一键激活 Phase 0 手感系统（开发调试用）
 * 
 * 使用方式（在 CanvasWorkspace 或 main.ts 中临时引入）：
 *   import { activatePhase0 } from '@/components/canvas/nodes-next/activate'
 *   activatePhase0()
 */

import './styles/canvas-freeze.css'
import './styles/node-base.css'

import { globalFreeze } from './composables/useCanvasInteractionFreeze'
import { ensureCanvasStyles } from './composables/useEnsureCanvasStyles'

export function activatePhase0() {
  ensureCanvasStyles()

  console.log('%c[Canvas] Phase 0 手感基础设施已激活', 'color:#10b981; font-weight:bold')
  
  // 暴露调试工具
  if (typeof window !== 'undefined') {
    (window as any).__v8 = {
      freeze: globalFreeze,
      version: 'Phase 0',
      activatePhase0,
    }
  }

  // 标记 body
  document.body.dataset.v8Phase = '0'
}