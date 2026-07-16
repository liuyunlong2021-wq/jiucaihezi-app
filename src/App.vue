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
  if (!isTauriRuntime()) {
    sessionStore.setCurrentProjectDir(directory)
    return
  }
  if (chatModeStore.mode === 'creative') {
    if (openCodeSyncStore.activeSessionId) {
      try {
        await openCodeSyncStore.abortActiveSession()
      } catch (error) {
        console.warn('[OpenCode sync] 停止创作模式前的会话失败', error)
      }
    }
    if (!isCurrent()) return
    openCodeSyncStore.disconnect()
    openCodeSyncStore.newDraft()
    return
  }
  const directoryChanged = directory !== openCodeSyncStore.activeDirectory
  if (directoryChanged && openCodeSyncStore.activeSessionId) {
    try {
      await openCodeSyncStore.abortActiveSession()
    } catch (error) {
      console.warn('[OpenCode sync] 停止旧目录会话失败', error)
    }
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
    try {
      await openCodeSyncStore.openSession(targetDirectory, restoredSessionId)
      if (!isCurrent()) return
    } catch (error) {
      if (!isCurrent()) return
      console.warn('[OpenCode sync] 恢复目录会话失败', error)
    }
  }
  if (!isCurrent()) return
  sessionStore.setCurrentProjectDir(targetDirectory)
}

function queueOpenCodeProjectSwitch(directory: string) {
  const generation = ++projectSwitchGeneration
  projectSwitch = projectSwitch.catch(() => {}).then(() => switchOpenCodeProject(directory, generation))
  return projectSwitch
}

onMounted(async () => {
  try {
    showSetupWizard.value = await shouldShowSetupWizard()
  } catch { /* ignore */ }
  if (disposed) return

  // P1: 新版本检测
  checkNewVersion().catch(() => {})
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

async function checkNewVersion() {
  try {
    const resp = await fetch(
      'https://api.github.com/repos/liuyunlong2021-wq/jiucaihezi-app/releases/latest',
      { signal: AbortSignal.timeout(5000) }
    )
    if (!resp.ok) return
    const release = await resp.json()
    const latestVer = (release.tag_name || '').replace(/^v/, '')
    const currentVer = ((window as any).__JC_APP_BUILD_ID__ || '')
      .match(/[\d.]+/)?.[0] || '0'

    if (latestVer > currentVer) {
      const ok = window.confirm(
        `韭菜盒子 ${release.tag_name} 已发布！\n\n` +
        `当前版本：v${currentVer}\n` +
        `最新版本：${release.tag_name}\n\n` +
        `点击「确定」前往下载页。`
      )
      if (ok) {
        window.open('https://api.jiucaihezi.studio/download/', '_blank')
      }
    }
  } catch { /* 静默失败 */ }
}
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
