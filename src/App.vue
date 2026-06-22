<script setup lang="ts">
import { ref, onMounted } from 'vue'
import WorkspaceLayout from './layouts/WorkspaceLayout.vue'
import GlobalSearch from './components/search/GlobalSearch.vue'
import LocalCapabilitySetup from './components/settings/LocalCapabilitySetup.vue'
import { shouldShowSetupWizard } from './utils/localCapabilities'

const showSetupWizard = ref(false)

onMounted(async () => {
  try {
    showSetupWizard.value = await shouldShowSetupWizard()
  } catch { /* ignore */ }

  // P1: 新版本检测
  checkNewVersion().catch(() => {})
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
        `点击「确定」前往 GitHub 下载。`
      )
      if (ok) {
        window.open(release.html_url || 'https://github.com/liuyunlong2021-wq/jiucaihezi-app/releases/latest', '_blank')
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
