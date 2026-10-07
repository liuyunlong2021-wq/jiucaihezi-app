<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted } from 'vue'
import MemoryWorkbench from './components/memory/MemoryWorkbench.vue'
import GlobalSearch from './components/search/GlobalSearch.vue'
import LocalCapabilitySetup from './components/settings/LocalCapabilitySetup.vue'
import { shouldShowSetupWizard } from './utils/localCapabilities'
import { isTauriRuntime, isTauriMobileRuntime } from './utils/tauriEnv'
import { bindDesktopUpdater, desktopUpdateStatus, updaterAction } from './services/desktopUpdater'
import { startDesktopProjectDropDispatcher } from './services/desktopProjectDrop'
import { bindDesktopRemoteRuntime } from './services/desktopRemoteBridge'
import { createDesktopConversationHost, startDesktopConversationPublisher } from './services/desktopConversationRuntime'

const showSetupWizard = ref(false)
const dismissedUpdate = ref('')
const desktopRuntime = isTauriRuntime()
let stopDesktopProjectDrop: () => void = () => undefined
let stopDesktopConversationPublisher: () => void = () => undefined
let appUnmounted = false

onMounted(async () => {
  if (!desktopRuntime) return
  stopDesktopConversationPublisher = startDesktopConversationPublisher()
  void bindDesktopRemoteRuntime(createDesktopConversationHost()).catch(error => console.warn('[desktop-remote] Gateway listener failed:', error))
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
  if (!isTauriMobileRuntime()) {
    await bindDesktopUpdater()
    void updaterAction('check').catch(() => {})
  }
})

onBeforeUnmount(() => {
  appUnmounted = true
  stopDesktopProjectDrop()
  stopDesktopConversationPublisher()
})

</script>

<template>
  <MemoryWorkbench />
  <aside v-if="desktopRuntime && desktopUpdateStatus.phase === 'available' && dismissedUpdate !== desktopUpdateStatus.version" class="app-update-notice" role="status">
    <span>新版本 v{{ desktopUpdateStatus.version }} 已发布</span>
    <button @click="updaterAction('download')">下载更新</button>
    <button @click="dismissedUpdate = desktopUpdateStatus.version || ''">稍后</button>
  </aside>
  <aside v-if="desktopRuntime && desktopUpdateStatus.phase === 'ready' && dismissedUpdate !== `ready:${desktopUpdateStatus.version}`" class="app-update-notice" role="status">
    <span>更新已下载，安装前会保存工作内容</span>
    <button @click="updaterAction('install')">安装并重启</button>
    <button @click="dismissedUpdate = `ready:${desktopUpdateStatus.version}`">稍后</button>
  </aside>
  <div v-if="desktopRuntime && ['preparing', 'installing'].includes(desktopUpdateStatus.phase)" class="app-update-preparing" role="status">
    正在保存内容并准备升级，请稍候…
  </div>
  <GlobalSearch v-if="desktopRuntime" />
  <LocalCapabilitySetup
    v-if="showSetupWizard"
    mode="modal"
    @close="showSetupWizard = false"
  />
</template>

<style scoped>
.app-update-preparing { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; background: rgb(0 0 0 / 45%); color: white; font-size: 16px; }
.app-update-notice { position: fixed; bottom: 20px; right: 20px; z-index: 70; display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: var(--ink1); box-shadow: 0 4px 18px rgb(0 0 0 / 15%); font-size: 13px; }
.app-update-notice button { padding: 5px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--surface); color: inherit; cursor: pointer; }
</style>
