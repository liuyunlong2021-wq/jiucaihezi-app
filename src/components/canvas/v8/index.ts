/**
 * V8 Canvas - Public API (Phase 0)
 * 
 * This barrel file exposes the core hand-feel infrastructure.
 * Import from here when testing Phase 0 components.
 */

export { default as NodeFrame } from './NodeFrame.vue'

export { 
  useCanvasInteractionFreeze, 
  globalFreeze 
} from './composables/useCanvasInteractionFreeze'

export { useV8NodeResize } from './composables/useV8NodeResize'
export { useV8Node } from './composables/useV8Node'

export { 
  startJankMeasurement, 
  getBenchmarkResult, 
  logBenchmark 
} from './utils/performanceBenchmark'

// Auto-activate V8 Phase 0 styles when this module is imported
import './styles/v8-canvas-freeze.css'
import './styles/v8-node-base.css'
import './styles/v8-freeze-enhance.css'

// Re-export everything
export * from './composables/useCanvasInteractionFreeze'
export * from './composables/useV8NodeResize'
export * from './composables/useV8Node'
export * from './composables/useV8NodeBehavior'
export * from './composables/useGlobalFreezeManager'
export * from './composables/useActivateV8Canvas'
export * from './utils/performanceBenchmark'
export * from './utils/simulateHeavyCanvas'
export { runPhase0Benchmark } from './examples/runBenchmark'

// 开发调试面板（仅开发使用）
export { default as DevV8Phase0Panel } from './dev/DevV8Phase0Panel.vue'