import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '@/utils/tauriEnv'
import type { OpenCodeServerHandle } from './types'

export interface EnsureOpenCodeServerInput {
  config: unknown
  port?: number
  hostname?: string
  timeoutMs?: number
  directory?: string
}

export async function getOpenCodeServerStatus(): Promise<OpenCodeServerHandle> {
  if (!isTauriRuntime()) return { running: false }
  return await invoke<OpenCodeServerHandle>('opencode_status')
}

export async function ensureOpenCodeServer(input: EnsureOpenCodeServerInput): Promise<OpenCodeServerHandle> {
  if (!isTauriRuntime()) {
    throw new Error('OpenCode 内核只支持桌面版运行。')
  }
  const handle = await invoke<OpenCodeServerHandle>('opencode_ensure_server', { input })
  if (!handle.running || !handle.url || !handle.authorization) {
    throw new Error('OpenCode server 已启动但连接信息不完整。')
  }
  return handle
}

export async function stopOpenCodeServer(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('opencode_stop')
}
