import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'
import type { OpenCodeServerHandle } from './types'

let client: OpencodeClient | null = null
let clientKey = ''

export function createJiucaiOpenCodeClient(handle: OpenCodeServerHandle, directoryOverride?: string): OpencodeClient {
  if (!handle.url || !handle.authorization) {
    throw new Error('OpenCode server 未连接。')
  }
  const directory = directoryOverride || handle.directory || ''
  const key = `${handle.url}|${handle.authorization}|${directory}`
  if (client && clientKey === key) return client
  client = createOpencodeClient({
    baseUrl: handle.url,
    directory: directory || undefined,
    headers: {
      Authorization: handle.authorization,
    },
  })
  clientKey = key
  return client
}

export function resetJiucaiOpenCodeClient(): void {
  client = null
  clientKey = ''
}
