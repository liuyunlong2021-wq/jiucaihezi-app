<script setup lang="ts">
import SkillDetailPanel from '@/components/skills/SkillDetailPanel.vue'
import type { AgentWithStatus, SkillForAgent } from '@/types/skillsManage'

defineProps<{
  agent: AgentWithStatus | null
  skill: SkillForAgent | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<template>
  <div v-if="agent && skill" class="drawer-backdrop" @click.self="emit('close')">
    <aside class="drawer">
      <header class="drawer-head">
        <div>
          <strong>{{ agent.display_name }}</strong>
          <span>{{ skill.name }}</span>
        </div>
        <button type="button" title="关闭" @click="emit('close')">
          <JcIcon name="close" />
        </button>
      </header>
      <SkillDetailPanel class="drawer-detail" @back="emit('close')" />
    </aside>
  </div>
</template>

<style scoped>
.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  justify-content: flex-end;
  background: color-mix(in srgb, var(--ink1) 28%, transparent);
}
.drawer {
  width: min(980px, 86vw);
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border-left: 1px solid var(--border);
  box-shadow: -18px 0 40px color-mix(in srgb, var(--ink1) 18%, transparent);
}
.drawer-head {
  flex: 0 0 auto;
  min-height: 46px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--paper);
}
.drawer-head div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.drawer-head strong { color: var(--ink1); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drawer-head span:not(.mso) { color: var(--ink3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drawer-head button {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  cursor: pointer;
}
.drawer-detail { flex: 1; min-height: 0; }
@media (max-width: 760px) {
  .drawer { width: 100vw; }
}
</style>
