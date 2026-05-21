<script setup lang="ts">
/**
 * SkillPickerBar.vue — 输入框上方搭子控件栏
 *
 * 布局：[搭子选择器▼]  [正在使用：xxx]  [自动搭子 🟢]
 */
import { ref, computed } from 'vue'
import { useAgentStore } from '@/stores/agentStore'

const agentStore = useAgentStore()

const showPicker = ref(false)
const searchText = ref('')

const mySkills = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  const skills = agentStore.getMySkills()
  if (!q) return skills
  return skills.filter(a =>
    (a.name || '').toLowerCase().includes(q) ||
    (a.oneLineDesc || a.description || '').toLowerCase().includes(q) ||
    (a.triggers || []).some((t: string) => t.toLowerCase().includes(q))
  )
})

function selectAgent(id: string) {
  agentStore.selectAgent(id)
  showPicker.value = false
  searchText.value = ''
}

function clearAgent() {
  agentStore.selectAgent('')
}

function toggleAutoAgent() {
  agentStore.toggleRouter()
}
</script>

<template>
  <div class="spb">
    <!-- 左：搭子选择器 -->
    <button class="spb-picker" :class="{ active: showPicker }" @click="showPicker = !showPicker">
      <span class="mso" style="font-size:16px">apps</span>
      <span>搭子</span>
      <span class="mso spb-arrow">{{ showPicker ? 'expand_less' : 'expand_more' }}</span>
    </button>

    <!-- 中：正在使用 -->
    <div v-if="agentStore.currentAgent" class="spb-current" @click="showPicker = !showPicker">
      <span class="mso" style="font-size:14px">smart_toy</span>
      <span class="spb-current-name">{{ agentStore.currentAgent.name }}</span>
      <span class="mso spb-clear" @click.stop="clearAgent">close</span>
    </div>

    <!-- 右：自动搭子开关 -->
    <div class="spb-auto" :class="{ on: agentStore.routerEnabled }" @click="toggleAutoAgent">
      <span class="spb-auto-dot"></span>
      <span class="spb-auto-label">自动搭子</span>
    </div>
  </div>

  <!-- 展开选择面板 -->
  <div v-if="showPicker" class="spb-panel">
    <input v-model="searchText" class="spb-search" placeholder="搜索我的搭子..." autofocus />
    <div class="spb-list">
      <button
        v-for="skill in mySkills" :key="skill.id"
        class="spb-item" :class="{ selected: agentStore.currentAgent?.id === skill.id }"
        @click="selectAgent(skill.id)"
      >
        <div class="spb-item-name">{{ skill.name }}</div>
        <div v-if="skill.oneLineDesc || skill.description" class="spb-item-desc">{{ skill.oneLineDesc || skill.description }}</div>
      </button>
      <div v-if="mySkills.length === 0" class="spb-empty">
        {{ searchText ? '没有匹配的搭子' : '还没有搭子，去仓库添加' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.spb {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
}

.spb-picker {
  display: flex; align-items: center; gap: 3px;
  padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--paper); color: var(--ink2); cursor: pointer;
  font-size: 12px; font-weight: 600; font-family: inherit;
  transition: all .12s;
}
.spb-picker:hover, .spb-picker.active { border-color: var(--olive); color: var(--olive); }
.spb-arrow { font-size: 16px; }

.spb-current {
  display: flex; align-items: center; gap: 4px;
  padding: 3px 8px; border-radius: 6px;
  background: rgba(107,142,35,.1); color: var(--olive);
  font-size: 12px; font-weight: 600; cursor: pointer;
}
.spb-current-name {
  max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.spb-clear { font-size: 14px; color: var(--ink3); cursor: pointer; margin-left: 2px; }
.spb-clear:hover { color: #e53935; }

.spb-auto {
  margin-left: auto;
  display: flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: 20px;
  border: 1px solid var(--line); background: var(--paper);
  cursor: pointer; transition: all .2s;
}
.spb-auto:hover { border-color: var(--olive); }
.spb-auto.on { background: var(--olive); border-color: var(--olive); }
.spb-auto-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--ink3); opacity: .4; transition: all .2s;
}
.spb-auto.on .spb-auto-dot { background: #fff; opacity: 1; animation: pulse-dot 1.5s infinite; }
@keyframes pulse-dot { 0%,100% { opacity:1 } 50% { opacity:.4 } }
.spb-auto-label { font-size: 11px; font-weight: 700; color: var(--ink2); }
.spb-auto.on .spb-auto-label { color: #fff; }

/* 展开面板 */
.spb-panel {
  padding: 8px 12px; border-bottom: 1px solid var(--line);
  background: var(--paper); animation: slide-down .15s ease;
}
@keyframes slide-down { from { opacity:0; transform:translateY(-4px) } to { opacity:1; transform:none } }
.spb-search {
  width: 100%; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px;
  background: var(--surface); color: var(--ink1); font-size: 12px; font-family: inherit;
  outline: none; margin-bottom: 6px;
}
.spb-search:focus { border-color: var(--olive); }
.spb-list { max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.spb-item {
  padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface); cursor: pointer; text-align: left;
  font-family: inherit; transition: all .12s;
}
.spb-item:hover { border-color: var(--olive); background: rgba(107,142,35,.04); }
.spb-item.selected { border-color: var(--olive); background: rgba(107,142,35,.1); }
.spb-item-name { font-size: 12px; font-weight: 600; color: var(--ink1); }
.spb-item-desc { font-size: 10px; color: var(--ink3); margin-top: 2px; }
.spb-empty { text-align: center; padding: 16px; color: var(--ink3); font-size: 12px; }
@media (max-width: 768px) { .spb { display: none; } }
</style>
