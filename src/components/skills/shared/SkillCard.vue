<script setup lang="ts">
import { computed } from 'vue'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import type { SkillWithLinks } from '@/types/skillsManage'

const props = defineProps<{
  skill: SkillWithLinks
  selected?: boolean
  installing?: boolean
  deleting?: boolean
}>()

const emit = defineEmits<{
  (e: 'open', skill: SkillWithLinks): void
  (e: 'install', skill: SkillWithLinks): void
  (e: 'delete', skill: SkillWithLinks): void
  (e: 'editAlias', skill: SkillWithLinks): void
}>()

const store = useSkillsManageStore()

const displayAlias = computed(() => store.getSkillDisplayAlias(props.skill.id)?.alias || '')
const displayName = computed(() => store.getSkillDisplayName(props.skill))

const sourcePath = computed(() =>
  props.skill.canonical_path || props.skill.file_path || props.skill.source || props.skill.id
)

const linkedCount = computed(() =>
  props.skill.linked_agents.length + (props.skill.read_only_agents?.length || 0)
)
</script>

<template>
  <article class="sm-card" :class="{ selected }" @click="emit('open', skill)">
    <div class="sm-card-top">
      <div class="sm-icon">
        <span class="mso">magic_button</span>
      </div>
      <div class="sm-title-block">
        <h4>{{ displayName }}</h4>
        <div v-if="displayAlias" class="sm-official-name">Skill: {{ skill.name }}</div>
        <p v-if="skill.description">{{ skill.description }}</p>
        <p v-else class="muted">无描述</p>
      </div>
    </div>

    <div class="sm-path" :title="sourcePath">
      <span class="mso">folder_open</span>
      <span>{{ sourcePath }}</span>
    </div>

    <div class="sm-card-foot">
      <span class="sm-pill" :class="{ active: linkedCount > 0 }">
        <span class="mso">{{ linkedCount > 0 ? 'link' : 'link_off' }}</span>
        {{ linkedCount > 0 ? `${linkedCount} 个安装目标` : '未安装' }}
      </span>
      <span v-if="skill.source" class="sm-pill">
        <span class="mso">source</span>
        {{ skill.source }}
      </span>
      <div class="sm-actions">
        <button type="button" title="编辑显示别名" @click.stop="emit('editAlias', skill)">
          <span class="mso">edit_note</span>
        </button>
        <button type="button" title="查看详情" @click.stop="emit('open', skill)">
          <span class="mso">open_in_new</span>
        </button>
        <button type="button" title="安装到工具" :disabled="installing" @click.stop="emit('install', skill)">
          <span class="mso" :class="{ spin: installing }">{{ installing ? 'progress_activity' : 'add_link' }}</span>
        </button>
        <button type="button" title="删除 Skill 仓库中的 Skill" :disabled="deleting" @click.stop="emit('delete', skill)">
          <span class="mso" :class="{ spin: deleting }">{{ deleting ? 'progress_activity' : 'delete' }}</span>
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.sm-card {
  min-height: 172px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--paper) 88%, var(--surface));
  box-shadow: var(--jc-shadow-sm);
  cursor: pointer;
  transition: border-color .15s ease, transform .15s ease, background .15s ease;
}
.sm-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--olive) 52%, var(--border));
  background: var(--paper);
}
.sm-card.selected {
  border-color: var(--olive-dark);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--olive) 18%, transparent);
}
.sm-card-top {
  display: flex;
  gap: 10px;
  min-width: 0;
}
.sm-icon {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.sm-icon .mso { font-size: 19px; }
.sm-title-block {
  min-width: 0;
  flex: 1;
}
.sm-title-block h4 {
  margin: 0;
  font-size: 14px;
  line-height: 1.25;
  font-weight: 900;
  color: var(--ink1);
  overflow-wrap: anywhere;
}
.sm-official-name {
  margin-top: 3px;
  color: var(--ink3);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.25;
  overflow-wrap: anywhere;
}
.sm-title-block p {
  margin: 5px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ink2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.sm-title-block p.muted { color: var(--ink3); }
.sm-path {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 7px 8px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--surface-alt) 76%, transparent);
  color: var(--ink3);
  font-size: 11px;
}
.sm-path .mso {
  flex: 0 0 auto;
  font-size: 14px;
}
.sm-path span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sm-card-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.sm-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 118px;
  min-height: 24px;
  padding: 3px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface-alt) 86%, transparent);
  color: var(--ink3);
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}
.sm-pill.active {
  background: color-mix(in srgb, var(--olive) 18%, transparent);
  color: var(--olive-dark);
}
.sm-pill .mso { font-size: 13px; }
.sm-actions {
  margin-left: auto;
  display: inline-flex;
  gap: 2px;
}
.sm-actions button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--ink3);
  cursor: pointer;
}
.sm-actions button:hover:not(:disabled) {
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.sm-actions button:disabled {
  opacity: .5;
  cursor: default;
}
.sm-actions .mso { font-size: 16px; }
.spin { animation: sm-spin 1s linear infinite; }
@keyframes sm-spin { to { transform: rotate(360deg); } }
</style>
