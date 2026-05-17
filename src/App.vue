<script setup lang="ts">
import WorkspaceLayout from './layouts/WorkspaceLayout.vue'
import { onMounted } from 'vue'
import { runAutoMigrations } from './utils/migration'

onMounted(() => {
  runAutoMigrations()
})
</script>

<template>
  <WorkspaceLayout />
</template>
