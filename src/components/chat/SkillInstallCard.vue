<script setup lang="ts">
import type { SkillInstallPlan } from '@/runtime/memory/skillInstall'

const props = defineProps<{
  plan: SkillInstallPlan
  installed?: boolean
  updating?: boolean
  status?: 'ready' | 'installing' | 'installed' | 'failed'
  error?: string
}>()

const emit = defineEmits<{
  (event: 'approve'): void
  (event: 'revise'): void
}>()
</script>

<template>
  <section class="skill-install-card" aria-label="Skill 安装确认">
    <header>
      <div>
        <strong>{{ plan.name }}</strong>
        <span>用户 Skill</span>
      </div>
      <JcIcon name="extension" aria-hidden="true" />
    </header>
    <p>{{ plan.description }}</p>
    <div v-if="plan.triggers.length" class="skill-install-triggers">
      <span v-for="trigger in plan.triggers" :key="trigger">{{ trigger }}</span>
    </div>
    <p v-if="error" class="skill-install-error">{{ error }}</p>
    <div class="skill-install-actions">
      <button type="button" :disabled="status === 'installing'" @click="emit('revise')">
        继续修改
      </button>
      <button
        type="button"
        class="primary"
        :disabled="installed || status === 'installing' || status === 'installed'"
        @click="emit('approve')"
      >
        {{ status === 'installing' ? '正在安装' : installed || status === 'installed' ? '已安装' : updating ? '更新我的 Skill' : '安装到我的 Skill' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.skill-install-card { margin-top: 10px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--olive) 28%, transparent); border-radius: 8px; background: color-mix(in srgb, var(--olive) 6%, transparent); }
.skill-install-card header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.skill-install-card header strong { display: block; color: var(--ink1); font-size: 13px; }
.skill-install-card header span { color: var(--ink3); font-size: 11px; }
.skill-install-card > p { margin: 8px 0 0; color: var(--ink2); font-size: 12px; line-height: 1.5; }
.skill-install-triggers { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
.skill-install-triggers span { padding: 2px 6px; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); color: var(--ink3); font-size: 11px; }
.skill-install-card .skill-install-error { color: var(--red, #b42318); }
.skill-install-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.skill-install-actions button { min-height: 30px; padding: 5px 10px; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); color: var(--ink2); font: inherit; font-size: 12px; cursor: pointer; }
.skill-install-actions button:disabled { cursor: default; opacity: 0.6; }
.skill-install-actions .primary { border-color: var(--olive); background: var(--olive); color: #fff; }
</style>
