import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type ChatMode = 'plan' | 'build' | 'creative'

function getStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    const storage = globalThis.localStorage
    if (typeof storage?.getItem !== 'function' || typeof storage?.setItem !== 'function') return null
    return storage
  } catch {
    return null
  }
}

function loadMode(): ChatMode {
  const saved = getStorage()?.getItem('jc_agent_mode')
  if (saved === 'direct') return 'plan'
  if (saved === 'creative' || saved === 'plan' || saved === 'build') return saved
  return 'build'
}

export const useChatModeStore = defineStore('chatMode', () => {
  const mode = ref<ChatMode>(loadMode())
  const isCreative = computed(() => mode.value === 'creative')

  function setMode(next: ChatMode) {
    mode.value = next
    getStorage()?.setItem('jc_agent_mode', next)
  }

  return { mode, isCreative, setMode }
})
