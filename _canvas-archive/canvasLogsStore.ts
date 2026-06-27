/* canvasLogsStore — Pinia 版，对齐 T8 stores/logs.ts */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'debug'
export interface LogEntry { id: string; ts: number; level: LogLevel; source?: string; message: string }
const MAX_LOGS = 500

export const useCanvasLogsStore = defineStore('canvasLogs', () => {
  const entries = ref<LogEntry[]>([])
  const open = ref(false)
  const unread = ref(0)

  function log(level: LogLevel, message: string, source?: string) {
    const entry: LogEntry = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, ts: Date.now(), level, source, message }
    entries.value.push(entry)
    if (entries.value.length > MAX_LOGS) entries.value.splice(0, entries.value.length - MAX_LOGS)
    if (!open.value) unread.value = Math.min(99, unread.value + 1)
  }
  function clear() { entries.value = []; unread.value = 0 }
  function setOpen(v: boolean) { open.value = v; if (v) unread.value = 0 }
  function toggleOpen() { setOpen(!open.value) }

  return { entries, open, unread, log, clear, setOpen, toggleOpen }
})

export const canvasLogBus = {
  info: (msg: string, source?: string) => useCanvasLogsStore().log('info', msg, source),
  success: (msg: string, source?: string) => useCanvasLogsStore().log('success', msg, source),
  warn: (msg: string, source?: string) => useCanvasLogsStore().log('warn', msg, source),
  error: (msg: string, source?: string) => useCanvasLogsStore().log('error', msg, source),
  debug: (msg: string, source?: string) => useCanvasLogsStore().log('debug', msg, source),
}
