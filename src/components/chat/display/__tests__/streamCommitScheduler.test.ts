import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStreamCommitScheduler } from '../streamCommitScheduler'

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

test('createStreamCommitScheduler commits only the latest value once per frame', () => {
  const scheduler = createManualScheduler()
  const commits: string[] = []
  const commitScheduler = createStreamCommitScheduler<string>({
    commit: value => commits.push(value),
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  })

  commitScheduler.push('a')
  commitScheduler.push('ab')
  commitScheduler.push('abc')

  assert.deepEqual(commits, [])
  assert.equal(scheduler.pendingCount(), 1)

  scheduler.runFrame()
  assert.deepEqual(commits, ['abc'])
})

test('createStreamCommitScheduler flushes pending value immediately', () => {
  const scheduler = createManualScheduler()
  const commits: string[] = []
  const commitScheduler = createStreamCommitScheduler<string>({
    commit: value => commits.push(value),
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  })

  commitScheduler.push('latest')
  commitScheduler.flush()

  assert.deepEqual(commits, ['latest'])
  assert.equal(scheduler.pendingCount(), 0)
})

test('createStreamCommitScheduler dispose cancels pending frame', () => {
  const scheduler = createManualScheduler()
  const commits: string[] = []
  const commitScheduler = createStreamCommitScheduler<string>({
    commit: value => commits.push(value),
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancel,
  })

  commitScheduler.push('discard')
  commitScheduler.dispose()
  scheduler.runFrame()

  assert.deepEqual(commits, [])
})
