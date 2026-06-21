<script setup lang="ts">
import { computed } from 'vue'
import type { CentralSkillBundleDetail } from '@/types/skillsManage'
import { useSkillsManageStore } from '@/stores/skillsManageStore'

const props = defineProps<{
  detail: CentralSkillBundleDetail | null
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'openSkill', skillId: string): void
}>()

const store = useSkillsManageStore()
const title = computed(() => props.detail?.bundle.name || 'Skill 文件夹')
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <section class="bundle-dialog" role="dialog" aria-modal="true" aria-label="Skill 文件夹详情">
      <header>
        <div>
          <h3>{{ title }}</h3>
          <p>{{ detail?.bundle.path || '读取 Skill 文件夹...' }}</p>
        </div>
        <button type="button" title="关闭" @click="emit('close')"><JcIcon name="close" /></button>
      </header>

      <div v-if="loading" class="state"><JcIcon name="progress_activity" class="spin" />读取中...</div>
      <div v-else-if="!detail" class="state">暂无详情</div>
      <div v-else class="skill-list">
        <article v-for="skill in detail.skills" :key="skill.id" class="skill-row">
          <button type="button" @click="emit('openSkill', skill.id)">
            <strong>{{ store.getSkillDisplayName(skill) }}</strong>
            <span v-if="store.getSkillDisplayAlias(skill.id)">Skill: {{ skill.name }}</span>
            <p>{{ skill.description || skill.file_path }}</p>
          </button>
          <div class="meta">
            <span>{{ skill.linked_agents.length + (skill.read_only_agents?.length || 0) }} 个安装目标</span>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: absolute;
  inset: 0;
  z-index: 7;
  display: grid;
  place-items: center;
  padding: 16px;
  background: color-mix(in srgb, var(--ink1) 18%, transparent);
}
.bundle-dialog {
  width: min(680px, 100%);
  max-height: min(720px, calc(100vh - 32px));
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--jc-shadow-lg);
}
header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
h3 { margin: 0; font-size: 15px; font-weight: 950; }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
header button {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
}
.skill-list {
  min-height: 0;
  overflow: auto;
  display: grid;
  gap: 8px;
}
.skill-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
}
.skill-row button {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
strong { display: block; font-size: 13px; color: var(--ink1); overflow-wrap: anywhere; }
span { color: var(--ink3); font-size: 11px; font-weight: 800; }
.meta {
  align-self: start;
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.state {
  min-height: 160px;
  display: grid;
  place-items: center;
  color: var(--ink3);
}
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
