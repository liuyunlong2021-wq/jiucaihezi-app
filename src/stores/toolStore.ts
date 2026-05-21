import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  applyToolInvocation,
  type ToolActivityState,
  type ToolInvocationEvent,
} from '@/utils/toolActivity'
import { readLocalToolsEnabled, writeLocalToolsEnabled } from '@/utils/localToolsPreference'
import { TOOL_CARDS } from '@/utils/toolRegistry'

export const useToolStore = defineStore('tools', () => {
  const activity = ref<ToolActivityState>({})
  const localToolsEnabled = ref(readLocalToolsEnabled())

  const cards = computed(() => TOOL_CARDS.map(card => ({
    ...card,
    activity: activity.value[card.id] || null,
  })))

  const activeTools = computed(() =>
    cards.value.filter(card => card.activity?.active)
  )

  function recordInvocation(event: ToolInvocationEvent) {
    activity.value = applyToolInvocation(activity.value, event)
  }

  function markRunning(toolName: string, callId: string, args?: Record<string, unknown>) {
    recordInvocation({ toolName, callId, args, status: 'running' })
  }

  function markDone(toolName: string, callId: string, args?: Record<string, unknown>) {
    recordInvocation({ toolName, callId, args, status: 'done' })
  }

  function markError(toolName: string, callId: string, error?: string, args?: Record<string, unknown>) {
    recordInvocation({ toolName, callId, args, status: 'error', error })
  }

  function setLocalToolsEnabled(enabled: boolean) {
    localToolsEnabled.value = enabled
    writeLocalToolsEnabled(enabled)
  }

  function toggleLocalTools() {
    setLocalToolsEnabled(!localToolsEnabled.value)
  }

  return {
    activity,
    cards,
    activeTools,
    localToolsEnabled,
    recordInvocation,
    markRunning,
    markDone,
    markError,
    setLocalToolsEnabled,
    toggleLocalTools,
  }
})
