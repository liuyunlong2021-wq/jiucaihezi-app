<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted } from 'vue'
import MemoryWorkbench from './components/memory/MemoryWorkbench.vue'
import GlobalSearch from './components/search/GlobalSearch.vue'
import LocalCapabilitySetup from './components/settings/LocalCapabilitySetup.vue'
import { shouldShowSetupWizard } from './utils/localCapabilities'
import { isTauriRuntime } from './utils/tauriEnv'
import { startDesktopProjectDropDispatcher } from './services/desktopProjectDrop'

const showSetupWizard = ref(false)
const desktopRuntime = isTauriRuntime()
let stopDesktopProjectDrop: () => void = () => undefined
let appUnmounted = false

onMounted(async () => {
  if (!desktopRuntime) return
  try {
    const stop = await startDesktopProjectDropDispatcher()
    if (appUnmounted) stop()
    else stopDesktopProjectDrop = stop
  } catch (error) {
    console.warn('[desktop-drop] failed to start:', error)
  }
  try {
    showSetupWizard.value = await shouldShowSetupWizard()
  } catch { /* ignore */ }
  checkNewVersion().catch(() => {})
})

onBeforeUnmount(() => {
  appUnmounted = true
  stopDesktopProjectDrop()
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
  <MemoryWorkbench />
  <GlobalSearch v-if="desktopRuntime" />
  <LocalCapabilitySetup
    v-if="showSetupWizard"
    mode="modal"
    @close="showSetupWizard = false"
  />
</template>
