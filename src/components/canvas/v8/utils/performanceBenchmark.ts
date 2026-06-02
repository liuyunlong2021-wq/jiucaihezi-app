/**
 * performanceBenchmark.ts
 *
 * V8 画布性能基准工具
 * 用于验证 TDD 中的关键指标：
 * - 30 节点画布拖拽/缩放 Jank < 200ms
 */

export interface BenchmarkResult {
  scenario: string
  avgJankMs: number
  maxJankMs: number
  samples: number
  passed: boolean
}

let measurements: number[] = []

let stopMeasurement: (() => void) | null = null

export function startJankMeasurement(durationMs?: number) {
  measurements = []
  let lastTime = performance.now()

  const measure = () => {
    const now = performance.now()
    const delta = now - lastTime
    if (delta > 16) { // 超过一帧
      measurements.push(delta)
    }
    lastTime = now
    if (stopMeasurement) requestAnimationFrame(measure)
  }

  stopMeasurement = () => {
    stopMeasurement = null
  }

  requestAnimationFrame(measure)

  if (durationMs) {
    setTimeout(() => {
      if (stopMeasurement) stopMeasurement()
    }, durationMs)
  }

  return stopMeasurement
}

export function stopJankMeasurement() {
  if (stopMeasurement) {
    stopMeasurement()
    stopMeasurement = null
  }
}

export function getBenchmarkResult(scenario: string, threshold = 200): BenchmarkResult {
  if (measurements.length === 0) {
    return {
      scenario,
      avgJankMs: 0,
      maxJankMs: 0,
      samples: 0,
      passed: true,
    }
  }

  const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length
  const max = Math.max(...measurements)

  return {
    scenario,
    avgJankMs: Math.round(avg),
    maxJankMs: Math.round(max),
    samples: measurements.length,
    passed: max <= threshold,
  }
}

// 便捷函数：在控制台打印结果
export function logBenchmark(result: BenchmarkResult) {
  const status = result.passed ? '✅ PASS' : '❌ FAIL'
  console.log(
    `%c[Canvas V8 Benchmark] ${result.scenario}`,
    'font-weight: bold; color: #666'
  )
  console.table({
    'Avg Jank (ms)': result.avgJankMs,
    'Max Jank (ms)': result.maxJankMs,
    Samples: result.samples,
    Threshold: 200,
    Status: status,
  })
}

// ===== 新增：实时 + 30节点专用 API =====
export function run30NodeBenchmark(): void {
  console.log('%c[V8] 启动 30 节点重负载基准测试...', 'color:#10b981')
  startJankMeasurement(8000)  

  // 提示用户进行拖拽/缩放操作
  console.log('%c请在画布上进行持续拖拽 + 缩放操作 6-8 秒，然后调用 window.v8GetBenchmarkReport()', 'color:#f59e0b')
}

export function v8GetBenchmarkReport() {
  const result = getBenchmarkResult('30-Node Heavy Drag/Resize (Live)', 200)
  logBenchmark(result)

  if (result.passed) {
    console.log('%c✅ 30节点 Jank < 200ms 目标达成！', 'color:#10b981; font-weight:bold')
  } else {
    console.log('%c❌ 需要进一步优化手感', 'color:#ef4444; font-weight:bold')
  }
  return result
}

// For node-based verification / CI sims (pushes artificial deltas)
export function simulateJankForTest(deltas: number[]) {
  measurements.push(...deltas)
}

// 暴露到全局方便手动测试 (main auto benchmark exposed via simulate module + workspace)
if (typeof window !== 'undefined') {
  (window as any).v8GetBenchmarkReport = v8GetBenchmarkReport
}