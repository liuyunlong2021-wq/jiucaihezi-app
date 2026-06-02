/**
 * activate.ts
 *
 * 一键激活 V8 Phase 0 手感系统（开发调试用）
 * 
 * 使用方式（在 CanvasWorkspace 或 main.ts 中临时引入）：
 *   import { activateV8Phase0 } from '@/components/canvas/v8/activate'
 *   activateV8Phase0()
 */

import './styles/v8-canvas-freeze.css'
import './styles/v8-node-base.css'

import { globalFreeze } from './composables/useCanvasInteractionFreeze'
import { ensureV8Styles } from './composables/useEnsureV8Styles'

export function activateV8Phase0() {
  ensureV8Styles()

  console.log('%c[V8] Phase 0 手感基础设施已激活', 'color:#10b981; font-weight:bold')
  
  // 暴露调试工具
  if (typeof window !== 'undefined') {
    (window as any).__v8 = {
      freeze: globalFreeze,
      version: 'Phase 0',
      activateV8Phase0,
    }
  }

  // 标记 body
  document.body.dataset.v8Phase = '0'
}