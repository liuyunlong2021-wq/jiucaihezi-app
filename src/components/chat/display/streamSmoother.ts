import { createProgressiveStreamReveal, type ProgressiveStreamRevealOptions } from './progressiveStreamReveal'

export interface StreamSmootherOptions {
  intervalMs?: number
  now?: () => number
  emit: (text: string) => void
}

export interface StreamSmoother {
  push(text: string): void
  flush(): void
  dispose?: () => void
}

const DEFAULT_INTERVAL_MS = 28
const IMMEDIATE_SUFFIX_RE = /[\n。！？!?；;：:]$/

export function createStreamSmoother(options: StreamSmootherOptions): StreamSmoother {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS
  const now = options.now ?? (() => Date.now())
  let latest = ''
  let lastEmitted = ''
  let lastEmitAt = Number.NEGATIVE_INFINITY

  function emitIfChanged(text: string) {
    if (text === lastEmitted) return
    lastEmitted = text
    lastEmitAt = now()
    options.emit(text)
  }

  return {
    push(text: string) {
      latest = text
      const current = now()
      if (lastEmitted === '') {
        emitIfChanged(latest)
        return
      }
      if (IMMEDIATE_SUFFIX_RE.test(latest) || current - lastEmitAt >= intervalMs) {
        emitIfChanged(latest)
      }
    },
    flush() {
      emitIfChanged(latest)
    },
  }
}

export interface ProgressiveStreamSmootherOptions extends StreamSmootherOptions {
  schedule?: ProgressiveStreamRevealOptions['schedule']
  cancelSchedule?: ProgressiveStreamRevealOptions['cancelSchedule']
  minCharsPerFrame?: number
  maxCharsPerFrame?: number
  maxLagChars?: number
  hiddenTabFastForward?: boolean
}

export function createProgressiveStreamSmoother(options: ProgressiveStreamSmootherOptions): StreamSmoother {
  const reveal = createProgressiveStreamReveal({
    emit: options.emit,
    schedule: options.schedule,
    cancelSchedule: options.cancelSchedule,
    now: options.now,
    minCharsPerFrame: options.minCharsPerFrame,
    maxCharsPerFrame: options.maxCharsPerFrame,
    maxLagChars: options.maxLagChars,
    hiddenTabFastForward: options.hiddenTabFastForward,
  })

  return {
    push(text: string) {
      reveal.pushCanonical(text)
    },
    flush() {
      reveal.flush()
    },
    dispose() {
      reveal.dispose()
    },
  }
}
