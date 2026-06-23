/**
 * Canvas - Public API (Phase 0)
 * 
 * This barrel file exposes the core hand-feel infrastructure.
 * Import from here when testing Phase 0 components.
 */

export { default as NodeFrame } from './NodeFrame.vue'

export { 
  useCanvasInteractionFreeze, 
  globalFreeze 
} from './composables/useCanvasInteractionFreeze'

export { useNodeResize } from './composables/useNodeResize'
export { useNode } from './composables/useNode'

export { 
  startJankMeasurement, 
  getBenchmarkResult, 
  logBenchmark 
} from './utils/performanceBenchmark'

// Auto-activate Phase 0 styles when this module is imported
import './styles/canvas-freeze.css'
import './styles/node-base.css'
import './styles/freeze-enhance.css'

// Re-export everything
export * from './composables/useCanvasInteractionFreeze'
export * from './composables/useNodeResize'
export * from './composables/useNode'
export * from './composables/useNodeBehavior'
export * from './composables/useGlobalFreezeManager'
export * from './composables/useActivateCanvas'
export * from './utils/performanceBenchmark'
export * from './utils/simulateHeavyCanvas'
export { runPhase0Benchmark } from './examples/runBenchmark'

// 开发调试面板（仅开发使用）
export { default as DevPhase0Panel } from './dev/DevPhase0Panel.vue'