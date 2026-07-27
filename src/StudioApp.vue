<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted, watch } from 'vue'
import WorkspaceLayout from './layouts/WorkspaceLayout.vue'
import GlobalSearch from './components/search/GlobalSearch.vue'
import LocalCapabilitySetup from './components/settings/LocalCapabilitySetup.vue'
import { shouldShowSetupWizard } from './utils/localCapabilities'
import { isTauriRuntime } from './utils/tauriEnv'
import { useAgentStore } from './stores/agentStore'
import { useOpenCodeSyncStore } from './stores/openCodeSyncStore'
import { useProjectStore } from './stores/projectStore'
import { useSessionStore } from './stores/sessionStore'
import { useChatModeStore } from './stores/chatModeStore'
import { projectStoredNewApiForOpenCode } from './opencodeClient/providerProjection'

const showSetupWizard = ref(false)
const agentStore = useAgentStore()
const openCodeSyncStore = useOpenCodeSyncStore()
const projectStore = useProjectStore()
const sessionStore = useSessionStore()
const chatModeStore = useChatModeStore()
let stopProjectWatch: (() => void) | undefined
let projectSwitch = Promise.resolve()
let projectSwitchGeneration = 0
let disposed = false

async function switchOpenCodeProject(directory: string, generation: number) {
  const isCurrent = () => !disposed && generation === projectSwitchGeneration
  if (!isCurrent()) return
  const directoryChanged = directory !== openCodeSyncStore.activeDirectory
  if (chatModeStore.mode === 'creative' || chatModeStore.mode === 'dao') {
    if (chatModeStore.mode === 'dao') sessionStore.setCurrentProjectDir('')
    if (openCodeSyncStore.activeSessionId) await openCodeSyncStore.abortActiveSession()
    if (!isCurrent()) return
    openCodeSyncStore.disconnect()
    openCodeSyncStore.newDraft()
    return
  }
  if (directoryChanged && openCodeSyncStore.activeSessionId) {
    await openCodeSyncStore.abortActiveSession()
    if (!isCurrent()) return
  }
  if (directoryChanged) openCodeSyncStore.newDraft()
  await Promise.resolve((window as any).__JC_API_KEY_READY__)
  if (!isCurrent()) return
  const config = await projectStoredNewApiForOpenCode({
    currentModel: agentStore.currentModel,
    models: agentStore.availableModels,
  })
  if (!isCurrent()) return
  const handle = await openCodeSyncStore.ensureConnected({
    config,
    directory: directory || undefined,
    isCurrent,
  })
  if (!isCurrent()) return
  const targetDirectory = String(directory || handle.directory || '').trim()
  const restoredSessionId = localStorage.getItem(`jc_active_session:${targetDirectory}`) || ''
  if (projectStore.projectDir.value === targetDirectory
    && !openCodeSyncStore.activeSessionId
    && restoredSessionId.startsWith('ses_')) {
    await openCodeSyncStore.openSession(targetDirectory, restoredSessionId)
    if (!isCurrent()) return
  }
  sessionStore.setCurrentProjectDir(targetDirectory)
}

function queueOpenCodeProjectSwitch(directory: string) {
  const generation = ++projectSwitchGeneration
  projectSwitch = projectSwitch
    .catch(() => {})
    .then(() => switchOpenCodeProject(directory, generation))
  return projectSwitch
}

onMounted(async () => {
  if (!isTauriRuntime()) return
  try {
    showSetupWizard.value = await shouldShowSetupWizard()
  } catch { /* ignore */ }
  void queueOpenCodeProjectSwitch(projectStore.projectDir.value).catch(error => {
    console.error('[OpenCode sync] 启动失败', error)
  })
  stopProjectWatch = watch([projectStore.projectDir, () => chatModeStore.mode], ([directory]) => {
    void queueOpenCodeProjectSwitch(directory).catch(error => {
      console.error('[OpenCode sync] 切换目录失败', error)
    })
  })
})

onBeforeUnmount(() => {
  disposed = true
  projectSwitchGeneration++
  stopProjectWatch?.()
  openCodeSyncStore.disconnect()
})
</script>

<template>
  <WorkspaceLayout />
  <GlobalSearch />
  <LocalCapabilitySetup
    v-if="showSetupWizard"
    mode="modal"
    @close="showSetupWizard = false"
  />
</template>
