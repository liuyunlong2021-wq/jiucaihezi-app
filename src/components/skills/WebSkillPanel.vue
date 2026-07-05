<script setup lang="ts">
/**
 * WebSkillPanel.vue — Web 端 Skill 管理面板（轻量版）
 *
 * 功能：浏览内置+自建 Skill / 搜索 / 新建 / 编辑 / 删除 / AI创建
 * 对比桌面 CentralSkillsPanel：无 git clone / GitHub导入 / Agent关联 / Bundle管理
 */
import { ref, computed } from 'vue'
import { useAgentStore } from '@/stores/agentStore'
import { parseSkillMd, serializeToSkillMd } from '@/types/skill'
import type { SkillConfig } from '@/types/skill'
import { confirmAction } from '@/utils/confirmAction'
import { emitEvent } from '@/utils/eventBus'

const store = useAgentStore()

const query = ref('')
const showEditor = ref(false)
const editingSkill = ref<SkillConfig | null>(null)
const editForm = ref({ name: '', description: '', content: '' })

const allSkills = computed(() => store.inMemorySkills)

const filteredSkills = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return allSkills.value
  return allSkills.value.filter(s =>
    (s.name || '').toLowerCase().includes(q) ||
    (s.description || '').toLowerCase().includes(q)
  )
})

function isBuiltin(skill: SkillConfig) { return skill.source === 'builtin' }

function openCreate() {
  editingSkill.value = null
  editForm.value = { name: '', description: '', content: '' }
  showEditor.value = true
}

function openEdit(skill: SkillConfig) {
  if (isBuiltin(skill)) return
  editingSkill.value = skill
  const parsed = parseSkillMd(skill.skillContent || '')
  editForm.value = {
    name: skill.name || parsed.name || '',
    description: skill.description || parsed.description || '',
    content: skill.skillContent || '',
  }
  showEditor.value = true
}

function closeEditor() { showEditor.value = false }

async function saveSkill() {
  const { name, description, content } = editForm.value
  if (!name.trim() || !content.trim()) return

  const parsed = parseSkillMd(content)
  const skill: SkillConfig = {
    id: editingSkill.value?.id || name.trim().toLowerCase().replace(/\s+/g, '-'),
    name: parsed.name || name.trim(),
    description: parsed.description || description.trim(),
    triggers: parsed.triggers || [],
    references: parsed.references || [],
    examples: parsed.examples || [],
    source: 'user',
    version: (editingSkill.value?.version || 0) + 1,
    createdAt: editingSkill.value?.createdAt || Date.now(),
    updatedAt: Date.now(),
    evolutionLog: editingSkill.value?.evolutionLog || [],
    skillContent: content,
  }

  const existing = store.inMemorySkills.filter(s => s.id !== skill.id)
  store.inMemorySkills = [...existing, skill]
  store.persistWebSkills()
  closeEditor()
}

async function deleteSkill(skill: SkillConfig) {
  if (isBuiltin(skill)) return
  if (!await confirmAction(`确定删除 Skill「${skill.name}」？`)) return
  store.inMemorySkills = store.inMemorySkills.filter(s => s.id !== skill.id)
  store.persistWebSkills()
}

async function createWithAI() {
  // 切换到对话区并选中 JC-taijianskill-creator
  emitEvent('switch-panel', 'chat')
  // 通知 ChatPanel 选中这个 Skill
  setTimeout(() => {
    const stored = localStorage.getItem('jc_opencode_skill')
    if (stored !== 'JC-taijianskill-creator') {
      localStorage.setItem('jc_opencode_skill', 'JC-taijianskill-creator')
    }
    emitEvent('select-skill', 'JC-taijianskill-creator')
  }, 200)
}
</script>

