import { shallowRef } from 'vue'
import { isTauriMobileRuntime, isTauriRuntime } from '@/utils/tauriEnv'
import { prepareUpdateParticipants, type UpdateParticipant } from './desktopUpdatePreparation'

export interface DesktopUpdateStatus {
  phase: string
  currentVersion: string
  version?: string | null
  notes?: string | null
  error?: string | null
  message?: string | null
  downloaded: number
  total?: number | null
}

export const desktopUpdateStatus = shallowRef<DesktopUpdateStatus>({ phase: 'idle', currentVersion: '', downloaded: 0 })
export const updateWaiting = shallowRef(false)
const participants = new Set<UpdateParticipant>()
let bound: Promise<void> | undefined
let waitTimer: ReturnType<typeof setInterval> | undefined
const desktop = () => isTauriRuntime() && !isTauriMobileRuntime()

export function registerUpdateParticipant(participant: UpdateParticipant) {
  participants.add(participant)
  return () => { participants.delete(participant) }
}

export async function updateDraftKey(owner: string) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return `jc:update-resume:${getCurrentWindow().label}:${owner}`
}

export async function beginDesktopUpdateTask(): Promise<() => Promise<void>> {
  if (!desktop()) return async () => {}
  const { invoke } = await import('@tauri-apps/api/core')
  const id = await invoke<string>('desktop_update_task_begin')
  return async () => {
    if (id) await invoke('desktop_update_task_end', { id }).catch(cause => console.warn('[updater] task release failed', cause))
  }
}

export async function updaterAction(action: 'check' | 'download' | 'install') {
  const { invoke } = await import('@tauri-apps/api/core')
  let error: string | undefined
  try { await invoke(`desktop_update_${action}`) }
  catch (cause) { error = String(cause) }
  finally {
    const snapshot = await invoke<DesktopUpdateStatus>('desktop_update_status')
    desktopUpdateStatus.value = error ? { ...snapshot, error } : snapshot
  }
}

export async function waitForUpdateInstall(waiting: boolean) {
  const { emit } = await import('@tauri-apps/api/event')
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await emit('desktop-update:waiting', waiting ? { version: desktopUpdateStatus.value.version, owner: getCurrentWindow().label } : null)
}

export function bindDesktopUpdater(): Promise<void> {
  if (!desktop()) return Promise.resolve()
  bound ??= (async () => {
    const [{ listen }, { invoke }, { getCurrentWindow }] = await Promise.all([import('@tauri-apps/api/event'), import('@tauri-apps/api/core'), import('@tauri-apps/api/window')])
    await listen<DesktopUpdateStatus>('desktop-update:status', event => {
      const previousVersion = desktopUpdateStatus.value.version
      desktopUpdateStatus.value = event.payload
      if (event.payload.phase === 'installing' || previousVersion !== event.payload.version) {
        updateWaiting.value = false
        if (waitTimer) clearInterval(waitTimer)
      }
    })
    await listen<{ version: string; owner: string } | null>('desktop-update:waiting', event => {
      updateWaiting.value = event.payload?.version === desktopUpdateStatus.value.version && Boolean(event.payload)
      if (waitTimer) clearInterval(waitTimer)
      if (updateWaiting.value && event.payload?.owner === getCurrentWindow().label) waitTimer = setInterval(() => {
        if (updateWaiting.value && desktopUpdateStatus.value.phase === 'ready') void updaterAction('install').then(() => {
          const error = desktopUpdateStatus.value.error
          if (error && !/任务.*运行|任务.*恢复|正在处理升级|操作正在进行/.test(error)) void waitForUpdateInstall(false)
        }).catch(() => { void waitForUpdateInstall(false) })
      }, 5000)
    })
    await listen<{ id: string; stage: 'save' | 'close' }>('desktop-update:prepare', async event => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      let error: string | null = null
      try { await prepareUpdateParticipants([...participants], event.payload.stage) }
      catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
      await invoke('desktop_update_ack', { id: event.payload.id, error })
    })
    desktopUpdateStatus.value = await invoke<DesktopUpdateStatus>('desktop_update_status')
  })().catch(cause => {
    desktopUpdateStatus.value = { ...desktopUpdateStatus.value, phase: 'unavailable', error: String(cause) }
    bound = undefined
  })
  return bound
}
