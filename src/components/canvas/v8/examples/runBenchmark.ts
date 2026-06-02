/**
 * 运行 Phase 0 性能基准（在浏览器控制台执行）
 * 
 * import { runPhase0Benchmark } from '.../runBenchmark'
 * runPhase0Benchmark()
 */

import { startJankMeasurement, getBenchmarkResult, logBenchmark } from '../utils/performanceBenchmark'
import { simulateHeavyResizeOperations } from '../utils/simulateHeavyCanvas'
import { freezeManager, globalFreezeManager } from '../composables/useGlobalFreezeManager'

export async function runPhase0Benchmark(options: { useSimulation?: boolean; durationMs?: number; autoReset?: boolean } = {}) {
  const { useSimulation = true, durationMs = 8000, autoReset = true } = options

  if (autoReset) {
    freezeManager.reset()
  }

  console.log(`[V8 Phase 0] 开始性能基准... (active: ${freezeManager.getActiveCount()})`)

  const stopMeasurement = startJankMeasurement()

  if (useSimulation) {
    console.log(`  → 30节点重负载模拟运行中（${durationMs / 1000}s）...`)
    await simulateHeavyResizeOperations(() => {}, Math.floor(durationMs / 50))
  } else {
    console.log('  → 请手动进行拖拽/缩放操作以产生负载...')
    await new Promise(r => setTimeout(r, durationMs))
  }

  const result = getBenchmarkResult('Phase 0 - 30节点手感', 200)
  logBenchmark(result)

  return result
}

if (typeof window !== 'undefined') {
  ;(window as any).runV8Phase0Benchmark = runPhase0Benchmark
  // 方便调试时手动重置冻结状态
  ;(window as any).resetV8Freeze = () => globalFreezeManager.reset()
}
