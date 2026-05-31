import { createConversationContextStorage } from './storage'
import { createLocalFallbackIndexDriver } from './localFallbackIndexDriver'
import { createConversationMemoryWorker } from './jobWorker'

let worker: ReturnType<typeof createConversationMemoryWorker> | null = null

export async function startConversationContextWorkers(): Promise<void> {
  if (worker) return
  const storage = createConversationContextStorage()
  const driver = createLocalFallbackIndexDriver({ storage })
  worker = createConversationMemoryWorker({
    storage,
    driver,
    now: Date.now(),
    maxJobs: 10,
    intervalMs: 5000,
  })
  worker.start()
}

export function stopConversationContextWorkers(): void {
  worker?.stop()
  worker = null
}
