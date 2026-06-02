export interface ConversationExperienceTrace {
  messageId: string
  runId?: string
  firstStatusAt?: number
  firstDeltaAt?: number
  firstVisibleCharAt?: number
  totalDeltas: number
  largeDeltaCount: number
  maxDeltaChars: number
  visibleCommits: number
  markdownRenderMode: 'streaming-light' | 'full'
  autoScrollSuppressed: boolean
  toolStatusTransitions: Array<'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'>
}

export interface ConversationExperienceTraceRecorder {
  markStatus(): void
  markDelta(chars: number): void
  markVisibleCommit(): void
  markMarkdownRenderMode(mode: ConversationExperienceTrace['markdownRenderMode']): void
  markAutoScrollSuppressed(): void
  markToolStatus(status: ConversationExperienceTrace['toolStatusTransitions'][number]): void
  snapshot(): ConversationExperienceTrace
}

export function createConversationExperienceTrace(options: {
  messageId: string
  runId?: string
  now?: () => number
}): ConversationExperienceTraceRecorder {
  const now = options.now ?? (() => Date.now())
  const trace: ConversationExperienceTrace = {
    messageId: options.messageId,
    runId: options.runId,
    totalDeltas: 0,
    largeDeltaCount: 0,
    maxDeltaChars: 0,
    visibleCommits: 0,
    markdownRenderMode: 'full',
    autoScrollSuppressed: false,
    toolStatusTransitions: [],
  }

  return {
    markStatus() {
      trace.firstStatusAt ??= now()
    },
    markDelta(chars: number) {
      trace.firstDeltaAt ??= now()
      trace.totalDeltas += 1
      trace.maxDeltaChars = Math.max(trace.maxDeltaChars, chars)
      if (chars >= 600) trace.largeDeltaCount += 1
    },
    markVisibleCommit() {
      trace.firstVisibleCharAt ??= now()
      trace.visibleCommits += 1
    },
    markMarkdownRenderMode(mode) {
      trace.markdownRenderMode = mode
    },
    markAutoScrollSuppressed() {
      trace.autoScrollSuppressed = true
    },
    markToolStatus(status) {
      trace.toolStatusTransitions.push(status)
    },
    snapshot() {
      return {
        ...trace,
        toolStatusTransitions: [...trace.toolStatusTransitions],
      }
    },
  }
}
