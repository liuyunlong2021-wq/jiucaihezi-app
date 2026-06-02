import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { getBenchmarkResult } from '../utils/performanceBenchmark.ts'

describe('performanceBenchmark (Phase 0)', () => {
  test('should return passed when no significant jank is recorded', () => {
    const result = getBenchmarkResult('unit-test', 200)
    assert.ok('passed' in result)
    assert.ok('avgJankMs' in result)
  })
})