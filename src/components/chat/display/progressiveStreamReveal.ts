export interface ProgressiveStreamRevealOptions {
  emit: (visibleText: string) => void
  schedule?: (callback: FrameRequestCallback) => number
  cancelSchedule?: (id: number) => void
  now?: () => number
  minCharsPerFrame?: number
  maxCharsPerFrame?: number
  maxLagChars?: number
  hiddenTabFastForward?: boolean
}

export interface ProgressiveStreamReveal {
  pushCanonical(fullText: string): void
  flush(): void
  dispose(): void
}

const DEFAULT_MIN_CHARS_PER_FRAME = 1
const DEFAULT_MAX_CHARS_PER_FRAME = 8
const DEFAULT_MAX_LAG_CHARS = 600
const TARGET_TRAILING_LAG_RATIO = 0.25

function defaultSchedule(callback: FrameRequestCallback): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
  return setTimeout(() => callback(Date.now()), 16) as unknown as number
}

function defaultCancelSchedule(id: number) {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
  else clearTimeout(id)
}

function isDocumentHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function createProgressiveStreamReveal(options: ProgressiveStreamRevealOptions): ProgressiveStreamReveal {
  const schedule = options.schedule ?? defaultSchedule
  const cancelSchedule = options.cancelSchedule ?? defaultCancelSchedule
  const minCharsPerFrame = Math.max(1, options.minCharsPerFrame ?? DEFAULT_MIN_CHARS_PER_FRAME)
  const maxCharsPerFrame = Math.max(minCharsPerFrame, options.maxCharsPerFrame ?? DEFAULT_MAX_CHARS_PER_FRAME)
  const maxLagChars = Math.max(maxCharsPerFrame, options.maxLagChars ?? DEFAULT_MAX_LAG_CHARS)
  const hiddenTabFastForward = options.hiddenTabFastForward ?? true
  let canonical = ''
  let visible = ''
  let frameId: number | null = null
  let disposed = false

  function cancelPendingFrame() {
    if (frameId === null) return
    cancelSchedule(frameId)
    frameId = null
  }

  function emitIfChanged(nextVisible: string) {
    if (nextVisible === visible) return
    visible = nextVisible
    options.emit(visible)
  }

  function resolveStep(lag: number): number {
    if (lag >= maxLagChars) {
      const targetTrailingLag = Math.max(maxCharsPerFrame, Math.floor(maxLagChars * TARGET_TRAILING_LAG_RATIO))
      return Math.max(maxCharsPerFrame, lag - targetTrailingLag)
    }
    if (lag < 20) return Math.min(lag, maxCharsPerFrame)
    if (lag < 120) return Math.min(lag, Math.max(minCharsPerFrame, Math.min(maxCharsPerFrame, 6)))
    return Math.min(lag, maxCharsPerFrame)
  }

  function runFrame() {
    frameId = null
    if (disposed) return
    const lag = canonical.length - visible.length
    if (lag <= 0) return
    if (hiddenTabFastForward && isDocumentHidden()) {
      emitIfChanged(canonical)
      return
    }
    const step = resolveStep(lag)
    emitIfChanged(canonical.slice(0, visible.length + step))
    if (visible.length < canonical.length) scheduleFrame()
  }

  function scheduleFrame() {
    if (disposed || frameId !== null) return
    frameId = schedule(runFrame)
  }

  return {
    pushCanonical(fullText: string) {
      if (disposed) return
      canonical = fullText || ''
      if (canonical.length < visible.length || !canonical.startsWith(visible)) {
        emitIfChanged(canonical)
        return
      }
      if (canonical.length > visible.length) scheduleFrame()
    },
    flush() {
      if (disposed) return
      cancelPendingFrame()
      emitIfChanged(canonical)
    },
    dispose() {
      disposed = true
      cancelPendingFrame()
    },
  }
}
