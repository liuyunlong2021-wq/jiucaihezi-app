<template>
  <div class="sn-wrapper">
    <div class="sn-card" :class="data.selected ? 'sn-selected' : ''">
      <!-- Header -->
      <div class="sn-header">
        <div class="sn-header-left">
          <JcIcon name="smart_toy" class="sn-header-icon" />
          <span class="sn-header-label">Skill</span>
        </div>
        <div class="sn-header-actions">
          <button @click="handleDelete" class="sn-action-btn" title="删除"><JcIcon name="delete" /></button>
        </div>
      </div>

      <!-- Body -->
      <div class="sn-body">
        <!-- Current selection -->
        <button class="sn-chip" :class="{ empty: !selectedSkillId }" @click="toggleDropdown">
          <span class="sn-chip-dot">{{ selectedSkillId ? '🧩' : '＋' }}</span>
          <span class="sn-chip-text">{{ selectedSkillName || '选择 Skill...' }}</span>
          <button v-if="selectedSkillId" class="sn-chip-x" @click.stop="clearSkill">✕</button>
        </button>

        <!-- Dropdown -->
        <div v-if="showDropdown" class="sn-dropdown" @mousedown.stop>
          <input v-model="searchText" class="sn-search" placeholder="搜索 Skill..." @keydown.escape="showDropdown=false" />
          <div class="sn-list" ref="listRef">
            <button v-if="selectedSkillId" class="sn-item sn-item-clear" @click="clearSkill">
              <span class="sn-item-icon">✕</span>
              <span>清除选择</span>
            </button>
            <button
              v-for="s in filtered"
              :key="s.id"
              class="sn-item"
              :class="{ active: s.id === selectedSkillId }"
              @click="selectSkill(s)"
            >
              <span class="sn-item-icon">{{ s.source === 'preset' ? '📦' : s.source === 'github' ? '🐙' : '👤' }}</span>
              <div class="sn-item-info">
                <span class="sn-item-name">{{ s.name }}</span>
                <span class="sn-item-desc">{{ (s.description || '').slice(0, 50) }}</span>
              </div>
            </button>
            <div v-if="filtered.length === 0" class="sn-empty">没有匹配的 Skill</div>
          </div>
        </div>

        <div class="sn-hint">{{ selectedSkillId ? '已注入 · 连 LLM 生效' : '点上方选择 · 连线到 LLM 即注入' }}</div>
      </div>

      <!-- Handles -->
      <Handle type="target" :position="Position.Left" id="left" class="sn-handle" />
      <Handle type="source" :position="Position.Right" id="right" class="sn-handle" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAgentStore } from '@/stores/agentStore'
import type { SkillConfig as AgentSkillConfig } from '@/types/skill'

const props = defineProps<{ id: string; data: Record<string, any>; selected?: boolean }>()
const canvasStore = useCanvasStore()
const agentStore = useAgentStore()

const allSkills = computed<AgentSkillConfig[]>(() => {
  const loaded = agentStore.loadSkills()
  const presets = agentStore.getPresetSkills()
  const seen = new Set(loaded.map(s => s.id))
  return [...loaded, ...presets.filter(p => !seen.has(p.id))]
})

const selectedSkillName = computed(() => props.data?.skillName || '')
const selectedSkillId = computed(() => props.data?.skillId || '')
const showDropdown = ref(false)
const searchText = ref('')
const listRef = ref<HTMLElement | null>(null)

const filtered = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return allSkills.value
  return allSkills.value.filter(s => s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q))
})

function toggleDropdown() {
  showDropdown.value = !showDropdown.value
  if (showDropdown.value) { searchText.value = ''; nextTick(() => listRef.value?.focus()) }
}

async function selectSkill(skill: AgentSkillConfig) {
  showDropdown.value = false; searchText.value = ''
  const content = await agentStore.resolveSkillUriContent(skill.skillContent)
  const applicability = agentStore.extractApplicability(content)
  canvasStore.updateNodeData(props.id, {
    skillId: skill.id, skillName: skill.name,
    skillContent: content || skill.skillContent,
    skillSource: skill.source, applicability,
  })
}

