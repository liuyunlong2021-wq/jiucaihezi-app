/**
 * Tests for useCanvasInteractionFreeze
 * 
 * These tests validate TDD requirements F-002.
 * Converted to node:test.
 */

// Polyfill before any import that executes top level browser code
if (typeof (global as any).document === 'undefined') {
  const fakeStyle = { setProperty: () => {}, removeProperty: () => {} }
  const fakeEl = { style: fakeStyle, classList: { add: () => {}, remove: () => {}, contains: () => false } }
  ;(global as any).document = { body: fakeEl, documentElement: fakeEl, querySelector: () => fakeEl }
  ;(global as any).window = global
}

import assert from 'node:assert/strict'
import { test, describe, beforeEach, afterEach } from 'node:test'
import { useCanvasInteractionFreeze } from '../composables/useCanvasInteractionFreeze.ts'

describe('useCanvasInteractionFreeze (Phase 0)', () => {
  let freeze: ReturnType<typeof useCanvasInteractionFreeze>

  beforeEach(() => {
    document.body.classList.remove('canvas-interacting')
    freeze = useCanvasInteractionFreeze()
  })

  afterEach(() => {
    document.body.classList.remove('canvas-interacting')
  })

  test('should return start/end interaction functions (structure for env)', () => {
    assert.equal(typeof freeze.startInteraction, 'function')
    assert.equal(typeof freeze.endInteraction, 'function')
    // Full DOM class mutation tested via integration in workspace freeze wiring
  })
})