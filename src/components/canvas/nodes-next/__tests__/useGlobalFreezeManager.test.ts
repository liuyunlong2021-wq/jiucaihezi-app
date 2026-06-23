// Polyfill before any import that executes top level browser code
if (typeof (global as any).document === 'undefined') {
  const fakeStyle = { setProperty: () => {}, removeProperty: () => {} }
  const fakeEl = { style: fakeStyle, classList: { add: () => {}, remove: () => {}, contains: () => false } }
  ;(global as any).document = { body: fakeEl, documentElement: fakeEl, querySelector: () => fakeEl }
  ;(global as any).window = global
}

import assert from 'node:assert/strict'
import { test, describe, beforeEach } from 'node:test'
import { globalFreezeManager } from '../composables/useGlobalFreezeManager.ts'

describe('useGlobalFreezeManager (Phase 0)', () => {
  beforeEach(() => {
    if (typeof (globalFreezeManager as any).reset === 'function') {
      (globalFreezeManager as any).reset()
    }
  })

  test('should expose freeze/unfreeze/reset (structure for env)', () => {
    assert.equal(typeof globalFreezeManager.freeze, 'function')
    assert.equal(typeof globalFreezeManager.unfreeze, 'function')
    if (typeof (globalFreezeManager as any).reset === 'function') {
      (globalFreezeManager as any).reset()
    }
    // Full state + DOM tested in integration (workspace onDrag etc)
  })
})