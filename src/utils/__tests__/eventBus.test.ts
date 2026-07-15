import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as eventBus from '@/utils/eventBus'

type AsyncEventEmitter = (event: string, ...args: unknown[]) => Promise<void>

function emitEventAsync(event: string, ...args: unknown[]): Promise<void> {
  const emitter = (eventBus as typeof eventBus & { emitEventAsync?: AsyncEventEmitter }).emitEventAsync
  if (!emitter) throw new Error('emitEventAsync is unavailable')
  return emitter(event, ...args)
}

test('waits for async canvas lifecycle listeners before resolving', async () => {
  const event = 'canvas:test-before-rename'
  const order: string[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const off = eventBus.onEvent(event, async () => {
    order.push('listener:start')
    await gate
    order.push('listener:end')
  })

  try {
    const emitted = emitEventAsync(event, { path: 'jc-canvas/test.jccanvas' })
    await Promise.resolve()
    assert.deepEqual(order, ['listener:start'])
    release()
    await emitted
    assert.deepEqual(order, ['listener:start', 'listener:end'])
  } finally {
    release?.()
    off()
  }
})
