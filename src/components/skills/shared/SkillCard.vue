<script setup lang="ts">
import { computed, ref } from 'vue'
import { emitEvent } from '@/utils/eventBus'
import { useSkillsManageStore } from '@/stores/skillsManageStore'
import type { SkillWithLinks } from '@/types/skillsManage'
import skillCommandsData from '@/data/skillCommands.json'

interface SkillCommand {
  title: string
  desc: string
  template: string
}

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
  (e: 'toggleMine', skill: SkillWithLinks): void
}>()

const store = useSkillsManageStore()

const isMine = computed(() => store.isMineSkill(props.skill.id))
const logoSrc = computed(() => isMine.value ? '/logo-solid.svg' : '/logo.svg')

function handleToggleMine() {
  store.toggleMineSkill(props.skill.id)
  emit('toggleMine', props.skill)
}

const displayAlias = computed(() => store.getSkillDisplayAlias(props.skill.id)?.alias || '')
const displayName = computed(() => store.getSkillDisplayName(props.skill))

const sourcePath = computed(() =>
  props.skill.canonical_path || props.skill.file_path || props.skill.source || props.skill.id
)

// 指令 — 优先从 skill.commands（scanner 解析），fallback 到旧 JSON
const skillCommands = computed<SkillCommand[]>(() => {
  const raw = props.skill.commands
  if (raw && raw.length > 0) {
    return raw.map((line: string) => {
      const idx = line.indexOf('：')
      if (idx === -1) return { title: line, desc: '', template: line }
      return {
        title: line.slice(0, idx),
        desc: '',
        template: line.slice(idx + 1).trim()
      }
    })
  }
  // Fallback: old skillCommands.json
  const map = (skillCommandsData as any).skills || {}
  return (map[props.skill.name] || map[props.skill.id]) || []
})
const showCommands = ref(false)

function toggleCommands() {
  showCommands.value = !showCommands.value
}

function fillCommand(cmd: SkillCommand) {
  emitEvent('append-chat-input', cmd.template)
  showCommands.value = false
}

function closeCommands() {
  showCommands.value = false
}
</script>

<template>
  <article class="sm-card" :class="{ selected }" @click="emit('open', skill)">
    <div class="sm-card-top">
      <div class="sm-title-block">
        <h4>{{ displayName }}</h4>
        <div v-if="displayAlias" class="sm-official-name">Skill: {{ skill.name }}</div>
        <p v-if="skill.description">{{ skill.description }}</p>
        <p v-else class="muted">无描述</p>
      </div>
    </div>

    <div class="sm-path" :title="sourcePath">
      <JcIcon name="folder_open" />
      <span>{{ sourcePath }}</span>
    </div>

    <div class="sm-card-foot">
      <div class="sm-actions">
        <button type="button" :title="isMine ? '从我的Skill移除' : '加入我的Skill'" class="sm-mine-btn" @click.stop="handleToggleMine">
          <img :src="logoSrc" alt="" width="18" height="18" />
        </button>
        <button v-if="skillCommands.length > 0" type="button" title="查看指令" @click.stop="toggleCommands">
          <JcIcon name="psychology" />
        </button>
        <button type="button" title="编辑显示别名" @click.stop="emit('editAlias', skill)">
          <JcIcon name="edit_note" />
        </button>
        <button type="button" title="查看详情" @click.stop="emit('open', skill)">
          <JcIcon name="info" />
        </button>
        <button type="button" title="删除" :disabled="deleting" @click.stop="emit('delete', skill)">
          <JcIcon :name="deleting ? 'progress_activity' : 'delete'" :class="{ spin: deleting }" />
        </button>
      </div>
    </div>
  </article>

  <!-- 指令弹窗 -->
  <div v-if="showCommands && skillCommands.length > 0" class="sm-cmd-overlay" @click.self="closeCommands">
    <div class="sm-cmd-panel">
      <div class="sm-cmd-head">
        <span>{{ displayName }} 指令</span>
        <button class="sm-cmd-close" @click="closeCommands">
          <JcIcon name="close" />
        </button>
      </div>
      <div class="sm-cmd-grid">
        <button
          v-for="cmd in skillCommands"
          :key="cmd.title"
          type="button"
          class="sm-cmd-card"
          @click="fillCommand(cmd)"
        >
          <strong>{{ cmd.title }}</strong>
          <small>{{ cmd.desc }}</small>
        </button>
      </div>
    </div>
  </div>
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

/* 指令弹窗 */
.sm-cmd-overlay {
  position: fixed; inset: 0; z-index: 999;
  background: rgba(0,0,0,.25);
  display: flex; align-items: center; justify-content: center;
}
.sm-cmd-panel {
  width: min(480px, 90vw); max-height: 70vh;
  background: var(--paper); border: 1px solid var(--border);
  border-radius: 12px; overflow: hidden;
  display: flex; flex-direction: column;
}
.sm-cmd-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--line);
  font-size: 13px; font-weight: 700; color: var(--ink1);
}
.sm-cmd-close {
  width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--ink3); cursor: pointer; border-radius: 6px;
}
.sm-cmd-close:hover { background: var(--bg); color: var(--ink1); }
.sm-cmd-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;
  padding: 10px 14px; overflow-y: auto;
}
.sm-cmd-card {
  display: flex; flex-direction: column; gap: 2px;
  padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--paper); cursor: pointer; text-align: left;
  font-family: inherit; transition: all .12s;
}
.sm-cmd-card:hover { border-color: var(--olive); background: var(--olive-pale); }
.sm-cmd-card strong { font-size: 12px; color: var(--ink1); }
.sm-cmd-card small { font-size: 11px; color: var(--ink3); line-height: 1.4; }
</style>
