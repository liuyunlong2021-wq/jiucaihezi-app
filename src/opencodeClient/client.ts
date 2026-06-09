import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'
import type { OpenCodeServerHandle } from './types'

let client: OpencodeClient | null = null
let clientKey = ''

export function createJiucaiOpenCodeClient(handle: OpenCodeServerHandle): OpencodeClient {
  if (!handle.url || !handle.authorization) {
    throw new Error('OpenCode server 未连接。')
  }
  const key = `${handle.url}|${handle.authorization}|${handle.directory || ''}`
  if (client && clientKey === key) return client
  client = createOpencodeClient({
    baseUrl: handle.url,
    directory: handle.directory,
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
