import { createConversationContextStorage } from './storage'
import { createLocalFallbackIndexDriver } from './localFallbackIndexDriver'
import { runConversationMemoryJobBatch } from './jobWorker'

export async function startConversationContextWorkers(): Promise<void> {
  const storage = createConversationContextStorage()
  const driver = createLocalFallbackIndexDriver({ storage })
  await runConversationMemoryJobBatch({
    storage,
    driver,
    now: Date.now(),
    maxJobs: 5,
  })
}
