/**
 * 30node-benchmark-verification.mjs
 * Quick verification run of the Phase 0 30-node performance harness.
 * This produces real(ish) Jank numbers for the current V8 state.
 */

import { simulateHeavyCanvas } from '../utils/simulateHeavyCanvas.ts'
import { startJankMeasurement, getBenchmarkResult } from '../utils/performanceBenchmark.ts'

console.log('=== 30-Node V8 Canvas Performance Verification ===')

const result = await simulateHeavyCanvas({
  nodeCount: 30,
  heavyTextNodes: 8,
  includeV8Nodes: true,
  dragDurationMs: 1200,
  resizeOperations: 3,
})

console.log('\nBenchmark Result:')
console.log(result)

const jank = getBenchmarkResult()
console.log('\nJank Report (main thread):', jank)

if (jank.avgJankMs < 200) {
  console.log('\n✅ PASS: 30-node Jank < 200ms target met (current V8 state)')
} else {
  console.log('\n⚠️  Needs optimization: Jank above 200ms threshold')
}

process.exit(0)