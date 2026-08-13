import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isTauriMobileRuntime } from '../tauriEnv'

test('Tauri mobile detection accepts iOS desktop user agents without classifying Macs as mobile', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { __TAURI_INTERNALS__: {} } })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 },
    })
    assert.equal(isTauriMobileRuntime(), true)

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 },
    })
    assert.equal(isTauriMobileRuntime(), false)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete (globalThis as any).window
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else delete (globalThis as any).navigator
  }
})
