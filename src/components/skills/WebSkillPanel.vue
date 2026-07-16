<script setup lang="ts">
import { computed, ref } from 'vue'
import BuiltInSkillList from '@/components/skills/BuiltInSkillList.vue'
import { useAgentStore } from '@/stores/agentStore'
import { searchSkills } from '@/utils/skillSearch'

const store = useAgentStore()
const query = ref('')
const builtInSkills = computed(() => searchSkills(
  query.value,
  store.inMemorySkills.filter(skill => skill.source === 'builtin'),
).map(skill => ({
  id: skill.id,
  name: skill.name,
  description: skill.description || null,
  triggers: skill.triggers || [],
  commands: [],
  files: ['SKILL.md'],
})))
</script>

<template>
  <section class="wsp">
    <header class="wsp-head"><strong>Skill 仓库</strong></header>
    <label class="wsp-search"><input v-model="query" type="search" placeholder="搜索内置 Skill" /></label>
    <div v-if="!store.skillsBootstrapped" class="wsp-state">加载中...</div>
    <BuiltInSkillList v-else :skills="builtInSkills" class="wsp-list" />
  </section>
</template>

<style scoped>
.wsp { height: 100%; display: flex; flex-direction: column; background: var(--surface); color: var(--ink1); overflow: hidden; }
.wsp-head { padding: 14px; border-bottom: 1px solid var(--line); font-size: 16px; }
.wsp-search { padding: 10px; }
.wsp-search input { box-sizing: border-box; width: 100%; height: 34px; padding: 0 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: var(--ink1); font: inherit; font-size: 12px; }
.wsp-list { flex: 1; overflow: auto; padding: 0 10px 16px; }
.wsp-state { padding: 32px; color: var(--ink3); text-align: center; font-size: 13px; }
</style>
