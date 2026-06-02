import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createProgressiveStreamReveal } from '../progressiveStreamReveal'

function createManualScheduler() {
  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  return {
    schedule(callback: FrameRequestCallback) {
      const id = nextId++
      callbacks.set(id, callback)
      return id
    },
    cancel(id: number) {
      callbacks.delete(id)
    },
    runFrame(time = 16) {
      const pending = [...callbacks.entries()]
      callbacks.clear()
      for (const [, callback] of pending) callback(time)
    },
    pendingCount() {
      return callbacks.size
    },
  }
}

test('createProgressiveStreamReveal reveals a large canonical update over frames', () => {
  const scheduler = createManualScheduler()
  const emitted: string[] = []
  const reveal = createProgressiveStreamReveal({
    emit: text => emitted.push(text),
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
    minCharsPerFrame: 2,
    maxCharsPerFrame: 4,
    maxLagChars: 1000,
  })

  reveal.pushCanonical('abcdefghijkl')
  assert.equal(emitted.length, 0)

  scheduler.runFrame()
  assert.equal(emitted.at(-1), 'abcd')
  scheduler.runFrame()
  assert.equal(emitted.at(-1), 'abcdefgh')
  scheduler.runFrame()
  assert.equal(emitted.at(-1), 'abcdefghijkl')
})

test('createProgressiveStreamReveal flushes to canonical content on finish', () => {
  const scheduler = createManualScheduler()
  const emitted: string[] = []
  const reveal = createProgressiveStreamReveal({
    emit: text => emitted.push(text),
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
    minCharsPerFrame: 1,
    maxCharsPerFrame: 1,
  })

  reveal.pushCanonical('完整内容')
  scheduler.runFrame()
  assert.notEqual(emitted.at(-1), '完整内容')

  reveal.flush()
  assert.equal(emitted.at(-1), '完整内容')
  assert.equal(scheduler.pendingCount(), 0)
})

test('createProgressiveStreamReveal catches up when lag is too large', () => {
  const scheduler = createManualScheduler()
  const emitted: string[] = []
  const reveal = createProgressiveStreamReveal({
    emit: text => emitted.push(text),
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
    minCharsPerFrame: 1,
    maxCharsPerFrame: 4,
    maxLagChars: 40,
  })

  const text = 'x'.repeat(120)
  reveal.pushCanonical(text)
  scheduler.runFrame()

  assert.ok((emitted.at(-1) || '').length >= 80)
  assert.ok((emitted.at(-1) || '').length < 120)
})

test('createProgressiveStreamReveal dispose cancels pending frames and stops emitting', () => {
  const scheduler = createManualScheduler()
  const emitted: string[] = []
  const reveal = createProgressiveStreamReveal({
    emit: text => emitted.push(text),
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  })

  reveal.pushCanonical('abcdef')
  assert.equal(scheduler.pendingCount(), 1)
  reveal.dispose()
  assert.equal(scheduler.pendingCount(), 0)

  scheduler.runFrame()
  assert.deepEqual(emitted, [])
})
