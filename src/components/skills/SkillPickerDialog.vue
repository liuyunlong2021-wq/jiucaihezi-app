<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SkillWithLinks } from '@/types/skillsManage'
import { filterSkillPickerCandidates } from '@/utils/collectionsViewModel'

const props = defineProps<{
  skills: SkillWithLinks[]
  existingSkillIds: string[]
  adding?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'add', skillIds: string[]): void
}>()

const query = ref('')
const selectedSkillIds = ref(new Set<string>())

const filteredSkills = computed(() =>
  filterSkillPickerCandidates(props.skills, props.existingSkillIds, query.value)
)

watch(
  () => props.existingSkillIds,
  () => {
    selectedSkillIds.value = new Set()
    query.value = ''
  },
  { immediate: true }
)

function toggle(skillId: string) {
  const next = new Set(selectedSkillIds.value)
  if (next.has(skillId)) next.delete(skillId)
  else next.add(skillId)
  selectedSkillIds.value = next
}

function selectAll() {
  selectedSkillIds.value = new Set(filteredSkills.value.map(skill => skill.id))
}

function clearSelection() {
  selectedSkillIds.value = new Set()
}

function add() {
  const ids = Array.from(selectedSkillIds.value)
  if (ids.length > 0) emit('add', ids)
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <section class="dialog" role="dialog" aria-modal="true" aria-label="选择 Skill">
      <header>
        <div>
          <h3>添加 Skill</h3>
          <p>从 Central Skills 选择要加入当前 Collection 的 Skill。</p>
        </div>
        <button type="button" title="关闭" @click="emit('close')"><span class="mso">close</span></button>
      </header>

      <div class="toolbar">
        <label>
          <span class="mso">search</span>
          <input v-model="query" type="search" placeholder="搜索 Skill" />
        </label>
        <button type="button" :disabled="filteredSkills.length === 0" @click="selectAll"><span class="mso">select_all</span>全选</button>
        <button type="button" :disabled="selectedSkillIds.size === 0" @click="clearSelection"><span class="mso">disabled_by_default</span>清除</button>
      </div>

      <main>
        <article
          v-for="skill in filteredSkills"
          :key="skill.id"
          :class="{ selected: selectedSkillIds.has(skill.id) }"
          @click="toggle(skill.id)"
        >
          <input type="checkbox" :checked="selectedSkillIds.has(skill.id)" @click.stop @change="toggle(skill.id)" />
          <div>
            <strong>{{ skill.name }}</strong>
            <p>{{ skill.description || skill.file_path }}</p>
          </div>
        </article>
        <p v-if="filteredSkills.length === 0" class="empty">没有可添加的 Skill。</p>
      </main>

      <footer>
        <button type="button" :disabled="adding" @click="emit('close')">取消</button>
        <button type="button" class="primary" :disabled="adding || selectedSkillIds.size === 0" @click="add">
          <span class="mso" :class="{ spin: adding }">{{ adding ? 'progress_activity' : 'add' }}</span>
          添加 {{ selectedSkillIds.size || '' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.dialog-backdrop { position: absolute; inset: 0; z-index: 8; display: grid; place-items: center; padding: 16px; background: color-mix(in srgb, var(--ink1) 18%, transparent); }
.dialog { width: min(760px, 100%); max-height: min(760px, calc(100vh - 32px)); display: flex; flex-direction: column; min-height: 0; gap: 12px; padding: 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); box-shadow: var(--jc-shadow-lg); }
header, footer, .toolbar { flex: 0 0 auto; display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; }
h3 { margin: 0; color: var(--ink1); font-size: 15px; font-weight: 950; }
p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
header button, .toolbar button, footer button { min-height: 32px; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink2); padding: 0 10px; font-weight: 850; cursor: pointer; }
header button { width: 32px; padding: 0; justify-content: center; }
.toolbar { align-items: center; flex-wrap: wrap; }
.toolbar label { min-width: 180px; flex: 1 1 260px; min-height: 32px; display: flex; align-items: center; gap: 6px; padding: 0 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); color: var(--ink3); }
.toolbar input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--ink1); font-size: 12px; }
main { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
article { min-width: 0; display: flex; align-items: flex-start; gap: 8px; padding: 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--paper); cursor: pointer; }
article.selected { border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); background: color-mix(in srgb, var(--olive) 9%, var(--paper)); }
article div { min-width: 0; }
strong { color: var(--ink1); font-size: 13px; }
.empty { grid-column: 1 / -1; display: grid; place-items: center; min-height: 120px; border: 1px dashed var(--border); border-radius: 8px; text-align: center; }
footer { justify-content: flex-end; }
footer button.primary { border-color: color-mix(in srgb, var(--olive) 45%, var(--border)); background: var(--olive-pale); color: var(--olive-dark); }
button:disabled { opacity: .55; cursor: default; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 760px) { main { grid-template-columns: 1fr; } }
</style>
