<script setup lang="ts">
import { computed, ref } from 'vue'
import BuiltInSkillList from '@/components/skills/BuiltInSkillList.vue'
import { useAgentStore } from '@/stores/agentStore'
import { searchSkills } from '@/utils/skillSearch'
import type { SkillConfig } from '@/types/skill'
import { confirmAction } from '@/utils/confirmAction'

const store = useAgentStore()
const query = ref('')
const showEditor = ref(false)
const editingSkill = ref<SkillConfig | null>(null)
const editForm = ref({ name: '', description: '', content: '' })
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
const userSkills = computed(() => searchSkills(
  query.value,
  store.inMemorySkills.filter(skill => skill.source !== 'builtin'),
))

function isBuiltin(skill: SkillConfig) {
  return skill.source === 'builtin'
}

function openCreate() {
  editingSkill.value = null
  editForm.value = { name: '', description: '', content: '' }
  showEditor.value = true
}

function openEdit(skill: SkillConfig) {
  editingSkill.value = skill
  editForm.value = {
    name: skill.name,
    description: skill.description,
    content: skill.skillContent,
  }
  showEditor.value = true
}

function closeEditor() {
  showEditor.value = false
}

async function saveSkill() {
  const name = editForm.value.name.trim()
  const description = editForm.value.description.trim()
  const content = editForm.value.content.trim()
  if (!name || !content) return

  const skill: SkillConfig = {
    id: editingSkill.value?.id || name.toLowerCase().replace(/\s+/g, '-'),
    name,
    description,
    triggers: editingSkill.value?.triggers || [],
    skillContent: content,
    references: editingSkill.value?.references || [],
    examples: editingSkill.value?.examples || [],
    version: editingSkill.value?.version || 1,
    source: 'user',
    createdAt: editingSkill.value?.createdAt || Date.now(),
    updatedAt: Date.now(),
    evolutionLog: editingSkill.value?.evolutionLog || [],
  }
  if (editingSkill.value) {
    store.updateSkill(editingSkill.value.id, skill)
  } else {
    await store.createAgent(skill)
  }
  closeEditor()
}

async function deleteSkill(skill: SkillConfig) {
  if (!await confirmAction(`删除自建 Skill「${skill.name}」？`)) return
  await store.deleteAgent(skill.id)
}
</script>

<template>
  <section class="wsp">
    <header class="wsp-head">
      <strong>Skill 仓库</strong>
      <button class="wsp-create" type="button" @click="openCreate">自建</button>
    </header>
    <label class="wsp-search"><input v-model="query" type="search" placeholder="搜索 Skill" /></label>
    <div v-if="!store.skillsBootstrapped" class="wsp-state">加载中...</div>
    <div v-else class="wsp-list">
      <section v-if="userSkills.length" class="wsp-section">
        <div class="wsp-section-title">我的 Skill</div>
        <article v-for="skill in userSkills" :key="skill.id" class="wsp-user-skill">
          <div class="wsp-user-main">
            <strong>{{ skill.name }}</strong>
            <p>{{ skill.description || '暂无描述' }}</p>
          </div>
          <div v-if="!isBuiltin(skill)" class="wsp-user-actions">
            <button type="button" @click="openEdit(skill)">编辑</button>
            <button class="danger" type="button" @click="deleteSkill(skill)">删除</button>
          </div>
        </article>
      </section>
      <section class="wsp-section">
        <div class="wsp-section-title">内置 Skill</div>
        <BuiltInSkillList :skills="builtInSkills" />
      </section>
    </div>

    <div v-if="showEditor" class="wsp-overlay" @click.self="closeEditor">
      <form class="wsp-editor" @submit.prevent="saveSkill">
        <header>
          <strong>{{ editingSkill ? '编辑自建 Skill' : '自建 Skill' }}</strong>
          <button type="button" title="关闭" @click="closeEditor">×</button>
        </header>
        <label>
          <span>名称</span>
          <input v-model="editForm.name" required placeholder="例如：我的写作助手" />
        </label>
        <label>
          <span>描述</span>
          <input v-model="editForm.description" placeholder="一句话说明它适合做什么" />
        </label>
        <label>
          <span>SKILL.md</span>
          <textarea v-model="editForm.content" required rows="12" placeholder="填写完整的 SKILL.md 内容" />
        </label>
        <footer>
          <button type="button" @click="closeEditor">取消</button>
          <button class="primary" type="submit">保存</button>
        </footer>
      </form>
    </div>
  </section>
</template>

<style scoped>
.wsp { height: 100%; display: flex; flex-direction: column; background: var(--surface); color: var(--ink1); overflow: hidden; }
.wsp-head { display: flex; align-items: center; justify-content: space-between; padding: 14px; border-bottom: 1px solid var(--line); font-size: 16px; }
.wsp-create, .wsp-user-actions button, .wsp-editor button { border: 1px solid var(--line); border-radius: 5px; background: var(--paper); color: var(--ink1); font: inherit; cursor: pointer; }
.wsp-create { padding: 5px 10px; font-size: 12px; }
.wsp-search { padding: 10px; }
.wsp-search input { box-sizing: border-box; width: 100%; height: 34px; padding: 0 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: var(--ink1); font: inherit; font-size: 12px; }
.wsp-list { flex: 1; overflow: auto; padding: 0 10px 16px; }
.wsp-state { padding: 32px; color: var(--ink3); text-align: center; font-size: 13px; }
.wsp-section { padding-top: 10px; }
.wsp-section-title { margin: 0 2px 8px; color: var(--ink3); font-size: 12px; }
.wsp-user-skill { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); }
.wsp-user-main { min-width: 0; flex: 1; }
.wsp-user-main strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.wsp-user-main p { margin: 4px 0 0; color: var(--ink3); font-size: 12px; line-height: 1.45; }
.wsp-user-actions { display: flex; flex: 0 0 auto; gap: 4px; }
.wsp-user-actions button { padding: 4px 7px; font-size: 12px; }
.wsp-user-actions .danger { color: var(--red, #b42318); }
.wsp-overlay { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 16px; background: rgb(0 0 0 / 35%); }
.wsp-editor { display: grid; gap: 12px; width: min(560px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); box-shadow: 0 18px 48px rgb(0 0 0 / 22%); }
.wsp-editor header, .wsp-editor footer { display: flex; align-items: center; justify-content: space-between; }
.wsp-editor header button { width: 28px; height: 28px; font-size: 18px; line-height: 1; }
.wsp-editor label { display: grid; gap: 6px; color: var(--ink2); font-size: 12px; }
.wsp-editor input, .wsp-editor textarea { box-sizing: border-box; width: 100%; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); font: inherit; font-size: 13px; }
.wsp-editor input { height: 34px; padding: 0 9px; }
.wsp-editor textarea { padding: 9px; resize: vertical; }
.wsp-editor footer { justify-content: flex-end; gap: 8px; }
.wsp-editor footer button { padding: 6px 12px; font-size: 13px; }
.wsp-editor footer .primary { border-color: var(--olive); background: var(--olive); color: #fff; }
</style>
