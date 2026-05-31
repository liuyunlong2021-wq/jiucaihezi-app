import assert from 'node:assert/strict'
import { test } from 'node:test'

import { confirmAction } from '../confirmAction'

test('confirmAction falls back to global confirm outside Tauri', async () => {
  const previousConfirm = (globalThis as any).confirm
  let received = ''
  try {
    ;(globalThis as any).confirm = (message: string) => {
      received = message
      return true
    }

    assert.equal(await confirmAction('确定删除吗？'), true)
    assert.equal(received, '确定删除吗？')
  } finally {
    ;(globalThis as any).confirm = previousConfirm
  }
})

test('confirmAction returns false when no confirmation API is available', async () => {
  const previousConfirm = (globalThis as any).confirm
  try {
    delete (globalThis as any).confirm
    assert.equal(await confirmAction('确定删除吗？'), false)
  } finally {
    ;(globalThis as any).confirm = previousConfirm
  }
})