function clearSkill() {
  showDropdown.value = false; searchText.value = ''
  canvasStore.updateNodeData(props.id, { skillId: '', skillName: '', skillContent: '', skillSource: '', applicability: [] })
}

function handleDelete() { canvasStore.deleteNode(props.id) }
</script>

<style scoped>
.sn-wrapper { min-width: 240px; max-width: 300px; }
.sn-card { background: var(--surface-alt); border-radius: var(--radius); border: 1px solid var(--border); transition: all 0.2s; }
.sn-selected { border-color: #a78bfa; box-shadow: 0 0 0 1px #a78bfa, 0 4px 16px color-mix(in srgb, #a78bfa 20%, transparent); }

.sn-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid var(--border); background: linear-gradient(90deg, color-mix(in srgb, #a78bfa 10%, transparent), transparent); }
.sn-header-left { display: flex; align-items: center; gap: 6px; }
.sn-header-icon { font-size: 16px; color: #a78bfa; }
.sn-header-label { font-size: 13px; font-weight: 500; color: var(--ink2); }
.sn-header-actions { display: flex; }
.sn-action-btn { padding: 4px; border: none; background: transparent; border-radius: 4px; cursor: pointer; color: var(--ink3); display: flex; }
.sn-action-btn:hover { background: var(--surface); color: var(--ink); }
.sn-action-btn .mso { font-size: 14px; }

.sn-body { padding: 10px 12px; position: relative; }
.sn-chip { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 10px; border-radius: 999px; border: 1px solid #a78bfa; background: color-mix(in srgb, #a78bfa 8%, var(--surface)); cursor: pointer; font-size: 12px; color: #6d28d9; font-family: var(--jc-font-body); transition: all 0.15s; }
.sn-chip:hover { background: color-mix(in srgb, #a78bfa 16%, var(--surface)); }
.sn-chip.empty { color: var(--ink3); border-style: dashed; border-color: var(--border); background: var(--surface); }
.sn-chip-dot { flex-shrink: 0; }
.sn-chip-text { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sn-chip-x { border: none; background: none; color: inherit; cursor: pointer; font-size: 14px; padding: 0; line-height: 1; flex-shrink: 0; }
.sn-chip-x:hover { color: #ef4444; }

.sn-dropdown { position: absolute; left: 12px; right: 12px; top: 100%; z-index: 1000; background: var(--paper); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--jc-shadow-lg); margin-top: 4px; overflow: hidden; }
.sn-search { display: block; width: 100%; border: none; border-bottom: 1px solid var(--border); padding: 8px 10px; font-size: 12px; outline: none; background: var(--paper); color: var(--ink); font-family: var(--jc-font-body); }
.sn-search:focus { border-color: #a78bfa; }
.sn-list { max-height: 220px; overflow-y: auto; padding: 4px; }
.sn-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px; border: none; border-radius: 6px; background: transparent; color: var(--ink); cursor: pointer; font-size: 12px; text-align: left; font-family: var(--jc-font-body); transition: background 0.1s; }
.sn-item:hover { background: var(--surface-alt); }
.sn-item.active { background: color-mix(in srgb, #a78bfa 10%, var(--surface)); }
.sn-item-clear { color: var(--ink3); font-style: italic; }
.sn-item-icon { flex-shrink: 0; width: 20px; text-align: center; font-size: 14px; }
.sn-item-info { flex: 1; min-width: 0; }
.sn-item-name { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sn-item-desc { display: block; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
.sn-empty { padding: 12px; text-align: center; font-size: 12px; color: var(--ink3); }
.sn-hint { margin-top: 8px; font-size: 11px; color: var(--ink3); text-align: center; }
.sn-handle { background: #a78bfa !important; }
</style>