<template>
  <div class="wsp">
    <!-- 头部 -->
    <div class="wsp-head">
      <strong class="wsp-title">Skill 仓库</strong>
      <span class="wsp-subtitle">轻量版</span>
      <div class="wsp-head-actions">
        <button class="wsp-btn wsp-btn-primary" @click="createWithAI">
          🤖 AI 创建
        </button>
        <button class="wsp-btn" @click="openCreate">+ 手动创建</button>
      </div>
    </div>

    <!-- 搜索 -->
    <div class="wsp-search">
      <input v-model="query" type="search" placeholder="搜索 Skill..." />
    </div>

    <!-- Skill 列表 -->
    <div v-if="!store.skillsBootstrapped" class="wsp-empty">
      <p>加载中...</p>
    </div>
    <div v-else class="wsp-list">
      <div v-if="filteredSkills.length === 0" class="wsp-empty">
        <p v-if="query">没有匹配的 Skill</p>
        <p v-else>还没有 Skill，点击上方按钮创建</p>
      </div>
      <div
        v-for="skill in filteredSkills" :key="skill.id"
        class="wsp-card"
        :class="{ builtin: isBuiltin(skill) }"
      >
        <div class="wsp-card-head">
          <span class="wsp-card-name">{{ skill.name }}</span>
          <span v-if="isBuiltin(skill)" class="wsp-badge">内置</span>
          <span v-else class="wsp-badge user">自建</span>
        </div>
        <div v-if="skill.description" class="wsp-card-desc">{{ skill.description }}</div>
        <div class="wsp-card-actions">
          <button v-if="!isBuiltin(skill)" class="wsp-btn-sm" @click="openEdit(skill)">编辑</button>
          <button v-if="!isBuiltin(skill)" class="wsp-btn-sm wsp-btn-danger" @click="deleteSkill(skill)">删除</button>
          <span v-else class="wsp-card-hint">内置 Skill，不可编辑</span>
        </div>
      </div>
    </div>

    <!-- 编辑器弹窗 -->
    <div v-if="showEditor" class="wsp-overlay" @click.self="closeEditor">
      <div class="wsp-editor">
        <div class="wsp-editor-head">
          <strong>{{ editingSkill ? '编辑 Skill' : '新建 Skill' }}</strong>
          <button class="wsp-btn-sm" @click="closeEditor">关闭</button>
        </div>
        <label class="wsp-field">
          <span>名称</span>
          <input v-model="editForm.name" placeholder="my-skill-name" />
        </label>
        <label class="wsp-field">
          <span>描述</span>
          <input v-model="editForm.description" placeholder="一句话描述这个 Skill 的功能" />
        </label>
        <label class="wsp-field">
          <span>SKILL.md 内容</span>
          <textarea
            v-model="editForm.content"
            placeholder="---&#10;name: my-skill&#10;description: 描述&#10;---&#10;&#10;# 我的 Skill&#10;..."
            rows="12"
          />
        </label>
        <div class="wsp-editor-actions">
          <button class="wsp-btn wsp-btn-primary" @click="saveSkill">保存</button>
          <button class="wsp-btn" @click="closeEditor">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wsp {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  color: var(--ink1);
  overflow: hidden;
}
.wsp-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--border);
}
.wsp-title {
  font-size: 16px;
  font-weight: 950;
}
.wsp-subtitle {
  font-size: 11px;
  color: var(--ink3);
}
.wsp-head-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.wsp-btn {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink2);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.wsp-btn:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.wsp-btn-primary {
  background: var(--olive-pale);
  color: var(--olive-dark);
  border-color: var(--olive);
}
.wsp-search {
  flex: 0 0 auto;
  padding: 10px 10px 0;
}
.wsp-search input {
  width: 100%;
  height: 34px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink1);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.wsp-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 10px 16px;
}
.wsp-empty {
  padding: 32px 0;
  text-align: center;
  color: var(--ink3);
  font-size: 13px;
}
.wsp-card {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 8px;
  background: var(--paper);
}
.wsp-card.builtin {
  background: var(--olive-pale);
}
.wsp-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.wsp-card-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--ink1);
}
.wsp-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--olive);
  color: #fff;
}
.wsp-badge.user {
  background: var(--ink3);
}
.wsp-card-desc {
  font-size: 12px;
  color: var(--ink3);
  margin-top: 4px;
}
.wsp-card-actions {
  margin-top: 8px;
  display: flex;
  gap: 6px;
  align-items: center;
}
.wsp-card-hint {
  font-size: 11px;
  color: var(--ink3);
}
.wsp-btn-sm {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink2);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.wsp-btn-sm:hover {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.wsp-btn-danger {
  color: var(--error);
  border-color: var(--error);
}
.wsp-btn-danger:hover {
  background: var(--error);
  color: #fff;
}
.wsp-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.wsp-editor {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  width: 520px;
  max-width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,.15);
}
.wsp-editor-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  font-size: 15px;
  font-weight: 700;
}
.wsp-field {
  display: block;
  margin-bottom: 12px;
  font-size: 13px;
}
.wsp-field span {
  display: block;
  margin-bottom: 4px;
  color: var(--ink3);
  font-size: 12px;
  font-weight: 600;
}
.wsp-field input,
.wsp-field textarea {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink1);
  font: inherit;
  font-size: 13px;
  outline: none;
  resize: vertical;
}
.wsp-field input:focus,
.wsp-field textarea:focus {
  border-color: var(--olive);
}
.wsp-editor-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}

@media (max-width: 768px) {
  .wsp-head { flex-wrap: wrap; }
  .wsp-head-actions { margin-left: 0; width: 100%; margin-top: 8px; }
  .wsp-editor { width: calc(100vw - 32px); }
}
</style>
