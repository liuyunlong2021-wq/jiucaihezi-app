import { test } from 'node:test'
import assert from 'node:assert/strict'
import { queuePendingCanvasMedia, takePendingCanvasMedia } from '../pendingCanvasMedia'

function withFakeStorage(run: () => void) {
  const store = new Map<string, string>()
  const previous = (globalThis as any).localStorage
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  }
  try {
    run()
  } finally {
    ;(globalThis as any).localStorage = previous
  }
}

test('pending canvas media queue dedupes and takes per owner', () => {
  withFakeStorage(() => {
    queuePendingCanvasMedia({ owner: 'A', path: '.raw/jc-media/图片/a.png', kind: 'image', addedAt: 1 })
    queuePendingCanvasMedia({ owner: 'A', path: '.raw/jc-media/图片/a.png', kind: 'image', addedAt: 2 })
    queuePendingCanvasMedia({ owner: 'B', path: '.raw/jc-media/图片/b.png', kind: 'image', addedAt: 3 })

    const takenA = takePendingCanvasMedia('A')
    assert.equal(takenA.length, 1)
    assert.equal(takenA[0].addedAt, 2)
    assert.equal(takenA[0].kind, 'image')
    assert.equal(takePendingCanvasMedia('A').length, 0)
    assert.equal(takePendingCanvasMedia('B').length, 1)
  })
})

test('pending canvas media queue survives missing storage', () => {
  const previous = (globalThis as any).localStorage
  ;(globalThis as any).localStorage = undefined
  try {
    queuePendingCanvasMedia({ owner: 'A', path: 'x.png', kind: 'image', addedAt: 1 })
    assert.equal(takePendingCanvasMedia('A').length, 0)
  } finally {
    ;(globalThis as any).localStorage = previous
  }
})
