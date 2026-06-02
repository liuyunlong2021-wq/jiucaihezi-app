export interface StreamCommitScheduler<T> {
  push(value: T): void
  flush(): void
  dispose(): void
}

function defaultSchedule(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
  return setTimeout(() => callback(Date.now()), 16) as unknown as number
}

function defaultCancelSchedule(id: number) {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
  else clearTimeout(id)
}

export function createStreamCommitScheduler<T>(options: {
  commit: (value: T) => void
  schedule?: (callback: FrameRequestCallback) => number
  cancelSchedule?: (id: number) => void
}): StreamCommitScheduler<T> {
  const schedule = options.schedule ?? defaultSchedule
  const cancelSchedule = options.cancelSchedule ?? defaultCancelSchedule
  let pendingValue: T | undefined
  let hasPendingValue = false
  let frameId: number | null = null
  let disposed = false

  function cancelPendingFrame() {
    if (frameId === null) return
    cancelSchedule(frameId)
    frameId = null
  }

  function commitPending() {
    frameId = null
    if (disposed || !hasPendingValue) return
    const value = pendingValue as T
    pendingValue = undefined
    hasPendingValue = false
    options.commit(value)
  }

  return {
    push(value: T) {
      if (disposed) return
      pendingValue = value
      hasPendingValue = true
      if (frameId !== null) return
      frameId = schedule(commitPending)
    },
    flush() {
      if (disposed) return
      cancelPendingFrame()
      if (!hasPendingValue) return
      const value = pendingValue as T
      pendingValue = undefined
      hasPendingValue = false
      options.commit(value)
    },
    dispose() {
      disposed = true
      cancelPendingFrame()
      pendingValue = undefined
      hasPendingValue = false
    },
  }
}
