<script setup lang="ts">
import type { WebSkillCatalogEntry } from '@/utils/skillContentResolver'

defineProps<{
  skills: WebSkillCatalogEntry[]
}>()
</script>

<template>
  <div v-if="skills.length" class="builtin-skill-list">
    <article v-for="skill in skills" :key="skill.id" class="builtin-skill-card">
      <div class="builtin-skill-head">
        <strong>{{ skill.name }}</strong>
        <span>内置</span>
      </div>
      <p>{{ skill.description || '暂无描述' }}</p>
    </article>
  </div>
  <div v-else class="builtin-skill-empty">没有匹配的内置 Skill</div>
</template>

<style scoped>
.builtin-skill-list { display: grid; gap: 8px; }
.builtin-skill-card {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 92%, var(--olive-pale));
}
.builtin-skill-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.builtin-skill-head strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.builtin-skill-head span {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--olive);
  color: #fff;
  font-size: 10px;
}
.builtin-skill-card p { margin: 5px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; }
.builtin-skill-empty { padding: 32px 0; color: var(--ink3); text-align: center; font-size: 13px; }
</style>
