import assert from 'node:assert/strict'
import { test } from 'node:test'
import { screenshotToolbarPosition } from '../screenshotToolbar'

const viewport = { width: 1200, height: 900 }
test('toolbar stays below when its actual height fits', () => {
  assert.deepEqual(screenshotToolbarPosition(
    { left: 100, top: 100, width: 300, height: 200 },
    { width: 300, height: 44 }, viewport,
  ), { left: 100, top: 308 })
})
test('toolbar flips above selections touching the bottom edge', () => {
  assert.deepEqual(screenshotToolbarPosition(
    { left: 100, top: 750, width: 300, height: 150 },
    { width: 300, height: 44 }, viewport,
  ), { left: 100, top: 698 })
})
test('wrapped toolbar uses its measured height rather than a fixed estimate', () => {
  assert.deepEqual(screenshotToolbarPosition(
    { left: 100, top: 650, width: 300, height: 180 },
    { width: 280, height: 90 }, viewport,
  ), { left: 100, top: 552 })
})
test('full-height and right-edge selections keep all controls inside the viewport', () => {
  assert.deepEqual(screenshotToolbarPosition(
    { left: 1180, top: 4, width: 20, height: 880 },
    { width: 300, height: 44 }, viewport,
  ), { left: 892, top: 8 })
})
