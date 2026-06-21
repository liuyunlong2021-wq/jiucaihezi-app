<script setup lang="ts">
import { computed } from 'vue'
import type { AgentWithStatus } from '@/types/skillsManage'

const props = defineProps<{
  agent: AgentWithStatus
}>()

const icon = computed(() => {
  if (props.agent.icon_name) return props.agent.icon_name
  if (props.agent.category === 'lobster') return 'account_tree'
  if (props.agent.category === 'custom') return 'extension'
  if (props.agent.id.includes('claude')) return 'terminal'
  if (props.agent.id.includes('codex')) return 'code'
  if (props.agent.id.includes('obsidian')) return 'note_stack'
  return 'hub'
})
</script>

<template>
  <span class="platform-icon" :class="`category-${agent.category || 'coding'}`">
    <JcIcon :name="icon" />
  </span>
</template>

<style scoped>
.platform-icon {
  width: 26px;
  height: 26px;
  display: inline-grid;
  place-items: center;
  border-radius: 8px;
  background: color-mix(in srgb, var(--olive) 12%, var(--paper));
  color: var(--olive-dark);
  flex: 0 0 auto;
}
.platform-icon .mso { font-size: 16px; }
.category-lobster {
  background: color-mix(in srgb, var(--ink1) 7%, var(--paper));
  color: var(--ink2);
}
.category-custom {
  background: color-mix(in srgb, var(--jc-accent) 10%, var(--paper));
  color: var(--jc-accent);
}
</style>
