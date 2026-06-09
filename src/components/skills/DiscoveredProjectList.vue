<script setup lang="ts">
import type { AgentWithStatus, DiscoveredProject, DiscoveredSkill } from '@/types/skillsManage'
import { getDiscoverImportTargets } from '@/utils/discoverViewModel'

defineProps<{
  projects: DiscoveredProject[]
  selectedSkillIds: Set<string>
  agents: AgentWithStatus[]
  importingSkillId?: string | null
}>()

const emit = defineEmits<{
  (e: 'toggle-skill', skillId: string): void
  (e: 'import-central', skill: DiscoveredSkill): void
  (e: 'import-platform', payload: { skill: DiscoveredSkill; agentId: string; method: 'symlink' | 'copy' }): void
}>()
</script>

<template>
  <div class="projects">
    <section v-for="project in projects" :key="project.project_path" class="project">
      <header>
        <div>
          <h4>{{ project.project_name }}</h4>
          <p>{{ project.project_path }}</p>
        </div>
        <span>{{ project.skills.length }} Skill</span>
      </header>

      <article v-for="skill in project.skills" :key="skill.id" class="skill" :class="{ selected: selectedSkillIds.has(skill.id) }">
        <label class="select">
          <input
            type="checkbox"
            :checked="selectedSkillIds.has(skill.id)"
            @change="emit('toggle-skill', skill.id)"
          />
        </label>
        <div class="skill-main">
          <div class="skill-title">
            <strong>{{ skill.name }}</strong>
            <span>{{ skill.platform_name }}</span>
            <span v-if="skill.is_already_central" class="central">已在 Central Skills</span>
          </div>
          <p>{{ skill.description || skill.file_path }}</p>
          <small>{{ skill.dir_path }}</small>
        </div>
        <div class="skill-actions">
          <button
            class="btn primary"
            :disabled="skill.is_already_central || importingSkillId === skill.id"
            @click="emit('import-central', skill)"
          >
            <span class="mso" :class="{ spin: importingSkillId === skill.id }">{{ importingSkillId === skill.id ? 'progress_activity' : 'move_to_inbox' }}</span>
            Central
          </button>
          <select
            aria-label="导入到 Platform"
            :disabled="importingSkillId === skill.id"
            @change="emit('import-platform', { skill, agentId: ($event.target as HTMLSelectElement).value, method: 'symlink' }); ($event.target as HTMLSelectElement).value = ''"
          >
            <option value="">Platform</option>
            <option v-for="agent in getDiscoverImportTargets(agents, skill.platform_id)" :key="agent.id" :value="agent.id">
              {{ agent.display_name }}
            </option>
          </select>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.projects { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.project { border: 1px solid var(--border); border-radius: 8px; background: var(--paper); overflow: hidden; }
header { display: flex; justify-content: space-between; gap: 10px; padding: 10px; border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--ink1) 3%, var(--paper)); }
h4 { margin: 0; color: var(--ink1); font-size: 14px; font-weight: 950; }
p { margin: 3px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
header span { flex: 0 0 auto; color: var(--ink3); font-size: 11px; font-weight: 850; }
.skill { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 8px; padding: 10px; border-top: 1px solid var(--border2); }
.skill:first-of-type { border-top: 0; }
.skill.selected { background: color-mix(in srgb, var(--olive) 7%, transparent); }
.select { display: flex; align-items: flex-start; padding-top: 2px; }
.skill-main { min-width: 0; }
.skill-title { min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
strong { color: var(--ink1); font-size: 13px; }
.skill-title span { padding: 2px 5px; border-radius: 999px; background: color-mix(in srgb, var(--ink1) 7%, transparent); color: var(--ink3); font-size: 10px; font-weight: 850; }
.skill-title .central { background: color-mix(in srgb, var(--olive) 13%, transparent); color: var(--olive-dark); }
small { display: block; margin-top: 3px; color: var(--ink3); font-size: 11px; overflow-wrap: anywhere; }
.skill-actions { display: flex; align-items: flex-start; gap: 6px; }
.btn, select { min-height: 32px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); font-size: 12px; font-weight: 850; }
.btn { display: inline-flex; align-items: center; gap: 5px; padding: 0 9px; cursor: pointer; }
.btn.primary { border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); background: var(--olive-pale); color: var(--olive-dark); }
select { max-width: 150px; padding: 0 8px; cursor: pointer; }
button:disabled, select:disabled { opacity: .55; cursor: default; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 760px) {
  .skill { grid-template-columns: 24px minmax(0, 1fr); }
  .skill-actions { grid-column: 2; flex-wrap: wrap; }
}
</style>
