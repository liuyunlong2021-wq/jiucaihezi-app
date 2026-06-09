export const OPENCODE_SESSION_CACHE_LIMIT = 40

export interface OpenCodeSessionCacheBucket<T> {
  get(sessionID: string): T | undefined
  set(sessionID: string, value: T): void
  delete(sessionID: string): void
  clear(): void
  has(sessionID: string): boolean
}

function pickSessionCacheEvictions(input: {
  seen: Set<string>
  keep: string
  limit: number
}): string[] {
  const stale: string[] = []
  if (input.seen.has(input.keep)) input.seen.delete(input.keep)
  input.seen.add(input.keep)
  for (const id of input.seen) {
    if (input.seen.size - stale.length <= input.limit) break
    if (id === input.keep) continue
    stale.push(id)
  }
  for (const id of stale) input.seen.delete(id)
  return stale
}

export function createOpenCodeSessionCacheBucket<T>(
  limit = OPENCODE_SESSION_CACHE_LIMIT,
): OpenCodeSessionCacheBucket<T> {
  const values = new Map<string, T>()
  const seen = new Set<string>()

  return {
    get(sessionID: string) {
      const value = values.get(sessionID)
      if (value !== undefined) {
        seen.delete(sessionID)
        seen.add(sessionID)
      }
      return value
    },
    set(sessionID: string, value: T) {
      if (!sessionID) return
      values.set(sessionID, value)
      for (const stale of pickSessionCacheEvictions({ seen, keep: sessionID, limit })) {
        values.delete(stale)
      }
    },
    delete(sessionID: string) {
      values.delete(sessionID)
      seen.delete(sessionID)
    },
    clear() {
      values.clear()
      seen.clear()
    },
    has(sessionID: string) {
      return values.has(sessionID)
    },
  }
}
