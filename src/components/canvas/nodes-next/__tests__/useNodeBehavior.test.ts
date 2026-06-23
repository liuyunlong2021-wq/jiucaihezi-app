// Polyfill before any import that executes top level browser code
if (typeof (global as any).document === 'undefined') {
  const fakeStyle = { setProperty: () => {}, removeProperty: () => {} }
  const fakeEl = { style: fakeStyle, classList: { add: () => {}, remove: () => {}, contains: () => false } }
  ;(global as any).document = { body: fakeEl, documentElement: fakeEl, querySelector: () => fakeEl }
  ;(global as any).window = global
}

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'
import { useNodeBehavior } from '../composables/useNodeBehavior.ts'

describe('useNodeBehavior (Phase 0)', () => {
  const fakeNode = {
    id: 'test-node',
    data: { width: 300, height: 180 }
  } as any

  test('should expose isInteracting and resizingId (structure)', () => {
    const { isInteracting, resizingId } = useNodeBehavior(fakeNode)
    assert.ok(isInteracting !== undefined)
    assert.ok(resizingId !== undefined)
  })

  test('should provide onResizeHandlePointerDown handler (structure)', () => {
    const { onResizeHandlePointerDown } = useNodeBehavior(fakeNode, {
      onResizeEnd: () => {}
    })
    assert.equal(typeof onResizeHandlePointerDown, 'function')
  })
})