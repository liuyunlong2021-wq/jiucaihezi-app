<script setup lang="ts">
/**
 * V8SkillNode.vue — Skill 选择器（纯引用，无 ▶）
 * webhuabu Phase 1a: 真实下拉选择器，替换 prompt() 占位
 */
import { computed, ref } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import NodeFrame from './NodeFrame.vue'
import { useCanvasStore } from '@/stores/canvasStore'
import { useAgentStore } from '@/stores/agentStore'
import { useV8NodeBehavior } from '@/components/canvas/v8/composables/useV8NodeBehavior'
import type { CanvasNode } from '@/types/canvas'
import type { SkillConfig as AgentSkillConfig } from '@/types/skill'

const props = defineProps<{ id: string; data?: any; selected?: boolean }>()
const canvasStore = useCanvasStore()
const agentStore = useAgentStore()
const node = { id: props.id, data: props.data } as CanvasNode
const { onResizeHandlePointerDown } = useV8NodeBehavior(node, {})

// ─── Skill 列表 ───
const allSkills = computed<AgentSkillConfig[]>(() => {
  const loaded = agentStore.loadSkills()
  const presets = agentStore.getPresetSkills()
  // 去重
  const seen = new Set(loaded.map(s => s.id))
  return [...loaded, ...presets.filter(p => !seen.has(p.id))]
})

const selectedSkillName = computed(() => props.data?.skillName || '')
const selectedSkillId = computed(() => props.data?.skillId || '')
const showDropdown = ref(false)
const searchText = ref('')

const filteredSkills = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return allSkills.value
  return allSkills.value.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q) ||
    (s.triggers || []).some((t: string) => t.toLowerCase().includes(q))
  )
})

// ─── 选择 Skill ───
async function selectSkill(skill: AgentSkillConfig) {
  showDropdown.value = false
  searchText.value = ''

  // 解析 SKILL.md 内容
  const skillContent = await agentStore.resolveSkillUriContent(skill.skillContent)
  const applicability = agentStore.extractApplicability(skillContent)

  canvasStore.updateNodeData(props.id, {
    skillId: skill.id,
    skillName: skill.name,
    skillContent: skillContent || skill.skillContent,
    skillSource: skill.source,
    applicability,
  })
}

// ─── 清除选择 ───
function clearSkill() {
  showDropdown.value = false
  searchText.value = ''
  canvasStore.updateNodeData(props.id, {
    skillId: '',
    skillName: '',
    skillContent: '',
    skillSource: '',
    applicability: [],
  })
}

// ─── 切换下拉 ───
function toggleDropdown() {
  showDropdown.value = !showDropdown.value
  if (showDropdown.value) searchText.value = ''
}

function closeDropdown(e: FocusEvent) {
  // 延迟关闭，让 click 事件先触发
  setTimeout(() => { showDropdown.value = false }, 150)
}
</script>

