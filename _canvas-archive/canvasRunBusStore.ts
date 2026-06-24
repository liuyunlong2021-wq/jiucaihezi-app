/* canvasRunBusStore — Pinia 版，对齐 T8 stores/runBus.ts */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface LastDoneInfo { id: string; ok: boolean; ts: number; error?: string }
export type RunMode = 'idle' | 'single' | 'batch'

export const useCanvasRunBusStore = defineStore('canvasRunBus', () => {
  const currentRunId = ref<string | null>(null)
  const runningIds = ref<string[]>([])
  const lastDone = ref<LastDoneInfo | null>(null)
  const mode = ref<RunMode>('idle')
  const batchTotal = ref(0)
  const batchDoneCount = ref(0)

  function triggerRun(id: string, m: 'single' | 'batch' = 'single') {
    currentRunId.value = id; if (!runningIds.value.includes(id)) runningIds.value.push(id); if (mode.value !== 'batch') mode.value = m
  }
  function triggerRunMany(ids: string[], m: 'single' | 'batch' = 'batch') {
    const merged = Array.from(new Set([...runningIds.value, ...ids])); runningIds.value = merged
    if (ids.length > 0) currentRunId.value = ids[0]; if (mode.value !== 'batch') mode.value = m
  }
  function markDone(id: string, ok: boolean, error?: string) {
    lastDone.value = { id, ok, ts: Date.now(), error }
    if (currentRunId.value === id) currentRunId.value = null
    runningIds.value = runningIds.value.filter(x => x !== id)
    if (mode.value !== 'batch') mode.value = runningIds.value.length > 0 ? mode.value : 'idle'
  }
  function cancelAll() { currentRunId.value = null; runningIds.value = []; mode.value = 'idle'; batchTotal.value = 0; batchDoneCount.value = 0 }
  function setBatchProgress(total: number, done: number) { batchTotal.value = total; batchDoneCount.value = done; mode.value = total > 0 ? 'batch' : 'idle' }

  return { currentRunId, runningIds, lastDone, mode, batchTotal, batchDoneCount, triggerRun, triggerRunMany, markDone, cancelAll, setBatchProgress }
})
