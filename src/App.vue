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
