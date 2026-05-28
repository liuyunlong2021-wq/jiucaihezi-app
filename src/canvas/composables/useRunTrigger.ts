/**
 * useRunTrigger — Vue 版，对齐 T8 hooks/useRunTrigger.ts
 */
import { watch, ref, onUnmounted } from 'vue'
import { useCanvasRunBusStore } from '@/stores/canvasRunBusStore'

export function useRunTrigger(nodeId: string, runFn: () => Promise<void> | void) {
  const runBus = useCanvasRunBusStore()
  const runFnRef = ref(runFn)
  runFnRef.value = runFn
  const startedRef = ref(false)
  let cancelled = false

  watch(
    () => runBus.currentRunId === nodeId || runBus.runningIds.includes(nodeId),
    async (isMyTurn) => {
      if (!isMyTurn) { startedRef.value = false; return }
      if (startedRef.value) return
      startedRef.value = true
      cancelled = false
      try {
        await runFnRef.value()
        if (!cancelled) runBus.markDone(nodeId, true)
      } catch (e: any) {
        if (!cancelled) runBus.markDone(nodeId, false, e?.message)
      }
    },
    { immediate: true }
  )

  onUnmounted(() => { cancelled = true })
}