<template>
  <NodeFrame
    :id="id"
    label="Skill"
    icon="smart_toy"
    role="context"
    :collapsed="false"
    :selected="selected"
    :executable="false"
    @delete="$emit('delete', $event)"
    @resize-start="onResizeHandlePointerDown"
  >
    <Handle id="right-context" type="source" :position="Position.Right" :style="{ background: '#a78bfa', width: '10px', height: '10px', border: 'none' }" />
    <div class="v8-skill-node">
      <!-- 已选 Skill 显示 / 点击打开下拉 -->
      <div class="v8-skill-chip" :class="{ empty: !selectedSkillId }" @click="toggleDropdown">
        <span v-if="selectedSkillId" class="v8-skill-chip-icon">🧩</span>
        <span v-else class="v8-skill-chip-icon">➕</span>
        <span class="v8-skill-chip-name">{{ selectedSkillName || '选择 Skill...' }}</span>
        <button v-if="selectedSkillId" class="v8-skill-chip-clear" @click.stop="clearSkill" title="清除选择">✕</button>
      </div>

      <!-- 下拉菜单 -->
      <div v-if="showDropdown" class="v8-skill-dropdown">
        <!-- 搜索框 -->
        <div class="v8-skill-search">
          <input
            v-model="searchText"
            type="text"
            placeholder="搜索 Skill..."
            class="v8-skill-search-input"
            @focus.stop
            @blur="closeDropdown"
          />
        </div>
        <!-- Skill 列表 -->
        <div class="v8-skill-list">
          <!-- 清除选择 -->
          <div class="v8-skill-item clear" @click="clearSkill">
            <span class="v8-skill-item-icon">—</span>
            <span class="v8-skill-item-label">无 Skill（清除选择）</span>
          </div>
          <!-- 各 Skill -->
          <div
            v-for="skill in filteredSkills"
            :key="skill.id"
            class="v8-skill-item"
            :class="{ active: skill.id === selectedSkillId }"
            @mousedown.prevent
            @click="selectSkill(skill)"
          >
            <span class="v8-skill-item-icon">{{ skill.source === 'preset' ? '📦' : skill.source === 'github' ? '🐙' : '👤' }}</span>
            <div class="v8-skill-item-info">
              <span class="v8-skill-item-label">{{ skill.name }}</span>
              <span class="v8-skill-item-desc">{{ skill.description?.slice(0, 60) || skill.oneLineDesc || '' }}</span>
            </div>
            <span v-if="skill.id === selectedSkillId" class="v8-skill-item-check">✅</span>
          </div>
          <!-- 无匹配 -->
          <div v-if="filteredSkills.length === 0" class="v8-skill-empty">
            <span>没有匹配的 Skill</span>
          </div>
        </div>
      </div>

      <!-- 提示 -->
      <div class="v8-skill-hint">
        {{ selectedSkillId ? '已注入 system prompt · 可连多个 LLM' : '点击选择 · 连 LLM 注入 system（skillApplicability 过滤）' }}
      </div>
    </div>
  </NodeFrame>
</template>

<style scoped>
.v8-skill-node { padding: 10px; position: relative; }
.v8-skill-chip {
  display: inline-flex; align-items: center; gap: 6px;
  background: color-mix(in srgb, #a78bfa 12%, var(--surface));
  border: 1px solid #a78bfa; border-radius: 999px;
  padding: 4px 10px; font-size: 12px; color: #6d28d9;
  cursor: pointer; user-select: none; transition: all .15s;
  max-width: 100%;
}
.v8-skill-chip:hover { background: color-mix(in srgb, #a78bfa 20%, var(--surface)); }
.v8-skill-chip.empty { color: var(--ink3); border-style: dashed; }
.v8-skill-chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.v8-skill-chip-clear { border: none; background: none; color: #6d28d9; cursor: pointer; font-size: 14px; padding: 0 2px; line-height: 1; }
.v8-skill-chip-clear:hover { color: #dc2626; }

.v8-skill-dropdown {
  position: absolute; top: 100%; left: 10px; right: 10px; z-index: 100;
  background: var(--paper); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.12); margin-top: 4px;
  max-height: 320px; display: flex; flex-direction: column;
}
.v8-skill-search { padding: 8px; border-bottom: 1px solid var(--border); }
.v8-skill-search-input {
  width: 100%; border: 1px solid var(--border); border-radius: 6px;
  padding: 6px 10px; font-size: 12px; outline: none; background: var(--surface);
  color: var(--ink1);
}
.v8-skill-search-input:focus { border-color: #a78bfa; }
.v8-skill-list { flex: 1; overflow-y: auto; padding: 4px; }
.v8-skill-item {
  display: flex; align-items: center; gap: 8px; padding: 8px;
  border-radius: 6px; cursor: pointer; transition: background .1s;
  font-size: 12px;
}
.v8-skill-item:hover { background: var(--surface-alt); }
.v8-skill-item.active { background: color-mix(in srgb, #a78bfa 10%, var(--surface)); }
.v8-skill-item.clear { color: var(--ink3); font-style: italic; }
.v8-skill-item-icon { flex-shrink: 0; width: 20px; text-align: center; }
.v8-skill-item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.v8-skill-item-label { font-weight: 600; color: var(--ink1); }
.v8-skill-item-desc { font-size: 10px; color: var(--ink3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.v8-skill-item-check { flex-shrink: 0; font-size: 14px; }
.v8-skill-empty { text-align: center; padding: 20px; color: var(--ink3); font-size: 12px; }
.v8-skill-hint { font-size: 10px; color: var(--ink3); margin-top: 6px; }
</style>