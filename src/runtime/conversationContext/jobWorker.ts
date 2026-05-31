import type { ConversationContextStorage } from './storage'
import type { ConversationMemoryIndexDriver } from './memoryIndex'
import { sanitizeSensitiveText } from '@/utils/sanitizeSensitiveText'

export interface RunConversationMemoryJobBatchInput {
  storage: ConversationContextStorage
  driver: ConversationMemoryIndexDriver
  now: number
  maxJobs: number
}

export interface RunConversationMemoryJobBatchResult {
  done: number
  failed: number
}

export interface ConversationMemoryWorker {
  start(): void
  stop(): void
  tick(now?: number): Promise<RunConversationMemoryJobBatchResult>
}

export interface CreateConversationMemoryWorkerInput extends RunConversationMemoryJobBatchInput {
  intervalMs: number
}

export function createConversationMemoryWorker(input: CreateConversationMemoryWorkerInput): ConversationMemoryWorker {
  let timer: ReturnType<typeof setInterval> | null = null
  let running = false
  const tick = async (now = Date.now()) => {
    if (running) return { done: 0, failed: 0 }
    running = true
    try {
      return await runConversationMemoryJobBatch({ ...input, now })
    } finally {
      running = false
    }
  }
  return {
    start() {
      if (timer) return
      void tick()
      timer = setInterval(() => {
        void tick()
      }, input.intervalMs)
    },
    stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
    },
    tick,
  }
}

export async function runConversationMemoryJobBatch(
  input: RunConversationMemoryJobBatchInput,
): Promise<RunConversationMemoryJobBatchResult> {
  const jobs = await input.storage.listMemoryJobsByStatus('pending', input.now)
  let done = 0
  let failed = 0
  for (const job of jobs.slice(0, input.maxJobs)) {
    const running = { ...job, status: 'running' as const, updatedAt: input.now }
    await input.storage.saveMemoryJob(running)
    try {
      const sourceText = sanitizeSensitiveText(
        await loadJobSourceText(input.storage, job.sessionId, job.sourceMessageIds),
      )
      if (!sourceText) {
        await input.storage.saveDirtySegment({
          id: `dirty_${job.sessionId}_${job.runtimeSegmentId}_missing_source_chunks`,
          sessionId: job.sessionId,
          runtimeSegmentId: job.runtimeSegmentId,
          reason: 'index_failed',
          severity: 'high',
          estimatedTokenImpact: 0,
          dirtySince: input.now,
          priority: 90,
          status: 'pending',
          metadata: {
            source: 'jobWorker',
            jobId: job.id,
            sourceMessageIds: job.sourceMessageIds,
          },
        })
        await input.storage.saveMemoryJob({
          ...running,
          status: 'repair_required',
          attempts: job.attempts + 1,
          lastError: 'missing source chunks',
          updatedAt: input.now,
        })
        failed += 1
        continue
      }
      await input.driver.indexTurn({
        sessionId: job.sessionId,
        runtimeSegmentId: job.runtimeSegmentId,
        runId: job.runId,
        sourceMessageIds: job.sourceMessageIds,
        text: sourceText,
      })
      await markDirtySegmentsDone(input.storage, job.sessionId, job.runtimeSegmentId, input.now)
      await input.storage.saveMemoryJob({ ...running, status: 'done', updatedAt: input.now })
      done += 1
    } catch (error) {
      const attempts = job.attempts + 1
      await input.storage.saveMemoryJob({
        ...running,
        status: attempts >= 5 ? 'failed' : 'pending',
        attempts,
        nextRunAt: input.now + Math.min(60000, 1000 * 2 ** attempts),
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: input.now,
      })
      failed += 1
    }
  }
  return { done, failed }
}

async function loadJobSourceText(
  storage: ConversationContextStorage,
  sessionId: string,
  sourceMessageIds: string[],
): Promise<string> {
  const parts: string[] = []
  for (const messageId of sourceMessageIds) {
    const chunks = await storage.listMessageChunksByMessageId(messageId)
    for (const chunk of chunks.filter(item => item.sessionId === sessionId)) {
      parts.push(chunk.text)
    }
  }
  return parts.join('\n\n').trim()
}

async function markDirtySegmentsDone(
  storage: ConversationContextStorage,
  sessionId: string,
  runtimeSegmentId: string,
  now: number,
): Promise<void> {
  const dirtySegments = await storage.listDirtySegments(sessionId)
  for (const segment of dirtySegments) {
    if (segment.runtimeSegmentId !== runtimeSegmentId || segment.status === 'done') continue
    await storage.saveDirtySegment({
      ...segment,
      status: 'done',
      metadata: {
        ...segment.metadata,
        repairedAt: now,
      },
    })
  }
}
