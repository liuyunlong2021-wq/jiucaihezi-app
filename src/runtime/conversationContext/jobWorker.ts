import type { ConversationContextStorage } from './storage'
import type { ConversationMemoryIndexDriver } from './memoryIndex'

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
      await input.driver.indexTurn({
        sessionId: job.sessionId,
        runtimeSegmentId: job.runtimeSegmentId,
        runId: job.runId,
        sourceMessageIds: job.sourceMessageIds,
        text: job.sourceMessageIds.join('\n'),
      })
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
