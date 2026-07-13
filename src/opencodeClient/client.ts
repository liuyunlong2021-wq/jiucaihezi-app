import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'
import type { OpenCodeServerHandle } from './types'
import { safeFetch } from '@/utils/httpClient'

const clients = new Map<string, OpencodeClient>()

function createClient(handle: OpenCodeServerHandle, directory: string): OpencodeClient {
  if (!handle.url || !handle.authorization) {
    throw new Error('OpenCode server 未连接。')
  }
  const key = `${handle.url}|${handle.authorization}|${directory}`
  const cached = clients.get(key)
  if (cached) return cached
  const client = createOpencodeClient({
    baseUrl: handle.url,
    directory: directory || undefined,
    headers: { Authorization: handle.authorization },
    fetch: safeFetch as typeof fetch,
  })
  clients.set(key, client)
  return client
}

export function createJiucaiOpenCodeClient(handle: OpenCodeServerHandle, directoryOverride?: string): OpencodeClient {
  const directory = directoryOverride || handle.directory || ''
  return createClient(handle, directory)
}

export function createJiucaiOpenCodeGlobalClient(handle: OpenCodeServerHandle): OpencodeClient {
  return createClient(handle, '')
}

export function resetJiucaiOpenCodeClient(): void {
  clients.clear()
}
