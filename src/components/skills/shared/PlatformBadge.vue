<script setup lang="ts">
import PlatformIcon from '@/components/skills/shared/PlatformIcon.vue'
import type { AgentWithStatus } from '@/types/skillsManage'

defineProps<{
  agent: AgentWithStatus
  count?: number
  active?: boolean
  shared?: boolean
}>()
</script>

<template>
  <span class="spb" :class="{ detected: agent.is_detected, active }">
    <PlatformIcon :agent="agent" />
    <span class="spb-name">{{ agent.display_name }}</span>
    <span v-if="shared" class="spb-shared">共享 / 自动包含</span>
    <span v-if="typeof count === 'number'" class="spb-count">{{ count }}</span>
  </span>
</template>

<style scoped>
.spb {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink3);
  font-size: 12px;
  font-weight: 850;
}
.spb.detected {
  color: var(--olive-dark);
  border-color: color-mix(in srgb, var(--olive) 42%, var(--border));
  background: color-mix(in srgb, var(--olive) 12%, var(--paper));
}
.spb.active {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--olive) 18%, transparent);
}
.spb-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spb-shared {
  flex: 0 0 auto;
  padding: 2px 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ink1) 7%, transparent);
  color: var(--ink3);
  font-size: 10px;
}
.spb-count {
  min-width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ink1) 8%, transparent);
  font-size: 11px;
}
</style>
